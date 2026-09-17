import { describe, expect, it } from 'vitest';
import { routeForNotification, routeForUrl } from './deep-link';

describe('routeForNotification', () => {
  it('maps the same data keys the web resolver uses, in the same precedence', () => {
    expect(routeForNotification({ bookingId: 'b1', tripId: 't1' })).toEqual({ kind: 'booking', path: '/bookings/b1' });
    expect(routeForNotification({ tripId: 't1', tripRequestId: 'r1' })).toEqual({ kind: 'trip', path: '/track/t1' });
    expect(routeForNotification({ tripRequestId: 'r1' })).toEqual({ kind: 'request', path: '/requests/r1' });
    expect(routeForNotification({ invoiceId: 'i1' })).toEqual({ kind: 'invoice', path: '/invoices/i1' });
    expect(routeForNotification({ complaintId: 'c1' })).toEqual({ kind: 'complaint', path: '/complaints/c1' });
  });

  it('routes the vendor hints to their screens (M2), in the web precedence', () => {
    expect(routeForNotification({ settlementId: 's1' })).toEqual({ kind: 'settlement', path: '/settlements/s1' });
    expect(routeForNotification({ vehicleId: 'v1' })).toEqual({ kind: 'vehicle', path: '/fleet/v1' });
    expect(routeForNotification({ bidId: 'b1' })).toEqual({ kind: 'bid', path: '/bids/b1' });
    expect(routeForNotification({ driverProfileId: 'd1' })).toEqual({ kind: 'driver', path: '/drivers/d1' });
    expect(routeForNotification({ scheduleId: 'm1' })).toEqual({ kind: 'maintenance', path: '/maintenance' });
    expect(routeForNotification({ documentId: 'doc' })).toEqual({ kind: 'documents', path: '/account/documents' });
    // A booking hint still wins over a vehicle hint on the same notification.
    expect(routeForNotification({ vehicleId: 'v1', bookingId: 'b1' }).kind).toBe('booking');
  });

  it('falls back to the inbox for hints the app has no screen for, and for junk', () => {
    expect(routeForNotification({ ownerProfileId: 'o1' })).toEqual({ kind: 'inbox', path: '/notifications' });
    expect(routeForNotification(null).kind).toBe('inbox');
    expect(routeForNotification({ bookingId: 42 }).kind).toBe('inbox');
    expect(routeForNotification({ bookingId: '' }).kind).toBe('inbox');
    // A value with a slash could escape the intended segment — refused.
    expect(routeForNotification({ bookingId: 'x/../../account' }).kind).toBe('inbox');
  });
});

describe('routeForUrl', () => {
  it('resolves scheme URLs whether the first segment parses as host or path', () => {
    expect(routeForUrl('unigate://bookings/abc-123')).toEqual({ kind: 'booking', path: '/bookings/abc-123' });
    expect(routeForUrl('unigate:///bookings/abc-123')).toEqual({ kind: 'booking', path: '/bookings/abc-123' });
    expect(routeForUrl('unigate://track/t1')).toEqual({ kind: 'trip', path: '/track/t1' });
    expect(routeForUrl('unigate://requests/r1/')).toEqual({ kind: 'request', path: '/requests/r1' });
    expect(routeForUrl('unigate://invoices/i1')).toEqual({ kind: 'invoice', path: '/invoices/i1' });
    expect(routeForUrl('unigate://complaints/c1')).toEqual({ kind: 'complaint', path: '/complaints/c1' });
    expect(routeForUrl('unigate://notifications')).toEqual({ kind: 'inbox', path: '/notifications' });
  });

  it('resolves https universal links the same way', () => {
    expect(routeForUrl('https://app.unigate.sa/bookings/abc')).toEqual({ kind: 'booking', path: '/bookings/abc' });
  });

  it('keeps only the paymentId query on the checkout return', () => {
    expect(routeForUrl('unigate://pay/return?paymentId=p1&evil=1')).toEqual({ kind: 'payment', path: '/pay/return?paymentId=p1' });
    expect(routeForUrl('unigate://pay/return')).toBeNull();
    // Expo Go form of the same link
    expect(routeForUrl('exp://172.23.65.81:8081/--/pay/return?paymentId=p1')).toEqual({ kind: 'payment', path: '/pay/return?paymentId=p1' });
    expect(routeForUrl('unigate://pay/return?paymentId=../x')).toBeNull();
  });

  it('resolves the vendor scheme paths and refuses their static children', () => {
    expect(routeForUrl('unigate://fleet/v1')).toEqual({ kind: 'vehicle', path: '/fleet/v1' });
    expect(routeForUrl('unigate://settlements/s1')).toEqual({ kind: 'settlement', path: '/settlements/s1' });
    expect(routeForUrl('unigate://bids/b1')).toEqual({ kind: 'bid', path: '/bids/b1' });
    expect(routeForUrl('unigate://drivers/d1')).toEqual({ kind: 'driver', path: '/drivers/d1' });
    expect(routeForUrl('unigate://fleet/new')).toBeNull();
    expect(routeForUrl('unigate://bids/new')).toBeNull();
  });

  it('refuses paths the app does not own and static children', () => {
    expect(routeForUrl('unigate://account/danger')).toBeNull();
    expect(routeForUrl('unigate://requests/new')).toBeNull();
    expect(routeForUrl('unigate://bookings')).toBeNull();
    expect(routeForUrl('not a url')).toBeNull();
  });
});

describe('driver-aware trip routing (M3)', () => {
  const driver = { driver: true };
  it('sends a tripId hint to the driver trip screen for a driver, and to tracking for everyone else', () => {
    expect(routeForNotification({ tripId: 't1' }, driver)).toEqual({ kind: 'driverTrip', path: '/trips/t1' });
    expect(routeForNotification({ tripId: 't1' }, { driver: false })).toEqual({ kind: 'trip', path: '/track/t1' });
    expect(routeForNotification({ tripId: 't1' })).toEqual({ kind: 'trip', path: '/track/t1' });
    // The booking hint still wins for a driver (the same precedence as the web resolver).
    expect(routeForNotification({ bookingId: 'b1', tripId: 't1' }, driver).kind).toBe('booking');
  });

  it('resolves unigate://trips/{id} and unigate://track/{id} by who opens them', () => {
    expect(routeForUrl('unigate://trips/t1', driver)).toEqual({ kind: 'driverTrip', path: '/trips/t1' });
    expect(routeForUrl('unigate://track/t1', driver)).toEqual({ kind: 'driverTrip', path: '/trips/t1' });
    expect(routeForUrl('unigate://trips/t1')).toEqual({ kind: 'trip', path: '/track/t1' });
    expect(routeForUrl('unigate://trips/t%2F1', driver)).toBeNull();
    expect(routeForUrl('unigate://trips', driver)).toBeNull();
  });
});
