import { ERROR_CLASS_STATUS } from '@unigate/types';

/**
 * Error classes (api.md §3.1). Every error the API raises is one of these; the terminal
 * error middleware maps class → status and never leaks a stack trace in production.
 *
 * `code` is the machine-readable, locale-independent identifier clients switch on.
 * `message` is developer-facing. `details` is optional structured context.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  /** When true the message is safe to return verbatim in production. */
  readonly expose: boolean = true;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  readonly status = ERROR_CLASS_STATUS.ValidationError;
  constructor(
    message = 'Request failed validation',
    details?: { fieldErrors: Record<string, string[]>; formErrors: string[] },
  ) {
    super('VALIDATION_FAILED', message, details);
  }
}

export class BadRequestError extends AppError {
  readonly status = ERROR_CLASS_STATUS.BadRequestError;
}

export class UnauthorizedError extends AppError {
  readonly status = ERROR_CLASS_STATUS.UnauthorizedError;
  constructor(code = 'AUTH_REQUIRED', message = 'Authentication required', details?: Record<string, unknown>) {
    super(code, message, details);
  }
}

export class ForbiddenError extends AppError {
  readonly status = ERROR_CLASS_STATUS.ForbiddenError;
  constructor(code = 'PERM_DENIED', message = 'Permission denied', details?: Record<string, unknown>) {
    super(code, message, details);
  }
}

/**
 * Raised for a missing resource AND for an out-of-scope one (api.md §3.2 anti-enumeration).
 * The message deliberately does not say which.
 */
export class NotFoundError extends AppError {
  readonly status = ERROR_CLASS_STATUS.NotFoundError;
  constructor(code = 'NOT_FOUND', message = 'Resource not found', details?: Record<string, unknown>) {
    super(code, message, details);
  }
}

/** Current persisted state collides with the request; retrying later may succeed. */
export class ConflictError extends AppError {
  readonly status = ERROR_CLASS_STATUS.ConflictError;
}

/** The request violates a domain rule; retrying the identical request will never succeed. */
export class BusinessRuleError extends AppError {
  readonly status = ERROR_CLASS_STATUS.BusinessRuleError;
}

export class RateLimitError extends AppError {
  readonly status = ERROR_CLASS_STATUS.RateLimitError;
  constructor(
    public readonly retryAfterSeconds: number,
    code = 'RATE_LIMITED',
    message = 'Too many requests',
  ) {
    super(code, message, { retryAfterSeconds });
  }
}

/** A named upstream returned an error or garbage. */
export class UpstreamError extends AppError {
  readonly status = ERROR_CLASS_STATUS.UpstreamError;
}

export class UpstreamTimeoutError extends AppError {
  readonly status = ERROR_CLASS_STATUS.UpstreamTimeoutError;
  constructor(upstream: string) {
    super('UPSTREAM_TIMEOUT', `${upstream} did not respond within its deadline`, { upstream });
  }
}

/** A hard dependency is down. Always carries Retry-After. */
export class ServiceUnavailableError extends AppError {
  readonly status = ERROR_CLASS_STATUS.ServiceUnavailableError;
  constructor(
    public readonly retryAfterSeconds = 5,
    code = 'SERVICE_UNAVAILABLE',
    message = 'Service temporarily unavailable',
  ) {
    super(code, message);
  }
}

/** Unhandled / explicitly-internal. Message is never exposed in production. */
export class InternalError extends AppError {
  readonly status = ERROR_CLASS_STATUS.AppError;
  override readonly expose = false;
  constructor(message = 'Internal error', details?: Record<string, unknown>) {
    super('INTERNAL_ERROR', message, details);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
