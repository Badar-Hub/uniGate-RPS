/**
 * Phase 9 — payments through the PaymentGateway port with MockGateway, against the real database:
 *   - intent: exactly one target, server-computed amount (PAYMENT_AMOUNT_MISMATCH), method gate,
 *     return-URL allow-list, one live intent per booking, no client can mark a payment paid
 *   - the webhook route: forged signature → 401 and stored as evidence; the genuine capture →
 *     200, persisted, processed: payment PAID, booking PENDING_PAYMENT → CONFIRMED, balanced
 *     ledger postings; redelivery → 200 duplicate: true and nothing reprocessed; a late
 *     `authorized` after `captured` is IGNORED, never a regression
 *   - decline → FAILED; /sync reconciles a silently settled payment; cancel of a PENDING intent
 *   - refunds: cancellation of a paid booking requests one, four-eyes approval, process →
 *     PROCESSING, the gateway's refund webhook → COMPLETED, payment REFUNDED, booking REFUNDED,
 *     reversing postings balance; Σ refunds ≤ captured
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/database/prisma.js';
import { mockGateway } from '@/integrations/payments/index.js';
import { TEST_DB, bearer, bootHarness, clearThrottles, createUserWithRoles, loginBearer, teardownHarness, type Harness } from './helpers.js';

const describeDb = TEST_DB ? describe : describe.skip;
const PW = 'payments test passphrase 1';
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const RETURN = 'http://localhost:3001/en/bookings/return';

describeDb('payments', () => {
  let h: Harness;
  let admin = '';
  let finance = '';
  let customer = '';
  let owner = '';
  let ownerProfileId = '';
  let busCategoryId = '';
  let riyadh = '';
  let vehicleId = '';

  async function approvedVehicle(ownerId: string, categoryId: string, seats: number): Promise<string> {
    const id = randomUUID();
    await prisma().vehicle.create({ data: { id, ownerProfileId: ownerId, vehicleCategoryId: categoryId, modelYear: 2022, plateNumberEn: `${Math.floor(Math.random() * 9000) + 1000} PAY`, registrationNumber: `REG-${id.slice(0, 6)}`, colorCode: 'WHITE', passengerCapacity: seats, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE' } });
    const types = await prisma().documentType.findMany({ where: { appliesTo: 'VEHICLE', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] } });
    for (const t of types) {
      await prisma().document.create({ data: { id: randomUUID(), documentTypeCode: t.code, vehicleId: id, storageBucket: 'test', storageKey: `test/${id}/${t.code}`, originalFilename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'a'.repeat(64), uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), expiryDate: t.requiresExpiry ? new Date('2032-01-01') : null } });
    }
    return id;
  }

  beforeAll(async () => {
    h = await bootHarness();
    await createUserWithRoles('admin@payments.test', PW, ['SUPER_ADMIN']);
    await createUserWithRoles('finance@payments.test', PW, ['FINANCE_OFFICER']);
    await createUserWithRoles('customer@payments.test', PW, ['CUSTOMER'], 'CUSTOMER');
    const ownerUserId = await createUserWithRoles('owner@payments.test', PW, ['VEHICLE_OWNER'], 'OWNER');
    ownerProfileId = (await prisma().ownerProfile.findFirstOrThrow({ where: { userId: ownerUserId } })).id;
    riyadh = (await prisma().city.findFirstOrThrow({ where: { code: 'RUH' } })).id;
    busCategoryId = (await prisma().vehicleCategory.findFirstOrThrow({ where: { transportType: 'PASSENGER', maxPassengerCapacity: { gte: 40 } }, orderBy: { sortOrder: 'asc' } })).id;
    await prisma().ownerVerticalApproval.create({ data: { id: randomUUID(), ownerProfileId, transportType: 'PASSENGER', status: 'APPROVED' } });
    await prisma().ownerServiceArea.create({ data: { ownerProfileId, cityId: riyadh } });
    vehicleId = await approvedVehicle(ownerProfileId, busCategoryId, 45);
    // 10 % NET_OF_VAT so the postings have a commission line; owner not VAT registered → no commission VAT.
    await prisma().commissionRule.updateMany({ where: { scope: 'GLOBAL', isActive: true }, data: { calculationType: 'PERCENTAGE', percentageRate: 0.1, basis: 'NET_OF_VAT' } });
    await clearThrottles();
    admin = (await loginBearer(h.app, 'admin@payments.test', PW)).accessToken;
    finance = (await loginBearer(h.app, 'finance@payments.test', PW)).accessToken;
    customer = (await loginBearer(h.app, 'customer@payments.test', PW)).accessToken;
    await clearThrottles();
    owner = (await loginBearer(h.app, 'owner@payments.test', PW)).accessToken;
  });
  afterAll(teardownHarness);

  /** Request → bid → accept → one PENDING_PAYMENT booking of 1150.00. */
  async function book(pickupInHours: number): Promise<{ bookingId: string; tripRequestId: string }> {
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
    return { bookingId: accept.body.data.booking.id as string, tripRequestId };
  }
  const pay = (token: string, body: object) => bearer(request(h.app).post('/api/v1/payments'), token).set('Idempotency-Key', randomUUID()).send(body);
  // A string body is sent byte-for-byte (a Buffer would be re-serialised by superagent and break the signature).
  const webhook = (d: { headers: Record<string, string>; body: Buffer }) => request(h.app).post('/api/v1/webhooks/payments/mock').set(d.headers).send(d.body.toString('utf8'));
  async function groupsBalance(): Promise<void> {
    const rows = await prisma().$queryRaw<{ g: string; d: string; c: string }[]>`SELECT transaction_group_id::text AS g, COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount END), 0)::text AS d, COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount END), 0)::text AS c FROM ledger_entries GROUP BY transaction_group_id`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(Number(r.d), `group ${r.g}`).toBe(Number(r.c));
  }

  it('intent: one target, server amount, method gate, return-url allow-list, one live intent; config never leaks a secret', async () => {
    const cfg = await bearer(request(h.app).get('/api/v1/payments/config'), customer);
    expect(cfg.status, JSON.stringify(cfg.body)).toBe(200);
    expect(cfg.body.data).toMatchObject({ providerCode: 'mock', isMock: true, currency: 'SAR', publishableKey: null });
    expect(cfg.body.data.methodTypes).toContain('MADA');
    expect(JSON.stringify(cfg.body)).not.toMatch(/secret|apiKey/i);

    const { bookingId } = await book(100);
    const base = { bookingId, amount: '1150.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN };
    expect((await pay(customer, { ...base, invoiceId: randomUUID() })).status).toBe(422); // both targets
    expect((await pay(customer, { ...base, bookingId: undefined })).status).toBe(422); // neither
    const stale = await pay(customer, { ...base, amount: '1000.00' });
    expect(stale.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    expect(stale.body.error.details).toMatchObject({ expected: '1150.00', received: '1000.00' });
    expect((await pay(customer, { ...base, methodType: 'CASH' })).body.error.code).toBe('PAYMENT_METHOD_UNSUPPORTED');
    expect((await pay(customer, { ...base, returnUrl: 'https://evil.example/return' })).body.error.code).toBe('PAYMENT_RETURN_URL_NOT_ALLOWED');
    // the mobile app returns through its own URL scheme (ADR-011) — allowed; any other scheme is not
    const mobile = await pay(customer, { ...base, returnUrl: 'unigate://pay/return?paymentId=x' });
    expect(mobile.status, JSON.stringify(mobile.body)).toBe(201);
    expect((await bearer(request(h.app).post(`/api/v1/payments/${mobile.body.data.payment.id}/cancel`), customer).send({ reason: 'mobile return-url check' })).status).toBe(200);
    expect((await pay(customer, { ...base, returnUrl: 'evilapp://pay/return' })).body.error.code).toBe('PAYMENT_RETURN_URL_NOT_ALLOWED');
    expect((await pay(owner, base)).status).toBe(403); // owners hold no payments.create
    expect((await bearer(request(h.app).post('/api/v1/payments'), customer).send(base)).status).toBe(400); // key required

    const created = await pay(customer, base);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.payment).toMatchObject({ status: 'PENDING', amount: '1150.00', providerCode: 'mock', paymentMethodType: 'MADA', bookingId });
    expect(created.body.data.payment.paymentNumber).toMatch(/^PY-\d{4}-\d{6}$/);
    expect(created.body.data.action).toMatchObject({ type: 'REDIRECT', method: 'GET' });
    expect(created.body.data.action.url).toContain('/pay/mock/');
    const paymentId: string = created.body.data.payment.id;
    expect((await pay(customer, base)).body.error.code).toBe('PAYMENT_ALREADY_PENDING');
    // the customer sees it; an owner holds no payments.read (they see payment state on the booking); finance sees all; no route lets a client set PAID
    expect((await bearer(request(h.app).get(`/api/v1/payments/${paymentId}`), customer)).status).toBe(200);
    expect((await bearer(request(h.app).get(`/api/v1/payments/${paymentId}`), owner)).status).toBe(403);
    const txns = (await bearer(request(h.app).get(`/api/v1/payments/${paymentId}/transactions`), finance)).body.data as { type: string; status: string }[];
    expect(txns.map((t) => `${t.type}:${t.status}`)).toEqual(['AUTHORIZE:INITIATED']);
    expect((await bearer(request(h.app).get(`/api/v1/payments/${paymentId}/transactions`), customer)).status).toBe(403);
    const status = await bearer(request(h.app).get(`/api/v1/payments/${paymentId}/status`), customer);
    expect(status.body.data).toMatchObject({ status: 'PENDING', bookingStatus: 'PENDING_PAYMENT' });
    // an abandoned checkout is cancelled by the customer; a new intent can then be created
    const cancelled = await bearer(request(h.app).post(`/api/v1/payments/${paymentId}/cancel`), customer).send({ reason: 'changed my mind' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect((await pay(customer, base)).status).toBe(201);
  });

  it('webhooks: forged → 401 stored; capture → PAID + CONFIRMED + balanced postings; duplicate and out-of-order deliveries are harmless', async () => {
    const g = mockGateway();
    if (!g) throw new Error('mock gateway expected');
    const { bookingId } = await book(120);
    const created = await pay(customer, { bookingId, amount: '1150.00', currency: 'SAR', methodType: 'VISA', returnUrl: RETURN });
    expect(created.status).toBe(201);
    const paymentId: string = created.body.data.payment.id;
    const providerPaymentId: string = created.body.data.payment.providerPaymentId;

    // a forged delivery: valid shape, wrong signature → 401, stored as evidence, never processed
    const [genuine] = g.simulateCheckout(providerPaymentId, 'SUCCESS', '1881');
    if (!genuine) throw new Error('no delivery');
    const forged = await webhook({ headers: { ...genuine.headers, 'x-signature': genuine.headers['x-signature']?.replace(/v1=.*/, 'v1=' + '0'.repeat(64)) ?? '' }, body: genuine.body });
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await prisma().paymentWebhookEvent.count({ where: { signatureValid: false } })).toBeGreaterThanOrEqual(1);
    expect((await bearer(request(h.app).get(`/api/v1/payments/${paymentId}/status`), customer)).body.data.status).toBe('PENDING');
    expect((await request(h.app).post('/api/v1/webhooks/payments/nope').set(genuine.headers).send(genuine.body.toString('utf8'))).status).toBe(404);

    // the genuine delivery: 200 fast; processed (inline here — the worker is not running in tests)
    const ok = await webhook(genuine);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ received: true, duplicate: false });
    const { processPendingWebhooks } = await import('@/modules/payments/webhook.service.js');
    expect(await processPendingWebhooks()).toBe(1);
    const paid = await bearer(request(h.app).get(`/api/v1/payments/${paymentId}`), customer);
    expect(paid.body.data).toMatchObject({ status: 'PAID', paymentMethodLast4: '1881', paymentMethodType: 'VISA' });
    expect(paid.body.data.paidAt).not.toBeNull();
    const booking = await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}`), customer);
    expect(booking.body.data).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', paymentDueBy: null });
    // postings: DEBIT cash 1150 = CREDIT owner 1050 + commission 100 + vat 0
    const lines = await prisma().$queryRaw<{ code: string; direction: string; amount: string }[]>`SELECT a.code, e.direction::text, e.amount::text FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.ledger_account_id WHERE e.payment_id = ${paymentId}::uuid ORDER BY a.code`;
    expect(lines).toEqual(expect.arrayContaining([
      { code: 'CASH_GATEWAY', direction: 'DEBIT', amount: '1150.00' },
      { code: 'OWNER_PAYABLE', direction: 'CREDIT', amount: '1050.00' },
      { code: 'PLATFORM_COMMISSION_REVENUE', direction: 'CREDIT', amount: '100.00' },
    ]));
    await groupsBalance();
    const { ownerPayableBalance } = await import('@/modules/finance/ledger.service.js');
    expect((await ownerPayableBalance(ownerProfileId)).toFixed(2)).toBe('1050.00');

    // redelivery of the same event: 200 with duplicate: true, nothing reprocessed
    const again = await webhook(genuine);
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(await processPendingWebhooks()).toBe(0);
    expect(await prisma().ledgerEntry.count({ where: { paymentId } })).toBe(lines.length);
    // a late `authorized` after `captured` is recorded IGNORED, never a regression
    const late = g.signedWebhook({ type: 'payment.authorized', paymentId: providerPaymentId, amount: '1150.00', currency: 'SAR', methodType: 'VISA', last4: '1881' });
    expect((await webhook(late)).status).toBe(200);
    await processPendingWebhooks();
    expect((await bearer(request(h.app).get(`/api/v1/payments/${paymentId}`), customer)).body.data.status).toBe('PAID');
    const lateRow = await prisma().paymentWebhookEvent.findFirstOrThrow({ where: { providerEventId: late.headers['x-event-id'] ?? '' } });
    expect(lateRow.processingStatus).toBe('IGNORED');
    // paying again is refused
    expect((await pay(customer, { bookingId, amount: '1150.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN })).body.error.code).toBe('PAYMENT_ALREADY_CAPTURED');
  });

  it('decline → FAILED; /sync reconciles a silently settled payment; the dev checkout endpoint drives the mock end to end', async () => {
    const g = mockGateway();
    if (!g) throw new Error('mock gateway expected');
    // decline through the dev endpoint (which delivers the webhook to our own route and processes it)
    const a = await book(140);
    const p1 = await pay(customer, { bookingId: a.bookingId, amount: '1150.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN });
    // The hosted page carries no session with us (the phone's in-app browser has no portal cookies): public, like a real gateway page.
    const declined = await request(h.app).post(`/api/v1/payments/mock/checkout/${p1.body.data.payment.providerPaymentId}`).send({ outcome: 'DECLINE' });
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    expect((await bearer(request(h.app).get(`/api/v1/payments/${p1.body.data.payment.id}`), customer)).body.data).toMatchObject({ status: 'FAILED', failureCode: 'DO_NOT_HONOR' });
    expect((await bearer(request(h.app).get(`/api/v1/bookings/${a.bookingId}`), customer)).body.data.status).toBe('PENDING_PAYMENT');
    // a failed intent no longer blocks a new one
    const p2 = await pay(customer, { bookingId: a.bookingId, amount: '1150.00', currency: 'SAR', methodType: 'MADA', returnUrl: RETURN });
    expect(p2.status).toBe(201);
    // the webhook never arrives: ops /sync asks the gateway server-to-server
    g.settleSilently(p2.body.data.payment.providerPaymentId, '9999');
    expect((await bearer(request(h.app).post(`/api/v1/payments/${p2.body.data.payment.id}/sync`), customer)).status).toBe(403);
    const synced = await bearer(request(h.app).post(`/api/v1/payments/${p2.body.data.payment.id}/sync`), admin);
    expect(synced.status, JSON.stringify(synced.body)).toBe(200);
    expect(synced.body.data).toMatchObject({ status: 'PAID', paymentMethodLast4: '9999' });
    expect((await bearer(request(h.app).get(`/api/v1/bookings/${a.bookingId}`), customer)).body.data.status).toBe('CONFIRMED');
    await groupsBalance();
  });

  it('refunds: cancellation of a paid booking requests one; four-eyes approval; process → gateway → webhook → COMPLETED with reversing postings; Σ ≤ captured', async () => {
    const g = mockGateway();
    if (!g) throw new Error('mock gateway expected');
    const { bookingId } = await book(200);
    const created = await pay(customer, { bookingId, amount: '1150.00', currency: 'SAR', methodType: 'STC_PAY', returnUrl: RETURN });
    const paymentId: string = created.body.data.payment.id;
    await bearer(request(h.app).post(`/api/v1/payments/mock/checkout/${created.body.data.payment.providerPaymentId}`), customer).send({ outcome: 'SUCCESS' });
    expect((await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}`), customer)).body.data).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });

    // the customer cancels (≥72h: no fee under the seed policy) → a REQUESTED refund for the full amount
    const cancelled = await bearer(request(h.app).post(`/api/v1/bookings/${bookingId}/cancel`), customer).set('Idempotency-Key', randomUUID()).send({ reasonCode: 'CUSTOMER_PLANS_CHANGED' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.data.refund).toMatchObject({ status: 'REQUESTED', amount: '1150.00' });
    const refundId: string = cancelled.body.data.refund.id;
    expect(cancelled.body.data.refund.refundNumber).toMatch(/^RF-\d{4}-\d{6}$/);
    // Σ refunds ≤ captured: a second refund on the same payment is refused
    const over = await bearer(request(h.app).post('/api/v1/refunds'), finance).send({ paymentId, amount: '1.00', reasonCode: 'GOODWILL' });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('REFUND_EXCEEDS_CAPTURED');
    // four-eyes: the requester (the customer) cannot approve; a customer holds no payments.refund anyway; finance approves
    expect((await bearer(request(h.app).post(`/api/v1/refunds/${refundId}/approve`), customer).send({})).status).toBe(403);
    expect((await bearer(request(h.app).post(`/api/v1/refunds/${refundId}/process`), finance)).body.error.code).toBe('REFUND_INVALID_TRANSITION');
    const approved = await bearer(request(h.app).post(`/api/v1/refunds/${refundId}/approve`), finance).send({ notes: 'policy: no fee' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    const processing = await bearer(request(h.app).post(`/api/v1/refunds/${refundId}/process`), finance);
    expect(processing.status, JSON.stringify(processing.body)).toBe(202);
    expect(processing.body.data.status).toBe('PROCESSING');
    expect(processing.body.data.providerRefundId).toMatch(/^mock_ref_/);
    expect((await bearer(request(h.app).post(`/api/v1/refunds/${refundId}/process`), finance)).body.error.code).toBe('REFUND_ALREADY_PROCESSED');
    // the gateway settles the refund and tells us by webhook
    const done = g.simulateRefund(processing.body.data.providerRefundId, 'COMPLETED');
    expect((await webhook(done)).status).toBe(200);
    const { processPendingWebhooks } = await import('@/modules/payments/webhook.service.js');
    expect(await processPendingWebhooks()).toBe(1);
    expect((await bearer(request(h.app).get(`/api/v1/refunds/${refundId}`), customer)).body.data.status).toBe('COMPLETED');
    expect((await bearer(request(h.app).get(`/api/v1/payments/${paymentId}`), customer)).body.data).toMatchObject({ status: 'REFUNDED', refundedAmount: '1150.00' });
    expect((await bearer(request(h.app).get(`/api/v1/bookings/${bookingId}`), customer)).body.data).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED' });
    // the reversal balances and nets the owner payable back to what it was before this booking
    await groupsBalance();
    const lines = await prisma().$queryRaw<{ code: string; direction: string; amount: string }[]>`SELECT a.code, e.direction::text, e.amount::text FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.ledger_account_id WHERE e.refund_id = ${refundId}::uuid`;
    expect(lines).toEqual(expect.arrayContaining([{ code: 'CASH_GATEWAY', direction: 'CREDIT', amount: '1150.00' }, { code: 'OWNER_PAYABLE', direction: 'DEBIT', amount: '1050.00' }, { code: 'PLATFORM_COMMISSION_REVENUE', direction: 'DEBIT', amount: '100.00' }]));
    const { ownerPayableBalance } = await import('@/modules/finance/ledger.service.js');
    expect((await ownerPayableBalance(ownerProfileId)).toFixed(2)).toBe('2100.00'); // the two earlier captures stay
  });
});
