import type { ApiError } from '@/lib/api-client';

/** Maps an API error code to a translated message; unknown codes fall back to the generic line. */
export function errorMessage(t: (key: string, values?: Record<string, string | number>) => string, error: ApiError | null | undefined): string {
  if (!error) return t('errors.generic');
  if (error.code === 'NETWORK') return t('errors.network');
  const key = `errors.${error.code}`;
  try {
    const msg = t(key);
    // next-intl returns the key path when a message is missing
    return msg.endsWith(key) ? t('errors.generic') : msg;
  } catch {
    return t('errors.generic');
  }
}

/** Field-level messages from a 422 VALIDATION_FAILED body (api.md §4.5). */
export function fieldErrors(error: ApiError | null | undefined): Record<string, string> {
  const details = error?.details as { fieldErrors?: Record<string, string[]> } | undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(details?.fieldErrors ?? {})) if (v[0]) out[k] = v[0];
  return out;
}
