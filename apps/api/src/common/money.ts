import { Prisma } from '@prisma/client';
import type { MoneyString, RateString } from '@unigate/types';

/**
 * Money arithmetic lives here and only here, on Prisma.Decimal (database.md D2, api.md §2.3).
 * Half-up rounding to 2dp at each named step; never floating point.
 */
export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

export function money(value: string | number | Decimal): Decimal {
  return new Decimal(value);
}

/** Round half-up to 2dp. */
export function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Round half-up to 4dp (rates). */
export function round4(d: Decimal): Decimal {
  return d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Wire form: fixed 2dp string. */
export function toMoneyString(d: Decimal | string | number): MoneyString {
  return round2(new Decimal(d)).toFixed(2) as MoneyString;
}

/** Wire form: fixed 4dp fraction string. */
export function toRateString(d: Decimal | string | number): RateString {
  return round4(new Decimal(d)).toFixed(4) as RateString;
}

/** VAT on a net amount at a fractional rate, rounded half-up. */
export function vatOn(net: Decimal, rate: Decimal): Decimal {
  return round2(net.mul(rate));
}
