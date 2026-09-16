import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { config, setConfigForTests } from '@/config/index.js';
import { bearer, bootHarness, clearThrottles, loginBearer, teardownHarness, type Harness } from './helpers.js';

/**
 * Phase 14 hardening (security.md §6.3, §6.8): response headers on the JSON-only API origin,
 * the global rate-limit tiers (off under test by default — enabled here with tiny windows), the
 * per-session refresh ceiling, and the CSP violation collector.
 */
describe('hardening', () => {
  let h: Harness;
  let admin: string;
  let refreshToken: string;

  beforeAll(async () => {
    h = await bootHarness();
    const login = await loginBearer(h.app, h.adminEmail, h.adminPassword);
    admin = login.accessToken;
    refreshToken = login.refreshToken;
  });
  afterAll(teardownHarness);

  function withRateLimit<T>(tiers: Partial<ReturnType<typeof config>['rateLimit']>, fn: () => Promise<T>): Promise<T> {
    const before = config();
    setConfigForTests({ ...before, rateLimit: { ...before.rateLimit, enabled: true, ...tiers } });
    return fn().finally(() => {
      setConfigForTests(before);
    });
  }

  it('security headers: strict CSP, no-store, no sniffing, no framing, no referrer', async () => {
    const res = await bearer(request(h.app).get('/api/v1/me'), admin);
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none';sandbox");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-powered-by']).toBeUndefined();
    // Not production: no HSTS on plain HTTP dev/test.
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('anonymous tier: unauthenticated calls from one IP are capped; probes are exempt', async () => {
    await clearThrottles();
    await withRateLimit({ anonymous: { limit: 3, seconds: 60 } }, async () => {
      for (let i = 0; i < 3; i++) {
        const r = await request(h.app).get('/api/v1/settings/public');
        expect(r.status).toBe(200);
        expect(r.headers['ratelimit-limit']).toBe('3');
        expect(r.headers['ratelimit-remaining']).toBe(String(2 - i));
      }
      const blocked = await request(h.app).get('/api/v1/settings/public');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(blocked.headers['retry-after']).toBe('60');
      // health never counts
      expect((await request(h.app).get('/api/v1/health')).status).toBe(200);
      // a credentialled request from the same IP is not on the anonymous tier
      expect((await bearer(request(h.app).get('/api/v1/me'), admin)).status).toBe(200);
    });
    await clearThrottles();
  });

  it('user tiers: reads and writes are counted separately per user, headers advertise the remaining budget', async () => {
    await clearThrottles();
    await withRateLimit({ reads: { limit: 2, seconds: 60 }, writes: { limit: 1, seconds: 60 } }, async () => {
      expect((await bearer(request(h.app).get('/api/v1/me'), admin)).headers['ratelimit-remaining']).toBe('1');
      expect((await bearer(request(h.app).get('/api/v1/me'), admin)).headers['ratelimit-remaining']).toBe('0');
      const blocked = await bearer(request(h.app).get('/api/v1/me'), admin);
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toContain('reads');
      // the write budget is separate: one write still goes through (a harmless no-op patch)
      const write = await bearer(request(h.app).patch('/api/v1/me'), admin).send({ timezone: 'Asia/Riyadh' });
      expect(write.status).not.toBe(429);
      const blockedWrite = await bearer(request(h.app).patch('/api/v1/me'), admin).send({ timezone: 'Asia/Riyadh' });
      expect(blockedWrite.status).toBe(429);
      expect(blockedWrite.body.message).toContain('writes');
    });
    await clearThrottles();
  });

  it('route tier: report exports are capped per user independently of the read/write budgets', async () => {
    await clearThrottles();
    await withRateLimit({}, async () => {
      // 5 / hour: the 6th attempt is refused before validation or idempotency run.
      for (let i = 0; i < 5; i++) {
        const r = await bearer(request(h.app).post('/api/v1/reports/nope/export'), admin).set('Idempotency-Key', `00000000-0000-4000-8000-00000000000${i}`).send({});
        expect(r.status).not.toBe(429);
      }
      const r = await bearer(request(h.app).post('/api/v1/reports/nope/export'), admin).set('Idempotency-Key', '00000000-0000-4000-8000-000000000009').send({});
      expect(r.status).toBe(429);
      expect(r.body.message).toContain('report-export');
    });
    await clearThrottles();
  });

  it('refresh: a session may rotate at most 60 times an hour', async () => {
    await clearThrottles();
    await withRateLimit({}, async () => {
      let token = refreshToken;
      // Burn the budget with the real rotation (each call issues a new token).
      for (let i = 0; i < 60; i++) {
        const r = await request(h.app).post('/api/v1/auth/refresh').send({ refreshToken: token });
        expect(r.status, `rotation ${i}: ${JSON.stringify(r.body)}`).toBe(200);
        token = r.body.data.tokens.refreshToken as string;
      }
      const blocked = await request(h.app).post('/api/v1/auth/refresh').send({ refreshToken: token });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
    });
    await clearThrottles();
  });

  it('csp-report: accepts browser reports without credentials, caps the body, never echoes it', async () => {
    const legacy = await request(h.app)
      .post('/api/v1/platform/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({ 'csp-report': { 'document-uri': 'https://portal.example/ar/login?secret=1', 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js' } }));
    expect(legacy.status).toBe(204);
    expect(legacy.text).toBe('');
    const reportingApi = await request(h.app)
      .post('/api/v1/platform/csp-report')
      .set('Content-Type', 'application/reports+json')
      .send(JSON.stringify([{ type: 'csp-violation', body: { documentURL: 'https://portal.example/ar/login', effectiveDirective: 'img-src', blockedURL: 'inline' } }]));
    expect(reportingApi.status).toBe(204);
    const tooBig = await request(h.app).post('/api/v1/platform/csp-report').set('Content-Type', 'application/csp-report').send(JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(20_000) } }));
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
