import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { I18n } from 'i18n-js';
import ar from './messages/ar.json';
import en from './messages/en.json';

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const LOCALE_KEY = 'unigate.locale';

export const i18n = new I18n({ en, ar });
i18n.enableFallback = true;
i18n.defaultLocale = 'en';
// The catalogues use single-brace placeholders (`{name}`), like the web app's next-intl messages.
i18n.placeholder = /\{([^{}]+)\}/gm;

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Arabic-first: the device language decides only when it is one of ours; otherwise Arabic. */
export function deviceLocale(): Locale {
  const code = getLocales()[0]?.languageCode;
  return isLocale(code) ? code : 'ar';
}

export async function loadStoredLocale(): Promise<Locale> {
  const stored = await SecureStore.getItemAsync(LOCALE_KEY).catch(() => null);
  const locale = isLocale(stored) ? stored : deviceLocale();
  i18n.locale = locale;
  return locale;
}

export async function storeLocale(locale: Locale): Promise<void> {
  i18n.locale = locale;
  await SecureStore.setItemAsync(LOCALE_KEY, locale).catch(() => undefined);
}

/** The active locale, for `Accept-Language` on API calls. */
export function currentLocale(): Locale {
  return isLocale(i18n.locale) ? i18n.locale : 'ar';
}

type Catalogue = Record<string, unknown>;
const catalogues: Record<Locale, Catalogue> = { en, ar };

/** Whether `key` (dot path) exists in the locale's catalogue — i18n-js has no cheap `exists` for nested keys. */
export function hasMessage(key: string, locale: Locale = currentLocale()): boolean {
  let node: unknown = catalogues[locale];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Catalogue)[part];
  }
  return typeof node === 'string';
}

export type TranslateValues = Record<string, string | number>;

export function translate(key: string, values?: TranslateValues, locale?: Locale): string {
  return i18n.t(key, { ...values, ...(locale ? { locale } : {}) });
}
