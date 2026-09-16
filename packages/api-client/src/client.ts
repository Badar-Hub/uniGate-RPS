import type { ClientType } from '@unigate/types';
import {
  networkError,
  parseEnvelope,
  REFRESHABLE_CODES,
  SESSION_ERROR_CODES,
  type ApiError,
  type ApiResult,
} from './envelope.js';

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Query;
  /** Set false for auth endpoints where a 401 is the answer, not a signal to refresh or sign out. */
  retryOnExpired?: boolean;
  signal?: AbortSignal;
}

/** The transport the client needs — `fetch` in React Native, browsers and Node all satisfy it. */
export interface FetchResponseLike {
  status: number;
  statusText?: string;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}
export interface FetchRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export type FetchLike = (url: string, init: FetchRequestInit) => Promise<FetchResponseLike>;

export type MaybePromise<T> = T | Promise<T>;

export interface ApiClientOptions {
  /** e.g. `http://172.23.65.81:4000/api/v1` — a trailing slash is tolerated. */
  baseUrl: string;
  /** Sent as `X-Client-Type`; mobile clients send `IOS` | `ANDROID` and carry tokens in headers (api.md §6.2). */
  clientType: ClientType;
  /** The in-memory access token, or null when signed out. Read on every request so a refresh is picked up. */
  getAccessToken: () => MaybePromise<string | null | undefined>;
  /**
   * Exchange the stored refresh token for a new pair (`POST /auth/refresh`), store it, and resolve
   * true. Resolve false when there is nothing to refresh or the API refused. Concurrent callers
   * share one in-flight refresh. Omit to disable transparent refresh.
   */
  refreshSession?: () => Promise<boolean>;
  /** Called once a request has definitively lost its session (after refresh was tried). The app signs out here. */
  onUnauthorized?: (error: ApiError) => MaybePromise<void>;
  /** Static extra headers (e.g. `Accept-Language`), or a function evaluated per request. */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Defaults to `globalThis.fetch`. Injected in tests. */
  fetch?: FetchLike;
}

export interface ApiClient {
  api: <T>(path: string, opts?: RequestOptions) => Promise<ApiResult<T>>;
  /** Absolute URL for `path` (used for uploads and links that bypass `api`). */
  url: (path: string, query?: Query) => string;
}

/** `?a=1&b=x` — undefined, null and empty strings are dropped (api.md §5). */
export function buildQuery(query: Query | undefined): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== 'function')
    throw new Error('No fetch implementation available; pass one to createApiClient()');
  return f as FetchLike;
}

async function decode<T>(res: FetchResponseLike): Promise<ApiResult<T>> {
  let body: unknown;
  if (res.status !== 204) {
    try {
      const text = await res.text();
      body = text.length ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      body = undefined;
    }
  }
  return parseEnvelope<T>({
    status: res.status,
    ...(res.statusText !== undefined ? { statusText: res.statusText } : {}),
    body,
    retryAfterHeader: res.headers?.get('retry-after') ?? null,
  });
}

/**
 * Bearer-token client for the API (api.md §6.2 mobile mode): `Authorization: Bearer <access>`
 * and `X-Client-Type` on every call, the envelope decoded into a discriminated result, and one
 * transparent refresh when the access token expired. Tokens live wherever the host app keeps
 * them — this package only reads the access token through `getAccessToken`.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? defaultFetch();
  let refreshing: Promise<boolean> | null = null;

  const refreshOnce = (): Promise<boolean> => {
    if (!options.refreshSession) return Promise.resolve(false);
    refreshing ??= options
      .refreshSession()
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  const url = (path: string, query?: Query): string =>
    joinUrl(options.baseUrl, path) + buildQuery(query);

  const buildInit = async (opts: RequestOptions): Promise<FetchRequestInit> => {
    const token = await options.getAccessToken();
    const extra =
      typeof options.headers === 'function' ? options.headers() : (options.headers ?? {});
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Client-Type': options.clientType,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
      ...(opts.headers ?? {}),
    };
    return {
      method: opts.method ?? 'GET',
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    };
  };

  const send = async <T>(target: string, opts: RequestOptions): Promise<ApiResult<T>> => {
    let res: FetchResponseLike;
    try {
      res = await fetchImpl(target, await buildInit(opts));
    } catch (e) {
      return { ok: false, error: networkError(e instanceof Error ? e.message : 'Network error') };
    }
    return decode<T>(res);
  };

  const api = async <T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> => {
    const target = url(path, opts.query);
    let result = await send<T>(target, opts);
    if (result.ok || result.error.status !== 401 || opts.retryOnExpired === false) return result;

    if (REFRESHABLE_CODES.includes(result.error.code) && (await refreshOnce())) {
      result = await send<T>(target, opts);
      if (result.ok || result.error.status !== 401) return result;
    }
    if (SESSION_ERROR_CODES.includes(result.error.code) && options.onUnauthorized) {
      await options.onUnauthorized(result.error);
    }
    return result;
  };

  return { api, url };
}
