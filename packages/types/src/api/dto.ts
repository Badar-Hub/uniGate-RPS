/**
 * Base DTO shapes. Every DTO is hand-written; none is derived from a Prisma model.
 */

export interface TimestampedDto {
  createdAt: string;
  updatedAt: string;
}

export interface BilingualLabel {
  nameEn: string;
  nameAr: string;
}

export interface BilingualText {
  en: string;
  ar: string;
}

/** Health and readiness (api.md, security.md §7.2 — booleans only, never versions or hosts). */
export interface HealthDto {
  status: 'ok';
  uptimeSeconds: number;
}

export interface ReadinessDto {
  ready: boolean;
  checks: {
    database: boolean;
    redis: boolean;
  };
}

/** `GET /settings` row. Value is JSON; SECRET-scoped rows are never returned. */
export interface SettingDto {
  key: string;
  section: string;
  value: unknown;
  valueType: string;
  scope: 'PUBLIC' | 'INTERNAL';
  descriptionEn: string;
  descriptionAr: string;
  isCodeManaged: boolean;
  updatedAt: string;
}

export interface SettingsSectionDto {
  section: string;
  keyCount: number;
  lastChangedAt: string | null;
}

// ── iam (Phase 3) ────────────────────────────────────────────────────────────

export interface TokenPairDto {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

/** Login / OTP-login / refresh response. `tokens` is null in cookie (web) mode. */
export interface AuthResultDto {
  userId: string;
  sessionId: string;
  clientType: 'WEB' | 'IOS' | 'ANDROID';
  roles: string[];
  tokens: TokenPairDto | null;
}

export interface RegisterResultDto {
  userId: string;
  status: 'PENDING_VERIFICATION';
  /** Where the verification OTP went, masked. */
  otpSentTo: string;
}

export interface OtpRequestResultDto {
  /** Masked destination, e.g. +9665•• ••• •12 */
  sentTo: string;
  expiresInSeconds: number;
  /** Seconds before another code may be requested. */
  resendAfterSeconds: number;
}

export interface StepUpResultDto {
  stepUpToken: string;
  actionClass: string;
  expiresInSeconds: number;
}

export interface SessionEchoDto {
  userId: string;
  sessionId: string;
  roles: string[];
  clientType: 'WEB' | 'IOS' | 'ANDROID';
  expiresAt: string;
}

export interface SessionDto {
  id: string;
  deviceName: string | null;
  clientType: 'WEB' | 'IOS' | 'ANDROID';
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

export interface ProfileSummaryDto {
  customer: { id: string; customerType: string } | null;
  owner: { id: string; onboardingStatus: string; isPlatformFleet: boolean } | null;
  driver: { id: string; approvalStatus: string } | null;
  spo: { id: string; employeeCode: string } | null;
}

/** GET /me — the single call the web app makes on boot. */
export interface MeDto {
  id: string;
  email: string | null;
  emailVerifiedAt: string | null;
  /** Masked unless the viewer is the user themselves (they are, on /me). */
  phoneE164: string | null;
  phoneVerifiedAt: string | null;
  fullNameEn: string;
  fullNameAr: string | null;
  status: string;
  preferredLocale: 'ar' | 'en';
  timezone: string;
  roles: string[];
  permissions: string[];
  permissionVersion: number;
  profiles: ProfileSummaryDto;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Admin view of a user (api.md §8.3). Never carries hashes, tokens or PII ciphertext. */
export interface UserAdminDto {
  id: string;
  email: string | null;
  emailVerifiedAt: string | null;
  phoneE164: string | null;
  phoneVerifiedAt: string | null;
  fullNameEn: string;
  fullNameAr: string | null;
  status: string;
  preferredLocale: 'ar' | 'en';
  timezone: string;
  roles: string[];
  permissionVersion: number;
  profiles: ProfileSummaryDto;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RoleDto {
  code: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  isSystem: boolean;
  permissionCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PermissionDto {
  code: string;
  module: string;
  descriptionEn: string;
  descriptionAr: string;
  isAssignable: boolean;
}
