import type { TripDto } from '@unigate/types';

/**
 * The driver's view of the trip state machine. The API is the authority — `TripDto.allowedNextStatuses`
 * comes from the vertical's own transition map (`apps/api/src/modules/{passenger,goods}/plugin.ts`)
 * and `POST /trips/{id}/status` re-checks every rule — so this module never decides what is
 * legal; it orders the API's list for the screen, says which steps need extra input (odometer,
 * proof of delivery, the goods transport document) and which states keep the location agent on.
 * The tables mirror the API's plugins so a unit test catches drift.
 */

export type TransportType = 'PASSENGER' | 'GOODS';

/** The happy path of each vertical, in order — used to sort the buttons (primary step first). */
export const HAPPY_PATH: Record<TransportType, readonly string[]> = {
  PASSENGER: ['BOOKED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'TRIP_STARTED', 'IN_PROGRESS', 'ARRIVED_AT_DESTINATION', 'COMPLETED'],
  GOODS: ['BOOKED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'LOADING', 'LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING', 'DELIVERED', 'COMPLETED'],
};

/** The API's transition maps, driver-relevant rows (`CANCELLED` is ops-only: `POST /trips/{id}/cancel`). */
export const TRANSITIONS: Record<TransportType, Record<string, readonly string[]>> = {
  PASSENGER: {
    BOOKED: ['DRIVER_ASSIGNED', 'CANCELLED'],
    DRIVER_ASSIGNED: ['DRIVER_EN_ROUTE', 'CANCELLED', 'EXCEPTION'],
    DRIVER_EN_ROUTE: ['ARRIVED_AT_PICKUP', 'CANCELLED', 'EXCEPTION'],
    ARRIVED_AT_PICKUP: ['TRIP_STARTED', 'CANCELLED', 'EXCEPTION'],
    TRIP_STARTED: ['IN_PROGRESS', 'ARRIVED_AT_DESTINATION', 'CANCELLED', 'EXCEPTION'],
    IN_PROGRESS: ['ARRIVED_AT_DESTINATION', 'CANCELLED', 'EXCEPTION'],
    ARRIVED_AT_DESTINATION: ['COMPLETED', 'CANCELLED', 'EXCEPTION'],
    COMPLETED: [],
    CANCELLED: [],
    EXCEPTION: ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'TRIP_STARTED', 'IN_PROGRESS', 'ARRIVED_AT_DESTINATION', 'CANCELLED'],
  },
  GOODS: {
    BOOKED: ['DRIVER_ASSIGNED', 'CANCELLED'],
    DRIVER_ASSIGNED: ['DRIVER_EN_ROUTE', 'CANCELLED', 'EXCEPTION'],
    DRIVER_EN_ROUTE: ['ARRIVED_AT_PICKUP', 'CANCELLED', 'EXCEPTION'],
    ARRIVED_AT_PICKUP: ['LOADING', 'CANCELLED', 'EXCEPTION'],
    LOADING: ['LOADED', 'CANCELLED', 'EXCEPTION'],
    LOADED: ['IN_TRANSIT', 'CANCELLED', 'EXCEPTION'],
    IN_TRANSIT: ['ARRIVED_AT_DESTINATION', 'CANCELLED', 'EXCEPTION'],
    ARRIVED_AT_DESTINATION: ['UNLOADING', 'CANCELLED', 'EXCEPTION'],
    UNLOADING: ['DELIVERED', 'CANCELLED', 'EXCEPTION'],
    DELIVERED: ['COMPLETED'],
    COMPLETED: [],
    CANCELLED: [],
    EXCEPTION: ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'LOADING', 'LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING', 'CANCELLED'],
  },
};

/** The plugins' `startStatus`: the step that stamps `actualStartAt` and the start odometer. */
export const START_STATUS: Record<TransportType, string> = { PASSENGER: 'TRIP_STARTED', GOODS: 'LOADED' };

/** The plugins' `odometerRequiredOn` (`TRIP_ODOMETER_REQUIRED` otherwise). */
export const ODOMETER_REQUIRED_ON: Record<TransportType, readonly string[]> = {
  PASSENGER: ['TRIP_STARTED', 'COMPLETED'],
  GOODS: ['LOADED', 'DELIVERED'],
};

/** The plugins' `proofRequiredOn`: a DELIVERY_CONFIRMATION proof must be referenced (`TRIP_PROOF_REQUIRED`). */
export const PROOF_REQUIRED_ON: Record<TransportType, readonly string[]> = { PASSENGER: [], GOODS: ['DELIVERED'] };

/** States in which the device streams its position (from the first move until the trip ends). */
export const TRACKING_STATUSES: readonly string[] = [
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'TRIP_STARTED',
  'IN_PROGRESS',
  'LOADING',
  'LOADED',
  'IN_TRANSIT',
  'ARRIVED_AT_DESTINATION',
  'UNLOADING',
  'DELIVERED',
  'EXCEPTION',
];

