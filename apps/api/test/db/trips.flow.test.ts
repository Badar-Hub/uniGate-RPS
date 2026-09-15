/**
 * Phase 10 — trips and tracking against the real database:
 *   - the passenger lifecycle through the single transition endpoint, validated against the
 *     vertical's map (goods states refused with details.allowed), odometer rules, side effects:
 *     tracking session opened at DRIVER_EN_ROUTE, vehicle ON_TRIP / driver ON_TRIP, booking
 *     IN_PROGRESS at TRIP_STARTED, COMPLETED closes the session, releases the reservation,
 *     completes the booking and the order, restores IDLE / AVAILABLE
 *   - tracking: only the assigned driver may ping; no session → 422; live position on the trip
 *     and the customer's tracking read (phone only while active); sampled persistence; stale and
 *     future samples refused; batch per-item results; history; fleet reads are read_any only
 *   - room policy: customer / owner / driver may join trip:{id}, a stranger may not
 *   - ops trip cancellation cascades to an IN_PROGRESS booking and reopens the order
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { canJoinRoom } from '@/realtime/rooms.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'trips test passphrase 1';
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const ids = (rows: unknown): string[] => (rows as { id: string }[]).map((r) => r.id);
const statuses = (rows: unknown): string[] => (rows as { toStatus: string }[]).map((e) => e.toStatus);
const vehicleIds = (rows: unknown): string[] => (rows as { vehicleId: string }[]).map((v) => v.vehicleId);

describeDb('trips & tracking', () => {
  let h: Harness;
  let admin = '';
  let ops = '';
  let customer = '';
  let owner = '';
  let driver = '';
  let otherDriver = '';
  let stranger = '';
  let ownerProfileId = '';
  let driverProfileId = '';
  let busCategoryId = '';
  let riyadh = '';
  let vehicleId = '';

  async function approvedVehicle(ownerId: string, categoryId: string, seats: number): Promise<string> {
    const id = randomUUID();
    await prisma().vehicle.create({ data: { id, ownerProfileId: ownerId, vehicleCategoryId: categoryId, modelYear: 2022, plateNumberEn: `${Math.floor(Math.random() * 9000) + 1000} TRP`, registrationNumber: `REG-${id.slice(0, 6)}`, colorCode: 'WHITE', passengerCapacity: seats, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE', odometerKm: 84_000 } });
    const types = await prisma().documentType.findMany({ where: { appliesTo: 'VEHICLE', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] } });
    for (const t of types) {
      await prisma().document.create({ data: { id: randomUUID(), documentTypeCode: t.code, vehicleId: id, storageBucket: 'test', storageKey: `test/${id}/${t.code}`, originalFilename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'a'.repeat(64), uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), expiryDate: t.requiresExpiry ? new Date('2032-01-01') : null } });
    }
    return id;
  }

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@trips.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('ops@trips.test', PW, ['OPS_MANAGER']);
    await createUserWithRoles('customer@trips.test', PW, ['CUSTOMER'], 'CUSTOMER');
    await createUserWithRoles('stranger@trips.test', PW, ['CUSTOMER'], 'CUSTOMER');
    const ownerUserId = await createUserWithRoles('owner@trips.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    const driverUserId = await createUserWithRoles('driver@trips.test', PW, ['DRIVER'], 'DRIVER');
    const otherDriverUserId = await createUserWithRoles('other@trips.test', PW, ['DRIVER'], 'DRIVER');
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerUserId } })).id;
    driverProfileId = (await prisma().driverProfile.findFirstOrThrow({ where: { userId: driverUserId } })).id;
    const otherDriverProfileId = (await prisma().driverProfile.findFirstOrThrow({ where: { userId: otherDriverUserId } })).id;
    await prisma().driverProfile.updateMany({ where: { id: { in: [driverProfileId, otherDriverProfileId] } }, data: { ownerProfileId, licenseExpiryDate: new Date('2030-01-01'), availabilityStatus: 'AVAILABLE' } });
    riyadh = (await prisma().city.findFirstOrThrow({ where: { code: 'RUH' } })).id;
    busCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER', maxPassengerCapacity: { gte: 40 } }, orderBy: { sortOrder: 'asc' } })).id;
    await prisma().ownerVerticalApproval.create({ data: { id: randomUUID(), ownerProfileId, transportType: 'PASSENGER', status: 'APPROVED' } });
    await prisma().ownerServiceArea.create({ data: { ownerProfileId, cityId: riyadh } });
    vehicleId = await approvedVehicle(ownerProfileId, busCategoryId, 45);
    await prisma().vehicleDriverAssignment.create({ data: { id: randomUUID(), vehicleId, driverProfileId, isPrimary: true, assignedFrom: new Date() } });
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@trips.test', PW)).accessToken;
    ops = (await loginBearer(h.app, 'ops@trips.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@trips.test', PW)).accessToken;
    await clearThrottles();
    owner = (await loginBearer(h.app, 'owner@trips.test', PW)).accessToken;
    driver = (await loginBearer(h.app, 'driver@trips.test', PW)).accessToken;
    otherDriver = (await loginBearer(h.app, 'other@trips.test', PW)).accessToken;
    await clearThrottles();
    stranger = (await loginBearer(h.app, 'stranger@trips.test', PW)).accessToken;
  });
  afterAll(teardownHarness);

  /** Request → bid → accept → ops confirm → owner assigns the driver → READY. Returns the trip. */
  async function dispatchedTrip(pickupInHours: number): Promise<{ tripId: string; bookingId: string; tripRequestId: string }> {
    const res = await bearer(request(h.app).post('/api/v1/trip-requests'), customer).set('Idempotency-Key', randomUUID()).send({
      transportType: 'PASSENGER', vehicleCategoryId: busCategoryId, vehiclesRequired: 1, tripDirection: 'ONE_WAY', publish: true,
      pickup: { addressLine: 'King Khalid International Airport, Riyadh', cityId: riyadh, latitude: 24.95761, longitude: 46.69878 },
      dropoff: { addressLine: 'Al Faisaliah Tower, Riyadh', cityId: riyadh, latitude: 24.69056, longitude: 46.68527 },
      pickupAt: hours(pickupInHours), passengerDetails: { passengerCount: 30, tripPurpose: 'AIRPORT_TRANSFER', luggageCount: 30 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tripRequestId: string = res.body.data.id;
    const bid = await bearer(request(h.app).post('/api/v1/bids'), owner).set('Idempotency-Key', randomUUID()).send({ tripRequestId, vehicleId, baseAmount: '1000.00' });
    expect(bid.status, JSON.stringify(bid.body)).toBe(201);
    const accept = await bearer(request(h.app).post(`/api/v1/bids/${bid.body.data.id}/accept`), customer).set('Idempotency-Key', randomUUID()).send({});
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);
    const bookingId: string = accept.body.data.booking.id;
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/confirm`), admin).send({ reason: 'paid offline' })).status).toBe(200);
    const assigned = await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/assign-driver`), owner).send({ driverProfileId });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/ready`), owner).send({})).status).toBe(200);
    return { tripId: assigned.body.data.trip.id as string, bookingId, tripRequestId };
  }
  const move = (token: string, tripId: string, body: object) => bearer(request(h.app).post(`/api/v1/trips/${tripId}/status`), token).set('Idempotency-Key', randomUUID()).send(body);
  const pingAs = (token: string, body: object) => bearer(request(h.app).post('/api/v1/tracking/ping'), token).send(body);

  it('lifecycle: the vertical map, odometer rules, and every side effect from dispatch to completion', async () => {
    const { tripId, bookingId, tripRequestId } = await dispatchedTrip(60);
    const t0 = await bearer(request(h.app).get(`/api/v1/trips/${tripId}`), driver);
    expect(t0.status, JSON.stringify(t0.body)).toBe(200);
    expect(t0.body.data).toMatchObject({ status: 'DRIVER_ASSIGNED', transportType: 'PASSENGER', bookingStatus: 'READY', allowedNextStatuses: ['DRIVER_EN_ROUTE', 'CANCELLED', 'EXCEPTION'] });
    // the customer, owner and driver all see it; a stranger does not; the customer's list has it
    expect((await bearer(request(h.app).get(`/api/v1/trips/${tripId}`), customer)).status).toBe(200);
    expect((await bearer(request(h.app).get(`/api/v1/trips/${tripId}`), owner)).status).toBe(200);
    expect((await bearer(request(h.app).get(`/api/v1/trips/${tripId}`), stranger)).status).toBe(404);
    expect(ids((await bearer(request(h.app).get('/api/v1/trips'), customer)).body.data)).toContain(tripId);
    // goods states are not on a passenger trip; a stranger driver cannot move it; the customer cannot move it
    const bad = await move(driver, tripId, { status: 'LOADING' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('TRIP_INVALID_TRANSITION');
    expect(bad.body.error.details.allowed).toEqual(['DRIVER_EN_ROUTE', 'CANCELLED', 'EXCEPTION']);
    expect((await move(otherDriver, tripId, { status: 'DRIVER_EN_ROUTE' })).status).toBe(404);
    expect((await move(customer, tripId, { status: 'DRIVER_EN_ROUTE' })).status).toBe(403);
    expect((await move(driver, tripId, { status: 'DRIVER_EN_ROUTE', occurredAt: hours(2) })).status).toBe(422); // > 15 min in the future
    // pings need an ACTIVE session: none before DRIVER_EN_ROUTE
    expect((await pingAs(driver, { tripId, latitude: 24.95, longitude: 46.69, recordedAt: new Date().toISOString() })).body.error.code).toBe('TRACKING_SESSION_NOT_ACTIVE');

    const enRoute = await move(driver, tripId, { status: 'DRIVER_EN_ROUTE', latitude: 24.9, longitude: 46.7, accuracyM: 9 });
    expect(enRoute.status, JSON.stringify(enRoute.body)).toBe(200);
    expect(enRoute.body.data).toMatchObject({ status: 'DRIVER_EN_ROUTE', previousStatus: 'DRIVER_ASSIGNED', allowedNextStatuses: ['ARRIVED_AT_PICKUP', 'CANCELLED', 'EXCEPTION'] });
    expect((await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).operationalStatus).toBe('ON_TRIP');
    expect((await prisma().driverProfile.findUniqueOrThrow({ where: { id: driverProfileId } })).availabilityStatus).toBe('ON_TRIP');
    expect(await prisma().trackingSession.count({ where: { tripId, status: 'ACTIVE' } })).toBe(1);
    expect((await prisma().tripRequest.findUniqueOrThrow({ where: { id: tripRequestId } })).vehiclesDispatched).toBe(1);

    expect((await move(driver, tripId, { status: 'ARRIVED_AT_PICKUP', latitude: 24.95761, longitude: 46.69878 })).body.data.status).toBe('ARRIVED_AT_PICKUP');
    // TRIP_STARTED needs the odometer, and it cannot go backwards (vehicle is at 84,000)
    expect((await move(driver, tripId, { status: 'TRIP_STARTED' })).body.error.code).toBe('TRIP_ODOMETER_REQUIRED');
    expect((await move(driver, tripId, { status: 'TRIP_STARTED', odometerKm: 83_000 })).status).toBe(422);
    const started = await move(driver, tripId, { status: 'TRIP_STARTED', odometerKm: 84_120 });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.data.booking.status).toBe('IN_PROGRESS');
    expect((await move(driver, tripId, { status: 'ARRIVED_AT_DESTINATION' })).status).toBe(200);
    // COMPLETED closes everything
    const done = await move(driver, tripId, { status: 'COMPLETED', odometerKm: 84_162, latitude: 24.69056, longitude: 46.68527 });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', allowedNextStatuses: [], booking: { status: 'COMPLETED' } });
    const trip = await prisma().trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.actualDistanceKm?.toFixed(2)).toBe('42.00');
    expect(trip.startOdometerKm).toBe(84_120);
    expect((await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).odometerKm).toBe(84_162);
    expect((await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).operationalStatus).toBe('IDLE');
    expect((await prisma().driverProfile.findUniqueOrThrow({ where: { id: driverProfileId } })).availabilityStatus).toBe('AVAILABLE');
    expect(await prisma().trackingSession.count({ where: { tripId, status: 'ENDED' } })).toBe(1);
    expect((await prisma().$queryRaw<{ status: string }[]>`SELECT status::text FROM vehicle_calendar_entries WHERE booking_id = ${bookingId}::uuid`)[0]?.status).toBe('RELEASED');
    expect(await prisma().tripRequest.findUniqueOrThrow({ where: { id: tripRequestId } })).toMatchObject({ status: 'COMPLETED', vehiclesCompleted: 1 });
    // terminal: nothing more; a second completion is a 409
    expect((await move(driver, tripId, { status: 'COMPLETED', odometerKm: 84_200 })).body.error.code).toBe('TRIP_ALREADY_COMPLETED');
    expect((await move(driver, tripId, { status: 'DRIVER_EN_ROUTE' })).body.error.code).toBe('TRIP_NOT_ACTIVE');
    const history = await bearer(request(h.app).get(`/api/v1/trips/${tripId}/status-history`), customer);
    expect(statuses(history.body.data)).toEqual(['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'TRIP_STARTED', 'ARRIVED_AT_DESTINATION', 'COMPLETED']);
    expect(history.body.data[0]).toMatchObject({ latitude: 24.9, longitude: 46.7, accuracyM: 9 });
  });

  it('tracking: assigned driver only, sampled persistence, party reads, phone only while active, batch, history, fleet reads', async () => {
    const { tripId } = await dispatchedTrip(200);
    expect((await move(driver, tripId, { status: 'DRIVER_EN_ROUTE' })).status).toBe(200);
    const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
    // only the assigned driver; a customer holds no tracking.publish
    expect((await pingAs(otherDriver, { tripId, latitude: 24.9, longitude: 46.7, recordedAt: at(10) })).status).toBe(404);
    expect((await pingAs(customer, { tripId, latitude: 24.9, longitude: 46.7, recordedAt: at(10) })).status).toBe(403);
    // first sample persists; a second one 5 s later and 10 m away updates the live position but is not appended
    const p1 = await pingAs(driver, { tripId, latitude: 24.9000, longitude: 46.7000, accuracyM: 8, headingDeg: 180, speedKmh: 60, recordedAt: at(40) });
    expect(p1.status, JSON.stringify(p1.body)).toBe(202);
    expect(p1.body.data).toMatchObject({ accepted: true, persisted: true, lowConfidence: false });
    const p2 = await pingAs(driver, { tripId, latitude: 24.90009, longitude: 46.7000, accuracyM: 8, headingDeg: 181, speedKmh: 60, recordedAt: at(35) });
    expect(p2.body.data).toMatchObject({ accepted: true, persisted: false });
    expect(p2.body.data.sequence).toBe(p1.body.data.sequence + 1);
    // 60 m away → persisted; a big turn → persisted; a low-accuracy sample is accepted but flagged
    expect((await pingAs(driver, { tripId, latitude: 24.9006, longitude: 46.7000, accuracyM: 8, headingDeg: 181, recordedAt: at(30) })).body.data.persisted).toBe(true);
    expect((await pingAs(driver, { tripId, latitude: 24.9006, longitude: 46.7000, accuracyM: 8, headingDeg: 260, recordedAt: at(28) })).body.data.persisted).toBe(true);
    // future beyond 60 s, or older than the last persisted point beyond 5 min → stale
    expect((await pingAs(driver, { tripId, latitude: 24.9, longitude: 46.7, recordedAt: new Date(Date.now() + 120_000).toISOString() })).body.error.code).toBe('TRACKING_STALE_POINT');
    expect((await pingAs(driver, { tripId, latitude: 24.9, longitude: 46.7, recordedAt: at(900) })).body.error.code).toBe('TRACKING_STALE_POINT');

    // the customer's tracking read: position, vehicle, driver WITH phone (active), destination, socket room
    const track = await bearer(request(h.app).get(`/api/v1/tracking/trips/${tripId}`), customer);
    expect(track.status, JSON.stringify(track.body)).toBe(200);
    expect(track.body.data).toMatchObject({ tripStatus: 'DRIVER_EN_ROUTE', socket: { namespace: '/rt', room: `trip:${tripId}` } });
    expect(track.body.data.position).toMatchObject({ latitude: 24.9006, longitude: 46.7, stale: false });
    expect(track.body.data.driver.phoneE164).toMatch(/^\+966/);
    expect(track.body.data.eta).not.toBeNull();
    // a low-accuracy sample is accepted and flagged, and the ETA is withheld while it is the latest position
    expect((await pingAs(driver, { tripId, latitude: 24.9006, longitude: 46.7001, accuracyM: 900, recordedAt: at(27) })).body.data.lowConfidence).toBe(true);
    expect((await bearer(request(h.app).get(`/api/v1/tracking/trips/${tripId}`), customer)).body.data.eta).toBeNull();
    // the owner sees the position but not the driver's phone through this read; a stranger sees 404; the trip DTO carries the position too
    expect((await bearer(request(h.app).get(`/api/v1/tracking/trips/${tripId}`), owner)).body.data.driver.phoneE164).toBeNull();
    expect((await bearer(request(h.app).get(`/api/v1/tracking/trips/${tripId}`), stranger)).status).toBe(404);
    expect((await bearer(request(h.app).get(`/api/v1/trips/${tripId}`), customer)).body.data.position.longitude).toBe(46.7001);
    // batch: per-item results, one stale sample does not reject the rest
    const batch = await bearer(request(h.app).post('/api/v1/tracking/ping/batch'), driver).send({ points: [
      { tripId, latitude: 24.901, longitude: 46.7, accuracyM: 8, recordedAt: at(20) },
      { tripId, latitude: 24.9, longitude: 46.7, accuracyM: 8, recordedAt: at(2000) },
      { tripId, latitude: 24.902, longitude: 46.7, accuracyM: 8, recordedAt: at(10) },
    ] });
    expect(batch.status, JSON.stringify(batch.body)).toBe(202);
    expect(batch.body.data.acceptedCount).toBe(2);
    expect(batch.body.data.results[1]).toMatchObject({ index: 1, accepted: false, code: 'TRACKING_STALE_POINT' });
    // history is the sampled set, cursor-paginated
    const hist = await bearer(request(h.app).get(`/api/v1/tracking/trips/${tripId}/history`), customer).query({ limit: 3 });
    expect(hist.status).toBe(200);
    expect(hist.body.data).toHaveLength(3);
    expect(hist.body.meta.nextCursor).not.toBeNull();
    const page2 = await bearer(request(h.app).get(`/api/v1/tracking/trips/${tripId}/history`), customer).query({ limit: 3, cursor: hist.body.meta.nextCursor });
    expect(page2.body.data.length).toBeGreaterThanOrEqual(1);
    // fleet reads are ops-only
    expect((await bearer(request(h.app).get('/api/v1/tracking/vehicles'), owner)).status).toBe(403);
    const fleet = await bearer(request(h.app).get('/api/v1/tracking/vehicles'), ops).query({ ownerProfileId });
    expect(fleet.status, JSON.stringify(fleet.body)).toBe(200);
    expect(vehicleIds(fleet.body.data)).toContain(vehicleId);
    expect((await bearer(request(h.app).get(`/api/v1/tracking/vehicles/${vehicleId}`), ops)).body.data.operationalStatus).toBe('ON_TRIP');

    // socket room policy = the same predicate: the three parties may join, a stranger may not, and it names backfill
    const actorOf = async (email: string) => {
      const { actorFromToken } = await import('@/middleware/authenticate.js');
      const token = (await loginBearer(h.app, email, PW)).accessToken;
      return (await actorFromToken(token, 'bearer')).actor;
    };
    await clearThrottles();
    const cust = await canJoinRoom(await actorOf('customer@trips.test'), `trip:${tripId}`);
    expect(cust.ok).toBe(true);
    if (cust.ok) expect(cust.backfill.trip).toMatchObject({ status: 'DRIVER_EN_ROUTE' });
    expect((await canJoinRoom(await actorOf('driver@trips.test'), `trip:${tripId}`)).ok).toBe(true);
    await clearThrottles();
    expect((await canJoinRoom(await actorOf('stranger@trips.test'), `trip:${tripId}`)).ok).toBe(false);
    expect((await canJoinRoom(await actorOf('stranger@trips.test'), `user:${randomUUID()}`)).ok).toBe(false);

    // the trip completes → the customer no longer sees the driver's phone
    await move(driver, tripId, { status: 'ARRIVED_AT_PICKUP' });
    await move(driver, tripId, { status: 'TRIP_STARTED', odometerKm: 84_200 });
    await move(driver, tripId, { status: 'ARRIVED_AT_DESTINATION' });
    expect((await move(driver, tripId, { status: 'COMPLETED', odometerKm: 84_240 })).status).toBe(200);
    expect((await bearer(request(h.app).get(`/api/v1/tracking/trips/${tripId}`), customer)).body.data.driver.phoneE164).toBeNull();
    expect((await pingAs(driver, { tripId, latitude: 24.9, longitude: 46.7, recordedAt: new Date().toISOString() })).body.error.code).toBe('TRACKING_SESSION_NOT_ACTIVE');
    const session = await prisma().trackingSession.findFirstOrThrow({ where: { tripId } });
    expect(session.status).toBe('ENDED');
    expect(session.pointCount).toBeGreaterThanOrEqual(4);
  });

  it('ops cancellation cascades to an IN_PROGRESS booking and reopens the order; drivers cannot cancel', async () => {
    const { tripId, bookingId, tripRequestId } = await dispatchedTrip(300);
    await move(driver, tripId, { status: 'DRIVER_EN_ROUTE' });
    await move(driver, tripId, { status: 'ARRIVED_AT_PICKUP' });
    expect((await move(driver, tripId, { status: 'TRIP_STARTED', odometerKm: 84_300 })).body.data.booking.status).toBe('IN_PROGRESS');
    // the customer cannot cancel an IN_PROGRESS booking; the driver cannot cancel the trip
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/cancel`), customer).set('Idempotency-Key', randomUUID()).send({ reasonCode: 'PRICE' })).body.error.code).toBe('BOOKING_INVALID_TRANSITION');
    expect((await bearer(request(h.app).post(`/api/v1/trips/${tripId}/cancel`), driver).send({ reason: 'breakdown' })).status).toBe(403);
    expect((await move(driver, tripId, { status: 'CANCELLED' })).body.error.code).toBe('TRIP_INVALID_TRANSITION');
    const cancelled = await bearer(request(h.app).post(`/api/v1/trips/${tripId}/cancel`), ops).send({ reason: 'vehicle breakdown on the highway' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const booking = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}`), customer);
    expect(booking.body.data).toMatchObject({ status: 'CANCELLED' });
    expect(booking.body.data.cancellation).toMatchObject({ cancelledByRole: 'ADMIN', reasonCode: 'ADMIN_INTERVENTION', cancellationFeeAmount: '0.00' });
    expect(await prisma().tripRequest.findUniqueOrThrow({ where: { id: tripRequestId } })).toMatchObject({ status: 'PARTIALLY_AWARDED', vehiclesAwarded: 0, vehiclesCancelled: 1 });
    expect((await prisma().trackingSession.findFirstOrThrow({ where: { tripId } })).status).toBe('INTERRUPTED');
    expect((await prisma().vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).operationalStatus).toBe('IDLE');
  });
});
