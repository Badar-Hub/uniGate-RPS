/**
 * Phase 13b — ratings and complaints against the real database:
 *   - eligibility: only COMPLETED bookings, only parties in the claimed role (a stranger gets
 *     404, never 403), only inside `booking.rating_window_days`, only subjects the role may
 *     rate; once per subject (409); published ratings feed the subject's aggregate columns;
 *     /ratings/eligible drives the prompt; moderation hides and recomputes; non-moderators
 *     see PUBLISHED only
 *   - complaints: raise (booking party check → 404), CMP number, SLA respond-by from settings,
 *     raisers see their own, staff see all; assign stops the SLA clock; status lifecycle with a
 *     required resolution; internal notes never leave the manager projection; a raiser reply
 *     to AWAITING_RESPONSE hands it back; notifications land for the raiser
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { handleDomainEvent } from '@/modules/notifications/event.subscribers.js';
import { invalidateSettingCache } from '@/modules/reference/settings.service.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'engagement test passphrase 1';
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
interface Note { isInternal: boolean; body: string }
interface Subject { subjectType: string; alreadyRated: boolean }
interface Eligible { bookingId: string; subjects: Subject[] }
const subjectsOf = (rows: unknown, i = 0): Subject[] => (rows as Eligible[])[i]?.subjects ?? [];
const bookingIdsOf = (rows: unknown): string[] => (rows as Eligible[]).map((b) => b.bookingId);

describeDb('engagement', () => {
  let h: Harness;
  let admin = '';
  let ops = '';
  let customer = '';
  let stranger = '';
  let owner = '';
  let ownerUserId = '';
  let customerUserId = '';
  let ownerProfileId = '';
  let customerProfileId = '';
  let vehicleId = '';
  let busCategoryId = '';
  let riyadh = '';

  async function approvedVehicle(ownerId: string, categoryId: string): Promise<string> {
    const id = randomUUID();
    await prisma().vehicle.create({ data: { id, ownerProfileId: ownerId, vehicleCategoryId: categoryId, modelYear: 2022, plateNumberEn: `${Math.floor(Math.random() * 9000) + 1000} ENG`, registrationNumber: `REG-${id.slice(0, 6)}`, colorCode: 'WHITE', passengerCapacity: 45, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE' } });
    const types = await prisma().documentType.findMany({ where: { appliesTo: 'VEHICLE', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] } });
    for (const t of types) {
      await prisma().document.create({ data: { id: randomUUID(), documentTypeCode: t.code, vehicleId: id, storageBucket: 'test', storageKey: `test/${id}/${t.code}`, originalFilename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'a'.repeat(64), uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), expiryDate: t.requiresExpiry ? new Date('2032-01-01') : null } });
    }
    return id;
  }
  const key = () => randomUUID();
  /** Request → bid → accept → booking, then completed `ago` days ago (Phase 10 covers the transitions). */
  async function completedBooking(ago: number): Promise<string> {
    const res = await bearer(request(h.app).post('/api/v1/trip-requests'), customer).set('Idempotency-Key', key()).send({
      transportType: 'PASSENGER', vehicleCategoryId: busCategoryId, vehiclesRequired: 1, tripDirection: 'ONE_WAY', publish: true,
      pickup: { addressLine: 'King Khalid International Airport, Riyadh', cityId: riyadh, latitude: 24.95761, longitude: 46.69878 },
      dropoff: { addressLine: 'Al Faisaliah Tower, Riyadh', cityId: riyadh, latitude: 24.69056, longitude: 46.68527 },
      pickupAt: hours(48), passengerDetails: { passengerCount: 30, tripPurpose: 'AIRPORT_TRANSFER', luggageCount: 30 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const bid = await bearer(request(h.app).post('/api/v1/bids'), owner).set('Idempotency-Key', key()).send({ tripRequestId: res.body.data.id, vehicleId, baseAmount: '1000.00' });
    expect(bid.status, JSON.stringify(bid.body)).toBe(201);
    const accept = await bearer(request(h.app).post(`/api/v1/bids/${bid.body.data.id}/accept`), customer).set('Idempotency-Key', key()).send({});
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);
    const bookingId = accept.body.data.booking.id as string;
    await prisma().booking.update({ where: { id: bookingId }, data: { status: 'COMPLETED', completedAt: daysAgo(ago) } });
    await prisma().vehicleCalendarEntry.deleteMany({ where: { bookingId } });
    return bookingId;
  }

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@eng.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('ops@eng.test', PW, ['OPS_MANAGER']);
    customerUserId = await createUserWithRoles('customer@eng.test', PW, ['CUSTOMER'], 'CUSTOMER');
    await createUserWithRoles('stranger@eng.test', PW, ['CUSTOMER'], 'CUSTOMER');
    ownerUserId = await createUserWithRoles('owner@eng.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerUserId } })).id;
    customerProfileId = (await prisma().customerProfile.findFirstOrThrow({ where: { userId: customerUserId } })).id;
    riyadh = (await prisma().city.findFirstOrThrow({ where: { code: 'RUH' } })).id;
    busCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER', maxPassengerCapacity: { gte: 40 } }, orderBy: { sortOrder: 'asc' } })).id;
    await prisma().ownerVerticalApproval.create({ data: { id: randomUUID(), ownerProfileId, transportType: 'PASSENGER', status: 'APPROVED' } });
    await prisma().ownerServiceArea.create({ data: { ownerProfileId, cityId: riyadh } });
    vehicleId = await approvedVehicle(ownerProfileId, busCategoryId);
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@eng.test', PW)).accessToken;
    ops = (await loginBearer(h.app, 'ops@eng.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@eng.test', PW)).accessToken;
    stranger = (await loginBearer(h.app, 'stranger@eng.test', PW)).accessToken;
    await clearThrottles();
    owner = (await loginBearer(h.app, 'owner@eng.test', PW)).accessToken;
  });
  afterAll(teardownHarness);

  it('ratings: eligibility, once per subject, aggregates, the prompt, moderation, visibility', async () => {
    const bookingId = await completedBooking(1);
    // Strangers get 404 (never 403); the owner cannot rate itself as CUSTOMER.
    const strangerRes = await bearer(request(h.app).post('/api/v1/ratings'), stranger).send({ bookingId, raterRole: 'CUSTOMER', subjectType: 'VEHICLE', subjectId: vehicleId, score: 5 });
    expect(strangerRes.status).toBe(404);
    expect((await bearer(request(h.app).post('/api/v1/ratings'), owner).send({ bookingId, raterRole: 'CUSTOMER', subjectType: 'VEHICLE', subjectId: vehicleId, score: 5 })).status).toBe(404);
    // The customer may not rate the customer.
    const wrongSubject = await bearer(request(h.app).post('/api/v1/ratings'), customer).send({ bookingId, raterRole: 'CUSTOMER', subjectType: 'CUSTOMER', subjectId: customerProfileId, score: 5 });
    expect(wrongSubject.status).toBe(422);
    expect(wrongSubject.body.error.code).toBe('RATING_SUBJECT_INVALID');

    const eligible = await bearer(request(h.app).get('/api/v1/ratings/eligible'), customer);
    expect(eligible.status).toBe(200);
    expect(eligible.body.data).toHaveLength(1);
    expect(eligible.body.data[0]).toMatchObject({ bookingId, raterRole: 'CUSTOMER' });
    expect(subjectsOf(eligible.body.data).map((s) => s.subjectType).sort()).toEqual(['OWNER', 'VEHICLE']);

    const rated = await bearer(request(h.app).post('/api/v1/ratings'), customer).send({ bookingId, raterRole: 'CUSTOMER', subjectType: 'VEHICLE', subjectId: vehicleId, score: 4, comment: 'Clean bus, on time.' });
    expect(rated.status, JSON.stringify(rated.body)).toBe(201);
    expect(rated.body.data).toMatchObject({ score: 4, status: 'PUBLISHED', subjectType: 'VEHICLE', raterDisplayName: 'customer@eng.test' });
    const again = await bearer(request(h.app).post('/api/v1/ratings'), customer).send({ bookingId, raterRole: 'CUSTOMER', subjectType: 'VEHICLE', subjectId: vehicleId, score: 1 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('RATING_ALREADY_SUBMITTED');
    // The aggregate columns and the summary agree.
    const v = await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(v.ratingCount).toBe(1);
    expect(v.ratingAvg.toFixed(2)).toBe('4.00');
    const summary = await bearer(request(h.app).get('/api/v1/ratings/summary'), owner).query({ subjectType: 'VEHICLE', subjectId: vehicleId });
    expect(summary.body.data).toMatchObject({ ratingAvg: '4.00', ratingCount: 1, histogram: { '4': 1 } });
    // The owner rates the customer back; the prompt no longer lists the vehicle for the customer.
    const back = await bearer(request(h.app).post('/api/v1/ratings'), owner).send({ bookingId, raterRole: 'OWNER', subjectType: 'CUSTOMER', subjectId: customerProfileId, score: 5 });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect((await prisma().customerProfile.findUniqueOrThrow({ where: { id: customerProfileId } })).ratingCount).toBe(1);
    const left = await bearer(request(h.app).get('/api/v1/ratings/eligible'), customer);
    expect(subjectsOf(left.body.data).find((s) => s.subjectType === 'VEHICLE')?.alreadyRated).toBe(true);

    // Window: a booking completed 20 days ago is closed (window 14).
    const old = await completedBooking(20);
    const closed = await bearer(request(h.app).post('/api/v1/ratings'), customer).send({ bookingId: old, raterRole: 'CUSTOMER', subjectType: 'VEHICLE', subjectId: vehicleId, score: 5 });
    expect(closed.status).toBe(422);
    expect(closed.body.error.code).toBe('RATING_WINDOW_CLOSED');
    expect(bookingIdsOf((await bearer(request(h.app).get('/api/v1/ratings/eligible'), customer)).body.data)).not.toContain(old);

    // Low scores with a comment go to review when the setting says so.
    await prisma().systemSetting.update({ where: { key: 'booking.rating_review_below_score' }, data: { value: 2 as never } });
    invalidateSettingCache('booking.rating_review_below_score');
    const low = await bearer(request(h.app).post('/api/v1/ratings'), customer).send({ bookingId, raterRole: 'CUSTOMER', subjectType: 'OWNER', subjectId: ownerProfileId, score: 1, comment: 'Rude on the phone.' });
    expect(low.status).toBe(201);
    expect(low.body.data.status).toBe('PENDING_REVIEW');
    expect((await prisma().ownerProfile.findUniqueOrThrow({ where: { id: ownerProfileId } })).ratingCount).toBe(0);
    // Non-moderators see PUBLISHED only; the moderator sees the pending one and publishes it.
    expect((await bearer(request(h.app).get('/api/v1/ratings'), owner).query({ subjectType: 'OWNER', subjectId: ownerProfileId })).body.meta.totalItems).toBe(0);
    expect((await bearer(request(h.app).get('/api/v1/ratings'), ops).query({ subjectType: 'OWNER', subjectId: ownerProfileId, status: 'PENDING_REVIEW' })).body.meta.totalItems).toBe(1);
    expect((await bearer(request(h.app).post(`/api/v1/ratings/${low.body.data.id}/moderate`), owner).send({ status: 'PUBLISHED', reason: 'x' })).status).toBe(403);
    const published = await bearer(request(h.app).post(`/api/v1/ratings/${low.body.data.id}/moderate`), admin).send({ status: 'PUBLISHED', reason: 'Factual, not abusive' });
    expect(published.status).toBe(200);
    expect((await prisma().ownerProfile.findUniqueOrThrow({ where: { id: ownerProfileId } })).ratingCount).toBe(1);
    expect((await bearer(request(h.app).delete(`/api/v1/ratings/${low.body.data.id}`), admin)).status).toBe(204);
    expect((await prisma().ownerProfile.findUniqueOrThrow({ where: { id: ownerProfileId } })).ratingCount).toBe(0);
    expect(await prisma().auditLog.count({ where: { entityType: 'rating', action: 'rating.moderated' } })).toBe(2);
  });

  it('complaints: raise, SLA, visibility, assignment, lifecycle, internal notes, notifications', async () => {
    const bookingId = await completedBooking(1);
    // Unknown category and a booking the raiser is not party to are refused.
    expect((await bearer(request(h.app).post('/api/v1/complaints'), customer).send({ againstType: 'DRIVER', category: 'NOT_A_CATEGORY', subject: 'Late', description: 'The driver arrived forty minutes late.', bookingId })).status).toBe(422);
    expect((await bearer(request(h.app).post('/api/v1/complaints'), stranger).send({ againstType: 'DRIVER', category: 'DELAY', subject: 'Late', description: 'The driver arrived forty minutes late.', bookingId })).status).toBe(404);

    const raised = await bearer(request(h.app).post('/api/v1/complaints'), customer).send({ againstType: 'DRIVER', category: 'DELAY', subject: 'Driver was late', description: 'The driver arrived forty minutes after the agreed pickup time.', bookingId, severity: 'HIGH' });
    expect(raised.status, JSON.stringify(raised.body)).toBe(201);
    const id = raised.body.data.id as string;
    expect(raised.body.data.complaintNumber).toMatch(/^CMP-\d{4}-\d{6}$/);
    expect(raised.body.data).toMatchObject({ status: 'OPEN', severity: 'HIGH', bookingId, overdue: false });
    // HIGH → respond within 24 h (settings).
    expect(new Date(raised.body.data.respondBy).getTime() - new Date(raised.body.data.createdAt).getTime()).toBe(24 * 3_600_000);
    // The raiser's acknowledgement lands in the inbox via the subscriber.
    await handleDomainEvent({ id: randomUUID(), eventType: 'complaint.raised', aggregateType: 'complaint', aggregateId: id, payload: { complaintNumber: raised.body.data.complaintNumber, raisedByUserId: customerUserId, subject: 'Driver was late' } });
    expect(await prisma().notification.count({ where: { userId: customerUserId, templateCode: 'COMPLAINT_RECEIVED', channel: 'IN_APP' } })).toBe(1);

    // Visibility: raiser sees own; staff sees all; strangers 404; the owner cannot see it either.
    expect((await bearer(request(h.app).get(`/api/v1/complaints/${id}`), customer)).status).toBe(200);
    expect((await bearer(request(h.app).get(`/api/v1/complaints/${id}`), stranger)).status).toBe(404);
    expect((await bearer(request(h.app).get(`/api/v1/complaints/${id}`), owner)).status).toBe(404);
    expect((await bearer(request(h.app).get('/api/v1/complaints'), ops).query({ severity: 'HIGH' })).body.meta.totalItems).toBe(1);
    expect((await bearer(request(h.app).get('/api/v1/complaints'), stranger)).body.meta.totalItems).toBe(0);

    // Internal note by ops: invisible to the raiser; the raiser cannot write one.
    const opsUserId = (await prisma().user.findFirstOrThrow({ where: { email: 'ops@eng.test' } })).id;
    expect((await bearer(request(h.app).post(`/api/v1/complaints/${id}/notes`), customer).send({ body: 'sneaky', isInternal: true })).status).toBe(403);
    const internal = await bearer(request(h.app).post(`/api/v1/complaints/${id}/notes`), ops).send({ body: 'Checked the tracking log: 38 minutes late.', isInternal: true });
    expect(internal.status).toBe(201);
    expect((internal.body.data.notes as Note[]).filter((n) => n.isInternal)).toHaveLength(1);
    expect((await bearer(request(h.app).get(`/api/v1/complaints/${id}`), customer)).body.data.notes).toHaveLength(0);
    expect((await bearer(request(h.app).get(`/api/v1/complaints/${id}/notes`), customer)).body.data).toHaveLength(0);

    // Assignment stops the SLA clock (OPEN → IN_REVIEW).
    const assigned = await bearer(request(h.app).post(`/api/v1/complaints/${id}/assign`), ops).send({ assignedToUserId: opsUserId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data).toMatchObject({ status: 'IN_REVIEW', assignedToUserId: opsUserId, assignedToName: 'ops@eng.test', respondBy: null });

    // Lifecycle: resolve needs a resolution; AWAITING_RESPONSE → raiser reply hands it back; RESOLVED → CLOSED is final.
    const noRes = await bearer(request(h.app).post(`/api/v1/complaints/${id}/status`), ops).send({ status: 'RESOLVED' });
    expect(noRes.status).toBe(422);
    expect(noRes.body.error.code).toBe('COMPLAINT_RESOLUTION_REQUIRED');
    expect((await bearer(request(h.app).post(`/api/v1/complaints/${id}/status`), ops).send({ status: 'CLOSED' })).body.error.code).toBe('COMPLAINT_INVALID_TRANSITION');
    const waiting = await bearer(request(h.app).post(`/api/v1/complaints/${id}/status`), ops).send({ status: 'AWAITING_RESPONSE' });
    expect(waiting.body.data.status).toBe('AWAITING_RESPONSE');
    const reply = await bearer(request(h.app).post(`/api/v1/complaints/${id}/notes`), customer).send({ body: 'Yes, he called to say the previous trip overran.' });
    expect(reply.status).toBe(201);
    expect(reply.body.data.status).toBe('IN_REVIEW');
    expect((reply.body.data.notes as Note[]).map((n) => n.isInternal)).toEqual([false]);
    const resolved = await bearer(request(h.app).post(`/api/v1/complaints/${id}/status`), ops).send({ status: 'RESOLVED', resolution: 'Owner reminded of punctuality terms; 10% goodwill credit applied.', note: 'Credit posted manually.' });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(resolved.body.data).toMatchObject({ status: 'RESOLVED', resolution: 'Owner reminded of punctuality terms; 10% goodwill credit applied.' });
    expect(resolved.body.data.resolvedAt).not.toBeNull();
    expect((resolved.body.data.notes as Note[]).filter((n) => n.isInternal)).toHaveLength(2);
    expect((await bearer(request(h.app).post(`/api/v1/complaints/${id}/status`), ops).send({ status: 'CLOSED' })).body.data.status).toBe('CLOSED');
    expect((await bearer(request(h.app).post(`/api/v1/complaints/${id}/notes`), customer).send({ body: 'thanks' })).status).toBe(422);
    expect(await prisma().outboxEvent.count({ where: { aggregateId: id, eventType: 'complaint.resolved' } })).toBe(1);
    expect(await prisma().auditLog.count({ where: { entityType: 'complaint', entityId: id } })).toBeGreaterThanOrEqual(5);
  });
});
