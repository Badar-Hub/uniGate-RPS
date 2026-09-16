import type { Envelope, ResponseMeta, ValidationDetails } from '@unigate/types';

/** A failed call, normalised from the error envelope (api.md §2.2) or from a transport failure. */
export interface ApiError {
  /** HTTP status; `0` when the request never reached the server. */
  status: number;
  /** An `ErrorCode` from api.md §4, or `NETWORK` for transport / non-JSON failures. */
  code: string;
  /** The envelope's developer-facing message — never shown verbatim; see `errorMessageKey`. */
  message: string;
  details?: Record<string, unknown> | ValidationDetails;
  requestId?: string;
  /** Seconds to wait before retrying, from `Retry-After` or `details.retryAfterSeconds` (api.md §11). */
  retryAfterSeconds?: number;
}

export type ApiResult<T> =
  { ok: true; data: T; meta: ResponseMeta } | { ok: false; error: ApiError };

/** Codes that mean "the session is gone", not "this request was wrong" (api.md §4.1). */
export const SESSION_ERROR_CODES: readonly string[] = [
  'AUTH_REQUIRED',
  'AUTH_TOKEN_MISSING',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_INVALID_TOKEN',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_REVOKED',
  'AUTH_SESSION_REVOKED',
  'AUTH_REFRESH_EXPIRED',
  'AUTH_REFRESH_REUSE_DETECTED',
  'AUTH_PASSWORD_CHANGED',
];

/** The two codes a transparent refresh can fix. */
export const REFRESHABLE_CODES: readonly string[] = ['AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_MISSING'];

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof value.success === 'boolean'
  );
}

function retryAfterOf(
  headerValue: string | null | undefined,
  details: Record<string, unknown> | undefined,
): number | undefined {
  const fromDetails = details?.['retryAfterSeconds'];
  if (typeof fromDetails === 'number' && Number.isFinite(fromDetails)) return fromDetails;
  if (headerValue) {
    const n = Number(headerValue);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

export interface ParsedResponse {
  status: number;
  statusText?: string;
  /** The decoded JSON body, or `undefined` when the body was empty / not JSON. */
  body: unknown;
  retryAfterHeader?: string | null;
}

/**
 * Turns an HTTP status + decoded body into an `ApiResult` (api.md §2). Pure, so it can be tested
 * without a transport: 204 → ok with no data; a success envelope → its data + meta; an error
 * envelope → `ApiError`; anything else (HTML from a proxy, an empty 502) → `NETWORK`.
 */
export function parseEnvelope<T>(res: ParsedResponse): ApiResult<T> {
  if (res.status === 204) return { ok: true, data: undefined as T, meta: {} };
  if (!isEnvelope(res.body)) {
    return {
      ok: false,
      error: {
        status: res.status,
        code: 'NETWORK',
        message: res.statusText ?? `HTTP ${res.status}`,
      },
    };
  }
  const body = res.body as Envelope<T>;
  if (body.success) return { ok: true, data: body.data, meta: body.meta };
  const err = body.error;
  const details = err.details;
  const retryAfterSeconds = retryAfterOf(
    res.retryAfterHeader,
    details as Record<string, unknown> | undefined,
  );
  return {
    ok: false,
    error: {
      status: res.status,
      code: err.code,
      message: body.message,
      ...(details ? { details } : {}),
      ...(err.requestId ? { requestId: err.requestId } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    },
  };
}

export function networkError(message = 'Network error'): ApiError {
  return { status: 0, code: 'NETWORK', message };
}
