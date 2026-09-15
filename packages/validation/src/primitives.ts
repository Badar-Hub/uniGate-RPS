import { z } from 'zod';
import { MONEY_PATTERN, RATE_PATTERN, type MoneyString, type RateString } from '@unigate/types';

/**
 * Scalar primitives binding on every endpoint (api.md §2.3). Used by both the API and the
 * web app's forms, so the rule "money is a decimal string" is enforced identically on both
 * sides and the OpenAPI spec is generated from the same definition.
 */

/** UUID (v7 in practice; the format check accepts any RFC-4122 canonical form). */
export const uuid = z.string().uuid();

/** `"1437.50"` — never a JSON number. `1437.5` is a validation failure by design. */
export const moneyString = z
  .string()
  .regex(MONEY_PATTERN, 'must be a decimal string with exactly 2 fraction digits')
  .transform((v) => v as MoneyString);

/** Non-negative money. */
export const moneyStringNonNegative = moneyString.refine(
  (v) => !v.startsWith('-'),
  'must not be negative',
);

/** `"0.1500"` — a fraction with 4 fraction digits. */
export const rateString = z
  .string()
  .regex(RATE_PATTERN, 'must be a rate string with exactly 4 fraction digits (e.g. "0.1500")')
  .transform((v) => v as RateString);

export const currencyCode = z.literal('SAR');

/** ISO-8601 with milliseconds and a literal Z. */
export const isoTimestamp = z
  .string()
  .datetime({ offset: false, precision: 3 })
  .describe('ISO-8601 UTC timestamp, e.g. 2026-09-14T11:02:44.817Z');

/** YYYY-MM-DD */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/** E.164 — KSA mobile by default (security.md T-22 country allow-list is applied in the service). */
export const phoneE164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'must be an E.164 phone number');

export const emailAddress = z.string().email().max(254).transform((v) => v.trim().toLowerCase());

export const locale = z.enum(['ar', 'en']);

/** KSA VAT registration number: 15 digits, starts and ends with 3 (FR-PROFILES-14). */
export const ksaVatNumber = z.string().regex(/^3\d{13}3$/, 'must be a 15-digit KSA VAT number');

/** Saudi Commercial Registration: 10 digits. */
export const ksaCrNumber = z.string().regex(/^\d{10}$/, 'must be a 10-digit CR number');

/** Saudi National Address components (FR-PROFILES-14). */
export const nationalAddress = z.object({
  buildingNumber: z.string().regex(/^\d{4}$/, 'must be 4 digits'),
  streetEn: z.string().min(1).max(160),
  streetAr: z.string().min(1).max(160),
  districtEn: z.string().min(1).max(120),
  districtAr: z.string().min(1).max(120),
  cityId: uuid,
  postalCode: z.string().regex(/^\d{5}$/, 'must be 5 digits'),
  additionalNumber: z.string().regex(/^\d{4}$/, 'must be 4 digits'),
  shortCode: z
    .string()
    .regex(/^[A-Z]{4}\d{4}$/, 'must be a national short address (e.g. RHAA1234)')
    .optional(),
});

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

/** Idempotency-Key header: UUID (api.md §7.2). */
export const idempotencyKey = uuid;

/** Free text that may reach the admin portal — bidi control characters stripped (T-37). */
export const safeText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.replace(/[‪-‮⁦-⁩]/g, '').trim());
