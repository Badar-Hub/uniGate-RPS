import { z } from 'zod';
import {
  BILLING_CYCLE,
  CREDIT_STATUS,
  CUSTOMER_TYPE,
  DRIVER_AVAILABILITY_STATUS,
  ID_TYPE,
  ONBOARDING_STATUS,
  OWNER_TYPE,
  SPO_LEAD_STATUS,
  TRANSPORT_TYPE,
} from '@unigate/types';
import { emailAddress, isoDate, ksaCrNumber, ksaVatNumber, latitude, longitude, locale, moneyStringNonNegative, nationalAddress, phoneE164, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/**
 * Profiles module schemas (api.md §8.2 saved locations, §8.4–§8.7).
 * Strict objects everywhere: unknown keys are 422, never silently dropped.
 */

export const idParams = z.object({ id: uuid });
const optionalNullable = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

// ── /customers ───────────────────────────────────────────────────────────────

export const listCustomersQuery = offsetPagination.extend({
  customerType: z.enum(CUSTOMER_TYPE).optional(),
  cityId: uuid.optional(),
  acquiredBySpoId: uuid.optional(),
  creditStatus: z.enum(CREDIT_STATUS).optional(),
  billingCycle: z.enum(BILLING_CYCLE).optional(),
  hasVatNumber: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: safeText(120).optional(),
});

/** Admin/SPO-created customer: creates the user (no password; activation link) and the profile. */
export const createCustomerBody = z
  .object({
    customerType: z.enum(CUSTOMER_TYPE),
    fullNameEn: safeText(160).pipe(z.string().min(2)),
    fullNameAr: optionalNullable(safeText(160).pipe(z.string().min(2))),
    email: emailAddress.optional(),
    phoneE164,
    preferredLocale: locale.default('ar'),
    defaultCityId: uuid.optional(),
    vatNumber: ksaVatNumber.optional(),
    acquiredBySpoId: uuid.optional(),
  })
  .strict();

export const patchCustomerBody = z
  .object({
    defaultCityId: optionalNullable(uuid),
    vatNumber: optionalNullable(ksaVatNumber),
    acquiredBySpoId: optionalNullable(uuid),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });

export const upsertCorporateBody = z
  .object({
    companyNameEn: safeText(160).pipe(z.string().min(2)),
    companyNameAr: safeText(160).pipe(z.string().min(2)),
    crNumber: ksaCrNumber,
    nationalAddress: nationalAddress.optional(),
    contactPersonName: safeText(160).pipe(z.string().min(2)),
    contactPersonPhone: phoneE164,
    contactPersonEmail: optionalNullable(emailAddress),
    creditTermsDays: z.number().int().min(0).max(180).optional(),
    billingCycle: z.enum(BILLING_CYCLE).optional(),
    invoiceLineGranularity: z.enum(['ORDER', 'BOOKING']).optional(),
  })
  .strict();

export const verifyCustomerBody = z.object({ notes: safeText(500).optional() }).strict();

export const adminCreditBody = z
  .object({
    creditStatus: z.enum(CREDIT_STATUS).optional(),
    creditLimitAmount: moneyStringNonNegative.optional(),
    creditTermsDays: z.number().int().min(0).max(180).optional(),
    billingCycle: z.enum(BILLING_CYCLE).optional(),
    reason: safeText(1000).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.creditStatus === 'SUSPENDED' && !b.reason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'reason is required when suspending credit' });
    if (Object.keys(b).filter((k) => k !== 'reason').length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'at least one credit field is required' });
  });

export const adminVatNumberBody = z.object({ vatNumber: ksaVatNumber.nullable(), reason: safeText(1000).pipe(z.string().min(5)) }).strict();

// ── /owners ──────────────────────────────────────────────────────────────────

export const listOwnersQuery = offsetPagination.extend({
  ownerType: z.enum(OWNER_TYPE).optional(),
  onboardingStatus: z.enum(ONBOARDING_STATUS).optional(),
  cityId: uuid.optional(),
  q: safeText(120).optional(),
});

/** Admin-created owner profile for an existing user (api.md §8.5). */
export const createOwnerBody = z
  .object({
    userId: uuid,
    ownerType: z.enum(['INDIVIDUAL', 'COMPANY']),
    businessNameEn: optionalNullable(safeText(160)),
    businessNameAr: optionalNullable(safeText(160)),
    crNumber: optionalNullable(ksaCrNumber),
  })
  .strict();

