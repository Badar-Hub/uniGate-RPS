/**
 * Phase 11b — the goods vertical against the real database (ADR-010):
 *   - the vertical switch: goods requests answer 501 VERTICAL_NOT_ENABLED until
 *     `platform.verticals_enabled` lists GOODS (a setting, not a code constant)
 *   - request validation from the goods plugin (refrigeration needs a temperature range),
 *     detail mismatch, and matching (payload and refrigeration decide the invitations)
 *   - per-vertical driver eligibility: a driver approved for passenger work cannot be nominated on
 *     a goods trip until `driver_vertical_eligibility` says APPROVED for GOODS
 *   - the freight state machine: LOADED cannot be skipped, LOADED/DELIVERED need the odometer,
 *     DELIVERED needs a DELIVERY_CONFIRMATION proof, then COMPLETED with every side effect
 *   - the transport-document gate (Bayan, OQ-29): off by default; on, DRIVER_EN_ROUTE is refused
 *     until the trip carries a regulatory reference of a type the vertical accepts
 *   - the invoice line for a goods booking is worded as freight by the plugin
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { invalidateSettingCache } from '@/modules/reference/settings.service.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'goods test passphrase 1';
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

describeDb('goods vertical', () => {
  let h: Harness;
  let admin = '';
  let customer = '';
  let owner = '';
  let driver = '';
  let finance = '';
  let ownerProfileId = '';
  let driverProfileId = '';
  let reeferCategoryId = '';
  let riyadh = '';
  let reeferId = '';
  let dryId = '';

  async function setSetting(key: string, value: unknown): Promise<void> {
    await prisma().systemSetting.update({ where: { key }, data: { value: value as never } });
    invalidateSettingCache(key);
  }
  async function goodsVehicle(categoryId: string, payloadKg: number, refrigerated: boolean): Promise<string> {
    const id = randomUUID();
    await prisma().vehicle.create({ data: { id, ownerProfileId, vehicleCategoryId: categoryId, modelYear: 2023, plateNumberEn: `${Math.floor(Math.random() * 9000) + 1000} GDS`, registrationNumber: `REG-${id.slice(0, 6)}`, colorCode: 'WHITE', payloadCapacityKg: payloadKg, hasRefrigeration: refrigerated, hasTailLift: true, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE', odometerKm: 120_000 } });
    const types = await prisma().documentType.findMany({ where: { appliesTo: 'VEHICLE', isActive: true, OR: [{ transportType: null }, { transportType: 'GOODS' }] } });
    for (const t of types) {
      await prisma().document.create({ data: { id: randomUUID(), documentTypeCode: t.code, vehicleId: id, storageBucket: 'test', storageKey: `test/${id}/${t.code}`, originalFilename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'a'.repeat(64), uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), expiryDate: t.requiresExpiry ? new Date('2032-01-01') : null } });
    }
    return id;
  }
  const cargo = (extra: object = {}) => ({ cargoType: 'PERISHABLE', cargoDescription: 'Chilled dairy, palletised', cargoWeightKg: '8400.00', cargoVolumeM3: '22.50', packageCount: 16, requiresRefrigeration: true, requiredTemperatureMinC: 2, requiredTemperatureMaxC: 6, requiresTailLift: true, requiresCrane: false, loadingResponsibility: 'CUSTOMER', unloadingResponsibility: 'THIRD_PARTY', ...extra });
  const requestBody = (extra: object = {}) => ({
    transportType: 'GOODS', vehicleCategoryId: reeferCategoryId, vehiclesRequired: 1, tripDirection: 'ONE_WAY', publish: true,
    pickup: { addressLine: 'Dry port, Riyadh', cityId: riyadh, latitude: 24.62, longitude: 46.78 }, dropoff: { addressLine: 'Cold store, Riyadh', cityId: riyadh, latitude: 24.75, longitude: 46.62 },
    pickupAt: hours(72), goodsDetails: cargo(), ...extra,
  });
  const post = (token: string, body: object) => bearer(request(h.app).post('/api/v1/trip-requests'), token).set('Idempotency-Key', randomUUID()).send(body);
  const move = (token: string, tripId: string, body: object) => bearer(request(h.app).post(`/api/v1/trips/${tripId}/status`), token).set('Idempotency-Key', randomUUID()).send(body);

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@goods.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('finance@goods.test', PW, ['FINANCE_OFFICER']);
    await createUserWithRoles('customer@goods.test', PW, ['CUSTOMER'], 'CUSTOMER');
    const ownerUserId = await createUserWithRoles('owner@goods.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    const driverUserId = await createUserWithRoles('driver@goods.test', PW, ['DRIVER'], 'DRIVER');
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerUserId } })).id;
    driverProfileId = (await prisma().driverProfile.findFirstOrThrow({ where: { userId: driverUserId } })).id;
    await prisma().driverProfile.update({ where: { id: driverProfileId }, data: { ownerProfileId, licenseExpiryDate: new Date('2030-01-01'), availabilityStatus: 'AVAILABLE' } });
    riyadh = (await prisma().city.findFirstOrThrow({ where: { code: 'RUH' } })).id;
    reeferCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { code: 'REFRIGERATED_TRUCK' } })).id;
    await prisma().ownerVerticalApproval.create({ data: { id: randomUUID(), ownerProfileId, transportType: 'GOODS', status: 'APPROVED' } });
    await prisma().ownerServiceArea.create({ data: { ownerProfileId, cityId: riyadh } });
    reeferId = await goodsVehicle(reeferCategoryId, 12_000, true);
    dryId = await goodsVehicle(reeferCategoryId, 12_000, false); // same category, no refrigeration unit
    for (const v of [reeferId, dryId]) await prisma().vehicleDriverAssignment.create({ data: { id: randomUUID(), vehicleId: v, driverProfileId, isPrimary: v === reeferId, assignedFrom: new Date() } });
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@goods.test', PW)).accessToken;
    finance = (await loginBearer(h.app, 'finance@goods.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@goods.test', PW)).accessToken;
    await clearThrottles();
    owner = (await loginBearer(h.app, 'owner@goods.test', PW)).accessToken;
    driver = (await loginBearer(h.app, 'driver@goods.test', PW)).accessToken;
  });
  afterAll(teardownHarness);

  it('is a switch, not a build: 501 until platform.verticals_enabled lists GOODS; then the plugin validates and matches', async () => {
    const off = await post(customer, requestBody());
    expect(off.status).toBe(501);
    expect(off.body.error.code).toBe('VERTICAL_NOT_ENABLED');
    await setSetting('platform.verticals_enabled', ['PASSENGER', 'GOODS']);

    // plugin validation: refrigerated cargo needs its temperature range; a passenger block on a goods request is a mismatch
    const noRange = await post(customer, requestBody({ goodsDetails: cargo({ requiredTemperatureMinC: undefined, requiredTemperatureMaxC: undefined }) }));
    expect(noRange.status, JSON.stringify(noRange.body)).toBe(422);
    expect(JSON.stringify(noRange.body.error.details)).toContain('temperature range');
    const mismatch = await post(customer, requestBody({ goodsDetails: undefined, passengerDetails: { passengerCount: 3, tripPurpose: 'OTHER', luggageCount: 0 } }));
    expect(mismatch.body.error.code).toBe('TRIP_REQUEST_DETAIL_MISMATCH');

    // matching: only the refrigerated truck is invited (same category, same owner); partial fulfilment defaults on for goods (A-45)
    const res = await post(customer, requestBody());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ transportType: 'GOODS', status: 'PUBLISHED' });
    // A-45: partial fulfilment defaults on for goods orders (single-vehicle orders are never partial)
    const multi = await post(customer, requestBody({ vehiclesRequired: 2, pickupAt: hours(96) }));
    expect(multi.status, JSON.stringify(multi.body)).toBe(201);
    expect(multi.body.data.allowPartialFulfilment).toBe(true);
    expect(res.body.data.goodsDetails).toMatchObject({ cargoType: 'PERISHABLE', requiresRefrigeration: true, cargoWeightKg: '8400.00' });
    const invitations = await bearer(request(h.app).get(`/api/v1/trip-requests/${res.body.data.id}/invitations`), admin);
    expect(invitations.status, JSON.stringify(invitations.body)).toBe(200);
    expect(invitations.body.data).toHaveLength(1);
    expect(invitations.body.data[0].ownerProfileId).toBe(ownerProfileId);
    // a heavier load than either truck carries → nobody is invited
    const heavy = await post(customer, requestBody({ goodsDetails: cargo({ cargoWeightKg: '20000.00' }) }));
    expect(heavy.status).toBe(201);
    expect((await bearer(request(h.app).get(`/api/v1/trip-requests/${heavy.body.data.id}/invitations`), admin)).body.data).toHaveLength(0);
    // the owner cannot bid the dry truck on refrigerated cargo; the reefer is fine
    const dryBid = await bearer(request(h.app).post('/api/v1/bids'), owner).set('Idempotency-Key', randomUUID()).send({ tripRequestId: res.body.data.id, vehicleId: dryId, baseAmount: '3000.00' });
    expect(dryBid.status, JSON.stringify(dryBid.body)).toBe(422);
    expect(dryBid.body.error).toMatchObject({ code: 'BID_NOT_ELIGIBLE', details: { reasons: ['REFRIGERATION_REQUIRED'] } });
  });

  it('freight lifecycle: per-vertical driver eligibility, LOADED never skipped, odometer + proof of delivery, the Bayan gate, freight invoice wording', async () => {
    const res = await post(customer, requestBody({ pickupAt: hours(48) }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tripRequestId: string = res.body.data.id;
    // nominating the driver on the bid is refused until they are approved for GOODS
    const notEligible = await bearer(request(h.app).post('/api/v1/bids'), owner).set('Idempotency-Key', randomUUID()).send({ tripRequestId, vehicleId: reeferId, driverProfileId, baseAmount: '4200.00' });
    expect(notEligible.status).toBe(422);
    expect(notEligible.body.error).toMatchObject({ code: 'DRIVER_NOT_APPROVED', details: { vertical: 'GOODS' } });
    await prisma().driverVerticalEligibility.create({ data: { id: randomUUID(), driverProfileId, transportType: 'GOODS', status: 'APPROVED', approvedAt: new Date() } });
    const bid = await bearer(request(h.app).post('/api/v1/bids'), owner).set('Idempotency-Key', randomUUID()).send({ tripRequestId, vehicleId: reeferId, driverProfileId, baseAmount: '4200.00' });
    expect(bid.status, JSON.stringify(bid.body)).toBe(201);
    const accept = await bearer(request(h.app).post(`/api/v1/bids/${bid.body.data.id}/accept`), customer).set('Idempotency-Key', randomUUID()).send({});
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);
    const bookingId: string = accept.body.data.booking.id;
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/confirm`), admin).send({ reason: 'paid offline' })).status).toBe(200);
    const assigned = await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/assign-driver`), owner).send({ driverProfileId });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect((await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/ready`), owner).send({})).status).toBe(200);
    const tripId: string = assigned.body.data.trip.id;
    const t0 = await bearer(request(h.app).get(`/api/v1/trips/${tripId}`), driver);
    expect(t0.body.data).toMatchObject({ transportType: 'GOODS', status: 'DRIVER_ASSIGNED', regulatoryReference: null, allowedNextStatuses: ['DRIVER_EN_ROUTE', 'CANCELLED', 'EXCEPTION'] });

    // the transport-document gate (OQ-29): off by default, then on
    await setSetting('dispatch.goods_transport_document_required', true);
    const gated = await move(driver, tripId, { status: 'DRIVER_EN_ROUTE', latitude: 24.62, longitude: 46.78 });
    expect(gated.status).toBe(422);
    expect(gated.body.error).toMatchObject({ code: 'TRIP_REGULATORY_DOCUMENT_REQUIRED', details: { referenceTypes: ['BAYAN', 'OTHER'] } });
    const badType = await bearer(request(h.app).patch(`/api/v1/trips/${tripId}`), driver).send({ regulatoryReference: 'BYN-2026-77812', regulatoryReferenceType: 'WAYBILL' });
    expect(badType.status).toBe(422);
    const halfSet = await bearer(request(h.app).patch(`/api/v1/trips/${tripId}`), driver).send({ regulatoryReference: 'BYN-2026-77812' });
    expect(halfSet.status).toBe(422);
    const ref = await bearer(request(h.app).patch(`/api/v1/trips/${tripId}`), driver).send({ regulatoryReference: 'BYN-2026-77812', regulatoryReferenceType: 'BAYAN' });
    expect(ref.status, JSON.stringify(ref.body)).toBe(200);
    expect(ref.body.data).toMatchObject({ regulatoryReference: 'BYN-2026-77812', regulatoryReferenceType: 'BAYAN' });
    const enRoute = await move(driver, tripId, { status: 'DRIVER_EN_ROUTE', latitude: 24.62, longitude: 46.78 });
    expect(enRoute.status, JSON.stringify(enRoute.body)).toBe(200);
    expect(enRoute.body.data.status).toBe('DRIVER_EN_ROUTE');
    await setSetting('dispatch.goods_transport_document_required', false);

    // the freight map: no passenger states, LOADED cannot be skipped, LOADED needs the odometer and starts the booking
    const passengerState = await move(driver, tripId, { status: 'TRIP_STARTED' });
    expect(passengerState.body.error.code).toBe('TRIP_INVALID_TRANSITION');
    expect((await move(driver, tripId, { status: 'ARRIVED_AT_PICKUP' })).status).toBe(200);
    expect((await move(driver, tripId, { status: 'IN_TRANSIT' })).body.error.code).toBe('TRIP_INVALID_TRANSITION');
    expect((await move(driver, tripId, { status: 'LOADING' })).status).toBe(200);
    expect((await move(driver, tripId, { status: 'LOADED' })).body.error.code).toBe('TRIP_ODOMETER_REQUIRED');
    const loaded = await move(driver, tripId, { status: 'LOADED', odometerKm: 120_010 });
    expect(loaded.status, JSON.stringify(loaded.body)).toBe(200);
    expect(loaded.body.data).toMatchObject({ status: 'LOADED', booking: { status: 'IN_PROGRESS' } });
    expect((await bearer(request(h.app).get(`/api/v1/trips/${tripId}`), driver)).body.data.startOdometerKm).toBe(120_010);
    expect((await move(driver, tripId, { status: 'IN_TRANSIT' })).status).toBe(200);
    expect((await move(driver, tripId, { status: 'ARRIVED_AT_DESTINATION' })).status).toBe(200);
    expect((await move(driver, tripId, { status: 'UNLOADING' })).status).toBe(200);
    // DELIVERED needs the proof of delivery — recorded first, then referenced
    const noProof = await move(driver, tripId, { status: 'DELIVERED', odometerKm: 120_052 });
    expect(noProof.body.error.code).toBe('TRIP_PROOF_REQUIRED');
    const proof = await bearer(request(h.app).post(`/api/v1/trips/${tripId}/proofs`), driver).send({ proofType: 'DELIVERY_CONFIRMATION', recipientName: 'Hind Qahtani', recipientIdLast4: '4471', latitude: 24.75, longitude: 46.62, notes: '16 pallets, seal intact' });
    expect(proof.status, JSON.stringify(proof.body)).toBe(201);
    const delivered = await move(driver, tripId, { status: 'DELIVERED', odometerKm: 120_052, proofId: proof.body.data.id, latitude: 24.75, longitude: 46.62 });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body.data.status).toBe('DELIVERED');
    const done = await move(driver, tripId, { status: 'COMPLETED' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', booking: { status: 'COMPLETED' } });
    expect((await bearer(request(h.app).get(`/api/v1/trips/${tripId}`), driver)).body.data).toMatchObject({ endOdometerKm: 120_052, actualDistanceKm: '42.00' });
    const proofs = await bearer(request(h.app).get(`/api/v1/trips/${tripId}/proofs`), customer);
    expect(proofs.body.data).toHaveLength(1);
    expect(proofs.body.data[0]).toMatchObject({ proofType: 'DELIVERY_CONFIRMATION', recipientName: 'Hind Qahtani' });

    // the invoice line is worded by the goods plugin
    await setSetting('finance.seller_vat_number', '310000000000003');
    await prisma().booking.update({ where: { id: bookingId }, data: { paymentStatus: 'PAID' } });
    const inv = await bearer(request(h.app).post('/api/v1/invoices'), finance).set('Idempotency-Key', randomUUID()).send({ bookingId });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const lines = await bearer(request(h.app).get(`/api/v1/invoices/${inv.body.data.id}/lines`), finance);
    expect(lines.body.data[0].descriptionEn).toMatch(/^Freight transport — order /);
    expect(lines.body.data[0].vatCategory).toBe('S');
  });
});
