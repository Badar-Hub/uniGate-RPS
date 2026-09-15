import type { ClientType } from '@prisma/client';
import type { AnyScope, AuthResultDto, RegisterResultDto, SessionEchoDto } from '@unigate/types';
import type { loginBody, registerBody } from '@unigate/validation';
import type { z } from 'zod';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  RateLimitError,
  UnauthorizedError,
} from '@/common/errors.js';
import {
  dummyVerify,
  hashPassword,
  identifierHash,
  normaliseIdentifier,
  randomToken,
  sha256Hex,
  verifyPassword,
} from '@/common/crypto.js';
import { newId } from '@/common/ids.js';
import { maskPhone } from '@/common/redact.js';
import { getRequestId } from '@/common/request-context.js';
import { enforce, hit, reset } from '@/common/throttle.js';
import { config } from '@/config/index.js';
import { prisma } from '@/database/prisma.js';
import { logger } from '@/logging/logger.js';
import { publishEvent } from '@/events/outbox.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { signAccessToken } from './jwt.js';
import { requestOtp, verifyOtp } from './otp.service.js';
import { resolveAuthority } from './permission.service.js';
import * as sessions from './session.repository.js';
import * as users from './user.repository.js';

const systemScope = (job: string): AnyScope => ({ kind: 'SYSTEM', jobName: job, requestId: getRequestId() });

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Tokens the controller turns into cookies (web) or a body (mobile). */
export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

// ── registration ─────────────────────────────────────────────────────────────

export async function register(body: z.infer<typeof registerBody>, meta: RequestMeta): Promise<RegisterResultDto> {
  const scope = systemScope('auth.register');
  const phone = normaliseIdentifier(body.phoneE164);
  const email = body.email ? normaliseIdentifier(body.email) : null;
  if (await users.identifierTaken(scope, { email, phoneE164: phone })) {
    throw new ConflictError('AUTH_IDENTIFIER_TAKEN', 'An account with this phone or email already exists');
  }
  await assertPasswordPolicy(body.password, false, [phone, email ?? '']);
  const passwordHash = await hashPassword(body.password);
  const roleCode = body.intent === 'CUSTOMER' ? 'CUSTOMER' : 'VEHICLE_OWNER';
  const role = await prisma().role.findUniqueOrThrow({ where: { code: roleCode }, select: { id: true } });

  const userId = newId();
  await prisma().$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: userId, email, phoneE164: phone, passwordHash, passwordChangedAt: passwordChangeStamp(),
        fullNameEn: body.fullNameEn, fullNameAr: body.fullNameAr ?? null, status: 'PENDING_VERIFICATION', preferredLocale: body.preferredLocale,
      },
    });
    await tx.userRole.create({ data: { userId, roleId: role.id } });
    if (body.intent === 'CUSTOMER') {
      await tx.customerProfile.create({ data: { id: newId(), userId, customerType: 'INDIVIDUAL' } });
    } else {
      await tx.ownerProfile.create({ data: { id: newId(), userId, ownerType: 'INDIVIDUAL', onboardingStatus: 'DRAFT' } });
    }
    await writeAudit({ actorUserId: userId, actorType: 'USER', action: 'user.registered', entityType: 'user', entityId: userId, afterValue: { intent: body.intent, acceptedTermsVersion: body.acceptedTermsVersion }, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, tx);
  });

  const otp = await requestOtp({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION' }, { ipAddress: meta.ipAddress, userId, locale: body.preferredLocale });
  return { userId, status: 'PENDING_VERIFICATION', otpSentTo: otp.sentTo };
}

/** Completes registration: verifies the phone OTP, activates the account, opens a session. */
export async function completeRegistration(input: { phoneE164: string; code: string; clientType: ClientType; deviceId?: string; deviceName?: string }, meta: RequestMeta) {
  const phone = normaliseIdentifier(input.phoneE164);
  await verifyOtp({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION' }, input.code, { ipAddress: meta.ipAddress });
  const user = await prisma().user.findFirst({ where: { phoneE164: phone, deletedAt: null }, select: { id: true, status: true } });
  if (!user) throw new BusinessRuleError('AUTH_OTP_INVALID', 'The code is invalid');
  await prisma().user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date(), ...(user.status === 'PENDING_VERIFICATION' ? { status: 'ACTIVE' } : {}) } });
  return openSession(user.id, input.clientType, { deviceId: input.deviceId ?? null, deviceName: input.deviceName ?? null }, meta, 'REGISTRATION');
}

