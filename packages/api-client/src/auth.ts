import type {
  AuthResultDto,
  ClientType,
  MeDto,
  OtpChannel,
  OtpPurpose,
  OtpRequestResultDto,
  TokenPairDto,
} from '@unigate/types';
import type { ApiClient } from './client.js';
import type { ApiResult } from './envelope.js';

/**
 * Typed wrappers over the auth endpoints (api.md §8.1). Request shapes mirror
 * `@unigate/validation` (`loginBody`, `otpRequestBody`, `otpVerifyBody`, `refreshBody`) —
 * kept as plain interfaces here so this package stays free of zod.
 */

export interface DeviceInfo {
  /** Stable per install, 8–128 chars (a UUID). Lets `GET /me/sessions` show one row per device. */
  deviceId?: string;
  /** Display only, ≤160 chars. */
  deviceName?: string;
}

export interface LoginBody extends DeviceInfo {
  /** Email or E.164 phone — the server detects which. */
  identifier: string;
  password: string;
  clientType: ClientType;
}

export interface OtpRequestBody {
  channel: OtpChannel;
  destination: string;
  purpose: OtpPurpose;
}

export interface OtpVerifyBody extends OtpRequestBody, DeviceInfo {
  /** 4–8 digits. */
  code: string;
  clientType?: ClientType;
}

/** The mobile-mode success shape: `tokens` is never null when `clientType` is IOS/ANDROID. */
export type MobileAuthResult = AuthResultDto & { tokens: TokenPairDto };

function withTokens(result: ApiResult<AuthResultDto>): ApiResult<MobileAuthResult> {
  if (!result.ok) return result;
  if (!result.data.tokens) {
    return {
      ok: false,
      error: {
        status: 200,
        code: 'AUTH_TOKENS_MISSING',
        message: 'The API answered in cookie mode; mobile clients need tokens in the body',
      },
    };
  }
  return { ok: true, data: { ...result.data, tokens: result.data.tokens }, meta: result.meta };
}

export async function login(
  client: ApiClient,
  body: LoginBody,
): Promise<ApiResult<MobileAuthResult>> {
  return withTokens(
    await client.api<AuthResultDto>('/auth/login', { method: 'POST', body, retryOnExpired: false }),
  );
}

export function requestOtp(
  client: ApiClient,
  body: OtpRequestBody,
): Promise<ApiResult<OtpRequestResultDto>> {
  return client.api<OtpRequestResultDto>('/auth/otp/request', {
    method: 'POST',
    body,
    retryOnExpired: false,
  });
}

/** `purpose: 'LOGIN'` (and `REGISTRATION`) open a session; other purposes verify only and do not return tokens. */
export async function verifyOtpLogin(
  client: ApiClient,
  body: OtpVerifyBody & { purpose: 'LOGIN' | 'REGISTRATION' },
): Promise<ApiResult<MobileAuthResult>> {
  return withTokens(
    await client.api<AuthResultDto>('/auth/otp/verify', {
      method: 'POST',
      body,
      retryOnExpired: false,
    }),
  );
}

/** Mobile-mode refresh: the refresh token goes in the body (api.md §6.2); the pair rotates. */
export async function refresh(
  client: ApiClient,
  refreshToken: string,
): Promise<ApiResult<MobileAuthResult>> {
  return withTokens(
    await client.api<AuthResultDto>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      retryOnExpired: false,
    }),
  );
}

/** Revokes the current session and its token family; 204. */
export function logout(client: ApiClient): Promise<ApiResult<undefined>> {
  return client.api<undefined>('/auth/logout', { method: 'POST', body: {}, retryOnExpired: false });
}

export function me(client: ApiClient): Promise<ApiResult<MeDto>> {
  return client.api<MeDto>('/me');
}
