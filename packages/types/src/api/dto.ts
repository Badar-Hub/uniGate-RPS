/**
 * Base DTO shapes. Every DTO is hand-written; none is derived from a Prisma model.
 */

import type { MoneyString } from '../domain/money.js';

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

// ── Profiles (api.md §8.4–§8.7) ───────────────────────────────────────────────

export interface NationalAddressDto {
  buildingNumber: string | null;
  streetEn: string | null;
  streetAr: string | null;
  districtEn: string | null;
  districtAr: string | null;
  cityId: string | null;
  postalCode: string | null;
  additionalNumber: string | null;
  shortCode: string | null;
  /** All mandatory ZATCA buyer-address fields present (FR-PROFILES-14). */
  isComplete: boolean;
}

export interface CorporateCustomerDto extends TimestampedDto {
  id: string;
  companyNameEn: string;
  companyNameAr: string;
  crNumber: string;
  nationalAddress: NationalAddressDto;
  contactPersonName: string;
  contactPersonPhone: string;
  contactPersonEmail: string | null;
  creditStatus: string;
  creditLimitAmount: MoneyString;
  creditTermsDays: number;
  billingCycle: string;
  invoiceLineGranularity: string | null;
  isVerified: boolean;
  creditApprovedAt: string | null;
}

export interface CustomerDto extends TimestampedDto {
  id: string;
  userId: string;
  customerType: string;
  fullNameEn: string;
  fullNameAr: string | null;
  /** Masked unless the viewer is the customer themselves or holds a PII permission. */
  phoneE164: string | null;
  email: string | null;
  userStatus: string;
  vatNumber: string | null;
  vatNumberVerifiedAt: string | null;
  /** Set once an invoice has been issued against the VAT number (immutable thereafter). */
  vatNumberLockedAt: string | null;
  defaultCityId: string | null;
  ratingAvg: string;
  ratingCount: number;
  totalBookings: number;
  acquiredBySpoId: string | null;
  corporate: CorporateCustomerDto | null;
}

/** GET /customers/{id}/credit — outstanding figures are computed from the ledger on read. */
export interface CustomerCreditDto {
  customerProfileId: string;
  companyNameEn: string;
  isVerified: boolean;
  creditStatus: string;
  creditLimitAmount: MoneyString;
  creditTermsDays: number;
  billingCycle: string;
  defaultBillingMode: 'PREPAID' | 'INVOICED';
  outstandingAmount: MoneyString;
  availableAmount: MoneyString;
  /** Negative headroom after an admin lowered the limit below the outstanding balance. */
  headroomAmount: MoneyString;
  currency: 'SAR';
  creditApprovedAt: string | null;
  computedAt: string;
}

export interface OwnerVerticalDto {
  transportType: string;
  status: string;
  approvedAt: string | null;
  notes: string | null;
}

export interface OwnerDto extends TimestampedDto {
  id: string;
  userId: string;
  ownerType: string;
  isPlatformFleet: boolean;
  businessNameEn: string | null;
  businessNameAr: string | null;
  crNumber: string | null;
  vatNumber: string | null;
  isVatRegistered: boolean;
  vatVerifiedAt: string | null;
  /** Last four digits only — the encrypted value never leaves the database. */
  nationalIdLast4: string | null;
  onboardingStatus: string;
  approvedAt: string | null;
  rejectionReason: string | null;
  ratingAvg: string;
  ratingCount: number;
  privacySettings: Record<string, boolean>;
  verticals: OwnerVerticalDto[];
  serviceAreaCityIds: string[];
  fullNameEn: string;
  phoneE164: string | null;
  email: string | null;
  userStatus: string;
}

/** What a counterparty sees of an owner — privacy_settings applied in the mapper (FR-PROFILES-06). */
export interface OwnerPublicDto {
  id: string;
  displayName: string;
  ownerType: string;
  ratingAvg: string | null;
  ratingCount: number | null;
  fleetSize: number | null;
  serviceAreaCityIds: string[] | null;
}

export interface OwnerBankAccountDto {
  id: string;
  accountHolderName: string;
  bankName: string;
  ibanLast4: string;
  isVerified: boolean;
  isDefault: boolean;
  /** Payouts to a new account are held until this instant (settlement-redirection defence). */
  activationAt: string;
  createdAt: string;
}

export interface DriverVerticalDto {
  transportType: string;
  status: string;
  approvedAt: string | null;
}

export interface DriverDto extends TimestampedDto {
  id: string;
  userId: string;
  ownerProfileId: string | null;
  fullNameEn: string;
  fullNameAr: string | null;
  phoneE164: string | null;
  userStatus: string;
  idType: string;
  nationalIdLast4: string | null;
  dateOfBirth: string | null;
  licenseNumberLast4: string | null;
  licenseExpiryDate: string | null;
  licenseCategories: string[];
  approvalStatus: string;
  availabilityStatus: string;
  ratingAvg: string;
  ratingCount: number;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  verticals: DriverVerticalDto[];
}

export interface DriverAssignmentDto {
  id: string;
  vehicleId: string;
  assignedAt: string;
  unassignedAt: string | null;
  assignedByUserId: string | null;
}

export interface SpoProfileDto extends TimestampedDto {
  id: string;
  userId: string;
  fullNameEn: string;
  email: string | null;
  employeeCode: string;
  regionId: string | null;
  managerUserId: string | null;
  commissionModelId: string | null;
  isActive: boolean;
  activeCustomerCount: number;
}

export interface SpoCustomerAssignmentDto {
  id: string;
  spoProfileId: string;
  customerProfileId: string;
  customerFullNameEn: string;
  assignedAt: string;
  unassignedAt: string | null;
}

