import type { Request, Response } from 'express';
import type { z } from 'zod';
import type {
  loginBody,
  otpRequestBody,
  otpVerifyBody,
  passwordChangeBody,
  passwordForgotBody,
  passwordResetBody,
  refreshBody,
  registerBody,
  stepUpRequestBody,
  stepUpVerifyBody,
} from '@unigate/validation';
import type { AuthResultDto } from '@unigate/types';
import { sendCreated, sendNoContent, sendOk } from '@/common/envelope.js';
import { BusinessRuleError, UnauthorizedError } from '@/common/errors.js';
import { config } from '@/config/index.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOf, type AuthenticatedRequest } from '@/middleware/authenticate.js';
import type { ValidatedRequest } from '@/middleware/validate.js';
import * as auth from './auth.service.js';
import * as otp from './otp.service.js';

/** Request metadata every auth call records. */
function meta(req: Request): auth.RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

/**
 * Dual-mode token return (api.md §6.2): WEB sessions get httpOnly cookies and `tokens: null`;
 * mobile sessions get the tokens in the body and no cookies.
 */
function deliver(res: Response, out: { result: AuthResultDto; tokens: auth.IssuedTokens }, status = 200): void {
  const cfg = config();
  if (out.result.clientType === 'WEB') {
    const base = { httpOnly: true, secure: !cfg.isDevelopment, sameSite: 'lax' as const };
    res.cookie(ACCESS_COOKIE, out.tokens.accessToken, { ...base, path: '/api/v1', expires: out.tokens.accessTokenExpiresAt });
    res.cookie(REFRESH_COOKIE, out.tokens.refreshToken, { ...base, path: '/api/v1/auth', expires: out.tokens.refreshTokenExpiresAt });
    sendOk(res, { ...out.result, tokens: null }, undefined, status);
    return;
  }
  const t = out.tokens;
  sendOk(
    res,
    {
      ...out.result,
      tokens: {
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        accessTokenExpiresAt: t.accessTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: t.refreshTokenExpiresAt.toISOString(),
      },
    },
    undefined,
    status,
  );
}

function clearCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/api/v1' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}

export async function register(req: Request, res: Response): Promise<void> {
  const { body } = (req as ValidatedRequest<z.infer<typeof registerBody>>).validated;
  sendCreated(res, await auth.register(body, meta(req)));
}

