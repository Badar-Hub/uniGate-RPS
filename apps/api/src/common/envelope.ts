import type { Response } from 'express';
import type { ErrorEnvelope, ResponseMeta, SuccessEnvelope } from '@unigate/types';

/** api.md §2 — the uniform envelope. `message` is a developer note, never a display string. */
export function ok<T>(data: T, meta: ResponseMeta = {}, message: string | null = null): SuccessEnvelope<T> {
  return { success: true, data, message, meta };
}

export function paginated<T>(
  items: T[],
  page: number,
  pageSize: number,
  totalItems: number,
): SuccessEnvelope<T[]> {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return ok(items, {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  });
}

export function fail(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  const error: ErrorEnvelope['error'] = { code, requestId };
  if (details !== undefined) error.details = details; // absent, not null
  return { success: false, data: null, message, error };
}

/** Convenience senders — controllers use these rather than building objects. */
export function sendOk(res: Response, data: unknown, meta?: ResponseMeta, status = 200): void {
  res.status(status).json(ok(data, meta));
}

export function sendCreated(res: Response, data: unknown, location?: string): void {
  if (location) res.setHeader('Location', location);
  res.status(201).json(ok(data));
}

export function sendAccepted(res: Response, data: unknown): void {
  res.status(202).json(ok(data));
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}
