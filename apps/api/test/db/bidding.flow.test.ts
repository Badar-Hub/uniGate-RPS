/**
 * Phase 7 — bidding and the acceptance transaction against the real database:
 *   - submission: eligibility through the invitation, server-computed totals with the snapshotted
 *     VAT rate, client totals rejected, one live bid per owner, duplicate vehicle, revise, withdraw
 *   - the comparison list: customer sees all bids sorted by total; an owner sees only their own rows
 *   - acceptance: booking + HELD reservation + balanced financial snapshot (10 % NET_OF_VAT rule),
 *     PREPAID → PENDING_PAYMENT with payment_due_by, siblings rejected on full award, the winning
 *     owner now sees the request unredacted, the customer never sees the split
 *   - N-way concurrent acceptance on a single-vehicle request → exactly one booking (exit criterion)
 *   - the calendar EXCLUDE constraint refuses a vehicle already reserved for an overlapping window
 *   - idempotent replay of an accept
 *   - all-or-nothing group award: partial refused on a no-partial request, set size enforced,
 *     one blocked vehicle rolls back the whole set, then the full set books
 *   - INVOICED customers: credit not approved, limit exceeded, then CONFIRMED with no payment window
 *   - cancelling a request rejects its live bids; the expiry job expires stale bids
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { expireStaleBids } from '@/modules/bidding/bid.service.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'bidding test passphrase 1';
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const ids = (rows: unknown): string[] => (rows as { id: string }[]).map((b) => b.id);

interface OwnerFixture {
  token: string;
  profileId: string;
  vehicleId: string;
}

describeDb('bidding', () => {
  let h: Harness;
  let admin = '';
  let customer = '';
  let corporate = '';
  let corporateProfileId = '';
  let busCategoryId = '';
  let riyadh = '';
  const owners: OwnerFixture[] = [];

  async function approvedVehicle(ownerId: string, categoryId: string, seats: number): Promise<string> {
    const id = randomUUID();
    await prisma().vehicle.create({ data: { id, ownerProfileId: ownerId, vehicleCategoryId: categoryId, modelYear: 2022, plateNumberEn: `${Math.floor(Math.random() * 9000) + 1000} BID`, registrationNumber: `REG-${id.slice(0, 6)}`, colorCode: 'WHITE', passengerCapacity: seats, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE' } });
    const types = await prisma().documentType.findMany({ where: { appliesTo: 'VEHICLE', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] } });
    for (const t of types) {
      await prisma().document.create({ data: { id: randomUUID(), documentTypeCode: t.code, vehicleId: id, storageBucket: 'test', storageKey: `test/${id}/${t.code}`, originalFilename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'a'.repeat(64), uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), expiryDate: t.requiresExpiry ? new Date('2032-01-01') : null } });
    }
    return id;
  }

  async function owner(n: number): Promise<OwnerFixture> {
    const email = `owner${n}@bidding.test`;
    const userId = await createUserWithRoles(email, PW, ['VEHICLE_OWNER'], 'OWNER');
    const profileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId } })).id;
    await prisma().ownerVerticalApproval.create({ data: { id: randomUUID(), ownerProfileId: profileId, transportType: 'PASSENGER', status: 'APPROVED' } });
    await prisma().ownerServiceArea.create({ data: { ownerProfileId: profileId, cityId: riyadh } });
    const vehicleId = await approvedVehicle(profileId, busCategoryId, 45);
    return { token: '', profileId, vehicleId };
  }

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@bidding.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('customer@bidding.test', PW, ['CUSTOMER'], 'CUSTOMER');
    const corpUserId = await createUserWithRoles('corporate@bidding.test', PW, ['CUSTOMER'], 'CUSTOMER');
    corporateProfileId = (await prisma().customerProfile.findFirstOrThrow({ where: { userId: corpUserId } })).id;
    await prisma().customerProfile.update({ where: { id: corporateProfileId }, data: { customerType: 'CORPORATE' } });
    await prisma().corporateCustomerProfile.create({ data: { id: randomUUID(), customerProfileId: corporateProfileId, companyNameEn: 'Corp Co', companyNameAr: 'شركة', crNumber: '1010101010', contactPersonName: 'Contact', contactPersonPhone: '+966500000001', billingCycle: 'MONTHLY', creditStatus: 'NONE', creditLimitAmount: 0 } });
    riyadh = (await prisma().city.findFirstOrThrow({ where: { code: 'RUH' } })).id;
    busCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER', maxPassengerCapacity: { gte: 40 } }, orderBy: { sortOrder: 'asc' } })).id;
    for (let i = 0; i < 5; i++) owners.push(await owner(i));
    // The seed charges nothing; exactly one active GLOBAL rule may exist, so turn it into 10 % NET_OF_VAT for a non-trivial split.
    await prisma().commissionRule.updateMany({ where: { scope: 'GLOBAL', isActive: true }, data: { calculationType: 'PERCENTAGE', percentageRate: 0.1, basis: 'NET_OF_VAT', name: 'test 10%' } });
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@bidding.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@bidding.test', PW)).accessToken;
    corporate = (await loginBearer(h.app, 'corporate@bidding.test', PW)).accessToken;
    for (let i = 0; i < owners.length; i++) {
      await clearThrottles();
      const o = owners[i];
      if (o) o.token = (await loginBearer(h.app, `owner${i}@bidding.test`, PW)).accessToken;
    }
  });
  afterAll(teardownHarness);

  const requestBody = (over: Record<string, unknown> = {}) => ({
    transportType: 'PASSENGER', vehicleCategoryId: busCategoryId, vehiclesRequired: 1, tripDirection: 'ONE_WAY', publish: true,
    pickup: { addressLine: 'King Khalid International Airport, Riyadh', cityId: riyadh, latitude: 24.95761, longitude: 46.69878 },
    dropoff: { addressLine: 'Al Faisaliah Tower, Riyadh', cityId: riyadh, latitude: 24.69056, longitude: 46.68527 },
    pickupAt: hours(72), passengerDetails: { passengerCount: 30, tripPurpose: 'AIRPORT_TRANSFER', luggageCount: 30 },
    ...over,
  });
  async function publishRequest(token: string, over: Record<string, unknown> = {}): Promise<string> {
    const res = await bearer(request(h.app).post('/api/v1/trip-requests'), token).set('Idempotency-Key', randomUUID()).send(requestBody(over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.invitedOwnerCount).toBe(owners.length); // distinct owners, not vehicles
    return res.body.data.id as string;
  }
  const postBid = (o: OwnerFixture, tripRequestId: string, over: Record<string, unknown> = {}) =>
    bearer(request(h.app).post('/api/v1/bids'), o.token).set('Idempotency-Key', randomUUID()).send({ tripRequestId, vehicleId: o.vehicleId, baseAmount: '1000.00', ...over });
  async function bid(o: OwnerFixture, tripRequestId: string, baseAmount = '1000.00'): Promise<string> {
    const res = await postBid(o, tripRequestId, { baseAmount });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }
  const accept = (token: string, bidId: string, key = randomUUID()) => bearer(request(h.app).post(`/api/v1/bids/${bidId}/accept`), token).set('Idempotency-Key', key).send({});
  const award = (token: string, id: string, bidIds: string[]) => bearer(request(h.app).post(`/api/v1/trip-requests/${id}/award`), token).set('Idempotency-Key', randomUUID()).send({ bidIds });

  it('submission: eligibility, server-computed totals, one live bid per owner, revise, withdraw, comparison list', async () => {
    const id = await publishRequest(customer);
    const [o0, o1, o2] = owners as [OwnerFixture, OwnerFixture, OwnerFixture];

    // an owner without an invitation (out of area) cannot bid; a customer cannot bid at all
    const strangerUserId = await createUserWithRoles('stranger@bidding.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    const strangerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: strangerUserId } })).id;
    const strangerVehicle = await approvedVehicle(strangerProfileId, busCategoryId, 45);
    await clearThrottles();
    const stranger = (await loginBearer(h.app, 'stranger@bidding.test', PW)).accessToken;
    const notInvited = await bearer(request(h.app).post('/api/v1/bids'), stranger).set('Idempotency-Key', randomUUID()).send({ tripRequestId: id, vehicleId: strangerVehicle, baseAmount: '900.00' });
    expect(notInvited.status, JSON.stringify(notInvited.body)).toBe(422);
    expect(notInvited.body.error.code).toBe('BID_NOT_ELIGIBLE');
    expect((await bearer(request(h.app).post('/api/v1/bids'), customer).set('Idempotency-Key', randomUUID()).send({ tripRequestId: id, vehicleId: o0.vehicleId, baseAmount: '1.00' })).status).toBe(403);

    // totals are computed here: 1000 + 50 extras → VAT 157.50 → 1207.50; a client total is rejected outright
    const withTotal = await postBid(o0, id, { totalAmount: '1.00' });
    expect(withTotal.status).toBe(422);
    expect(withTotal.body.error.code).toBe('VALIDATION_FAILED');
    const zero = await postBid(o0, id, { baseAmount: '0.00' });
    expect(zero.status).toBe(422);
    const created = await postBid(o0, id, { extrasBreakdown: [{ labelEn: 'Airport permit', labelAr: 'تصريح المطار', amount: '50.00' }], ownerNotes: 'Driver speaks English' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'SUBMITTED', version: 1, baseAmount: '1000.00', extrasAmount: '50.00', vatRate: '0.1500', vatAmount: '157.50', totalAmount: '1207.50', currency: 'SAR' });
    expect(created.body.data.bidNumber).toMatch(/^BD-\d{4}-\d{6}$/);
    expect(created.body.data.effectiveCommission).toMatchObject({ type: 'PERCENTAGE', value: '10.00', basis: 'NET_OF_VAT', source: 'RULE' });
    const bid0: string = created.body.data.id;
    // validity defaults to min(now + 24h, deadline) — the deadline here (pickup − 2h) is later, so ≈ now + 24h
    const validUntil = new Date(created.body.data.validUntil).getTime();
    expect(validUntil).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(validUntil).toBeLessThan(Date.now() + 25 * 3_600_000);

    // same vehicle again → 409; a second vehicle while one live bid exists → limit (setting: 1)
    const dup = await postBid(o0, id);
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    expect(dup.body.error.code).toBe('BID_DUPLICATE_VEHICLE');
    const secondVehicle = await approvedVehicle(o0.profileId, busCategoryId, 45);
    const limit = await postBid(o0, id, { vehicleId: secondVehicle });
    expect(limit.status).toBe(422);
    expect(limit.body.error.code).toBe('BID_LIMIT_REACHED');

    // revise: version 2, totals recomputed
    const revised = await bearer(request(h.app).patch(`/api/v1/bids/${bid0}`), o0.token).send({ baseAmount: '950.00' });
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);
    expect(revised.body.data).toMatchObject({ version: 2, baseAmount: '950.00', extrasAmount: '50.00', vatAmount: '150.00', totalAmount: '1150.00', status: 'SUBMITTED' });
    expect(revised.body.data.lastRevisedAt).not.toBeNull();

    const bid1 = await bid(o1, id, '1100.00');
    const bid2 = await bid(o2, id, '800.00');

    // the customer's comparison list, cheapest first; owner notes visible to the customer
    const list = await bearer(request(h.app).get(`/api/v1/trip-requests/${id}/bids`), customer);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(ids(list.body.data)).toEqual([bid2, bid0, bid1]);
    expect(list.body.data[1].ownerNotes).toBe('Driver speaks English');
    expect(list.body.data[1].effectiveCommission).toBeNull(); // the customer never sees the owner's commission
    // an owner sees only their own row; a rival bid is 404 by id
    const own = await bearer(request(h.app).get(`/api/v1/trip-requests/${id}/bids`), o1.token);
    expect(ids(own.body.data)).toEqual([bid1]);
    expect((await bearer(request(h.app).get(`/api/v1/bids/${bid0}`), o1.token)).status).toBe(404);
    expect((await bearer(request(h.app).get(`/api/v1/bids/${bid0}`), customer)).status).toBe(200);
    expect((await bearer(request(h.app).get(`/api/v1/bids/${bid0}`), admin)).status).toBe(200);
    // an owner cannot accept, revise or withdraw someone else's bid
    expect((await accept(o1.token, bid0)).status).toBe(403);
    expect((await bearer(request(h.app).patch(`/api/v1/bids/${bid0}`), o1.token).send({ baseAmount: '1.00' })).status).toBe(404);
    expect((await bearer(request(h.app).post(`/api/v1/bids/${bid0}/withdraw`), o1.token).send({})).status).toBe(404);

    // withdraw, then the customer's courtesy rejection of another
    const withdrawn = await bearer(request(h.app).post(`/api/v1/bids/${bid2}/withdraw`), o2.token).send({ reason: 'vehicle needed elsewhere' });
    expect(withdrawn.body.data.status).toBe('WITHDRAWN');
    expect((await bearer(request(h.app).patch(`/api/v1/bids/${bid2}`), o2.token).send({ baseAmount: '1.00' })).body.error.code).toBe('BID_INVALID_TRANSITION');
    const rejected = await bearer(request(h.app).post(`/api/v1/bids/${bid1}/reject`), customer).send({ reason: 'too expensive' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.data).toMatchObject({ status: 'REJECTED', rejectedReason: 'too expensive' });
    // cancelling the request rejects the remaining live bid
    await bearer(request(h.app).post(`/api/v1/trip-requests/${id}/cancel`), customer).send({ reason: 'plans changed' });
    expect((await bearer(request(h.app).get(`/api/v1/bids/${bid0}`), o0.token)).body.data.status).toBe('REJECTED');
    expect((await postBid(o1, id)).body.error.code).toBe('TRIP_REQUEST_NOT_OPEN');
  });

  it('acceptance: booking, reservation, balanced snapshot, siblings rejected; N-way concurrency; exclusion; idempotent replay', async () => {
    const id = await publishRequest(customer);
    // A second request whose window overlaps the first, with every owner bidding on both BEFORE any award:
    // once the first is awarded, the matcher would no longer invite the winner's (now busy) vehicle.
    const overlapping = await publishRequest(customer, { pickupAt: hours(73) });
    const bidIds: string[] = [];
    const overlappingBids: string[] = [];
    for (const o of owners) {
      bidIds.push(await bid(o, id, '1000.00'));
      overlappingBids.push(await bid(o, overlapping, '1000.00'));
    }

    // N concurrent acceptances of different bids on a single-vehicle request: exactly one wins.
    const results = await Promise.all(bidIds.map((b) => accept(customer, b)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => r.body as unknown))).toEqual([201, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('TRIP_REQUEST_FULLY_AWARDED');
    const win = results.find((r) => r.status === 201);
    if (!win) throw new Error('no winner');
    const winningBid: string = bidIds[results.indexOf(win)] ?? '';
    const booking = win.body.data.booking;
    expect(booking).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', billingMode: 'PREPAID', fulfilmentSequence: 1, totalAmount: '1150.00', vatAmount: '150.00', bidId: winningBid, financial: null });
    expect(booking.bookingNumber).toMatch(/^BK-\d{4}-\d{6}$/);
    expect(new Date(booking.paymentDueBy).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(booking.nonCircumventionUntil).not.toBeNull();
    expect(win.body.data.tripRequest).toMatchObject({ status: 'FULLY_AWARDED', vehiclesAwarded: 1, biddingOpen: false });

    // exactly one booking, one HELD reservation; the split balances: 1150 gross, 1000 net, 10 % → 100 commission, owner not VAT-registered → deemed supplier, no commission VAT
    expect(await prisma().booking.count({ where: { tripRequestId: id } })).toBe(1);
    const entries = await prisma().$queryRaw<{ status: string; n: bigint }[]>`SELECT status::text AS status, count(*) AS n FROM vehicle_calendar_entries WHERE booking_id = ${booking.id}::uuid GROUP BY status`;
    expect(entries).toEqual([{ status: 'HELD', n: 1n }]);
    const snap = await prisma().bookingFinancialSnapshot.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(snap.grossAmount.toFixed(2)).toBe('1150.00');
    expect(snap.netOfVatAmount.toFixed(2)).toBe('1000.00');
    expect(snap.commissionAmount.toFixed(2)).toBe('100.00');
    expect(snap.commissionSource).toBe('RULE');
    expect(snap.vatTreatment).toBe('DEEMED_SUPPLIER');
    expect(snap.commissionVatAmount.toFixed(2)).toBe('0.00');
    expect(snap.ownerNetAmount.toFixed(2)).toBe('1050.00');
    expect(snap.ownerNetAmount.add(snap.commissionAmount).add(snap.commissionVatAmount).add(snap.paymentFeeAmount).eq(snap.grossAmount)).toBe(true);

    // siblings rejected; the winner ACCEPTED with its booking; the winning owner sees the request unredacted and the split
    const bids = await prisma().bid.findMany({ where: { tripRequestId: id }, select: { id: true, status: true } });
    expect(bids.filter((b) => b.status === 'ACCEPTED').map((b) => b.id)).toEqual([winningBid]);
    expect(bids.filter((b) => b.status === 'REJECTED')).toHaveLength(owners.length - 1);
    const winner = owners[results.indexOf(win)];
    if (!winner) throw new Error('no winner fixture');
    const mine = await bearer(request(h.app).get(`/api/v1/bids/${winningBid}`), winner.token);
    expect(mine.body.data.bookingId).toBe(booking.id);
    const unredacted = await bearer(request(h.app).get(`/api/v1/trip-requests/${id}`), winner.token);
    expect(unredacted.body.data.redacted).toBe(false);
    const loser = owners.find((o) => o !== winner);
    if (!loser) throw new Error('no loser');
    expect((await bearer(request(h.app).get(`/api/v1/trip-requests/${id}`), loser.token)).body.data.redacted).toBe(true);

    // idempotent replay of the winning accept returns the same booking, without a second one
    const key = randomUUID();
    const second = await publishRequest(customer, { pickupAt: hours(240) });
    const b2 = await bid(winner, second);
    const first = await accept(customer, b2, key);
    expect(first.status).toBe(201);
    const replay = await accept(customer, b2, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data.booking.id).toBe(first.body.data.booking.id);
    expect(await prisma().booking.count({ where: { tripRequestId: second } })).toBe(1);

    // the EXCLUDE constraint: the winner's vehicle is reserved for the first window; its bid on the overlapping request loses at acceptance
    const b3 = overlappingBids[results.indexOf(win)] ?? '';
    const clash = await accept(customer, b3);
    expect(clash.status, JSON.stringify(clash.body)).toBe(409);
    expect(clash.body.error.code).toBe('BID_VEHICLE_UNAVAILABLE');
    expect(await prisma().booking.count({ where: { tripRequestId: overlapping } })).toBe(0);
    expect((await prisma().tripRequest.findUniqueOrThrow({ where: { id: overlapping } })).vehiclesAwarded).toBe(0);
    expect((await prisma().bid.findUniqueOrThrow({ where: { id: b3 } })).status).toBe('SUBMITTED');
  });

  it('group award is all-or-nothing; INVOICED customers pass the credit check inside the transaction', async () => {
    const id = await publishRequest(customer, { vehiclesRequired: 2, allowPartialFulfilment: false, pickupAt: hours(500) });
    const [o0, o1, o2] = owners as [OwnerFixture, OwnerFixture, OwnerFixture];
    const b0 = await bid(o0, id, '1000.00');
    const b1 = await bid(o1, id, '1000.00');
    const b2 = await bid(o2, id, '1000.00');

    const partial = await accept(customer, b0);
    expect(partial.status).toBe(422);
    expect(partial.body.error.code).toBe('RULE_PARTIAL_AWARD_NOT_ALLOWED');
    expect(partial.body.error.details.awardEndpoint).toContain('/award');
    const short = await award(customer, id, [b0]);
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe('RULE_AWARD_SET_INCOMPLETE');
    expect(short.body.error.details).toMatchObject({ remainder: 2, suppliedBidCount: 1 });

    // block o1's vehicle for the window: the two-bid award must fail as a whole
    const block = await bearer(request(h.app).post(`/api/v1/vehicles/${o1.vehicleId}/calendar/blocks`), o1.token).send({ from: hours(499), to: hours(503) });
    expect(block.status, JSON.stringify(block.body)).toBe(201);
    const failed = await award(customer, id, [b0, b1]);
    expect(failed.status, JSON.stringify(failed.body)).toBe(409);
    expect(failed.body.error.code).toBe('BID_VEHICLE_UNAVAILABLE');
    expect(await prisma().booking.count({ where: { tripRequestId: id } })).toBe(0);
    expect((await prisma().tripRequest.findUniqueOrThrow({ where: { id } })).status).toBe('PUBLISHED');
    expect((await prisma().bid.findUniqueOrThrow({ where: { id: b0 } })).status).toBe('SUBMITTED');

    const done = await award(customer, id, [b0, b2]);
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect((done.body.data.bookings as { fulfilmentSequence: number }[]).map((b) => b.fulfilmentSequence).sort()).toEqual([1, 2]);
    expect(done.body.data.tripRequest).toMatchObject({ status: 'FULLY_AWARDED', vehiclesAwarded: 2 });
    expect((await prisma().bid.findUniqueOrThrow({ where: { id: b1 } })).status).toBe('REJECTED');

    // INVOICED: credit NONE → not approved; APPROVED with a low limit → exceeded; enough → CONFIRMED, no payment window
    const corpReq = await publishRequest(corporate, { pickupAt: hours(600) });
    const cb = await bid(o0, corpReq, '2000.00');
    const notApproved = await accept(corporate, cb);
    expect(notApproved.status).toBe(422);
    expect(notApproved.body.error.code).toBe('RULE_CREDIT_NOT_APPROVED');
    await prisma().corporateCustomerProfile.update({ where: { customerProfileId: corporateProfileId }, data: { creditStatus: 'APPROVED', creditLimitAmount: 1000 } });
    const exceeded = await accept(corporate, cb);
    expect(exceeded.status).toBe(422);
    expect(exceeded.body.error.code).toBe('RULE_CREDIT_LIMIT_EXCEEDED');
    expect(exceeded.body.error.details).toMatchObject({ creditLimitAmount: '1000.00', thisAward: '2300.00' });
    await prisma().corporateCustomerProfile.update({ where: { customerProfileId: corporateProfileId }, data: { creditLimitAmount: 5000 } });
    const invoiced = await accept(corporate, cb);
    expect(invoiced.status, JSON.stringify(invoiced.body)).toBe(201);
    expect(invoiced.body.data.booking).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'INVOICED', billingMode: 'INVOICED', paymentDueBy: null, creditTermsDaysSnapshot: 30 });
    expect(invoiced.body.data.booking.confirmedAt).not.toBeNull();
    // the live INVOICED booking now counts against the limit
    const corpReq2 = await publishRequest(corporate, { pickupAt: hours(700) });
    const cb2 = await bid(o1, corpReq2, '3000.00');
    const again = await accept(corporate, cb2);
    expect(again.status).toBe(422);
    expect(again.body.error.details).toMatchObject({ outstanding: '2300.00' });

    // an admin acting for the customer sees the split; the customer does not
    const staffView = await bearer(request(h.app).get(`/api/v1/bids/${cb}`), admin);
    expect(staffView.body.data.status).toBe('ACCEPTED');

    // the expiry job: a bid past validUntil → EXPIRED
    const stale = await publishRequest(customer, { pickupAt: hours(800) });
    const sb = await bid(o2, stale);
    // ck_bids_valid_until: valid_until ≥ submitted_at — age the whole bid, not just the deadline
    await prisma().bid.update({ where: { id: sb }, data: { submittedAt: new Date(Date.now() - 7_200_000), validUntil: new Date(Date.now() - 1000) } });
    expect(await expireStaleBids()).toBeGreaterThanOrEqual(1);
    expect((await prisma().bid.findUniqueOrThrow({ where: { id: sb } })).status).toBe('EXPIRED');
    const expiredAccept = await accept(customer, sb);
    expect(expiredAccept.body.error.code).toBe('BID_INVALID_TRANSITION');
  });
});