// ── login ────────────────────────────────────────────────────────────────────

export async function login(body: z.infer<typeof loginBody>, meta: RequestMeta) {
  const scope = systemScope('auth.login');
  const identifier = normaliseIdentifier(body.identifier);
  const idh = identifierHash(identifier);
  const iph = meta.ipAddress ? sha256Hex(meta.ipAddress) : 'noip';

  // Progressive delay before the Argon2 verify (security.md §3.3); throttles on the pair.
  await enforce('RATE_LIMITED', [
    { key: `login:fail:ip:${iph}`, window: { limit: 20, seconds: 900 } },
    { key: `login:fail:id_ip:${idh}:${iph}`, window: { limit: 5, seconds: 900 } },
  ]);
  const idFailures = await hit(`login:fail:id:${idh}`, { limit: 12, seconds: 900 });
  if (idFailures.exceeded) {
    await recordAttempt(identifier, idh, meta, false, 'SOFT_LOCK');
    throw new RateLimitError(900, 'AUTH_ACCOUNT_LOCKED', 'Too many failed attempts; try again later');
  }
  await delayFor(idFailures.count);

  const user = await users.findUserForLogin(scope, identifier);
  if (!user?.passwordHash) {
    await dummyVerify(body.password);
    await recordAttempt(identifier, idh, meta, false, 'UNKNOWN_OR_NO_PASSWORD');
    throw new UnauthorizedError('AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
  }
  const { ok, needsRehash } = await verifyPassword(user.passwordHash, body.password);
  if (!ok) {
    await recordAttempt(identifier, idh, meta, false, 'BAD_PASSWORD');
    throw new UnauthorizedError('AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
  }
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    await recordAttempt(identifier, idh, meta, false, 'SUSPENDED');
    throw new ForbiddenError('AUTH_ACCOUNT_SUSPENDED', 'Account is suspended');
  }
  if (user.status === 'PENDING_VERIFICATION') {
    await recordAttempt(identifier, idh, meta, false, 'PENDING_VERIFICATION');
    throw new ForbiddenError('AUTH_PHONE_NOT_VERIFIED', 'Verify your phone number to continue');
  }
  if (needsRehash) {
    await prisma().user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.password) } });
  }
  // A successful login clears the per-identifier counter but not the per-IP one.
  await reset(`login:fail:id:${idh}`);
  await reset(`login:fail:id_ip:${idh}:${iph}`);
  await recordAttempt(identifier, idh, meta, true, null);
  return openSession(user.id, body.clientType, { deviceId: body.deviceId ?? null, deviceName: body.deviceName ?? null }, meta, 'PASSWORD');
}

/** OTP login: verified code for purpose LOGIN opens a session. */
export async function loginWithOtp(input: { channel: 'SMS' | 'EMAIL'; destination: string; code: string; clientType: ClientType; deviceId?: string; deviceName?: string }, meta: RequestMeta) {
  const destination = normaliseIdentifier(input.destination);
  await verifyOtp({ channel: input.channel, destination, purpose: 'LOGIN' }, input.code, { ipAddress: meta.ipAddress });
  const user = await users.findUserForLogin(systemScope('auth.otp-login'), destination);
  if (!user) throw new BusinessRuleError('AUTH_OTP_INVALID', 'The code is invalid');
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') throw new ForbiddenError('AUTH_ACCOUNT_SUSPENDED', 'Account is suspended');
  if (user.status === 'PENDING_VERIFICATION') {
    await prisma().user.update({ where: { id: user.id }, data: { status: 'ACTIVE', ...(input.channel === 'SMS' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() }) } });
  }
  return openSession(user.id, input.clientType, { deviceId: input.deviceId ?? null, deviceName: input.deviceName ?? null }, meta, 'OTP');
}

async function delayFor(failures: number): Promise<void> {
  const ms = failures >= 8 ? 30_000 : failures >= 5 ? 5_000 : failures >= 3 ? 1_000 : 0;
  if (ms && !config().isTest) await new Promise((r) => setTimeout(r, ms));
}

async function recordAttempt(identifier: string, idh: string, meta: RequestMeta, succeeded: boolean, failureReason: string | null): Promise<void> {
  await prisma().loginAttempt.create({
    data: { id: newId(), identifier, identifierHash: idh, ipAddress: meta.ipAddress, userAgent: meta.userAgent, succeeded, failureReason },
  });
}

// ── sessions & tokens ────────────────────────────────────────────────────────

