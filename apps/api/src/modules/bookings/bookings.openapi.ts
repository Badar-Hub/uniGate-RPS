/** OpenAPI registrations for /bookings (api.md §8.14). */
import { z } from 'zod';
import { cancelBookingBody, confirmBookingBody, dispatchDriverBody, idParams, listBookingsQuery, readyBody, waiveFeeBody } from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const bearer = [{ bearerAuth: [] }];
const money = z.string().regex(/^-?\d+\.\d{2}$/);
const rate = z.string().regex(/^\d+\.\d{4}$/);
const idem = z.object({ 'idempotency-key': z.string().uuid() });
const bookingRef = z.object({}).openapi({ $ref: '#/components/schemas/Booking' } as never);

const cancellation = z
  .object({
    cancelledByRole: z.string(), eventType: z.string(), reasonCode: z.string(), reasonText: z.string().nullable(), hoursBeforePickup: z.string(), feePayer: z.string(), cancellationFeeAmount: money, refundAmount: money, currency: z.string(),
    feeSource: z.string(), feeRuleSnapshot: z.record(z.unknown()), feeWaivedAt: z.string().datetime().nullable(), feeWaivedReason: z.string().nullable(), cancelledAt: z.string().datetime(),
  })
  .openapi('BookingCancellation');
const quote = z
  .object({ bookingId: z.string().uuid(), cancelledByRole: z.string(), hoursBeforePickup: z.string(), feeAmount: money, refundAmount: money, currency: z.string(), feeSource: z.string(), feeRuleSnapshot: z.record(z.unknown()), windowPassed: z.boolean(), allowedReasonCodes: z.array(z.string()) })
  .openapi('CancellationQuote');
const cancelResult = z
  .object({ booking: bookingRef, cancellation, refund: z.object({ id: z.string().uuid(), refundNumber: z.string(), status: z.string(), amount: money, currency: z.string() }).nullable().openapi({ description: 'Created only against a captured payment (Phase 9); null when nothing was paid' }), calendarEntryReleased: z.boolean() })
  .openapi('CancelBookingResult');
const history = z.object({ id: z.string().uuid(), fromStatus: z.string().nullable(), toStatus: z.string(), actorType: z.string(), changedByUserId: z.string().uuid().nullable(), reason: z.string().nullable(), metadata: z.record(z.unknown()), occurredAt: z.string().datetime() }).openapi('BookingStatusHistoryEntry');
const financials = z
  .object({
    bookingId: z.string().uuid(), grossAmount: money, vatRate: rate, vatAmount: money, netOfVatAmount: money, currency: z.string(), computedAt: z.string().datetime(),
    owner: z.object({ commissionAmount: money, commissionVatAmount: money, paymentFeeAmount: money, ownerGrossAmount: money, ownerNetAmount: money, vatTreatment: z.string() }).nullable().openapi({ description: 'Owner and staff projection' }),
    finance: z.object({ commissionSource: z.string(), commissionBasis: z.string().nullable(), commissionRate: rate.nullable(), commissionRuleId: z.string().uuid().nullable(), commissionRuleSnapshot: z.record(z.unknown()), commissionOverrideSnapshot: z.record(z.unknown()).nullable(), spoCommissionAmount: money, ownerVatRegisteredSnapshot: z.boolean(), calculationVersion: z.number().int() }).nullable().openapi({ description: 'Staff with commissions.read_any only' }),
  })
  .openapi('BookingFinancials');

registry.registerPath({ method: 'get', path: '/bookings', tags: ['bookings'], summary: 'Own bookings (customer / owner / assigned driver) or all with bookings.read_any; ?tripRequestId renders one order’s dispatch waves', security: bearer, request: { query: listBookingsQuery }, responses: { 200: ok(z.array(bookingRef), 'BookingListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'get', path: '/bookings/{id}', tags: ['bookings'], summary: 'One booking, projected per party (the customer never sees the financial split)', security: bearer, request: { params: idParams }, responses: { 200: ok(bookingRef, 'BookingEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'get', path: '/bookings/{id}/status-history', tags: ['bookings'], summary: 'Append-only status history with actor and reason', security: bearer, request: { params: idParams }, responses: { 200: ok(z.array(history), 'BookingStatusHistoryEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'get', path: '/bookings/{id}/financials', tags: ['bookings'], summary: 'The financial snapshot, projected by role', security: bearer, request: { params: idParams }, responses: { 200: ok(financials, 'BookingFinancialsEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'get', path: '/bookings/{id}/cancellation-quote', tags: ['bookings'], summary: 'Dry run of the cancellation fee under the currently effective policy — shares the cancel’s function, so they cannot disagree', security: bearer, request: { params: idParams }, responses: { 200: ok(quote, 'CancellationQuoteEnvelope'), 422: err('BOOKING_INVALID_TRANSITION') } });
registry.registerPath({
  method: 'post', path: '/bookings/{id}/cancel', tags: ['bookings'], summary: 'Cancel: fee from the admin policy (or an admin override), reservation released, order reopened; Idempotency-Key required', security: bearer,
  request: { params: idParams, headers: idem, body: json(cancelBookingBody) },
  responses: { 200: ok(cancelResult, 'CancelBookingResultEnvelope'), 403: err('CANCELLATION_FEE_OVERRIDE_FORBIDDEN / PERM_DENIED'), 409: err('BOOKING_ALREADY_CANCELLED'), 422: err('BOOKING_INVALID_TRANSITION / BOOKING_CANCELLATION_WINDOW_PASSED / CANCELLATION_REASON_NOT_ALLOWED') },
});
registry.registerPath({ method: 'post', path: '/bookings/{id}/cancellation/waive-fee', tags: ['bookings'], summary: 'Admin: waive a computed fee before the refund / settlement line is processed (audited NOTICE)', security: bearer, request: { params: idParams, body: json(waiveFeeBody) }, responses: { 200: ok(cancelResult, 'CancelBookingResultEnvelope'), 409: err('CANCELLATION_FEE_LOCKED') } });
registry.registerPath({ method: 'post', path: '/bookings/{id}/confirm', tags: ['bookings'], summary: 'Ops override PENDING_PAYMENT → CONFIRMED (offline payment reconciled)', security: bearer, request: { params: idParams, body: json(confirmBookingBody) }, responses: { 200: ok(bookingRef, 'BookingEnvelope'), 422: err('BOOKING_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/bookings/{id}/assign-driver', tags: ['bookings'], summary: 'CONFIRMED → DRIVER_ASSIGNED; driver approved, licensed, assigned to the vehicle and free for the window; creates the trip row', security: bearer, request: { params: idParams, body: json(dispatchDriverBody) }, responses: { 200: ok(bookingRef, 'BookingEnvelope'), 422: err('BOOKING_INVALID_TRANSITION / DRIVER_NOT_APPROVED / DRIVER_LICENSE_EXPIRED / DRIVER_NOT_ASSIGNED_TO_VEHICLE / DRIVER_ALREADY_ON_TRIP') } });
registry.registerPath({ method: 'post', path: '/bookings/{id}/ready', tags: ['bookings'], summary: 'DRIVER_ASSIGNED → READY (owner or ops)', security: bearer, request: { params: idParams, body: json(readyBody) }, responses: { 200: ok(bookingRef, 'BookingEnvelope'), 422: err('BOOKING_INVALID_TRANSITION') } });
