import type { MeDto } from '@unigate/types';

/** Route names under app/(app). `index` is Home. */
export const TAB_NAMES = [
  'index',
  'requests',
  'opportunities',
  'bookings',
  'fleet',
  'notifications',
  'account',
] as const;
export type TabName = (typeof TAB_NAMES)[number];

export interface Audience {
  /** Has a customer profile (individual or corporate). */
  customer: boolean;
  /** Has a vehicle-owner profile — the vendor side of the marketplace. */
  vendor: boolean;
}

/** Same rule as the web portal shell: the profile decides the portal, the role codes confirm it. */
export function audienceOf(me: Pick<MeDto, 'roles' | 'profiles'> | null | undefined): Audience {
  if (!me) return { customer: false, vendor: false };
  return {
    customer: Boolean(me.profiles.customer) || me.roles.includes('CUSTOMER'),
    vendor: Boolean(me.profiles.owner) || me.roles.includes('VEHICLE_OWNER'),
  };
}

/**
 * Tab set by audience (docs/mobile-app.md):
 *  - customer: Home, Requests, Bookings, Notifications, Account
 *  - vendor:   Home, Opportunities, Bookings, Fleet, Account
 *  - both:     the customer set plus Fleet
 *  - neither (a driver or staff account): Home, Notifications, Account
 */
export function tabsFor(audience: Audience): TabName[] {
  if (audience.customer && audience.vendor)
    return ['index', 'requests', 'bookings', 'notifications', 'fleet', 'account'];
  if (audience.customer) return ['index', 'requests', 'bookings', 'notifications', 'account'];
  if (audience.vendor) return ['index', 'opportunities', 'bookings', 'fleet', 'account'];
  return ['index', 'notifications', 'account'];
}