async function openSession(
  userId: string,
  clientType: ClientType,
  device: { deviceId: string | null; deviceName: string | null },
  meta: RequestMeta,
  method: string,
): Promise<{ result: AuthResultDto; tokens: IssuedTokens }> {
  const scope = systemScope('auth.open-session');
  const cap = await getSettingValue<number>('platform.max_sessions_per_user', 10);
  const authority = await resolveAuthority(userId);
  const familyId = newId();
  const refreshToken = randomToken(32);
  const refreshExpires = new Date(Date.now() + config().auth.refreshTokenTtlSeconds * 1000);

  const session = await prisma().$transaction(async (tx) => {
    const s = await sessions.createSession(scope, { userId, clientType, deviceId: device.deviceId, deviceName: device.deviceName, userAgent: meta.userAgent, ipAddress: meta.ipAddress }, tx);
    await sessions.issueRefreshToken(scope, { sessionId: s.id, familyId, tokenHash: sha256Hex(refreshToken), expiresAt: refreshExpires }, tx);
    await sessions.enforceSessionCap(scope, userId, cap, tx);
    await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await writeAudit({ actorUserId: userId, actorType: 'USER', action: 'session.opened', entityType: 'session', entityId: s.id, afterValue: { method, clientType, deviceName: device.deviceName }, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, tx);
    return s;
  });

  const access = await signAccessToken({ sub: userId, sid: session.id, roles: authority.roles, pv: authority.permissionVersion }, { minIssuedAt: await passwordEpoch(userId) });
  await publishEvent('user', userId, 'auth.session_opened', { sessionId: session.id, clientType, deviceId: device.deviceId, ipAddress: meta.ipAddress });

  return {
    result: { userId, sessionId: session.id, clientType, roles: authority.roles, tokens: null },
    tokens: { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken, refreshTokenExpiresAt: refreshExpires },
  };
}

/**
 * Refresh rotation with reuse detection (api.md §6.3). Runs in one transaction with
 * FOR UPDATE on the token row, so two concurrent refreshes cannot both succeed.
 */
export async function refresh(presented: string, expectedClientMode: 'WEB' | 'MOBILE', meta: RequestMeta): Promise<{ result: AuthResultDto; tokens: IssuedTokens }> {
  const scope = systemScope('auth.refresh');
  const tokenHash = sha256Hex(presented);
  const newToken = randomToken(32);
  const newExpires = new Date(Date.now() + config().auth.refreshTokenTtlSeconds * 1000);

  const outcome = await prisma().$transaction(async (tx) => {
    const row = await sessions.findRefreshTokenForUpdate(scope, tokenHash, tx);
    if (!row) throw new UnauthorizedError('AUTH_TOKEN_INVALID', 'Refresh token is invalid');
    const session = await tx.session.findUnique({ where: { id: row.session_id }, select: { id: true, userId: true, clientType: true, revokedAt: true } });
    if (!session || session.revokedAt || row.revoked_at) throw new UnauthorizedError('AUTH_SESSION_REVOKED', 'Session has been revoked');
    if (row.expires_at < new Date()) throw new UnauthorizedError('AUTH_REFRESH_EXPIRED', 'Refresh token has expired');
    const sessionMode = session.clientType === 'WEB' ? 'WEB' : 'MOBILE';
    if (sessionMode !== expectedClientMode) throw new UnauthorizedError('AUTH_TOKEN_INVALID', 'Credential transport does not match the session');

    if (row.used_at) {
      // ── replay detected: kill the family and the session, record it, tell the user ──
      await sessions.revokeFamily(scope, row.family_id, tx);
      await sessions.revokeSession(scope, session.id, 'REFRESH_REUSE', tx);
      await writeAudit({ actorUserId: session.userId, actorType: 'USER', action: 'auth.refresh_reuse_detected', entityType: 'session', entityId: session.id, severity: 'SECURITY', afterValue: { familyId: row.family_id }, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, tx);
      await publishEvent('user', session.userId, 'security.refresh_reuse', { sessionId: session.id, familyId: row.family_id, ipAddress: meta.ipAddress }, tx);
      return { reuse: true as const, familyId: row.family_id, sessionId: session.id };
    }

    await sessions.issueRefreshToken(scope, { sessionId: session.id, familyId: row.family_id, tokenHash: sha256Hex(newToken), expiresAt: newExpires, replacesId: row.id }, tx);
    await sessions.touchSession(scope, session.id, tx);
    return { reuse: false as const, userId: session.userId, sessionId: session.id, clientType: session.clientType };
  });

  if (outcome.reuse) {
    logger().warn({ sessionId: outcome.sessionId }, 'refresh token replay detected; family revoked');
    throw new UnauthorizedError('AUTH_REFRESH_REUSE_DETECTED', `Refresh token replay detected; token family and session ${outcome.sessionId} revoked`);
  }
  const authority = await resolveAuthority(outcome.userId);
  const access = await signAccessToken({ sub: outcome.userId, sid: outcome.sessionId, roles: authority.roles, pv: authority.permissionVersion }, { minIssuedAt: await passwordEpoch(outcome.userId) });
  return {
    result: { userId: outcome.userId, sessionId: outcome.sessionId, clientType: outcome.clientType, roles: authority.roles, tokens: null },
    tokens: { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken: newToken, refreshTokenExpiresAt: newExpires },
  };
}

export async function logout(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
  const scope = systemScope('auth.logout');
  await sessions.revokeSession(scope, sessionId, 'LOGOUT');
  await writeAudit({ actorUserId: userId, actorType: 'USER', action: 'session.closed', entityType: 'session', entityId: sessionId, ipAddress: meta.ipAddress });
}

export async function logoutAll(userId: string, meta: RequestMeta): Promise<number> {
  const scope = systemScope('auth.logout-all');
  const n = await sessions.revokeAllSessions(scope, userId, 'LOGOUT_ALL');
  await writeAudit({ actorUserId: userId, actorType: 'USER', action: 'session.closed_all', entityType: 'user', entityId: userId, severity: 'NOTICE', afterValue: { revoked: n }, ipAddress: meta.ipAddress });
  return n;
}

export async function sessionEcho(actor: { userId: string; sessionId: string | null; roles: readonly string[] }, exp: number): Promise<SessionEchoDto> {
  const s = actor.sessionId ? await prisma().session.findUnique({ where: { id: actor.sessionId }, select: { clientType: true } }) : null;
  return { userId: actor.userId, sessionId: actor.sessionId ?? '', roles: [...actor.roles], clientType: s?.clientType ?? 'WEB', expiresAt: new Date(exp * 1000).toISOString() };
}

// ── passwords ────────────────────────────────────────────────────────────────

const COMMON_PASSWORDS = new Set(['password', 'password1', 'passw0rd', '123456789012', 'qwertyuiop12', 'unigate2026', 'abcdefghijkl']);

export async function assertPasswordPolicy(raw: string, staff: boolean, context: string[]): Promise<void> {
  const min = staff ? 12 : 10;
  const norm = raw.normalize('NFKC');
  const fail = (m: string) => new BusinessRuleError('AUTH_PASSWORD_POLICY', m);
  if (norm.length < min) throw fail(`Password must be at least ${min} characters`);
  if (norm.length > 128) throw fail('Password must be at most 128 characters');
  const lower = norm.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(\d)\1+$/.test(lower) || /^(0123456789|1234567890)/.test(lower)) throw fail('Password is too common');
  if (lower.includes('unigate')) throw fail('Password must not contain the platform name');
  for (const c of context) {
    const local = c.split('@')[0]?.toLowerCase() ?? '';
    if (local.length >= 4 && lower.includes(local)) throw fail('Password must not contain your email or phone');
    const digits = c.replace(/\D/g, '');
    if (digits.length >= 6 && lower.includes(digits.slice(-6))) throw fail('Password must not contain your phone number');
  }
  await Promise.resolve();
}

export async function forgotPassword(identifierRaw: string, meta: RequestMeta): Promise<void> {
  // Always 200 (api.md §4.6). Throttled per identifier so it cannot be used as a spam vector.
  const identifier = normaliseIdentifier(identifierRaw);
  const idh = identifierHash(identifier);
  await enforce('RATE_LIMITED', [{ key: `pwreset:${idh}`, window: { limit: 3, seconds: 3600 } }]);
  const user = await users.findUserForLogin(systemScope('auth.forgot'), identifier);
  if (!user || user.status === 'DEACTIVATED') return;
  const token = randomToken(32);
  await prisma().passwordResetToken.create({ data: { id: newId(), userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 30 * 60_000) } });
  await publishEvent('user', user.id, 'auth.password_reset_requested', { token, locale: user.preferredLocale, ipAddress: meta.ipAddress });
  logger().info('password reset requested');
}

