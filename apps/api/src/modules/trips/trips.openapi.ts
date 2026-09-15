/** OpenAPI registrations for /trips and /tracking (api.md §8.15–§8.16, §6.4, §9). */
import { z } from 'zod';
import { cancelTripBody, endSessionBody, fleetLiveQuery, idParams, listTripsQuery, patchTripBody, trackingBatchBody, trackingHistoryQuery, trackingPingBody, tripProofBody, tripStatusBody } from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const bearer = [{ bearerAuth: [] }];
const money = z.string().regex(/^-?\d+\.\d{2}$/);
const idem = z.object({ 'idempotency-key': z.string().uuid() });
const location = z.object({ addressLine: z.string(), cityId: z.string().uuid(), latitude: z.number(), longitude: z.number(), placeId: z.string().nullable() });

const position = z.object({ latitude: z.number(), longitude: z.number(), headingDeg: z.number().nullable(), speedKmh: z.number().nullable(), accuracyM: z.number().nullable(), recordedAt: z.string().datetime(), ageSeconds: z.number().int(), stale: z.boolean() }).openapi('TrackingPosition');
const trip = z
  .object({
    id: z.string().uuid(), tripNumber: z.string(), bookingId: z.string().uuid(), bookingNumber: z.string(), bookingStatus: z.string(), transportType: z.string(), status: z.string(),
    allowedNextStatuses: z.array(z.string()).openapi({ description: 'From the vertical’s own transition map — render exactly these buttons' }),
    vehicle: z.object({ id: z.string().uuid(), plateNumberEn: z.string(), description: z.string(), colorCode: z.string().nullable() }),
    driver: z.object({ id: z.string().uuid(), fullNameEn: z.string(), phoneE164: z.string().nullable(), ratingAvg: z.string() }).nullable(),
    customerProfileId: z.string().uuid(), ownerProfileId: z.string().uuid(), pickup: location, dropoff: location, scheduledStartAt: z.string().datetime(), scheduledEndAt: z.string().datetime(),
    actualStartAt: z.string().datetime().nullable(), actualEndAt: z.string().datetime().nullable(), startOdometerKm: z.number().int().nullable(), endOdometerKm: z.number().int().nullable(), actualDistanceKm: money.nullable(),
    driverNotes: z.string().nullable(), customerNotes: z.string().nullable(), delayMinutes: z.number().int().nullable(), regulatoryReference: z.string().nullable(), regulatoryReferenceType: z.string().nullable(), position: position.nullable(), trackingSessionId: z.string().uuid().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('Trip');
const statusResult = z.object({ id: z.string().uuid(), tripNumber: z.string(), status: z.string(), previousStatus: z.string(), transportType: z.string(), occurredAt: z.string().datetime(), recordedAt: z.string().datetime(), allowedNextStatuses: z.array(z.string()), booking: z.object({ id: z.string().uuid(), status: z.string() }) }).openapi('TripStatusResult');
const history = z.object({ id: z.string().uuid(), fromStatus: z.string().nullable(), toStatus: z.string(), actorType: z.string(), changedByUserId: z.string().uuid().nullable(), latitude: z.number().nullable(), longitude: z.number().nullable(), accuracyM: z.number().nullable(), note: z.string().nullable(), occurredAt: z.string().datetime(), recordedAt: z.string().datetime() }).openapi('TripStatusHistoryEntry');
const proof = z.object({ id: z.string().uuid(), tripId: z.string().uuid(), proofType: z.string(), recipientName: z.string().nullable(), recipientIdLast4: z.string().nullable(), signatureDocumentId: z.string().uuid().nullable(), latitude: z.number().nullable(), longitude: z.number().nullable(), notes: z.string().nullable(), capturedByUserId: z.string().uuid().nullable(), capturedAt: z.string().datetime() }).openapi('TripProof');
const pingResult = z.object({ accepted: z.boolean(), persisted: z.boolean().openapi({ description: 'false = live position updated but not appended to history (sampled) — normal' }), sequence: z.number().int(), lowConfidence: z.boolean() }).openapi('TrackingPingResult');
const batchResult = z.object({ results: z.array(z.object({ index: z.number().int(), accepted: z.boolean(), persisted: z.boolean().optional(), sequence: z.number().int().optional(), lowConfidence: z.boolean().optional(), code: z.string().optional() })), acceptedCount: z.number().int() }).openapi('TrackingBatchResult');
const tripTracking = z
  .object({
    tripId: z.string().uuid(), tripStatus: z.string(), bookingNumber: z.string(), position: position.nullable(),
    vehicle: z.object({ plateNumberEn: z.string(), description: z.string(), colorCode: z.string().nullable() }),
    driver: z.object({ fullNameEn: z.string(), phoneE164: z.string().nullable().openapi({ description: 'Only for the booking’s customer while the trip is active' }), ratingAvg: z.string() }).nullable(),
    pickup: z.object({ latitude: z.number(), longitude: z.number(), addressLine: z.string() }), destination: z.object({ latitude: z.number(), longitude: z.number(), addressLine: z.string() }),
    eta: z.object({ arrivalAt: z.string().datetime(), remainingDistanceKm: money, confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']) }).nullable(), socket: z.object({ namespace: z.string(), room: z.string() }),
  })
  .openapi('TripTracking');
const historyPoint = z.object({ latitude: z.number(), longitude: z.number(), headingDeg: z.number().nullable(), speedKmh: z.number().nullable(), accuracyM: z.number().nullable(), recordedAt: z.string().datetime() }).openapi('TrackingHistoryPoint');
const vehicleLive = z.object({ vehicleId: z.string().uuid(), plateNumberEn: z.string(), ownerProfileId: z.string().uuid(), operationalStatus: z.string(), tripId: z.string().uuid().nullable(), position }).openapi('VehicleLivePosition');
const session = z.object({ id: z.string().uuid(), tripId: z.string().uuid(), vehicleId: z.string().uuid(), driverProfileId: z.string().uuid().nullable(), providerCode: z.string(), status: z.string(), startedAt: z.string().datetime(), endedAt: z.string().datetime().nullable(), pointCount: z.number().int(), totalDistanceKm: money }).openapi('TrackingSession');

registry.registerPath({ method: 'get', path: '/trips', tags: ['trips'], summary: 'Own trips (driver / owner / customer) or all with trips.read_any', security: bearer, request: { query: listTripsQuery }, responses: { 200: ok(z.array(trip), 'TripListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'get', path: '/trips/active', tags: ['trips'], summary: 'Trips in a non-terminal state, with last known position', security: bearer, request: { query: listTripsQuery }, responses: { 200: ok(z.array(trip), 'TripListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'get', path: '/trips/{id}', tags: ['trips'], summary: 'Trip + booking, vehicle and driver summary, allowedNextStatuses, position', security: bearer, request: { params: idParams }, responses: { 200: ok(trip, 'TripEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({
  method: 'post', path: '/trips/{id}/status', tags: ['trips'], summary: 'The single transition endpoint — validated against the vertical’s map; side effects (tracking session, booking, counters, calendar) in one transaction; Idempotency-Key required', security: bearer,
  request: { params: idParams, headers: idem, body: json(tripStatusBody) },
  responses: { 200: ok(statusResult, 'TripStatusResultEnvelope'), 409: err('TRIP_ALREADY_COMPLETED'), 422: err('TRIP_INVALID_TRANSITION (details.allowed) / TRIP_NOT_ACTIVE / TRIP_ODOMETER_REQUIRED / TRIP_PROOF_REQUIRED / BOOKING_INVALID_TRANSITION / VALIDATION_FAILED') },
});
registry.registerPath({ method: 'get', path: '/trips/{id}/status-history', tags: ['trips'], summary: 'Status history with the coordinates captured at each transition', security: bearer, request: { params: idParams }, responses: { 200: ok(z.array(history), 'TripStatusHistoryEnvelope') } });
registry.registerPath({ method: 'patch', path: '/trips/{id}', tags: ['trips'], summary: 'Notes and odometer readings (audited before/after)', security: bearer, request: { params: idParams, body: json(patchTripBody) }, responses: { 200: ok(trip, 'TripEnvelope') } });
registry.registerPath({ method: 'post', path: '/trips/{id}/cancel', tags: ['trips'], summary: 'Ops: any non-terminal state → CANCELLED; cascades to the booking (even IN_PROGRESS), releases the reservation, requests the refund', security: bearer, request: { params: idParams, body: json(cancelTripBody) }, responses: { 200: ok(trip, 'TripEnvelope'), 422: err('TRIP_NOT_ACTIVE') } });
registry.registerPath({ method: 'get', path: '/trips/{id}/proofs', tags: ['trips'], summary: 'Proofs of pickup / delivery / damage / exception', security: bearer, request: { params: idParams }, responses: { 200: ok(z.array(proof), 'TripProofListEnvelope') } });
registry.registerPath({ method: 'post', path: '/trips/{id}/proofs', tags: ['trips'], summary: 'Record a proof (with coordinates and linked documents)', security: bearer, request: { params: idParams, body: json(tripProofBody) }, responses: { 201: ok(proof, 'TripProofEnvelope', 'Created') } });

registry.registerPath({ method: 'post', path: '/tracking/ping', tags: ['tracking'], summary: 'Position sample from the driver app — Redis on every ping, one mirrored row per vehicle, sampled history; 30/min per trip', security: bearer, request: { body: json(trackingPingBody) }, responses: { 202: ok(pingResult, 'TrackingPingResultEnvelope', 'Accepted'), 404: err('NOT_FOUND — not the assigned driver'), 422: err('TRACKING_SESSION_NOT_ACTIVE / TRACKING_STALE_POINT'), 429: err('RATE_LIMITED') } });
registry.registerPath({ method: 'post', path: '/tracking/ping/batch', tags: ['tracking'], summary: 'Up to 200 buffered samples with per-item results', security: bearer, request: { body: json(trackingBatchBody) }, responses: { 202: ok(batchResult, 'TrackingBatchResultEnvelope', 'Accepted') } });
registry.registerPath({ method: 'get', path: '/tracking/trips/{id}', tags: ['tracking'], summary: 'Live position + status + ETA for one trip (party → global); names the socket room', security: bearer, request: { params: idParams }, responses: { 200: ok(tripTracking, 'TripTrackingEnvelope', 'OK (meta.degraded = ["maps"] when the ETA is unavailable)'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'get', path: '/tracking/trips/{id}/history', tags: ['tracking'], summary: 'Cursor-paginated history for replay', security: bearer, request: { params: idParams, query: trackingHistoryQuery }, responses: { 200: ok(z.array(historyPoint), 'TrackingHistoryEnvelope', 'OK (meta.nextCursor)') } });
registry.registerPath({ method: 'get', path: '/tracking/vehicles', tags: ['tracking'], summary: 'Fleet live map from the mirror (tracking.read_any)', security: bearer, request: { query: fleetLiveQuery }, responses: { 200: ok(z.array(vehicleLive), 'VehicleLiveListEnvelope') } });
registry.registerPath({ method: 'get', path: '/tracking/vehicles/{id}', tags: ['tracking'], summary: 'Live position of one vehicle irrespective of trip (tracking.read_any)', security: bearer, request: { params: idParams }, responses: { 200: ok(vehicleLive, 'VehicleLiveEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'post', path: '/tracking/sessions/{id}/end', tags: ['tracking'], summary: 'Close a tracking session (ENDED / INTERRUPTED), finalising point count and distance', security: bearer, request: { params: idParams, body: json(endSessionBody) }, responses: { 200: ok(session, 'TrackingSessionEnvelope') } });
