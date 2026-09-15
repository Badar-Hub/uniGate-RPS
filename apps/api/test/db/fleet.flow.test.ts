/**
 * Phase 5 — fleet against the real database (and MinIO for the vehicle documents):
 *   - registration with capacity validated by the category's vertical; plate/VIN uniqueness
 *   - submit-for-approval gated on verified mandatory VEHICLE documents; approve; identity edit → re-approval
 *   - dispatchability predicate and the availability window
 *   - calendar: owner blocks, the EXCLUDE overlap guarantee under N concurrent inserts (exit criterion), release
 *   - driver assignments: primary replacement closes the previous row, history is never overwritten
 *   - scope: another owner's vehicle is 404
 */
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'fleet test passphrase 1';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describeDb('fleet', () => {
  let h: Harness;
  let admin = '';
  let owner = '';
  let otherOwner = '';
  let busCategoryId = '';
  let vehicleId = '';

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@fleet.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('owner@fleet.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    await createUserWithRoles('other@fleet.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@fleet.test', PW)).accessToken;
    owner = (await loginBearer(h.app, 'owner@fleet.test', PW)).accessToken;
    otherOwner = (await loginBearer(h.app, 'other@fleet.test', PW)).accessToken;
    busCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER', maxPassengerCapacity: { gte: 40 } }, orderBy: { sortOrder: 'asc' } })).id;
  });
  afterAll(teardownHarness);

  async function upload(token: string, documentTypeCode: string, target: { kind: string; id: string }, bytes: Buffer, mimeType: string, extra: Record<string, unknown> = {}) {
    const url = await bearer(request(h.app).post('/api/v1/documents/upload-url'), token).send({ documentTypeCode, target, originalFilename: `x.${mimeType.split('/')[1]}`, mimeType, sizeBytes: bytes.length, checksumSha256: sha(bytes), ...extra });
    expect(url.status, JSON.stringify(url.body)).toBe(201);
    const put = await fetch(url.body.data.upload.url, { method: 'PUT', headers: url.body.data.upload.headers, body: bytes });
    expect(put.status).toBe(200);
    return bearer(request(h.app).post(`/api/v1/documents/${url.body.data.documentId}/confirm`), token).set('Idempotency-Key', randomUUID()).send({ checksumSha256: sha(bytes) });
  }

  it('reference catalogue is public and cacheable', async () => {
    const cats = await request(h.app).get('/api/v1/vehicle-categories').query({ transportType: 'PASSENGER' });
    expect(cats.status).toBe(200);
    const etag = String(cats.headers['etag']);
    expect(etag).toMatch(/^"/);
    expect(cats.headers['cache-control']).toContain('public');
    expect(cats.body.data.length).toBeGreaterThan(0);
    const again = await request(h.app).get('/api/v1/vehicle-categories').query({ transportType: 'PASSENGER' }).set('If-None-Match', etag);
    expect(again.status).toBe(304);
    const makes = await request(h.app).get('/api/v1/reference/vehicle-makes');
    const makeRows = makes.body.data as { id: string; name: string }[];
    expect(makeRows.some((m) => m.name === 'Toyota')).toBe(true);
    const models = await request(h.app).get('/api/v1/reference/vehicle-models').query({ makeId: makeRows.find((m) => m.name === 'Toyota')?.id });
    expect((models.body.data as { name: string }[]).some((m) => m.name === 'Coaster')).toBe(true);
    // writes need reference.manage
    expect((await bearer(request(h.app).post('/api/v1/reference/vehicle-makes'), owner).send({ name: 'Tata' })).status).toBe(403);
    expect((await bearer(request(h.app).post('/api/v1/reference/vehicle-makes'), admin).send({ name: 'Tata' })).status).toBe(201);
  });

  it('registers a vehicle in DRAFT with vertical-validated capacity and unique plate/VIN', async () => {
    const noSeats = await bearer(request(h.app).post('/api/v1/vehicles'), owner).send({ vehicleCategoryId: busCategoryId, modelYear: 2022, plateNumberEn: '1234 ABC', registrationNumber: 'REG-1', colorCode: 'WHITE', payloadCapacityKg: 500 });
    expect(noSeats.status).toBe(422);
    expect(noSeats.body.error.details.fieldErrors).toHaveProperty('passengerCapacity');

    const created = await bearer(request(h.app).post('/api/v1/vehicles'), owner).send({ vehicleCategoryId: busCategoryId, modelYear: 2022, plateNumberEn: '1234 ABC', plateNumberAr: '١٢٣٤ أ ب ج', registrationNumber: 'REG-1', vin: 'JT1234567890ABCDE', colorCode: 'WHITE', passengerCapacity: 45, insuranceExpiryDate: '2032-01-01' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    vehicleId = created.body.data.id;
    expect(created.body.data.approvalStatus).toBe('DRAFT');
    expect(created.body.data.dispatchable.ok).toBe(false);
    expect(created.body.data.dispatchable.reasons).toContain('VEHICLE_NOT_APPROVED');
    expect(created.body.data.vin).toBe('JT1234567890ABCDE');

    // same plate with different spacing/case → 409; same VIN → 409
    const dupPlate = await bearer(request(h.app).post('/api/v1/vehicles'), otherOwner).send({ vehicleCategoryId: busCategoryId, modelYear: 2021, plateNumberEn: '1234abc', registrationNumber: 'REG-2', colorCode: 'BLUE', passengerCapacity: 45 });
    expect(dupPlate.status).toBe(409);
    expect(dupPlate.body.error.code).toBe('VEHICLE_PLATE_TAKEN');
    const dupVin = await bearer(request(h.app).post('/api/v1/vehicles'), otherOwner).send({ vehicleCategoryId: busCategoryId, modelYear: 2021, plateNumberEn: '9999 XYZ', registrationNumber: 'REG-3', vin: 'JT1234567890ABCDE', colorCode: 'BLUE', passengerCapacity: 45 });
    expect(dupVin.body.error.code).toBe('VEHICLE_VIN_TAKEN');

    // other owner cannot see it; staff sees it via vehicles.read_any; VIN masked for nobody here (staff sees it)
    expect((await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}`), otherOwner)).status).toBe(404);
    expect((await bearer(request(h.app).get('/api/v1/vehicles'), otherOwner)).body.data).toEqual([]);
    const staff = await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}`), admin);
    expect(staff.status).toBe(200);
  });

  it('approval is gated on verified vehicle documents; identity edits after approval re-open it', async () => {
    const early = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/submit-for-approval`), owner);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('VEHICLE_DOCUMENTS_INCOMPLETE');
    expect((early.body.error.details.missing as string[]).join(',')).toContain('VEHICLE_REGISTRATION');

    for (const [code, bytes, mime, extra] of [
      ['VEHICLE_REGISTRATION', PDF, 'application/pdf', { expiryDate: '2032-01-01' }],
      ['VEHICLE_INSURANCE', PDF, 'application/pdf', { expiryDate: '2032-01-01' }],
      ['VEHICLE_INSPECTION', PDF, 'application/pdf', { expiryDate: '2032-01-01' }],
      ['VEHICLE_OPERATING_CARD', PDF, 'application/pdf', { expiryDate: '2032-01-01' }],
      ['VEHICLE_PHOTO_FRONT', PNG, 'image/png', {}],
      ['VEHICLE_PHOTO_SIDE', PNG, 'image/png', {}],
    ] as const) {
      const up = await upload(owner, code, { kind: 'VEHICLE', id: vehicleId }, bytes, mime, extra);
      expect(up.status, JSON.stringify(up.body)).toBe(200);
      const v = await bearer(request(h.app).post(`/api/v1/documents/${up.body.data.id}/verify`), admin).send({});
      expect(v.status).toBe(200);
    }
    const submitted = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/submit-for-approval`), owner);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.data.approvalStatus).toBe('PENDING_APPROVAL');
    expect((await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/approve`), owner).send({})).status).toBe(403);
    const approved = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/approve`), admin).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.data.approvalStatus).toBe('APPROVED');
    expect(approved.body.data.dispatchable).toEqual({ ok: true, reasons: [] });

    const replate = await bearer(request(h.app).patch(`/api/v1/vehicles/${vehicleId}`), owner).send({ plateNumberEn: '5678 DEF' });
    expect(replate.body.data.approvalStatus).toBe('PENDING_APPROVAL');
    await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/approve`), admin).send({});
    const colour = await bearer(request(h.app).patch(`/api/v1/vehicles/${vehicleId}`), owner).send({ colorCode: 'SILVER' });
    expect(colour.body.data.approvalStatus).toBe('APPROVED');
  });

  it('calendar: owner blocks, the EXCLUDE guarantee under concurrent inserts, availability, release', async () => {
    const from = '2030-03-01T08:00:00.000Z';
    const to = '2030-03-03T08:00:00.000Z';
    const block = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/calendar/blocks`), owner).send({ from, to, notes: 'workshop' });
    expect(block.status, JSON.stringify(block.body)).toBe(201);
    expect(block.body.data).toMatchObject({ entryType: 'OWNER_BLOCK', status: 'CONFIRMED', period: { from, to } });

    // overlapping block → 409 with the blocking entry named
    const overlap = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/calendar/blocks`), owner).send({ from: '2030-03-02T00:00:00.000Z', to: '2030-03-05T00:00:00.000Z' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('VEHICLE_CALENDAR_CONFLICT');
    expect(overlap.body.error.details.conflicts[0].entryId).toBe(block.body.data.id);
    // adjacent ([) half-open) is fine
    const adjacent = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/calendar/blocks`), owner).send({ from: to, to: '2030-03-04T08:00:00.000Z' });
    expect(adjacent.status).toBe(201);

    // N concurrent inserts for one free window: exactly one wins, the rest are 409 (Phase 5 exit criterion)
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () => bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/calendar/blocks`), owner).send({ from: '2030-04-01T00:00:00.000Z', to: '2030-04-02T00:00:00.000Z' })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(N - 1);
    const live = await prisma().$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM vehicle_calendar_entries WHERE vehicle_id = ${vehicleId}::uuid AND status <> 'RELEASED' AND period && tstzrange('2030-04-01', '2030-04-02', '[)')`;
    expect(Number(live[0]?.n)).toBe(1);

    // availability answers the bid form
    const busy = await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}/availability`), owner).query({ from: '2030-03-02T00:00:00.000Z', to: '2030-03-02T12:00:00.000Z' });
    expect(busy.body.data.available).toBe(false);
    expect(busy.body.data.conflicts).toHaveLength(1);
    const free = await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}/availability`), owner).query({ from: '2030-05-01T00:00:00.000Z', to: '2030-05-02T00:00:00.000Z' });
    expect(free.body.data).toMatchObject({ available: true, conflicts: [], dispatchable: { ok: true } });
    // documents expiring inside the window make it unavailable
    const later = await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}/availability`), owner).query({ from: '2030-05-01T00:00:00.000Z', to: '2033-05-02T00:00:00.000Z' });
    expect(later.body.data.available).toBe(false);
    expect(later.body.data.expiringDocuments.length).toBeGreaterThan(0);

    const cal = await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}/calendar`), owner).query({ from: '2030-03-01T00:00:00.000Z', to: '2030-04-30T00:00:00.000Z' });
    expect(cal.body.data).toHaveLength(3);
    expect((await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}/calendar`), otherOwner).query({ from, to })).status).toBe(404);

    const released = await bearer(request(h.app).delete(`/api/v1/vehicles/${vehicleId}/calendar/blocks/${block.body.data.id}`), owner);
    expect(released.status).toBe(204);
    const nowFree = await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}/availability`), owner).query({ from: '2030-03-02T00:00:00.000Z', to: '2030-03-02T12:00:00.000Z' });
    expect(nowFree.body.data.available).toBe(true);
  });

  it('driver assignments: approved drivers only, primary replacement closes the previous row, history kept', async () => {
    const mk = async (phone: string) => {
      const c = await bearer(request(h.app).post('/api/v1/drivers'), owner).send({ fullNameEn: `Driver ${phone.slice(-2)}`, phoneE164: phone, idType: 'NATIONAL_ID', nationalId: `10000000${phone.slice(-2)}`, licenseNumber: `LIC000${phone.slice(-2)}`, licenseExpiryDate: '2030-06-30', licenseCategories: ['B'] });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      return c.body.data.id as string;
    };
    const d1 = await mk('+966588888801');
    const d2 = await mk('+966588888802');
    const unapproved = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/drivers`), owner).send({ driverProfileId: d1, isPrimary: true });
    expect(unapproved.status).toBe(422);
    expect(unapproved.body.error.code).toBe('DRIVER_NOT_APPROVED');
    for (const d of [d1, d2]) {
      for (const [code, bytes, mime, extra] of [['DRIVER_LICENCE', PDF, 'application/pdf', { expiryDate: '2030-06-30' }], ['DRIVER_TGA_CARD_PASSENGER', PDF, 'application/pdf', { expiryDate: '2030-06-30' }], ['DRIVER_PHOTO', PNG, 'image/png', {}]] as const) {
        const up = await upload(owner, code, { kind: 'DRIVER', id: d }, bytes, mime, extra);
        await bearer(request(h.app).post(`/api/v1/documents/${up.body.data.id}/verify`), admin).send({});
      }
      expect((await bearer(request(h.app).post(`/api/v1/drivers/${d}/approve`), admin).send({})).status).toBe(200);
    }
    const a1 = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/drivers`), owner).send({ driverProfileId: d1, isPrimary: true });
    expect(a1.status).toBe(201);
    const a2 = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/drivers`), owner).send({ driverProfileId: d2, isPrimary: true });
    expect(a2.status).toBe(201);
    const history = await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}/drivers`), owner);
    expect(history.body.data).toHaveLength(2);
    const first = (history.body.data as { id: string; assignedTo: string | null; unassignedReason: string }[]).find((a) => a.id === a1.body.data.id);
    expect(first?.assignedTo).not.toBeNull();
    expect(first?.unassignedReason).toBe('REPLACED_AS_PRIMARY');
    const v = await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}`), owner);
    expect(v.body.data.currentDrivers).toEqual([expect.objectContaining({ driverProfileId: d2, isPrimary: true })]);
    // the other owner cannot assign onto this vehicle (404), and cannot assign our driver to theirs
    expect((await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/drivers`), otherOwner).send({ driverProfileId: d2 })).status).toBe(404);
    const done = await bearer(request(h.app).delete(`/api/v1/vehicles/${vehicleId}/drivers/${a2.body.data.id}`), owner).send({ reason: 'holiday' });
    expect(done.status).toBe(204);
    expect((await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}/drivers`), owner)).body.data).toHaveLength(2);
  });

  it('suspend/reactivate flip dispatchability; delete is a soft archive', async () => {
    const suspended = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/suspend`), admin).send({ reason: 'insurance query' });
    expect(suspended.body.data.lifecycleStatus).toBe('SUSPENDED');
    expect(suspended.body.data.dispatchable.reasons).toContain('VEHICLE_SUSPENDED');
    expect((await bearer(request(h.app).patch(`/api/v1/vehicles/${vehicleId}`), owner).send({ lifecycleStatus: 'ACTIVE' })).status).toBe(422);
    const back = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/reactivate`), admin).send({});
    expect(back.body.data.dispatchable.ok).toBe(true);
    expect((await bearer(request(h.app).delete(`/api/v1/vehicles/${vehicleId}`), owner)).status).toBe(204);
    expect((await bearer(request(h.app).get(`/api/v1/vehicles/${vehicleId}`), owner)).status).toBe(404);
    const row = await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.lifecycleStatus).toBe('ARCHIVED');
    // the plate is free again for a new registration
    expect((await bearer(request(h.app).post('/api/v1/vehicles'), otherOwner).send({ vehicleCategoryId: busCategoryId, modelYear: 2021, plateNumberEn: '5678 DEF', registrationNumber: 'REG-9', colorCode: 'BLUE', passengerCapacity: 45 })).status).toBe(201);
  });
});
