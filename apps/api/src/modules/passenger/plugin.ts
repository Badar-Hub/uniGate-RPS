import { passengerDetails, type PassengerDetailsInput } from '@unigate/validation';
import type { CapacityValidation, CategoryShape, MatchVerdict, RequestShape, RequestValidation, VehicleCandidate, VehicleCapacityInput, VerticalPlugin } from '@/verticals/plugin.js';

function passengerData(d: PassengerDetailsInput) {
  return {
    passengerCount: d.passengerCount, luggageCount: d.luggageCount, luggageNotes: d.luggageNotes ?? null, tripPurpose: d.tripPurpose, requiresFemaleDriver: d.requiresFemaleDriver,
    requiresWheelchairAccess: d.requiresWheelchairAccess, childSeatsRequired: d.childSeatsRequired, waitingTimeMinutes: d.waitingTimeMinutes, isMultiDay: d.isMultiDay, driverLanguagePreference: d.driverLanguagePreference,
  };
}

/** Passenger vertical (ADR-010, built first). Vehicles carry people: a positive seat count within the category's band. */
export const passengerPlugin: VerticalPlugin = {
  type: 'PASSENGER',
  enabled: true,
  validateVehicleCapacity(category: CategoryShape, input: VehicleCapacityInput): CapacityValidation {
    const fieldErrors: Record<string, string[]> = {};
    const seats = input.passengerCapacity;
    if (seats === undefined) fieldErrors['passengerCapacity'] = ['required for a passenger category'];
    else {
      if (category.minPassengerCapacity !== null && seats < category.minPassengerCapacity) fieldErrors['passengerCapacity'] = [`at least ${category.minPassengerCapacity} for ${category.code}`];
      if (category.maxPassengerCapacity !== null && seats > category.maxPassengerCapacity) fieldErrors['passengerCapacity'] = [`at most ${category.maxPassengerCapacity} for ${category.code}`];
    }
    return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
  },
  extraRequiredDocumentTypes(): string[] {
    return [];
  },
  demand: {
    partialFulfilmentDefault: false,
    detailKey: 'passengerDetails',
    detailCreate(details) {
      return { passengerDetails: { create: passengerData(details as PassengerDetailsInput) } };
    },
    detailUpdate(details) {
      return { passengerDetails: { update: passengerData(details as PassengerDetailsInput) } };
    },
    validateRequest(request: RequestShape, details: unknown): RequestValidation {
      const parsed = passengerDetails.safeParse(details);
      if (!parsed.success) return { ok: false, fieldErrors: { passengerDetails: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } };
      const d = parsed.data;
      const fieldErrors: Record<string, string[]> = {};
      if (d.isMultiDay && !request.returnAt) fieldErrors['passengerDetails.isMultiDay'] = ['a multi-day trip needs returnAt'];
      if (d.childSeatsRequired > d.passengerCount) fieldErrors['passengerDetails.childSeatsRequired'] = ['cannot exceed passengerCount'];
      return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
    },
    matchVehicle(details: unknown, vehicle: VehicleCandidate): MatchVerdict {
      const d = details as PassengerDetailsInput;
      const reasons: string[] = [];
      let score = 100;
      // Seats: the category already bounds the band; the request's headcount per vehicle must fit.
      if (vehicle.passengerCapacity === null) return { ok: false, reasons: ['NO_PASSENGER_CAPACITY'], score: 0 };
      if (vehicle.passengerCapacity < d.passengerCount) return { ok: false, reasons: [`SEATS_${vehicle.passengerCapacity}_LT_${d.passengerCount}`], score: 0 };
      reasons.push('CATEGORY_MATCH', `SEATS_${vehicle.passengerCapacity}_GE_${d.passengerCount}`);
      // A snug fit ranks above an oversized vehicle: fewer empty seats, better score.
      const spare = vehicle.passengerCapacity - d.passengerCount;
      score -= Math.min(30, spare);
      return { ok: true, reasons, score };
    },
  },
  trips: {
    // BOOKED → DRIVER_ASSIGNED → DRIVER_EN_ROUTE → ARRIVED_AT_PICKUP → TRIP_STARTED → IN_PROGRESS → ARRIVED_AT_DESTINATION → COMPLETED
    transitions: {
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
      // no goods states on a passenger trip
      LOADING: [],
      LOADED: [],
      IN_TRANSIT: [],
      UNLOADING: [],
      DELIVERED: [],
    },
    startStatus: 'TRIP_STARTED',
    odometerRequiredOn: ['TRIP_STARTED', 'COMPLETED'],
    proofRequiredOn: [],
    activeStatuses: ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'TRIP_STARTED', 'IN_PROGRESS', 'ARRIVED_AT_DESTINATION', 'EXCEPTION'],
  },
  // Generic driver approval suffices at MVP; per-vertical eligibility for passenger transport is an onboarding question (OQ-13).
  driverEligibilityRequired: false,
  regulatory: {
    // No per-trip regulatory document for passenger transport at MVP (TGA licensing is an onboarding matter — OQ-13).
    referenceTypes: [],
    beforeDispatch() {
      return Promise.resolve({ ok: true });
    },
  },
  invoice: {
    lineDescription(l, granularity) {
      const when = l.scheduledStartAt.toISOString().slice(0, 10);
      return granularity === 'ORDER'
        ? { en: `Passenger transport — order ${l.requestNumber}, ${l.vehicleCount} vehicle${l.vehicleCount > 1 ? 's' : ''}, ${l.pickupAddressLine} → ${l.dropoffAddressLine} (${when})`, ar: `نقل ركاب — طلب ${l.requestNumber}، ${l.vehicleCount} مركبة، ${l.pickupAddressLine} ← ${l.dropoffAddressLine} (${when})` }
        : { en: `Passenger transport — booking ${l.bookingNumber}, ${l.vehicleDescription}, ${l.pickupAddressLine} → ${l.dropoffAddressLine} (${when})`, ar: `نقل ركاب — حجز ${l.bookingNumber}، ${l.vehicleDescription}، ${l.pickupAddressLine} ← ${l.dropoffAddressLine} (${when})` };
    },
    vatCategory() {
      return 'S';
    },
  },
};