/** POST /admin/vendors — admin creates the account and the owner profile in one step; the vendor activates and uploads documents. */
export const createVendorBody = z
  .object({
    email: emailAddress,
    phoneE164: phoneE164.optional(),
    fullNameEn: safeText(160).pipe(z.string().min(2)),
    fullNameAr: safeText(160).pipe(z.string().min(2)).optional(),
    preferredLocale: locale.default('ar'),
    ownerType: z.enum(['INDIVIDUAL', 'COMPANY']),
    businessNameEn: optionalNullable(safeText(160)),
    businessNameAr: optionalNullable(safeText(160)),
    crNumber: optionalNullable(ksaCrNumber),
    /** Verticals the vendor applies for; approval is per vertical. */
    transportTypes: z.array(z.enum(['PASSENGER', 'GOODS'])).min(1).default(['PASSENGER']),
  })
  .strict();

/** Which non-business fields the owner exposes to counterparties (BRIEF-§28). Enforced in the mapper. */
export const ownerPrivacySettings = z
  .object({
    showBusinessName: z.boolean().default(true),
    showRating: z.boolean().default(true),
    showFleetSize: z.boolean().default(false),
    showCity: z.boolean().default(true),
    showContactPhone: z.boolean().default(false),
  })
  .strict();
export type OwnerPrivacySettings = z.infer<typeof ownerPrivacySettings>;

export const patchOwnerBody = z
  .object({
    ownerType: z.enum(['INDIVIDUAL', 'COMPANY']).optional(),
    businessNameEn: optionalNullable(safeText(160)),
    businessNameAr: optionalNullable(safeText(160)),
    crNumber: optionalNullable(ksaCrNumber),
    vatNumber: optionalNullable(ksaVatNumber),
    isVatRegistered: z.boolean().optional(),
    /** Full National ID / Iqama number; stored encrypted with last-4 and a blind index. */
    nationalId: z.string().regex(/^[12]\d{9}$/, 'must be a 10-digit National ID or Iqama').optional(),
    privacySettings: ownerPrivacySettings.partial().optional(),
    transportTypes: z.array(z.enum(TRANSPORT_TYPE)).min(1).max(2).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });

export const ownerDecisionBody = z.object({ notes: safeText(1000).optional() }).strict();
export const ownerRejectBody = z.object({ rejectionReason: safeText(1000).pipe(z.string().min(5)) }).strict();
export const ownerSuspendBody = z.object({ reason: safeText(1000).pipe(z.string().min(5)) }).strict();
export const serviceAreasBody = z.object({ cityIds: z.array(uuid).min(1).max(50) }).strict();

export const ksaIban = z.string().regex(/^SA\d{2}[0-9A-Z]{20}$/, 'must be a 24-character Saudi IBAN');
export const createBankAccountBody = z
  .object({
    accountHolderName: safeText(160).pipe(z.string().min(2)),
    bankName: safeText(120).pipe(z.string().min(2)),
    iban: ksaIban,
    makeDefault: z.boolean().default(false),
  })
  .strict();

// ── /drivers ─────────────────────────────────────────────────────────────────

export const listDriversQuery = offsetPagination.extend({
  approvalStatus: z.enum(ONBOARDING_STATUS).optional(),
  availabilityStatus: z.enum(DRIVER_AVAILABILITY_STATUS).optional(),
  ownerProfileId: uuid.optional(),
  licenseExpiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  q: safeText(120).optional(),
});

const licenceCategory = z.string().regex(/^[A-Z0-9_]{1,16}$/);

/** Creates the driver's phone-only user (OTP login) and the profile under the acting owner. */
export const createDriverBody = z
  .object({
    fullNameEn: safeText(160).pipe(z.string().min(2)),
    fullNameAr: optionalNullable(safeText(160).pipe(z.string().min(2))),
    phoneE164,
    preferredLocale: locale.default('ar'),
    idType: z.enum(ID_TYPE),
    nationalId: z.string().regex(/^[12]\d{9}$/, 'must be a 10-digit National ID or Iqama'),
    dateOfBirth: isoDate.optional(),
    licenseNumber: z.string().regex(/^[0-9A-Z]{5,20}$/, 'invalid licence number'),
    licenseExpiryDate: isoDate,
    licenseCategories: z.array(licenceCategory).min(1).max(10),
    transportTypes: z.array(z.enum(TRANSPORT_TYPE)).min(1).max(2).default(['PASSENGER']),
    emergencyContactName: optionalNullable(safeText(160)),
    emergencyContactPhone: optionalNullable(phoneE164),
    /** Admin only: attach the driver to a specific owner; owners always create under themselves. */
    ownerProfileId: uuid.optional(),
  })
  .strict();

