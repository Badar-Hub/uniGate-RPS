import type { Tone } from '@/components/ui';

/**
 * Status → badge tone, the same colour intent as the web lists (`REQUEST_TONE`, `BOOKING_TONE`,
 * `BID_TONE`, the invoice `TONE` map). Labels come from the catalogue under `status.<group>.<code>`;
 * an unknown code falls back to the raw code so a new lifecycle state never renders blank.
 */
export type StatusGroup = 'request' | 'booking' | 'bookingPayment' | 'bid' | 'trip' | 'payment' | 'invoice' | 'complaint';

const TONES: Record<StatusGroup, Record<string, Tone>> = {
  request: { DRAFT: 'neutral', PUBLISHED: 'info', PARTIALLY_AWARDED: 'warning', FULLY_AWARDED: 'success', CLOSED_PARTIAL: 'neutral', COMPLETED: 'success', CANCELLED: 'danger', EXPIRED: 'neutral' },
  booking: { PENDING_PAYMENT: 'warning', CONFIRMED: 'info', DRIVER_ASSIGNED: 'info', READY: 'info', IN_PROGRESS: 'info', COMPLETED: 'success', CANCELLED: 'danger', DISPUTED: 'danger', REFUNDED: 'neutral' },
  bookingPayment: { UNPAID: 'warning', INVOICED: 'info', PARTIALLY_PAID: 'warning', PAID: 'success', REFUNDED: 'neutral', PARTIALLY_REFUNDED: 'neutral' },
  bid: { SUBMITTED: 'info', ACCEPTED: 'success', WITHDRAWN: 'neutral', REJECTED: 'danger', EXPIRED: 'neutral' },
  trip: { COMPLETED: 'success', DELIVERED: 'success', CANCELLED: 'danger', EXCEPTION: 'danger' },
  payment: { PENDING: 'warning', AUTHORIZED: 'info', PAID: 'success', FAILED: 'danger', CANCELLED: 'neutral', REFUNDED: 'neutral', PARTIALLY_REFUNDED: 'neutral' },
  invoice: { DRAFT: 'neutral', PENDING_CLEARANCE: 'warning', ISSUED: 'info', PARTIALLY_PAID: 'warning', PAID: 'success', OVERDUE: 'danger', VOID: 'neutral', CREDITED: 'neutral', CLEARANCE_FAILED: 'danger' },
  complaint: { OPEN: 'warning', IN_REVIEW: 'info', AWAITING_RESPONSE: 'warning', RESOLVED: 'success', REJECTED: 'danger', CLOSED: 'neutral' },
};

export function toneFor(group: StatusGroup, code: string): Tone {
  return TONES[group][code] ?? (group === 'trip' ? 'info' : 'neutral');
}

export interface Catalogue {
  t: (key: string) => string;
  has: (key: string) => boolean;
}

export function statusLabel(i18n: Catalogue, group: StatusGroup, code: string): string {
  const key = `status.${group}.${code}`;
  return i18n.has(key) ? i18n.t(key) : code;
}

/** Translate an enum value under `enums.<group>.<code>`, falling back to the code. */
export function enumLabel(i18n: Catalogue, group: string, code: string | null | undefined): string {
  if (!code) return '—';
  const key = `enums.${group}.${code}`;
  return i18n.has(key) ? i18n.t(key) : code;
}

/** Booking states in which the customer can cancel online (the web's CANCELLABLE list). */
export const CANCELLABLE_BOOKING_STATUSES: readonly string[] = ['PENDING_PAYMENT', 'CONFIRMED', 'DRIVER_ASSIGNED', 'READY'];

/** Trip states during which the live-tracking screen is meaningful. */
export const TRACKABLE_TRIP_STATUSES: readonly string[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'TRIP_STARTED',
  'IN_PROGRESS',
  'LOADING',
  'LOADED',
  'IN_TRANSIT',
  'ARRIVED_AT_DESTINATION',
  'UNLOADING',
];

/** Request states in which bids can still be compared / accepted (web: RequestBids is shown). */
export const BIDDABLE_REQUEST_STATUSES: readonly string[] = ['PUBLISHED', 'PARTIALLY_AWARDED', 'FULLY_AWARDED', 'CLOSED_PARTIAL'];

/** Payable invoice states (web: `payable`). */
export const PAYABLE_INVOICE_STATUSES: readonly string[] = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];