export interface SpoLeadDto extends TimestampedDto {
  id: string;
  spoProfileId: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  status: string;
  convertedUserId: string | null;
  notes: string | null;
}

export interface SpoCommissionLineDto {
  bookingId: string;
  spoProfileId: string;
  customerProfileId: string;
  amount: MoneyString;
  basis: string;
  snapshotAt: string;
}

export interface SavedLocationDto extends TimestampedDto {
  id: string;
  label: string;
  addressLine: string;
  cityId: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
}

// ── Documents (api.md §8.10) ─────────────────────────────────────────────────

export interface DocumentDto {
  id: string;
  documentTypeCode: string;
  target: { kind: string; id: string };
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadStatus: string;
  verificationStatus: string;
  verifiedAt: string | null;
  rejectionReason: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  visibility: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadUrlDto {
  documentId: string;
  uploadStatus: 'PENDING';
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string };
}

export interface DownloadUrlDto {
  url: string;
  expiresAt: string;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
}

export type DocumentRequirementStatus = 'MISSING' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export interface DocumentRequirementDto {
  documentTypeCode: string;
  nameEn: string;
  nameAr: string;
  isMandatory: boolean;
  requiresExpiry: boolean;
  transportType: string | null;
  status: DocumentRequirementStatus;
  documentId: string | null;
  expiryDate: string | null;
}

// ── Reference catalogue (api.md §8.9) ────────────────────────────────────────

export interface RegionDto extends BilingualLabel {
  id: string;
  code: string;
}

export interface CityDto extends BilingualLabel {
  id: string;
  regionId: string;
  code: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
}

export interface VehicleCategoryDto extends BilingualLabel {
  id: string;
  code: string;
  transportType: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  iconKey: string | null;
  minPassengerCapacity: number | null;
  maxPassengerCapacity: number | null;
  minPayloadKg: string | null;
  maxPayloadKg: string | null;
  requiresSpecialLicense: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface VehicleMakeDto {
  id: string;
  name: string;
  isActive: boolean;
}

export interface VehicleModelDto {
  id: string;
  makeId: string;
  name: string;
  bodyType: string | null;
  isActive: boolean;
}

export interface DocumentTypeDto extends BilingualLabel {
  code: string;
  appliesTo: string;
  transportType: string | null;
  requiresExpiry: boolean;
  isMandatory: boolean;
  maxSizeBytes: number;
  allowedMimeTypes: string[];
  expiryWarningDays: number;
  sortOrder: number;
  isActive: boolean;
}

export interface CodedLabelDto extends BilingualLabel {
  id: string;
  code: string;
  isActive: boolean;
  sortOrder: number;
}

// ── Fleet (api.md §8.8) ───────────────────────────────────────────────────────

export interface VehicleDto extends TimestampedDto {
  id: string;
  ownerProfileId: string;
  category: { id: string; code: string; nameEn: string; nameAr: string; transportType: string };
  make: { id: string; name: string } | null;
  model: { id: string; name: string } | null;
  modelYear: number;
  plateNumberEn: string;
  plateNumberAr: string | null;
  sequenceNumber: string | null;
  registrationNumber: string;
  /** Masked to the last 4 for anyone but the owner and staff. */
  vin: string | null;
  colorCode: string;
  passengerCapacity: number | null;
  payloadCapacityKg: string | null;
  cargoVolumeM3: string | null;
  cargoLengthCm: number | null;
  cargoWidthCm: number | null;
  cargoHeightCm: number | null;
  bodyType: string | null;
  hasRefrigeration: boolean;
  hasTailLift: boolean;
  approvalStatus: string;
  lifecycleStatus: string;
  operationalStatus: string;
  approvedAt: string | null;
  rejectionReason: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiryDate: string | null;
  registrationExpiryDate: string | null;
  inspectionExpiryDate: string | null;
  odometerKm: number | null;
  baseCityId: string | null;
  notes: string | null;
  ratingAvg: string;
  ratingCount: number;
  /** Open (assigned_to IS NULL) driver assignments. */
  currentDrivers: { assignmentId: string; driverProfileId: string; driverName: string; isPrimary: boolean; assignedFrom: string }[];
  /** The dispatchability predicate, evaluated now (fleet/vehicle.policy). */
  dispatchable: { ok: boolean; reasons: string[] };
}

/** Reduced projection a counterparty sees (api.md §8.8 GET /vehicles/{id}). */
export interface VehiclePublicDto {
  id: string;
  category: { id: string; code: string; nameEn: string; nameAr: string; transportType: string };
  make: string | null;
  model: string | null;
  modelYear: number;
  plateNumberEn: string;
  colorCode: string;
  passengerCapacity: number | null;
  payloadCapacityKg: string | null;
  hasRefrigeration: boolean;
  hasTailLift: boolean;
  ratingAvg: string;
  ratingCount: number;
}

export interface CalendarEntryDto {
  id: string;
  entryType: string;
  status: string;
  period: { from: string; to: string };
  bookingId: string | null;
  bookingNumber: string | null;
  maintenanceRecordId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface VehicleAvailabilityDto {
  vehicleId: string;
  window: { from: string; to: string };
  available: boolean;
  dispatchable: { ok: boolean; reasons: string[] };
  conflicts: { entryId: string; entryType: string; period: { from: string; to: string } }[];
  /** Mandatory documents that expire inside the window. */
  expiringDocuments: { documentTypeCode: string; expiryDate: string }[];
}

export interface VehicleAssignmentDto {
  id: string;
  vehicleId: string;
  driverProfileId: string;
  driverName: string;
  isPrimary: boolean;
  assignedFrom: string;
  assignedTo: string | null;
  unassignedReason: string | null;
  assignedByUserId: string | null;
}
