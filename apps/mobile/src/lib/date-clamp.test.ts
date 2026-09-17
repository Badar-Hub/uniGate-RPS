import { describe, expect, it } from 'vitest';
import { clampToMinimum } from './date-clamp';

describe('clampToMinimum', () => {
  const min = new Date('2026-09-17T15:57:30');
  it('keeps a value at or after the minimum', () => {
    const later = new Date('2026-09-17T18:00:00');
    expect(clampToMinimum(later, min)).toBe(later);
    expect(clampToMinimum(later, undefined)).toBe(later);
  });
  it('snaps an earlier value to the minimum rounded up to 5 minutes', () => {
    expect(clampToMinimum(new Date('2026-09-17T15:00:00'), min).toISOString()).toBe(new Date('2026-09-17T16:00:00').toISOString());
    const exact = new Date('2026-09-17T10:00:00');
    expect(clampToMinimum(new Date('2026-09-17T09:00:00'), exact).getTime()).toBe(exact.getTime());
  });
});
