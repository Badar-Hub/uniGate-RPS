/** OpenAPI registrations for /trip-requests and /opportunities (api.md §8.11–§8.12). */
import { z } from 'zod';
import { cancelTripRequestBody, closeRemainderBody, createTripRequestBody, dismissQuery, idParams, listOpportunitiesQuery, listTripRequestsQuery, patchTripRequestBody, remainderBody } from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const bearer = [{ bearerAuth: [] }];
const dec = z.string().regex(/^-?\d+\.\d{2}$/).nullable();

const location = z.object({ addressLine: z.string(), cityId: z.string().uuid(), latitude: z.number(), longitude: z.number(), placeId: z.string().nullable() }).openapi('TripLocation');
const passenger = z
  .object({ passengerCount: z.number().int(), luggageCount: z.number().int(), luggageNotes: z.string().nullable(), tripPurpose: z.string(), requiresFemaleDriver: z.boolean(), requiresWheelchairAccess: z.boolean(), childSeatsRequired: z.number().int(), waitingTimeMinutes: z.number().int(), isMultiDay: z.boolean(), driverLanguagePreference: z.array(z.string()) })
  .openapi('PassengerDetails');
const goods = z
  .object({
    cargoType: z.string(), cargoDescription: z.string(), cargoWeightKg: z.string(), cargoVolumeM3: dec, packageCount: z.number().int().nullable(), requiresRefrigeration: z.boolean(), requiredTemperatureMinC: z.number().nullable(), requiredTemperatureMaxC: z.number().nullable(),
    requiresTailLift: z.boolean(), requiresCrane: z.boolean(), loadingResponsibility: z.string(), unloadingResponsibility: z.string(), loadingInstructions: z.string().nullable(), unloadingInstructions: z.string().nullable(), declaredValueAmount: dec, requiresInsurance: z.boolean(), hazmatClass: z.string().nullable(),
    shipperContactName: z.string().nullable(), shipperContactPhone: z.string().nullable(), consigneeContactName: z.string().nullable(), consigneeContactPhone: z.string().nullable(),
  })
  .openapi('GoodsDetails');
