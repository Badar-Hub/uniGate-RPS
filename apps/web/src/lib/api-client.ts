import type { Envelope, ValidationDetails } from '@unigate/types';
import { apiUrl } from '@/lib/api';

/**
 * Browser client for the API in cookie mode (api.md §6.2/§6.4): credentials always included,
 * the CSRF header on every call, and one transparent refresh when the access cookie expired.
 * Tokens never touch JavaScript — the API sets httpOnly cookies.
 */
export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown> | ValidationDetails;
}

export type ApiResult<T> = { ok: true; data: T; meta: Record<string, unknown> } | { ok: false; error: ApiError };

const CSRF = { 'X-Requested-With': 'unigate-web' } as const;

async function parse<T>(res: Response): Promise<ApiResult<T>> {
  if (res.status === 204) return { ok: true, data: undefined as T, meta: {} };
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    return { ok: false, error: { status: res.status, code: 'NETWORK', message: res.statusText } };
  }
  if (body.success) return { ok: true, data: body.data, meta: body.meta as Record<string, unknown> };
  const err = body.error;
  return { ok: false, error: { status: res.status, code: err.code, message: body.message, ...(err.details ? { details: err.details } : {}) } };
}

let refreshing: Promise<boolean> | null = null;

/** POST /auth/refresh with the ug_rt cookie; concurrent callers share one refresh. */
export async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(apiUrl('/auth/refresh'), { method: 'POST', credentials: 'include', headers: { ...CSRF, 'Content-Type': 'application/json' }, body: '{}' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  /** Set false for auth endpoints where a 401 is the answer, not a signal to refresh. */
  retryOnExpired?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const qs = opts.query
    ? '?' +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: { ...CSRF, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  let res: Response;
  try {
    res = await fetch(apiUrl(path) + qs, init);
  } catch {
    return { ok: false, error: { status: 0, code: 'NETWORK', message: 'Network error' } };
  }
  if (res.status === 401 && opts.retryOnExpired !== false) {
    const first = await parse<T>(res.clone());
    if (!first.ok && (first.error.code === 'AUTH_TOKEN_EXPIRED' || first.error.code === 'AUTH_TOKEN_MISSING') && (await refreshSession())) {
      try {
        res = await fetch(apiUrl(path) + qs, init);
      } catch {
        return { ok: false, error: { status: 0, code: 'NETWORK', message: 'Network error' } };
      }
    }
  }
  return parse<T>(res);
}

/**
 * A unique key per mutating request (api.md §7). `crypto.randomUUID` exists only in secure
 * contexts (HTTPS or localhost); testers on a LAN address over plain HTTP get the RFC 4122 v4
 * fallback built from `getRandomValues`, which is always available.
 */
export function idempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
