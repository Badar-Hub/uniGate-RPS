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

  it('falls back to the inbox for hints the app has no screen for, and for junk', () => {
    expect(routeForNotification({ settlementId: 's1' })).toEqual({ kind: 'inbox', path: '/notifications' });
    expect(routeForNotification({ vehicleId: 'v1' }).kind).toBe('inbox');
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

  it('refuses paths the app does not own and static children', () => {
    expect(routeForUrl('unigate://account/danger')).toBeNull();
    expect(routeForUrl('unigate://requests/new')).toBeNull();
    expect(routeForUrl('unigate://bookings')).toBeNull();
    expect(routeForUrl('not a url')).toBeNull();
  });
});
