import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Alert } from 'react-native';
import { errorMessage as resolveErrorMessage, type ApiError } from '@unigate/api-client';
import {
  hasMessage,
  loadStoredLocale,
  storeLocale,
  translate,
  type Locale,
  type TranslateValues,
} from './locale';
import { applyLayoutDirection, isRtlLocale, reloadApp, shouldAutoReload } from './rtl';

export type { Locale } from './locale';

export interface I18nContextValue {
  locale: Locale;
  isRTL: boolean;
  /** True once the stored locale has been read; the root layout holds the splash until then. */
  ready: boolean;
  t: (key: string, values?: TranslateValues) => string;
  has: (key: string) => boolean;
  /** Human-readable message for an API failure (errors.<CODE>, the _VERTICAL variant, or the generic line). */
  errorMessage: (error: ApiError | null | undefined) => string;
  setLocale: (locale: Locale) => Promise<void>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ar');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadStoredLocale().then(async (stored) => {
      if (cancelled) return;
      setLocaleState(stored);
      // First launch (or Expo Go, which resets the native direction): align it and reload once.
      if (
        applyLayoutDirection(stored) === 'restart-required' &&
        (await shouldAutoReload()) &&
        reloadApp()
      )
        return;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // `translate` reads the i18n singleton; the locale is passed through so the callback identity
  // changes when the language does and consumers re-render with the new catalogue.
  const t = useCallback(
    (key: string, values?: TranslateValues) => translate(key, values, locale),
    [locale],
  );
  const has = useCallback((key: string) => hasMessage(key, locale), [locale]);

  const errorMessage = useCallback(
    (error: ApiError | null | undefined) => resolveErrorMessage({ t, has }, error),
    [t, has],
  );

  const setLocale = useCallback(async (next: Locale) => {
    await storeLocale(next);
    setLocaleState(next);
    if (applyLayoutDirection(next) === 'restart-required' && !reloadApp()) {
      Alert.alert(translate('common.restartTitle'), translate('common.restartRequired'));
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, isRTL: isRtlLocale(locale), ready, t, has, errorMessage, setLocale }),
    [locale, ready, t, has, errorMessage, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
