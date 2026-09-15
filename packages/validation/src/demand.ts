import { z } from 'zod';
import { CARGO_TYPE, LOADING_RESPONSIBILITY, TRANSPORT_TYPE, TRIP_DIRECTION, TRIP_PURPOSE, TRIP_REQUEST_STATUS } from '@unigate/types';
import { currencyCode, isoTimestamp, latitude, longitude, phoneE164, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/**
 * Demand module schemas (api.md §8.11–§8.12). The vertical detail blocks are exported so the
 * plugins can own their validation; the core body only checks the shared fields.
 */

/** Unbranded 2dp decimal string: the brand (MoneyString) is applied in the API where the value is typed as money. */
const decimalString = z.string().regex(/^\d{1,12}\.\d{2}$/, 'must be a non-negative decimal string with exactly 2 fraction digits');

export const tripLocation = z
  .object({
    addressLine: safeText(500).pipe(z.string().min(3)),
    cityId: uuid,
    latitude,
    longitude,
    placeId: z.string().max(255).optional(),
  })
  .strict();
export type TripLocation = z.infer<typeof tripLocation>;

export const passengerDetails = z
  .object({
    passengerCount: z.number().int().min(1).max(500),
    luggageCount: z.number().int().min(0).max(1000).default(0),
    luggageNotes: safeText(500).optional(),
    tripPurpose: z.enum(TRIP_PURPOSE),
    requiresFemaleDriver: z.boolean().default(false),
    requiresWheelchairAccess: z.boolean().default(false),
    childSeatsRequired: z.number().int().min(0).max(20).default(0),
    waitingTimeMinutes: z.number().int().min(0).max(1440).default(0),
    isMultiDay: z.boolean().default(false),
    driverLanguagePreference: z.array(z.enum(['ar', 'en', 'ur', 'hi', 'bn', 'fil'])).max(4).default([]),
  })
  .strict();
export type PassengerDetailsInput = z.infer<typeof passengerDetails>;

export const goodsDetails = z
  .object({
    cargoType: z.enum(CARGO_TYPE),
    cargoDescription: safeText(2000).pipe(z.string().min(3)),
    cargoWeightKg: decimalString,
    cargoVolumeM3: decimalString.optional(),
    packageCount: z.number().int().min(1).max(100_000).optional(),
    packageLengthCm: z.number().int().positive().max(3000).optional(),
    packageWidthCm: z.number().int().positive().max(500).optional(),
    packageHeightCm: z.number().int().positive().max(500).optional(),
    requiresRefrigeration: z.boolean().default(false),
    requiredTemperatureMinC: z.number().min(-40).max(40).optional(),
    requiredTemperatureMaxC: z.number().min(-40).max(40).optional(),
    requiresTailLift: z.boolean().default(false),
    requiresCrane: z.boolean().default(false),
    loadingResponsibility: z.enum(LOADING_RESPONSIBILITY),
    unloadingResponsibility: z.enum(LOADING_RESPONSIBILITY),
    loadingInstructions: safeText(1000).optional(),
    unloadingInstructions: safeText(1000).optional(),
    declaredValueAmount: decimalString.optional(),
    requiresInsurance: z.boolean().default(false),
    hazmatClass: z.string().max(16).optional(),
    shipperContactName: safeText(160).optional(),
    shipperContactPhone: phoneE164.optional(),
    consigneeContactName: safeText(160).optional(),
    consigneeContactPhone: phoneE164.optional(),
  })
  .strict();
export type GoodsDetailsInput = z.infer<typeof goodsDetails>;

export const createTripRequestBody = z
  .object({
    transportType: z.enum(TRANSPORT_TYPE),
    vehicleCategoryId: uuid,
    vehiclesRequired: z.number().int().min(1).max(200).default(1),
    /** Defaults per vertical (A-45) when omitted: passenger false, goods true. */
    allowPartialFulfilment: z.boolean().optional(),
    tripDirection: z.enum(TRIP_DIRECTION),
    pickup: tripLocation,
    dropoff: tripLocation,
    pickupAt: isoTimestamp,
    returnAt: isoTimestamp.optional(),
    /** Defaults from bidding.* settings when omitted. */
    biddingClosesAt: isoTimestamp.optional(),
    remainderClosesAt: isoTimestamp.optional(),
    budgetAmount: decimalString.optional(),
    currency: currencyCode.default('SAR'),
    specialInstructions: safeText(2000).optional(),
    passengerDetails: passengerDetails.optional(),
    goodsDetails: goodsDetails.optional(),
    publish: z.boolean().default(false),
    /** Staff creating on behalf of a customer. */
    customerProfileId: uuid.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.tripDirection === 'ROUND_TRIP' && !b.returnAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['returnAt'], message: 'returnAt is required for a round trip' });
    if (b.returnAt && new Date(b.returnAt) <= new Date(b.pickupAt)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['returnAt'], message: 'returnAt must be after pickupAt' });
    if (b.biddingClosesAt && b.remainderClosesAt && new Date(b.remainderClosesAt) <= new Date(b.biddingClosesAt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['remainderClosesAt'], message: 'remainderClosesAt must be after biddingClosesAt' });
    }
  });

