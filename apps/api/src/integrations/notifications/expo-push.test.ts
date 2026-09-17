import { describe, expect, it, vi } from 'vitest';
import { initLogger } from '@/logging/logger.js';
import { ExpoPushProvider } from './expo-push.js';

initLogger({ level: 'silent', env: 'test', service: 'test', version: 'test', pretty: false });

type Ticket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

function fetchReturning(handler: (bodies: { to: string }[], init: RequestInit) => Ticket[] | { status: number }) {
  const calls: { to: string }[][] = [];
  const impl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '[]') as { to: string }[];
    calls.push(body);
    const out = handler(body, init ?? {});
    if ('status' in out && !Array.isArray(out)) return Promise.resolve(new Response('{}', { status: out.status }));
    return Promise.resolve(new Response(JSON.stringify({ data: out }), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('ExpoPushProvider', () => {
  const message = { title: 'Bid received', body: 'A new bid', data: { bookingId: 'b1' } };

  it('sends only Expo tokens, in chunks of 100, with the access token as a bearer', async () => {
    const tokens = Array.from({ length: 150 }, (_, i) => `ExponentPushToken[t${i}]`);
    let auth: string | null = null;
    const f = fetchReturning((bodies, init) => {
      auth = (init.headers as Record<string, string>)['Authorization'] ?? null;
      return bodies.map((_, i) => ({ status: 'ok', id: `ticket-${i}` }));
    });
    const p = new ExpoPushProvider({ accessToken: 'eas-token', fetch: f.impl });
    const res = await p.send({ ...message, tokens: [...tokens, 'fcm-raw-token-not-expo'] });
    expect(f.calls.map((c) => c.length)).toEqual([100, 50]);
    expect(f.calls[0]?.[0]).toMatchObject({ to: 'ExponentPushToken[t0]', title: 'Bid received', body: 'A new bid', data: { bookingId: 'b1' }, channelId: 'default' });
    expect(auth).toBe('Bearer eas-token');
    expect(res.providerMessageId).toBe('ticket-0');
    expect(res.invalidTokens).toEqual([]);
  });

  it('reports DeviceNotRegistered tokens as invalid and tolerates other ticket errors', async () => {
    const f = fetchReturning((bodies) =>
      bodies.map((b) =>
        b.to.includes('dead') ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : b.to.includes('big') ? { status: 'error', message: 'too large', details: { error: 'MessageTooBig' } } : { status: 'ok', id: 'ok-1' },
      ),
    );
    const p = new ExpoPushProvider({ accessToken: null, fetch: f.impl });
    const res = await p.send({ ...message, tokens: ['ExponentPushToken[live]', 'ExponentPushToken[dead]', 'ExponentPushToken[big]'] });
    expect(res.invalidTokens).toEqual(['ExponentPushToken[dead]']);
    expect(res.providerMessageId).toBe('ok-1');
  });

  it('throws on a transport failure so the delivery is retried', async () => {
    const f = fetchReturning(() => ({ status: 503 }));
    const p = new ExpoPushProvider({ accessToken: null, fetch: f.impl });
    await expect(p.send({ ...message, tokens: ['ExponentPushToken[x]'] })).rejects.toThrow('HTTP 503');
  });

  it('does nothing when no token is an Expo token', async () => {
    const f = fetchReturning(() => []);
    const p = new ExpoPushProvider({ accessToken: null, fetch: f.impl });
    const res = await p.send({ ...message, tokens: ['apns-hex'] });
    expect(res).toEqual({ providerMessageId: null, invalidTokens: [] });
    expect(f.calls).toHaveLength(0);
  });
});
