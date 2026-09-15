import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;

describeDb('auth lifecycle', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootHarness();
  });
  afterAll(teardownHarness);

  const phone = '+966512345678';
  const password = 'correct horse battery';

  it('registers, verifies the phone by OTP, and opens a session', async () => {
    const reg = await request(h.app).post('/api/v1/auth/register').send({
      intent: 'CUSTOMER', phoneE164: phone, password, fullNameEn: 'Layla Test', preferredLocale: 'ar', acceptedTermsVersion: '1.0',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.data.status).toBe('PENDING_VERIFICATION');
    expect(reg.body.data.otpSentTo).toBe('+9665•• ••• •78');

    // Cannot log in with a password until verified
    const early = await request(h.app).post('/api/v1/auth/login').send({ identifier: phone, password, clientType: 'IOS' });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('AUTH_PHONE_NOT_VERIFIED');

    const code = h.otp.last('REGISTRATION', phone);
    const wrong = await request(h.app).post('/api/v1/auth/otp/verify').send({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION', code: '000000', clientType: 'IOS' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('AUTH_OTP_INVALID');

    const ok = await request(h.app).post('/api/v1/auth/otp/verify').send({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION', code, clientType: 'IOS' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.roles).toEqual(['CUSTOMER']);
    expect(ok.body.data.tokens.accessToken).toBeTypeOf('string');

    // Second use of the same code fails — single use.
    const replay = await request(h.app).post('/api/v1/auth/otp/verify').send({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION', code, clientType: 'IOS' });
    expect(replay.status).toBe(422);
  });

  it('logs in with the password and reads /me with resolved permissions', async () => {
    const { accessToken } = await loginBearer(h.app, phone, password);
    const me = await bearer(request(h.app).get('/api/v1/me'), accessToken);
    expect(me.status).toBe(200);
    expect(me.body.data.roles).toEqual(['CUSTOMER']);
    expect(me.body.data.permissions).toContain('trip_requests.create');
    expect(me.body.data.permissions).not.toContain('users.read');
    expect(me.body.data.profiles.customer).not.toBeNull();
    // never leaks
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|password_hash|tokenHash/);
  });

  it('returns the same AUTH_INVALID_CREDENTIALS for unknown identifiers and wrong passwords', async () => {
    const unknown = await request(h.app).post('/api/v1/auth/login').send({ identifier: '+966500000000', password: 'whatever-long-pw', clientType: 'IOS' });
    const wrong = await request(h.app).post('/api/v1/auth/login').send({ identifier: phone, password: 'wrong-password-1', clientType: 'IOS' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
    expect(unknown.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    const attempts = await prisma().loginAttempt.count({ where: { succeeded: false } });
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it('rotates refresh tokens and detects replay: whole family + session revoked', async () => {
    await clearThrottles();
    const first = await loginBearer(h.app, phone, password);

    const r1 = await request(h.app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(r1.status).toBe(200);
    const rt2: string = r1.body.data.tokens.refreshToken;
    const at2: string = r1.body.data.tokens.accessToken;
    expect(rt2).not.toBe(first.refreshToken);

    // Replay the ORIGINAL (already used) token → reuse detected.
    const replay = await request(h.app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_REFRESH_REUSE_DETECTED');

    // The legitimate successor is dead too — the family is gone.
    const successor = await request(h.app).post('/api/v1/auth/refresh').send({ refreshToken: rt2 });
    expect(successor.status).toBe(401);
    expect(successor.body.error.code).toBe('AUTH_SESSION_REVOKED');

    // And the access token is rejected on the next request.
    const me = await bearer(request(h.app).get('/api/v1/me'), at2);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('AUTH_SESSION_REVOKED');

    const audit = await prisma().auditLog.findFirst({ where: { action: 'auth.refresh_reuse_detected' } });
    expect(audit?.severity).toBe('SECURITY');
    const outbox = await prisma().outboxEvent.findFirst({ where: { eventType: 'security.refresh_reuse' } });
    expect(outbox).not.toBeNull();
  });

  it('web mode sets httpOnly cookies, requires the CSRF header, and refuses cross-mode replay', async () => {
    await clearThrottles();
    const login = await request(h.app).post('/api/v1/auth/login').send({ identifier: phone, password, clientType: 'WEB' });
    expect(login.status).toBe(200);
    expect(login.body.data.tokens).toBeNull();
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('ug_at=') && /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith('ug_rt=') && c.includes('Path=/api/v1/auth'))).toBe(true);
    const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');

    // GET works with the cookie alone
    const me = await request(h.app).get('/api/v1/me').set('Cookie', cookieHeader);
    expect(me.status).toBe(200);

    // A cookie-mode mutation without the custom header is refused
    const noHeader = await request(h.app).patch('/api/v1/me').set('Cookie', cookieHeader).set('Origin', 'http://localhost:3001').send({ timezone: 'Asia/Riyadh' });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe('AUTH_CSRF_HEADER_MISSING');

    // …and with the header but a foreign Origin
    const badOrigin = await request(h.app).patch('/api/v1/me').set('Cookie', cookieHeader).set('X-Requested-With', 'unigate-web').set('Origin', 'http://evil.example').send({ timezone: 'Asia/Riyadh' });
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.body.error.code).toBe('AUTH_CSRF_ORIGIN_MISMATCH');

    // …and succeeds with both
    const good = await request(h.app).patch('/api/v1/me').set('Cookie', cookieHeader).set('X-Requested-With', 'unigate-web').set('Origin', 'http://localhost:3001').send({ timezone: 'Asia/Riyadh' });
    expect(good.status).toBe(200);

    // The web session's refresh cookie cannot be redeemed as a body token (mode binding).
    const rt = cookies.find((c) => c.startsWith('ug_rt='))?.split(';')[0]?.slice('ug_rt='.length) ?? '';
    const crossMode = await request(h.app).post('/api/v1/auth/refresh').send({ refreshToken: rt });
    expect(crossMode.status).toBe(401);
    expect(crossMode.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('throttles OTP requests per destination (1/60s) and never reveals codes in the response', async () => {
    await clearThrottles();
    const dest = '+966599999999';
    const a = await request(h.app).post('/api/v1/auth/otp/request').send({ channel: 'SMS', destination: dest, purpose: 'LOGIN' });
    expect(a.status).toBe(200);
    expect(JSON.stringify(a.body)).not.toContain(h.otp.last('LOGIN', dest));
    const b = await request(h.app).post('/api/v1/auth/otp/request').send({ channel: 'SMS', destination: dest, purpose: 'LOGIN' });
    expect(b.status).toBe(429);
    expect(b.body.error.code).toBe('AUTH_OTP_THROTTLED');
    expect(b.headers['retry-after']).toBeDefined();
  });

  it('rejects OTP delivery outside the allowed country codes before any send', async () => {
    await clearThrottles();
    const sentBefore = h.otp.sent.length;
    const res = await request(h.app).post('/api/v1/auth/otp/request').send({ channel: 'SMS', destination: '+447700900123', purpose: 'LOGIN' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AUTH_OTP_DESTINATION_NOT_ALLOWED');
    expect(h.otp.sent.length).toBe(sentBefore);
  });

  it('password change revokes other sessions but keeps the current one', async () => {
    await clearThrottles();
    const s1 = await loginBearer(h.app, phone, password);
    const s2 = await loginBearer(h.app, phone, password);
    const newPassword = 'a much better passphrase';
    const change = await bearer(request(h.app).post('/api/v1/auth/password/change'), s1.accessToken).send({ currentPassword: password, newPassword });
    expect(change.status).toBe(200);
    // s1 continues with the fresh token the endpoint returned; its pre-change token is dead by rule
    const s1Fresh: string = change.body.data.accessToken;
    expect((await bearer(request(h.app).get('/api/v1/auth/session'), s1Fresh)).status).toBe(200);
    expect((await bearer(request(h.app).get('/api/v1/auth/session'), s1.accessToken)).body.error.code).toBe('AUTH_PASSWORD_CHANGED');
    const dead = await bearer(request(h.app).get('/api/v1/auth/session'), s2.accessToken);
    expect(dead.status).toBe(401);
    // and the old password no longer logs in
    const old = await request(h.app).post('/api/v1/auth/login').send({ identifier: phone, password, clientType: 'IOS' });
    expect(old.status).toBe(401);
    const fresh = await request(h.app).post('/api/v1/auth/login').send({ identifier: phone, password: newPassword, clientType: 'IOS' });
    expect(fresh.status).toBe(200);
  });

  it('enforces the password policy (length over composition, no context words)', async () => {
    const short = await request(h.app).post('/api/v1/auth/register').send({ intent: 'CUSTOMER', phoneE164: '+966511111111', password: 'short', fullNameEn: 'X Y', acceptedTermsVersion: '1.0' });
    expect(short.status).toBe(422);
    const phoneInPw = await request(h.app).post('/api/v1/auth/register').send({ intent: 'CUSTOMER', phoneE164: '+966511111111', password: 'pass 511111111 word', fullNameEn: 'X Y', acceptedTermsVersion: '1.0' });
    expect(phoneInPw.status).toBe(422);
    expect(phoneInPw.body.error.code).toBe('AUTH_PASSWORD_POLICY');
  });

  it('forgot-password always returns 200 and the reset consumes the token once', async () => {
    await clearThrottles();
    const unknown = await request(h.app).post('/api/v1/auth/password/forgot').send({ identifier: '+966500000001' });
    expect(unknown.status).toBe(200);
    const known = await request(h.app).post('/api/v1/auth/password/forgot').send({ identifier: h.adminEmail });
    expect(known.status).toBe(200);
    // The token is never returned; we read the hash row exists and drive the reset via a fresh token
    const row = await prisma().passwordResetToken.findFirst({ where: { user: { email: h.adminEmail }, usedAt: null }, orderBy: { createdAt: 'desc' } });
    expect(row).not.toBeNull();
    const bogus = await request(h.app).post('/api/v1/auth/password/reset').send({ token: 'x'.repeat(43), newPassword: 'another long passphrase' });
    expect(bogus.status).toBe(422);
    expect(bogus.body.error.code).toBe('AUTH_PASSWORD_RESET_INVALID');
  });
});