const tripRequest = z
  .object({
    id: z.string().uuid(), requestNumber: z.string(), customerProfileId: z.string().uuid(), status: z.string(), transportType: z.enum(['PASSENGER', 'GOODS']),
    vehicleCategory: z.object({ id: z.string().uuid(), code: z.string(), nameEn: z.string(), nameAr: z.string() }).nullable(),
    vehiclesRequired: z.number().int(), allowPartialFulfilment: z.boolean(), vehiclesAwarded: z.number().int(), vehiclesDispatched: z.number().int(), vehiclesCompleted: z.number().int(), vehiclesCancelled: z.number().int(),
    tripDirection: z.string(), pickup: location, dropoff: location, pickupAt: z.string().datetime(), returnAt: z.string().datetime().nullable(), biddingClosesAt: z.string().datetime(), remainderClosesAt: z.string().datetime().nullable(),
    biddingOpen: z.boolean().openapi({ description: 'deadline property, not a status — bids are accepted while true' }), estimatedDistanceKm: dec, estimatedDurationMinutes: z.number().int().nullable(), budgetAmount: dec, currency: z.string(),
    specialInstructions: z.string().nullable(), cancellationReason: z.string().nullable(), passengerDetails: passenger.nullable(), goodsDetails: goods.nullable(), invitedOwnerCount: z.number().int(),
    redacted: z.boolean().openapi({ description: 'true for the owner projection: instructions, contacts and street addresses withheld until an accepted bid' }), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('TripRequest');
const invitation = z
  .object({ id: z.string().uuid(), tripRequestId: z.string().uuid(), ownerProfileId: z.string().uuid(), ownerName: z.string(), vehicleId: z.string().uuid().nullable(), vehiclePlate: z.string().nullable(), matchScore: z.string().nullable(), matchReason: z.record(z.unknown()), notifiedAt: z.string().datetime().nullable(), viewedAt: z.string().datetime().nullable(), dismissedAt: z.string().datetime().nullable(), createdAt: z.string().datetime() })
  .openapi('Invitation');
const opportunity = z
  .object({
    id: z.string().uuid(), request: tripRequest, matchScore: z.string().nullable(), matchReason: z.record(z.unknown()), viewedAt: z.string().datetime().nullable(), dismissedAt: z.string().datetime().nullable(),
    eligibleVehicles: z.array(z.object({ id: z.string().uuid(), plateNumberEn: z.string(), categoryCode: z.string(), passengerCapacity: z.number().int().nullable(), payloadCapacityKg: dec })), ownBidId: z.string().uuid().nullable(), createdAt: z.string().datetime(),
  })
  .openapi('Opportunity');

registry.registerPath({ method: 'get', path: '/trip-requests', tags: ['trip-requests'], summary: 'Own requests (customer) or all with trip_requests.read_any', security: bearer, request: { query: listTripRequestsQuery }, responses: { 200: ok(z.array(tripRequest), 'TripRequestListEnvelope', 'OK — paginated') } });
registry.registerPath({
  method: 'post', path: '/trip-requests', tags: ['trip-requests'], summary: 'Create (optionally publish) with the vertical’s detail block — Idempotency-Key required', security: bearer,
  request: { headers: z.object({ 'idempotency-key': z.string().uuid() }), body: json(createTripRequestBody) },
  responses: { 201: ok(tripRequest, 'TripRequestEnvelope', 'Created (meta.degraded = ["maps"] when the estimate was unavailable)'), 403: err('AUTH_PHONE_NOT_VERIFIED'), 422: err('TRIP_REQUEST_DETAIL_MISMATCH / VALIDATION_FAILED'), 501: err('VERTICAL_NOT_ENABLED') },
});
registry.registerPath({ method: 'get', path: '/trip-requests/{id}', tags: ['trip-requests'], summary: 'Full request (own) / redacted projection (invited owner) / global', security: bearer, request: { params: idParams }, responses: { 200: ok(tripRequest, 'TripRequestEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'patch', path: '/trip-requests/{id}', tags: ['trip-requests'], summary: 'Edit a DRAFT', security: bearer, request: { params: idParams, body: json(patchTripRequestBody) }, responses: { 200: ok(tripRequest, 'TripRequestEnvelope'), 422: err('TRIP_REQUEST_INVALID_TRANSITION / VALIDATION_FAILED') } });
registry.registerPath({ method: 'delete', path: '/trip-requests/{id}', tags: ['trip-requests'], summary: 'Delete a DRAFT (trip_requests.cancel)', security: bearer, request: { params: idParams }, responses: { 204: { description: 'Deleted' }, 422: err('TRIP_REQUEST_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/trip-requests/{id}/publish', tags: ['trip-requests'], summary: 'DRAFT → PUBLISHED: matcher runs, invitations written, event emitted — one transaction', security: bearer, request: { params: idParams }, responses: { 200: ok(tripRequest, 'TripRequestEnvelope'), 422: err('TRIP_REQUEST_INVALID_TRANSITION / VALIDATION_FAILED'), 501: err('VERTICAL_NOT_ENABLED') } });
registry.registerPath({ method: 'post', path: '/trip-requests/{id}/cancel', tags: ['trip-requests'], summary: '→ CANCELLED; refused once anything is awarded', security: bearer, request: { params: idParams, body: json(cancelTripRequestBody) }, responses: { 200: ok(tripRequest, 'TripRequestEnvelope'), 422: err('TRIP_REQUEST_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/trip-requests/{id}/close-remainder', tags: ['trip-requests'], summary: 'PARTIALLY_AWARDED → CLOSED_PARTIAL — customer or admin acting for them (A-45)', security: bearer, request: { params: idParams, body: json(closeRemainderBody) }, responses: { 200: ok(tripRequest, 'TripRequestEnvelope'), 422: err('TRIP_REQUEST_INVALID_TRANSITION') } });
registry.registerPath({ method: 'patch', path: '/trip-requests/{id}/remainder', tags: ['trip-requests'], summary: 'Adjust vehiclesRequired / remainderClosesAt while PARTIALLY_AWARDED', security: bearer, request: { params: idParams, body: json(remainderBody) }, responses: { 200: ok(tripRequest, 'TripRequestEnvelope'), 422: err('RULE_VEHICLES_REQUIRED_BELOW_AWARDED / TRIP_REQUEST_INVALID_TRANSITION') } });
registry.registerPath({ method: 'get', path: '/trip-requests/{id}/invitations', tags: ['trip-requests'], summary: 'Who was matched and why (trip_requests.read_any)', security: bearer, request: { params: idParams }, responses: { 200: ok(z.array(invitation), 'InvitationListEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'get', path: '/opportunities', tags: ['opportunities'], summary: 'Open invitations for the acting owner (redacted requests, best match per request)', security: bearer, request: { query: listOpportunitiesQuery }, responses: { 200: ok(z.array(opportunity), 'OpportunityListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'get', path: '/opportunities/{id}', tags: ['opportunities'], summary: 'Opportunity detail with the owner’s eligible vehicles; marks viewed_at', security: bearer, request: { params: idParams }, responses: { 200: ok(opportunity, 'OpportunityEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'post', path: '/opportunities/{id}/dismiss', tags: ['opportunities'], summary: 'Dismiss (or ?undo=true) an opportunity (opportunities.dismiss)', security: bearer, request: { params: idParams, query: dismissQuery }, responses: { 200: ok(opportunity, 'OpportunityEnvelope') } });
