/**
 * Phase 12 — maintenance against the real database:
 *   - a PLANNED record holds a MAINTENANCE entry on the vehicle calendar in the same transaction;
 *     an owner block over the window is refused (409 VEHICLE_CALENDAR_CONFLICT) and a record over
 *     an existing block is refused the other way (409 MAINTENANCE_CALENDAR_CONFLICT, conflicts named)
 *   - start → IN_PROGRESS and the vehicle UNDER_MAINTENANCE; complete → hold released, odometer
 *     forward (never backwards), vehicle IDLE, the matching schedule rolled forward, the cost booked
 *     as a MAINTENANCE expense of the owner; completed records are immutable
 *   - schedules: create (one active per vehicle × service type), patch recomputes next-due,
 *     /maintenance/due lists by date / km with the overdue flag, deactivate
 *   - delete: PLANNED only, staff only; owners never see each other's records (404)
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'maintenance test passphrase 1';
interface Due { scheduleId: string; kmUntilDue: number | null }
const dueIds = (rows: unknown): string[] => (rows as Due[]).map((d) => d.scheduleId);
const dueFor = (rows: unknown, id: string): Due | undefined => (rows as Due[]).find((d) => d.scheduleId === id);
const day = (n: number) => new Date(Date.UTC(2031, 0, 10 + n)).toISOString();

describeDb('maintenance', () => {
  let h: Harness;
  let admin = '';
  let owner = '';
  let otherOwner = '';
  let ownerProfileId = '';
  let vehicleId = '';
  let oilId = '';
  let tyresId = '';

  async function vehicle(ownerId: string, odometerKm: number): Promise<string> {
    const id = randomUUID();
    const categoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER' }, orderBy: { sortOrder: 'asc' } })).id;
    await prisma().vehicle.create({ data: { id, ownerProfileId: ownerId, vehicleCategoryId: categoryId, modelYear: 2022, plateNumberEn: `${Math.floor(Math.random() * 9000) + 1000} MNT`, registrationNumber: `REG-${id.slice(0, 6)}`, colorCode: 'WHITE', passengerCapacity: 4, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE', odometerKm } });
    return id;
  }

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@maintenance.test', PW, ['SUPER_ADMIN']);
    const ownerUserId = await createUserWithRoles('owner@maintenance.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    const otherUserId = await createUserWithRoles('other@maintenance.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerUserId } })).id;
    const otherProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: otherUserId } })).id;
    vehicleId = await vehicle(ownerProfileId, 40_000);
    await vehicle(otherProfileId, 1_000);
    oilId = (await prisma().maintenanceServiceType.findFirstOrThrow({ where: { code: 'OIL_CHANGE' } })).id;
    tyresId = (await prisma().maintenanceServiceType.findFirstOrThrow({ where: { code: 'TYRE_ROTATION' } })).id;
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@maintenance.test', PW)).accessToken;
    owner = (await loginBearer(h.app, 'owner@maintenance.test', PW)).accessToken;
    otherOwner = (await loginBearer(h.app, 'other@maintenance.test', PW)).accessToken;
  });
  afterAll(teardownHarness);

  it('record lifecycle: calendar hold both ways, start, complete (odometer, schedule, expense), immutability', async () => {
    // A schedule on the same service type — completion rolls it forward.
    const sched = await bearer(request(h.app).post('/api/v1/maintenance/schedules'), owner).send({ vehicleId, maintenanceServiceTypeId: oilId, intervalKm: 10_000, intervalDays: 180, lastServiceAt: '2030-12-01T00:00:00.000Z', lastServiceOdometerKm: 35_000 });
    expect(sched.status, JSON.stringify(sched.body)).toBe(201);
    expect(sched.body.data.nextDueOdometerKm).toBe(45_000);
    expect(sched.body.data.nextDueAt).toBe('2031-05-30T00:00:00.000Z');
    const dup = await bearer(request(h.app).post('/api/v1/maintenance/schedules'), owner).send({ vehicleId, maintenanceServiceTypeId: oilId, intervalKm: 5_000 });
    expect(dup.status).toBe(409);

    // Another owner's vehicle is invisible.
    const foreign = await bearer(request(h.app).post('/api/v1/maintenance/records'), otherOwner).send({ vehicleId, maintenanceServiceTypeId: oilId, maintenanceKind: 'SCHEDULED', scheduledStartAt: day(0), scheduledEndAt: day(1) });
    expect(foreign.status).toBe(404);

    const created = await bearer(request(h.app).post('/api/v1/maintenance/records'), owner).send({
      vehicleId, maintenanceServiceTypeId: oilId, maintenanceKind: 'SCHEDULED', scheduledStartAt: day(0), scheduledEndAt: day(1), costAmount: '350.00', vatAmount: '52.50', workshopName: 'Al Futtaim Service', partsReplaced: [{ name: 'Oil filter', quantity: 1, amount: '45.00' }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data.status).toBe('PLANNED');
    expect(created.body.data.totalAmount).toBe('402.50');
    expect(created.body.data.calendarEntryId).not.toBeNull();
    expect(created.body.data.partsReplaced).toEqual([{ name: 'Oil filter', quantity: 1, amount: '45.00' }]);

    // The hold is a real calendar entry: an owner block over it is refused …
    const blocked = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/calendar/blocks`), owner).send({ from: day(0), to: day(1) });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('VEHICLE_CALENDAR_CONFLICT');
    // … and a record over an existing block is refused the other way, naming the conflict.
    const block = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/calendar/blocks`), owner).send({ from: day(5), to: day(6), notes: 'family use' });
    expect(block.status).toBe(201);
    const clash = await bearer(request(h.app).post('/api/v1/maintenance/records'), owner).send({ vehicleId, maintenanceServiceTypeId: tyresId, maintenanceKind: 'REPAIR', scheduledStartAt: day(5), scheduledEndAt: day(7) });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('MAINTENANCE_CALENDAR_CONFLICT');
    expect(clash.body.error.details.conflicts[0].entryId).toBe(block.body.data.id);
    expect(await prisma().maintenanceRecord.count({ where: { vehicleId, maintenanceServiceTypeId: tyresId } })).toBe(0);
    // Moving the window onto the block 409s too and leaves the original hold in place.
    const moved = await bearer(request(h.app).patch(`/api/v1/maintenance/records/${id}`), owner).send({ scheduledStartAt: day(5), scheduledEndAt: day(6) });
    expect(moved.status).toBe(409);
    expect((await bearer(request(h.app).get(`/api/v1/maintenance/records/${id}`), owner)).body.data.scheduledStartAt).toBe(day(0));

    // Other owners: 404 on read; staff: visible through read_any.
    expect((await bearer(request(h.app).get(`/api/v1/maintenance/records/${id}`), otherOwner)).status).toBe(404);
    expect((await bearer(request(h.app).get(`/api/v1/maintenance/records/${id}`), admin)).status).toBe(200);
    const list = await bearer(request(h.app).get('/api/v1/maintenance/records'), owner).query({ vehicleId, status: 'PLANNED' });
    expect(list.body.meta.totalItems).toBe(1);

    // Both open states may complete; a completed one cannot start again.
    const started = await bearer(request(h.app).post(`/api/v1/maintenance/records/${id}/start`), owner);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.data.status).toBe('IN_PROGRESS');
    expect((await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).operationalStatus).toBe('UNDER_MAINTENANCE');
    expect((await bearer(request(h.app).post(`/api/v1/maintenance/records/${id}/start`), owner)).body.error.code).toBe('MAINTENANCE_INVALID_TRANSITION');

    const backwards = await bearer(request(h.app).post(`/api/v1/maintenance/records/${id}/complete`), owner).send({ odometerKm: 39_000 });
    expect(backwards.status).toBe(422);
    expect(backwards.body.error.code).toBe('VALIDATION_FAILED');

    const done = await bearer(request(h.app).post(`/api/v1/maintenance/records/${id}/complete`), owner).send({ odometerKm: 41_200, costAmount: '380.00', vatAmount: '57.00', notes: 'Synthetic 5W-30' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.totalAmount).toBe('437.00');
    expect(done.body.data.calendarEntryId).toBeNull();
    const v = await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(v.odometerKm).toBe(41_200);
    expect(v.operationalStatus).toBe('IDLE');
    // The window is free again.
    expect((await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/calendar/blocks`), owner).send({ from: day(0), to: day(1) })).status).toBe(201);
    // The schedule rolled forward from the actual service.
    const rolled = await prisma().maintenanceSchedule.findUniqueOrThrow({ where: { id: sched.body.data.id } });
    expect(rolled.lastServiceOdometerKm).toBe(41_200);
    expect(rolled.nextDueOdometerKm).toBe(51_200);
    expect(rolled.lastServiceAt).not.toBeNull();
    expect(rolled.nextDueAt?.getTime()).toBe((rolled.lastServiceAt?.getTime() ?? 0) + 180 * 86_400_000);
    // The cost is an expense of the owner in the MAINTENANCE category.
    const expenses = await bearer(request(h.app).get('/api/v1/expenses'), owner).query({ vehicleId });
    expect(expenses.status).toBe(200);
    expect(expenses.body.data).toHaveLength(1);
    expect(expenses.body.data[0].amount).toBe('380.00');
    expect(expenses.body.data[0].vatAmount).toBe('57.00');
    expect(expenses.body.data[0].categoryCode).toBe('MAINTENANCE');
    expect(expenses.body.data[0].vendorName).toBe('Al Futtaim Service');

    // Completed is final.
    expect((await bearer(request(h.app).patch(`/api/v1/maintenance/records/${id}`), owner).send({ costAmount: '1.00' })).body.error.code).toBe('MAINTENANCE_INVALID_TRANSITION');
    expect((await bearer(request(h.app).post(`/api/v1/maintenance/records/${id}/cancel`), owner).send({ reason: 'changed my mind' })).status).toBe(422);
    expect((await bearer(request(h.app).delete(`/api/v1/maintenance/records/${id}`), admin)).status).toBe(422);
  });

  it('cancel releases the hold; delete is PLANNED-only and staff-only', async () => {
    const rec = await bearer(request(h.app).post('/api/v1/maintenance/records'), owner).send({ vehicleId, maintenanceServiceTypeId: tyresId, maintenanceKind: 'REPAIR', status: 'IN_PROGRESS', scheduledStartAt: day(10), scheduledEndAt: day(12) });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(rec.body.data.status).toBe('IN_PROGRESS');
    expect(rec.body.data.actualStartAt).not.toBeNull();
    expect((await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).operationalStatus).toBe('UNDER_MAINTENANCE');
    const cancelled = await bearer(request(h.app).post(`/api/v1/maintenance/records/${rec.body.data.id}/cancel`), owner).send({ reason: 'workshop closed' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.calendarEntryId).toBeNull();
    expect((await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).operationalStatus).toBe('IDLE');
    // No expense for a cancelled job.
    expect((await bearer(request(h.app).get('/api/v1/expenses'), owner).query({ vehicleId })).body.data).toHaveLength(1);

    const planned = await bearer(request(h.app).post('/api/v1/maintenance/records'), owner).send({ vehicleId, maintenanceServiceTypeId: tyresId, maintenanceKind: 'INSPECTION', scheduledStartAt: day(20), scheduledEndAt: day(21) });
    expect(planned.status).toBe(201);
    // Owners hold maintenance.delete but not read_any — delete is staff's.
    expect((await bearer(request(h.app).delete(`/api/v1/maintenance/records/${planned.body.data.id}`), owner)).status).toBe(403);
    expect((await bearer(request(h.app).delete(`/api/v1/maintenance/records/${planned.body.data.id}`), admin)).status).toBe(204);
    expect((await bearer(request(h.app).get(`/api/v1/maintenance/records/${planned.body.data.id}`), admin)).status).toBe(404);
    expect(await prisma().vehicleCalendarEntry.count({ where: { vehicleId, entryType: 'MAINTENANCE' } })).toBe(0);
  });

  it('schedules: patch recomputes next-due, /due by date and km with the overdue flag, deactivate', async () => {
    // Tyres every 20 000 km — the vehicle is at 41 200, last service at 25 000 → due at 45 000, 3 800 km away.
    const tyres = await bearer(request(h.app).post('/api/v1/maintenance/schedules'), owner).send({ vehicleId, maintenanceServiceTypeId: tyresId, intervalKm: 20_000, lastServiceOdometerKm: 25_000 });
    expect(tyres.status, JSON.stringify(tyres.body)).toBe(201);
    expect(tyres.body.data.nextDueOdometerKm).toBe(45_000);
    expect(tyres.body.data.nextDueAt).toBeNull();

    const far = await bearer(request(h.app).get('/api/v1/maintenance/due'), owner).query({ withinDays: 30, withinKm: 1_000 });
    expect(far.status).toBe(200);
    expect(dueIds(far.body.data)).not.toContain(tyres.body.data.id);
    const near = await bearer(request(h.app).get('/api/v1/maintenance/due'), owner).query({ withinDays: 30, withinKm: 5_000 });
    const hit = dueFor(near.body.data, tyres.body.data.id);
    expect(hit).toMatchObject({ kmUntilDue: 3_800, currentOdometerKm: 41_200, overdue: false, daysUntilDue: null });

    // A shorter interval puts it overdue by km.
    const patched = await bearer(request(h.app).patch(`/api/v1/maintenance/schedules/${tyres.body.data.id}`), owner).send({ intervalKm: 10_000 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.nextDueOdometerKm).toBe(35_000);
    const overdue = await bearer(request(h.app).get('/api/v1/maintenance/due'), owner).query({ overdueOnly: true });
    expect(dueIds(overdue.body.data)).toContain(tyres.body.data.id);
    expect(dueFor(overdue.body.data, tyres.body.data.id)?.kmUntilDue).toBe(-6_200);
    // Neither interval is a validation error.
    expect((await bearer(request(h.app).patch(`/api/v1/maintenance/schedules/${tyres.body.data.id}`), owner).send({ intervalKm: null })).status).toBe(422);
    // Other owners cannot see it; staff can.
    expect((await bearer(request(h.app).patch(`/api/v1/maintenance/schedules/${tyres.body.data.id}`), otherOwner).send({ intervalKm: 30_000 })).status).toBe(404);
    expect((await bearer(request(h.app).get('/api/v1/maintenance/schedules'), admin).query({ ownerProfileId })).body.meta.totalItems).toBe(2);

    expect((await bearer(request(h.app).delete(`/api/v1/maintenance/schedules/${tyres.body.data.id}`), owner)).status).toBe(204);
    expect((await bearer(request(h.app).get('/api/v1/maintenance/schedules'), owner).query({ isActive: true })).body.meta.totalItems).toBe(1);
    expect(dueIds((await bearer(request(h.app).get('/api/v1/maintenance/due'), owner).query({ overdueOnly: true })).body.data)).not.toContain(tyres.body.data.id);
  });
});