/** DRAFT only (api.md §8.11). Same shape as create minus the vertical and the publish flag. */
export const patchTripRequestBody = z
  .object({
    vehicleCategoryId: uuid.optional(),
    vehiclesRequired: z.number().int().min(1).max(200).optional(),
    allowPartialFulfilment: z.boolean().optional(),
    tripDirection: z.enum(TRIP_DIRECTION).optional(),
    pickup: tripLocation.optional(),
    dropoff: tripLocation.optional(),
    pickupAt: isoTimestamp.optional(),
    returnAt: isoTimestamp.nullable().optional(),
    biddingClosesAt: isoTimestamp.optional(),
    remainderClosesAt: isoTimestamp.nullable().optional(),
    budgetAmount: decimalString.nullable().optional(),
    specialInstructions: safeText(2000).nullable().optional(),
    passengerDetails: passengerDetails.optional(),
    goodsDetails: goodsDetails.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });

export const cancelTripRequestBody = z.object({ reason: safeText(1000).pipe(z.string().min(3)) }).strict();
export const closeRemainderBody = z.object({ reason: safeText(1000).optional() }).strict();
export const remainderBody = z
  .object({ vehiclesRequired: z.number().int().min(1).max(200).optional(), remainderClosesAt: isoTimestamp.nullable().optional() })
  .strict()
  .refine((b) => b.vehiclesRequired !== undefined || b.remainderClosesAt !== undefined, { message: 'vehiclesRequired or remainderClosesAt is required' });

const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const listTripRequestsQuery = offsetPagination.extend({
  status: z.enum(TRIP_REQUEST_STATUS).optional(),
  transportType: z.enum(TRANSPORT_TYPE).optional(),
  vehicleCategoryId: uuid.optional(),
  pickupCityId: uuid.optional(),
  allowPartialFulfilment: boolQuery,
  hasOpenRemainder: boolQuery,
  dateFrom: isoTimestamp.optional(),
  dateTo: isoTimestamp.optional(),
  q: safeText(40).optional(),
});

export const listOpportunitiesQuery = offsetPagination.extend({
  transportType: z.enum(TRANSPORT_TYPE).optional(),
  vehicleCategoryId: uuid.optional(),
  pickupCityId: uuid.optional(),
  pickupFrom: isoTimestamp.optional(),
  pickupTo: isoTimestamp.optional(),
  hasBid: boolQuery,
  closingWithinHours: z.coerce.number().int().min(1).max(720).optional(),
  includeDismissed: boolQuery,
});

export const dismissQuery = z.object({ undo: boolQuery });