export async function resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const row = await prisma().passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: { select: { id: true, email: true, phoneE164: true, userRoles: { select: { role: { select: { code: true } } } } } } } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new BusinessRuleError('AUTH_PASSWORD_RESET_INVALID', 'Reset link is invalid or has expired');
  const staff = row.user.userRoles.some((r) => !['CUSTOMER', 'VEHICLE_OWNER', 'DRIVER'].includes(r.role.code));
  await assertPasswordPolicy(newPassword, staff, [row.user.email ?? '', row.user.phoneE164 ?? '']);
  const passwordHash = await hashPassword(newPassword);
  await prisma().$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count !== 1) throw new BusinessRuleError('AUTH_PASSWORD_RESET_INVALID', 'Reset link is invalid or has expired');
    await tx.user.update({ where: { id: row.user.id }, data: { passwordHash, passwordChangedAt: passwordChangeStamp() } });
    await writeAudit({ actorUserId: row.user.id, actorType: 'USER', action: 'password.reset', entityType: 'user', entityId: row.user.id, severity: 'SECURITY', ipAddress: meta.ipAddress, userAgent: meta.userAgent }, tx);
  });
  await sessions.revokeAllSessions(systemScope('auth.reset'), row.user.id, 'PASSWORD_RESET');
}

/**
 * Password-change timestamps are rounded UP to the next whole second so that every access token
 * issued in the change's own second (iat has second granularity) is unambiguously "before" it.
 */
