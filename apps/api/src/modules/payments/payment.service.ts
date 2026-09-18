import type { PaymentMethodType, Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, CreatePaymentResultDto, PaymentConfigDto, PaymentDto, PaymentStatusDto, PaymentTransactionDto } from '@unigate/types';
import type { createPaymentBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError, UpstreamError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { money } from '@/common/money.js';
import { redact } from '@/common/redact.js';
import { config } from '@/config/index.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { GatewayError, type GatewayPaymentStatus } from '@/integrations/payments/gateway.js';
import { paymentGateway } from '@/integrations/payments/index.js';
import { logger } from '@/logging/logger.js';
import { applyPaymentCaptured, bookingForPayment, type BookingPaymentView } from '@/modules/bookings/booking.service.js';
import { applyInvoicePaymentCaptured, invoiceForPayment, isPayable } from '@/modules/finance/invoice.service.js';
import { postLedger } from '@/modules/finance/ledger.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { toPaymentDto, toTransactionDto } from './payments.mapper.js';
import * as repo from './payment.repository.js';
import { BANK_TRANSFER_PROVIDER } from './payment.repository.js';
import { createBankTransfer } from './bank-transfer.service.js';

/**
 * Payments (api.md §8.17, §6.4, ADR-005). The client creates an *intent*; the terminal state is
 * set only by the gateway — through a signed webhook or the server-to-server `/sync`. There is no
 * request a client can make that marks a payment PAID.
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
export const paymentsSystemScope: AnyScope = { kind: 'SYSTEM', jobName: 'payments', requestId: 'internal' };

const DEFAULT_METHODS = ['MADA', 'VISA', 'MASTERCARD', 'STC_PAY', 'APPLE_PAY', 'BANK_TRANSFER'];

/**
 * Bank transfer (IBFT) is settled by UniGate's finance team against the bank statement, not by the
 * gateway, so it is offered whenever the admin enables it AND has entered the receiving IBAN —
 * independent of which gateway is configured (payments.md §Bank transfer).
 */
async function bankTransferConfig(): Promise<PaymentConfigDto['bankTransfer']> {
  const [iban, bankName, accountName, instructionsEn, instructionsAr, receiptWindowHours] = await Promise.all([
    getSettingValue<string>('finance.bank_transfer.iban', ''),
    getSettingValue<string>('finance.bank_transfer.bank_name', ''),
    getSettingValue<string>('finance.bank_transfer.account_name', ''),
    getSettingValue<string>('finance.bank_transfer.instructions_en', ''),
    getSettingValue<string>('finance.bank_transfer.instructions_ar', ''),
    getSettingValue<number>('finance.bank_transfer.receipt_window_hours', 48),
  ]);
  if (!iban || !bankName) return null;
  return { bankName, accountName, iban, instructionsEn, instructionsAr, receiptWindowHours };
}

export async function paymentConfig(): Promise<PaymentConfigDto> {
  const g = paymentGateway();
  const enabled = await getSettingValue<string[]>('finance.payment_methods_enabled', DEFAULT_METHODS);
  const currency = await getSettingValue<string>('finance.currency', 'SAR');
  const bankTransfer = enabled.includes('BANK_TRANSFER') ? await bankTransferConfig() : null;
  const methodTypes = enabled.filter((m) => (m === 'BANK_TRANSFER' ? bankTransfer !== null : (g.supportedMethods as readonly string[]).includes(m)));
  // Never a secret: the publishable key is the only credential a browser may see (ADR-005).
  return { providerCode: g.code, methodTypes, currency, publishableKey: g.publishableKey, isMock: g.code === 'mock', bankTransfer };
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function getPayment(scope: AnyScope, id: string): Promise<PaymentDto> {
  const p = await repo.findPayment(scope, id);
  if (!p) throw new NotFoundError();
  return toPaymentDto(p);
}

export async function listPayments(scope: AnyScope, f: repo.PaymentFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listPayments(scope, f, page);
  return { items: items.map(toPaymentDto), total };
}

/** Lightweight poll for the return page — reads local state only, never the gateway. */
export async function paymentStatus(scope: AnyScope, id: string): Promise<PaymentStatusDto> {
  const p = await repo.findPayment(scope, id);
  if (!p) throw new NotFoundError();
  return { id: p.id, status: p.status, paidAt: p.paidAt ? p.paidAt.toISOString() : null, failureCode: p.failureCode, bookingStatus: p.booking?.status ?? null };
}

export async function listTransactions(scope: AnyScope, id: string): Promise<PaymentTransactionDto[]> {
  const rows = await repo.listTransactions(scope, id);
  if (!rows) throw new NotFoundError();
  return rows.map(toTransactionDto);
}

// ── create ───────────────────────────────────────────────────────────────────

/**
 * The hosted page redirects here after checkout, so the target must be ours: the portal, an
 * allow-listed web origin, or the mobile app's own URL scheme (`unigate://pay/return?…`, opened
 * from an in-app browser session — ADR-011). Anything else would let a crafted request send the
 * customer, and the payment id in the query string, to a third party.
 */
function assertReturnUrl(url: string): void {
  const u = new URL(url);
  const scheme = config().mobileDeepLinkScheme;
  if (u.protocol === `${scheme}:`) return;
  // Expo Go (development only) opens the app through exp:// links instead of the custom scheme.
  if (!config().isProduction && (u.protocol === 'exp:' || u.protocol === 'exps:')) return;
  const allowed = [config().appUrl, ...config().corsOrigins].map((o) => new URL(o).origin);
  if (!allowed.includes(u.origin)) throw new BusinessRuleError('PAYMENT_RETURN_URL_NOT_ALLOWED', 'returnUrl must be on an allow-listed origin or the mobile app scheme', { origin: u.origin });
}

/** POST /payments — exactly one target: a PENDING_PAYMENT booking, or a payable invoice (ISSUED / PARTIALLY_PAID / OVERDUE). */
export async function createPayment(scope: ActorScope, body: z.infer<typeof createPaymentBody>, idempotencyKey: string | null): Promise<CreatePaymentResultDto> {
  if (body.invoiceId) return createInvoicePayment(scope, body, body.invoiceId, idempotencyKey);
  if (!body.bookingId) throw new NotFoundError();
  assertReturnUrl(body.returnUrl);
  const cfg = await paymentConfig();
  if (!cfg.methodTypes.includes(body.methodType)) throw new BusinessRuleError('PAYMENT_METHOD_UNSUPPORTED', `${body.methodType} is not enabled`, { enabled: cfg.methodTypes });
  const b = await bookingForPayment(scope, body.bookingId);
  if (!b) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && b.customerProfileId !== scope.actor.customerProfileId) throw new NotFoundError();
  if (b.paymentStatus === 'PAID') throw new ConflictError('PAYMENT_ALREADY_CAPTURED', `Booking ${b.bookingNumber} is already paid`);
  if (b.billingMode === 'INVOICED') throw new BusinessRuleError('BOOKING_INVALID_TRANSITION', 'An INVOICED booking is collected through its invoice, not paid per booking (A-46)', { billingMode: b.billingMode });
  if (b.status !== 'PENDING_PAYMENT') throw new BusinessRuleError('BOOKING_INVALID_TRANSITION', `Booking ${b.bookingNumber} is ${b.status}; only PENDING_PAYMENT bookings take a payment`, { status: b.status });
  // The client's amount is compared only to catch a stale price; the charged amount is ours.
  if (!money(body.amount).eq(b.totalAmount) || body.currency !== b.currency) throw new BusinessRuleError('PAYMENT_AMOUNT_MISMATCH', 'The amount shown to the customer is out of date', { expected: b.totalAmount.toFixed(2), received: body.amount, currency: b.currency });
  const pending = await repo.findPendingForBooking(scope, b.id);
  if (pending) throw new ConflictError('PAYMENT_ALREADY_PENDING', `Payment ${pending.paymentNumber} is already in progress for this booking`, { paymentId: pending.id });
  if (body.methodType === 'BANK_TRANSFER') {
    return createBankTransfer(scope, { bookingId: b.id, customerProfileId: b.customerProfileId, purpose: 'BOOKING_PAYMENT', amount: b.totalAmount, currency: b.currency, reference: b.bookingNumber }, cfg, idempotencyKey);
  }

  const g = paymentGateway();
  const id = newId();
  const now = new Date();
  const paymentNumber = await prisma().$transaction(async (tx) => {
    const n = await repo.nextPaymentNumber(scope, tx);
    await tx.payment.create({
      data: { id, paymentNumber: n, bookingId: b.id, customerProfileId: b.customerProfileId, purpose: 'BOOKING_PAYMENT', amount: b.totalAmount, currency: b.currency, status: 'PENDING', providerCode: g.code, paymentMethodType: body.methodType, expiresAt: b.paymentDueBy ?? new Date(now.getTime() + 30 * 60_000), idempotencyKey, metadata: { returnUrl: body.returnUrl } },
    });
    return n;
  });

  try {
    const res = await g.createPayment({ paymentId: id, paymentNumber, amount: b.totalAmount.toFixed(2), currency: b.currency, methodType: body.methodType, savedToken: null, returnUrl: body.returnUrl, description: `UniGate booking ${b.bookingNumber}`, customerRef: b.customerProfileId, metadata: { bookingNumber: b.bookingNumber } });
    await prisma().$transaction(async (tx) => {
      await tx.payment.update({ where: { id }, data: { providerPaymentId: res.providerPaymentId, ...(res.expiresAt ? { expiresAt: res.expiresAt } : {}) } });
      await tx.paymentTransaction.create({ data: { id: newId(), paymentId: id, type: 'AUTHORIZE', amount: b.totalAmount, currency: b.currency, status: 'INITIATED', providerTransactionId: res.providerPaymentId, requestPayloadRedacted: redact(res.requestRedacted) as Prisma.InputJsonValue, responsePayloadRedacted: redact(res.responseRedacted) as Prisma.InputJsonValue } });
      await writeAudit({ ...audit(scope), action: 'payment.initiated', entityType: 'payment', entityId: id, afterValue: { paymentNumber, bookingId: b.id, amount: b.totalAmount.toFixed(2), methodType: body.methodType, provider: g.code } }, tx);
      await publishEvent('payment', id, 'payment.initiated', { paymentNumber, bookingId: b.id, customerProfileId: b.customerProfileId, amount: b.totalAmount.toFixed(2) }, tx);
    });
    const dto = await getPayment(scope, id);
    return { payment: dto, action: res.action };
  } catch (e) {
    // An adapter error means "unknown", not "did not happen": the row stays PENDING for reconciliation.
    const detail = e instanceof GatewayError ? e.responseRedacted : { message: e instanceof Error ? e.message : String(e) };
    await prisma().paymentTransaction.create({ data: { id: newId(), paymentId: id, type: 'AUTHORIZE', amount: b.totalAmount, currency: b.currency, status: 'FAILED', responsePayloadRedacted: redact(detail) as Prisma.InputJsonValue } });
    logger().error({ err: e, paymentId: id }, 'gateway createPayment failed');
    throw new UpstreamError('PAYMENT_GATEWAY_ERROR', 'The payment gateway did not accept the request', { paymentId: id, provider: g.code });
  }
}

/**
 * Invoice path (api.md §8.19): the buyer pays all or part of what is outstanding on an ISSUED /
 * PARTIALLY_PAID / OVERDUE invoice (or a debit note). The gateway's capture settles the receivable.
 */
async function createInvoicePayment(scope: ActorScope, body: z.infer<typeof createPaymentBody>, invoiceId: string, idempotencyKey: string | null): Promise<CreatePaymentResultDto> {
  assertReturnUrl(body.returnUrl);
  const cfg = await paymentConfig();
  if (!cfg.methodTypes.includes(body.methodType)) throw new BusinessRuleError('PAYMENT_METHOD_UNSUPPORTED', `${body.methodType} is not enabled`, { enabled: cfg.methodTypes });
  const inv = await invoiceForPayment(scope, invoiceId);
  if (!inv) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && inv.customerProfileId !== scope.actor.customerProfileId) throw new NotFoundError();
  if (!isPayable(inv)) throw new BusinessRuleError('INVOICE_NOT_PAYABLE', `Invoice ${inv.invoiceNumber} is ${inv.status} with ${inv.outstandingAmount.toFixed(2)} outstanding`, { status: inv.status, outstandingAmount: inv.outstandingAmount.toFixed(2) });
  const amount = money(body.amount);
  if (amount.lte(0) || amount.gt(inv.outstandingAmount) || body.currency !== inv.currency) throw new BusinessRuleError('PAYMENT_AMOUNT_MISMATCH', 'The amount must be positive and at most the outstanding balance', { outstandingAmount: inv.outstandingAmount.toFixed(2), received: body.amount, currency: inv.currency });
  const pending = await repo.findPendingForInvoice(scope, inv.id);
  if (pending) throw new ConflictError('PAYMENT_ALREADY_PENDING', `Payment ${pending.paymentNumber} is already in progress for this invoice`, { paymentId: pending.id });
  if (body.methodType === 'BANK_TRANSFER') {
    return createBankTransfer(scope, { invoiceId: inv.id, customerProfileId: inv.customerProfileId, purpose: 'INVOICE_PAYMENT', amount, currency: inv.currency, reference: inv.invoiceNumber }, cfg, idempotencyKey);
  }

  const g = paymentGateway();
  const id = newId();
  const paymentNumber = await prisma().$transaction(async (tx) => {
    const n = await repo.nextPaymentNumber(scope, tx);
    await tx.payment.create({ data: { id, paymentNumber: n, invoiceId: inv.id, customerProfileId: inv.customerProfileId, purpose: 'INVOICE_PAYMENT', amount, currency: inv.currency, status: 'PENDING', providerCode: g.code, paymentMethodType: body.methodType, expiresAt: new Date(Date.now() + 30 * 60_000), idempotencyKey, metadata: { returnUrl: body.returnUrl } } });
    return n;
  });
  try {
    const res = await g.createPayment({ paymentId: id, paymentNumber, amount: amount.toFixed(2), currency: inv.currency, methodType: body.methodType, savedToken: null, returnUrl: body.returnUrl, description: `UniGate invoice ${inv.invoiceNumber}`, customerRef: inv.customerProfileId, metadata: { invoiceNumber: inv.invoiceNumber } });
    await prisma().$transaction(async (tx) => {
      await tx.payment.update({ where: { id }, data: { providerPaymentId: res.providerPaymentId, ...(res.expiresAt ? { expiresAt: res.expiresAt } : {}) } });
      await tx.paymentTransaction.create({ data: { id: newId(), paymentId: id, type: 'AUTHORIZE', amount, currency: inv.currency, status: 'INITIATED', providerTransactionId: res.providerPaymentId, requestPayloadRedacted: redact(res.requestRedacted) as Prisma.InputJsonValue, responsePayloadRedacted: redact(res.responseRedacted) as Prisma.InputJsonValue } });
      await writeAudit({ ...audit(scope), action: 'payment.initiated', entityType: 'payment', entityId: id, afterValue: { paymentNumber, invoiceId: inv.id, amount: amount.toFixed(2), methodType: body.methodType, provider: g.code } }, tx);
      await publishEvent('payment', id, 'payment.initiated', { paymentNumber, invoiceId: inv.id, customerProfileId: inv.customerProfileId, amount: amount.toFixed(2) }, tx);
    });
    return { payment: await getPayment(scope, id), action: res.action };
  } catch (e) {
    const detail = e instanceof GatewayError ? e.responseRedacted : { message: e instanceof Error ? e.message : String(e) };
    await prisma().paymentTransaction.create({ data: { id: newId(), paymentId: id, type: 'AUTHORIZE', amount, currency: inv.currency, status: 'FAILED', responsePayloadRedacted: redact(detail) as Prisma.InputJsonValue } });
    logger().error({ err: e, paymentId: id }, 'gateway createPayment failed');
    throw new UpstreamError('PAYMENT_GATEWAY_ERROR', 'The payment gateway did not accept the request', { paymentId: id, provider: g.code });
  }
}

