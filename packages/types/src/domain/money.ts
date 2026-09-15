/**
 * Money on the wire is a STRING with exactly two fraction digits (api.md §2.3), never a JSON
 * number. Rates are strings with four fraction digits, as fractions (0.1500, not 15).
 *
 * These are branded string types so a plain string cannot be passed where money is expected,
 * and a money string cannot be used where a rate is expected. Arithmetic never happens on
 * these values in shared code: the API uses Prisma.Decimal; the web app formats with
 * Intl.NumberFormat and does no arithmetic at all.
 */

declare const moneyBrand: unique symbol;
declare const rateBrand: unique symbol;

/** `"1437.50"` — fixed 2dp, optional leading `-`, no separators, no symbol. */
export type MoneyString = string & { readonly [moneyBrand]: true };
/** `"0.1500"` — fixed 4dp fraction. */
export type RateString = string & { readonly [rateBrand]: true };

export const MONEY_PATTERN = /^-?\d{1,12}\.\d{2}$/;
export const RATE_PATTERN = /^\d{1,2}\.\d{4}$/;

export function isMoneyString(value: unknown): value is MoneyString {
  return typeof value === 'string' && MONEY_PATTERN.test(value);
}

export function isRateString(value: unknown): value is RateString {
  return typeof value === 'string' && RATE_PATTERN.test(value);
}

/** ISO-4217, uppercase. Only SAR at MVP (settings-catalogue finance.currency). */
export type CurrencyCode = 'SAR';
export const DEFAULT_CURRENCY: CurrencyCode = 'SAR';

/** A money value always travels with its currency (database.md D3). */
export interface MoneyAmount {
  readonly amount: MoneyString;
  readonly currency: CurrencyCode;
}
