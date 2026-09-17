import type { BidDto, BookingDto, OpportunityDto, SettlementDto, VehicleDto } from '@unigate/types';

/**
 * The owner's Home summary, aggregated on the device from the lists the tabs already load
 * (there is no vendor dashboard endpoint): open opportunities, bids awaiting a decision,
 * upcoming bookings, vehicles needing attention and the last settlement. Pure, unit-tested.
 */

export const DOCUMENT_WARNING_DAYS = 30;

/** Booking states that still lead to a trip (the owner has work to do or to expect). */
export const UPCOMING_BOOKING_STATUSES: readonly string[] = ['CONFIRMED', 'DRIVER_ASSIGNED', 'READY', 'IN_PROGRESS'];

export interface VehicleAttention {
  vehicleId: string;
  plate: string;
  /** Dispatchability reasons from the API plus the document expiry hints derived here. */
  reasons: string[];
}

export interface VendorHomeSummary {
  openOpportunities: number;
  /** Opportunities still open where the owner has no bid yet. */
  unbidOpportunities: number;
  bidsAwaitingDecision: number;
  upcomingBookings: number;
  /** The next booking by scheduled start, if any. */
  nextBooking: BookingDto | null;
  /** Bookings the owner must act on now: CONFIRMED without a driver, DRIVER_ASSIGNED not yet READY. */
  bookingsNeedingAction: number;
  vehiclesTotal: number;
  vehiclesAttention: VehicleAttention[];
  lastSettlement: SettlementDto | null;
}

function daysUntil(isoDay: string, now: number): number {
  const d = new Date(isoDay).getTime();
  if (Number.isNaN(d)) return Number.POSITIVE_INFINITY;
  return Math.floor((d - now) / 86_400_000);
}

/** Expiry hints for the dated fields the vehicle DTO carries (insurance, registration, inspection). */
export function vehicleExpiryReasons(v: Pick<VehicleDto, 'insuranceExpiryDate' | 'registrationExpiryDate' | 'inspectionExpiryDate'>, now: number, warningDays = DOCUMENT_WARNING_DAYS): string[] {
  const out: string[] = [];
  const check = (date: string | null, code: string) => {
    if (!date) return;
    const days = daysUntil(date, now);
    if (days < 0) out.push(`${code}_EXPIRED`);
    else if (days <= warningDays) out.push(`${code}_EXPIRING`);
  };
  check(v.insuranceExpiryDate, 'INSURANCE');
  check(v.registrationExpiryDate, 'REGISTRATION');
  check(v.inspectionExpiryDate, 'INSPECTION');
  return out;
}

export function summariseVendorHome(
  input: {
    opportunities: OpportunityDto[];
    bids: BidDto[];
    bookings: BookingDto[];
    vehicles: VehicleDto[];
    settlements: SettlementDto[];
  },
  now: number = Date.now(),
): VendorHomeSummary {
  const open = input.opportunities.filter((o) => !o.dismissedAt && o.request.biddingOpen);
  const unbid = open.filter((o) => !o.ownBidId);

  const awaiting = input.bids.filter((b) => b.status === 'SUBMITTED' && new Date(b.validUntil).getTime() > now);

  const upcoming = input.bookings
    .filter((b) => UPCOMING_BOOKING_STATUSES.includes(b.status))
    .sort((a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime());
  const needingAction = upcoming.filter((b) => b.status === 'CONFIRMED' || b.status === 'DRIVER_ASSIGNED');

  const attention: VehicleAttention[] = [];
  for (const v of input.vehicles) {
    if (v.lifecycleStatus === 'ARCHIVED') continue;
    const reasons = [...(v.dispatchable.ok ? [] : v.dispatchable.reasons), ...vehicleExpiryReasons(v, now)];
    if (v.approvalStatus === 'REJECTED' && !reasons.includes('VEHICLE_REJECTED')) reasons.unshift('VEHICLE_REJECTED');
    if (reasons.length) attention.push({ vehicleId: v.id, plate: v.plateNumberEn, reasons: [...new Set(reasons)] });
  }

  const last = [...input.settlements].sort((a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime())[0] ?? null;

  return {
    openOpportunities: open.length,
    unbidOpportunities: unbid.length,
    bidsAwaitingDecision: awaiting.length,
    upcomingBookings: upcoming.length,
    nextBooking: upcoming[0] ?? null,
    bookingsNeedingAction: needingAction.length,
    vehiclesTotal: input.vehicles.length,
    vehiclesAttention: attention,
    lastSettlement: last,
  };
}
