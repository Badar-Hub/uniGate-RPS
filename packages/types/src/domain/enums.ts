/**
 * Domain enums — mirrors of the PostgreSQL native enums in database.md (D7).
 *
 * Every value here is a lifecycle state or a closed classification. Reference data
 * (vehicle categories, document types, …) is NOT an enum; it is a table (D8).
 *
 * These are hand-written by rule: this package never imports from Prisma. The
 * migration-integrity test in apps/api asserts each list matches the database enum
 * exactly, so drift fails CI rather than surfacing at runtime.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Builds a readonly tuple + a union type from a list of string literals. */
function enumOf<const T extends readonly string[]>(values: T): T {
  return values;
}

// ── iam ──────────────────────────────────────────────────────────────────────

export const USER_STATUS = enumOf(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']);
export type UserStatus = (typeof USER_STATUS)[number];

export const CLIENT_TYPE = enumOf(['WEB', 'IOS', 'ANDROID']);
export type ClientType = (typeof CLIENT_TYPE)[number];

export const OTP_CHANNEL = enumOf(['SMS', 'EMAIL']);
export type OtpChannel = (typeof OTP_CHANNEL)[number];

export const OTP_PURPOSE = enumOf([
  'REGISTRATION',
  'LOGIN',
  'PHONE_VERIFICATION',
  'PASSWORD_RESET',
  'SENSITIVE_ACTION',
]);
export type OtpPurpose = (typeof OTP_PURPOSE)[number];

// ── vertical ─────────────────────────────────────────────────────────────────

/** The discriminator between the two vertical modules (ADR-010). */
export const TRANSPORT_TYPE = enumOf(['PASSENGER', 'GOODS']);
export type TransportType = (typeof TRANSPORT_TYPE)[number];

// ── profiles ─────────────────────────────────────────────────────────────────

export const CUSTOMER_TYPE = enumOf(['INDIVIDUAL', 'CORPORATE']);
export type CustomerType = (typeof CUSTOMER_TYPE)[number];

export const OWNER_TYPE = enumOf(['INDIVIDUAL', 'COMPANY', 'PLATFORM']);
export type OwnerType = (typeof OWNER_TYPE)[number];

export const ONBOARDING_STATUS = enumOf([
  'DRAFT',
  'DOCUMENTS_SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);
export type OnboardingStatus = (typeof ONBOARDING_STATUS)[number];

export const VERTICAL_APPROVAL_STATUS = enumOf([
  'NOT_APPLIED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);
export type VerticalApprovalStatus = (typeof VERTICAL_APPROVAL_STATUS)[number];

export const ID_TYPE = enumOf(['NATIONAL_ID', 'IQAMA']);
export type IdType = (typeof ID_TYPE)[number];

export const DRIVER_AVAILABILITY_STATUS = enumOf(['OFF_DUTY', 'AVAILABLE', 'ON_TRIP']);
export type DriverAvailabilityStatus = (typeof DRIVER_AVAILABILITY_STATUS)[number];

export const SPO_LEAD_STATUS = enumOf(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST']);
export type SpoLeadStatus = (typeof SPO_LEAD_STATUS)[number];

export const SPO_COMMISSION_BASIS = enumOf(['NONE', 'FIRST_BOOKING', 'ALL_BOOKINGS', 'WINDOW_DAYS']);
export type SpoCommissionBasis = (typeof SPO_COMMISSION_BASIS)[number];

export const CREDIT_STATUS = enumOf(['NONE', 'PENDING_APPROVAL', 'APPROVED', 'SUSPENDED']);
export type CreditStatus = (typeof CREDIT_STATUS)[number];

export const BILLING_CYCLE = enumOf(['PER_BOOKING', 'WEEKLY', 'MONTHLY']);
export type BillingCycle = (typeof BILLING_CYCLE)[number];

// ── reference ────────────────────────────────────────────────────────────────

export const DOCUMENT_APPLIES_TO = enumOf([
  'USER',
  'OWNER',
  'DRIVER',
  'VEHICLE',
  'CORPORATE_CUSTOMER',
  'EXPENSE',
  'MAINTENANCE_RECORD',
  'TRIP_PROOF',
]);
export type DocumentAppliesTo = (typeof DOCUMENT_APPLIES_TO)[number];

export const SETTINGS_SECTION = enumOf([
  'booking',
  'bidding',
  'dispatch',
  'settlement',
  'billing',
  'finance',
  'onboarding',
  'documents',
  'spo',
  'tracking',
  'notifications',
  'retention',
  'platform',
]);
export type SettingsSection = (typeof SETTINGS_SECTION)[number];

export const SETTING_SCOPE = enumOf(['PUBLIC', 'INTERNAL', 'SECRET']);
export type SettingScope = (typeof SETTING_SCOPE)[number];

export const SETTING_VALUE_TYPE = enumOf([
  'STRING',
  'INTEGER',
  'DECIMAL',
  'BOOLEAN',
  'ENUM',
  'STRING_ARRAY',
  'INTEGER_ARRAY',
  'JSON',
]);
export type SettingValueType = (typeof SETTING_VALUE_TYPE)[number];

// ── documents ────────────────────────────────────────────────────────────────

export const DOCUMENT_UPLOAD_STATUS = enumOf(['PENDING', 'UPLOADED', 'FAILED', 'QUARANTINED']);
export type DocumentUploadStatus = (typeof DOCUMENT_UPLOAD_STATUS)[number];

export const DOCUMENT_VERIFICATION_STATUS = enumOf(['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']);
export type DocumentVerificationStatus = (typeof DOCUMENT_VERIFICATION_STATUS)[number];

export const DOCUMENT_VISIBILITY = enumOf(['PRIVATE', 'INTERNAL', 'SHARED_WITH_COUNTERPARTY']);
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITY)[number];

// ── fleet ────────────────────────────────────────────────────────────────────

export const VEHICLE_APPROVAL_STATUS = enumOf(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED']);
export type VehicleApprovalStatus = (typeof VEHICLE_APPROVAL_STATUS)[number];

export const VEHICLE_LIFECYCLE_STATUS = enumOf(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']);
export type VehicleLifecycleStatus = (typeof VEHICLE_LIFECYCLE_STATUS)[number];

export const VEHICLE_OPERATIONAL_STATUS = enumOf([
  'IDLE',
  'RESERVED',
  'ON_TRIP',
  'UNDER_MAINTENANCE',
  'OUT_OF_SERVICE',
]);
export type VehicleOperationalStatus = (typeof VEHICLE_OPERATIONAL_STATUS)[number];

export const CALENDAR_ENTRY_TYPE = enumOf(['RESERVATION', 'MAINTENANCE', 'OWNER_BLOCK']);
export type CalendarEntryType = (typeof CALENDAR_ENTRY_TYPE)[number];

export const CALENDAR_ENTRY_STATUS = enumOf(['HELD', 'CONFIRMED', 'RELEASED']);
export type CalendarEntryStatus = (typeof CALENDAR_ENTRY_STATUS)[number];

export const GPS_DEVICE_STATUS = enumOf(['ACTIVE', 'INACTIVE', 'FAULTY']);
export type GpsDeviceStatus = (typeof GPS_DEVICE_STATUS)[number];

// ── demand ───────────────────────────────────────────────────────────────────

export const TRIP_DIRECTION = enumOf(['ONE_WAY', 'ROUND_TRIP']);
export type TripDirection = (typeof TRIP_DIRECTION)[number];

export const TRIP_REQUEST_STATUS = enumOf([
  'DRAFT',
  'PUBLISHED',
  'PARTIALLY_AWARDED',
  'FULLY_AWARDED',
  'CLOSED_PARTIAL',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
]);
export type TripRequestStatus = (typeof TRIP_REQUEST_STATUS)[number];

export const TRIP_PURPOSE = enumOf([
  'AIRPORT_TRANSFER',
  'INTERCITY',
  'CITY_TOUR',
  'EMPLOYEE_TRANSPORT',
  'HAJJ_UMRAH',
  'EVENT',
  'OTHER',
]);
export type TripPurpose = (typeof TRIP_PURPOSE)[number];

export const CARGO_TYPE = enumOf([
  'GENERAL',
  'FRAGILE',
  'PERISHABLE',
  'HAZARDOUS',
  'LIVESTOCK',
  'VEHICLE',
  'BULK',
  'CONTAINER',
  'OTHER',
]);
export type CargoType = (typeof CARGO_TYPE)[number];

export const LOADING_RESPONSIBILITY = enumOf(['CUSTOMER', 'DRIVER', 'THIRD_PARTY']);
export type LoadingResponsibility = (typeof LOADING_RESPONSIBILITY)[number];

export const COMMISSION_CALCULATION_TYPE = enumOf(['NONE', 'PERCENTAGE', 'FIXED']);
export type CommissionCalculationType = (typeof COMMISSION_CALCULATION_TYPE)[number];

export const COMMISSION_BASIS = enumOf(['GROSS', 'NET_OF_VAT']);
export type CommissionBasis = (typeof COMMISSION_BASIS)[number];

export const COMMISSION_SCOPE = enumOf(['GLOBAL', 'VEHICLE_CATEGORY', 'OWNER', 'OWNER_CATEGORY']);
export type CommissionScope = (typeof COMMISSION_SCOPE)[number];

export const COMMISSION_SOURCE = enumOf(['RULE', 'OVERRIDE', 'NONE']);
export type CommissionSource = (typeof COMMISSION_SOURCE)[number];

// ── bidding ──────────────────────────────────────────────────────────────────

export const BID_STATUS = enumOf(['SUBMITTED', 'WITHDRAWN', 'ACCEPTED', 'REJECTED', 'EXPIRED']);
export type BidStatus = (typeof BID_STATUS)[number];

// ── bookings ─────────────────────────────────────────────────────────────────

export const BILLING_MODE = enumOf(['PREPAID', 'INVOICED']);
export type BillingMode = (typeof BILLING_MODE)[number];

export const BOOKING_STATUS = enumOf([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'DRIVER_ASSIGNED',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'DISPUTED',
  'REFUNDED',
]);
export type BookingStatus = (typeof BOOKING_STATUS)[number];

export const BOOKING_PAYMENT_STATUS = enumOf([
  'UNPAID',
  'INVOICED',
  'PARTIALLY_PAID',
  'PAID',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);
export type BookingPaymentStatus = (typeof BOOKING_PAYMENT_STATUS)[number];

export const ACTOR_TYPE = enumOf(['USER', 'SYSTEM', 'JOB', 'ANONYMOUS']);
export type ActorType = (typeof ACTOR_TYPE)[number];

export const CANCELLED_BY_ROLE = enumOf(['CUSTOMER', 'OWNER', 'DRIVER', 'ADMIN', 'SYSTEM']);
export type CancelledByRole = (typeof CANCELLED_BY_ROLE)[number];

export const CANCELLATION_EVENT_TYPE = enumOf(['CANCELLATION', 'NO_SHOW']);
export type CancellationEventType = (typeof CANCELLATION_EVENT_TYPE)[number];

export const FEE_PAYER = enumOf(['CUSTOMER', 'OWNER', 'NONE']);
export type FeePayer = (typeof FEE_PAYER)[number];

export const FEE_SOURCE = enumOf(['RULE', 'OVERRIDE', 'NONE']);
export type FeeSource = (typeof FEE_SOURCE)[number];

export const CANCELLATION_POLICY_ROLE = enumOf(['CUSTOMER', 'OWNER']);
export type CancellationPolicyRole = (typeof CANCELLATION_POLICY_ROLE)[number];

export const CANCELLATION_POLICY_SCOPE = enumOf(['GLOBAL', 'VEHICLE_CATEGORY', 'CUSTOMER', 'OWNER']);
export type CancellationPolicyScope = (typeof CANCELLATION_POLICY_SCOPE)[number];

// ── trips & tracking ─────────────────────────────────────────────────────────

export const TRIP_STATUS = enumOf([
  'BOOKED',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'TRIP_STARTED',
  'IN_PROGRESS',
  'LOADING',
  'LOADED',
  'IN_TRANSIT',
  'ARRIVED_AT_DESTINATION',
  'UNLOADING',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'EXCEPTION',
]);
export type TripStatus = (typeof TRIP_STATUS)[number];

export const TRIP_PROOF_TYPE = enumOf([
  'PICKUP_CONFIRMATION',
  'DELIVERY_CONFIRMATION',
  'DAMAGE_REPORT',
  'EXCEPTION',
]);
export type TripProofType = (typeof TRIP_PROOF_TYPE)[number];

export const LOCATION_SOURCE = enumOf(['DRIVER_APP', 'GPS_DEVICE', 'EXTERNAL_API']);
export type LocationSource = (typeof LOCATION_SOURCE)[number];

export const TRACKING_SESSION_STATUS = enumOf(['ACTIVE', 'ENDED', 'INTERRUPTED']);
export type TrackingSessionStatus = (typeof TRACKING_SESSION_STATUS)[number];

// ── payments ─────────────────────────────────────────────────────────────────

export const PAYMENT_PURPOSE = enumOf(['BOOKING_PAYMENT', 'INVOICE_PAYMENT', 'ADDITIONAL_CHARGE', 'PENALTY']);
export type PaymentPurpose = (typeof PAYMENT_PURPOSE)[number];

export const PAYMENT_STATUS = enumOf([
  'PENDING',
  'AUTHORIZED',
  'PAID',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const PAYMENT_METHOD_TYPE = enumOf([
  'MADA',
  'VISA',
  'MASTERCARD',
  'STC_PAY',
  'APPLE_PAY',
  'BANK_TRANSFER',
  'CASH',
]);
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPE)[number];

export const PAYMENT_TRANSACTION_TYPE = enumOf(['AUTHORIZE', 'CAPTURE', 'VOID', 'REFUND', 'INQUIRY']);
export type PaymentTransactionType = (typeof PAYMENT_TRANSACTION_TYPE)[number];

export const PAYMENT_TRANSACTION_STATUS = enumOf(['INITIATED', 'SUCCEEDED', 'FAILED']);
export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUS)[number];

export const REFUND_STATUS = enumOf([
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REJECTED',
]);
export type RefundStatus = (typeof REFUND_STATUS)[number];

export const WEBHOOK_PROCESSING_STATUS = enumOf([
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'IGNORED',
]);
export type WebhookProcessingStatus = (typeof WEBHOOK_PROCESSING_STATUS)[number];

// ── finance ──────────────────────────────────────────────────────────────────

export const VAT_TREATMENT = enumOf(['DEEMED_SUPPLIER', 'OWNER_IS_SUPPLIER']);
export type VatTreatment = (typeof VAT_TREATMENT)[number];

export const LEDGER_ACCOUNT_TYPE = enumOf(['ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE']);
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPE)[number];

export const LEDGER_DIRECTION = enumOf(['DEBIT', 'CREDIT']);

/** Per-user permission overrides on top of roles (vendor access control). */
export const PERMISSION_OVERRIDE_EFFECT = enumOf(['GRANT', 'DENY']);
export type PermissionOverrideEffect = (typeof PERMISSION_OVERRIDE_EFFECT)[number];
export type LedgerDirection = (typeof LEDGER_DIRECTION)[number];

export const SETTLEMENT_STATUS = enumOf([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PROCESSING',
  'PAID',
  'FAILED',
  'CANCELLED',
]);
export type SettlementStatus = (typeof SETTLEMENT_STATUS)[number];

export const SETTLEMENT_LINE_TYPE = enumOf([
  'BOOKING_EARNING',
  'COMMISSION',
  'ADJUSTMENT',
  'PENALTY',
  'REFUND_CLAWBACK',
]);
export type SettlementLineType = (typeof SETTLEMENT_LINE_TYPE)[number];

export const SETTLEMENT_HOLD_REASON = enumOf([
  'NONE',
  'SUPPLIER_INVOICE_MISSING',
  'BANK_ACCOUNT_COOLOFF',
  'DISPUTE',
  'MANUAL',
]);
export type SettlementHoldReason = (typeof SETTLEMENT_HOLD_REASON)[number];

export const INVOICE_TYPE = enumOf(['TAX_INVOICE', 'SIMPLIFIED_TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']);
export type InvoiceType = (typeof INVOICE_TYPE)[number];

export const INVOICE_STATUS = enumOf([
  'DRAFT',
  'PENDING_CLEARANCE',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
  'CREDITED',
  'CLEARANCE_FAILED',
]);
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];

export const CLEARANCE_STATUS = enumOf(['NOT_REQUIRED', 'PENDING', 'CLEARED', 'REPORTED', 'REJECTED']);
export type ClearanceStatus = (typeof CLEARANCE_STATUS)[number];

export const INVOICE_LINE_TYPE = enumOf(['ORDER', 'BOOKING', 'ADJUSTMENT', 'PENALTY', 'DISCOUNT']);
export type InvoiceLineType = (typeof INVOICE_LINE_TYPE)[number];

export const INVOICE_LINE_GRANULARITY = enumOf(['ORDER', 'BOOKING']);
export type InvoiceLineGranularity = (typeof INVOICE_LINE_GRANULARITY)[number];

export const SUPPLIER_INVOICE_KIND = enumOf(['SUPPLIER_ISSUED', 'SELF_BILLED']);
export type SupplierInvoiceKind = (typeof SUPPLIER_INVOICE_KIND)[number];

export const SUPPLIER_INVOICE_STATUS = enumOf([
  'PENDING',
  'VERIFIED',
  'ACCEPTED',
  'REJECTED',
  'DISPUTED',
]);
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUS)[number];

// ── maintenance ──────────────────────────────────────────────────────────────

export const MAINTENANCE_KIND = enumOf(['SCHEDULED', 'UNSCHEDULED', 'REPAIR', 'INSPECTION']);
export type MaintenanceKind = (typeof MAINTENANCE_KIND)[number];

export const MAINTENANCE_STATUS = enumOf(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export type MaintenanceStatus = (typeof MAINTENANCE_STATUS)[number];

// ── engagement ───────────────────────────────────────────────────────────────

export const RATER_ROLE = enumOf(['CUSTOMER', 'OWNER', 'DRIVER']);
export type RaterRole = (typeof RATER_ROLE)[number];

export const RATING_SUBJECT_TYPE = enumOf(['DRIVER', 'VEHICLE', 'OWNER', 'CUSTOMER', 'TRIP']);
export type RatingSubjectType = (typeof RATING_SUBJECT_TYPE)[number];

export const RATING_STATUS = enumOf(['PUBLISHED', 'PENDING_REVIEW', 'HIDDEN']);
export type RatingStatus = (typeof RATING_STATUS)[number];

export const COMPLAINT_AGAINST_TYPE = enumOf(['DRIVER', 'OWNER', 'CUSTOMER', 'VEHICLE', 'PLATFORM']);
export type ComplaintAgainstType = (typeof COMPLAINT_AGAINST_TYPE)[number];

export const COMPLAINT_SEVERITY = enumOf(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type ComplaintSeverity = (typeof COMPLAINT_SEVERITY)[number];

export const COMPLAINT_STATUS = enumOf([
  'OPEN',
  'IN_REVIEW',
  'AWAITING_RESPONSE',
  'RESOLVED',
  'REJECTED',
  'CLOSED',
]);
export type ComplaintStatus = (typeof COMPLAINT_STATUS)[number];

// ── notifications ────────────────────────────────────────────────────────────

export const NOTIFICATION_CHANNEL = enumOf(['IN_APP', 'EMAIL', 'SMS', 'PUSH']);
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number];

export const NOTIFICATION_STATUS = enumOf(['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED']);
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[number];

export const DEVICE_PLATFORM = enumOf(['IOS', 'ANDROID', 'WEB']);
export type DevicePlatform = (typeof DEVICE_PLATFORM)[number];

// ── platform ─────────────────────────────────────────────────────────────────

export const AUDIT_SEVERITY = enumOf(['INFO', 'NOTICE', 'WARNING', 'SECURITY']);
export type AuditSeverity = (typeof AUDIT_SEVERITY)[number];

export const OUTBOX_STATUS = enumOf(['PENDING', 'PUBLISHED', 'FAILED']);
export type OutboxStatus = (typeof OUTBOX_STATUS)[number];

export const IDEMPOTENCY_STATUS = enumOf(['IN_PROGRESS', 'COMPLETED']);
export type IdempotencyStatus = (typeof IDEMPOTENCY_STATUS)[number];

export const EXPORT_FORMAT = enumOf(['CSV', 'XLSX', 'PDF']);
export type ExportFormat = (typeof EXPORT_FORMAT)[number];

export const EXPORT_JOB_STATUS = enumOf(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED']);
export type ExportJobStatus = (typeof EXPORT_JOB_STATUS)[number];

/**
 * Every enum in one place, keyed by its PostgreSQL type name. The migration-integrity
 * test iterates this map and compares against `pg_enum`.
 */
export const PG_ENUMS = {
  user_status: USER_STATUS,
  client_type: CLIENT_TYPE,
  otp_channel: OTP_CHANNEL,
  otp_purpose: OTP_PURPOSE,
  transport_type: TRANSPORT_TYPE,
  customer_type: CUSTOMER_TYPE,
  owner_type: OWNER_TYPE,
  onboarding_status: ONBOARDING_STATUS,
  vertical_approval_status: VERTICAL_APPROVAL_STATUS,
  id_type: ID_TYPE,
  driver_availability_status: DRIVER_AVAILABILITY_STATUS,
  spo_lead_status: SPO_LEAD_STATUS,
  spo_commission_basis: SPO_COMMISSION_BASIS,
  credit_status: CREDIT_STATUS,
  billing_cycle: BILLING_CYCLE,
  document_applies_to: DOCUMENT_APPLIES_TO,
  settings_section: SETTINGS_SECTION,
  setting_scope: SETTING_SCOPE,
  setting_value_type: SETTING_VALUE_TYPE,
  document_upload_status: DOCUMENT_UPLOAD_STATUS,
  document_verification_status: DOCUMENT_VERIFICATION_STATUS,
  document_visibility: DOCUMENT_VISIBILITY,
  vehicle_approval_status: VEHICLE_APPROVAL_STATUS,
  vehicle_lifecycle_status: VEHICLE_LIFECYCLE_STATUS,
  vehicle_operational_status: VEHICLE_OPERATIONAL_STATUS,
  calendar_entry_type: CALENDAR_ENTRY_TYPE,
  calendar_entry_status: CALENDAR_ENTRY_STATUS,
  gps_device_status: GPS_DEVICE_STATUS,
  trip_direction: TRIP_DIRECTION,
  trip_request_status: TRIP_REQUEST_STATUS,
  trip_purpose: TRIP_PURPOSE,
  cargo_type: CARGO_TYPE,
  loading_responsibility: LOADING_RESPONSIBILITY,
  commission_calculation_type: COMMISSION_CALCULATION_TYPE,
  commission_basis: COMMISSION_BASIS,
  commission_scope: COMMISSION_SCOPE,
  commission_source: COMMISSION_SOURCE,
  bid_status: BID_STATUS,
  billing_mode: BILLING_MODE,
  booking_status: BOOKING_STATUS,
  booking_payment_status: BOOKING_PAYMENT_STATUS,
  actor_type: ACTOR_TYPE,
  cancelled_by_role: CANCELLED_BY_ROLE,
  cancellation_event_type: CANCELLATION_EVENT_TYPE,
  fee_payer: FEE_PAYER,
  fee_source: FEE_SOURCE,
  cancellation_policy_role: CANCELLATION_POLICY_ROLE,
  cancellation_policy_scope: CANCELLATION_POLICY_SCOPE,
  trip_status: TRIP_STATUS,
  trip_proof_type: TRIP_PROOF_TYPE,
  location_source: LOCATION_SOURCE,
  tracking_session_status: TRACKING_SESSION_STATUS,
  payment_purpose: PAYMENT_PURPOSE,
  payment_status: PAYMENT_STATUS,
  payment_method_type: PAYMENT_METHOD_TYPE,
  payment_transaction_type: PAYMENT_TRANSACTION_TYPE,
  payment_transaction_status: PAYMENT_TRANSACTION_STATUS,
  refund_status: REFUND_STATUS,
  webhook_processing_status: WEBHOOK_PROCESSING_STATUS,
  vat_treatment: VAT_TREATMENT,
  ledger_account_type: LEDGER_ACCOUNT_TYPE,
  ledger_direction: LEDGER_DIRECTION,
  permission_override_effect: PERMISSION_OVERRIDE_EFFECT,
  settlement_status: SETTLEMENT_STATUS,
  settlement_line_type: SETTLEMENT_LINE_TYPE,
  settlement_hold_reason: SETTLEMENT_HOLD_REASON,
  invoice_type: INVOICE_TYPE,
  invoice_status: INVOICE_STATUS,
  clearance_status: CLEARANCE_STATUS,
  invoice_line_type: INVOICE_LINE_TYPE,
  invoice_line_granularity: INVOICE_LINE_GRANULARITY,
  supplier_invoice_kind: SUPPLIER_INVOICE_KIND,
  supplier_invoice_status: SUPPLIER_INVOICE_STATUS,
  maintenance_kind: MAINTENANCE_KIND,
  maintenance_status: MAINTENANCE_STATUS,
  rater_role: RATER_ROLE,
  rating_subject_type: RATING_SUBJECT_TYPE,
  rating_status: RATING_STATUS,
  complaint_against_type: COMPLAINT_AGAINST_TYPE,
  complaint_severity: COMPLAINT_SEVERITY,
  complaint_status: COMPLAINT_STATUS,
  notification_channel: NOTIFICATION_CHANNEL,
  notification_status: NOTIFICATION_STATUS,
  device_platform: DEVICE_PLATFORM,
  audit_severity: AUDIT_SEVERITY,
  outbox_status: OUTBOX_STATUS,
  idempotency_status: IDEMPOTENCY_STATUS,
  export_format: EXPORT_FORMAT,
  export_job_status: EXPORT_JOB_STATUS,
} as const satisfies Record<string, readonly string[]>;

export type PgEnumName = keyof typeof PG_ENUMS;

/** Cancellation reason codes (api.md §6.4 `POST /bookings/{id}/cancel`); which are permitted depends on the canceller's role. */
export const CANCELLATION_REASON_CODE = enumOf([
  'CUSTOMER_PLANS_CHANGED',
  'CUSTOMER_FOUND_ALTERNATIVE',
  'PRICE',
  'OWNER_UNAVAILABLE',
  'VEHICLE_BREAKDOWN',
  'DRIVER_UNAVAILABLE',
  'WEATHER',
  'ADMIN_INTERVENTION',
  'PAYMENT_FAILED',
  'PAYMENT_WINDOW_EXPIRED',
  'CUSTOMER_NO_SHOW',
  'OWNER_NO_SHOW',
  'OTHER',
]);
export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODE)[number];
export const CANCELLATION_REASONS_BY_ROLE: Readonly<Record<'CUSTOMER' | 'OWNER' | 'ADMIN', readonly CancellationReasonCode[]>> = {
  CUSTOMER: ['CUSTOMER_PLANS_CHANGED', 'CUSTOMER_FOUND_ALTERNATIVE', 'PRICE', 'OTHER'],
  OWNER: ['OWNER_UNAVAILABLE', 'VEHICLE_BREAKDOWN', 'DRIVER_UNAVAILABLE', 'WEATHER', 'OTHER'],
  ADMIN: ['CUSTOMER_PLANS_CHANGED', 'CUSTOMER_FOUND_ALTERNATIVE', 'PRICE', 'OWNER_UNAVAILABLE', 'VEHICLE_BREAKDOWN', 'DRIVER_UNAVAILABLE', 'WEATHER', 'ADMIN_INTERVENTION', 'PAYMENT_FAILED', 'OTHER'],
};

export const REFUND_REASON_CODE = enumOf(['BOOKING_CANCELLED', 'OWNER_NO_SHOW', 'SERVICE_NOT_RENDERED', 'DUPLICATE_PAYMENT', 'GOODWILL', 'DISPUTE_RESOLVED', 'OTHER']);
export type RefundReasonCode = (typeof REFUND_REASON_CODE)[number];

