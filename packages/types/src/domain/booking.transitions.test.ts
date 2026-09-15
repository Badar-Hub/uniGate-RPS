import { describe, expect, it } from 'vitest';
import { BOOKING_ENTRY_STATE, BOOKING_TRANSITIONS, canTransitionBooking } from './booking.transitions.js';
import { BOOKING_STATUS } from './enums.js';

describe('booking transitions', () => {
  it('covers every status for both billing modes', () => {
    for (const mode of ['PREPAID', 'INVOICED'] as const) {
      for (const s of BOOKING_STATUS) expect(BOOKING_TRANSITIONS[mode][s]).toBeDefined();
    }
  });

  it('INVOICED bookings enter CONFIRMED and never pass through PENDING_PAYMENT', () => {
    expect(BOOKING_ENTRY_STATE.INVOICED).toBe('CONFIRMED');
    expect(BOOKING_TRANSITIONS.INVOICED.PENDING_PAYMENT).toEqual([]);
    for (const s of BOOKING_STATUS) {
      expect(BOOKING_TRANSITIONS.INVOICED[s]).not.toContain('PENDING_PAYMENT');
    }
  });

  it('forbids cancelling an in-progress booking', () => {
    expect(canTransitionBooking('PREPAID', 'IN_PROGRESS', 'CANCELLED')).toBe(false);
    expect(canTransitionBooking('PREPAID', 'IN_PROGRESS', 'DISPUTED')).toBe(true);
  });

  it('REFUNDED is terminal', () => {
    expect(BOOKING_TRANSITIONS.PREPAID.REFUNDED).toEqual([]);
  });
});
