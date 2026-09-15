/**
 * Vendor onboarding & access control (UniGate 2026-09-15) against the real database:
 *   - only admins add vendors: public registration with intent VEHICLE_OWNER is refused unless
 *     `onboarding.owner_self_registration_enabled` is on; POST /admin/vendors creates the account,
 *     the owner profile and the verticals applied for, and hands the admin a one-time activation link
 *   - the vendor activates through the link, signs in, and cannot register vehicles yet
 *   - documents drive the review queue: once every mandatory document is uploaded the profile moves
 *     to DOCUMENTS_SUBMITTED by itself; approval is refused until staff verified each document
 *   - per-vendor access: GET/PUT /users/{id}/permissions layer GRANT/DENY overrides on the role
 *     (step-up protected, no self-modification, no granting what the admin does not hold) and the
 *     effective set takes effect on the vendor's next request
 *   - vehicles: registered only by an approved vendor, enter PENDING_APPROVAL by themselves when their
 *     documents are in, and are approved only once staff verified them — then they are dispatchable
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { onOwnerDocumentsChanged } from '@/modules/profiles/owner.service.js';
import { onVehicleDocumentsChanged } from '@/modules/fleet/vehicle.service.js';
import { invalidateSettingCache } from '@/modules/reference/settings.service.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'vendors test passphrase 1';
const VENDOR_PW = 'Riyadh buses strong passphrase 2026';
const ids = (rows: unknown): string[] => (rows as { id: string }[]).map((r) => r.id);
const byCode = (rows: unknown, code: string) => (rows as { code: string }[]).find((p) => p.code === code);

describeDb('vendor onboarding & access', () => {
  let h: Harness;
  let admin = '';
  let ops = '';
  let adminUserId = '';

  async function setSetting(key: string, value: unknown): Promise<void> {
    await prisma().systemSetting.update({ where: { key }, data: { value: value as never } });
    invalidateSettingCache(key);
  }
  async function stepUp(token: string, actionClass: string): Promise<string> {
    await clearThrottles();
    const req = await bearer(request(h.app).post('/api/v1/auth/step-up'), token).send({ actionClass });
    expect(req.status, JSON.stringify(req.body)).toBe(200);
    const ver = await bearer(request(h.app).post('/api/v1/auth/step-up/verify'), token).send({ actionClass, code: h.otp.last('SENSITIVE_ACTION') });
    expect(ver.status, JSON.stringify(ver.body)).toBe(200);
    return ver.body.data.stepUpToken as string;
  }
  /** The vendor "uploads" a document: an UPLOADED row awaiting verification, then the hook the confirm step calls. */
  async function upload(target: { ownerProfileId?: string; vehicleId?: string }, code: string): Promise<string> {
    const id = randomUUID();
    await prisma().document.create({ data: { id, documentTypeCode: code, ...target, storageBucket: 'test', storageKey: `test/${id}`, originalFilename: `${code}.pdf`, mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'a'.repeat(64), uploadStatus: 'UPLOADED', verificationStatus: 'PENDING', expiryDate: new Date('2032-01-01') } });
    if (target.ownerProfileId) await onOwnerDocumentsChanged(target.ownerProfileId);
    if (target.vehicleId) await onVehicleDocumentsChanged(target.vehicleId);
    return id;
  }

  beforeAll(async () => {
    h = await bootHarness();
    adminUserId = await createUserWithRoles('admin@vendors.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('ops@vendors.test', PW, ['OPS_MANAGER']);
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@vendors.test', PW)).accessToken;
    ops = (await loginBearer(h.app, 'ops@vendors.test', PW)).accessToken;
  });
  afterAll(teardownHarness);

  it('vendors are added by admins, activate through the link, are reviewed from their documents, then register an approved fleet', async () => {
    // public self-registration as a vendor is a switch, off by default
    const selfReg = (body: object) => request(h.app).post('/api/v1/auth/register').send({ intent: 'VEHICLE_OWNER', phoneE164: '+966599000111', email: 'self@vendors.test', password: 'Public form strong passphrase 1', fullNameEn: 'Public Applicant', acceptedTermsVersion: '1.0', ...body });
    const off = await selfReg({});
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('OWNER_SELF_REGISTRATION_DISABLED');
    await setSetting('onboarding.owner_self_registration_enabled', true);
    const on = await selfReg({});
    expect(on.status, JSON.stringify(on.body)).toBe(201);
    await setSetting('onboarding.owner_self_registration_enabled', false);

    // ops (no users.create) cannot add vendors; an admin can — and receives the activation link once
    expect((await bearer(request(h.app).post('/api/v1/admin/vendors'), ops).send({ email: 'najd@vendors.test', fullNameEn: 'Najd Fleet Co', ownerType: 'COMPANY' })).status).toBe(403);
    const created = await bearer(request(h.app).post('/api/v1/admin/vendors'), admin).send({ email: 'najd@vendors.test', phoneE164: '+966599000222', fullNameEn: 'Najd Fleet Co', ownerType: 'COMPANY', businessNameEn: 'Najd Fleet', crNumber: '1010999999', transportTypes: ['PASSENGER'] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.owner).toMatchObject({ onboardingStatus: 'DRAFT', ownerType: 'COMPANY', businessNameEn: 'Najd Fleet' });
    expect(created.body.data.user.roles).toEqual(['VEHICLE_OWNER']);
    expect(created.body.data.activationUrl).toMatch(/\/reset-password\?token=/);
    const ownerProfileId: string = created.body.data.owner.id;
    const vendorUserId: string = created.body.data.user.id;
    expect((await bearer(request(h.app).post('/api/v1/admin/vendors'), admin).send({ email: 'najd@vendors.test', fullNameEn: 'Dup', ownerType: 'COMPANY' })).body.error.code).toBe('AUTH_IDENTIFIER_TAKEN');

    // activation: the link's token sets the password; the vendor signs in and sees a DRAFT owner profile
    const token = new URL(created.body.data.activationUrl).searchParams.get('token') ?? '';
    const activated = await request(h.app).post('/api/v1/auth/password/reset').send({ token, newPassword: VENDOR_PW });
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    await clearThrottles();
    const vendor = (await loginBearer(h.app, 'najd@vendors.test', VENDOR_PW)).accessToken;
    const me = await bearer(request(h.app).get('/api/v1/me'), vendor);
    expect(me.body.data.profiles.owner).toMatchObject({ id: ownerProfileId, onboardingStatus: 'DRAFT' });
    const busCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER', maxPassengerCapacity: { gte: 40 } }, orderBy: { sortOrder: 'asc' } })).id;
    const vehicleBody = { vehicleCategoryId: busCategoryId, modelYear: 2023, plateNumberEn: '7777 NJD', registrationNumber: 'REG-NJD-1', colorCode: 'WHITE', passengerCapacity: 45 };
    const tooEarly = await bearer(request(h.app).post('/api/v1/vehicles'), vendor).send(vehicleBody);
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.error.code).toBe('OWNER_NOT_APPROVED');

    // documents drive the queue: after the last mandatory document the profile is DOCUMENTS_SUBMITTED by itself
    const mandatory = await prisma().documentType.findMany({ where: { appliesTo: 'OWNER', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] }, select: { code: true } });
    expect(mandatory.length).toBeGreaterThan(1);
    const docIds: string[] = [];
    for (const [i, t] of mandatory.entries()) {
      docIds.push(await upload({ ownerProfileId }, t.code));
      const status = (await prisma().ownerProfile.findUniqueOrThrow({ where: { id: ownerProfileId } })).onboardingStatus;
      expect(status, `after document ${i + 1}/${mandatory.length}`).toBe(i === mandatory.length - 1 ? 'DOCUMENTS_SUBMITTED' : 'DRAFT');
    }
    const queue = await bearer(request(h.app).get('/api/v1/owners'), admin).query({ onboardingStatus: 'DOCUMENTS_SUBMITTED' });
    expect(ids(queue.body.data)).toContain(ownerProfileId);
    // approval needs every document verified first
    const early = await bearer(request(h.app).post(`/api/v1/owners/${ownerProfileId}/approve`), admin).send({});
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('OWNER_DOCUMENTS_INCOMPLETE');
    for (const id of docIds) expect((await bearer(request(h.app).post(`/api/v1/documents/${id}/verify`), admin).send({})).status).toBe(200);
    const approved = await bearer(request(h.app).post(`/api/v1/owners/${ownerProfileId}/approve`), admin).send({ notes: 'documents checked' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.onboardingStatus).toBe('APPROVED');

    // per-vendor access: overrides on top of the role; no self-modification; only what the admin holds; step-up protected
    const before = await bearer(request(h.app).get(`/api/v1/users/${vendorUserId}/permissions`), admin);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.data.roles).toEqual(['VEHICLE_OWNER']);
    expect(before.body.data.effective).toContain('bids.create');
    expect(before.body.data.granted).toEqual([]);
    expect(byCode(before.body.data.catalogue, 'bids.create')).toMatchObject({ module: 'bids', action: 'create' });
    expect((await bearer(request(h.app).put(`/api/v1/users/${vendorUserId}/permissions`), admin).send({ deny: ['bids.create'] })).status).toBe(403); // step-up required
    const step = await stepUp(admin, 'ROLE_CHANGE');
    expect((await bearer(request(h.app).put(`/api/v1/users/${adminUserId}/permissions`), admin).set('X-Step-Up-Token', step).send({ deny: ['bids.create'] })).body.error.code).toBe('PERM_SELF_MODIFICATION');
    const opsStep = await stepUp(ops, 'ROLE_CHANGE').catch(() => '');
    if (opsStep) expect((await bearer(request(h.app).put(`/api/v1/users/${vendorUserId}/permissions`), ops).set('X-Step-Up-Token', opsStep).send({ grant: ['reports.financial.read'] })).status).toBe(403);
    const set = await bearer(request(h.app).put(`/api/v1/users/${vendorUserId}/permissions`), admin).set('X-Step-Up-Token', await stepUp(admin, 'ROLE_CHANGE')).send({ deny: ['bids.create', 'expenses.delete'], grant: ['reports.read'], note: 'trial vendor: no bidding yet' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.data).toMatchObject({ granted: ['reports.read'], denied: ['bids.create', 'expenses.delete'] });
    expect(set.body.data.effective).not.toContain('bids.create');
    expect(set.body.data.effective).toContain('reports.read');
    // takes effect on the vendor's next request without re-login
    const denied = await bearer(request(h.app).post('/api/v1/bids'), vendor).set('Idempotency-Key', randomUUID()).send({ tripRequestId: randomUUID(), vehicleId: randomUUID(), baseAmount: '100.00' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PERM_DENIED');
    const restored = await bearer(request(h.app).put(`/api/v1/users/${vendorUserId}/permissions`), admin).set('X-Step-Up-Token', await stepUp(admin, 'ROLE_CHANGE')).send({});
    expect(restored.body.data.effective).toContain('bids.create');

    // fleet: register (now allowed), documents complete → PENDING_APPROVAL by itself, approval needs verification, then dispatchable
    const vehicle = await bearer(request(h.app).post('/api/v1/vehicles'), vendor).send(vehicleBody);
    expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(201);
    const vehicleId: string = vehicle.body.data.id;
    expect(vehicle.body.data.approvalStatus).toBe('DRAFT');
    const vehicleTypes = await prisma().documentType.findMany({ where: { appliesTo: 'VEHICLE', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] }, select: { code: true } });
    const vehicleDocs: string[] = [];
    for (const t of vehicleTypes) vehicleDocs.push(await upload({ vehicleId }, t.code));
    expect((await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).approvalStatus).toBe('PENDING_APPROVAL');
    const earlyVehicle = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/approve`), admin).send({});
    expect(earlyVehicle.status).toBe(422);
    expect(earlyVehicle.body.error.code).toBe('VEHICLE_DOCUMENTS_INCOMPLETE');
    for (const id of vehicleDocs) expect((await bearer(request(h.app).post(`/api/v1/documents/${id}/verify`), admin).send({})).status).toBe(200);
    const vehicleApproved = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/approve`), admin).send({});
    expect(vehicleApproved.status, JSON.stringify(vehicleApproved.body)).toBe(200);
    expect(vehicleApproved.body.data).toMatchObject({ approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE' });
  });
});
