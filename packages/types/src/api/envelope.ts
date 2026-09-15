/**
 * The uniform response envelope (api.md §2). Every response — success, validation failure,
 * 500 — has this top-level shape, except 204 which has no body.
 */

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface CursorMeta {
  nextCursor: string | null;
  hasNext: boolean;
}

export interface ResponseMeta {
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrevious?: boolean;
  nextCursor?: string | null;
  idempotentReplay?: true;
  computedAt?: string;
  partial?: true;
  degraded?: string[];
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  /** Developer-facing note only — never a display string. */
  message: string | null;
  meta: ResponseMeta;
}

export interface ValidationDetails {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
}

export interface ErrorBody {
  code: string;
  /** Absent, not null, when there is nothing structured to add. */
  details?: Record<string, unknown> | ValidationDetails;
  requestId: string;
}

export interface ErrorEnvelope {
  success: false;
  data: null;
  message: string;
  error: ErrorBody;
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

/** Request/response identifiers */
export const HEADER_REQUEST_ID = 'x-request-id';
export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';
