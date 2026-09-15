import { z } from 'zod';
import { COMMISSION_BASIS, COMMISSION_CALCULATION_TYPE, COMMISSION_SCOPE, INVOICE_STATUS, INVOICE_TYPE, CLEARANCE_STATUS, SETTLEMENT_STATUS, TRANSPORT_TYPE } from '@unigate/types';
import { commissionOverride } from './bidding.js';
import { isoDate, isoTimestamp, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/**
 * Finance schemas (api.md §8.19–§8.22). Money travels as decimal strings; percentages on the
 * commission API are percent (0–100) and stored as fractions. Periods are half-open
 * [periodStart, periodEnd) timestamps for settlements and calendar dates for billing cycles.
 */

const decimalString = z.string().regex(/^\d{1,12}\.\d{2}$/, 'must be a non-negative decimal string with exactly 2 fraction digits');
const positiveDecimal = decimalString.refine((v) => Number(v) > 0, 'must be greater than zero');
const signedDecimal = z.string().regex(/^-?\d{1,12}\.\d{2}$/, 'must be a decimal string with exactly 2 fraction digits');

// ── commissions ──────────────────────────────────────────────────────────────

const ruleCore = z.object({
  name: safeText(120).pipe(z.string().min(2)),
  scope: z.enum(COMMISSION_SCOPE),
  vehicleCategoryId: uuid.nullable().optional(),
  ownerProfileId: uuid.nullable().optional(),
  transportType: z.enum(TRANSPORT_TYPE).nullable().optional(),
  calculationType: z.enum(COMMISSION_CALCULATION_TYPE),
  /** Percent, 0–100. */
  percentageRate: decimalString.nullable().optional(),
  fixedAmount: decimalString.nullable().optional(),
  basis: z.enum(COMMISSION_BASIS).optional(),
  minAmount: decimalString.nullable().optional(),
  maxAmount: decimalString.nullable().optional(),
  priority: z.number().int().min(0).max(1000).default(0),
  effectiveFrom: isoTimestamp.optional(),
  effectiveTo: isoTimestamp.nullable().optional(),
  isActive: z.boolean().default(true),
});

type RulePatch = { [K in keyof z.infer<typeof ruleCore>]?: z.infer<typeof ruleCore>[K] | undefined };
const unset = (v: unknown): boolean => v === null || v === undefined;
function refineRule(r: RulePatch, ctx: z.RefinementCtx): void {
  if (r.scope === 'VEHICLE_CATEGORY' || r.scope === 'OWNER_CATEGORY') {
    if (!r.vehicleCategoryId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicleCategoryId'], message: `required for scope ${r.scope}` });
  }
  if (r.scope === 'OWNER' || r.scope === 'OWNER_CATEGORY') {
    if (!r.ownerProfileId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ownerProfileId'], message: `required for scope ${r.scope}` });
  }
  if (r.scope === 'GLOBAL' && (r.vehicleCategoryId || r.ownerProfileId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scope'], message: 'a GLOBAL rule names no category or owner' });
  if (r.calculationType === 'PERCENTAGE') {
    if (unset(r.percentageRate)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percentageRate'], message: 'required for PERCENTAGE' });
    else if (Number(r.percentageRate) > 100) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percentageRate'], message: 'percent must be 0–100' });
  }
  if (r.calculationType === 'FIXED' && unset(r.fixedAmount)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fixedAmount'], message: 'required for FIXED' });
  if (r.calculationType === 'NONE' && (!unset(r.percentageRate) || !unset(r.fixedAmount))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['calculationType'], message: 'NONE carries no value' });
  if (!unset(r.minAmount) && !unset(r.maxAmount) && Number(r.minAmount) > Number(r.maxAmount)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxAmount'], message: 'must be ≥ minAmount' });
  if (r.effectiveFrom && r.effectiveTo && r.effectiveTo <= r.effectiveFrom) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveTo'], message: 'must be after effectiveFrom' });
}

export const createCommissionRuleBody = ruleCore.strict().superRefine(refineRule);
export const patchCommissionRuleBody = ruleCore.partial().strict().superRefine(refineRule);
export const listCommissionRulesQuery = offsetPagination
  .extend({ scope: z.enum(COMMISSION_SCOPE).optional(), vehicleCategoryId: uuid.optional(), ownerProfileId: uuid.optional(), isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), effectiveOn: isoTimestamp.optional() })
  .strict();

export const commissionPreviewBody = z
  .object({
    ownerProfileId: uuid,
    vehicleCategoryId: uuid,
    transportType: z.enum(TRANSPORT_TYPE).default('PASSENGER'),
    grossAmount: positiveDecimal,
    /** Optional: the request whose override should apply. */
    tripRequestId: uuid.optional(),
    commissionOverride: commissionOverride.optional(),
    at: isoTimestamp.optional(),
  })
  .strict();

/** PATCH /trip-requests/{id}/commission — an override, or null to clear it. */
export const requestCommissionBody = z.object({ override: commissionOverride.nullable() }).strict();

export const commissionEarningsQuery = z
  .object({ ownerProfileId: uuid.optional(), vehicleCategoryId: uuid.optional(), dateFrom: isoTimestamp.optional(), dateTo: isoTimestamp.optional(), groupBy: z.enum(['none', 'owner', 'category', 'month']).default('none') })
  .strict();

// ── settlements ──────────────────────────────────────────────────────────────

const period = { periodStart: isoTimestamp, periodEnd: isoTimestamp };
const refinePeriod = (p: { periodStart: string; periodEnd: string }, ctx: z.RefinementCtx) => {
  if (p.periodEnd <= p.periodStart) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periodEnd'], message: 'must be after periodStart' });
};

export const createSettlementBody = z.object({ ownerProfileId: uuid, ...period, notes: safeText(1000).optional() }).strict().superRefine(refinePeriod);
export const settlementPreviewQuery = z.object({ ownerProfileId: uuid.optional(), ...period }).strict().superRefine(refinePeriod);
export const listSettlementsQuery = offsetPagination
  .extend({ status: z.enum(SETTLEMENT_STATUS).optional(), ownerProfileId: uuid.optional(), periodFrom: isoTimestamp.optional(), periodTo: isoTimestamp.optional(), minAmount: decimalString.optional() })
  .strict();
export const addSettlementLineBody = z
  .object({ lineType: z.enum(['ADJUSTMENT', 'PENALTY']), amount: signedDecimal.refine((v) => Number(v) !== 0, 'must not be zero'), description: safeText(500).pipe(z.string().min(3)) })
  .strict()
  .superRefine((l, ctx) => {
    if (l.lineType === 'PENALTY' && Number(l.amount) > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'a PENALTY reduces the payout: amount must be negative' });
  });
export const rejectSettlementBody = z.object({ reason: safeText(500).pipe(z.string().min(3)) }).strict();
export const approveSettlementBody = z.object({ notes: safeText(500).optional() }).strict();
export const paySettlementBody = z.object({ paymentReference: safeText(128).pipe(z.string().min(3)), bankAccountId: uuid.optional(), notes: safeText(500).optional() }).strict();

// ── ledger ───────────────────────────────────────────────────────────────────

export const listLedgerEntriesQuery = offsetPagination
  .extend({ ledgerAccountCode: safeText(48).optional(), bookingId: uuid.optional(), paymentId: uuid.optional(), settlementId: uuid.optional(), invoiceId: uuid.optional(), ownerProfileId: uuid.optional(), customerProfileId: uuid.optional(), dateFrom: isoTimestamp.optional(), dateTo: isoTimestamp.optional() })
  .strict();
export const ownerIdParams = z.object({ ownerProfileId: uuid }).strict();

// ── invoices ─────────────────────────────────────────────────────────────────

export const listInvoicesQuery = offsetPagination
  .extend({
    invoiceType: z.enum(INVOICE_TYPE).optional(),
    status: z.enum(INVOICE_STATUS).optional(),
    clearanceStatus: z.enum(CLEARANCE_STATUS).optional(),
    bookingId: uuid.optional(),
    issuedToCustomerProfileId: uuid.optional(),
    corporateCustomerProfileId: uuid.optional(),
    overdueOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    dueFrom: isoDate.optional(),
    dueTo: isoDate.optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    minOutstanding: decimalString.optional(),
  })
  .strict();
export const createInvoiceBody = z.object({ bookingId: uuid, notes: safeText(500).optional() }).strict();
export const generateInvoicesBody = z
  .object({ periodStart: isoDate, periodEnd: isoDate, customerProfileId: uuid.optional() })
  .strict()
  .superRefine((p, ctx) => {
    if (p.periodEnd < p.periodStart) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periodEnd'], message: 'must be on or after periodStart' });
  });
export const voidInvoiceBody = z.object({ reason: safeText(500).pipe(z.string().min(3)) }).strict();
export const creditNoteBody = z
  .object({
    reason: safeText(500).pipe(z.string().min(3)),
    /** Per-line amounts to credit (gross, incl. VAT); omit for a full credit. */
    lines: z.array(z.object({ invoiceLineId: uuid, amount: positiveDecimal }).strict()).min(1).optional(),
  })
  .strict();
export const debitNoteBody = z
  .object({ reason: safeText(500).pipe(z.string().min(3)), lines: z.array(z.object({ descriptionEn: safeText(300).pipe(z.string().min(2)), descriptionAr: safeText(300).pipe(z.string().min(2)), netAmount: positiveDecimal, lineType: z.enum(['ADJUSTMENT', 'PENALTY']).default('ADJUSTMENT') }).strict()).min(1) })
  .strict();
export const clearanceQueueQuery = offsetPagination
  .extend({ clearanceStatus: z.enum(CLEARANCE_STATUS).optional(), invoiceType: z.enum(INVOICE_TYPE).optional(), minAgeSeconds: z.coerce.number().int().min(0).optional(), customerProfileId: uuid.optional() })
  .strict();
export const listInvoiceLinesQuery = offsetPagination.strict();

// ── expenses ─────────────────────────────────────────────────────────────────

const expenseCore = z.object({
  vehicleId: uuid.nullable().optional(),
  driverProfileId: uuid.nullable().optional(),
  tripId: uuid.nullable().optional(),
  expenseCategoryId: uuid,
  amount: decimalString,
  vatAmount: decimalString.default('0.00'),
  expenseDate: isoDate,
  description: safeText(1000).nullable().optional(),
  vendorName: safeText(160).nullable().optional(),
  odometerKm: z.number().int().min(0).max(9_999_999).nullable().optional(),
  receiptDocumentId: uuid.nullable().optional(),
  isReimbursable: z.boolean().default(false),
});
export const createExpenseBody = expenseCore
  .extend({ ownerProfileId: uuid.optional() })
  .strict()
  .superRefine((e, ctx) => {
    if (Number(e.amount) <= 0 && Number(e.vatAmount) <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'must be greater than zero' });
  });
export const patchExpenseBody = expenseCore.partial().strict();
export const listExpensesQuery = offsetPagination
  .extend({
    ownerProfileId: uuid.optional(), expenseCategoryId: uuid.optional(), vehicleId: uuid.optional(), driverProfileId: uuid.optional(), tripId: uuid.optional(),
    dateFrom: isoDate.optional(), dateTo: isoDate.optional(), minAmount: decimalString.optional(), maxAmount: decimalString.optional(), isReimbursable: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  })
  .strict();
export const expenseSummaryQuery = z.object({ ownerProfileId: uuid.optional(), vehicleId: uuid.optional(), dateFrom: isoDate.optional(), dateTo: isoDate.optional(), groupBy: z.enum(['category', 'vehicle', 'month']).default('category') }).strict();
