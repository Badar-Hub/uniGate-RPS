/**
 * Phase 8 — bookings against the real database:
 *   - reads: customer / owner / driver / staff projections, filters by tripRequestId, status history, financials by role
 *   - cancellation: quote and cancel share one function; a tiered customer policy charges by notice; the
 *     no-cancel window refuses; reason codes are role-gated; an admin override and a waive are audited;
 *     the reservation is RELEASED and the order reopens (vehicles_awarded--, vehicles_cancelled++)
 *   - dispatch: ops confirm, assign-driver validation (approved, assigned to the vehicle, no overlap),
 *     trip row created, ready; transition map enforced
 *   - payment-window sweeper cancels an unpaid PREPAID booking and reopens the request; INVOICED untouched
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { expireUnpaidBookings } from '@/modules/bookings/booking.service.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'bookings test passphrase 1';
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const ids = (rows: unknown): string[] => (rows as { id: string }[]).map((b) => b.id);
const statuses = (rows: unknown): string[] => (rows as { toStatus: string }[]).map((e) => e.toStatus);

describeDb('bookings', () => {
  let h: Harness;
  let admin = '';
  let customer = '';
  let owner = '';
  let otherOwner = '';
  let driver = '';
  let ownerProfileId = '';
  let driverProfileId = '';
  let busCategoryId = '';
  let riyadh = '';
  let vehicleId = '';
  let vehicle2Id = '';

  async function approvedVehicle(ownerId: string, categoryId: string, seats: number): Promise<string> {
    const id = randomUUID();
    await prisma().vehicle.create({ data: { id, ownerProfileId: ownerId, vehicleCategoryId: categoryId, modelYear: 2022, plateNumberEn: `${Math.floor(Math.random() * 9000) + 1000} BKG`, registrationNumber: `REG-${id.slice(0, 6)}`, colorCode: 'WHITE', passengerCapacity: seats, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE' } });
    const types = await prisma().documentType.findMany({ where: { appliesTo: 'VEHICLE', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] } });
    for (const t of types) {
      await prisma().document.create({ data: { id: randomUUID(), documentTypeCode: t.code, vehicleId: id, storageBucket: 'test', storageKey: `test/${id}/${t.code}`, originalFilename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'a'.repeat(64), uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), expiryDate: t.requiresExpiry ? new Date('2032-01-01') : null } });
    }
    return id;
  }

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@bookings.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('customer@bookings.test', PW, ['CUSTOMER'], 'CUSTOMER');
    const ownerUserId = await createUserWithRoles('owner@bookings.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    const otherUserId = await createUserWithRoles('other@bookings.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    const driverUserId = await createUserWithRoles('driver@bookings.test', PW, ['DRIVER'], 'DRIVER');
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerUserId } })).id;
    const otherProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: otherUserId } })).id;
    driverProfileId = (await prisma().driverProfile.findFirstOrThrow({ where: { userId: driverUserId } })).id;
    await prisma().driverProfile.update({ where: { id: driverProfileId }, data: { ownerProfileId, licenseExpiryDate: new Date('2030-01-01') } });
    riyadh = (await prisma().city.findFirstOrThrow({ where: { code: 'RUH' } })).id;
    busCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER', maxPassengerCapacity: { gte: 40 } }, orderBy: { sortOrder: 'asc' } })).id;
    for (const p of [ownerProfileId, otherProfileId]) {
      await prisma().ownerVerticalApproval.create({ data: { id: randomUUID(), ownerProfileId: p, transportType: 'PASSENGER', status: 'APPROVED' } });
      await prisma().ownerServiceArea.create({ data: { ownerProfileId: p, cityId: riyadh } });
    }
    vehicleId = await approvedVehicle(ownerProfileId, busCategoryId, 45);
    vehicle2Id = await approvedVehicle(ownerProfileId, busCategoryId, 45);
    await approvedVehicle(otherProfileId, busCategoryId, 45);
    // A tiered customer policy so the quote has something to show (the seed charges nothing): ≥72h free, ≥24h 10 %, else 25 %; no cancellation inside 2h.
    await prisma().cancellationPolicy.updateMany({
      where: { scope: 'GLOBAL', eventType: 'CANCELLATION', cancelledByRole: 'CUSTOMER', isActive: true },
      data: { name: 'test tiered', tiers: [{ minHoursBeforePickup: 72, chargeType: 'NONE' }, { minHoursBeforePickup: 24, chargeType: 'PERCENTAGE', value: '10' }, { minHoursBeforePickup: 0, chargeType: 'PERCENTAGE', value: '25' }], noCancelWindowHours: 2 },
    });
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@bookings.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@bookings.test', PW)).accessToken;
    owner = (await loginBearer(h.app, 'owner@bookings.test', PW)).accessToken;
    await clearThrottles();
    otherOwner = (await loginBearer(h.app, 'other@bookings.test', PW)).accessToken;
    driver = (await loginBearer(h.app, 'driver@bookings.test', PW)).accessToken;
  });
  afterAll(teardownHarness);

  /** Publishes a request, has the owner bid, accepts → one booking. */
  async function book(pickupInHours: number, vehicle = vehicleId, vehiclesRequired = 1): Promise<{ bookingId: string; tripRequestId: string }> {
    const res = await bearer(request(h.app).post('/api/v1/trip-requests'), customer).set('Idempotency-Key', randomUUID()).send({
      transportType: 'PASSENGER', vehicleCategoryId: busCategoryId, vehiclesRequired, allowPartialFulfilment: vehiclesRequired > 1, tripDirection: 'ONE_WAY', publish: true,
      pickup: { addressLine: 'King Khalid International Airport, Riyadh', cityId: riyadh, latitude: 24.95761, longitude: 46.69878 },
      dropoff: { addressLine: 'Al Faisaliah Tower, Riyadh', cityId: riyadh, latitude: 24.69056, longitude: 46.68527 },
      pickupAt: hours(pickupInHours), passengerDetails: { passengerCount: 30, tripPurpose: 'AIRPORT_TRANSFER', luggageCount: 30 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tripRequestId: string = res.body.data.id;
    const bid = await bearer(request(h.app).post('/api/v1/bids'), owner).set('Idempotency-Key', randomUUID()).send({ tripRequestId, vehicleId: vehicle, baseAmount: '1000.00' });
    expect(bid.status, JSON.stringify(bid.body)).toBe(201);
    const accept = await bearer(request(h.app).post(`/api/v1/bids/${bid.body.data.id}/accept`), customer).set('Idempotency-Key', randomUUID()).send({});
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);
    return { bookingId: accept.body.data.booking.id as string, tripRequestId };
  }
  const cancel = (token: string, id: string, body: object) => bearer(request(h.app).post(`/api/v1/bookings/${id}/cancel`), token).set('Idempotency-Key', randomUUID()).send(body);

  it('reads: projections per party, filters, status history, financials by role', async () => {
    const { bookingId, tripRequestId } = await book(100);
    // the customer sees the price and no split; the owner sees the split; a stranger owner sees 404; the driver (not yet assigned) sees 404
    const mine = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}`), customer);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.data).toMatchObject({ status: 'PENDING_PAYMENT', totalAmount: '1150.00', financial: null, requestNumber: expect.stringMatching(/^TR-/) });
    const theirs = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}`), owner);
    expect(theirs.body.data.financial).toMatchObject({ grossAmount: '1150.00', ownerNetAmount: '1150.00', commissionSource: 'NONE' });
    expect((await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}`), otherOwner)).status).toBe(404);
    expect((await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}`), driver)).status).toBe(404);
    // list: the customer's own; staff sees all; ?tripRequestId renders the order's waves
    const list = await bearer(request(h.app).get('/api/v1/bookings'), customer).query({ tripRequestId, status: 'PENDING_PAYMENT,CONFIRMED' });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(ids(list.body.data)).toEqual([bookingId]);
    expect((await bearer(request(h.app).get('/api/v1/bookings'), otherOwner).query({ tripRequestId })).body.data).toEqual([]);
    expect((await bearer(request(h.app).get('/api/v1/bookings'), admin).query({ tripRequestId })).body.data).toHaveLength(1);
    expect((await bearer(request(h.app).get('/api/v1/bookings'), customer).query({ status: 'NOPE' })).status).toBe(422);
    // history and financials
    const history = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}/status-history`), customer);
    expect(statuses(history.body.data)).toEqual(['PENDING_PAYMENT']);
    const custFin = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}/financials`), customer);
    expect(custFin.body.data).toMatchObject({ grossAmount: '1150.00', vatAmount: '150.00', owner: null, finance: null });
    const ownerFin = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}/financials`), owner);
    expect(ownerFin.body.data.owner).toMatchObject({ ownerNetAmount: '1150.00', vatTreatment: 'DEEMED_SUPPLIER' });
    expect(ownerFin.body.data.finance).toBeNull();
    const finFin = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}/financials`), admin);
    expect(finFin.body.data.finance).toMatchObject({ commissionSource: 'NONE', calculationVersion: 1 });
  });

  it('cancellation: quote = cancel, tiered fee by notice, no-cancel window, role-gated reasons, admin override/waive, order reopens', async () => {
    // ≥72h notice → no fee
    const far = await book(200);
    const q1 = await bearer(request(h.app).get(`/api/v1/bookings/${far.bookingId}/cancellation-quote`), customer);
    expect(q1.status, JSON.stringify(q1.body)).toBe(200);
    expect(q1.body.data).toMatchObject({ cancelledByRole: 'CUSTOMER', feeAmount: '0.00', refundAmount: '1150.00', feeSource: 'NONE', windowPassed: false });
    expect(q1.body.data.allowedReasonCodes).not.toContain('VEHICLE_BREAKDOWN');
    // a customer cannot cite an owner reason; the owner cannot cite a customer reason
    expect((await cancel(customer, far.bookingId, { reasonCode: 'VEHICLE_BREAKDOWN' })).body.error.code).toBe('CANCELLATION_REASON_NOT_ALLOWED');
    expect((await cancel(owner, far.bookingId, { reasonCode: 'PRICE' })).body.error.code).toBe('CANCELLATION_REASON_NOT_ALLOWED');
    // OTHER needs text; waiveFee needs bookings.manage
    expect((await cancel(customer, far.bookingId, { reasonCode: 'OTHER' })).status).toBe(422);
    expect((await cancel(customer, far.bookingId, { reasonCode: 'PRICE', waiveFee: true, reasonText: 'x' })).status).toBe(403);
    expect((await cancel(customer, far.bookingId, { reasonCode: 'PRICE', feeOverride: { type: 'NONE', reason: 'goodwill' } })).body.error.code).toBe('CANCELLATION_FEE_OVERRIDE_FORBIDDEN');
    const before = await prisma().tripRequest.findUniqueOrThrow({ where: { id: far.tripRequestId } });
    expect(before).toMatchObject({ status: 'FULLY_AWARDED', vehiclesAwarded: 1, vehiclesCancelled: 0 });
    const c1 = await cancel(customer, far.bookingId, { reasonCode: 'CUSTOMER_PLANS_CHANGED', reasonText: 'flight moved' });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body.data.booking.status).toBe('CANCELLED');
    expect(c1.body.data.cancellation).toMatchObject({ cancelledByRole: 'CUSTOMER', reasonCode: 'CUSTOMER_PLANS_CHANGED', cancellationFeeAmount: '0.00', refundAmount: '1150.00', feePayer: 'NONE' });
    expect(c1.body.data).toMatchObject({ refund: null, calendarEntryReleased: true });
    // the reservation is RELEASED (still there for audit), the order reopened as PARTIALLY_AWARDED with the cancellation counted
    const entries = await prisma().$queryRaw<{ status: string }[]>`SELECT status::text FROM vehicle_calendar_entries WHERE booking_id = ${far.bookingId}::uuid`;
    expect(entries).toEqual([{ status: 'RELEASED' }]);
    const after = await prisma().tripRequest.findUniqueOrThrow({ where: { id: far.tripRequestId } });
    expect(after).toMatchObject({ status: 'PARTIALLY_AWARDED', vehiclesAwarded: 0, vehiclesCancelled: 1 });
    expect((await cancel(customer, far.bookingId, { reasonCode: 'PRICE' })).body.error.code).toBe('BOOKING_ALREADY_CANCELLED');
    expect((await bearer(request(h.app).get(`/api/v1/bookings/${far.bookingId}/cancellation-quote`), customer)).body.error.code).toBe('BOOKING_INVALID_TRANSITION');
    // the vehicle is bookable again for the same window
    const again = await book(200);
    expect(again.bookingId).not.toBe(far.bookingId);

    // 30h notice → 10 % tier: fee 115.00, refund 1035.00; the owner's policy is NONE
    const mid = await book(30);
    const q2 = await bearer(request(h.app).get(`/api/v1/bookings/${mid.bookingId}/cancellation-quote`), customer);
    expect(q2.body.data).toMatchObject({ feeAmount: '115.00', refundAmount: '1035.00', feeSource: 'RULE' });
    expect(q2.body.data.feeRuleSnapshot).toMatchObject({ tier: { minHoursBeforePickup: 24 }, value: '10' });
    const qOwner = await bearer(request(h.app).get(`/api/v1/bookings/${mid.bookingId}/cancellation-quote`), owner);
    expect(qOwner.body.data).toMatchObject({ cancelledByRole: 'OWNER', feeAmount: '0.00' });
    const c2 = await cancel(customer, mid.bookingId, { reasonCode: 'PRICE' });
    expect(c2.body.data.cancellation).toMatchObject({ cancellationFeeAmount: '115.00', refundAmount: '1035.00', feePayer: 'CUSTOMER', feeSource: 'RULE' });
    // admin waives the fee afterwards (audited NOTICE); a second waive is locked
    const waived = await bearer(request(h.app).post(`/api/v1/bookings/${mid.bookingId}/cancellation/waive-fee`), admin).send({ reason: 'goodwill gesture' });
    expect(waived.status, JSON.stringify(waived.body)).toBe(200);
    expect(waived.body.data.cancellation).toMatchObject({ cancellationFeeAmount: '0.00', refundAmount: '1150.00', feeWaivedReason: 'goodwill gesture' });
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${mid.bookingId}/cancellation/waive-fee`), admin).send({ reason: 'again' })).body.error.code).toBe('CANCELLATION_FEE_LOCKED');
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${mid.bookingId}/cancellation/waive-fee`), customer).send({ reason: 'me' })).status).toBe(403);

    // inside the 2h no-cancel window: the quote says so, the cancel refuses; an admin override still books the cancellation with its own fee
    // bidding closes 2h before pickup, so a booking cannot be created this late — time passes instead
    const near = await book(40);
    await prisma().booking.update({ where: { id: near.bookingId }, data: { scheduledStartAt: new Date(Date.now() + 1.5 * 3_600_000), scheduledEndAt: new Date(Date.now() + 3.5 * 3_600_000) } });
    const q3 = await bearer(request(h.app).get(`/api/v1/bookings/${near.bookingId}/cancellation-quote`), customer);
    expect(q3.body.data.windowPassed).toBe(true);
    expect((await cancel(customer, near.bookingId, { reasonCode: 'PRICE' })).body.error.code).toBe('BOOKING_CANCELLATION_WINDOW_PASSED');
    const c3 = await cancel(admin, near.bookingId, { reasonCode: 'ADMIN_INTERVENTION', reasonText: 'customer called', feeOverride: { type: 'FIXED', value: '50.00', reason: 'call-centre fee' } });
    expect(c3.status, JSON.stringify(c3.body)).toBe(200);
    expect(c3.body.data.cancellation).toMatchObject({ cancelledByRole: 'ADMIN', cancellationFeeAmount: '50.00', refundAmount: '1100.00', feeSource: 'OVERRIDE' });
  });

  it('dispatch: ops confirm, driver assignment rules, trip row, ready, transition map; payment-window sweeper', async () => {
    const { bookingId, tripRequestId } = await book(60);
    // cannot dispatch before payment (PENDING_PAYMENT → DRIVER_ASSIGNED is not in the map)
    const early = await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/assign-driver`), owner).send({ driverProfileId });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('BOOKING_INVALID_TRANSITION');
    expect(early.body.error.details.allowed).toEqual(['CONFIRMED', 'CANCELLED']);
    // ops override confirms (offline payment)
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/confirm`), owner).send({ reason: 'paid' })).status).toBe(403);
    const confirmed = await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/confirm`), admin).send({ reason: 'bank transfer reconciled' });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.data).toMatchObject({ status: 'CONFIRMED', paymentDueBy: null });
    // the driver must be assigned to the vehicle first
    const notOnVehicle = await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/assign-driver`), owner).send({ driverProfileId });
    expect(notOnVehicle.body.error.code).toBe('DRIVER_NOT_ASSIGNED_TO_VEHICLE');
    const assign = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicleId}/drivers`), owner).send({ driverProfileId, isPrimary: true });
    const assign2 = await bearer(request(h.app).post(`/api/v1/vehicles/${vehicle2Id}/drivers`), owner).send({ driverProfileId, isPrimary: false });
    expect(assign2.status, JSON.stringify(assign2.body)).toBe(201);
    expect(assign.status, JSON.stringify(assign.body)).toBe(201);
    // another owner cannot dispatch on this booking
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/assign-driver`), otherOwner).send({ driverProfileId })).status).toBe(404);
    const dispatched = await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/assign-driver`), owner).send({ driverProfileId });
    expect(dispatched.status, JSON.stringify(dispatched.body)).toBe(200);
    expect(dispatched.body.data).toMatchObject({ status: 'DRIVER_ASSIGNED', driverProfileId, driverName: 'driver@bookings.test' });
    expect(dispatched.body.data.trip).toMatchObject({ status: 'DRIVER_ASSIGNED', tripNumber: expect.stringMatching(/^TP-\d{4}-\d{6}$/) });
    // now the driver is a party: they can read the booking (no split), and the customer sees the driver
    const asDriver = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}`), driver);
    expect(asDriver.status).toBe(200);
    expect(asDriver.body.data.financial).toBeNull();
    expect((await bearer(request(h.app).get('/api/v1/bookings'), driver)).body.data).toHaveLength(1);
    // the same driver cannot be dispatched on an overlapping booking
    const overlap = await book(61, vehicle2Id);
    await bearer(request(h.app).post(`/api/v1/bookings/${overlap.bookingId}/confirm`), admin).send({ reason: 'paid' });
    const busy = await bearer(request(h.app).post(`/api/v1/bookings/${overlap.bookingId}/assign-driver`), owner).send({ driverProfileId });
    expect(busy.body.error.code).toBe('DRIVER_ALREADY_ON_TRIP');
    // ready (owner), then the map forbids going back
    const ready = await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/ready`), owner).send({});
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    expect(ready.body.data.status).toBe('READY');
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/ready`), owner).send({})).body.error.code).toBe('BOOKING_INVALID_TRANSITION');
    const history = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}/status-history`), owner);
    expect(statuses(history.body.data)).toEqual(['PENDING_PAYMENT', 'CONFIRMED', 'DRIVER_ASSIGNED', 'READY']);
    // the owner cancels a READY booking with an owner reason: allowed by the map, no owner fee, the driver's trip is left to Phase 10
    const oc = await cancel(owner, bookingId, { reasonCode: 'VEHICLE_BREAKDOWN' });
    expect(oc.status, JSON.stringify(oc.body)).toBe(200);
    expect(oc.body.data.cancellation).toMatchObject({ cancelledByRole: 'OWNER', cancellationFeeAmount: '0.00', feePayer: 'NONE' });
    expect((await prisma().tripRequest.findUniqueOrThrow({ where: { id: tripRequestId } })).status).toBe('PARTIALLY_AWARDED');

    // sweeper: an unpaid PREPAID booking past its window is cancelled by the system and the order reopens
    const stale = await book(80);
    await prisma().booking.update({ where: { id: stale.bookingId }, data: { paymentDueBy: new Date(Date.now() - 60_000) } });
    expect(await expireUnpaidBookings()).toBeGreaterThanOrEqual(1);
    const swept = await bearer(request(h.app).get(`/api/v1/bookings/${stale.bookingId}`), customer);
    expect(swept.body.data.status).toBe('CANCELLED');
    expect(swept.body.data.cancellation).toMatchObject({ cancelledByRole: 'SYSTEM', reasonCode: 'PAYMENT_WINDOW_EXPIRED', cancellationFeeAmount: '0.00' });
    expect((await prisma().tripRequest.findUniqueOrThrow({ where: { id: stale.tripRequestId } })).vehiclesAwarded).toBe(0);
    const released = await prisma().$queryRaw<{ status: string }[]>`SELECT status::text FROM vehicle_calendar_entries WHERE booking_id = ${stale.bookingId}::uuid`;
    expect(released).toEqual([{ status: 'RELEASED' }]);
  });
});
