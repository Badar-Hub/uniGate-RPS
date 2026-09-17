import { describe, expect, it } from 'vitest';
import { countdown, formatMoney, groupDecimal, isoDay } from './format';

describe('formatMoney', () => {
  it('groups the integer part and keeps the API string untouched otherwise', () => {
    expect(groupDecimal('1250.00')).toBe('1,250.00');
    expect(groupDecimal('999')).toBe('999');
    expect(groupDecimal('1234567.5')).toBe('1,234,567.5');
    expect(groupDecimal('-1234.00')).toBe('-1,234.00');
    expect(groupDecimal('n/a')).toBe('n/a');
    expect(formatMoney('1250.00', 'SAR')).toBe('1,250.00 SAR');
    expect(formatMoney('0.10')).toBe('0.10');
    expect(formatMoney(null, 'SAR')).toBe('—');
  });
});

describe('isoDay / countdown', () => {
  it('formats a local calendar day', () => {
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('splits the remaining time and floors at zero', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(countdown(new Date(now + ((26 * 3600 + 61) * 1000)), now)).toEqual({ total: 26 * 3600 + 61, days: 1, hours: 2, minutes: 1, seconds: 1 });
    expect(countdown(new Date(now - 1000), now).total).toBe(0);
  });
});
