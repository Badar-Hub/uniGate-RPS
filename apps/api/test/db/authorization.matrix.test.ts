/**
 * Authorization matrix — the Phase 3 exit criterion (architecture.md §6, api.md §3.2, §6.5).
 *
 * For every seeded role × a representative endpoint set, asserts the exact status:
 *   200/204  permission held and record in scope
 *   403      permission missing outright (PERM_DENIED)
 *   404      permission held but record outside scope — never 403 (anti-enumeration)
 *   401      no credential
 * Also proves: permission revocation takes effect on the NEXT request without re-login (pv
 * bump), self-modification guards, system-role immutability, and step-up gating.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;

const PW = 'matrix test passphrase 1';

describeDb('authorization matrix', () => {
  let h: Harness;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER', 'FINANCE_OFFICER', 'SUPPORT_AGENT', 'CUSTOMER', 'VEHICLE_OWNER', 'DRIVER', 'SPO'] as const;

  beforeAll(async () => {
    h = await bootHarness();
    for (const role of ROLES) {
      const profile = role === 'CUSTOMER' ? 'CUSTOMER' : role === 'VEHICLE_OWNER' ? 'OWNER' : role === 'DRIVER' ? 'DRIVER' : 'NONE';
      ids[role] = await createUserWithRoles(`${role.toLowerCase()}@matrix.test`, PW, [role], profile);
    }
    await clearThrottles();
    for (const role of ROLES) tokens[role] = (await loginBearer(h.app, `${role.toLowerCase()}@matrix.test`, PW)).accessToken;
  });
  afterAll(teardownHarness);

  /** endpoint → expected status per role */
  const MATRIX: { name: string; call: (t: string) => request.Test; expect: Record<(typeof ROLES)[number], number> }[] = [
    {
      name: 'GET /me (self scope, no permission)',
      call: (t) => bearer(request(h.app).get('/api/v1/me'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 200, SPO: 200 },
    },
    {
      name: 'GET /users (users.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/users'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 403, SUPPORT_AGENT: 200, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /settings (settings.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/settings'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /roles (roles.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/roles'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /roles (roles.manage) — ADMIN lacks it; SUPER_ADMIN reaches the step-up gate (403 with stepUpRequired)',
      call: (t) => bearer(request(h.app).post('/api/v1/roles'), t).send({ code: 'FLEET_SUPERVISOR', nameEn: 'Fleet Supervisor', nameAr: 'مشرف أسطول', permissionCodes: ['vehicles.read_any'] }),
      expect: { SUPER_ADMIN: 403, ADMIN: 403, OPS_MANAGER: 403, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
  ];

  for (const row of MATRIX) {
    it(row.name, async () => {
      for (const role of ROLES) {
        const res = await row.call(tokens[role] ?? '');
        expect(res.status, `${role} → ${row.name}`).toBe(row.expect[role]);
        if (res.status === 403) expect(res.body.error.code).toBe('PERM_DENIED');
      }
    });
  }

  it('no credential → 401 AUTH_TOKEN_MISSING; garbage credential → 401 AUTH_TOKEN_INVALID', async () => {
    const none = await request(h.app).get('/api/v1/me');
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('AUTH_TOKEN_MISSING');
    const bad = await request(h.app).get('/api/v1/me').set('Authorization', 'Bearer not.a.jwt');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('the step-up gate on POST /roles names the action class, and a real step-up passes it', async () => {
    const gated = await bearer(request(h.app).post('/api/v1/roles'), tokens['SUPER_ADMIN'] ?? '').send({ code: 'FLEET_SUPERVISOR', nameEn: 'Fleet Supervisor', nameAr: 'مشرف أسطول', permissionCodes: ['vehicles.read_any'] });
    expect(gated.body.error.details).toMatchObject({ stepUpRequired: true, actionClass: 'ROLE_CHANGE' });

    await clearThrottles();
    const req = await bearer(request(h.app).post('/api/v1/auth/step-up'), tokens['SUPER_ADMIN'] ?? '').send({ actionClass: 'ROLE_CHANGE' });
    expect(req.status).toBe(200);
    const code = h.otp.last('SENSITIVE_ACTION');
    const ver = await bearer(request(h.app).post('/api/v1/auth/step-up/verify'), tokens['SUPER_ADMIN'] ?? '').send({ actionClass: 'ROLE_CHANGE', code });
    expect(ver.status).toBe(200);
    const stepUp: string = ver.body.data.stepUpToken;

    const created = await bearer(request(h.app).post('/api/v1/roles'), tokens['SUPER_ADMIN'] ?? '').set('X-Step-Up-Token', stepUp).send({ code: 'FLEET_SUPERVISOR', nameEn: 'Fleet Supervisor', nameAr: 'مشرف أسطول', permissionCodes: ['vehicles.read_any'] });
    expect(created.status).toBe(201);
    expect(created.body.data.permissionCodes).toEqual(['vehicles.read_any']);

    // single use: the same token does not work twice
    const again = await bearer(request(h.app).patch('/api/v1/roles/FLEET_SUPERVISOR'), tokens['SUPER_ADMIN'] ?? '').set('X-Step-Up-Token', stepUp).send({ nameEn: 'Renamed' });
    expect(again.status).toBe(403);
  });

  it('a new role works without a deployment: assign it and the new permission is live on the next request', async () => {
    const customer = ids['CUSTOMER'] ?? '';
    // customer cannot read any vehicle listing permission yet
    const meBefore = await bearer(request(h.app).get('/api/v1/me'), tokens['CUSTOMER'] ?? '');
    expect(meBefore.body.data.permissions).not.toContain('vehicles.read_any');

    await clearThrottles();
    const req = await bearer(request(h.app).post('/api/v1/auth/step-up'), tokens['SUPER_ADMIN'] ?? '').send({ actionClass: 'ROLE_CHANGE' });
    expect(req.status).toBe(200);
    const ver = await bearer(request(h.app).post('/api/v1/auth/step-up/verify'), tokens['SUPER_ADMIN'] ?? '').send({ actionClass: 'ROLE_CHANGE', code: h.otp.last('SENSITIVE_ACTION') });
    const put = await bearer(request(h.app).put(`/api/v1/users/${customer}/roles`), tokens['SUPER_ADMIN'] ?? '').set('X-Step-Up-Token', ver.body.data.stepUpToken).send({ roleCodes: ['CUSTOMER', 'FLEET_SUPERVISOR'] });
    expect(put.status).toBe(200);

    // SAME access token, no re-login: permission set is re-resolved because pv was bumped.
    const meAfter = await bearer(request(h.app).get('/api/v1/me'), tokens['CUSTOMER'] ?? '');
    expect(meAfter.status).toBe(200);
    expect(meAfter.body.data.permissions).toContain('vehicles.read_any');
    expect(meAfter.body.data.permissionVersion).toBe(meBefore.body.data.permissionVersion + 1);

    const audit = await prisma().auditLog.findFirst({ where: { action: 'user.roles_changed', entityId: customer } });
    expect(audit?.severity).toBe('NOTICE');
    expect(audit?.beforeValue).toEqual({ roles: ['CUSTOMER'] });
  });

  it('out-of-scope records are 404, never 403 (anti-enumeration)', async () => {
    // A customer holds no users.read → 403 on /users/{id} (permission missing outright).
    const denied = await bearer(request(h.app).get(`/api/v1/users/${ids['ADMIN']}`), tokens['CUSTOMER'] ?? '');
    expect(denied.status).toBe(403);
    // A SUPPORT_AGENT holds users.read (GLOBAL) → a nonexistent id is 404 with the generic code.
    const missing = await bearer(request(h.app).get('/api/v1/users/0192f3c1-0000-7000-8000-000000000000'), tokens['SUPPORT_AGENT'] ?? '');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    // Another user's session id via /me/sessions/{id} → 404, not 403.
    const adminSessions = await prisma().session.findMany({ where: { userId: ids['ADMIN'] ?? '' }, select: { id: true } });
    const foreign = await bearer(request(h.app).delete(`/api/v1/me/sessions/${adminSessions[0]?.id}`), tokens['CUSTOMER'] ?? '');
    expect(foreign.status).toBe(404);
  });

  it('self-modification and system-role guards', async () => {
    await clearThrottles();
    const req = await bearer(request(h.app).post('/api/v1/auth/step-up'), tokens['SUPER_ADMIN'] ?? '').send({ actionClass: 'ROLE_CHANGE' });
    expect(req.status).toBe(200);
    const ver = await bearer(request(h.app).post('/api/v1/auth/step-up/verify'), tokens['SUPER_ADMIN'] ?? '').send({ actionClass: 'ROLE_CHANGE', code: h.otp.last('SENSITIVE_ACTION') });
    const self = await bearer(request(h.app).put(`/api/v1/users/${ids['SUPER_ADMIN']}/roles`), tokens['SUPER_ADMIN'] ?? '').set('X-Step-Up-Token', ver.body.data.stepUpToken).send({ roleCodes: ['CUSTOMER'] });
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe('PERM_SELF_MODIFICATION');

    const suspendSelf = await bearer(request(h.app).post(`/api/v1/users/${ids['SUPER_ADMIN']}/suspend`), tokens['SUPER_ADMIN'] ?? '').send({ reason: 'testing' });
    expect(suspendSelf.status).toBe(422);

    await clearThrottles(); // per-destination 1/60s send throttle
    const req2 = await bearer(request(h.app).post('/api/v1/auth/step-up'), tokens['SUPER_ADMIN'] ?? '').send({ actionClass: 'ROLE_CHANGE' });
    expect(req2.status).toBe(200);
    const ver2 = await bearer(request(h.app).post('/api/v1/auth/step-up/verify'), tokens['SUPER_ADMIN'] ?? '').send({ actionClass: 'ROLE_CHANGE', code: h.otp.last('SENSITIVE_ACTION') });
    const sys = await bearer(request(h.app).delete('/api/v1/roles/SUPER_ADMIN'), tokens['SUPER_ADMIN'] ?? '').set('X-Step-Up-Token', ver2.body.data.stepUpToken);
    expect(sys.status).toBe(409);
    expect(sys.body.error.code).toBe('PERM_ROLE_IMMUTABLE');
  });

  it('suspending a user revokes their sessions immediately', async () => {
    const suspend = await bearer(request(h.app).post(`/api/v1/users/${ids['DRIVER']}/suspend`), tokens['ADMIN'] ?? '').send({ reason: 'matrix test' });
    expect(suspend.status).toBe(200);
    const dead = await bearer(request(h.app).get('/api/v1/me'), tokens['DRIVER'] ?? '');
    expect(dead.status).toBe(401);
    const login = await request(h.app).post('/api/v1/auth/login').send({ identifier: 'driver@matrix.test', password: PW, clientType: 'IOS' });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('AUTH_ACCOUNT_SUSPENDED');
  });

  it('idempotency: same key + same body replays; same key + different body is 409', async () => {
    const key = 'matrix-idempotency-key-0001';
    const body = { email: 'idem@matrix.test', fullNameEn: 'Idem User', roleCodes: ['SUPPORT_AGENT'] };
    const a = await bearer(request(h.app).post('/api/v1/users'), tokens['SUPER_ADMIN'] ?? '').set('Idempotency-Key', key).send(body);
    expect(a.status).toBe(201);
    const b = await bearer(request(h.app).post('/api/v1/users'), tokens['SUPER_ADMIN'] ?? '').set('Idempotency-Key', key).send(body);
    expect(b.status).toBe(201);
    expect(b.headers['idempotency-replayed']).toBe('true');
    expect(b.body.meta.idempotentReplay).toBe(true);
    expect(b.body.data.id).toBe(a.body.data.id);
    const c = await bearer(request(h.app).post('/api/v1/users'), tokens['SUPER_ADMIN'] ?? '').set('Idempotency-Key', key).send({ ...body, email: 'other@matrix.test' });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma().user.count({ where: { email: { in: ['idem@matrix.test', 'other@matrix.test'] } } })).toBe(1);
  });
});
