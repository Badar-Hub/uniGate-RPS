import type { PaymentDto, PaymentTransactionDto, RefundDto } from '@unigate/types';
import { money, toMoneyString } from '@/common/money.js';
import type { PaymentRow, RefundRow, TransactionRow } from './payment.repository.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Never a token, never a PAN: providerPaymentId is a reference, last4 is display-only (ADR-005). */
export function toPaymentDto(p: PaymentRow): PaymentDto {
  const refunded = p.refunds.filter((r) => r.status === 'COMPLETED').reduce((a, r) => a.add(r.amount), money(0));
  return {
    id: p.id,
    paymentNumber: p.paymentNumber,
    bookingId: p.bookingId,
    bookingNumber: p.booking?.bookingNumber ?? null,
    invoiceId: p.invoiceId,
    customerProfileId: p.customerProfileId,
    purpose: p.purpose,
    amount: toMoneyString(p.amount),
    currency: p.currency,
    status: p.status,
    providerCode: p.providerCode,
    providerPaymentId: p.providerPaymentId,
    paymentMethodType: p.paymentMethodType,
    paymentMethodLast4: p.paymentMethodLast4,
    authorizedAt: iso(p.authorizedAt),
    paidAt: iso(p.paidAt),
    failedAt: iso(p.failedAt),
    failureCode: p.failureCode,
    expiresAt: iso(p.expiresAt),
    refundedAmount: toMoneyString(refunded),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toTransactionDto(t: TransactionRow): PaymentTransactionDto {
  return {
    id: t.id,
    type: t.type,
    amount: toMoneyString(t.amount),
    currency: t.currency,
    status: t.status,
    providerTransactionId: t.providerTransactionId,
    providerResponseCode: t.providerResponseCode,
    requestPayloadRedacted: (t.requestPayloadRedacted as Record<string, unknown> | null) ?? null,
    responsePayloadRedacted: (t.responsePayloadRedacted as Record<string, unknown> | null) ?? null,
    occurredAt: t.occurredAt.toISOString(),
  };
}

export function toRefundDto(r: RefundRow): RefundDto {
  return {
    id: r.id,
    refundNumber: r.refundNumber,
    paymentId: r.paymentId,
    paymentNumber: r.payment.paymentNumber,
    bookingId: r.bookingId,
    bookingNumber: r.payment.booking?.bookingNumber ?? null,
    amount: toMoneyString(r.amount),
    currency: r.currency,
    reasonCode: r.reasonCode,
    reasonText: r.reasonText,
    status: r.status,
    requestedByUserId: r.requestedByUserId,
    approvedByUserId: r.approvedByUserId,
    providerRefundId: r.providerRefundId,
    processedAt: iso(r.processedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
