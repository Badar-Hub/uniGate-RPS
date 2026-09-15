import type { OtpChannel, OtpPurpose } from '@unigate/types';
import { BusinessRuleError, RateLimitError } from '@/common/errors.js';
import { hashOtp, identifierHash, normaliseIdentifier, randomOtp, randomToken, safeEqualHex, sha256Hex } from '@/common/crypto.js';
import { newId } from '@/common/ids.js';
import { maskEmail, maskPhone } from '@/common/redact.js';
import { cacheDel, cacheGet, cacheSet, enforce } from '@/common/throttle.js';
import { config } from '@/config/index.js';
import { prisma } from '@/database/prisma.js';
import { otpProvider } from '@/integrations/otp/otp.provider.js';
import { logger } from '@/logging/logger.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';

/**
 * OTP (security.md §3.4). Durable state is otp_requests; hot counters are Redis.
 *  - code: N digits from the CSPRNG; stored as HMAC-SHA256(code, OTP_PEPPER), never the code
 *  - supersession: issuing a new code invalidates all prior unconsumed codes for
 *    (destination_hash, purpose), so an attacker cannot accumulate live codes
 *  - burn on the 5th failure; single use via UPDATE … WHERE consumed_at IS NULL
 *  - errors never distinguish wrong / expired / consumed / unknown (AUTH_OTP_INVALID)
 */

export interface OtpTarget {
  channel: OtpChannel;
  destination: string;
  purpose: OtpPurpose;
}

function checkDestinationPolicy(channel: OtpChannel, destination: string): void {
  if (channel !== 'SMS') return;
  // Country allow-list (T-22 toll fraud) — reject before any provider call.
  const allowed = config().providers.otpAllowedCountryCodes;
  if (!allowed.some((cc) => destination.startsWith(cc))) {
    throw new BusinessRuleError('AUTH_OTP_DESTINATION_NOT_ALLOWED', 'OTP delivery to this destination is not permitted');
  }
  // KSA mobile ranges only: +9665XXXXXXXX
  if (destination.startsWith('+966') && !/^\+9665\d{8}$/.test(destination)) {
    throw new BusinessRuleError('AUTH_OTP_DESTINATION_NOT_ALLOWED', 'Only Saudi mobile numbers are accepted');
  }
}