export const patchDriverBody = z
  .object({
    idType: z.enum(ID_TYPE).optional(),
    nationalId: z.string().regex(/^[12]\d{9}$/).optional(),
    dateOfBirth: optionalNullable(isoDate),
    licenseNumber: z.string().regex(/^[0-9A-Z]{5,20}$/).optional(),
    licenseExpiryDate: isoDate.optional(),
    licenseCategories: z.array(licenceCategory).min(1).max(10).optional(),
    transportTypes: z.array(z.enum(TRANSPORT_TYPE)).min(1).max(2).optional(),
    emergencyContactName: optionalNullable(safeText(160)),
    emergencyContactPhone: optionalNullable(phoneE164),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });

export const driverDecisionBody = z.object({ notes: safeText(1000).optional() }).strict();
export const driverRejectBody = z.object({ rejectionReason: safeText(1000).pipe(z.string().min(5)) }).strict();
/** ON_TRIP is system-set only and is rejected here (api.md §8.6). */
export const driverAvailabilityBody = z.object({ availabilityStatus: z.enum(['OFF_DUTY', 'AVAILABLE']) }).strict();

// ── /spo ─────────────────────────────────────────────────────────────────────

export const listSpoProfilesQuery = offsetPagination.extend({
  regionId: uuid.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: safeText(120).optional(),
});

export const createSpoProfileBody = z
  .object({
    userId: uuid,
    employeeCode: z.string().regex(/^[A-Z0-9-]{2,32}$/, 'employee code is 2–32 upper-case alphanumerics'),
    regionId: uuid.optional(),
    managerUserId: uuid.optional(),
    commissionModelId: uuid.optional(),
  })
  .strict();

export const patchSpoProfileBody = z
  .object({
    employeeCode: z.string().regex(/^[A-Z0-9-]{2,32}$/).optional(),
    regionId: optionalNullable(uuid),
    managerUserId: optionalNullable(uuid),
    commissionModelId: optionalNullable(uuid),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });

export const assignSpoCustomerBody = z.object({ customerProfileId: uuid }).strict();
export const spoCustomerParams = z.object({ id: uuid, customerProfileId: uuid });

export const listSpoLeadsQuery = offsetPagination.extend({
  status: z.enum(SPO_LEAD_STATUS).optional(),
  spoProfileId: uuid.optional(),
  q: safeText(120).optional(),
});

export const createSpoLeadBody = z
  .object({
    contactName: safeText(160).pipe(z.string().min(2)),
    contactPhone: phoneE164,
    companyName: optionalNullable(safeText(160)),
    notes: optionalNullable(safeText(2000)),
    /** Admin only; SPOs always create under their own profile. */
    spoProfileId: uuid.optional(),
  })
  .strict();

export const patchSpoLeadBody = z
  .object({
    contactName: safeText(160).pipe(z.string().min(2)).optional(),
    contactPhone: phoneE164.optional(),
    companyName: optionalNullable(safeText(160)),
    status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'LOST']).optional(),
    notes: optionalNullable(safeText(2000)),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });

/** Converting a QUALIFIED lead creates the customer account and writes the attribution chain. */
export const convertSpoLeadBody = z
  .object({
    customerType: z.enum(CUSTOMER_TYPE),
    fullNameEn: safeText(160).pipe(z.string().min(2)),
    fullNameAr: optionalNullable(safeText(160)),
    email: emailAddress.optional(),
    preferredLocale: locale.default('ar'),
  })
  .strict();

export const listSpoCommissionsQuery = offsetPagination.extend({
  spoProfileId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// ── /me/saved-locations ──────────────────────────────────────────────────────

export const savedLocationBody = z
  .object({
    label: safeText(80).pipe(z.string().min(1)),
    addressLine: safeText(500).pipe(z.string().min(3)),
    cityId: uuid,
    latitude,
    longitude,
    placeId: optionalNullable(z.string().max(255)),
  })
  .strict();
export const patchSavedLocationBody = savedLocationBody.partial().strict().refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });
