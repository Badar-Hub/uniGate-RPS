/**
 * Phase 6 — trip requests against the real database:
 *   - creation with the passenger detail block, detail mismatch, defaults from bidding.* settings,
 *     partial-fulfilment default per vertical, goods → 501 VERTICAL_NOT_ENABLED
 *   - publish runs the matcher: only approved, dispatchable, in-area vehicles with enough seats are invited
 *   - the owner sees a redacted projection through their invitation (PARTY), strangers see 404
 *   - opportunities: list / view (marks viewed) / dismiss / undo
 *   - lifecycle: draft edit, cancel, delete draft, expiry job skips partially awarded orders
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { expireStaleRequests } from '@/modules/demand/trip-request.service.js';
import { rematchOpenRequests } from '@/modules/demand/rematch.service.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'demand test passphrase 1';
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

describeDb('demand', () => {
  let h: Harness;
  let admin = '';
  let customer = '';
  let owner = '';
  let otherOwner = '';
  let ownerProfileId = '';
  let busCategoryId = '';
  let riyadh = '';
  let jeddah = '';
  let vehicleIds: string[] = [];

  /** Creates an APPROVED, dispatchable vehicle directly (documents + approval are Phase 5's tests). */
  async function approvedVehicle(ownerId: string, categoryId: string, seats: number): Promise<string> {
    const id = randomUUID();
    await prisma().vehicle.create({ data: { id, ownerProfileId: ownerId, vehicleCategoryId: categoryId, modelYear: 2022, plateNumberEn: `${Math.floor(Math.random() * 9000) + 1000} DEM`, registrationNumber: `REG-${id.slice(0, 6)}`, colorCode: 'WHITE', passengerCapacity: seats, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE' } });
    // Verified, unexpired mandatory VEHICLE documents so the dispatchability predicate passes.
    const types = await prisma().documentType.findMany({ where: { appliesTo: 'VEHICLE', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] } });
    for (const t of types) {
      await prisma().document.create({ data: { id: randomUUID(), documentTypeCode: t.code, vehicleId: id, storageBucket: 'test', storageKey: `test/${id}/${t.code}`, originalFilename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'a'.repeat(64), uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), expiryDate: t.requiresExpiry ? new Date('2032-01-01') : null } });
    }
    return id;
  }

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@demand.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('customer@demand.test', PW, ['CUSTOMER'], 'CUSTOMER');
    const ownerUserId = await createUserWithRoles('owner@demand.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    const otherUserId = await createUserWithRoles('other@demand.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@demand.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@demand.test', PW)).accessToken;
    owner = (await loginBearer(h.app, 'owner@demand.test', PW)).accessToken;
    otherOwner = (await loginBearer(h.app, 'other@demand.test', PW)).accessToken;
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerUserId } })).id;
    const otherProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: otherUserId } })).id;
    const cities = await prisma().city.findMany({ where: { code: { in: ['RUH', 'JED'] } } });
    riyadh = cities.find((c) => c.code === 'RUH')?.id ?? cities[0]?.id ?? '';
    jeddah = cities.find((c) => c.code === 'JED')?.id ?? cities[1]?.id ?? '';
    busCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER', maxPassengerCapacity: { gte: 40 } }, orderBy: { sortOrder: 'asc' } })).id;
    // owner: approved for PASSENGER, serves Riyadh, two buses (45 and 20 seats); other owner serves Jeddah only
    await prisma().ownerVerticalApproval.createMany({ data: [{ id: randomUUID(), ownerProfileId, transportType: 'PASSENGER', status: 'APPROVED' }, { id: randomUUID(), ownerProfileId: otherProfileId, transportType: 'PASSENGER', status: 'APPROVED' }] });
    await prisma().ownerServiceArea.createMany({ data: [{ ownerProfileId, cityId: riyadh }, { ownerProfileId: otherProfileId, cityId: jeddah }] });
    vehicleIds = [await approvedVehicle(ownerProfileId, busCategoryId, 45), await approvedVehicle(ownerProfileId, busCategoryId, 20), await approvedVehicle(otherProfileId, busCategoryId, 45)];
  });
  afterAll(teardownHarness);

  const passengerBody = (over: Record<string, unknown> = {}) => ({
    transportType: 'PASSENGER',
    vehicleCategoryId: busCategoryId,
    vehiclesRequired: 1,
    tripDirection: 'ONE_WAY',
    pickup: { addressLine: 'King Khalid International Airport, Terminal 5, Riyadh', cityId: riyadh, latitude: 24.95761, longitude: 46.69878 },
    dropoff: { addressLine: 'Al Faisaliah Tower, Olaya, Riyadh', cityId: riyadh, latitude: 24.69056, longitude: 46.68527 },
    pickupAt: hours(48),
    passengerDetails: { passengerCount: 30, tripPurpose: 'AIRPORT_TRANSFER', luggageCount: 30 },
    ...over,
  });
  const post = (token: string, body: object) => bearer(request(h.app).post('/api/v1/trip-requests'), token).set('Idempotency-Key', randomUUID()).send(body);

  it('validates the vertical detail block, applies settings defaults, and refuses the disabled goods vertical', async () => {
    const mismatch = await post(customer, passengerBody({ goodsDetails: { cargoType: 'GENERAL', cargoDescription: 'boxes', cargoWeightKg: '100.00', loadingResponsibility: 'CUSTOMER', unloadingResponsibility: 'CUSTOMER' }, passengerDetails: undefined }));
    expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(422);
    expect(mismatch.body.error.code, JSON.stringify(mismatch.body)).toBe('TRIP_REQUEST_DETAIL_MISMATCH');
    const goods = await post(customer, { ...passengerBody({ transportType: 'GOODS', passengerDetails: undefined }), goodsDetails: { cargoType: 'GENERAL', cargoDescription: 'boxes', cargoWeightKg: '100.00', loadingResponsibility: 'CUSTOMER', unloadingResponsibility: 'CUSTOMER' } });
    expect(goods.status).toBe(501);
    expect(goods.body.error.code).toBe('VERTICAL_NOT_ENABLED');
    const past = await post(customer, passengerBody({ pickupAt: hours(-1) }));
    expect(past.status).toBe(422);
    const noKey = await bearer(request(h.app).post('/api/v1/trip-requests'), customer).send(passengerBody());
    expect(noKey.status).toBe(400); // Idempotency-Key is required on this route (api.md §7.1)

    const draft = await post(customer, passengerBody({ vehiclesRequired: 3 }));
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect(draft.body.data.status).toBe('DRAFT');
    expect(draft.body.data.requestNumber).toMatch(/^TR-\d{4}-\d{6}$/);
    expect(draft.body.data.allowPartialFulfilment).toBe(false); // passenger default (A-45)
    expect(draft.body.data.estimatedDistanceKm).not.toBeNull();
    expect(draft.body.data.estimatedDurationMinutes).toBeGreaterThan(0);
    // bidding closes min(pickup − 2h, now + 24h) → now + 24h here
    const closes = new Date(draft.body.data.biddingClosesAt).getTime();
    expect(closes).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(closes).toBeLessThan(Date.now() + 25 * 3_600_000);
    expect(draft.body.data.biddingOpen).toBe(false); // drafts are not open for bids

    // draft edit, then delete
    const edited = await bearer(request(h.app).patch(`/api/v1/trip-requests/${draft.body.data.id}`), customer).send({ vehiclesRequired: 2, allowPartialFulfilment: true, passengerDetails: { passengerCount: 25, tripPurpose: 'EVENT' } });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data).toMatchObject({ vehiclesRequired: 2, allowPartialFulfilment: true, passengerDetails: expect.objectContaining({ passengerCount: 25 }) });
    expect((await bearer(request(h.app).delete(`/api/v1/trip-requests/${draft.body.data.id}`), customer)).status).toBe(204);
  });

  it('publish runs the matcher; owners reach the request redacted; opportunities lifecycle', async () => {
    const created = await post(customer, passengerBody({ publish: true, specialInstructions: 'Call +966500000000 on arrival' }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id: string = created.body.data.id;
    expect(created.body.data.status).toBe('PUBLISHED');
    expect(created.body.data.biddingOpen).toBe(true);
    // 30 passengers: the 45-seat bus in Riyadh matches; the 20-seat bus does not; Jeddah owner is out of area
    expect(created.body.data.invitedOwnerCount).toBe(1);
    const invitations = await bearer(request(h.app).get(`/api/v1/trip-requests/${id}/invitations`), admin);
    expect(invitations.status).toBe(200);
    expect(invitations.body.data).toHaveLength(1);
    expect(invitations.body.data[0]).toMatchObject({ ownerProfileId, vehicleId: vehicleIds[0] });
    expect(invitations.body.data[0].matchReason.reasons).toEqual(expect.arrayContaining(['SERVICE_AREA', 'DISPATCHABLE', 'CALENDAR_FREE', 'CATEGORY_MATCH']));
    expect((await bearer(request(h.app).get(`/api/v1/trip-requests/${id}/invitations`), customer)).status).toBe(403);

    // the customer sees everything; the invited owner sees the redacted projection; a stranger sees 404
    const mine = await bearer(request(h.app).get(`/api/v1/trip-requests/${id}`), customer);
    expect(mine.body.data.redacted).toBe(false);
    expect(mine.body.data.specialInstructions).toContain('+966500000000');
    const theirs = await bearer(request(h.app).get(`/api/v1/trip-requests/${id}`), owner);
    expect(theirs.status).toBe(200);
    expect(theirs.body.data.redacted).toBe(true);
    expect(theirs.body.data.specialInstructions).toBeNull();
    expect(theirs.body.data.pickup.addressLine).not.toContain('Terminal 5');
    expect(theirs.body.data.passengerDetails.passengerCount).toBe(30);
    expect((await bearer(request(h.app).get(`/api/v1/trip-requests/${id}`), otherOwner)).status).toBe(404);
    // the customer's list is theirs only; owners list nothing here (their view is /opportunities)
    expect(((await bearer(request(h.app).get('/api/v1/trip-requests'), customer)).body.data as { id: string }[]).map((r) => r.id)).toContain(id);
    expect((await bearer(request(h.app).get('/api/v1/trip-requests'), owner)).body.data).toEqual([]);

    // opportunities
    const opps = await bearer(request(h.app).get('/api/v1/opportunities'), owner);
    expect(opps.status).toBe(200);
    expect(opps.body.data).toHaveLength(1);
    const opp = opps.body.data[0];
    expect(opp.request.id).toBe(id);
    expect(opp.request.redacted).toBe(true);
    expect((opp.eligibleVehicles as { id: string }[]).map((v) => v.id)).toEqual([vehicleIds[0]]);
    expect(opp.viewedAt).toBeNull();
    expect((await bearer(request(h.app).get('/api/v1/opportunities'), otherOwner)).body.data).toEqual([]);
    const viewed = await bearer(request(h.app).get(`/api/v1/opportunities/${opp.id}`), owner);
    expect(viewed.body.data.viewedAt).not.toBeNull();
    expect((await bearer(request(h.app).get(`/api/v1/opportunities/${opp.id}`), otherOwner)).status).toBe(404);
    const dismissed = await bearer(request(h.app).post(`/api/v1/opportunities/${opp.id}/dismiss`), owner);
    expect(dismissed.body.data.dismissedAt).not.toBeNull();
    expect((await bearer(request(h.app).get('/api/v1/opportunities'), owner)).body.data).toEqual([]);
    expect((await bearer(request(h.app).get('/api/v1/opportunities').query({ includeDismissed: 'true' }), owner)).body.data).toHaveLength(1);
    const undone = await bearer(request(h.app).post(`/api/v1/opportunities/${opp.id}/dismiss`).query({ undo: 'true' }), owner);
    expect(undone.body.data.dismissedAt).toBeNull();

    // published requests cannot be edited; cancel works and closes the opportunity
    expect((await bearer(request(h.app).patch(`/api/v1/trip-requests/${id}`), customer).send({ vehiclesRequired: 2 })).body.error.code).toBe('TRIP_REQUEST_INVALID_TRANSITION');
    expect((await bearer(request(h.app).post(`/api/v1/trip-requests/${id}/cancel`), owner).send({ reason: 'nope' })).status).toBe(403);
    const cancelled = await bearer(request(h.app).post(`/api/v1/trip-requests/${id}/cancel`), customer).send({ reason: 'Plans changed' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect((await bearer(request(h.app).get('/api/v1/opportunities'), owner)).body.data).toEqual([]);
  });

  it('late invitations: a vehicle approved or a service area added after publish still gets invited to open requests', async () => {
    const created = await post(customer, passengerBody({ publish: true }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id: string = created.body.data.id;
    // Nothing for the Jeddah owner at publish time.
    expect(((await bearer(request(h.app).get('/api/v1/opportunities'), otherOwner)).body.data as { request: { id: string } }[]).map((o) => o.request.id)).not.toContain(id);
    // 1. A brand-new bus for the Riyadh owner: nothing changes until it is approved; the approval event re-matches.
    const lateBus = await approvedVehicle(ownerProfileId, busCategoryId, 50);
    const before = await rematchOpenRequests({ vehicleId: randomUUID() }, 'test');
    expect(before.invitations).toBe(0);
    const late = await rematchOpenRequests({ vehicleId: lateBus }, 'vehicle.approved');
    expect(late.invitations).toBe(1);
    const inv = await bearer(request(h.app).get(`/api/v1/trip-requests/${id}/invitations`), admin);
    expect((inv.body.data as { vehicleId: string; matchReason: { reasons: string[] } }[]).find((i) => i.vehicleId === lateBus)?.matchReason.reasons).toContain('LATE:vehicle.approved');
    // Idempotent: running again writes nothing.
    expect((await rematchOpenRequests({ vehicleId: lateBus }, 'vehicle.approved')).invitations).toBe(0);
    // 2. The Jeddah owner adds Riyadh to their service areas → their 45-seater is invited and they see the opportunity.
    const otherProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { user: { email: 'other@demand.test' } } })).id;
    const areas = await bearer(request(h.app).put(`/api/v1/owners/${otherProfileId}/service-areas`), otherOwner).send({ cityIds: [jeddah, riyadh] });
    expect(areas.status, JSON.stringify(areas.body)).toBe(200);
    const byOwner = await rematchOpenRequests({ ownerProfileId: otherProfileId }, 'owner.service_areas_replaced');
    expect(byOwner.invitations).toBeGreaterThanOrEqual(1);
    expect(((await bearer(request(h.app).get('/api/v1/opportunities'), otherOwner)).body.data as { request: { id: string } }[]).map((o) => o.request.id)).toContain(id);
    // The newly invited owner is queued for the opportunity notification; the original owner is not re-notified.
    const events = await prisma().outboxEvent.findMany({ where: { aggregateId: id, eventType: 'trip_request.invitations_added' } });
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { invitedOwnerProfileIds: string[] }).invitedOwnerProfileIds).toEqual([otherProfileId]);
    await prisma().ownerServiceArea.deleteMany({ where: { ownerProfileId: otherProfileId, cityId: riyadh } });
  });

  it('remainder rules and the expiry job (partially awarded orders never expire)', async () => {
    const created = await post(customer, passengerBody({ vehiclesRequired: 3, allowPartialFulfilment: true, publish: true }));
    const id: string = created.body.data.id;
    // remainder endpoints are only for PARTIALLY_AWARDED
    expect((await bearer(request(h.app).post(`/api/v1/trip-requests/${id}/close-remainder`), customer).send({})).body.error.code).toBe('TRIP_REQUEST_INVALID_TRANSITION');
    // simulate Phase 7's award: two of three vehicles awarded
    await prisma().tripRequest.update({ where: { id }, data: { status: 'PARTIALLY_AWARDED', vehiclesAwarded: 2 } });
    expect((await bearer(request(h.app).patch(`/api/v1/trip-requests/${id}/remainder`), customer).send({ vehiclesRequired: 1 })).body.error.code).toBe('RULE_VEHICLES_REQUIRED_BELOW_AWARDED');
    expect((await bearer(request(h.app).post(`/api/v1/trip-requests/${id}/cancel`), customer).send({ reason: 'changed my mind' })).body.error.code).toBe('TRIP_REQUEST_INVALID_TRANSITION');
    // deadline passed: the expiry job must leave the partially awarded order alone…
    await prisma().tripRequest.update({ where: { id }, data: { biddingClosesAt: new Date(Date.now() - 1000) } });
    const stale = await post(customer, passengerBody({ publish: true }));
    await prisma().tripRequest.update({ where: { id: stale.body.data.id }, data: { biddingClosesAt: new Date(Date.now() - 1000) } });
    const n = await expireStaleRequests();
    expect(n).toBe(1);
    expect((await prisma().tripRequest.findUniqueOrThrow({ where: { id } })).status).toBe('PARTIALLY_AWARDED');
    expect((await prisma().tripRequest.findUniqueOrThrow({ where: { id: stale.body.data.id } })).status).toBe('EXPIRED');
    // …the balance stays biddable until the customer closes it
    const still = await bearer(request(h.app).get(`/api/v1/trip-requests/${id}`), customer);
    expect(still.body.data.biddingOpen).toBe(true);
    const shrunk = await bearer(request(h.app).patch(`/api/v1/trip-requests/${id}/remainder`), customer).send({ vehiclesRequired: 2 });
    expect(shrunk.body.data.status).toBe('FULLY_AWARDED');
    await prisma().tripRequest.update({ where: { id }, data: { status: 'PARTIALLY_AWARDED', vehiclesRequired: 3 } });
    const closed = await bearer(request(h.app).post(`/api/v1/trip-requests/${id}/close-remainder`), admin).send({ reason: 'customer asked by phone' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('CLOSED_PARTIAL');
    expect(closed.body.data.biddingOpen).toBe(false);
    const audit = await prisma().auditLog.findFirst({ where: { action: 'trip_request.remainder_closed', entityId: id } });
    expect(audit?.afterValue).toMatchObject({ actedFor: 'customer' });
  });
});