export async function requestOtp(
  target: OtpTarget,
  ctx: { ipAddress: string | null; userId: string | null; locale: 'ar' | 'en' },
): Promise<{ sentTo: string; expiresInSeconds: number; resendAfterSeconds: number }> {
  const destination = normaliseIdentifier(target.destination);
  checkDestinationPolicy(target.channel, destination);
  const dh = identifierHash(destination);

  // Request throttles — per destination 1/60s, 5/h, 10/24h; per IP 20/h; per account 10/day.
  await enforce('AUTH_OTP_THROTTLED', [
    { key: `otp:req:d1:${dh}`, window: { limit: 1, seconds: 60 } },
    { key: `otp:req:dh:${dh}`, window: { limit: 5, seconds: 3600 } },
    { key: `otp:req:dd:${dh}`, window: { limit: 10, seconds: 86_400 } },
    ...(ctx.ipAddress ? [{ key: `otp:req:ip:${sha256Hex(ctx.ipAddress)}`, window: { limit: 20, seconds: 3600 } }] : []),
    ...(ctx.userId ? [{ key: `otp:req:u:${ctx.userId}`, window: { limit: 10, seconds: 86_400 } }] : []),
  ]);

  // Never-verified destination: 3 lifetime sends.
  const verified = await prisma().user.findFirst({
    where: target.channel === 'SMS' ? { phoneE164: destination, phoneVerifiedAt: { not: null } } : { email: destination, emailVerifiedAt: { not: null } },
    select: { id: true },
  });
  if (!verified) {
    const lifetime = await prisma().otpRequest.count({ where: { destinationHash: dh } });
    if (lifetime >= 3) throw new RateLimitError(86_400, 'AUTH_OTP_THROTTLED', 'Unverified destination has reached its send limit');
  }

  const length = await getSettingValue<number>('notifications.otp_length', 6);
  const ttl = await getSettingValue<number>('notifications.otp_ttl_seconds', 300);
  const maxAttempts = await getSettingValue<number>('notifications.otp_max_attempts', 5);
  const cooldown = await getSettingValue<number>('notifications.otp_resend_cooldown_seconds', 60);

  const code = randomOtp(length);
  const now = new Date();
  await prisma().$transaction(async (tx) => {
    // Supersede every live code for this (destination, purpose).
    await tx.otpRequest.updateMany({
      where: { destinationHash: dh, purpose: target.purpose, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    await tx.otpRequest.create({
      data: {
        id: newId(),
        channel: target.channel,
        destination,
        destinationHash: dh,
        purpose: target.purpose,
        codeHash: hashOtp(code),
        maxAttempts,
        expiresAt: new Date(now.getTime() + ttl * 1000),
        ipAddress: ctx.ipAddress,
        userId: ctx.userId,
      },
    });
  });

  await otpProvider().send({ channel: target.channel, destination, code, purpose: target.purpose, locale: ctx.locale });
  const sentTo = target.channel === 'SMS' ? maskPhone(destination) : maskEmail(destination);
  logger().info({ purpose: target.purpose, channel: target.channel }, 'otp requested');
  return { sentTo, expiresInSeconds: ttl, resendAfterSeconds: cooldown };
}

/**
 * Verifies and consumes. Returns the consumed row's user id (may be null for registration).
 * Throws AUTH_OTP_INVALID (422) for every non-success case except throttling and max attempts.
 */
export async function verifyOtp(target: OtpTarget, code: string, ctx: { ipAddress: string | null }): Promise<{ userId: string | null }> {
  const destination = normaliseIdentifier(target.destination);
  const dh = identifierHash(destination);
  await enforce('AUTH_OTP_THROTTLED', [
    { key: `otp:ver:dh:${dh}`, window: { limit: 10, seconds: 3600 } },
    ...(ctx.ipAddress ? [{ key: `otp:ver:ip:${sha256Hex(ctx.ipAddress)}`, window: { limit: 30, seconds: 3600 } }] : []),
  ]);

  const row = await prisma().otpRequest.findFirst({
    where: { destinationHash: dh, purpose: target.purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const invalid = () => new BusinessRuleError('AUTH_OTP_INVALID', 'The code is invalid');
  if (!row || row.expiresAt < new Date()) throw invalid();

  if (!safeEqualHex(row.codeHash, hashOtp(code))) {
    const attempts = row.attemptCount + 1;
    const burn = attempts >= row.maxAttempts;
    await prisma().otpRequest.update({
      where: { id: row.id },
      data: { attemptCount: attempts, ...(burn ? { consumedAt: new Date() } : {}) },
    });
    if (burn) {
      await writeAudit({ actorUserId: row.userId, actorType: 'ANONYMOUS', action: 'otp.burned', entityType: 'otp_request', entityId: row.id, severity: 'WARNING', ipAddress: ctx.ipAddress });
      throw new RateLimitError(60, 'AUTH_OTP_MAX_ATTEMPTS', 'Too many incorrect codes; request a new one');
    }
    throw invalid();
  }

  // Single use — the WHERE clause is the race guard.
  const consumed = await prisma().otpRequest.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) throw invalid();
  return { userId: row.userId };
}

// ── step-up tokens (security.md §3.6) ────────────────────────────────────────

const STEP_UP_TTL = 300;

export async function issueStepUpToken(userId: string, sessionId: string, actionClass: string): Promise<{ token: string; expiresInSeconds: number }> {
  const token = randomToken(32);
  await cacheSet(`stepup:${userId}:${sessionId}:${actionClass}`, sha256Hex(token), STEP_UP_TTL);
  await writeAudit({ actorUserId: userId, actorType: 'USER', action: 'stepup.granted', entityType: 'session', entityId: sessionId, severity: 'NOTICE', afterValue: { actionClass } });
  return { token, expiresInSeconds: STEP_UP_TTL };
}

/** Single-use: the key is deleted on a successful match. */
export async function consumeStepUpToken(userId: string, sessionId: string, actionClass: string, token: string): Promise<boolean> {
  const key = `stepup:${userId}:${sessionId}:${actionClass}`;
  const stored = await cacheGet(key);
  if (!stored) {
    await writeAudit({ actorUserId: userId, actorType: 'USER', action: 'stepup.failed', entityType: 'session', entityId: sessionId, severity: 'SECURITY', afterValue: { actionClass } });
    return false;
  }
  const ok = safeEqualHex(stored, sha256Hex(token));
  if (ok) await cacheDel(key);
  else await writeAudit({ actorUserId: userId, actorType: 'USER', action: 'stepup.failed', entityType: 'session', entityId: sessionId, severity: 'SECURITY', afterValue: { actionClass } });
  return ok;
}
