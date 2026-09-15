import { z } from 'zod';

/** Offset pagination (api.md §5.1). Sort columns are closed enums per endpoint — never free strings. */
export const offsetPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type OffsetPagination = z.infer<typeof offsetPagination>;

export const sortDirection = z.enum(['asc', 'desc']);

/**
 * Builds a `sortBy` + `sortDirection` pair over a closed allow-list of columns.
 * The allow-list is what prevents an identifier from ever being interpolated from the
 * request (security.md T-38).
 */
export function sortParams<const T extends readonly [string, ...string[]]>(allowed: T, defaultBy: T[number]) {
  return z.object({
    sortBy: z.enum(allowed).default(defaultBy),
    sortDirection: sortDirection.default('desc'),
  });
}

/** Cursor pagination (api.md §5.2). The cursor is opaque base64url; decoded server-side. */
export const cursorPagination = z.object({
  cursor: z.string().max(512).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
