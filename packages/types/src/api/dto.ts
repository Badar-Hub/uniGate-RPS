/**
 * Base DTO shapes. Every DTO is hand-written; none is derived from a Prisma model.
 */

import type { MoneyString, RateString } from '../domain/money.js';

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

// ── Demand (api.md §8.11–§8.12) ───────────────────────────────────────────────

export interface TripLocationDto {
  addressLine: string;
  cityId: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
}

export interface PassengerDetailsDto {
  passengerCount: number;
  luggageCount: number;
  luggageNotes: string | null;
  tripPurpose: string;
  requiresFemaleDriver: boolean;
  requiresWheelchairAccess: boolean;
  childSeatsRequired: number;
  waitingTimeMinutes: number;
  isMultiDay: boolean;
  driverLanguagePreference: string[];
}

export interface GoodsDetailsDto {
  cargoType: string;
  cargoDescription: string;
  cargoWeightKg: MoneyString;
  cargoVolumeM3: MoneyString | null;
  packageCount: number | null;
  requiresRefrigeration: boolean;
  requiredTemperatureMinC: number | null;
  requiredTemperatureMaxC: number | null;
  requiresTailLift: boolean;
  requiresCrane: boolean;
  loadingResponsibility: string;
  unloadingResponsibility: string;
  loadingInstructions: string | null;
  unloadingInstructions: string | null;
  declaredValueAmount: MoneyString | null;
  requiresInsurance: boolean;
  hazmatClass: string | null;
  /** Redacted for owners until they hold an accepted bid. */
  shipperContactName: string | null;
  shipperContactPhone: string | null;
  consigneeContactName: string | null;
  consigneeContactPhone: string | null;
}

export interface TripRequestDto extends TimestampedDto {
  id: string;
  requestNumber: string;
  customerProfileId: string;
  status: string;
  transportType: string;
  vehicleCategory: { id: string; code: string; nameEn: string; nameAr: string } | null;
  vehiclesRequired: number;
  allowPartialFulfilment: boolean;
  vehiclesAwarded: number;
  vehiclesDispatched: number;
  vehiclesCompleted: number;
  vehiclesCancelled: number;
  tripDirection: string;
  pickup: TripLocationDto;
  dropoff: TripLocationDto;
  pickupAt: string;
  returnAt: string | null;
  biddingClosesAt: string;
  remainderClosesAt: string | null;
  /** Deadline property (api.md §4.4): bids are accepted while this is true. */
  biddingOpen: boolean;
  estimatedDistanceKm: MoneyString | null;
  estimatedDurationMinutes: number | null;
  budgetAmount: MoneyString | null;
  currency: string;
  /** Redacted (null) in the owner projection until an accepted bid. */
  specialInstructions: string | null;
  cancellationReason: string | null;
  passengerDetails: PassengerDetailsDto | null;
  goodsDetails: GoodsDetailsDto | null;
  invitedOwnerCount: number;
  /** True when the caller sees the owner projection (contacts redacted). */
  redacted: boolean;
}

