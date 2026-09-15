import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { fail } from '@/common/envelope.js';
import {
  AppError,
  BadRequestError,
  isAppError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
} from '@/common/errors.js';
import { getRequestId } from '@/common/request-context.js';
import { logger } from '@/logging/logger.js';

/** Trailing-slash and unknown routes → 404 ROUTE_NOT_FOUND (api.md §1.2). */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError('ROUTE_NOT_FOUND', 'Route not found'));
}

/**
 * Terminal error middleware (api.md §3). Maps error class → status, always emits the envelope,
 * never leaks a stack trace or an internal message in production, and logs 4xx at warn / 5xx
 * at error with the request id. Field NAMES that failed validation are logged; values are not.
 */
export function errorHandler(isProduction: boolean): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = getRequestId();
    const log = logger();
    const appErr = normalise(err);

    if (appErr instanceof RateLimitError) res.setHeader('Retry-After', String(appErr.retryAfterSeconds));
    if (appErr instanceof ServiceUnavailableError) res.setHeader('Retry-After', String(appErr.retryAfterSeconds));

    const message = appErr.expose || !isProduction ? appErr.message : 'An internal error occurred';
    const details = appErr.expose || !isProduction ? appErr.details : undefined;

    if (appErr.status >= 500) {
      log.error({ err: err instanceof Error ? err : appErr, errorCode: appErr.code, statusCode: appErr.status, path: routePattern(req) }, 'request failed');
    } else {
      log.warn(
        {
          errorCode: appErr.code,
          statusCode: appErr.status,
          path: routePattern(req),
          failedFields: appErr instanceof ValidationError ? Object.keys((appErr.details as { fieldErrors?: object } | undefined)?.fieldErrors ?? {}) : undefined,
        },
        'request rejected',
      );
    }

    if (res.headersSent) return;
    res.status(appErr.status).json(fail(appErr.code, message, requestId, details));
  };
}

function normalise(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of err.issues) (fieldErrors[i.path.join('.') || '_'] ??= []).push(i.message);
    return new ValidationError('Request failed validation', { fieldErrors, formErrors: [] });
  }
  // body-parser / express errors
  const e = err as { type?: string; status?: number; message?: string };
  if (e.type === 'entity.parse.failed') return new BadRequestError('MALFORMED_JSON', 'Request body is not valid JSON');
  if (e.type === 'entity.too.large') return new BadRequestError('PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit');
  if (e.type === 'charset.unsupported' || e.type === 'encoding.unsupported') return new BadRequestError('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content encoding');
  return new (class extends AppError {
    readonly status = 500;
    override readonly expose = false;
  })('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown error');
}

function routePattern(req: Request): string {
  const route = (req as { route?: unknown }).route as { path?: unknown } | undefined;
  const pattern = typeof route?.path === 'string' ? route.path : null;
  return pattern ? `${req.baseUrl}${pattern}` : req.path;
}
