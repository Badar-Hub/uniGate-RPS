import type { ApiError } from './envelope.js';

/** The i18n key an error maps to, and the interpolation values that key needs. */
export interface ErrorMessageKey {
  /** `errors.generic`, `errors.network`, `errors.<CODE>` or `errors.<CODE>_VERTICAL`. */
  key: string;
  /** Keys to try in order when `key` has no translation; always ends with `errors.generic`. */
  fallbacks: string[];
  /** Present only for the `_VERTICAL` variant — translate `vertical.<code>` and pass it as `{ vertical }`. */
  values?: { vertical: string };
}

/**
 * Maps an API error to its message key. A vertical-specific refusal (DRIVER_NOT_APPROVED /
 * OWNER_NOT_APPROVED with `details.vertical`) has its own wording, `errors.<CODE>_VERTICAL`,
 * interpolating the translated vertical name; a client whose catalogue lacks the variant falls
 * back to `errors.<CODE>`, then to `errors.generic`.
 */
export function errorMessageKey(error: ApiError | null | undefined): ErrorMessageKey {
  if (!error) return { key: 'errors.generic', fallbacks: [] };
  if (error.code === 'NETWORK') return { key: 'errors.network', fallbacks: ['errors.generic'] };
  const key = `errors.${error.code}`;
  const vertical = (error.details as { vertical?: unknown } | undefined)?.vertical;
  if (typeof vertical === 'string' && vertical.length > 0) {
    return { key: `${key}_VERTICAL`, fallbacks: [key, 'errors.generic'], values: { vertical } };
  }
  return { key, fallbacks: ['errors.generic'] };
}

export interface Translator {
  t: (key: string, values?: Record<string, string | number>) => string;
  /** Whether the catalogue has `key`. When omitted, a result that echoes the key counts as missing. */
  has?: (key: string) => boolean;
}

/** Resolves `errorMessageKey` against a catalogue, walking the fallbacks until one exists. */
export function errorMessage(i18n: Translator, error: ApiError | null | undefined): string {
  const { key, fallbacks, values } = errorMessageKey(error);
  const exists = i18n.has ?? ((k: string) => !i18n.t(k).endsWith(k));
  const candidates = [key, ...fallbacks];
  for (const candidate of candidates) {
    if (!exists(candidate)) continue;
    if (values && candidate === key) {
      const verticalKey = `vertical.${values.vertical}`;
      const verticalLabel = exists(verticalKey) ? i18n.t(verticalKey) : values.vertical;
      return i18n.t(candidate, { vertical: verticalLabel });
    }
    return i18n.t(candidate);
  }
  return i18n.t('errors.generic');
}

const LOCATION_PREFIX = /^(body|query|params)\./;

/**
 * Field-level messages from a 422 VALIDATION_FAILED body (api.md §4.5). Keys arrive as
 * `body.plateNumberEn` / `query.page`; the prefix is dropped so forms match on the field name.
 */
export function fieldErrors(error: ApiError | null | undefined): Record<string, string> {
  const details = error?.details as { fieldErrors?: Record<string, string[]> } | undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(details?.fieldErrors ?? {})) {
    const first = v[0];
    if (first) out[k.replace(LOCATION_PREFIX, '')] = first;
  }
  return out;
}

/** "field: message" pairs for fields a form has no input for — shown beside the banner so a rejection is never blank. */
export function unmappedFieldErrors(
  error: ApiError | null | undefined,
  known: readonly string[],
): string {
  return Object.entries(fieldErrors(error))
    .filter(([k]) => !known.includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

/** True for 429s and anything else the API asks the client to wait on (api.md §11). */
export function isThrottled(error: ApiError | null | undefined): boolean {
  return (
    error?.status === 429 ||
    error?.code === 'RATE_LIMITED' ||
    error?.code === 'AUTH_OTP_THROTTLED' ||
    error?.code === 'AUTH_OTP_MAX_ATTEMPTS'
  );
}
