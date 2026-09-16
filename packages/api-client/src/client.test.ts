import { describe, expect, it, vi } from 'vitest';
import {
  buildQuery,
  createApiClient,
  joinUrl,
  type FetchLike,
  type FetchRequestInit,
} from './client.js';

interface Call {
  url: string;
  init: FetchRequestInit;
}

function envelope(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    statusText: 'x',
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}
const ok = (data: unknown) => envelope(200, { success: true, data, message: null, meta: {} });
const fail = (status: number, code: string, headers?: Record<string, string>) =>
  envelope(
    status,
    { success: false, data: null, message: code, error: { code, requestId: 'r' } },
    headers,
  );

function fakeFetch(responses: ReturnType<typeof envelope>[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('no response queued');
    return Promise.resolve(next);
  };
  return { fetch, calls };
}

describe('buildQuery / joinUrl', () => {
  it('drops empty values and encodes the rest', () => {
    expect(
      buildQuery({ page: 1, q: 'a b', skip: undefined, empty: '', nul: null, flag: false }),
    ).toBe('?page=1&q=a%20b&flag=false');
    expect(buildQuery(undefined)).toBe('');
    expect(buildQuery({})).toBe('');
  });
  it('joins base and path with exactly one slash', () => {
    expect(joinUrl('http://h/api/v1/', 'me')).toBe('http://h/api/v1/me');
    expect(joinUrl('http://h/api/v1', '/me')).toBe('http://h/api/v1/me');
  });
});

describe('createApiClient', () => {
  it('sends bearer + client-type headers and unwraps the envelope', async () => {
    const { fetch, calls } = fakeFetch([ok({ id: 'u1' })]);
    const client = createApiClient({
      baseUrl: 'http://h/api/v1',
      clientType: 'ANDROID',
      getAccessToken: () => 'tok',
      headers: { 'Accept-Language': 'ar' },
      fetch,
    });
    const r = await client.api<{ id: string }>('/me', { query: { page: 2 } });
    expect(r).toEqual({ ok: true, data: { id: 'u1' }, meta: {} });
    expect(calls[0]?.url).toBe('http://h/api/v1/me?page=2');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-Client-Type': 'ANDROID',
      'Accept-Language': 'ar',
      Accept: 'application/json',
    });
    expect(calls[0]?.init.headers['Content-Type']).toBeUndefined();
  });

  it('serialises JSON bodies and omits Authorization when signed out', async () => {
    const { fetch, calls } = fakeFetch([ok({})]);
    const client = createApiClient({
      baseUrl: 'http://h',
      clientType: 'IOS',
      getAccessToken: () => null,
      fetch,
    });
    await client.api('/auth/login', { method: 'POST', body: { identifier: 'a' } });
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{"identifier":"a"}');
    expect(calls[0]?.init.headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.init.headers['Authorization']).toBeUndefined();
  });

  it('refreshes once on AUTH_TOKEN_EXPIRED and retries with the new token', async () => {
    let token = 'old';
    const { fetch, calls } = fakeFetch([fail(401, 'AUTH_TOKEN_EXPIRED'), ok({ fresh: true })]);
    const refreshSession = vi.fn(() => {
      token = 'new';
      return Promise.resolve(true);
    });
    const onUnauthorized = vi.fn();
    const client = createApiClient({
      baseUrl: 'http://h',
      clientType: 'IOS',
      getAccessToken: () => token,
      refreshSession,
      onUnauthorized,
      fetch,
    });
    const r = await client.api('/bookings');
    expect(r.ok).toBe(true);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init.headers['Authorization']).toBe('Bearer new');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('signs out when the refresh fails, and never retries more than once', async () => {
    const { fetch, calls } = fakeFetch([fail(401, 'AUTH_TOKEN_EXPIRED')]);
    const onUnauthorized = vi.fn();
    const client = createApiClient({
      baseUrl: 'http://h',
      clientType: 'IOS',
      getAccessToken: () => 't',
      refreshSession: () => Promise.resolve(false),
      onUnauthorized,
      fetch,
    });
    const r = await client.api('/bookings');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('AUTH_TOKEN_EXPIRED');
    expect(calls).toHaveLength(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight refresh between concurrent callers', async () => {
    const { fetch } = fakeFetch([
      fail(401, 'AUTH_TOKEN_EXPIRED'),
      fail(401, 'AUTH_TOKEN_EXPIRED'),
      ok(1),
      ok(2),
    ]);
    let resolveRefresh: (v: boolean) => void = () => undefined;
    const refreshSession = vi.fn(() => new Promise<boolean>((res) => (resolveRefresh = res)));
    const client = createApiClient({
      baseUrl: 'http://h',
      clientType: 'IOS',
      getAccessToken: () => 't',
      refreshSession,
      fetch,
    });
    const a = client.api('/a');
    const b = client.api('/b');
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshSession).toHaveBeenCalledTimes(1);
    resolveRefresh(true);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ok && rb.ok).toBe(true);
  });

  it('does not refresh or sign out on a 401 from a login-style call (retryOnExpired: false)', async () => {
    const { fetch, calls } = fakeFetch([fail(401, 'AUTH_INVALID_CREDENTIALS')]);
    const refreshSession = vi.fn(() => Promise.resolve(true));
    const onUnauthorized = vi.fn();
    const client = createApiClient({
      baseUrl: 'http://h',
      clientType: 'IOS',
      getAccessToken: () => null,
      refreshSession,
      onUnauthorized,
      fetch,
    });
    const r = await client.api('/auth/login', { method: 'POST', body: {}, retryOnExpired: false });
    expect(!r.ok && r.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(calls).toHaveLength(1);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not sign out on a 401 that is not a session code even with retry enabled', async () => {
    const { fetch } = fakeFetch([fail(401, 'AUTH_INVALID_CREDENTIALS')]);
    const onUnauthorized = vi.fn();
    const client = createApiClient({
      baseUrl: 'http://h',
      clientType: 'IOS',
      getAccessToken: () => 't',
      onUnauthorized,
      fetch,
    });
    await client.api('/x', { method: 'POST', body: {} });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('surfaces Retry-After on a 429 and NETWORK on a thrown fetch', async () => {
    const { fetch } = fakeFetch([fail(429, 'RATE_LIMITED', { 'retry-after': '43' })]);
    const client = createApiClient({
      baseUrl: 'http://h',
      clientType: 'IOS',
      getAccessToken: () => null,
      fetch,
    });
    const r = await client.api('/auth/login', { method: 'POST', body: {}, retryOnExpired: false });
    expect(!r.ok && r.error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 43,
    });

    const down = createApiClient({
      baseUrl: 'http://h',
      clientType: 'IOS',
      getAccessToken: () => null,
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    const n = await down.api('/me');
    expect(n).toEqual({
      ok: false,
      error: { status: 0, code: 'NETWORK', message: 'ECONNREFUSED' },
    });
  });
});
