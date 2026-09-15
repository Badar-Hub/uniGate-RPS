import { z } from 'zod';
import { BID_STATUS, COMMISSION_BASIS, COMMISSION_CALCULATION_TYPE } from '@unigate/types';
import { isoTimestamp, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/**
 * Bidding schemas (api.md §8.13, §6.4). Totals are never accepted from the client: the
 * server computes extras, VAT and total and snapshots the VAT rate onto the bid.
 */

/** Unbranded 2dp decimal string (the MoneyString brand is applied in the API). */
const decimalString = z.string().regex(/^\d{1,12}\.\d{2}$/, 'must be a non-negative decimal string with exactly 2 fraction digits');
const positiveDecimal = decimalString.refine((v) => v !== '0.00' && !/^0+\.00$/.test(v), 'must be greater than zero');

export const bidExtra = z
  .object({
    labelEn: safeText(80).pipe(z.string().min(1)),
    labelAr: safeText(80).pipe(z.string().min(1)),
    amount: decimalString,
  })
  .strict();
export type BidExtraInput = z.infer<typeof bidExtra>;

export const createBidBody = z
  .object({
    tripRequestId: uuid,
    vehicleId: uuid,
    driverProfileId: uuid.optional(),
    baseAmount: positiveDecimal,
    extrasBreakdown: z.array(bidExtra).max(20).default([]),
    estimatedArrivalAt: isoTimestamp.optional(),
    estimatedDurationMinutes: z.number().int().min(1).max(10_080).optional(),
    /** Defaults to now + bidding.bid_validity_hours, capped at the request's deadline. */
    validUntil: isoTimestamp.optional(),
    ownerNotes: safeText(1000).optional(),
  })
  .strict();
export type CreateBidInput = z.infer<typeof createBidBody>;

/** Revision: same fields, all optional, still no totals. */
export const patchBidBody = z
  .object({
    driverProfileId: uuid.nullable().optional(),
    baseAmount: positiveDecimal.optional(),
    extrasBreakdown: z.array(bidExtra).max(20).optional(),
    estimatedArrivalAt: isoTimestamp.nullable().optional(),
    estimatedDurationMinutes: z.number().int().min(1).max(10_080).nullable().optional(),
    validUntil: isoTimestamp.optional(),
    ownerNotes: safeText(1000).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');
export type PatchBidInput = z.infer<typeof patchBidBody>;

export const withdrawBidBody = z.object({ reason: safeText(500).optional() }).strict();
export const rejectBidBody = z.object({ reason: safeText(500).optional() }).strict();

/** Admin-only inline override (commissions.override); beats the request-level override for this award. */
export const commissionOverride = z
  .object({
    type: z.enum(COMMISSION_CALCULATION_TYPE),
    value: decimalString.optional(),
    basis: z.enum(COMMISSION_BASIS).optional(),
    reason: safeText(500).pipe(z.string().min(3)),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.type === 'NONE' && o.value !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'NONE carries no value' });
    if (o.type !== 'NONE' && o.value === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: `${o.type} requires a value` });
    if (o.type === 'PERCENTAGE' && o.value !== undefined && Number(o.value) > 100) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'percentage must be 0–100' });
  });

export const acceptBidBody = z
  .object({
    customerNotes: safeText(1000).optional(),
    commissionOverride: commissionOverride.optional(),
  })
  .strict();
export type AcceptBidInput = z.infer<typeof acceptBidBody>;

/** POST /trip-requests/{id}/assign-platform-vehicle — ops dispatch UniGate's own vehicle without a bid (A-57). */
export const assignPlatformVehicleBody = z
  .object({
    vehicleId: uuid,
    driverProfileId: uuid.optional(),
    /** The price the customer pays (net of VAT), set by ops. */
    baseAmount: decimalString,
    extrasBreakdown: z.array(bidExtra).max(20).default([]),
    estimatedDurationMinutes: z.number().int().min(15).max(7 * 24 * 60).optional(),
    notes: safeText(1000).optional(),
  })
  .strict();

export const awardBody = z
  .object({
    bidIds: z
      .array(uuid)
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, 'bidIds must be unique'),
    customerNotes: safeText(1000).optional(),
    commissionOverride: commissionOverride.optional(),
  })
  .strict();
export type AwardInput = z.infer<typeof awardBody>;

export const listBidsQuery = offsetPagination
  .extend({
    status: z.enum(BID_STATUS).optional(),
    tripRequestId: uuid.optional(),
    vehicleId: uuid.optional(),
    dateFrom: isoTimestamp.optional(),
    dateTo: isoTimestamp.optional(),
    minAmount: decimalString.optional(),
    maxAmount: decimalString.optional(),
  })
  .strict();

export const listRequestBidsQuery = offsetPagination
  .extend({
    status: z.enum(BID_STATUS).optional(),
    sort: z.enum(['totalAmount', 'submittedAt', 'estimatedArrivalAt']).default('totalAmount'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();
