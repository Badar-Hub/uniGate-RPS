import type { Locale } from '@/i18n/locale';

/**
 * Display formatting with the active locale. Money never goes through `parseFloat`: the API's
 * decimal strings are grouped and shown as they are, so `"1250.00"` renders as `1,250.00 SAR`
 * and rounding can never differ from the server's figure. Dates go through `Intl` with an
 * explicit Gregorian calendar (the `ar-SA` default would switch to Umm al-Qura) and Latin digits,
 * so numbers read the same in both languages and match the amounts beside them.
 */

const INTL_TAG: Record<Locale, string> = {
  ar: 'ar-SA-u-ca-gregory-nu-latn',
  en: 'en-GB',
};

function formatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(INTL_TAG[locale], options);
  } catch {
    // Hermes without full ICU: fall back to the bare language tag.
    return new Intl.DateTimeFormat(locale, options);
  }
}

export function formatDateTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return formatter(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return formatter(locale, { dateStyle: 'medium' }).format(d);
}

export function formatTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return formatter(locale, { timeStyle: 'short' }).format(d);
}

/** Groups the integer part of a decimal string with thousands separators; the fraction is untouched. */
export function groupDecimal(amount: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(amount.trim());
  if (!m) return amount;
  const sign = m[1] ?? '';
  const int = (m[2] ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${int}${m[3] ?? ''}`;
}

/** `"1250.00"` + `"SAR"` → `1,250.00 SAR`. Null / empty → `—`. */
export function formatMoney(amount: string | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const grouped = groupDecimal(amount);
  return currency ? `${grouped} ${currency}` : grouped;
}

/** Whole-number formatting for counts (`Intl.NumberFormat`, Latin digits). */
export function formatCount(n: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB').format(n);
  } catch {
    return String(n);
  }
}

/** ISO date `YYYY-MM-DD` for a local calendar day (statement periods, api.md §8.4). */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Remaining time as `{ days, hours, minutes, seconds }`; all zero once `until` has passed. */
export function countdown(until: string | Date, now: number = Date.now()): {
  total: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const target = typeof until === 'string' ? new Date(until).getTime() : until.getTime();
  const total = Math.max(0, Math.floor((target - now) / 1000));
  return {
    total,
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}
