import { describe, expect, it } from 'vitest';
import { TRIP_STATUS } from '@unigate/types';
import {
  HAPPY_PATH,
  ODOMETER_REQUIRED_ON,
  PROOF_REQUIRED_ON,
  START_STATUS,
  TRACKING_STATUSES,
  TRANSITIONS,
  buildStatusBody,
  canConfirm,
  driverActions,
  needsBayan,
  needsOdometer,
  needsProof,
  nextTrips,
  odometerFloor,
  sectionOf,
  shouldTrack,
} from './transitions';

const VERTICALS = ['PASSENGER', 'GOODS'] as const;

describe('transition table', () => {
  it('uses only codes from TRIP_STATUS', () => {
    for (const v of VERTICALS) {
      for (const [from, to] of Object.entries(TRANSITIONS[v])) {
        expect(TRIP_STATUS).toContain(from);
        for (const s of to) expect(TRIP_STATUS).toContain(s);
      }
      for (const s of HAPPY_PATH[v]) expect(TRIP_STATUS).toContain(s);
    }
  });

  it('walks the happy path of each vertical through legal transitions to COMPLETED', () => {
    for (const v of VERTICALS) {
      const path = HAPPY_PATH[v];
      for (let i = 0; i < path.length - 1; i++) {
        const from = path[i] ?? '';
        const to = path[i + 1] ?? '';
        expect(TRANSITIONS[v][from], `${v}: ${from} → ${to}`).toContain(to);
      }
      expect(path[path.length - 1]).toBe('COMPLETED');
      expect(TRANSITIONS[v]['COMPLETED']).toEqual([]);
      expect(TRANSITIONS[v]['CANCELLED']).toEqual([]);
    }
  });

  it('matches the API plugins: passenger is DRIVER_EN_ROUTE → ARRIVED_AT_PICKUP → TRIP_STARTED → … → COMPLETED', () => {
    expect(HAPPY_PATH.PASSENGER).toEqual(['BOOKED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'TRIP_STARTED', 'IN_PROGRESS', 'ARRIVED_AT_DESTINATION', 'COMPLETED']);
    // TRIP_STARTED may skip IN_PROGRESS straight to the destination (the plugin allows both).
    expect(TRANSITIONS.PASSENGER['TRIP_STARTED']).toEqual(['IN_PROGRESS', 'ARRIVED_AT_DESTINATION', 'CANCELLED', 'EXCEPTION']);
    expect(START_STATUS.PASSENGER).toBe('TRIP_STARTED');
    expect(ODOMETER_REQUIRED_ON.PASSENGER).toEqual(['TRIP_STARTED', 'COMPLETED']);
    expect(PROOF_REQUIRED_ON.PASSENGER).toEqual([]);
  });

  it('matches the API plugins: goods loads, transits, unloads, delivers with a proof, then completes', () => {
    expect(HAPPY_PATH.GOODS).toEqual(['BOOKED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'LOADING', 'LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING', 'DELIVERED', 'COMPLETED']);
    expect(TRANSITIONS.GOODS['DELIVERED']).toEqual(['COMPLETED']);
    expect(START_STATUS.GOODS).toBe('LOADED');
    expect(ODOMETER_REQUIRED_ON.GOODS).toEqual(['LOADED', 'DELIVERED']);
    expect(PROOF_REQUIRED_ON.GOODS).toEqual(['DELIVERED']);
  });

  it('never lets the driver reach CANCELLED from EXCEPTION or elsewhere through the buttons', () => {
    for (const v of VERTICALS) {
      for (const from of Object.keys(TRANSITIONS[v])) {
        const actions = driverActions({ transportType: v, allowedNextStatuses: [...(TRANSITIONS[v][from] ?? [])] });
        expect(actions).not.toContain('CANCELLED');
      }
    }
  });

  it('tracks from DRIVER_EN_ROUTE (when the API opens the tracking session) until the trip ends', () => {
    expect(shouldTrack('DRIVER_ASSIGNED')).toBe(false);
    expect(shouldTrack('BOOKED')).toBe(false);
    expect(shouldTrack('DRIVER_EN_ROUTE')).toBe(true);
    expect(shouldTrack('EXCEPTION')).toBe(true);
    expect(shouldTrack('DELIVERED')).toBe(true);
    expect(shouldTrack('COMPLETED')).toBe(false);
    expect(shouldTrack('CANCELLED')).toBe(false);
    // Every tracked state is one a trip can actually be in.
    for (const s of TRACKING_STATUSES) expect(TRIP_STATUS).toContain(s);
  });
});

describe('driverActions', () => {
  it('renders exactly the API list minus CANCELLED, primary step first and EXCEPTION last', () => {
    expect(driverActions({ transportType: 'PASSENGER', allowedNextStatuses: ['EXCEPTION', 'CANCELLED', 'IN_PROGRESS', 'ARRIVED_AT_DESTINATION'] })).toEqual(['IN_PROGRESS', 'ARRIVED_AT_DESTINATION', 'EXCEPTION']);
    expect(driverActions({ transportType: 'GOODS', allowedNextStatuses: ['CANCELLED', 'ARRIVED_AT_PICKUP', 'DRIVER_EN_ROUTE', 'LOADED', 'UNLOADING', 'LOADING'] })).toEqual(['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'LOADING', 'LOADED', 'UNLOADING']);
    expect(driverActions({ transportType: 'PASSENGER', allowedNextStatuses: [] })).toEqual([]);
    // An unknown code (a future state) still renders, after the known ones.
    expect(driverActions({ transportType: 'PASSENGER', allowedNextStatuses: ['NEW_STATE', 'COMPLETED'] })).toEqual(['COMPLETED', 'NEW_STATE']);
  });
});

describe('step requirements', () => {
  it('asks for the odometer, the proof and the Bayan exactly where the API does', () => {
    expect(needsOdometer({ transportType: 'PASSENGER' }, 'TRIP_STARTED')).toBe(true);
    expect(needsOdometer({ transportType: 'PASSENGER' }, 'ARRIVED_AT_PICKUP')).toBe(false);
    expect(needsOdometer({ transportType: 'GOODS' }, 'DELIVERED')).toBe(true);
    expect(needsOdometer({ transportType: 'GOODS' }, 'COMPLETED')).toBe(false);
    expect(needsProof({ transportType: 'GOODS' }, 'DELIVERED')).toBe(true);
    expect(needsProof({ transportType: 'PASSENGER' }, 'COMPLETED')).toBe(false);
    expect(needsBayan({ transportType: 'GOODS', regulatoryReference: null }, 'DRIVER_EN_ROUTE')).toBe(true);
    expect(needsBayan({ transportType: 'GOODS', regulatoryReference: 'BYN-1' }, 'DRIVER_EN_ROUTE')).toBe(false);
    expect(needsBayan({ transportType: 'GOODS', regulatoryReference: null }, 'LOADING')).toBe(false);
    expect(needsBayan({ transportType: 'PASSENGER', regulatoryReference: null }, 'DRIVER_EN_ROUTE')).toBe(false);
  });

  it('computes the odometer floor the API enforces', () => {
    expect(odometerFloor({ startOdometerKm: null }, null)).toBe(0);
    expect(odometerFloor({ startOdometerKm: 1200 }, 1000)).toBe(1200);
    expect(odometerFloor({ startOdometerKm: 900 }, 1000)).toBe(1000);
  });

  it('gates the confirm button like the PWA', () => {
    const goods = { transportType: 'GOODS' };
    expect(canConfirm(goods, { status: 'LOADED', odometer: '', proofRecipient: '' })).toBe(false);
    expect(canConfirm(goods, { status: 'LOADED', odometer: '12x', proofRecipient: '' })).toBe(false);
    expect(canConfirm(goods, { status: 'LOADED', odometer: '1200', proofRecipient: '' })).toBe(true);
    expect(canConfirm(goods, { status: 'DELIVERED', odometer: '1300', proofRecipient: 'A' })).toBe(false);
    expect(canConfirm(goods, { status: 'DELIVERED', odometer: '1300', proofRecipient: 'Ali' })).toBe(true);
    expect(canConfirm({ transportType: 'PASSENGER' }, { status: 'ARRIVED_AT_PICKUP', odometer: '', proofRecipient: '' })).toBe(true);
  });
});

describe('buildStatusBody', () => {
  const at = '2026-09-17T10:00:00.000Z';
  it('sends the position when known (both coordinates, accuracy when present) and nothing else empty', () => {
    expect(buildStatusBody({ transportType: 'PASSENGER' }, { status: 'ARRIVED_AT_PICKUP', occurredAt: at, fix: { latitude: 24.7136, longitude: 46.6753, accuracyM: 12 }, note: '  ', odometer: '' })).toEqual({
      status: 'ARRIVED_AT_PICKUP',
      occurredAt: at,
      latitude: 24.7136,
      longitude: 46.6753,
      accuracyM: 12,
    });
    expect(buildStatusBody({ transportType: 'PASSENGER' }, { status: 'ARRIVED_AT_PICKUP', occurredAt: at, fix: { latitude: 1, longitude: 2 }, note: '', odometer: '' })).toEqual({ status: 'ARRIVED_AT_PICKUP', occurredAt: at, latitude: 1, longitude: 2 });
    expect(buildStatusBody({ transportType: 'PASSENGER' }, { status: 'ARRIVED_AT_PICKUP', occurredAt: at, fix: null, note: '', odometer: '' })).toEqual({ status: 'ARRIVED_AT_PICKUP', occurredAt: at });
  });

  it('adds the odometer only on the steps that take it, trims the note, carries the proof id', () => {
    expect(buildStatusBody({ transportType: 'PASSENGER' }, { status: 'TRIP_STARTED', occurredAt: at, fix: null, note: ' all aboard ', odometer: ' 12345 ' })).toEqual({ status: 'TRIP_STARTED', occurredAt: at, note: 'all aboard', odometerKm: 12345 });
    // A reading typed on a step that does not take it is dropped rather than refused by the API.
    expect(buildStatusBody({ transportType: 'PASSENGER' }, { status: 'ARRIVED_AT_PICKUP', occurredAt: at, fix: null, note: '', odometer: '12345' })).toEqual({ status: 'ARRIVED_AT_PICKUP', occurredAt: at });
    expect(buildStatusBody({ transportType: 'GOODS' }, { status: 'DELIVERED', occurredAt: at, fix: null, note: '', odometer: '500', proofId: 'p1' })).toEqual({ status: 'DELIVERED', occurredAt: at, odometerKm: 500, proofId: 'p1' });
  });
});

describe('list sections and the Home pick', () => {
  it('groups by lifecycle', () => {
    expect(sectionOf('BOOKED')).toBe('upcoming');
    expect(sectionOf('DRIVER_ASSIGNED')).toBe('upcoming');
    expect(sectionOf('DRIVER_EN_ROUTE')).toBe('active');
    expect(sectionOf('EXCEPTION')).toBe('active');
    expect(sectionOf('COMPLETED')).toBe('done');
    expect(sectionOf('CANCELLED')).toBe('done');
  });
  it('picks the soonest non-terminal trips', () => {
    const trips = [
      { id: 'a', status: 'COMPLETED', scheduledStartAt: '2026-09-17T08:00:00Z' },
      { id: 'b', status: 'DRIVER_ASSIGNED', scheduledStartAt: '2026-09-18T08:00:00Z' },
      { id: 'c', status: 'BOOKED', scheduledStartAt: '2026-09-17T12:00:00Z' },
      { id: 'd', status: 'DRIVER_ASSIGNED', scheduledStartAt: '2026-09-19T08:00:00Z' },
    ];
    expect(nextTrips(trips, 2).map((t) => t.id)).toEqual(['c', 'b']);
    expect(nextTrips(trips).map((t) => t.id)).toEqual(['c', 'b', 'd']);
  });
});