export interface InvitationDto {
  id: string;
  tripRequestId: string;
  ownerProfileId: string;
  ownerName: string;
  vehicleId: string | null;
  vehiclePlate: string | null;
  matchScore: string | null;
  matchReason: Record<string, unknown>;
  notifiedAt: string | null;
  viewedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

/** The owner's view of demand — an invitation joined to its (redacted) request. */
export interface OpportunityDto {
  id: string;
  request: TripRequestDto;
  matchScore: string | null;
  matchReason: Record<string, unknown>;
  viewedAt: string | null;
  dismissedAt: string | null;
  /** Vehicles of the owner that satisfy the request (dispatchable, category, capacity). */
  eligibleVehicles: { id: string; plateNumberEn: string; categoryCode: string; passengerCapacity: number | null; payloadCapacityKg: MoneyString | null }[];
  /** The owner's live bid on this request, if any (Phase 7). */
  ownBidId: string | null;
  createdAt: string;
}

// ── bidding (Phase 7) ─────────────────────────────────────────────────────────

export interface BidExtraDto {
  labelEn: string;
  labelAr: string;
  amount: MoneyString;
}

/** A quotation. Owners see their own; customers see bids on their own requests (api.md §8.13). */
export interface BidDto extends TimestampedDto {
  id: string;
  bidNumber: string;
  tripRequestId: string;
  requestNumber: string;
  ownerProfileId: string;
  /** Business or display name of the bidding owner; the customer's comparison key. */
  ownerName: string;
  ownerRatingAvg: string;
  vehicle: { id: string; plateNumberEn: string; description: string; categoryCode: string; passengerCapacity: number | null; payloadCapacityKg: MoneyString | null; ratingAvg: string };
  driverProfileId: string | null;
  driverName: string | null;
  baseAmount: MoneyString;
  extrasAmount: MoneyString;
  extrasBreakdown: BidExtraDto[];
  vatRate: RateString;
  vatAmount: MoneyString;
  totalAmount: MoneyString;
  currency: string;
  estimatedArrivalAt: string | null;
  estimatedDurationMinutes: number | null;
  validUntil: string;
  /** Withheld from other parties: only the owner and the customer see notes. */
  ownerNotes: string | null;
  status: string;
  version: number;
  lastRevisedAt: string | null;
  rejectedReason: string | null;
  submittedAt: string;
  decidedAt: string | null;
  /** The booking created when this bid was accepted (null otherwise). */
  bookingId: string | null;
  /** Effective commission the owner priced against, when settings allow showing it (FR-FINANCE-22). */
  effectiveCommission: { type: string; value: MoneyString | null; basis: string | null; source: string } | null;
}

/** Booking projection returned by the award paths; the full booking resource lands in Phase 8. */
export interface BookingDto extends TimestampedDto {
  id: string;
  bookingNumber: string;
  tripRequestId: string;
  requestNumber: string;
  bidId: string;
  customerProfileId: string;
  ownerProfileId: string;
  vehicleId: string;
  driverProfileId: string | null;
  vehiclePlateSnapshot: string;
  vehicleDescriptionSnapshot: string;
  vehicleCategoryCodeSnapshot: string;
  ownerNameSnapshot: string;
  transportType: string;
  pickup: TripLocationDto;
  dropoff: TripLocationDto;
  scheduledStartAt: string;
  scheduledEndAt: string;
  agreedBaseAmount: MoneyString;
  agreedExtrasAmount: MoneyString;
  vatRate: RateString;
  vatAmount: MoneyString;
  totalAmount: MoneyString;
  currency: string;
  billingMode: string;
  creditTermsDaysSnapshot: number | null;
  fulfilmentSequence: number;
  status: string;
  paymentStatus: string;
  paymentDueBy: string | null;
  nonCircumventionUntil: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  /** Name of the assigned driver, once dispatch has happened. */
  driverName: string | null;
  trip: { id: string; tripNumber: string; status: string } | null;
  cancellation: BookingCancellationDto | null;
  /** Present for the owner and staff; the customer never sees the split (api.md §8.14). */
  financial: {
    grossAmount: MoneyString;
    netOfVatAmount: MoneyString;
    commissionAmount: MoneyString;
    commissionVatAmount: MoneyString;
    commissionSource: string;
    paymentFeeAmount: MoneyString;
    ownerNetAmount: MoneyString;
    vatTreatment: string;
  } | null;
}

export interface AcceptBidResultDto {
  booking: BookingDto;
  tripRequest: TripRequestDto;
}

export interface AwardResultDto {
  bookings: BookingDto[];
  tripRequest: TripRequestDto;
}

// ── bookings (Phase 8) ────────────────────────────────────────────────────────

export interface BookingCancellationDto {
  cancelledByRole: string;
  eventType: string;
  reasonCode: string;
  reasonText: string | null;
  hoursBeforePickup: string;
  feePayer: string;
  cancellationFeeAmount: MoneyString;
  refundAmount: MoneyString;
  currency: string;
  feeSource: string;
  feeRuleSnapshot: Record<string, unknown>;
  feeWaivedAt: string | null;
  feeWaivedReason: string | null;
  cancelledAt: string;
}

/** Dry run of the fee under the currently effective policy (api.md §8.14 `cancellation-quote`). */
export interface CancellationQuoteDto {
  bookingId: string;
  cancelledByRole: string;
  hoursBeforePickup: string;
  feeAmount: MoneyString;
  refundAmount: MoneyString;
  currency: string;
  feeSource: string;
  feeRuleSnapshot: Record<string, unknown>;
  /** The no-cancel window applies: POST …/cancel would answer BOOKING_CANCELLATION_WINDOW_PASSED. */
  windowPassed: boolean;
  allowedReasonCodes: string[];
}

export interface CancelBookingResultDto {
  booking: BookingDto;
  cancellation: BookingCancellationDto;
  /** A refund row is created only against a captured payment (Phase 9); null when nothing was paid. */
  refund: { id: string; refundNumber: string; status: string; amount: MoneyString; currency: string } | null;
  calendarEntryReleased: boolean;
}

export interface BookingStatusHistoryDto {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  changedByUserId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

/** `GET /bookings/{id}/financials`, projected by role: the customer sees the price, the owner their net, finance everything. */
export interface BookingFinancialsDto {
  bookingId: string;
  grossAmount: MoneyString;
  vatRate: RateString;
  vatAmount: MoneyString;
  netOfVatAmount: MoneyString;
  currency: string;
  computedAt: string;
  owner: { commissionAmount: MoneyString; commissionVatAmount: MoneyString; paymentFeeAmount: MoneyString; ownerGrossAmount: MoneyString; ownerNetAmount: MoneyString; vatTreatment: string } | null;
  finance: { commissionSource: string; commissionBasis: string | null; commissionRate: RateString | null; commissionRuleId: string | null; commissionRuleSnapshot: Record<string, unknown>; commissionOverrideSnapshot: Record<string, unknown> | null; spoCommissionAmount: MoneyString; ownerVatRegisteredSnapshot: boolean; calculationVersion: number } | null;
}

// ── payments (Phase 9) ────────────────────────────────────────────────────────

export interface PaymentDto extends TimestampedDto {
  id: string;
  paymentNumber: string;
  bookingId: string | null;
  bookingNumber: string | null;
  invoiceId: string | null;
  customerProfileId: string;
  purpose: string;
  amount: MoneyString;
  currency: string;
  status: string;
  providerCode: string;
  /** Gateway reference; never a token, never a PAN. */
  providerPaymentId: string | null;
  paymentMethodType: string | null;
  paymentMethodLast4: string | null;
  authorizedAt: string | null;
  paidAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
  expiresAt: string | null;
  refundedAmount: MoneyString;
}

/** What the client must do next. Opaque to the client (api.md §6.4). */
export interface PaymentActionDto {
  type: 'REDIRECT' | 'FORM_POST' | 'SDK' | 'NONE';
  url: string | null;
  method: 'GET' | 'POST' | null;
  fields: Record<string, string> | null;
  clientPayload: Record<string, unknown> | null;
}

export interface CreatePaymentResultDto {
  payment: PaymentDto;
  action: PaymentActionDto;
}

export interface PaymentStatusDto {
  id: string;
  status: string;
  paidAt: string | null;
  failureCode: string | null;
  /** The booking's own state, so the return page can stop polling. */
  bookingStatus: string | null;
}

export interface PaymentTransactionDto {
  id: string;
  type: string;
  amount: MoneyString;
  currency: string;
  status: string;
  providerTransactionId: string | null;
  providerResponseCode: string | null;
  requestPayloadRedacted: Record<string, unknown> | null;
  responsePayloadRedacted: Record<string, unknown> | null;
  occurredAt: string;
}

/** Client-safe gateway configuration — never a secret. */
export interface PaymentConfigDto {
  providerCode: string;
  methodTypes: string[];
  currency: string;
  publishableKey: string | null;
  /** True for the development gateway: the checkout page is the app's own mock page. */
  isMock: boolean;
}

export interface RefundDto extends TimestampedDto {
  id: string;
  refundNumber: string;
  paymentId: string;
  paymentNumber: string;
  bookingId: string | null;
  bookingNumber: string | null;
  amount: MoneyString;
  currency: string;
  reasonCode: string;
  reasonText: string | null;
  status: string;
  requestedByUserId: string | null;
  approvedByUserId: string | null;
  providerRefundId: string | null;
  processedAt: string | null;
}

export interface WebhookReceiptDto {
  received: boolean;
  eventId: string;
  duplicate: boolean;
}

// ── trips & tracking (Phase 10) ───────────────────────────────────────────────

export interface TripDto extends TimestampedDto {
  id: string;
  tripNumber: string;
  bookingId: string;
  bookingNumber: string;
  bookingStatus: string;
  transportType: string;
  status: string;
  /** From the vertical's own transition map — the driver app renders exactly these buttons. */
  allowedNextStatuses: string[];
  vehicle: { id: string; plateNumberEn: string; description: string; colorCode: string | null };
  driver: { id: string; fullNameEn: string; phoneE164: string | null; ratingAvg: string } | null;
  customerProfileId: string;
  ownerProfileId: string;
  pickup: TripLocationDto;
  dropoff: TripLocationDto;
  scheduledStartAt: string;
  scheduledEndAt: string;
  actualStartAt: string | null;
  actualEndAt: string | null;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  actualDistanceKm: MoneyString | null;
  driverNotes: string | null;
  customerNotes: string | null;
  delayMinutes: number | null;
  /** Regulatory document reference (goods: TGA Bayan — OQ-29). */
  regulatoryReference: string | null;
  regulatoryReferenceType: string | null;
  /** Last known position (from the live mirror), when the caller may track this trip. */
  position: TrackingPositionDto | null;
  trackingSessionId: string | null;
}

export interface TripStatusHistoryDto {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  changedByUserId: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  note: string | null;
  occurredAt: string;
  recordedAt: string;
}

export interface TripStatusResultDto {
  id: string;
  tripNumber: string;
  status: string;
  previousStatus: string;
  transportType: string;
  occurredAt: string;
  recordedAt: string;
  allowedNextStatuses: string[];
  booking: { id: string; status: string };
}

export interface TripProofDto {
  id: string;
  tripId: string;
  proofType: string;
  recipientName: string | null;
  recipientIdLast4: string | null;
  signatureDocumentId: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  capturedByUserId: string | null;
  capturedAt: string;
}

export interface TrackingPositionDto {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  speedKmh: number | null;
  accuracyM: number | null;
  recordedAt: string;
  ageSeconds: number;
  /** ageSeconds > 120 — show "last seen", not a confidently wrong dot. */
  stale: boolean;
}

export interface TrackingPingResultDto {
  accepted: boolean;
  persisted: boolean;
  sequence: number;
  lowConfidence: boolean;
}

export interface TrackingBatchResultDto {
  results: ({ index: number } & (TrackingPingResultDto | { accepted: false; code: string }))[];
  acceptedCount: number;
}

/** GET /tracking/trips/{id} — the customer's live-tracking read (api.md §6.4). */
export interface TripTrackingDto {
  tripId: string;
  tripStatus: string;
  bookingNumber: string;
  position: TrackingPositionDto | null;
  vehicle: { plateNumberEn: string; description: string; colorCode: string | null };
  /** phoneE164 is present only for the booking's customer while the trip is active. */
  driver: { fullNameEn: string; phoneE164: string | null; ratingAvg: string } | null;
  pickup: { latitude: number; longitude: number; addressLine: string };
  destination: { latitude: number; longitude: number; addressLine: string };
  eta: { arrivalAt: string; remainingDistanceKm: MoneyString; confidence: 'LOW' | 'MEDIUM' | 'HIGH' } | null;
  socket: { namespace: string; room: string };
}

export interface TrackingHistoryPointDto {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  speedKmh: number | null;
  accuracyM: number | null;
  recordedAt: string;
}

export interface VehicleLivePositionDto {
  vehicleId: string;
  plateNumberEn: string;
  ownerProfileId: string;
  operationalStatus: string;
  tripId: string | null;
  position: TrackingPositionDto;
}

export interface TrackingSessionDto {
  id: string;
  tripId: string;
  vehicleId: string;
  driverProfileId: string | null;
  providerCode: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  pointCount: number;
  totalDistanceKm: MoneyString;
}

// ── finance (api.md §8.19–§8.22) ─────────────────────────────────────────────

export interface CommissionRuleDto extends TimestampedDto {
  id: string;
  name: string;
  scope: string;
  vehicleCategoryId: string | null;
  ownerProfileId: string | null;
  transportType: string | null;
  calculationType: string;
  /** Percent (0–100) on the API; stored as a fraction. */
  percentageRate: MoneyString | null;
  fixedAmount: MoneyString | null;
  basis: string;
  minAmount: MoneyString | null;
  maxAmount: MoneyString | null;
  currency: string;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

/** Dry run of the commission resolution for a hypothetical booking. */
export interface CommissionPreviewDto {
  source: 'RULE' | 'OVERRIDE' | 'NONE';
  type: string;
  value: MoneyString | null;
  basis: string | null;
  ruleId: string | null;
  ruleName: string | null;
  grossAmount: MoneyString;
  vatAmount: MoneyString;
  netOfVatAmount: MoneyString;
  commissionAmount: MoneyString;
  commissionVatAmount: MoneyString;
  ownerNetAmount: MoneyString;
  vatTreatment: string;
  currency: string;
}

export interface RequestCommissionDto {
  tripRequestId: string;
  override: { type: string; value: MoneyString | null; basis: string | null; reason: string | null; setByUserId: string | null; setAt: string | null } | null;
  /** What the next award would actually charge — override or rule. */
  effectiveCommission: { type: string; value: MoneyString | null; basis: string | null; source: string } | null;
  bidsExist: boolean;
}

export interface CommissionEarningsRowDto {
  key: string;
  label: string | null;
  bookingCount: number;
  grossAmount: MoneyString;
  commissionAmount: MoneyString;
  commissionVatAmount: MoneyString;
  ownerNetAmount: MoneyString;
}
export interface CommissionEarningsDto {
  groupBy: string;
  currency: string;
  rows: CommissionEarningsRowDto[];
  totals: Omit<CommissionEarningsRowDto, 'key' | 'label'>;
}

export interface SettlementLineDto {
  id: string;
  settlementId: string;
  bookingId: string | null;
  bookingNumber: string | null;
  lineType: string;
  amount: MoneyString;
  currency: string;
  description: string;
  holdReason: string;
  heldSince: string | null;
  releasedAt: string | null;
  eligibleAt: string | null;
  createdAt: string;
}

export interface SettlementDto extends TimestampedDto {
  id: string;
  settlementNumber: string;
  ownerProfileId: string;
  ownerName: string | null;
  periodStart: string;
  periodEnd: string;
  grossAmount: MoneyString;
  commissionAmount: MoneyString;
  adjustmentsAmount: MoneyString;
  netPayableAmount: MoneyString;
  currency: string;
  status: string;
  bankAccount: { id: string; bankName: string; ibanLast4: string; accountHolderName: string } | null;
  paymentReference: string | null;
  approvedByUserId: string | null;
  paidAt: string | null;
  notes: string | null;
  lineCount: number;
}

export interface SettlementPreviewDto {
  ownerProfileId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  eligible: { bookingId: string; bookingNumber: string; completedAt: string | null; eligibleAt: string; grossAmount: MoneyString; deductions: MoneyString; ownerNetAmount: MoneyString }[];
  held: { bookingId: string; bookingNumber: string; completedAt: string | null; eligibleAt: string; holdReason: string; ownerNetAmount: MoneyString }[];
  grossAmount: MoneyString;
  commissionAmount: MoneyString;
  adjustmentsAmount: MoneyString;
  netPayableAmount: MoneyString;
  minimumPayoutAmount: MoneyString;
  belowMinimum: boolean;
}

export interface InvoiceEinvoiceDto {
  einvoiceUuid: string | null;
  icv: number | null;
  invoiceHash: string | null;
  previousInvoiceHash: string | null;
  qrCodeTlv: string | null;
  clearanceStatus: string;
  clearanceSubmittedAt: string | null;
  clearanceCompletedAt: string | null;
  clearanceAttemptCount: number;
  xmlDocumentId: string | null;
  clearedXmlDocumentId: string | null;
  lastErrorCode: string | null;
}

export interface InvoiceDto extends TimestampedDto {
  id: string;
  invoiceNumber: string;
  invoiceType: string;
  issuedToCustomerProfileId: string;
  corporateCustomerProfileId: string | null;
  buyerName: string | null;
  correctsInvoiceId: string | null;
  correctsInvoiceNumber: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  sellerVatNumber: string;
  buyerVatNumber: string | null;
  lineGranularity: string;
  subtotalAmount: MoneyString;
  vatAmount: MoneyString;
  totalAmount: MoneyString;
  paidAmount: MoneyString;
  outstandingAmount: MoneyString;
  currency: string;
  issueDate: string;
  supplyDate: string;
  dueDate: string;
  status: string;
  lineCount: number;
  /** Chain and clearance fields (api.md §8.19). Never a stamp, never credentials, never the raw authority response. */
  einvoice: InvoiceEinvoiceDto;
  pdfDocumentId: string | null;
}

export interface InvoiceLineDto {
  id: string;
  invoiceId: string;
  lineType: string;
  tripRequestId: string | null;
  requestNumber: string | null;
  bookingId: string | null;
  bookingNumber: string | null;
  /** Bookings covered by the line (many for an ORDER line, one for a BOOKING line, none for adjustments). */
  bookingIds: string[];
  descriptionEn: string;
  descriptionAr: string;
  quantity: MoneyString;
  unitAmount: MoneyString;
  netAmount: MoneyString;
  vatRate: RateString;
  vatAmount: MoneyString;
  totalAmount: MoneyString;
  vatCategory: string;
  sortOrder: number;
}

export interface InvoiceGenerateResultDto {
  periodStart: string;
  periodEnd: string;
  customersConsidered: number;
  invoices: { invoiceId: string; invoiceNumber: string; customerProfileId: string; invoiceType: string; status: string; bookingCount: number; totalAmount: MoneyString }[];
  skipped: { customerProfileId: string; reason: string }[];
}

export interface ClearanceQueueItemDto {
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  clearanceStatus: string;
  clearanceSubmittedAt: string | null;
  attemptCount: number;
  ageSeconds: number;
  lastErrorCode: string | null;
  buyer: { customerProfileId: string; name: string | null; vatNumber: string | null };
}

export interface ExpenseDto extends TimestampedDto {
  id: string;
  ownerProfileId: string;
  vehicleId: string | null;
  vehiclePlate: string | null;
  driverProfileId: string | null;
  tripId: string | null;
  expenseCategoryId: string;
  categoryCode: string;
  amount: MoneyString;
  vatAmount: MoneyString;
  totalAmount: MoneyString;
  currency: string;
  expenseDate: string;
  description: string | null;
  vendorName: string | null;
  odometerKm: number | null;
  receiptDocumentId: string | null;
  isReimbursable: boolean;
  /** True once the expense falls inside a PAID settlement period (409 EXPENSE_IMMUTABLE on edit/delete). */
  isLocked: boolean;
}

export interface ExpenseSummaryDto {
  groupBy: 'category' | 'vehicle' | 'month';
  currency: string;
  rows: { key: string; label: string | null; count: number; amount: MoneyString; vatAmount: MoneyString; totalAmount: MoneyString }[];
  totals: { count: number; amount: MoneyString; vatAmount: MoneyString; totalAmount: MoneyString };
}

export interface LedgerEntryDto {
  id: string;
  accountCode: string;
  accountType: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: MoneyString;
  currency: string;
  ownerProfileId: string | null;
  customerProfileId: string | null;
}
export interface LedgerGroupDto {
  transactionGroupId: string;
  description: string;
  occurredAt: string;
  bookingId: string | null;
  paymentId: string | null;
  refundId: string | null;
  settlementId: string | null;
  invoiceId: string | null;
  entries: LedgerEntryDto[];
  debitTotal: MoneyString;
  creditTotal: MoneyString;
}
export interface OwnerBalanceDto {
  ownerProfileId: string;
  accountCode: 'OWNER_PAYABLE';
  balance: MoneyString;
  currency: string;
  /** Net payable of DRAFT / PENDING_APPROVAL / APPROVED / PROCESSING settlements not yet paid. */
  inFlightSettlements: MoneyString;
  asOf: string;
}
