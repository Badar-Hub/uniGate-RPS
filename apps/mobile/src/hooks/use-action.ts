import { useCallback, useState } from 'react';
import { fieldErrors, unmappedFieldErrors, type ApiError, type ApiResult } from '@unigate/api-client';
import { useI18n } from '@/i18n';

/**
 * State for a screen action that calls the API: busy flag, the banner message (catalogue text
 * for the error code, plus any field errors the form has no input for), and per-field messages.
 * `run` resolves with the data on success and null on failure, so callers stay linear.
 */
export function useAction(knownFields: readonly string[] = []) {
  const { errorMessage } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const show = useCallback((e: ApiError | null) => {
    setError(e);
    setFields(fieldErrors(e));
  }, []);

  const run = useCallback(
    async <T,>(call: () => Promise<ApiResult<T>>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      setFields({});
      try {
        const r = await call();
        if (!r.ok) {
          show(r.error);
          return null;
        }
        return r.data;
      } catch (e) {
        show({ status: 0, code: 'NETWORK', message: e instanceof Error ? e.message : 'failed' });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [show],
  );

  const banner = error
    ? `${errorMessage(error)}${unmappedFieldErrors(error, knownFields) ? ` — ${unmappedFieldErrors(error, knownFields)}` : ''}`
    : null;

  return {
    busy,
    error,
    banner,
    fields,
    run,
    setError: show,
    clear: () => {
      show(null);
    },
    /** Merge client-side validation messages into the field map. */
    setFields,
  };
}
