import { z } from 'zod';
import { PAYMENT_METHOD_TYPE, PAYMENT_STATUS, REFUND_REASON_CODE, REFUND_STATUS } from '@unigate/types';
import { isoTimestamp, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/**
 * Payment schemas (api.md §8.17–§8.18, §6.4). The `amount` is accepted only so the server can
 * detect a stale price on the client; the charged amount is always the server's own figure.
 */

const decimalString = z.string().regex(/^\d{1,12}\.\d{2}$/, 'must be a non-negative decimal string with exactly 2 fraction digits');

export const createPaymentBody = z
  .object({
    bookingId: uuid.nullable().optional(),
    invoiceId: uuid.nullable().optional(),
    amount: decimalString,
    currency: z.string().length(3).default('SAR'),
    methodType: z.enum(PAYMENT_METHOD_TYPE),
    savedMethodId: uuid.nullable().optional(),
    returnUrl: z.string().url().max(2000),
    purpose: z.enum(['BOOKING_PAYMENT', 'INVOICE_PAYMENT']).default('BOOKING_PAYMENT'),
  })
  .strict()
  .superRefine((b, ctx) => {
    // A form-level error: neither field is individually wrong (api.md §6.4, ck_payments_single_target).
    if (Boolean(b.bookingId) === Boolean(b.invoiceId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'exactly one of bookingId or invoiceId must be supplied' });
  });
export type CreatePaymentInput = z.infer<typeof createPaymentBody>;

export const listPaymentsQuery = offsetPagination
  .extend({
    status: z.enum(PAYMENT_STATUS).optional(),
    bookingId: uuid.optional(),
    invoiceId: uuid.optional(),
    customerProfileId: uuid.optional(),
    providerCode: safeText(48).optional(),
    paymentMethodType: z.enum(PAYMENT_METHOD_TYPE).optional(),
    dateFrom: isoTimestamp.optional(),
    dateTo: isoTimestamp.optional(),
    minAmount: decimalString.optional(),
    maxAmount: decimalString.optional(),
  })
  .strict();

export const cancelPaymentBody = z.object({ reason: safeText(500).optional() }).strict();

/** Bank transfer: the payer attaches the receipt (a document uploaded against target PAYMENT/{id}) and what they typed on the transfer. */
export const submitTransferReceiptBody = z
  .object({
    documentId: uuid,
    transferReference: safeText(64).optional(),
    transferredAt: isoTimestamp.optional(),
  })
  .strict();
export const verifyTransferBody = z.object({ notes: safeText(1000).optional() }).strict();
export const rejectTransferBody = z.object({ reason: safeText(1000).pipe(z.string().min(5)) }).strict();

export const createRefundBody = z
  .object({
    paymentId: uuid,
    amount: decimalString.refine((v) => Number(v) > 0, 'must be greater than zero'),
    reasonCode: z.enum(REFUND_REASON_CODE),
    reasonText: safeText(1000).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.reasonCode === 'OTHER' && !b.reasonText?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonText'], message: 'required when reasonCode is OTHER' });
  });
export type CreateRefundInput = z.infer<typeof createRefundBody>;

export const listRefundsQuery = offsetPagination
  .extend({
    status: z.enum(REFUND_STATUS).optional(),
    paymentId: uuid.optional(),
    bookingId: uuid.optional(),
    reasonCode: z.enum(REFUND_REASON_CODE).optional(),
    dateFrom: isoTimestamp.optional(),
    dateTo: isoTimestamp.optional(),
  })
  .strict();

export const refundDecisionBody = z.object({ notes: safeText(500).optional() }).strict();
export const rejectRefundBody = z.object({ reason: safeText(500).pipe(z.string().min(3)) }).strict();

/** Development only: drive the MockGateway checkout to an outcome. */
export const mockCheckoutBody = z
  .object({
    outcome: z.enum(['SUCCESS', 'DECLINE', 'AUTHORIZE_ONLY']),
    /** Deliver the signed webhook to the API's own webhook route (default true); false leaves it for /sync. */
    deliverWebhook: z.boolean().default(true),
    last4: z.string().regex(/^\d{4}$/).default('4242'),
  })
  .strict();

export const providerParams = z.object({ provider: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/) });
