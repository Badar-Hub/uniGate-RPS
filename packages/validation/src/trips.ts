import { z } from 'zod';
import { LOCATION_SOURCE, TRANSPORT_TYPE, TRIP_PROOF_TYPE, TRIP_STATUS } from '@unigate/types';
import { isoTimestamp, latitude, longitude, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/** Trip execution and tracking schemas (api.md §8.15–§8.16, §6.4). */

const statusList = z.preprocess((v) => (typeof v === 'string' ? v.split(',') : v), z.array(z.enum(TRIP_STATUS)).min(1));

export const listTripsQuery = offsetPagination
  .extend({
    status: statusList.optional(),
    transportType: z.enum(TRANSPORT_TYPE).optional(),
    vehicleId: uuid.optional(),
    driverProfileId: uuid.optional(),
    bookingId: uuid.optional(),
    dateFrom: isoTimestamp.optional(),
    dateTo: isoTimestamp.optional(),
  })
  .strict();

export const tripStatusBody = z
  .object({
    status: z.enum(TRIP_STATUS),
    /** Device time; may be in the past (offline capture). Tolerance is enforced by the service. */
    occurredAt: isoTimestamp.optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    accuracyM: z.number().min(0).max(100_000).optional(),
    note: safeText(1000).optional(),
    odometerKm: z.number().int().min(0).max(9_999_999).optional(),
    proofId: uuid.optional(),
  })
  .strict()
  .refine((b) => (b.latitude === undefined) === (b.longitude === undefined), { message: 'latitude and longitude come together', path: ['longitude'] });
export type TripStatusInput = z.infer<typeof tripStatusBody>;

export const patchTripBody = z
  .object({
    driverNotes: safeText(2000).nullable().optional(),
    customerNotes: safeText(2000).nullable().optional(),
    startOdometerKm: z.number().int().min(0).max(9_999_999).optional(),
    endOdometerKm: z.number().int().min(0).max(9_999_999).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');

export const cancelTripBody = z.object({ reason: safeText(1000).pipe(z.string().min(3)) }).strict();

export const tripProofBody = z
  .object({
    proofType: z.enum(TRIP_PROOF_TYPE),
    recipientName: safeText(160).optional(),
    recipientIdLast4: z.string().regex(/^\d{4}$/).optional(),
    signatureDocumentId: uuid.optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    notes: safeText(2000).optional(),
    documentIds: z.array(uuid).max(10).default([]),
  })
  .strict();

export const trackingPingBody = z
  .object({
    tripId: uuid,
    latitude,
    longitude,
    accuracyM: z.number().min(0).max(100_000).optional(),
    headingDeg: z.number().min(0).max(360).optional(),
    speedKmh: z.number().min(0).max(400).optional(),
    recordedAt: isoTimestamp,
    source: z.enum(LOCATION_SOURCE).default('DRIVER_APP'),
  })
  .strict();
export type TrackingPingInput = z.infer<typeof trackingPingBody>;

export const trackingBatchBody = z.object({ points: z.array(trackingPingBody).min(1).max(200) }).strict();

export const trackingHistoryQuery = z
  .object({
    cursor: z.string().max(64).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
  })
  .strict();

export const fleetLiveQuery = z
  .object({
    ownerProfileId: uuid.optional(),
    cityId: uuid.optional(),
    operationalStatus: z.enum(['IDLE', 'RESERVED', 'ON_TRIP', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE']).optional(),
    movedWithinMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
  })
  .strict();

export const endSessionBody = z.object({ reason: z.enum(['ENDED', 'INTERRUPTED']).default('ENDED') }).strict();
