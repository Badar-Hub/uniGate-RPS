/**
 * Error classes → HTTP status (api.md §3.1) and the platform-level error codes shared by
 * every module. Module-specific codes (BID_*, BOOKING_*, …) are declared beside the module
 * that raises them, but every code the API can emit is a member of `ErrorCode` so the
 * OpenAPI spec and the web client's interceptor stay exhaustive.
 */

export const ERROR_CLASS_STATUS = {
  ValidationError: 422,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  BusinessRuleError: 422,
  RateLimitError: 429,
  BadRequestError: 400,
  UpstreamError: 502,
  ServiceUnavailableError: 503,
  UpstreamTimeoutError: 504,
  AppError: 500,
} as const;

export type ErrorClassName = keyof typeof ERROR_CLASS_STATUS;

/** Platform-level codes (api.md §4.1–4.3). Domain codes are added by modules as they land. */
export const PLATFORM_ERROR_CODES = [
  // auth
  'AUTH_REQUIRED',
  'AUTH_INVALID_TOKEN',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_TOKEN_REVOKED',
  'AUTH_SESSION_REVOKED',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_ACCOUNT_SUSPENDED',
  'AUTH_ACCOUNT_NOT_VERIFIED',
  'AUTH_STEP_UP_REQUIRED',
  'AUTH_OTP_INVALID',
  'AUTH_OTP_EXPIRED',
  'AUTH_OTP_THROTTLED',
  'AUTH_CSRF_INVALID',
  // permission
  'PERM_DENIED',
  // validation & platform
  'VALIDATION_FAILED',
  'MALFORMED_JSON',
  'UNSUPPORTED_MEDIA_TYPE',
  'PAYLOAD_TOO_LARGE',
  'NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'RATE_LIMITED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_INVALID',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  'SETTINGS_KEY_IMMUTABLE',
  'SETTINGS_VALUE_INVALID',
  'VERTICAL_NOT_ENABLED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'PAYMENT_GATEWAY_ERROR',
  'GEO_PROVIDER_ERROR',
  'CLEARANCE_PROVIDER_UNAVAILABLE',
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

/** iam domain codes (api.md §4.1–4.2). */
export const AUTH_ERROR_CODES = [
  'AUTH_TOKEN_MISSING',
  'AUTH_REFRESH_EXPIRED',
  'AUTH_REFRESH_REUSE_DETECTED',
  'AUTH_PASSWORD_CHANGED',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_PHONE_NOT_VERIFIED',
  'AUTH_EMAIL_NOT_VERIFIED',
  'AUTH_IDENTIFIER_TAKEN',
  'AUTH_OTP_MAX_ATTEMPTS',
  'AUTH_CSRF_HEADER_MISSING',
  'AUTH_CSRF_ORIGIN_MISMATCH',
  'AUTH_PASSWORD_POLICY',
  'AUTH_PASSWORD_RESET_INVALID',
  'PERM_SCOPE_VIOLATION',
  'PERM_ROLE_IMMUTABLE',
  'PERM_SELF_MODIFICATION',
  'USER_HAS_ACTIVE_WORK',
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
