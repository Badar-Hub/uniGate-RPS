import { describe, expect, it } from 'vitest';
import type { BidDto, BookingDto, OpportunityDto, SettlementDto, VehicleDto } from '@unigate/types';
import { summariseVendorHome, vehicleExpiryReasons } from './home-summary';

const NOW = new Date('2026-09-17T12:00:00.000Z').getTime();
const day = (offset: number) => new Date(NOW + offset * 86_400_000).toISOString();
const isoDay = (offset: number) => day(offset).slice(0, 10);

const opportunity = (p: Partial<OpportunityDto> & { biddingOpen?: boolean }): OpportunityDto =>
  ({
    id: p.id ?? 'o',
    request: { biddingOpen: p.biddingOpen ?? true },
    matchScore: null,
    matchReason: {},
    viewedAt: null,
    dismissedAt: p.dismissedAt ?? null,
    eligibleVehicles: [],
    ownBidId: p.ownBidId ?? null,
    createdAt: day(0),
  }) as unknown as OpportunityDto;

const bid = (status: string, validUntil: string): BidDto => ({ id: `b-${status}`, status, validUntil }) as BidDto;
const booking = (id: string, status: string, start: string): BookingDto => ({ id, status, scheduledStartAt: start }) as BookingDto;
const vehicle = (p: Partial<VehicleDto>): VehicleDto =>
  ({
    id: 'v',
    plateNumberEn: '1234 ABC',
    approvalStatus: 'APPROVED',
    lifecycleStatus: 'ACTIVE',
    dispatchable: { ok: true, reasons: [] },
    insuranceExpiryDate: null,
    registrationExpiryDate: null,
    inspectionExpiryDate: null,
    ...p,
  }) as VehicleDto;
const settlement = (id: string, periodEnd: string): SettlementDto => ({ id, periodEnd }) as SettlementDto;

describe('vehicleExpiryReasons', () => {
  it('flags expired and soon-expiring dates only', () => {
    expect(vehicleExpiryReasons({ insuranceExpiryDate: isoDay(-1), registrationExpiryDate: isoDay(10), inspectionExpiryDate: isoDay(90) }, NOW)).toEqual([
      'INSURANCE_EXPIRED',
      'REGISTRATION_EXPIRING',
    ]);
    expect(vehicleExpiryReasons({ insuranceExpiryDate: null, registrationExpiryDate: null, inspectionExpiryDate: null }, NOW)).toEqual([]);
  });
});

describe('summariseVendorHome', () => {
  it('counts open opportunities, live bids, upcoming bookings and the vehicles needing attention', () => {
    const s = summariseVendorHome(
      {
        opportunities: [
          opportunity({ id: 'o1' }),
          opportunity({ id: 'o2', ownBidId: 'b1' }),
          opportunity({ id: 'o3', dismissedAt: day(-1) }),
          opportunity({ id: 'o4', biddingOpen: false }),
        ],
        bids: [bid('SUBMITTED', day(1)), bid('SUBMITTED', day(-1)), bid('ACCEPTED', day(1)), bid('WITHDRAWN', day(1))],
        bookings: [
          booking('late', 'READY', day(5)),
          booking('soon', 'CONFIRMED', day(1)),
          booking('done', 'COMPLETED', day(-3)),
          booking('assigned', 'DRIVER_ASSIGNED', day(2)),
          booking('cancelled', 'CANCELLED', day(1)),
        ],
        vehicles: [
          vehicle({ id: 'ok' }),
          vehicle({ id: 'nd', plateNumberEn: '2 XYZ', dispatchable: { ok: false, reasons: ['VEHICLE_NOT_APPROVED'] }, approvalStatus: 'PENDING_APPROVAL' }),
          vehicle({ id: 'exp', plateNumberEn: '3 KLM', insuranceExpiryDate: isoDay(5) }),
          vehicle({ id: 'rej', plateNumberEn: '4 REJ', approvalStatus: 'REJECTED', dispatchable: { ok: false, reasons: ['VEHICLE_NOT_APPROVED'] } }),
          vehicle({ id: 'arch', lifecycleStatus: 'ARCHIVED', dispatchable: { ok: false, reasons: ['VEHICLE_ARCHIVED'] } }),
        ],
        settlements: [settlement('old', day(-60)), settlement('new', day(-30))],
      },
      NOW,
    );
    expect(s.openOpportunities).toBe(2);
    expect(s.unbidOpportunities).toBe(1);
    expect(s.bidsAwaitingDecision).toBe(1);
    expect(s.upcomingBookings).toBe(3);
    expect(s.nextBooking?.id).toBe('soon');
    expect(s.bookingsNeedingAction).toBe(2);
    expect(s.vehiclesTotal).toBe(5);
    expect(s.vehiclesAttention).toEqual([
      { vehicleId: 'nd', plate: '2 XYZ', reasons: ['VEHICLE_NOT_APPROVED'] },
      { vehicleId: 'exp', plate: '3 KLM', reasons: ['INSURANCE_EXPIRING'] },
      { vehicleId: 'rej', plate: '4 REJ', reasons: ['VEHICLE_REJECTED', 'VEHICLE_NOT_APPROVED'] },
    ]);
    expect(s.lastSettlement?.id).toBe('new');
  });

  it('is all zeros / nulls for an empty owner', () => {
    expect(summariseVendorHome({ opportunities: [], bids: [], bookings: [], vehicles: [], settlements: [] }, NOW)).toEqual({
      openOpportunities: 0,
      unbidOpportunities: 0,
      bidsAwaitingDecision: 0,
      upcomingBookings: 0,
      nextBooking: null,
      bookingsNeedingAction: 0,
      vehiclesTotal: 0,
      vehiclesAttention: [],
      lastSettlement: null,
    });
  });
});
