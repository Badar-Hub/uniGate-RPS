/**
 * Deep-link resolution — pure, so both the inbox rows and a tapped push notification route
 * through the same table (the web's `notifications/deep-link.ts`, restricted to the customer
 * surfaces this app has). Every route is a plain path under `app/(app)`; Expo Router resolves
 * `unigate://bookings/{id}` to the same screen, so the scheme URL and the in-app push go the
 * same way.
 */

export type DeepLinkRoute =
  | { kind: 'booking'; path: `/bookings/${string}` }
  | { kind: 'trip'; path: `/track/${string}` }
  | { kind: 'request'; path: `/requests/${string}` }
  | { kind: 'invoice'; path: `/invoices/${string}` }
  | { kind: 'complaint'; path: `/complaints/${string}` }
  | { kind: 'payment'; path: `/pay/return?paymentId=${string}` }
  | { kind: 'settlement'; path: `/settlements/${string}` }
  | { kind: 'vehicle'; path: `/fleet/${string}` }
  | { kind: 'bid'; path: `/bids/${string}` }
  | { kind: 'driver'; path: `/drivers/${string}` }
  | { kind: 'maintenance'; path: '/maintenance' }
  | { kind: 'documents'; path: '/account/documents' }
  | { kind: 'inbox'; path: '/notifications' };

const INBOX: DeepLinkRoute = { kind: 'inbox', path: '/notifications' };

function str(data: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = data?.[key];
  return typeof v === 'string' && v.length > 0 && !v.includes('/') ? v : null;
}

/**
 * A notification's `data` hints → the screen to open. Precedence follows the web resolver:
 * booking, trip, request, invoice, complaint, then the vendor surfaces (settlement, vehicle,
 * bid, driver, maintenance schedule, document); anything else lands on the inbox.
 */
export function routeForNotification(
  data: Record<string, unknown> | null | undefined,
): DeepLinkRoute {
  const bookingId = str(data, 'bookingId');
  if (bookingId) return { kind: 'booking', path: `/bookings/${bookingId}` };
  const tripId = str(data, 'tripId');
  if (tripId) return { kind: 'trip', path: `/track/${tripId}` };
  const tripRequestId = str(data, 'tripRequestId');
  if (tripRequestId) return { kind: 'request', path: `/requests/${tripRequestId}` };
  const invoiceId = str(data, 'invoiceId');
  if (invoiceId) return { kind: 'invoice', path: `/invoices/${invoiceId}` };
  const complaintId = str(data, 'complaintId');
  if (complaintId) return { kind: 'complaint', path: `/complaints/${complaintId}` };
  const settlementId = str(data, 'settlementId');
  if (settlementId) return { kind: 'settlement', path: `/settlements/${settlementId}` };
  const vehicleId = str(data, 'vehicleId');
  if (vehicleId) return { kind: 'vehicle', path: `/fleet/${vehicleId}` };
  const bidId = str(data, 'bidId');
  if (bidId) return { kind: 'bid', path: `/bids/${bidId}` };
  const driverProfileId = str(data, 'driverProfileId');
  if (driverProfileId) return { kind: 'driver', path: `/drivers/${driverProfileId}` };
  if (str(data, 'scheduleId')) return { kind: 'maintenance', path: '/maintenance' };
  if (str(data, 'documentId')) return { kind: 'documents', path: '/account/documents' };
  return INBOX;
}

/**
 * A `unigate://…` (or `https://<host>/…`) URL → the screen to open, or null when the path is
 * not one this app owns. Only the path and a whitelisted query key are read: nothing else from
 * an inbound URL reaches the router.
 */
export function routeForUrl(url: string): DeepLinkRoute | null {
  let path: string;
  let query: URLSearchParams;
  try {
    const u = new URL(url);
    // `unigate://bookings/x` parses with host `bookings` and pathname `/x`; normalise both forms.
    const host = u.protocol === 'unigate:' ? u.host : '';
    // Expo Go links are `exp://host:port/--/<path>`: the `/--/` marker separates the app path.
    const pathname = u.pathname.startsWith('/--/') ? u.pathname.slice(3) : u.pathname;
    path = `${host ? `/${host}` : ''}${pathname}`.replace(/\/+$/, '');
    query = u.searchParams;
  } catch {
    return null;
  }
  const seg = path.split('/').filter(Boolean);
  const id = seg[1];
  const isId = (v: string | undefined): v is string =>
    typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v);
  switch (seg[0] ?? '') {
    case 'bookings':
      return isId(id) ? { kind: 'booking', path: `/bookings/${id}` } : null;
    case 'track':
      return isId(id) ? { kind: 'trip', path: `/track/${id}` } : null;
    case 'requests':
      return isId(id) && id !== 'new' ? { kind: 'request', path: `/requests/${id}` } : null;
    case 'invoices':
      return isId(id) ? { kind: 'invoice', path: `/invoices/${id}` } : null;
    case 'complaints':
      return isId(id) && id !== 'new' ? { kind: 'complaint', path: `/complaints/${id}` } : null;
    case 'settlements':
      return isId(id) ? { kind: 'settlement', path: `/settlements/${id}` } : null;
    case 'fleet':
      return isId(id) && id !== 'new' ? { kind: 'vehicle', path: `/fleet/${id}` } : null;
    case 'bids':
      return isId(id) && id !== 'new' ? { kind: 'bid', path: `/bids/${id}` } : null;
    case 'drivers':
      return isId(id) && id !== 'new' ? { kind: 'driver', path: `/drivers/${id}` } : null;
    case 'pay': {
      const paymentId = query.get('paymentId') ?? undefined;
      if (seg[1] !== 'return' || !isId(paymentId)) return null;
      return { kind: 'payment', path: `/pay/return?paymentId=${paymentId}` };
    }
    case 'notifications':
      return INBOX;
    default:
      return null;
  }
}
