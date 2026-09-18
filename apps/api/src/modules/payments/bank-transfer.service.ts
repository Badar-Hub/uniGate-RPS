import type { ActorScope, CreatePaymentResultDto, PaymentConfigDto, PaymentDto } from '@unigate/types';
import type { rejectTransferBody, submitTransferReceiptBody, verifyTransferBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { type Decimal } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { applyGatewayOutcome, getPayment } from './payment.service.js';
import { BANK_TRANSFER_PROVIDER } from './payment.repository.js';
import * as repo from './payment.repository.js';

/**
 * Bank transfer (IBFT) — payments.md §Bank transfer.
 *
 * The customer transfers to UniGate's account (finance.bank_transfer.* settings) quoting the payment
 * number, attaches the receipt (a document on target PAYMENT/{id}) with what they typed on the
 * transfer, and finance verifies it against the bank statement. Verification runs the SAME capture
 * path a gateway webhook does (applyGatewayOutcome → PAID, booking CONFIRMED, ledger against
 * CASH_BANK), so nothing downstream knows how the money arrived. Rejection fails the payment with
 * the reason; the customer may pay again. Nothing here marks a payment PAID on the customer's say-so
 * (architecture: "never trust payment success reported by the frontend").
 */
function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

export interface BankTransferTarget {
  bookingId?: string;
  invoiceId?: string;
  customerProfileId: string;
  purpose: 'BOOKING_PAYMENT' | 'INVOICE_PAYMENT';
  amount: Decimal;
  currency: string;
  /** Booking or invoice number, for the audit trail. */
  reference: string;
}

/** Called by createPayment / createInvoicePayment after every business check has passed. */
export async function createBankTransfer(scope: ActorScope, t: BankTransferTarget, cfg: PaymentConfigDto, idempotencyKey: string | null): Promise<CreatePaymentResultDto> {
  const bt = cfg.bankTransfer;
  if (!bt) throw new BusinessRuleError('PAYMENT_METHOD_UNSUPPORTED', 'Bank transfer is not configured', { enabled: cfg.methodTypes });
  const id = newId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + bt.receiptWindowHours * 3_600_000);
  await prisma().$transaction(async (tx) => {
    const paymentNumber = await repo.nextPaymentNumber(scope, tx);
    await tx.payment.create({
      data: {
        id, paymentNumber, bookingId: t.bookingId ?? null, invoiceId: t.invoiceId ?? null, customerProfileId: t.customerProfileId, purpose: t.purpose, amount: t.amount, currency: t.currency,
        status: 'PENDING', providerCode: BANK_TRANSFER_PROVIDER, paymentMethodType: 'BANK_TRANSFER', expiresAt, idempotencyKey, metadata: { iban: bt.iban, reference: t.reference },
      },
    });
    await tx.paymentTransaction.create({ data: { id: newId(), paymentId: id, type: 'AUTHORIZE', amount: t.amount, currency: t.currency, status: 'INITIATED', responsePayloadRedacted: { method: 'BANK_TRANSFER', awaiting: 'receipt' } } });
    await writeAudit({ ...audit(scope), action: 'payment.initiated', entityType: 'payment', entityId: id, afterValue: { paymentNumber, bookingId: t.bookingId ?? null, invoiceId: t.invoiceId ?? null, amount: t.amount.toFixed(2), methodType: 'BANK_TRANSFER', provider: BANK_TRANSFER_PROVIDER } }, tx);
    await publishEvent('payment', id, 'payment.initiated', { paymentNumber, bookingId: t.bookingId ?? null, invoiceId: t.invoiceId ?? null, customerProfileId: t.customerProfileId, amount: t.amount.toFixed(2) }, tx);
  });
  const payment = await getPayment(scope, id);
  // NONE: nothing to redirect to — the client shows the account details from /payments/config and the receipt form.
  return { payment, action: { type: 'NONE', url: null, method: null, fields: null, clientPayload: null } };
}