// ── the state machine ────────────────────────────────────────────────────────

const ORDER: Record<string, number> = { PENDING: 0, AUTHORIZED: 1, PAID: 2, FAILED: 2, CANCELLED: 2, PARTIALLY_REFUNDED: 3, REFUNDED: 4 };

export interface GatewayOutcome {
  state: 'AUTHORIZED' | 'PAID' | 'FAILED' | 'CANCELLED';
  last4: string | null;
  methodType: string | null;
  providerTransactionId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  occurredAt: Date;
  responseRedacted: Record<string, unknown>;
}

/**
 * Applies an authoritative gateway result under the payment's row lock. Out-of-order or stale
 * results (a late `authorized` on a PAID payment) are recorded IGNORED, never applied as a
 * regression. Capture advances the booking and posts the ledger in the same transaction.
 */
export async function applyGatewayOutcome(paymentId: string, o: GatewayOutcome, source: 'webhook' | 'sync' | 'verification', tx: Prisma.TransactionClient): Promise<'applied' | 'ignored'> {
  const scope = paymentsSystemScope;
  await repo.lockPayment(scope, paymentId, tx);
  const p = await repo.findPayment(scope, paymentId, tx);
  if (!p) throw new NotFoundError();
  const from = p.status;
  const to = o.state;
  const regression = (ORDER[to] ?? 0) <= (ORDER[from] ?? 0) && !(from === 'PENDING' && to === 'AUTHORIZED');
  const txType = to === 'PAID' ? 'CAPTURE' : to === 'CANCELLED' ? 'VOID' : 'AUTHORIZE';
  if (from === to || regression) {
    await tx.paymentTransaction.create({ data: { id: newId(), paymentId, type: 'INQUIRY', amount: p.amount, currency: p.currency, status: 'SUCCEEDED', providerTransactionId: o.providerTransactionId, providerResponseCode: `IGNORED:${to}`, responsePayloadRedacted: redact(o.responseRedacted) as Prisma.InputJsonValue } });
    return 'ignored';
  }
  await tx.payment.update({
    where: { id: paymentId },
    data: {
      status: to,
      ...(o.last4 ? { paymentMethodLast4: o.last4 } : {}),
      ...(o.methodType ? { paymentMethodType: o.methodType as PaymentMethodType } : {}),
      ...(to === 'AUTHORIZED' ? { authorizedAt: o.occurredAt } : {}),
      ...(to === 'PAID' ? { paidAt: o.occurredAt, authorizedAt: p.authorizedAt ?? o.occurredAt } : {}),
      ...(to === 'FAILED' ? { failedAt: o.occurredAt, failureCode: o.failureCode, failureMessage: o.failureMessage } : {}),
    },
  });
  await tx.paymentTransaction.create({ data: { id: newId(), paymentId, type: txType, amount: p.amount, currency: p.currency, status: to === 'FAILED' ? 'FAILED' : 'SUCCEEDED', providerTransactionId: o.providerTransactionId, providerResponseCode: o.failureCode, responsePayloadRedacted: redact({ ...o.responseRedacted, source }) } });
  await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: `payment.${to.toLowerCase()}`, entityType: 'payment', entityId: paymentId, beforeValue: { status: from }, afterValue: { status: to, source, failureCode: o.failureCode } }, tx);
  if (to === 'PAID' && p.bookingId) {
    const b = await bookingForPayment(scope, p.bookingId, tx);
    if (b) {
      await applyPaymentCaptured(scope, b.id, tx);
      await postCapture(p.id, b, o.occurredAt, tx, p.providerCode === BANK_TRANSFER_PROVIDER ? 'CASH_BANK' : 'CASH_GATEWAY');
    }
    await publishEvent('payment', paymentId, 'payment.captured', { paymentNumber: p.paymentNumber, bookingId: p.bookingId, customerProfileId: p.customerProfileId, amount: p.amount.toFixed(2) }, tx);
  } else if (to === 'PAID' && p.invoiceId) {
    await applyInvoicePaymentCaptured(scope, p.invoiceId, p.amount, p.id, o.occurredAt, tx);
    await publishEvent('payment', paymentId, 'payment.captured', { paymentNumber: p.paymentNumber, invoiceId: p.invoiceId, customerProfileId: p.customerProfileId, amount: p.amount.toFixed(2) }, tx);
  } else if (to === 'FAILED') {
    await publishEvent('payment', paymentId, 'payment.failed', { paymentNumber: p.paymentNumber, bookingId: p.bookingId, customerProfileId: p.customerProfileId, failureCode: o.failureCode }, tx);
  }
  return 'applied';
}

