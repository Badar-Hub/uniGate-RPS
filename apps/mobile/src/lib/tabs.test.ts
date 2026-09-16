import { describe, expect, it } from 'vitest';
import type { MeDto } from '@unigate/types';
import { audienceOf, tabsFor } from './tabs';

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
    ).toEqual({ customer: true, vendor: false });
    expect(
      audienceOf({
        roles: ['VEHICLE_OWNER'],
        profiles: profiles({
          owner: { id: 'o', onboardingStatus: 'APPROVED', isPlatformFleet: false },
        }),
      }),
    ).toEqual({ customer: false, vendor: true });
    expect(
      audienceOf({
        roles: [],
        profiles: profiles({
          customer: { id: 'c', customerType: 'CORPORATE' },
          owner: { id: 'o', onboardingStatus: 'APPROVED', isPlatformFleet: false },
        }),
      }),
    ).toEqual({ customer: true, vendor: true });
    expect(
      audienceOf({
        roles: ['DRIVER'],
        profiles: profiles({ driver: { id: 'd', approvalStatus: 'APPROVED' } }),
      }),
    ).toEqual({ customer: false, vendor: false });
    expect(audienceOf(null)).toEqual({ customer: false, vendor: false });
  });
});

describe('tabsFor', () => {
  it('gives customers Home, Requests, Bookings, Notifications, Account', () => {
    expect(tabsFor({ customer: true, vendor: false })).toEqual([
      'index',
      'requests',
      'bookings',
      'notifications',
      'account',
    ]);
  });
  it('gives vendors Home, Opportunities, Bookings, Fleet, Account', () => {
    expect(tabsFor({ customer: false, vendor: true })).toEqual([
      'index',
      'opportunities',
      'bookings',
      'fleet',
      'account',
    ]);
  });
  it('gives a user with both the customer set plus Fleet', () => {
    expect(tabsFor({ customer: true, vendor: true })).toEqual([
      'index',
      'requests',
      'bookings',
      'notifications',
      'fleet',
      'account',
    ]);
  });
  it('gives everyone else a minimal set', () => {
    expect(tabsFor({ customer: false, vendor: false })).toEqual([
      'index',
      'notifications',
      'account',
    ]);
  });
});
