import type { MeDto } from '@unigate/types';

/** Route names under app/(app)/(tabs). `index` is Home. */
export const TAB_NAMES = [
  'index',
  'trips',
  'active',
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
  /** Has a driver profile — executes trips and publishes location (M3). */
  driver: boolean;
}

/** Same rule as the web portal shell: the profile decides the portal, the role codes confirm it. */
export function audienceOf(me: Pick<MeDto, 'roles' | 'profiles'> | null | undefined): Audience {
  if (!me) return { customer: false, vendor: false, driver: false };
  return {
    customer: Boolean(me.profiles.customer) || me.roles.includes('CUSTOMER'),
    vendor: Boolean(me.profiles.owner) || me.roles.includes('VEHICLE_OWNER'),
    driver: Boolean(me.profiles.driver) || me.roles.includes('DRIVER'),
  };
}

/**
 * Tab set by audience (docs/mobile-app.md):
 *  - customer: Home, Requests, Bookings, Notifications, Account
 *  - vendor:   Home, Opportunities, Bookings, Fleet, Account
 *  - both:     the customer set plus Fleet
 *  - driver only: Trips, Active, Notifications, Account (the Active tab is the driver's home)
 *  - driver with other profiles: their set plus a Trips tab (before Account)
 *  - neither (a staff account): Home, Notifications, Account
 */
export function tabsFor(audience: Audience): TabName[] {
  let tabs: TabName[];
  if (audience.customer && audience.vendor)
    tabs = ['index', 'requests', 'bookings', 'notifications', 'fleet', 'account'];
  else if (audience.customer) tabs = ['index', 'requests', 'bookings', 'notifications', 'account'];
  else if (audience.vendor) tabs = ['index', 'opportunities', 'bookings', 'fleet', 'account'];
  else if (audience.driver) return ['trips', 'active', 'notifications', 'account'];
  else return ['index', 'notifications', 'account'];
  if (audience.driver) tabs.splice(tabs.length - 1, 0, 'trips');
  return tabs;
}

/** The tab a signed-in user lands on: Home for everyone except a driver-only account (Trips). */
export function initialTabFor(audience: Audience): TabName {
  return tabsFor(audience)[0] ?? 'index';
}