/**
 * Capture postings, following the frozen booking split (database.md §12.4):
 *   DEBIT  CASH_GATEWAY                gross
 *   CREDIT OWNER_PAYABLE (owner)       ownerNet
 *   CREDIT PLATFORM_COMMISSION_REVENUE commission
 *   CREDIT VAT_PAYABLE                 commissionVat
 *   DEBIT  PAYMENT_PROCESSING_FEES / CREDIT CASH_GATEWAY  fee (0 until the provider reports one)
 * Fare VAT under the deemed-supplier model (ADR-008, pending the advisor) is not yet split out
 * of the owner payable; it is recorded in the snapshot and reported, not posted, until then.
 * UniGate's own fleet (A-57) is different: UniGate is the supplier, so the fare is
 *   DEBIT CASH_GATEWAY gross / CREDIT TRANSPORT_REVENUE net / CREDIT VAT_PAYABLE fare VAT
 * — no owner payable, no commission, no settlement.
 */
async function postCapture(paymentId: string, b: BookingPaymentView, at: Date, tx: Prisma.TransactionClient, cash: 'CASH_GATEWAY' | 'CASH_BANK' = 'CASH_GATEWAY'): Promise<void> {
  const s = b.split;
  if (!s) return;
  if (b.ownerIsPlatformFleet) {
    await postLedger({ description: `capture ${b.bookingNumber} (platform fleet)`, occurredAt: at, currency: b.currency, bookingId: b.id, paymentId, lines: [
      { account: cash, direction: 'DEBIT', amount: s.grossAmount, customerProfileId: b.customerProfileId },
      { account: 'TRANSPORT_REVENUE', direction: 'CREDIT', amount: s.grossAmount.sub(s.vatAmount) },
      { account: 'VAT_PAYABLE', direction: 'CREDIT', amount: s.vatAmount },
    ] }, tx);
    return;
  }
  await postLedger(
    {
      description: `capture ${b.bookingNumber}`, occurredAt: at, currency: b.currency, bookingId: b.id, paymentId,
      lines: [
        { account: cash, direction: 'DEBIT', amount: s.grossAmount, customerProfileId: b.customerProfileId },
        { account: 'OWNER_PAYABLE', direction: 'CREDIT', amount: s.ownerNetAmount, ownerProfileId: b.ownerProfileId },
        { account: 'PLATFORM_COMMISSION_REVENUE', direction: 'CREDIT', amount: s.commissionAmount },
        { account: 'VAT_PAYABLE', direction: 'CREDIT', amount: s.commissionVatAmount },
        { account: 'PAYMENT_PROCESSING_FEES', direction: 'DEBIT', amount: s.paymentFeeAmount },
        { account: cash, direction: 'CREDIT', amount: s.paymentFeeAmount },
      ],
    },
    tx,
  );
}