export const TERMINAL_STATUSES: readonly string[] = ['COMPLETED', 'CANCELLED'];

/** Trip states counted as "upcoming" on the driver's lists (not yet moving). */
export const UPCOMING_STATUSES: readonly string[] = ['BOOKED', 'DRIVER_ASSIGNED'];

export function transportTypeOf(t: Pick<TripDto, 'transportType'>): TransportType {
  return t.transportType === 'GOODS' ? 'GOODS' : 'PASSENGER';
}

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function shouldTrack(status: string): boolean {
  return TRACKING_STATUSES.includes(status);
}

/**
 * The buttons to render: exactly the API's `allowedNextStatuses` minus `CANCELLED` (not a driver
 * action), ordered along the vertical's happy path with `EXCEPTION` ("report a problem") last.
 */
export function driverActions(t: Pick<TripDto, 'transportType' | 'allowedNextStatuses'>): string[] {
  const path = HAPPY_PATH[transportTypeOf(t)];
  const rank = (s: string) => (s === 'EXCEPTION' ? 1_000 : path.includes(s) ? path.indexOf(s) : 999);
  return t.allowedNextStatuses.filter((s) => s !== 'CANCELLED').sort((a, b) => rank(a) - rank(b));
}

export function needsOdometer(t: Pick<TripDto, 'transportType'>, target: string): boolean {
  return ODOMETER_REQUIRED_ON[transportTypeOf(t)].includes(target);
}

export function needsProof(t: Pick<TripDto, 'transportType'>, target: string): boolean {
  return PROOF_REQUIRED_ON[transportTypeOf(t)].includes(target);
}

/** Goods: the transport-document (Bayan) reference travels on the trip before the driver leaves. */
export function needsBayan(t: Pick<TripDto, 'transportType' | 'regulatoryReference'>, target: string): boolean {
  return target === 'DRIVER_EN_ROUTE' && t.transportType === 'GOODS' && !t.regulatoryReference;
}

/** The odometer floor the API enforces ("cannot go backwards"), for the client-side hint. */
export function odometerFloor(t: Pick<TripDto, 'startOdometerKm'>, current: number | null): number {
  return Math.max(current ?? 0, t.startOdometerKm ?? 0);
}

export interface Fix {
  latitude: number;
  longitude: number;
  accuracyM?: number | undefined;
}

export interface StatusFormInput {
  status: string;
  /** Device time of the action; the API accepts up to 24 h behind and 15 min ahead. */
  occurredAt: string;
  fix: Fix | null;
  note: string;
  odometer: string;
  proofId?: string | undefined;
}

export interface StatusBody {
  status: string;
  occurredAt: string;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  note?: string;
  odometerKm?: number;
  proofId?: string;
}

/**
 * The `POST /trips/{id}/status` body, byte-for-byte what the driver PWA sends
 * (`apps/web/src/components/driver/driver-trip.tsx`): the position when there is one (both or
 * neither), the note trimmed, the odometer only on the steps that take it, the proof id only
 * when the step needs one.
 */
export function buildStatusBody(t: Pick<TripDto, 'transportType'>, input: StatusFormInput): StatusBody {
  const note = input.note.trim();
  const odometer = input.odometer.trim();
  return {
    status: input.status,
    occurredAt: input.occurredAt,
    ...(input.fix
      ? {
          latitude: input.fix.latitude,
          longitude: input.fix.longitude,
          ...(input.fix.accuracyM !== undefined ? { accuracyM: input.fix.accuracyM } : {}),
        }
      : {}),
    ...(note ? { note } : {}),
    ...(needsOdometer(t, input.status) && /^\d+$/.test(odometer) ? { odometerKm: Number(odometer) } : {}),
    ...(input.proofId ? { proofId: input.proofId } : {}),
  };
}

/** The client-side gate before sending: mirrors the PWA's disabled-button rule. */
export function canConfirm(t: Pick<TripDto, 'transportType'>, input: { status: string; odometer: string; proofRecipient: string }): boolean {
  if (needsOdometer(t, input.status) && !/^\d+$/.test(input.odometer.trim())) return false;
  if (needsProof(t, input.status) && input.proofRecipient.trim().length < 2) return false;
  return true;
}

/**
 * Splits the driver's trips into the three list sections. `GET /trips/active` is the API's own
 * "active" list; this is for the Home card and for grouping a mixed page.
 */
export function sectionOf(status: string): 'upcoming' | 'active' | 'done' {
  if (isTerminal(status)) return 'done';
  if (UPCOMING_STATUSES.includes(status)) return 'upcoming';
  return 'active';
}

/** The next trips to show on Home when nothing is active: soonest scheduled first. */
export function nextTrips<T extends Pick<TripDto, 'status' | 'scheduledStartAt'>>(trips: readonly T[], limit = 3): T[] {
  return trips
    .filter((t) => !isTerminal(t.status))
    .sort((a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime())
    .slice(0, limit);
}
