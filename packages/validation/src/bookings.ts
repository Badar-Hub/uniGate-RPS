import { z } from 'zod';
import { BILLING_MODE, BOOKING_PAYMENT_STATUS, BOOKING_STATUS, CANCELLATION_REASON_CODE, COMMISSION_CALCULATION_TYPE, TRANSPORT_TYPE } from '@unigate/types';
import { isoTimestamp, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/** Booking schemas (api.md §8.14). Commercial amounts are never accepted from a client. */

const decimalString = z.string().regex(/^\d{1,12}\.\d{2}$/, 'must be a non-negative decimal string with exactly 2 fraction digits');
/** `?status=A&status=B` or `?status=A,B` (api.md §5.2). */
const statusList = z.preprocess((v) => (typeof v === 'string' ? v.split(',') : v), z.array(z.enum(BOOKING_STATUS)).min(1));

export const listBookingsQuery = offsetPagination
  .extend({
    status: statusList.optional(),
    paymentStatus: z.enum(BOOKING_PAYMENT_STATUS).optional(),
    billingMode: z.enum(BILLING_MODE).optional(),
    transportType: z.enum(TRANSPORT_TYPE).optional(),
    customerProfileId: uuid.optional(),
    ownerProfileId: uuid.optional(),
    vehicleId: uuid.optional(),
    driverProfileId: uuid.optional(),
    tripRequestId: uuid.optional(),
    fulfilmentSequence: z.coerce.number().int().min(1).optional(),
    dateFrom: isoTimestamp.optional(),
    dateTo: isoTimestamp.optional(),
    q: safeText(24).optional(),
  })
  .strict();

/** Admin-only per-case fee decision (bookings.manage with global scope). */
export const feeOverride = z
  .object({
    type: z.enum(COMMISSION_CALCULATION_TYPE),
    value: decimalString.optional(),
    reason: safeText(500).pipe(z.string().min(3)),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.type === 'NONE' && o.value !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'NONE carries no value' });
    if (o.type !== 'NONE' && o.value === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: `${o.type} requires a value` });
    if (o.type === 'PERCENTAGE' && o.value !== undefined && Number(o.value) > 100) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'percentage must be 0–100' });
  });

/** Ops records a customer or owner no-show (api.md §8.15, OQ-05). */
export const noShowBody = z
  .object({
    party: z.enum(['CUSTOMER', 'OWNER']),
    reasonText: safeText(1000).optional(),
    feeOverride: feeOverride.optional(),
    requestRefund: z.boolean().default(true),
  })
  .strict();
export const disputeBookingBody = z
  .object({
    category: z.string().regex(/^[A-Z_]{2,48}$/),
    subject: safeText(200).pipe(z.string().min(3)),
    description: safeText(4000).pipe(z.string().min(10)),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  })
  .strict();
export const resolveDisputeBody = z
  .object({
    outcome: z.enum(['COMPLETED', 'REFUND']),
    resolution: safeText(2000).pipe(z.string().min(3)),
    /** Refund amount for outcome REFUND; defaults to the booking total. */
    refundAmount: decimalString.optional(),
  })
  .strict();

export const cancelBookingBody = z
  .object({
    reasonCode: z.enum(CANCELLATION_REASON_CODE),
    reasonText: safeText(1000).optional(),
    requestRefund: z.boolean().default(true),
    waiveFee: z.boolean().optional(),
    feeOverride: feeOverride.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.reasonCode === 'OTHER' && !b.reasonText?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonText'], message: 'required when reasonCode is OTHER' });
    if (b.waiveFee && !b.reasonText?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonText'], message: 'required when waiving the fee' });
    if (b.waiveFee && b.feeOverride) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['feeOverride'], message: 'waiveFee and feeOverride are mutually exclusive' });
  });
export type CancelBookingInput = z.infer<typeof cancelBookingBody>;

export const waiveFeeBody = z.object({ reason: safeText(500).pipe(z.string().min(3)) }).strict();
export const confirmBookingBody = z.object({ reason: safeText(500).pipe(z.string().min(3)) }).strict();
export const dispatchDriverBody = z.object({ driverProfileId: uuid }).strict();
export const readyBody = z.object({ notes: safeText(500).optional() }).strict();
