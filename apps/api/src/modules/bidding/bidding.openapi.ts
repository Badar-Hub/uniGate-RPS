/** OpenAPI registrations for /bids and the bidding sub-resources of /trip-requests (api.md §8.13, §6.4). */
import { z } from 'zod';
import { acceptBidBody, awardBody, createBidBody, idParams, listBidsQuery, listRequestBidsQuery, patchBidBody, rejectBidBody, withdrawBidBody } from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const bearer = [{ bearerAuth: [] }];
const money = z.string().regex(/^-?\d+\.\d{2}$/);
const rate = z.string().regex(/^\d+\.\d{4}$/);
const idem = z.object({ 'idempotency-key': z.string().uuid() });
const tripRequestRef = z.object({}).openapi({ $ref: '#/components/schemas/TripRequest' } as never);

const bid = z
  .object({
    id: z.string().uuid(), bidNumber: z.string(), tripRequestId: z.string().uuid(), requestNumber: z.string(), ownerProfileId: z.string().uuid(), ownerName: z.string(), ownerRatingAvg: z.string(),
    vehicle: z.object({ id: z.string().uuid(), plateNumberEn: z.string(), description: z.string(), categoryCode: z.string(), passengerCapacity: z.number().int().nullable(), payloadCapacityKg: money.nullable(), ratingAvg: z.string() }),
    driverProfileId: z.string().uuid().nullable(), driverName: z.string().nullable(),
    baseAmount: money, extrasAmount: money, extrasBreakdown: z.array(z.object({ labelEn: z.string(), labelAr: z.string(), amount: money })), vatRate: rate, vatAmount: money, totalAmount: money, currency: z.string(),
    estimatedArrivalAt: z.string().datetime().nullable(), estimatedDurationMinutes: z.number().int().nullable(), validUntil: z.string().datetime(), ownerNotes: z.string().nullable(),
    status: z.string(), version: z.number().int(), lastRevisedAt: z.string().datetime().nullable(), rejectedReason: z.string().nullable(), submittedAt: z.string().datetime(), decidedAt: z.string().datetime().nullable(), bookingId: z.string().uuid().nullable(),
    effectiveCommission: z.object({ type: z.string(), value: money.nullable(), basis: z.string().nullable(), source: z.string() }).nullable().openapi({ description: 'Shown to the bidding owner (when bidding.show_effective_commission_to_owners) and to staff; null for the customer' }),
    createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('Bid');

const location = z.object({ addressLine: z.string(), cityId: z.string().uuid(), latitude: z.number(), longitude: z.number(), placeId: z.string().nullable() });
const booking = z
  .object({
    id: z.string().uuid(), bookingNumber: z.string(), tripRequestId: z.string().uuid(), requestNumber: z.string(), bidId: z.string().uuid(), customerProfileId: z.string().uuid(), ownerProfileId: z.string().uuid(), vehicleId: z.string().uuid(), driverProfileId: z.string().uuid().nullable(),
    vehiclePlateSnapshot: z.string(), vehicleDescriptionSnapshot: z.string(), vehicleCategoryCodeSnapshot: z.string(), ownerNameSnapshot: z.string(), transportType: z.string(), pickup: location, dropoff: location,
    scheduledStartAt: z.string().datetime(), scheduledEndAt: z.string().datetime(), agreedBaseAmount: money, agreedExtrasAmount: money, vatRate: rate, vatAmount: money, totalAmount: money, currency: z.string(),
    billingMode: z.enum(['PREPAID', 'INVOICED']), creditTermsDaysSnapshot: z.number().int().nullable(), fulfilmentSequence: z.number().int(), status: z.string(), paymentStatus: z.string(), paymentDueBy: z.string().datetime().nullable(), nonCircumventionUntil: z.string().datetime().nullable(), confirmedAt: z.string().datetime().nullable(),
    financial: z.object({ grossAmount: money, netOfVatAmount: money, commissionAmount: money, commissionVatAmount: money, commissionSource: z.string(), paymentFeeAmount: money, ownerNetAmount: money, vatTreatment: z.string() }).nullable().openapi({ description: 'Owner and staff projection; null for the customer' }),
    createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('Booking');
const acceptResult = z.object({ booking, tripRequest: tripRequestRef }).openapi('AcceptBidResult');
const awardResult = z.object({ bookings: z.array(booking), tripRequest: tripRequestRef }).openapi('AwardResult');

registry.registerPath({ method: 'get', path: '/bids', tags: ['bids'], summary: 'Own bids (owner) / bids on own requests (customer) / all with bids.read_any', security: bearer, request: { query: listBidsQuery }, responses: { 200: ok(z.array(bid), 'BidListEnvelope', 'OK — paginated') } });
registry.registerPath({
  method: 'post', path: '/bids', tags: ['bids'], summary: 'Submit a bid — totals are server-computed with the snapshotted VAT rate; Idempotency-Key required', security: bearer,
  request: { headers: idem, body: json(createBidBody) },
  responses: { 201: ok(bid, 'BidEnvelope', 'Created'), 409: err('BID_DUPLICATE_VEHICLE'), 422: err('BID_AMOUNT_INVALID / BID_VALIDITY_INVALID / BID_NOT_ELIGIBLE / BID_LIMIT_REACHED / TRIP_REQUEST_NOT_OPEN / TRIP_REQUEST_BIDDING_WINDOW_CLOSED / TRIP_REQUEST_REMAINDER_CLOSED / VEHICLE_NOT_DISPATCHABLE / OWNER_NOT_APPROVED / DRIVER_NOT_APPROVED / DRIVER_LICENSE_EXPIRED') },
});
registry.registerPath({ method: 'get', path: '/bids/{id}', tags: ['bids'], summary: 'One bid (party → global)', security: bearer, request: { params: idParams }, responses: { 200: ok(bid, 'BidEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'patch', path: '/bids/{id}', tags: ['bids'], summary: 'Revise a SUBMITTED bid: version++, totals recomputed; refused after the deadline', security: bearer, request: { params: idParams, body: json(patchBidBody) }, responses: { 200: ok(bid, 'BidEnvelope'), 422: err('BID_INVALID_TRANSITION / TRIP_REQUEST_BIDDING_WINDOW_CLOSED / BID_VALIDITY_INVALID') } });
registry.registerPath({ method: 'post', path: '/bids/{id}/withdraw', tags: ['bids'], summary: '→ WITHDRAWN (owner)', security: bearer, request: { params: idParams, body: json(withdrawBidBody) }, responses: { 200: ok(bid, 'BidEnvelope'), 422: err('BID_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/bids/{id}/reject', tags: ['bids'], summary: '→ REJECTED, a courtesy rejection by the customer (own → global)', security: bearer, request: { params: idParams, body: json(rejectBidBody) }, responses: { 200: ok(bid, 'BidEnvelope'), 422: err('BID_INVALID_TRANSITION') } });
registry.registerPath({
  method: 'post', path: '/bids/{id}/accept', tags: ['bids'], summary: 'Accept one bid → one booking (the partial-fulfilment path); one transaction under the global lock order; Idempotency-Key required', security: bearer,
  request: { params: idParams, headers: idem, body: json(acceptBidBody) },
  responses: { 201: ok(acceptResult, 'AcceptBidResultEnvelope', 'Booking created (PENDING_PAYMENT for PREPAID, CONFIRMED for INVOICED)'), 403: err('COMMISSION_OVERRIDE_FORBIDDEN'), 409: err('BID_VEHICLE_UNAVAILABLE / TRIP_REQUEST_FULLY_AWARDED'), 422: err('RULE_PARTIAL_AWARD_NOT_ALLOWED / RULE_CREDIT_NOT_APPROVED / RULE_CREDIT_LIMIT_EXCEEDED / BID_EXPIRED / BID_INVALID_TRANSITION / VEHICLE_NOT_DISPATCHABLE / TRIP_REQUEST_*') },
});
registry.registerPath({ method: 'get', path: '/trip-requests/{id}/bids', tags: ['trip-requests'], summary: 'The comparison list (customer) — an owner sees only their own rows', security: bearer, request: { params: idParams, query: listRequestBidsQuery }, responses: { 200: ok(z.array(bid), 'BidListEnvelope', 'OK — paginated, totalAmount asc by default'), 404: err('NOT_FOUND') } });
registry.registerPath({
  method: 'post', path: '/trip-requests/{id}/award', tags: ['trip-requests'], summary: 'All-or-nothing group award: the bid set must cover the remainder exactly; every booking is created or none is; Idempotency-Key required', security: bearer,
  request: { params: idParams, headers: idem, body: json(awardBody) },
  responses: { 201: ok(awardResult, 'AwardResultEnvelope', 'Bookings created'), 403: err('COMMISSION_OVERRIDE_FORBIDDEN'), 409: err('BID_VEHICLE_UNAVAILABLE / TRIP_REQUEST_FULLY_AWARDED'), 422: err('RULE_AWARD_SET_INCOMPLETE / RULE_CREDIT_NOT_APPROVED / RULE_CREDIT_LIMIT_EXCEEDED / BID_EXPIRED / VALIDATION_FAILED (duplicate vehicle)') },
});
