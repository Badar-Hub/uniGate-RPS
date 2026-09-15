import type { BillingMode, BookingStatus } from './enums.js';

/**
 * Legal booking transitions (database.md §10.2). Keyed on billing_mode because the
 * ENTRY state differs: PREPAID bookings start in PENDING_PAYMENT, INVOICED bookings are
 * CONFIRMED immediately (A-46). The map is asserted in bookings.service before every
 * transition, and every transition writes booking_status_history.
 *
 * `null` as the "from" key means "creation".
 */
export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

const COMMON: TransitionMap<BookingStatus> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['DRIVER_ASSIGNED', 'CANCELLED'],
  DRIVER_ASSIGNED: ['READY', 'CANCELLED'],
  READY: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['DISPUTED'],
  CANCELLED: ['REFUNDED'],
  DISPUTED: ['REFUNDED', 'COMPLETED'],
  REFUNDED: [],
};

export const BOOKING_ENTRY_STATE: Readonly<Record<BillingMode, BookingStatus>> = {
  PREPAID: 'PENDING_PAYMENT',
  INVOICED: 'CONFIRMED',
};

export const BOOKING_TRANSITIONS: Readonly<Record<BillingMode, TransitionMap<BookingStatus>>> = {
  PREPAID: COMMON,
  // An INVOICED booking never enters PENDING_PAYMENT, so that state has no outgoing edges here.
  INVOICED: { ...COMMON, PENDING_PAYMENT: [] },
};

export const BOOKING_TERMINAL_STATES: ReadonlySet<BookingStatus> = new Set(['REFUNDED']);

export function canTransitionBooking(
  mode: BillingMode,
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return BOOKING_TRANSITIONS[mode][from].includes(to);
}
