import { describe, expect, it } from 'vitest';
import type { MeDto } from '@unigate/types';
import { audienceOf, initialTabFor, tabsFor } from './tabs';

const profiles = (p: Partial<MeDto['profiles']>): MeDto['profiles'] => ({
  customer: null,
  owner: null,
  driver: null,
  spo: null,
  ...p,
});

describe('audienceOf', () => {
  it('derives the audience from profiles, with role codes as confirmation', () => {
    expect(
      audienceOf({
        roles: ['CUSTOMER'],
        profiles: profiles({ customer: { id: 'c', customerType: 'INDIVIDUAL' } }),
      }),
    ).toEqual({ customer: true, vendor: false, driver: false });
    expect(
      audienceOf({
        roles: ['VEHICLE_OWNER'],
        profiles: profiles({
          owner: { id: 'o', onboardingStatus: 'APPROVED', isPlatformFleet: false },
        }),
      }),
    ).toEqual({ customer: false, vendor: true, driver: false });
    expect(
      audienceOf({
        roles: [],
        profiles: profiles({
          customer: { id: 'c', customerType: 'CORPORATE' },
          owner: { id: 'o', onboardingStatus: 'APPROVED', isPlatformFleet: false },
        }),
      }),
    ).toEqual({ customer: true, vendor: true, driver: false });
    expect(
      audienceOf({
        roles: ['DRIVER'],
        profiles: profiles({ driver: { id: 'd', approvalStatus: 'APPROVED' } }),
      }),
    ).toEqual({ customer: false, vendor: false, driver: true });
    // The role alone (profile not yet loaded in the summary) still counts as a driver.
    expect(audienceOf({ roles: ['DRIVER'], profiles: profiles({}) }).driver).toBe(true);
    expect(audienceOf(null)).toEqual({ customer: false, vendor: false, driver: false });
  });
});

describe('tabsFor', () => {
  it('gives customers Home, Requests, Bookings, Notifications, Account', () => {
    expect(tabsFor({ customer: true, vendor: false, driver: false })).toEqual([
      'index',
      'requests',
      'bookings',
      'notifications',
      'account',
    ]);
  });
  it('gives vendors Home, Opportunities, Bookings, Fleet, Account', () => {
    expect(tabsFor({ customer: false, vendor: true, driver: false })).toEqual([
      'index',
      'opportunities',
      'bookings',
      'fleet',
      'account',
    ]);
  });
  it('gives a user with both the customer set plus Fleet', () => {
    expect(tabsFor({ customer: true, vendor: true, driver: false })).toEqual([
      'index',
      'requests',
      'bookings',
      'notifications',
      'fleet',
      'account',
    ]);
  });
  it('gives a driver-only account Trips, Active, Notifications, Account', () => {
    expect(tabsFor({ customer: false, vendor: false, driver: true })).toEqual([
      'trips',
      'active',
      'notifications',
      'account',
    ]);
  });
  it('adds a Trips tab before Account for a driver who also has another profile', () => {
    expect(tabsFor({ customer: true, vendor: false, driver: true })).toEqual([
      'index',
      'requests',
      'bookings',
      'notifications',
      'trips',
      'account',
    ]);
    expect(tabsFor({ customer: false, vendor: true, driver: true })).toEqual([
      'index',
      'opportunities',
      'bookings',
      'fleet',
      'trips',
      'account',
    ]);
    expect(tabsFor({ customer: true, vendor: true, driver: true })).toEqual([
      'index',
      'requests',
      'bookings',
      'notifications',
      'fleet',
      'trips',
      'account',
    ]);
  });
  it('gives everyone else a minimal set', () => {
    expect(tabsFor({ customer: false, vendor: false, driver: false })).toEqual([
      'index',
      'notifications',
      'account',
    ]);
  });
});

describe('initialTabFor', () => {
  it('lands a driver-only account on Trips and everyone else on Home', () => {
    expect(initialTabFor({ customer: false, vendor: false, driver: true })).toBe('trips');
    expect(initialTabFor({ customer: true, vendor: false, driver: true })).toBe('index');
    expect(initialTabFor({ customer: false, vendor: false, driver: false })).toBe('index');
  });
});