/** POST /payments/{id}/receipt — the payer attaches the receipt and what they typed on the transfer. */
export async function submitReceipt(scope: ActorScope, id: string, body: z.infer<typeof submitTransferReceiptBody>): Promise<PaymentDto> {
  const p = await repo.findPayment(scope, id);
  if (!p) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && p.customerProfileId !== scope.actor.customerProfileId) throw new NotFoundError();
  if (p.providerCode !== BANK_TRANSFER_PROVIDER) throw new BusinessRuleError('PAYMENT_INVALID_TRANSITION', 'Only a bank-transfer payment takes a receipt', { providerCode: p.providerCode });
  if (p.status !== 'PENDING') throw new BusinessRuleError('PAYMENT_INVALID_TRANSITION', `Payment is ${p.status}`, { status: p.status });
  const doc = await prisma().document.findFirst({ where: { id: body.documentId, paymentId: id, uploadStatus: 'UPLOADED', deletedAt: null }, select: { id: true, documentTypeCode: true } });
  if (!doc) throw new BusinessRuleError('VALIDATION_FAILED', 'The receipt must be an uploaded document attached to this payment', { fieldErrors: { documentId: ['not an uploaded document of this payment'] }, formErrors: [] });
  const now = new Date();
  await prisma().$transaction(async (tx) => {
    await tx.payment.update({
      where: { id },
      // A submitted receipt stops the expiry clock: finance verifies on its own schedule.
      data: { receiptDocumentId: doc.id, receiptSubmittedAt: now, transferReference: body.transferReference ?? null, transferredAt: body.transferredAt ? new Date(body.transferredAt) : null, expiresAt: null },
    });
    await writeAudit({ ...audit(scope), action: 'payment.receipt_submitted', entityType: 'payment', entityId: id, afterValue: { documentId: doc.id, transferReference: body.transferReference ?? null, transferredAt: body.transferredAt ?? null } }, tx);
    await publishEvent('payment', id, 'payment.receipt_submitted', { paymentNumber: p.paymentNumber, bookingId: p.bookingId, invoiceId: p.invoiceId, customerProfileId: p.customerProfileId, amount: p.amount.toFixed(2) }, tx);
  });
  return getPayment(scope, id);
}

/** POST /admin/payments/{id}/verify-transfer — finance matched the money on the bank statement. */
export async function verifyTransfer(scope: ActorScope, id: string, body: z.infer<typeof verifyTransferBody>): Promise<PaymentDto> {
  const p = await repo.findPayment(scope, id);
  if (!p) throw new NotFoundError();
  if (p.providerCode !== BANK_TRANSFER_PROVIDER) throw new BusinessRuleError('PAYMENT_INVALID_TRANSITION', 'Only a bank-transfer payment is verified by finance', { providerCode: p.providerCode });
  if (p.status !== 'PENDING') throw new BusinessRuleError('PAYMENT_INVALID_TRANSITION', `Payment is ${p.status}`, { status: p.status });
  const at = p.transferredAt ?? new Date();
  await prisma().$transaction(async (tx) => {
    await tx.payment.update({ where: { id }, data: { verifiedByUserId: scope.actor.userId, verifiedAt: new Date(), verificationNotes: body.notes ?? null } });
    await applyGatewayOutcome(id, { state: 'PAID', last4: null, methodType: 'BANK_TRANSFER', providerTransactionId: p.transferReference, failureCode: null, failureMessage: null, occurredAt: at, responseRedacted: { verifiedBy: scope.actor.userId, notes: body.notes ?? null } }, 'verification', tx);
    await writeAudit({ ...audit(scope), action: 'payment.transfer_verified', entityType: 'payment', entityId: id, severity: 'NOTICE', afterValue: { transferReference: p.transferReference, transferredAt: p.transferredAt?.toISOString() ?? null, receiptDocumentId: p.receiptDocumentId, notes: body.notes ?? null } }, tx);
  });
  return getPayment(scope, id);
}

/** POST /admin/payments/{id}/reject-transfer — no matching credit; the customer is told why and may pay again. */
export async function rejectTransfer(scope: ActorScope, id: string, body: z.infer<typeof rejectTransferBody>): Promise<PaymentDto> {
  const p = await repo.findPayment(scope, id);
  if (!p) throw new NotFoundError();
  if (p.providerCode !== BANK_TRANSFER_PROVIDER) throw new BusinessRuleError('PAYMENT_INVALID_TRANSITION', 'Only a bank-transfer payment is rejected by finance', { providerCode: p.providerCode });
  if (p.status !== 'PENDING') throw new BusinessRuleError('PAYMENT_INVALID_TRANSITION', `Payment is ${p.status}`, { status: p.status });
  await prisma().$transaction(async (tx) => {
    await tx.payment.update({ where: { id }, data: { verifiedByUserId: scope.actor.userId, verifiedAt: new Date(), verificationNotes: body.reason } });
    await applyGatewayOutcome(id, { state: 'FAILED', last4: null, methodType: 'BANK_TRANSFER', providerTransactionId: p.transferReference, failureCode: 'TRANSFER_REJECTED', failureMessage: body.reason, occurredAt: new Date(), responseRedacted: { rejectedBy: scope.actor.userId } }, 'verification', tx);
    await writeAudit({ ...audit(scope), action: 'payment.transfer_rejected', entityType: 'payment', entityId: id, severity: 'NOTICE', afterValue: { reason: body.reason, receiptDocumentId: p.receiptDocumentId } }, tx);
  });
  return getPayment(scope, id);
}