export async function login(req: Request, res: Response): Promise<void> {
  const { body } = (req as ValidatedRequest<z.infer<typeof loginBody>>).validated;
  deliver(res, await auth.login(body, meta(req)));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { body } = (req as ValidatedRequest<z.infer<typeof refreshBody>>).validated;
  const fromCookie = cookieOf(req, REFRESH_COOKIE);
  const presented = body.refreshToken ?? fromCookie;
  if (!presented) throw new UnauthorizedError('AUTH_TOKEN_MISSING', 'No refresh token presented');
  const mode = body.refreshToken ? 'MOBILE' : 'WEB';
  try {
    deliver(res, await auth.refresh(presented, mode, meta(req)));
  } catch (e) {
    // Reuse detection and revocation clear the browser's cookies (api.md §6.3).
    if (mode === 'WEB') clearCookies(res);
    throw e;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest;
  await auth.logout(r.actor.userId, r.actor.sessionId ?? '', meta(req));
  if (r.credentialMode === 'cookie') clearCookies(res);
  sendNoContent(res);
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest;
  const revoked = await auth.logoutAll(r.actor.userId, meta(req));
  if (r.credentialMode === 'cookie') clearCookies(res);
  sendOk(res, { revokedSessions: revoked });
}

export async function session(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest;
  sendOk(res, await auth.sessionEcho(r.actor, r.claims.exp));
}

export async function otpRequest(req: Request, res: Response): Promise<void> {
  const { body } = (req as ValidatedRequest<z.infer<typeof otpRequestBody>>).validated;
  const actor = (req as Partial<AuthenticatedRequest>).actor;
  if (body.purpose === 'SENSITIVE_ACTION') {
    throw new BusinessRuleError('VALIDATION_FAILED', 'Use POST /auth/step-up for sensitive-action codes');
  }
  const locale = actor?.locale ?? (req.header('accept-language')?.startsWith('en') ? 'en' : 'ar');
  sendOk(res, await otp.requestOtp(body, { ipAddress: req.ip ?? null, userId: actor?.userId ?? null, locale }));
}

/**
 * POST /auth/otp/verify — purpose decides the effect: REGISTRATION completes sign-up and opens
 * a session; LOGIN opens a session; PHONE_VERIFICATION / PASSWORD_RESET verify only.
 */
export async function otpVerify(req: Request, res: Response): Promise<void> {
  const { body } = (req as ValidatedRequest<z.infer<typeof otpVerifyBody>>).validated;
  const m = meta(req);
  switch (body.purpose) {
    case 'REGISTRATION':
      deliver(res, await auth.completeRegistration({ phoneE164: body.destination, code: body.code, clientType: body.clientType ?? 'WEB', ...(body.deviceId ? { deviceId: body.deviceId } : {}), ...(body.deviceName ? { deviceName: body.deviceName } : {}) }, m));
      return;
    case 'LOGIN':
      deliver(res, await auth.loginWithOtp({ channel: body.channel, destination: body.destination, code: body.code, clientType: body.clientType ?? 'WEB', ...(body.deviceId ? { deviceId: body.deviceId } : {}), ...(body.deviceName ? { deviceName: body.deviceName } : {}) }, m));
      return;
    case 'PHONE_VERIFICATION': {
      const actor = (req as Partial<AuthenticatedRequest>).actor;
      if (!actor) throw new UnauthorizedError('AUTH_TOKEN_MISSING', 'Sign in to verify a phone number');
      await otp.verifyOtp({ channel: 'SMS', destination: body.destination, purpose: 'PHONE_VERIFICATION' }, body.code, { ipAddress: m.ipAddress });
      await auth.markPhoneVerified(actor.userId, body.destination);
      sendOk(res, { verified: true });
      return;
    }
    case 'PASSWORD_RESET':
    case 'SENSITIVE_ACTION':
      throw new BusinessRuleError('VALIDATION_FAILED', `Purpose ${body.purpose} is not verified through this endpoint`);
  }
}

/** POST /auth/step-up — sends a SENSITIVE_ACTION code to the user's already-verified phone. */
export async function stepUpRequest(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest & ValidatedRequest<z.infer<typeof stepUpRequestBody>>;
  const phone = await auth.verifiedPhoneOf(r.actor.userId);
  if (!phone) throw new BusinessRuleError('AUTH_PHONE_NOT_VERIFIED', 'A verified phone number is required for step-up');
  const out = await otp.requestOtp({ channel: 'SMS', destination: phone, purpose: 'SENSITIVE_ACTION' }, { ipAddress: req.ip ?? null, userId: r.actor.userId, locale: r.actor.locale });
  sendOk(res, { ...out, actionClass: r.validated.body.actionClass });
}

/** POST /auth/step-up/verify — returns the single-use, 5-minute step-up token. */
export async function stepUpVerify(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest & ValidatedRequest<z.infer<typeof stepUpVerifyBody>>;
  const phone = await auth.verifiedPhoneOf(r.actor.userId);
  if (!phone) throw new BusinessRuleError('AUTH_PHONE_NOT_VERIFIED', 'A verified phone number is required for step-up');
  await otp.verifyOtp({ channel: 'SMS', destination: phone, purpose: 'SENSITIVE_ACTION' }, r.validated.body.code, { ipAddress: req.ip ?? null });
  const issued = await otp.issueStepUpToken(r.actor.userId, r.actor.sessionId ?? '', r.validated.body.actionClass);
  sendOk(res, { stepUpToken: issued.token, actionClass: r.validated.body.actionClass, expiresInSeconds: issued.expiresInSeconds });
}

export async function passwordForgot(req: Request, res: Response): Promise<void> {
  const { body } = (req as ValidatedRequest<z.infer<typeof passwordForgotBody>>).validated;
  await auth.forgotPassword(body.identifier, meta(req));
  sendOk(res, { accepted: true }); // always 200 (api.md §4.6)
}

export async function passwordReset(req: Request, res: Response): Promise<void> {
  const { body } = (req as ValidatedRequest<z.infer<typeof passwordResetBody>>).validated;
  await auth.resetPassword(body.token, body.newPassword, meta(req));
  sendOk(res, { reset: true });
}

export async function passwordChange(req: Request, res: Response): Promise<void> {
  const r = req as AuthenticatedRequest & ValidatedRequest<z.infer<typeof passwordChangeBody>>;
  const fresh = await auth.changePassword(r.actor.userId, r.actor.sessionId ?? '', r.validated.body.currentPassword, r.validated.body.newPassword, meta(req));
  if (r.credentialMode === 'cookie') {
    res.cookie(ACCESS_COOKIE, fresh.accessToken, { httpOnly: true, secure: !config().isDevelopment, sameSite: 'lax', path: '/api/v1', expires: fresh.accessTokenExpiresAt });
    sendOk(res, { changed: true, accessToken: null });
    return;
  }
  sendOk(res, { changed: true, accessToken: fresh.accessToken, accessTokenExpiresAt: fresh.accessTokenExpiresAt.toISOString() });
}