function passwordChangeStamp(): Date {
  return new Date((Math.floor(Date.now() / 1000) + 1) * 1000);
}

/** The iat floor for new tokens: see passwordChangeStamp(). */
async function passwordEpoch(userId: string): Promise<number> {
  const u = await prisma().user.findUnique({ where: { id: userId }, select: { passwordChangedAt: true } });
  return u?.passwordChangedAt ? Math.floor(u.passwordChangedAt.getTime() / 1000) : 0;
}

export async function changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<{ accessToken: string; accessTokenExpiresAt: Date }> {
  const user = await prisma().user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, email: true, phoneE164: true, userRoles: { select: { role: { select: { code: true } } } } } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword)).ok) {
    throw new UnauthorizedError('AUTH_INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  const staff = user.userRoles.some((r) => !['CUSTOMER', 'VEHICLE_OWNER', 'DRIVER'].includes(r.role.code));
  await assertPasswordPolicy(newPassword, staff, [user.email ?? '', user.phoneE164 ?? '']);
  await prisma().user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: passwordChangeStamp() } });
  // Revokes every OTHER session; the current one keeps working (api.md §8.1).
  await sessions.revokeAllSessions(systemScope('auth.change-password'), userId, 'PASSWORD_CHANGED', sessionId);
  await writeAudit({ actorUserId: userId, actorType: 'USER', action: 'password.changed', entityType: 'user', entityId: userId, severity: 'SECURITY', ipAddress: meta.ipAddress, userAgent: meta.userAgent });
  await publishEvent('user', userId, 'auth.password_changed', { ipAddress: meta.ipAddress });
  // The current session survives, but its access token predates password_changed_at and the
  // global-invalidation rule would reject it — so hand back a fresh one for this session.
  const authority = await resolveAuthority(userId);
  const access = await signAccessToken({ sub: userId, sid: sessionId, roles: authority.roles, pv: authority.permissionVersion }, { minIssuedAt: await passwordEpoch(userId) });
  return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt };
}

export function maskedPhone(phone: string | null): string | null {
  return phone ? maskPhone(phone) : null;
}

export async function verifiedPhoneOf(userId: string): Promise<string | null> {
  const u = await prisma().user.findUnique({ where: { id: userId }, select: { phoneE164: true, phoneVerifiedAt: true } });
  return u?.phoneVerifiedAt && u.phoneE164 ? u.phoneE164 : null;
}

/** Binds a freshly verified phone to the user (PHONE_VERIFICATION purpose). */
export async function markPhoneVerified(userId: string, phoneRaw: string): Promise<void> {
  const phone = normaliseIdentifier(phoneRaw);
  if (await users.identifierTaken(systemScope('auth.phone-verify'), { phoneE164: phone })) {
    const current = await prisma().user.findUnique({ where: { id: userId }, select: { phoneE164: true } });
    if (current?.phoneE164 !== phone) throw new ConflictError('AUTH_IDENTIFIER_TAKEN', 'This phone number belongs to another account');
  }
  await prisma().user.update({ where: { id: userId }, data: { phoneE164: phone, phoneVerifiedAt: new Date() } });
  await writeAudit({ actorUserId: userId, actorType: 'USER', action: 'phone.verified', entityType: 'user', entityId: userId, severity: 'NOTICE' });
}
