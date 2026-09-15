/**
 * Phase 11 — finance against the real database:
 *   - commission rules: CRUD, the single-active-GLOBAL invariant, overlap refusal, the dry-run
 *     preview (VAT-inclusive gross → split), the per-request override and its after-bids guard
 *   - settlements: preview → build (one BOOKING_EARNING line per funded booking past its hold,
 *     never twice) → manual PENALTY line → submit → four-eyes approval → payout with the bank
 *     account cool-off; DEBIT OWNER_PAYABLE / CREDIT CASH_BANK; the owner balance endpoint
 *   - expenses: create, summary, the PAID-settlement immutability guard
 *   - invoices: the seller VAT gate; a simplified invoice for a prepaid booking (reported by the
 *     mock provider); the corporate billing cycle → TAX_INVOICE cleared by the mock, ORDER line,
 *     CUSTOMER_RECEIVABLE postings; invoice payment through POST /payments and the mock checkout;
 *     credit note / debit note; void rules; a rejected clearance resting in CLEARANCE_FAILED and
 *     the retry path; the overdue job; ledger groups always balance
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { mockClearanceProvider } from '@/integrations/einvoicing/index.js';
import { markOverdueInvoices } from '@/modules/finance/invoice.service.js';
import { invalidateSettingCache } from '@/modules/reference/settings.service.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'finance test passphrase 1';
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const RETURN = 'http://localhost:3001/en/bookings/return';
const SELLER_VAT = '310000000000003';
const BUYER_VAT = '300000000000003';
const ids = (rows: unknown): string[] => (rows as { id: string }[]).map((r) => r.id);
const invoiceIds = (rows: unknown): string[] => (rows as { invoiceId: string }[]).map((r) => r.invoiceId);

describeDb('finance', () => {
  let h: Harness;
  let admin = '';
  let finance = '';
  let finance2 = '';
  let customer = '';
  let corporate = '';
  let owner = '';
  let ownerProfileId = '';
  let corporateProfileId = '';
  let busCategoryId = '';
  let riyadh = '';
  let vehicleId = '';

  async function approvedVehicle(ownerId: string, categoryId: string, seats: number): Promise<string> {
    const id = randomUUID();
    await prisma().vehicle.create({ data: { id, ownerProfileId: ownerId, vehicleCategoryId: categoryId, modelYear: 2022, plateNumberEn: `${Math.floor(Math.random() * 9000) + 1000} FIN`, registrationNumber: `REG-${id.slice(0, 6)}`, colorCode: 'WHITE', passengerCapacity: seats, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE' } });
    const types = await prisma().documentType.findMany({ where: { appliesTo: 'VEHICLE', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] } });
    for (const t of types) {
      await prisma().document.create({ data: { id: randomUUID(), documentTypeCode: t.code, vehicleId: id, storageBucket: 'test', storageKey: `test/${id}/${t.code}`, originalFilename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'a'.repeat(64), uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), expiryDate: t.requiresExpiry ? new Date('2032-01-01') : null } });
    }
    return id;
  }

  async function setSetting(key: string, value: unknown): Promise<void> {
    await prisma().systemSetting.update({ where: { key }, data: { value: value as never } });
    invalidateSettingCache(key);
  }

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@finance.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('finance@finance.test', PW, ['FINANCE_OFFICER']);
    await createUserWithRoles('finance2@finance.test', PW, ['FINANCE_OFFICER']);
    await createUserWithRoles('customer@finance.test', PW, ['CUSTOMER'], 'CUSTOMER');
    const corporateUserId = await createUserWithRoles('corporate@finance.test', PW, ['CUSTOMER'], 'CUSTOMER');
    const ownerUserId = await createUserWithRoles('owner@finance.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerUserId } })).id;
    corporateProfileId = (await prisma().customerProfile.findFirstOrThrow({ where: { userId: corporateUserId } })).id;
    await prisma().customerProfile.update({ where: { id: corporateProfileId }, data: { vatNumber: BUYER_VAT, vatNumberVerifiedAt: new Date() } });
    await prisma().corporateCustomerProfile.create({ data: { id: randomUUID(), customerProfileId: corporateProfileId, companyNameEn: 'Corp Finance Co', companyNameAr: 'شركة', crNumber: '1010101011', contactPersonName: 'Contact', contactPersonPhone: '+966500000002', billingCycle: 'MONTHLY', creditStatus: 'APPROVED', creditLimitAmount: 50_000, creditTermsDays: 30 } });
    riyadh = (await prisma().city.findFirstOrThrow({ where: { code: 'RUH' } })).id;
    busCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER', maxPassengerCapacity: { gte: 40 } }, orderBy: { sortOrder: 'asc' } })).id;
    await prisma().ownerVerticalApproval.create({ data: { id: randomUUID(), ownerProfileId, transportType: 'PASSENGER', status: 'APPROVED' } });
    await prisma().ownerServiceArea.create({ data: { ownerProfileId, cityId: riyadh } });
    vehicleId = await approvedVehicle(ownerProfileId, busCategoryId, 45);
    // 10 % NET_OF_VAT so every split carries a commission line; the owner is not VAT registered → no commission VAT.
    await prisma().commissionRule.updateMany({ where: { scope: 'GLOBAL', isActive: true }, data: { calculationType: 'PERCENTAGE', percentageRate: 0.1, basis: 'NET_OF_VAT' } });
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@finance.test', PW)).accessToken;
    finance = (await loginBearer(h.app, 'finance@finance.test', PW)).accessToken;
    finance2 = (await loginBearer(h.app, 'finance2@finance.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@finance.test', PW)).accessToken;
    await clearThrottles();
    corporate = (await loginBearer(h.app, 'corporate@finance.test', PW)).accessToken;
    owner = (await loginBearer(h.app, 'owner@finance.test', PW)).accessToken;
  });
  afterAll(teardownHarness);

  const key = () => randomUUID();
  /** Request (as `who`) → bid → accept → booking of 1150.00 (PENDING_PAYMENT for prepaid, CONFIRMED for the corporate buyer). */
  async function book(who: string, pickupInHours: number): Promise<{ bookingId: string; tripRequestId: string }> {
    const res = await bearer(request(h.app).post('/api/v1/trip-requests'), who).set('Idempotency-Key', key()).send({
      transportType: 'PASSENGER', vehicleCategoryId: busCategoryId, vehiclesRequired: 1, tripDirection: 'ONE_WAY', publish: true,
      pickup: { addressLine: 'King Khalid International Airport, Riyadh', cityId: riyadh, latitude: 24.95761, longitude: 46.69878 },
      dropoff: { addressLine: 'Al Faisaliah Tower, Riyadh', cityId: riyadh, latitude: 24.69056, longitude: 46.68527 },
      pickupAt: hours(pickupInHours), passengerDetails: { passengerCount: 30, tripPurpose: 'AIRPORT_TRANSFER', luggageCount: 30 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tripRequestId: string = res.body.data.id;
    const bid = await bearer(request(h.app).post('/api/v1/bids'), owner).set('Idempotency-Key', key()).send({ tripRequestId, vehicleId, baseAmount: '1000.00' });
    expect(bid.status, JSON.stringify(bid.body)).toBe(201);
    const accept = await bearer(request(h.app).post(`/api/v1/bids/${bid.body.data.id}/accept`), who).set('Idempotency-Key', key()).send({});
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);
    return { bookingId: accept.body.data.booking.id as string, tripRequestId };
  }
  /** Pay a PENDING_PAYMENT booking through the mock checkout (signed webhook, real processing). */
  async function payBooking(bookingId: string): Promise<void> {
    const created = await bearer(request(h.app).post('/api/v1/payments'), customer).set('Idempotency-Key', key()).send({ bookingId, amount: '1150.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const done = await bearer(request(h.app).post(`/api/v1/payments/mock/checkout/${created.body.data.payment.providerPaymentId}`), customer).send({ outcome: 'SUCCESS' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  }
  /** Skip the trip: the booking completed `ago` days ago (Phase 10 covers the transitions). */
  async function complete(bookingId: string, ago: number): Promise<void> {
    await prisma().booking.update({ where: { id: bookingId }, data: { status: 'COMPLETED', completedAt: daysAgo(ago) } });
    await prisma().vehicleCalendarEntry.deleteMany({ where: { bookingId } });
  }
  async function groupsBalance(): Promise<void> {
    const rows = await prisma().$queryRaw<{ g: string; d: string; c: string }[]>`SELECT transaction_group_id::text AS g, COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount END), 0)::text AS d, COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount END), 0)::text AS c FROM ledger_entries GROUP BY transaction_group_id`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(Number(r.d), `group ${r.g}`).toBe(Number(r.c));
  }

  let paidBookingId = '';
  let settlementId = '';
  let periodStart = '';
  let periodEnd = '';

  it('commission rules: CRUD, one active GLOBAL rule, overlap, preview, and the per-request override guards', async () => {
    const list = await bearer(request(h.app).get('/api/v1/commissions/rules'), finance);
    expect(list.status).toBe(200);
    const global = (list.body.data as { id: string; scope: string }[]).find((r) => r.scope === 'GLOBAL');
    if (!global) throw new Error('no GLOBAL rule');
    expect(global).toMatchObject({ calculationType: 'PERCENTAGE', percentageRate: '10.00', basis: 'NET_OF_VAT', isActive: true });

    // a second active GLOBAL rule is refused; a category rule is accepted
    const dupGlobal = await bearer(request(h.app).post('/api/v1/commissions/rules'), finance).send({ name: 'Second global', scope: 'GLOBAL', calculationType: 'PERCENTAGE', percentageRate: '5.00' });
    expect(dupGlobal.status).toBe(409);
    expect(dupGlobal.body.error.code).toBe('COMMISSION_RULE_OVERLAP');
    expect((await bearer(request(h.app).post('/api/v1/commissions/rules'), finance).send({ name: 'Bad', scope: 'VEHICLE_CATEGORY', calculationType: 'PERCENTAGE', percentageRate: '5.00' })).status).toBe(422); // category required
    const cat = await bearer(request(h.app).post('/api/v1/commissions/rules'), finance).send({ name: 'Buses 12 %', scope: 'VEHICLE_CATEGORY', vehicleCategoryId: busCategoryId, calculationType: 'PERCENTAGE', percentageRate: '12.00', priority: 5 });
    expect(cat.status, JSON.stringify(cat.body)).toBe(201);
    expect(cat.body.data).toMatchObject({ percentageRate: '12.00', scope: 'VEHICLE_CATEGORY', isActive: true });
    const catId: string = cat.body.data.id;
    const overlap = await bearer(request(h.app).post('/api/v1/commissions/rules'), finance).send({ name: 'Buses again', scope: 'VEHICLE_CATEGORY', vehicleCategoryId: busCategoryId, calculationType: 'FIXED', fixedAmount: '50.00' });
    expect(overlap.body.error.code).toBe('COMMISSION_RULE_OVERLAP');
    expect(overlap.body.error.details.conflictingRuleId).toBe(catId);
    // the last GLOBAL rule cannot be switched off
    const off = await bearer(request(h.app).patch(`/api/v1/commissions/rules/${global.id}`), finance).send({ isActive: false });
    expect(off.status).toBe(422);
    expect(off.body.error.code).toBe('COMMISSION_GLOBAL_RULE_REQUIRED');
    expect((await bearer(request(h.app).delete(`/api/v1/commissions/rules/${global.id}`), finance)).status).toBe(422);
    expect((await bearer(request(h.app).post('/api/v1/commissions/rules'), owner).send({})).status).toBe(403); // owners read, never manage

    // preview: the category rule (priority 5) beats the global one; gross 1150 incl. VAT → net 1000 → 12 % = 120
    const preview = await bearer(request(h.app).post('/api/v1/commissions/rules/preview'), finance).send({ ownerProfileId, vehicleCategoryId: busCategoryId, grossAmount: '1150.00' });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data).toMatchObject({ source: 'RULE', type: 'PERCENTAGE', value: '12.00', ruleId: catId, grossAmount: '1150.00', vatAmount: '150.00', netOfVatAmount: '1000.00', commissionAmount: '120.00', commissionVatAmount: '0.00', ownerNetAmount: '1030.00', vatTreatment: 'DEEMED_SUPPLIER' });
    const previewOverride = await bearer(request(h.app).post('/api/v1/commissions/rules/preview'), finance).send({ ownerProfileId, vehicleCategoryId: busCategoryId, grossAmount: '1150.00', commissionOverride: { type: 'FIXED', value: '40.00', reason: 'negotiated' } });
    expect(previewOverride.body.data).toMatchObject({ source: 'OVERRIDE', commissionAmount: '40.00', ownerNetAmount: '1110.00' });
    // deactivate the category rule again so the rest of the suite runs on the 10 % global rule
    expect((await bearer(request(h.app).delete(`/api/v1/commissions/rules/${catId}`), finance)).status).toBe(204);
    expect((await bearer(request(h.app).get(`/api/v1/commissions/rules/${catId}`), finance)).body.data.isActive).toBe(false);

    // per-request override: set before bids, may only be lowered once a bid exists
    const req = await bearer(request(h.app).post('/api/v1/trip-requests'), customer).set('Idempotency-Key', key()).send({
      transportType: 'PASSENGER', vehicleCategoryId: busCategoryId, vehiclesRequired: 1, tripDirection: 'ONE_WAY', publish: true,
      pickup: { addressLine: 'Airport', cityId: riyadh, latitude: 24.95761, longitude: 46.69878 }, dropoff: { addressLine: 'Tower', cityId: riyadh, latitude: 24.69056, longitude: 46.68527 },
      pickupAt: hours(300), passengerDetails: { passengerCount: 30, tripPurpose: 'AIRPORT_TRANSFER', luggageCount: 30 },
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const tripRequestId: string = req.body.data.id;
    expect((await bearer(request(h.app).patch(`/api/v1/trip-requests/${tripRequestId}/commission`), owner).send({ override: null })).status).toBe(403);
    const set = await bearer(request(h.app).patch(`/api/v1/trip-requests/${tripRequestId}/commission`), admin).send({ override: { type: 'PERCENTAGE', value: '5.00', reason: 'strategic customer' } });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.data).toMatchObject({ bidsExist: false, override: { type: 'PERCENTAGE', value: '5.00' }, effectiveCommission: { type: 'PERCENTAGE', value: '5.00', source: 'OVERRIDE' } });
    const bid = await bearer(request(h.app).post('/api/v1/bids'), owner).set('Idempotency-Key', key()).send({ tripRequestId, vehicleId, baseAmount: '900.00' });
    expect(bid.status, JSON.stringify(bid.body)).toBe(201);
    const raise = await bearer(request(h.app).patch(`/api/v1/trip-requests/${tripRequestId}/commission`), admin).send({ override: { type: 'PERCENTAGE', value: '8.00', reason: 'oops' } });
    expect(raise.status).toBe(422);
    expect(raise.body.error.code).toBe('COMMISSION_OVERRIDE_AFTER_BIDS');
    const clear = await bearer(request(h.app).patch(`/api/v1/trip-requests/${tripRequestId}/commission`), admin).send({ override: null });
    expect(clear.status).toBe(422); // clearing would raise back to the 10 % rule
    const lower = await bearer(request(h.app).patch(`/api/v1/trip-requests/${tripRequestId}/commission`), admin).send({ override: { type: 'PERCENTAGE', value: '3.00', reason: 'goodwill' } });
    expect(lower.status, JSON.stringify(lower.body)).toBe(200);
    expect(lower.body.data).toMatchObject({ bidsExist: true, override: { value: '3.00' } });
    const read = await bearer(request(h.app).get(`/api/v1/trip-requests/${tripRequestId}/commission`), finance);
    expect(read.status).toBe(200);
    expect(read.body.data.override.reason).toBe('goodwill');
  });

  it('settlements: preview → build once → penalty line → submit → four-eyes → payout after the bank cool-off; balances and immutability', async () => {
    const { bookingId } = await book(customer, 200);
    await payBooking(bookingId);
    await complete(bookingId, 10);
    paidBookingId = bookingId;
    periodStart = daysAgo(30).toISOString();
    periodEnd = new Date().toISOString();

    // owners preview their own pending settlement (no ownerProfileId needed); the hold (3 days) has elapsed
    const preview = await bearer(request(h.app).get('/api/v1/settlements/preview'), owner).query({ periodStart, periodEnd });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data).toMatchObject({ ownerProfileId, grossAmount: '1150.00', commissionAmount: '100.00', netPayableAmount: '1050.00', belowMinimum: false });
    expect(preview.body.data.eligible).toHaveLength(1);
    expect(preview.body.data.eligible[0]).toMatchObject({ bookingId, ownerNetAmount: '1050.00', deductions: '100.00' });
    // a booking still inside its hold is listed as held, not eligible
    const { bookingId: fresh } = await book(customer, 220);
    await payBooking(fresh);
    await complete(fresh, 1);
    const preview2 = await bearer(request(h.app).get('/api/v1/settlements/preview'), owner).query({ periodStart, periodEnd });
    expect(preview2.body.data.eligible).toHaveLength(1);
    expect(preview2.body.data.held).toHaveLength(1);
    expect(preview2.body.data.held[0]).toMatchObject({ bookingId: fresh, holdReason: 'HOLD_PERIOD' });

    expect((await bearer(request(h.app).post('/api/v1/settlements'), owner).set('Idempotency-Key', key()).send({ ownerProfileId, periodStart, periodEnd })).status).toBe(403);
    const created = await bearer(request(h.app).post('/api/v1/settlements'), finance).set('Idempotency-Key', key()).send({ ownerProfileId, periodStart, periodEnd });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'DRAFT', ownerProfileId, grossAmount: '1150.00', commissionAmount: '100.00', netPayableAmount: '1050.00', lineCount: 1, bankAccount: null });
    expect(created.body.data.settlementNumber).toMatch(/^ST-\d{4}-\d{6}$/);
    settlementId = created.body.data.id;
    // the same booking can never be settled twice
    const again = await bearer(request(h.app).post('/api/v1/settlements'), finance).set('Idempotency-Key', key()).send({ ownerProfileId, periodStart, periodEnd });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('SETTLEMENT_NO_ELIGIBLE_LINES');
    await expect(prisma().settlementLine.create({ data: { id: randomUUID(), settlementId, bookingId, lineType: 'BOOKING_EARNING', amount: 1, description: 'dup', holdReason: 'NONE' } })).rejects.toThrow();

    const lines = await bearer(request(h.app).get(`/api/v1/settlements/${settlementId}/lines`), owner);
    expect(lines.status).toBe(200);
    expect(lines.body.data).toHaveLength(1);
    expect(lines.body.data[0]).toMatchObject({ lineType: 'BOOKING_EARNING', bookingId, amount: '1050.00', holdReason: 'NONE' });
    const penalty = await bearer(request(h.app).post(`/api/v1/settlements/${settlementId}/lines`), finance).send({ lineType: 'PENALTY', amount: '-50.00', description: 'Late arrival penalty' });
    expect(penalty.status, JSON.stringify(penalty.body)).toBe(201);
    expect((await bearer(request(h.app).post(`/api/v1/settlements/${settlementId}/lines`), finance).send({ lineType: 'PENALTY', amount: '50.00', description: 'wrong sign' })).status).toBe(422);
    expect((await bearer(request(h.app).get(`/api/v1/settlements/${settlementId}`), finance)).body.data).toMatchObject({ adjustmentsAmount: '-50.00', netPayableAmount: '1000.00', lineCount: 2 });

    // lifecycle
    expect((await bearer(request(h.app).post(`/api/v1/settlements/${settlementId}/approve`), finance2).send({})).body.error.code).toBe('SETTLEMENT_INVALID_TRANSITION');
    const submitted = await bearer(request(h.app).post(`/api/v1/settlements/${settlementId}/submit`), finance);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.data.status).toBe('PENDING_APPROVAL');
    expect((await bearer(request(h.app).post(`/api/v1/settlements/${settlementId}/lines`), finance).send({ lineType: 'ADJUSTMENT', amount: '10.00', description: 'frozen' })).body.error.code).toBe('SETTLEMENT_INVALID_TRANSITION');
    const selfApprove = await bearer(request(h.app).post(`/api/v1/settlements/${settlementId}/approve`), finance).send({});
    expect(selfApprove.status).toBe(422);
    expect(selfApprove.body.error.code).toBe('SETTLEMENT_FOUR_EYES');
    const approved = await bearer(request(h.app).post(`/api/v1/settlements/${settlementId}/approve`), finance2).send({ notes: 'checked' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');

    // payout: no account → missing; a fresh account → cool-off; past the cool-off → PAID with the postings
    const pay = (body: object) => bearer(request(h.app).post(`/api/v1/settlements/${settlementId}/pay`), finance).set('Idempotency-Key', key()).send(body);
    const missing = await pay({ paymentReference: 'TRF-0001' });
    expect(missing.status).toBe(422);
    expect(missing.body.error).toMatchObject({ code: 'SETTLEMENT_BANK_ACCOUNT_MISSING', details: { reason: 'MISSING' } });
    const bankId = randomUUID();
    await prisma().ownerBankAccount.create({ data: { id: bankId, ownerProfileId, accountHolderName: 'Owner', bankName: 'SNB', ibanEncrypted: 'enc', ibanLast4: '7519', ibanBlindIndex: 'b'.repeat(64), isVerified: true, verifiedAt: new Date(), isDefault: true, activationAt: new Date(Date.now() + 3_600_000) } });
    const cooloff = await pay({ paymentReference: 'TRF-0001' });
    expect(cooloff.body.error.details.reason).toBe('COOLOFF');
    await prisma().ownerBankAccount.update({ where: { id: bankId }, data: { activationAt: daysAgo(1) } });
    const paid = await pay({ paymentReference: 'TRF-0001' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(202);
    expect(paid.body.data).toMatchObject({ status: 'PAID', paymentReference: 'TRF-0001', bankAccount: { ibanLast4: '7519', bankName: 'SNB' } });
    expect(paid.body.data.paidAt).toBeTruthy();
    expect(JSON.stringify(paid.body)).not.toContain('SA03');
    expect((await pay({ paymentReference: 'TRF-0002' })).body.error.code).toBe('SETTLEMENT_INVALID_TRANSITION');
    await groupsBalance();
    const payout = await prisma().ledgerEntry.findMany({ where: { settlementId }, select: { direction: true, amount: true, account: { select: { code: true } } } });
    expect(payout.map((e) => `${e.direction} ${e.account.code} ${e.amount.toFixed(2)}`).sort()).toEqual(['CREDIT CASH_BANK 1000.00', 'DEBIT OWNER_PAYABLE 1000.00']);
    // balance: 1050 (capture) + 1050 (second capture) − 1000 (payout) = 1100; the held booking is not in flight
    const balance = await bearer(request(h.app).get(`/api/v1/ledger/balances/owners/${ownerProfileId}`), finance);
    expect(balance.status).toBe(200);
    expect(balance.body.data).toMatchObject({ accountCode: 'OWNER_PAYABLE', balance: '1100.00', inFlightSettlements: '0.00' });
    expect((await bearer(request(h.app).get('/api/v1/ledger/entries'), owner)).status).toBe(403);
    const ledger = await bearer(request(h.app).get('/api/v1/ledger/entries'), finance).query({ settlementId });
    expect(ledger.status).toBe(200);
    expect(ledger.body.data).toHaveLength(1);
    expect(ledger.body.data[0]).toMatchObject({ settlementId, debitTotal: '1000.00', creditTotal: '1000.00' });
    expect(ledger.body.data[0].entries).toHaveLength(2);

    // owner-facing views
    const mine = await bearer(request(h.app).get('/api/v1/settlements'), owner);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.meta.totalItems).toBe(1);
    const earnings = await bearer(request(h.app).get('/api/v1/commissions/earnings'), owner).query({ groupBy: 'month' });
    expect(earnings.status, JSON.stringify(earnings.body)).toBe(200);
    expect(earnings.body.data.totals).toMatchObject({ bookingCount: 2, grossAmount: '2300.00', commissionAmount: '200.00', ownerNetAmount: '2100.00' });
  });

  it('expenses: create with scoped references, summary, and the PAID-settlement immutability guard', async () => {
    const category = await prisma().expenseCategory.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    const inside = daysAgo(5).toISOString().slice(0, 10);
    const outside = daysAgo(60).toISOString().slice(0, 10);
    const foreignVehicle = await bearer(request(h.app).post('/api/v1/expenses'), owner).send({ expenseCategoryId: category.id, amount: '100.00', vatAmount: '15.00', expenseDate: outside, vehicleId: randomUUID() });
    expect(foreignVehicle.status).toBe(422);
    expect(foreignVehicle.body.error.details.field).toBe('vehicleId');
    const locked = await bearer(request(h.app).post('/api/v1/expenses'), owner).send({ expenseCategoryId: category.id, amount: '200.00', vatAmount: '30.00', expenseDate: inside, vehicleId, vendorName: 'Fuel Co', description: 'Diesel' });
    expect(locked.status, JSON.stringify(locked.body)).toBe(201);
    expect(locked.body.data).toMatchObject({ totalAmount: '230.00', vehicleId, categoryCode: category.code, ownerProfileId });
    const open = await bearer(request(h.app).post('/api/v1/expenses'), owner).send({ expenseCategoryId: category.id, amount: '80.00', expenseDate: outside });
    expect(open.status).toBe(201);
    expect(open.body.data).toMatchObject({ vatAmount: '0.00', totalAmount: '80.00', isLocked: false });
    // inside the PAID settlement period → immutable; outside → editable
    const read = await bearer(request(h.app).get(`/api/v1/expenses/${locked.body.data.id}`), owner);
    expect(read.body.data.isLocked).toBe(true);
    const patchLocked = await bearer(request(h.app).patch(`/api/v1/expenses/${locked.body.data.id}`), owner).send({ amount: '210.00' });
    expect(patchLocked.status).toBe(409);
    expect(patchLocked.body.error.code).toBe('EXPENSE_IMMUTABLE');
    expect((await bearer(request(h.app).delete(`/api/v1/expenses/${locked.body.data.id}`), owner)).status).toBe(409);
    const patched = await bearer(request(h.app).patch(`/api/v1/expenses/${open.body.data.id}`), owner).send({ amount: '90.00', vatAmount: '13.50' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data.totalAmount).toBe('103.50');
    expect((await bearer(request(h.app).get(`/api/v1/expenses/${open.body.data.id}`), customer)).status).toBe(403);
    const summary = await bearer(request(h.app).get('/api/v1/expenses/summary'), owner).query({ groupBy: 'category' });
    expect(summary.status).toBe(200);
    expect(summary.body.data.totals).toMatchObject({ count: 2, amount: '290.00', vatAmount: '43.50', totalAmount: '333.50' });
    const all = await bearer(request(h.app).get('/api/v1/expenses'), finance);
    expect(all.body.meta.totalItems).toBe(2);
    expect((await bearer(request(h.app).delete(`/api/v1/expenses/${open.body.data.id}`), owner)).status).toBe(204);
    expect((await bearer(request(h.app).get('/api/v1/expenses'), owner)).body.meta.totalItems).toBe(1);
  });

  it("platform fleet (A-57): ops assign UniGate's own vehicle without a bid; no commission, transport revenue instead of an owner payable, never settled", async () => {
    // UniGate's own fleet: the seeded platform owner gets a vehicle in the same category; it is not approved for the vertical through onboarding, it simply is UniGate.
    const platform = await prisma().ownerProfile.findFirstOrThrow({ where: { isPlatformFleet: true } });
    await prisma().ownerVerticalApproval.upsert({ where: { ownerProfileId_transportType: { ownerProfileId: platform.id, transportType: 'PASSENGER' } }, create: { id: randomUUID(), ownerProfileId: platform.id, transportType: 'PASSENGER', status: 'APPROVED' }, update: { status: 'APPROVED' } });
    const platformVehicle = await approvedVehicle(platform.id, busCategoryId, 45);
    const req = await bearer(request(h.app).post('/api/v1/trip-requests'), customer).set('Idempotency-Key', key()).send({
      transportType: 'PASSENGER', vehicleCategoryId: busCategoryId, vehiclesRequired: 1, tripDirection: 'ONE_WAY', publish: true,
      pickup: { addressLine: 'Airport', cityId: riyadh, latitude: 24.95761, longitude: 46.69878 }, dropoff: { addressLine: 'Tower', cityId: riyadh, latitude: 24.69056, longitude: 46.68527 },
      pickupAt: hours(320), passengerDetails: { passengerCount: 30, tripPurpose: 'AIRPORT_TRANSFER', luggageCount: 30 },
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const tripRequestId: string = req.body.data.id;
    const assign = (token: string, body: object) => bearer(request(h.app).post(`/api/v1/trip-requests/${tripRequestId}/assign-platform-vehicle`), token).set('Idempotency-Key', key()).send(body);
    expect((await assign(owner, { vehicleId: platformVehicle, baseAmount: '900.00' })).status).toBe(403); // owners never dispatch the platform fleet
    const notPlatform = await assign(admin, { vehicleId, baseAmount: '900.00' });
    expect(notPlatform.status).toBe(422);
    expect(notPlatform.body.error.code).toBe('PLATFORM_FLEET_VEHICLE_REQUIRED');
    const assigned = await assign(admin, { vehicleId: platformVehicle, baseAmount: '900.00' });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    expect(assigned.body.data.booking).toMatchObject({ status: 'PENDING_PAYMENT', ownerProfileId: platform.id, totalAmount: '1035.00' });
    expect(assigned.body.data.tripRequest.status).toBe('FULLY_AWARDED');
    const bookingId: string = assigned.body.data.booking.id;
    // the frozen split: no commission even though the GLOBAL rule says 10 %
    const fin = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}/financials`), finance);
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    expect(fin.body.data.owner).toMatchObject({ commissionAmount: '0.00', ownerNetAmount: '1035.00' });
    expect(fin.body.data.finance.commissionSource).toBe('NONE');
    // capture: transport revenue + fare VAT, no OWNER_PAYABLE line
    const created = await bearer(request(h.app).post('/api/v1/payments'), customer).set('Idempotency-Key', key()).send({ bookingId, amount: '1035.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await bearer(request(h.app).post(`/api/v1/payments/mock/checkout/${created.body.data.payment.providerPaymentId}`), customer).send({ outcome: 'SUCCESS' })).status).toBe(200);
    const capture = await prisma().ledgerEntry.findMany({ where: { bookingId, paymentId: created.body.data.payment.id }, select: { direction: true, amount: true, account: { select: { code: true } } } });
    expect(capture.map((e) => `${e.direction} ${e.account.code} ${e.amount.toFixed(2)}`).sort()).toEqual(['CREDIT TRANSPORT_REVENUE 900.00', 'CREDIT VAT_PAYABLE 135.00', 'DEBIT CASH_GATEWAY 1035.00']);
    await groupsBalance();
    // never settled
    await complete(bookingId, 10);
    const preview = await bearer(request(h.app).get('/api/v1/settlements/preview'), finance).query({ ownerProfileId: platform.id, periodStart, periodEnd });
    expect(preview.status).toBe(200);
    expect(preview.body.data.eligible).toHaveLength(0);
    const build = await bearer(request(h.app).post('/api/v1/settlements'), finance).set('Idempotency-Key', key()).send({ ownerProfileId: platform.id, periodStart, periodEnd });
    expect(build.status).toBe(422);
    expect(build.body.error).toMatchObject({ code: 'SETTLEMENT_NO_ELIGIBLE_LINES', details: { reason: 'PLATFORM_FLEET' } });
    expect((await bearer(request(h.app).get(`/api/v1/ledger/balances/owners/${platform.id}`), finance)).body.data.balance).toBe('0.00');
  });

  it('invoices: seller gate, simplified for a prepaid booking, the corporate cycle cleared by the mock, invoice payment, notes, void rules, rejection and retry, overdue', async () => {
    await setSetting('finance.seller_vat_number', '');
    const gated = await bearer(request(h.app).post('/api/v1/invoices'), finance).set('Idempotency-Key', key()).send({ bookingId: paidBookingId });
    expect(gated.status).toBe(422);
    expect(gated.body.error.code).toBe('INVOICE_SELLER_VAT_NOT_CONFIGURED');
    await setSetting('finance.seller_vat_number', SELLER_VAT);
    await setSetting('finance.seller_name_en', 'UniGate Transport');

    // prepaid booking → SIMPLIFIED (no buyer VAT), documents a settled supply: PAID, nothing outstanding, reported by the mock
    expect((await bearer(request(h.app).post('/api/v1/invoices'), owner).set('Idempotency-Key', key()).send({ bookingId: paidBookingId })).status).toBe(403);
    const simple = await bearer(request(h.app).post('/api/v1/invoices'), finance).set('Idempotency-Key', key()).send({ bookingId: paidBookingId });
    expect(simple.status, JSON.stringify(simple.body)).toBe(201);
    expect(simple.body.data).toMatchObject({ invoiceType: 'SIMPLIFIED_TAX_INVOICE', status: 'PAID', sellerVatNumber: SELLER_VAT, buyerVatNumber: null, subtotalAmount: '1000.00', vatAmount: '150.00', totalAmount: '1150.00', paidAmount: '1150.00', outstandingAmount: '0.00', lineCount: 1, lineGranularity: 'ORDER' });
    expect(simple.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(simple.body.data.einvoice).toMatchObject({ icv: 1, previousInvoiceHash: '0'.repeat(64), clearanceStatus: 'REPORTED' });
    expect(simple.body.data.einvoice.invoiceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(simple.body.data.einvoice.qrCodeTlv).toBeTruthy();
    expect(JSON.stringify(simple.body)).not.toMatch(/cryptographicStamp|clearanceResponse/);
    const firstHash: string = simple.body.data.einvoice.invoiceHash;
    const dup = await bearer(request(h.app).post('/api/v1/invoices'), finance).set('Idempotency-Key', key()).send({ bookingId: paidBookingId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('INVOICE_BOOKING_ALREADY_BILLED');

    // corporate: INVOICED bookings completed in the period → one TAX_INVOICE, cleared before it is issued
    const c1 = await book(corporate, 240);
    const c2 = await book(corporate, 260);
    await complete(c1.bookingId, 8);
    await complete(c2.bookingId, 6);
    const today = new Date().toISOString().slice(0, 10);
    const run = await bearer(request(h.app).post('/api/v1/admin/invoices/generate'), finance).set('Idempotency-Key', key()).send({ periodStart: daysAgo(30).toISOString().slice(0, 10), periodEnd: today });
    expect(run.status, JSON.stringify(run.body)).toBe(202);
    expect(run.body.data).toMatchObject({ customersConsidered: 1, skipped: [] });
    expect(run.body.data.invoices).toHaveLength(1);
    expect(run.body.data.invoices[0]).toMatchObject({ customerProfileId: corporateProfileId, invoiceType: 'TAX_INVOICE', status: 'ISSUED', bookingCount: 2, totalAmount: '2300.00' });
    const invoiceId: string = run.body.data.invoices[0].invoiceId;
    const inv = await bearer(request(h.app).get(`/api/v1/invoices/${invoiceId}`), corporate);
    expect(inv.status).toBe(200);
    expect(inv.body.data).toMatchObject({ buyerVatNumber: BUYER_VAT, outstandingAmount: '2300.00', paidAmount: '0.00', status: 'ISSUED', billingPeriodEnd: today, lineCount: 2 });
    expect(inv.body.data.einvoice).toMatchObject({ icv: 2, previousInvoiceHash: firstHash, clearanceStatus: 'CLEARED' });
    const due = new Date(inv.body.data.dueDate).getTime() - new Date(inv.body.data.issueDate).getTime();
    expect(Math.round(due / 86_400_000)).toBe(30);
    const lines = await bearer(request(h.app).get(`/api/v1/invoices/${invoiceId}/lines`), corporate);
    expect(lines.body.data).toHaveLength(2); // two orders → two ORDER lines
    expect(lines.body.data[0]).toMatchObject({ lineType: 'ORDER', netAmount: '1000.00', vatRate: '0.1500', vatAmount: '150.00', totalAmount: '1150.00' });
    expect((lines.body.data as { bookingIds: string[] }[]).flatMap((l) => l.bookingIds).sort()).toEqual([c1.bookingId, c2.bookingId].sort());
    expect((await bearer(request(h.app).get(`/api/v1/invoices/${invoiceId}`), customer)).status).toBe(404); // another buyer
    expect((await bearer(request(h.app).get('/api/v1/invoices'), corporate)).body.meta.totalItems).toBe(1);
    expect((await bearer(request(h.app).get(`/api/v1/invoices/${invoiceId}/pdf-url`), corporate)).status).toBe(501);
    expect((await bearer(request(h.app).post('/api/v1/admin/invoices/generate'), finance).set('Idempotency-Key', key()).send({ periodStart: daysAgo(30).toISOString().slice(0, 10), periodEnd: today })).body.data.invoices).toHaveLength(0);
    await groupsBalance();
    const receivable = await prisma().ledgerEntry.aggregate({ where: { invoiceId, customerProfileId: corporateProfileId, direction: 'DEBIT', account: { code: 'CUSTOMER_RECEIVABLE' } }, _sum: { amount: true } });
    expect(receivable._sum.amount?.toFixed(2)).toBe('2300.00');

    // the buyer pays the invoice through POST /payments; the mock capture settles the receivable
    const noPay = await bearer(request(h.app).post('/api/v1/payments'), customer).set('Idempotency-Key', key()).send({ invoiceId, amount: '2300.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN });
    expect(noPay.status).toBe(404); // not their invoice
    const tooMuch = await bearer(request(h.app).post('/api/v1/payments'), corporate).set('Idempotency-Key', key()).send({ invoiceId, amount: '2400.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN });
    expect(tooMuch.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    const partial = await bearer(request(h.app).post('/api/v1/payments'), corporate).set('Idempotency-Key', key()).send({ invoiceId, amount: '1000.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN });
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect(partial.body.data.payment).toMatchObject({ purpose: 'INVOICE_PAYMENT', invoiceId, bookingId: null, amount: '1000.00' });
    expect((await bearer(request(h.app).post('/api/v1/payments'), corporate).set('Idempotency-Key', key()).send({ invoiceId, amount: '100.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN })).body.error.code).toBe('PAYMENT_ALREADY_PENDING');
    const captured = await bearer(request(h.app).post(`/api/v1/payments/mock/checkout/${partial.body.data.payment.providerPaymentId}`), corporate).send({ outcome: 'SUCCESS' });
    expect(captured.status, JSON.stringify(captured.body)).toBe(200);
    expect((await bearer(request(h.app).get(`/api/v1/invoices/${invoiceId}`), corporate)).body.data).toMatchObject({ status: 'PARTIALLY_PAID', paidAmount: '1000.00', outstandingAmount: '1300.00' });
    await groupsBalance();

    // corrections: a credit note against one line, a debit note that is itself payable; void refused once cleared / paid
    const creditTooMuch = await bearer(request(h.app).post(`/api/v1/invoices/${invoiceId}/credit-note`), finance).set('Idempotency-Key', key()).send({ reason: 'full', lines: [{ invoiceLineId: lines.body.data[0].id, amount: '1150.00' }, { invoiceLineId: lines.body.data[1].id, amount: '1150.00' }] });
    expect(creditTooMuch.status).toBe(422); // exceeds outstanding
    const credit = await bearer(request(h.app).post(`/api/v1/invoices/${invoiceId}/credit-note`), finance).set('Idempotency-Key', key()).send({ reason: 'waiting time waived', lines: [{ invoiceLineId: lines.body.data[0].id, amount: '115.00' }] });
    expect(credit.status, JSON.stringify(credit.body)).toBe(201);
    expect(credit.body.data).toMatchObject({ invoiceType: 'CREDIT_NOTE', correctsInvoiceId: invoiceId, totalAmount: '115.00', vatAmount: '15.00', outstandingAmount: '0.00', status: 'ISSUED' });
    expect(credit.body.data.einvoice).toMatchObject({ icv: 3, clearanceStatus: 'CLEARED' });
    expect((await bearer(request(h.app).get(`/api/v1/invoices/${invoiceId}`), corporate)).body.data.outstandingAmount).toBe('1185.00');
    const debit = await bearer(request(h.app).post(`/api/v1/invoices/${invoiceId}/debit-note`), finance).set('Idempotency-Key', key()).send({ reason: 'extra stop', lines: [{ descriptionEn: 'Extra stop', descriptionAr: 'توقف إضافي', netAmount: '100.00' }] });
    expect(debit.status, JSON.stringify(debit.body)).toBe(201);
    expect(debit.body.data).toMatchObject({ invoiceType: 'DEBIT_NOTE', correctsInvoiceId: invoiceId, subtotalAmount: '100.00', vatAmount: '15.00', totalAmount: '115.00', outstandingAmount: '115.00', status: 'ISSUED' });
    const voidCleared = await bearer(request(h.app).post(`/api/v1/invoices/${invoiceId}/void`), finance).send({ reason: 'mistake' });
    expect(voidCleared.status).toBe(409);
    expect(voidCleared.body.error.code).toBe('INVOICE_ALREADY_CLEARED');
    await groupsBalance();

    // a rejected clearance rests in CLEARANCE_FAILED (retained, number kept); void releases the bookings; retry re-presents the same document
    const mock = mockClearanceProvider();
    if (!mock) throw new Error('mock clearance provider expected');
    const c3 = await book(corporate, 280);
    await complete(c3.bookingId, 4);
    const nextNumber = async () => `INV-${new Date().getUTCFullYear()}-${String((await prisma().invoice.count()) + 1).padStart(6, '0')}`;
    mock.script(await nextNumber(), 'REJECT');
    const rejected = await bearer(request(h.app).post('/api/v1/invoices'), finance).set('Idempotency-Key', key()).send({ bookingId: c3.bookingId });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(201);
    expect(rejected.body.data).toMatchObject({ invoiceType: 'TAX_INVOICE', status: 'CLEARANCE_FAILED' });
    expect(rejected.body.data.einvoice).toMatchObject({ clearanceStatus: 'REJECTED', clearanceAttemptCount: 1, lastErrorCode: 'MOCK_REJECTED' });
    const queue = await bearer(request(h.app).get('/api/v1/admin/invoices/clearance-queue'), finance);
    expect(invoiceIds(queue.body.data)).toContain(rejected.body.data.id);
    expect((await bearer(request(h.app).get(`/api/v1/invoices/${rejected.body.data.id}/pdf-url`), corporate)).body.error.code).toBe('INVOICE_CLEARANCE_REJECTED');
    const retryFails = await bearer(request(h.app).post(`/api/v1/admin/invoices/${rejected.body.data.id}/retry-clearance`), finance);
    expect(retryFails.status).toBe(202);
    expect(retryFails.body.data.einvoice.clearanceAttemptCount).toBe(2);
    mock.script(rejected.body.data.invoiceNumber, null);
    const voided = await bearer(request(h.app).post(`/api/v1/invoices/${rejected.body.data.id}/void`), finance).send({ reason: 'buyer VAT number corrected' });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    expect(voided.body.data.status).toBe('VOID');
    // the booking is billable again; the provider outage path leaves PENDING_CLEARANCE and answers 503; the retry completes the issue
    mock.script(await nextNumber(), 'UNAVAILABLE');
    const outage = await bearer(request(h.app).post('/api/v1/invoices'), finance).set('Idempotency-Key', key()).send({ bookingId: c3.bookingId });
    expect(outage.status).toBe(503);
    expect(outage.body.error.code).toBe('CLEARANCE_PROVIDER_UNAVAILABLE');
    const pending = await prisma().invoice.findFirstOrThrow({ where: { status: 'PENDING_CLEARANCE' } });
    mock.script(pending.invoiceNumber, null);
    const retried = await bearer(request(h.app).post(`/api/v1/admin/invoices/${pending.id}/retry-clearance`), finance);
    expect(retried.status, JSON.stringify(retried.body)).toBe(202);
    expect(retried.body.data).toMatchObject({ status: 'ISSUED', invoiceNumber: pending.invoiceNumber });
    expect(retried.body.data.einvoice).toMatchObject({ clearanceStatus: 'CLEARED', icv: Number(pending.icv) });
    await groupsBalance();

    // overdue job: past due → OVERDUE once, reminder on a configured day
    await prisma().invoice.update({ where: { id: invoiceId }, data: { issueDate: daysAgo(37), dueDate: daysAgo(7) } });
    const sweep = await markOverdueInvoices();
    expect(sweep.overdue).toBe(1);
    expect(sweep.reminders).toBe(1);
    expect((await bearer(request(h.app).get(`/api/v1/invoices/${invoiceId}`), corporate)).body.data.status).toBe('OVERDUE');
    expect((await markOverdueInvoices()).overdue).toBe(0);
    const overdueList = await bearer(request(h.app).get('/api/v1/invoices'), finance).query({ overdueOnly: 'true' });
    expect(ids(overdueList.body.data)).toEqual([invoiceId]);
    // an OVERDUE invoice still takes a payment
    const settle = await bearer(request(h.app).post('/api/v1/payments'), corporate).set('Idempotency-Key', key()).send({ invoiceId, amount: '1185.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN });
    expect(settle.status, JSON.stringify(settle.body)).toBe(201);
    await bearer(request(h.app).post(`/api/v1/payments/mock/checkout/${settle.body.data.payment.providerPaymentId}`), corporate).send({ outcome: 'SUCCESS' });
    expect((await bearer(request(h.app).get(`/api/v1/invoices/${invoiceId}`), corporate)).body.data).toMatchObject({ status: 'PAID', outstandingAmount: '0.00' });
    await groupsBalance();
  });
});
