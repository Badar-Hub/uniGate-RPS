import type { NotificationDto } from '@unigate/types';

/** The row's `data` hints → a portal route. Unknown hints fall back to the inbox. */
export function notificationHref(n: NotificationDto): string | null {
  const d = n.data;
  const s = (k: string): string | null => {
    const v = d[k];
    return typeof v === 'string' && v ? v : null;
  };
  if (s('bookingId')) return `/bookings/${s('bookingId')}`;
  if (s('tripId')) return `/track/${s('tripId')}`;
  if (s('tripRequestId')) return `/requests/${s('tripRequestId')}`;
  if (s('invoiceId')) return '/invoices';
  if (s('settlementId')) return '/settlements';
  if (s('vehicleId')) return `/fleet/${s('vehicleId')}`;
  if (s('scheduleId')) return '/maintenance';
  if (s('documentId')) return '/documents';
  if (s('ownerProfileId') || s('driverProfileId')) return '/dashboard';
  return null;
}
