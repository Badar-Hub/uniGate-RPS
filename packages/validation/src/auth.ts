import { z } from 'zod';
import { CLIENT_TYPE, OTP_CHANNEL, OTP_PURPOSE } from '@unigate/types';
import { emailAddress, locale, phoneE164, safeText, uuid } from './primitives.js';

/**
 * Auth request schemas (api.md §8.1, security.md §3). Shared by the API's validate()
 * middleware, the OpenAPI generator and the web app's forms.
 *
 * Password policy is NIST SP 800-63B style: length over composition (security.md §3.2).
 * Composition rules are deliberately absent; NFKC normalisation happens server-side.
 */
export const PASSWORD_MIN_USER = 10;
export const PASSWORD_MIN_STAFF = 12;
export const PASSWORD_MAX = 128;

export const password = z.string().min(PASSWORD_MIN_USER).max(PASSWORD_MAX);

/** Email or E.164 phone — the login identifier. */
export const identifier = z.union([emailAddress, phoneE164]);

export const clientType = z.enum(CLIENT_TYPE);

const deviceInfo = z.object({
  deviceId: z.string().min(8).max(128).optional(),
  deviceName: safeText(160).optional(),
});

export const registerBody = z
  .object({
    intent: z.enum(['CUSTOMER', 'VEHICLE_OWNER']),
    phoneE164,
    email: emailAddress.optional(),
    password,
    fullNameEn: safeText(160).pipe(z.string().min(2)),
    fullNameAr: safeText(160).pipe(z.string().min(2)).optional(),
    preferredLocale: locale.default('ar'),
    acceptedTermsVersion: z.string().min(1).max(20),
  })
  .strict();

export const loginBody = z
  .object({
    identifier,
    password: z.string().min(1).max(PASSWORD_MAX),
    clientType,
    ...deviceInfo.shape,
  })
  .strict();

export const refreshBody = z
  .object({
    /** Mobile mode only — web mode sends the cookie. */
    refreshToken: z.string().min(32).max(256).optional(),
  })
  .strict();

export const otpRequestBody = z
  .object({
    channel: z.enum(OTP_CHANNEL),
    destination: identifier,
    purpose: z.enum(OTP_PURPOSE),
  })
  .strict();

export const otpVerifyBody = z
  .object({
    channel: z.enum(OTP_CHANNEL),
    destination: identifier,
    purpose: z.enum(OTP_PURPOSE),
    code: z.string().regex(/^\d{4,8}$/),
    clientType: clientType.optional(),
    ...deviceInfo.shape,
  })
  .strict();

export const stepUpRequestBody = z
  .object({
    actionClass: z.enum([
      'BANK_ACCOUNT',
      'PAYOUT',
      'REFUND',
      'ROLE_CHANGE',
      'IMPERSONATION',
      'BULK_EXPORT',
      'CREDENTIAL',
      'SETTINGS',
    ]),
  })
  .strict();
export type StepUpActionClass = z.infer<typeof stepUpRequestBody>['actionClass'];

export const stepUpVerifyBody = z
  .object({ actionClass: stepUpRequestBody.shape.actionClass, code: z.string().regex(/^\d{4,8}$/) })
  .strict();

export const passwordForgotBody = z.object({ identifier }).strict();

export const passwordResetBody = z
  .object({ token: z.string().min(32).max(256), newPassword: password })
  .strict();

export const passwordChangeBody = z
  .object({ currentPassword: z.string().min(1).max(PASSWORD_MAX), newPassword: password })
  .strict();

export const patchMeBody = z
  .object({
    fullNameEn: safeText(160).pipe(z.string().min(2)).optional(),
    fullNameAr: safeText(160).pipe(z.string().min(2)).nullable().optional(),
    preferredLocale: locale.optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

export const sessionIdParams = z.object({ id: uuid });

// ── admin: users & roles (api.md §8.3) ───────────────────────────────────────

export const userIdParams = z.object({ id: uuid });

export const listUsersQuery = z.object({
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  roleCode: z.string().max(48).optional(),
  q: safeText(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createUserBody = z
  .object({
    email: emailAddress,
    phoneE164: phoneE164.optional(),
    fullNameEn: safeText(160).pipe(z.string().min(2)),
    fullNameAr: safeText(160).pipe(z.string().min(2)).optional(),
    preferredLocale: locale.default('en'),
    roleCodes: z.array(z.string().min(1).max(48)).min(1).max(10),
  })
  .strict();

export const patchUserBody = z
  .object({
    fullNameEn: safeText(160).pipe(z.string().min(2)).optional(),
    fullNameAr: safeText(160).pipe(z.string().min(2)).nullable().optional(),
    preferredLocale: locale.optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

export const suspendUserBody = z.object({ reason: safeText(500).pipe(z.string().min(3)) }).strict();

export const setUserRolesBody = z
  .object({ roleCodes: z.array(z.string().min(1).max(48)).min(0).max(10) })
  .strict();

export const roleCodeParams = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/) });

export const createRoleBody = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/),
    nameEn: safeText(120).pipe(z.string().min(2)),
    nameAr: safeText(120).pipe(z.string().min(2)),
    description: safeText(500).optional(),
    permissionCodes: z.array(z.string().min(3).max(64)).min(0).max(200),
  })
  .strict();

export const updateRoleBody = createRoleBody.omit({ code: true }).partial().strict();