export function outcomeFromStatus(st: GatewayPaymentStatus): GatewayOutcome | null {
  if (st.state === 'PENDING') return null;
  return { state: st.state, last4: st.last4, methodType: st.methodType, providerTransactionId: st.providerTransactionId, failureCode: st.failureCode, failureMessage: st.failureMessage, occurredAt: st.paidAt ?? new Date(), responseRedacted: st.responseRedacted };
}

/** POST /payments/{id}/sync — server-to-server reconciliation; the only non-webhook way state changes. */
export async function syncPayment(scope: ActorScope, id: string): Promise<PaymentDto> {
  const p = await repo.findPayment(scope, id);
  if (!p?.providerPaymentId) throw new NotFoundError();
  if (p.providerCode === BANK_TRANSFER_PROVIDER) throw new BusinessRuleError('PAYMENT_INVALID_TRANSITION', 'A bank transfer is verified by finance, not synced with a gateway', { providerCode: p.providerCode });
  const g = paymentGateway();
  let st: GatewayPaymentStatus;
  try {
    st = await g.getPaymentStatus(p.providerPaymentId);
  } catch (e) {
    throw new UpstreamError('PAYMENT_GATEWAY_ERROR', 'The gateway could not report the payment status', { paymentId: id, message: e instanceof Error ? e.message : String(e) });
  }
  const o = outcomeFromStatus(st);
  await prisma().$transaction(async (tx) => {
    const result = o ? await applyGatewayOutcome(id, o, 'sync', tx) : 'ignored';
    await writeAudit({ ...audit(scope), action: 'payment.synced', entityType: 'payment', entityId: id, afterValue: { gatewayState: st.state, result } }, tx);
  });
  return getPayment(scope, id);
}

/** POST /payments/{id}/cancel — an abandoned checkout. */
export async function cancelPayment(scope: ActorScope, id: string, reason?: string): Promise<PaymentDto> {
  const p = await repo.findPayment(scope, id);
  if (!p) throw new NotFoundError();
  if (p.status === 'PAID' || p.status === 'REFUNDED' || p.status === 'PARTIALLY_REFUNDED') throw new ConflictError('PAYMENT_ALREADY_CAPTURED', 'The payment has settled; refund it instead');
  if (p.status !== 'PENDING' && p.status !== 'AUTHORIZED') throw new BusinessRuleError('PAYMENT_INVALID_TRANSITION', `Payment is ${p.status}`, { status: p.status });
  await prisma().$transaction(async (tx) => {
    await applyGatewayOutcome(id, { state: 'CANCELLED', last4: null, methodType: null, providerTransactionId: null, failureCode: null, failureMessage: null, occurredAt: new Date(), responseRedacted: { reason: reason ?? null, by: scope.actor.userId } }, 'sync', tx);
    await writeAudit({ ...audit(scope), action: 'payment.cancelled', entityType: 'payment', entityId: id, afterValue: { reason: reason ?? null } }, tx);
  });
  return getPayment(scope, id);
}

// ── jobs ─────────────────────────────────────────────────────────────────────

/** PENDING/AUTHORIZED payments older than 10 minutes are reconciled against the gateway; expired ones are cancelled. */
export async function reconcilePendingPayments(): Promise<{ synced: number; expired: number }> {
  const g = paymentGateway();
  const rows = await repo.listPendingOlderThan(paymentsSystemScope, new Date(Date.now() - 10 * 60_000));
  let synced = 0;
  let expired = 0;
  for (const r of rows) {
    try {
      const st = r.providerPaymentId ? await g.getPaymentStatus(r.providerPaymentId) : null;
      const o = st ? outcomeFromStatus(st) : null;
      if (o) {
        await prisma().$transaction((tx) => applyGatewayOutcome(r.id, o, 'sync', tx));
        synced++;
      } else if (r.expiresAt && r.expiresAt < new Date()) {
        await prisma().$transaction((tx) => applyGatewayOutcome(r.id, { state: 'CANCELLED', last4: null, methodType: null, providerTransactionId: null, failureCode: 'EXPIRED', failureMessage: 'checkout expired', occurredAt: new Date(), responseRedacted: {} }, 'sync', tx));
        expired++;
      }
    } catch (e) {
      logger().warn({ err: e, paymentId: r.id }, 'reconciliation failed for payment');
    }
  }
  return { synced, expired };
}
