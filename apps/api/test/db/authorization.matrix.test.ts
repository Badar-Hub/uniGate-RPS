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
    // ── Phase 4: profiles & documents ─────────────────────────────────────────
    {
      name: 'GET /customers (customers.read — staff + SPO)',
      call: (t) => bearer(request(h.app).get('/api/v1/customers'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 200 },
    },
    {
      name: 'GET /owners (owners.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/owners'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /drivers (drivers.read own → drivers.read_any; a driver lists themself)',
      call: (t) => bearer(request(h.app).get('/api/v1/drivers'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 403, SUPPORT_AGENT: 200, CUSTOMER: 403, VEHICLE_OWNER: 200, DRIVER: 200, SPO: 403 },
    },
    {
      name: 'POST /drivers (drivers.create)',
      call: (t) => bearer(request(h.app).post('/api/v1/drivers'), t).send({}),
      expect: { SUPER_ADMIN: 422, ADMIN: 422, OPS_MANAGER: 422, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 422, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /documents (documents.read — everyone with a profile; staff via documents.read_any)',
      call: (t) => bearer(request(h.app).get('/api/v1/documents'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 403, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 200, SPO: 403 },
    },
    {
      name: 'POST /documents/{id}/verify (documents.verify)',
      call: (t) => bearer(request(h.app).post('/api/v1/documents/0192f3c1-0000-7000-8000-000000000000/verify'), t).send({}),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /spo/leads (spo.leads.manage)',
      call: (t) => bearer(request(h.app).get('/api/v1/spo/leads'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 200 },
    },
    {
      name: 'PATCH /admin/customers/{id}/credit (customers.verify)',
      call: (t) => bearer(request(h.app).patch('/api/v1/admin/customers/0192f3c1-0000-7000-8000-000000000000/credit'), t).send({ creditStatus: 'PENDING_APPROVAL' }),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 403, FINANCE_OFFICER: 404, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    // ── Phase 5: fleet & reference ─────────────────────────────────────────────
    {
      name: 'GET /vehicles (vehicles.read own → vehicles.read_any)',
      call: (t) => bearer(request(h.app).get('/api/v1/vehicles'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 403, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /vehicles (vehicles.create)',
      call: (t) => bearer(request(h.app).post('/api/v1/vehicles'), t).send({}),
      expect: { SUPER_ADMIN: 422, ADMIN: 422, OPS_MANAGER: 422, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 422, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /vehicles/{id}/approve (vehicles.approve)',
      call: (t) => bearer(request(h.app).post('/api/v1/vehicles/0192f3c1-0000-7000-8000-000000000000/approve'), t).send({}),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /reference/vehicle-makes (reference.manage)',
      call: (t) => bearer(request(h.app).post('/api/v1/reference/vehicle-makes'), t).send({ name: 'Matrix Motors' }),
      expect: { SUPER_ADMIN: 201, ADMIN: 409, OPS_MANAGER: 403, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    // ── Phase 6: demand ────────────────────────────────────────────────────────
    {
      name: 'GET /trip-requests (trip_requests.read own → read_any)',
      call: (t) => bearer(request(h.app).get('/api/v1/trip-requests'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 200 },
    },
    {
      name: 'POST /trip-requests (trip_requests.create; Idempotency-Key required → 400 before validation)',
      call: (t) => bearer(request(h.app).post('/api/v1/trip-requests'), t).send({}),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 400, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 400, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 400 },
    },
    {
      name: 'GET /trip-requests/{id}/invitations (trip_requests.read_any)',
      call: (t) => bearer(request(h.app).get('/api/v1/trip-requests/0192f3c1-0000-7000-8000-000000000000/invitations'), t),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 404, SUPPORT_AGENT: 404, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /opportunities (owner profile or trip_requests.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/opportunities'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 200 },
    },
    // ── Phase 7: bidding ───────────────────────────────────────────────────────
    {
      name: 'GET /bids (bids.read own → bids.read_any; SUPPORT_AGENT holds read_any only)',
      call: (t) => bearer(request(h.app).get('/api/v1/bids'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 403, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /bids (bids.create; Idempotency-Key required → 400 before validation)',
      call: (t) => bearer(request(h.app).post('/api/v1/bids'), t).send({}),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 400, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 400, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /bids/{id}/accept (bids.accept — customers and ops, never owners; key required)',
      call: (t) => bearer(request(h.app).post('/api/v1/bids/0192f3c1-0000-7000-8000-000000000000/accept'), t).send({}),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 400, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 400, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /trip-requests/{id}/award (bids.accept; key required)',
      call: (t) => bearer(request(h.app).post('/api/v1/trip-requests/0192f3c1-0000-7000-8000-000000000000/award'), t).send({}),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 400, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 400, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /trip-requests/{id}/bids (bids.read; unknown request → 404 for every holder)',
      call: (t) => bearer(request(h.app).get('/api/v1/trip-requests/0192f3c1-0000-7000-8000-000000000000/bids'), t),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 404, CUSTOMER: 404, VEHICLE_OWNER: 404, DRIVER: 403, SPO: 403 },
    },
    // ── Phase 8: bookings ──────────────────────────────────────────────────────
    {
      name: 'GET /bookings (bookings.read own/party → read_any)',
      call: (t) => bearer(request(h.app).get('/api/v1/bookings'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 200, SPO: 403 },
    },
    {
      name: 'POST /bookings/{id}/cancel (bookings.cancel; key required → 400 before scope)',
      call: (t) => bearer(request(h.app).post('/api/v1/bookings/0192f3c1-0000-7000-8000-000000000000/cancel'), t).send({}),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 400, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 400, VEHICLE_OWNER: 400, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /bookings/{id}/confirm (bookings.manage — ops only; unknown id → 404)',
      call: (t) => bearer(request(h.app).post('/api/v1/bookings/0192f3c1-0000-7000-8000-000000000000/confirm'), t).send({ reason: 'reconciled' }),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /bookings/{id}/assign-driver (bookings.assign_driver — owners and ops)',
      call: (t) => bearer(request(h.app).post('/api/v1/bookings/0192f3c1-0000-7000-8000-000000000000/assign-driver'), t).send({ driverProfileId: '0192f3c1-0000-7000-8000-000000000000' }),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 404, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /bookings/{id}/ready (bookings.manage or owner profile)',
      call: (t) => bearer(request(h.app).post('/api/v1/bookings/0192f3c1-0000-7000-8000-000000000000/ready'), t).send({}),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 404, DRIVER: 403, SPO: 403 },
    },
    // ── Phase 9: payments ──────────────────────────────────────────────────────
    {
      name: 'GET /payments (payments.read own → read_any; owners learn payment state from the booking)',
      call: (t) => bearer(request(h.app).get('/api/v1/payments'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /payments (payments.create; key required → 400 before validation)',
      call: (t) => bearer(request(h.app).post('/api/v1/payments'), t).send({}),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 403, FINANCE_OFFICER: 400, SUPPORT_AGENT: 403, CUSTOMER: 400, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /payments/{id}/sync (payments.manage — reconciliation is staff-only)',
      call: (t) => bearer(request(h.app).post('/api/v1/payments/0192f3c1-0000-7000-8000-000000000000/sync'), t),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 403, FINANCE_OFFICER: 404, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /refunds (payments.refund; empty body → 422 for holders)',
      call: (t) => bearer(request(h.app).post('/api/v1/refunds'), t).send({}),
      expect: { SUPER_ADMIN: 422, ADMIN: 422, OPS_MANAGER: 403, FINANCE_OFFICER: 422, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /webhooks/payments/mock — no session, signature only (unsigned → 401 for everyone)',
      call: () => request(h.app).post('/api/v1/webhooks/payments/mock').set('Content-Type', 'application/json').send('{"id":"evt_x","type":"payment.captured"}'),
      expect: { SUPER_ADMIN: 401, ADMIN: 401, OPS_MANAGER: 401, FINANCE_OFFICER: 401, SUPPORT_AGENT: 401, CUSTOMER: 401, VEHICLE_OWNER: 401, DRIVER: 401, SPO: 401 },
    },
    // ── Phase 10: trips & tracking ─────────────────────────────────────────────
    {
      name: 'GET /trips (trips.read own/party → read_any)',
      call: (t) => bearer(request(h.app).get('/api/v1/trips'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 403, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 200, SPO: 403 },
    },
    {
      name: 'POST /trips/{id}/status (trips.update_status — drivers and ops; key required → 400)',
      call: (t) => bearer(request(h.app).post('/api/v1/trips/0192f3c1-0000-7000-8000-000000000000/status'), t).send({ status: 'DRIVER_EN_ROUTE' }),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 400, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 400, SPO: 403 },
    },
    {
      name: 'POST /trips/{id}/cancel (trips.manage — ops only; unknown id → 404)',
      call: (t) => bearer(request(h.app).post('/api/v1/trips/0192f3c1-0000-7000-8000-000000000000/cancel'), t).send({ reason: 'breakdown' }),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /tracking/ping (tracking.publish — drivers only; unknown trip → 404)',
      call: (t) => bearer(request(h.app).post('/api/v1/tracking/ping'), t).send({ tripId: '0192f3c1-0000-7000-8000-000000000000', latitude: 24.7, longitude: 46.7, recordedAt: new Date().toISOString() }),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 404, SPO: 403 },
    },
    {
      name: 'GET /tracking/vehicles (tracking.read_any — ops/fleet only)',
      call: (t) => bearer(request(h.app).get('/api/v1/tracking/vehicles'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 403, SUPPORT_AGENT: 200, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /trip-requests/{id}/assign-platform-vehicle (bookings.manage — ops; key required → 400)',
      call: (t) => bearer(request(h.app).post('/api/v1/trip-requests/0192f3c1-0000-7000-8000-000000000000/assign-platform-vehicle'), t).send({ vehicleId: '0192f3c1-0000-7000-8000-000000000000', baseAmount: '100.00' }),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 400, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    // ── Vendor onboarding & access ─────────────────────────────────────────────
    {
      name: 'POST /admin/vendors (users.create + owners.create — admins only; empty body → 422)',
      call: (t) => bearer(request(h.app).post('/api/v1/admin/vendors'), t).send({}),
      expect: { SUPER_ADMIN: 422, ADMIN: 422, OPS_MANAGER: 403, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /users/{id}/permissions (permissions.assign — super admin only; unknown id → 404)',
      call: (t) => bearer(request(h.app).get('/api/v1/users/0192f3c1-0000-7000-8000-000000000000/permissions'), t),
      expect: { SUPER_ADMIN: 404, ADMIN: 403, OPS_MANAGER: 403, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    // ── Phase 11: finance ──────────────────────────────────────────────────────
    {
      name: 'GET /commissions/rules (commissions.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/commissions/rules'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /commissions/rules (commissions.manage — finance/admin; empty body → 422)',
      call: (t) => bearer(request(h.app).post('/api/v1/commissions/rules'), t).send({}),
      expect: { SUPER_ADMIN: 422, ADMIN: 422, OPS_MANAGER: 403, FINANCE_OFFICER: 422, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'PATCH /trip-requests/{id}/commission (commissions.override — ops and finance; unknown id → 404)',
      call: (t) => bearer(request(h.app).patch('/api/v1/trip-requests/0192f3c1-0000-7000-8000-000000000000/commission'), t).send({ override: null }),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 404, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /settlements (settlements.read — owners see their own)',
      call: (t) => bearer(request(h.app).get('/api/v1/settlements'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 200, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /settlements (settlements.create — finance; key required → 400)',
      call: (t) => bearer(request(h.app).post('/api/v1/settlements'), t).send({}),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 403, FINANCE_OFFICER: 400, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /settlements/{id}/approve (settlements.approve; unknown id → 404)',
      call: (t) => bearer(request(h.app).post('/api/v1/settlements/0192f3c1-0000-7000-8000-000000000000/approve'), t).send({}),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 403, FINANCE_OFFICER: 404, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /ledger/entries (ledger.read — finance only)',
      call: (t) => bearer(request(h.app).get('/api/v1/ledger/entries'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 200, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /invoices (invoices.read — buyers see their own)',
      call: (t) => bearer(request(h.app).get('/api/v1/invoices'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /invoices (invoices.issue — finance; key required → 400)',
      call: (t) => bearer(request(h.app).post('/api/v1/invoices'), t).send({ bookingId: '0192f3c1-0000-7000-8000-000000000000' }),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 403, FINANCE_OFFICER: 400, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /admin/invoices/clearance-queue (invoices.issue)',
      call: (t) => bearer(request(h.app).get('/api/v1/admin/invoices/clearance-queue'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 200, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /expenses (expenses.read — owners see their own)',
      call: (t) => bearer(request(h.app).get('/api/v1/expenses'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 200, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /expenses (expenses.create — owners; empty body → 422)',
      call: (t) => bearer(request(h.app).post('/api/v1/expenses'), t).send({}),
      expect: { SUPER_ADMIN: 422, ADMIN: 422, OPS_MANAGER: 403, FINANCE_OFFICER: 422, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 422, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /maintenance/records (maintenance.read — owners see their own)',
      call: (t) => bearer(request(h.app).get('/api/v1/maintenance/records'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /maintenance/records (maintenance.create; empty body → 422)',
      call: (t) => bearer(request(h.app).post('/api/v1/maintenance/records'), t).send({}),
      expect: { SUPER_ADMIN: 422, ADMIN: 422, OPS_MANAGER: 422, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 422, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'DELETE /maintenance/records/{id} (maintenance.delete + read_any — staff only; unknown id → 404)',
      call: (t) => bearer(request(h.app).delete('/api/v1/maintenance/records/00000000-0000-4000-8000-000000000000'), t),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /notifications (notifications.read — every role has an inbox)',
      call: (t) => bearer(request(h.app).get('/api/v1/notifications'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 200, SPO: 200 },
    },
    {
      name: 'POST /notifications/send (notifications.send; key required → 400)',
      call: (t) => bearer(request(h.app).post('/api/v1/notifications/send'), t).send({}),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 400, FINANCE_OFFICER: 403, SUPPORT_AGENT: 400, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /notifications/templates (notifications.templates.manage)',
      call: (t) => bearer(request(h.app).get('/api/v1/notifications/templates'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /ratings (ratings.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/ratings'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 403, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 200, SPO: 403 },
    },
    {
      name: 'POST /ratings/{id}/moderate (ratings.moderate; unknown id → 404)',
      call: (t) => bearer(request(h.app).post('/api/v1/ratings/00000000-0000-4000-8000-000000000000/moderate'), t).send({ status: 'HIDDEN', reason: 'abuse' }),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /complaints (complaints.read — raisers see their own)',
      call: (t) => bearer(request(h.app).get('/api/v1/complaints'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 403, SUPPORT_AGENT: 200, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 200, SPO: 403 },
    },
    {
      name: 'POST /complaints/{id}/status (complaints.manage; unknown id → 404)',
      call: (t) => bearer(request(h.app).post('/api/v1/complaints/00000000-0000-4000-8000-000000000000/status'), t).send({ status: 'IN_REVIEW' }),
      expect: { SUPER_ADMIN: 404, ADMIN: 404, OPS_MANAGER: 404, FINANCE_OFFICER: 403, SUPPORT_AGENT: 404, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /admin/dashboard (dashboard.read; empty query → 422)',
      call: (t) => bearer(request(h.app).get('/api/v1/admin/dashboard'), t),
      expect: { SUPER_ADMIN: 422, ADMIN: 422, OPS_MANAGER: 422, FINANCE_OFFICER: 422, SUPPORT_AGENT: 422, CUSTOMER: 403, VEHICLE_OWNER: 422, DRIVER: 403, SPO: 422 },
    },
    {
      name: 'GET /admin/system/health (system.health.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/admin/system/health'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /audit-logs (audit_logs.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/audit-logs'), t).query({ pageSize: 1 }),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 200, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'GET /reports (reports.read — owners, customers and SPOs run their own)',
      call: (t) => bearer(request(h.app).get('/api/v1/reports'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 200, FINANCE_OFFICER: 200, SUPPORT_AGENT: 403, CUSTOMER: 200, VEHICLE_OWNER: 200, DRIVER: 403, SPO: 200 },
    },
    {
      name: 'GET /reports/revenue (financial + global: reports.financial.read)',
      call: (t) => bearer(request(h.app).get('/api/v1/reports/revenue'), t),
      expect: { SUPER_ADMIN: 200, ADMIN: 200, OPS_MANAGER: 403, FINANCE_OFFICER: 200, SUPPORT_AGENT: 403, CUSTOMER: 403, VEHICLE_OWNER: 403, DRIVER: 403, SPO: 403 },
    },
    {
      name: 'POST /bookings/{id}/no-show (bookings.cancel + global; key required → 400)',
      call: (t) => bearer(request(h.app).post('/api/v1/bookings/00000000-0000-4000-8000-000000000000/no-show'), t).send({ party: 'OWNER' }),
      expect: { SUPER_ADMIN: 400, ADMIN: 400, OPS_MANAGER: 400, FINANCE_OFFICER: 403, SUPPORT_AGENT: 403, CUSTOMER: 400, VEHICLE_OWNER: 400, DRIVER: 403, SPO: 403 },
    },
  ];

  for (const row of MATRIX) {
    it(row.name, async () => {
      for (const role of ROLES) {
        const res = await row.call(tokens[role] ?? '');
        expect(res.status, `${role} → ${row.name}`).toBe(row.expect[role]);
        if (res.status === 403) expect(res.body.error.code).toBe('PERM_DENIED');
        if (res.status === 409) expect(res.body.error.code).toBe('CONFLICT');
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
    // Phase 4: a profile holder asking for ANOTHER profile by id gets 404 — the scope predicate must never be overridden by the requested id.
    const ownerA = await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ids['VEHICLE_OWNER'] ?? '' }, select: { id: true } });
    const platformFleet = await prisma().ownerProfile.findFirstOrThrow({ where: { isPlatformFleet: true }, select: { id: true } });
    expect((await bearer(request(h.app).get(`/api/v1/owners/${ownerA.id}`), tokens['VEHICLE_OWNER'] ?? '')).status).toBe(200);
    expect((await bearer(request(h.app).get(`/api/v1/owners/${platformFleet.id}`), tokens['VEHICLE_OWNER'] ?? '')).status).toBe(404);
    expect((await bearer(request(h.app).get(`/api/v1/owners/${platformFleet.id}/bank-accounts`), tokens['VEHICLE_OWNER'] ?? '')).status).toBe(404);
    const customerA = await prisma().customerProfile.findFirstOrThrow({ where: { userId: ids['CUSTOMER'] ?? '' }, select: { id: true } });
    expect((await bearer(request(h.app).get(`/api/v1/customers/${customerA.id}`), tokens['CUSTOMER'] ?? '')).status).toBe(200);
    // the DRIVER user asks for the customer's record: no customers.read and no customer profile → 403; a stranger with a profile → 404
    expect((await bearer(request(h.app).get(`/api/v1/customers/${customerA.id}`), tokens['DRIVER'] ?? '')).status).toBe(403);
    const driverA = await prisma().driverProfile.findFirstOrThrow({ where: { userId: ids['DRIVER'] ?? '' }, select: { id: true } });
    expect((await bearer(request(h.app).get(`/api/v1/drivers/${driverA.id}`), tokens['VEHICLE_OWNER'] ?? '')).status).toBe(404);
    expect((await bearer(request(h.app).get(`/api/v1/drivers/${driverA.id}`), tokens['DRIVER'] ?? '')).status).toBe(200);
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
