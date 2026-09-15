import { z } from 'zod';
import { VEHICLE_APPROVAL_STATUS, VEHICLE_LIFECYCLE_STATUS, VEHICLE_OPERATIONAL_STATUS } from '@unigate/types';
import { isoTimestamp, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/** Fleet module schemas (api.md §8.8). Capacity rules per category are enforced in the service. */

/** KSA plates: 1–4 digits + 3 Latin letters (e.g. "1234 ABC"); spaces ignored for uniqueness. */
export const plateNumberEn = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{1,4}\s?[A-Z]{3}$/, 'must be a KSA plate such as 1234 ABC');
export const plateNumberAr = z.string().trim().min(3).max(24);
export const vin = z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'must be a 17-character VIN');

const yearNow = new Date().getUTCFullYear();

export const listVehiclesQuery = offsetPagination.extend({
  approvalStatus: z.enum(VEHICLE_APPROVAL_STATUS).optional(),
  lifecycleStatus: z.enum(VEHICLE_LIFECYCLE_STATUS).optional(),
  operationalStatus: z.enum(VEHICLE_OPERATIONAL_STATUS).optional(),
  vehicleCategoryId: uuid.optional(),
  baseCityId: uuid.optional(),
  ownerProfileId: uuid.optional(),
  documentsExpiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  q: safeText(40).optional(),
});

const capacityFields = {
  passengerCapacity: z.number().int().min(1).max(100).optional(),
  payloadCapacityKg: z.number().positive().max(100_000).optional(),
  cargoVolumeM3: z.number().positive().max(1000).optional(),
  cargoLengthCm: z.number().int().positive().max(3000).optional(),
  cargoWidthCm: z.number().int().positive().max(500).optional(),
  cargoHeightCm: z.number().int().positive().max(500).optional(),
  bodyType: safeText(48).optional(),
  hasRefrigeration: z.boolean().optional(),
  hasTailLift: z.boolean().optional(),
};

export const createVehicleBody = z
  .object({
    vehicleCategoryId: uuid,
    vehicleMakeId: uuid.optional(),
    vehicleModelId: uuid.optional(),
    modelYear: z.number().int().min(1980).max(yearNow + 2),
    plateNumberEn,
    plateNumberAr: plateNumberAr.optional(),
    sequenceNumber: safeText(32).optional(),
    registrationNumber: safeText(64).pipe(z.string().min(3)),
    vin: vin.optional(),
    colorCode: safeText(32).pipe(z.string().min(2)),
    ...capacityFields,
    insurancePolicyNumber: safeText(64).optional(),
    insuranceExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    registrationExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    inspectionExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    odometerKm: z.number().int().min(0).max(5_000_000).optional(),
    baseCityId: uuid.optional(),
    notes: safeText(2000).optional(),
    /** Admin only: register on behalf of an owner; owners always register under themselves. */
    ownerProfileId: uuid.optional(),
  })
  .strict();

export const patchVehicleBody = createVehicleBody
  .omit({ ownerProfileId: true })
  .partial()
  .extend({
    vehicleMakeId: uuid.nullable().optional(),
    vehicleModelId: uuid.nullable().optional(),
    plateNumberAr: plateNumberAr.nullable().optional(),
    vin: vin.nullable().optional(),
    baseCityId: uuid.nullable().optional(),
    notes: safeText(2000).nullable().optional(),
    /** Owner-controlled: ACTIVE ↔ INACTIVE (SUSPENDED/ARCHIVED are admin or system). */
    lifecycleStatus: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });

export const vehicleDecisionBody = z.object({ notes: safeText(1000).optional() }).strict();
export const vehicleRejectBody = z.object({ rejectionReason: safeText(1000).pipe(z.string().min(5)) }).strict();
export const vehicleSuspendBody = z.object({ reason: safeText(1000).pipe(z.string().min(5)) }).strict();

export const calendarWindowQuery = z
  .object({ from: isoTimestamp, to: isoTimestamp })
  .refine((q) => new Date(q.from) < new Date(q.to), { message: 'from must precede to', path: ['to'] });

/** Owner blackout: half-open [from, to). */
export const calendarBlockBody = z
  .object({ from: isoTimestamp, to: isoTimestamp, notes: safeText(500).optional() })
  .strict()
  .refine((b) => new Date(b.from) < new Date(b.to), { message: 'from must precede to', path: ['to'] })
  .refine((b) => new Date(b.to).getTime() - new Date(b.from).getTime() <= 366 * 86_400_000, { message: 'a block cannot exceed one year', path: ['to'] });

export const calendarEntryParams = z.object({ id: uuid, entryId: uuid });

export const assignDriverBody = z.object({ driverProfileId: uuid, isPrimary: z.boolean().default(false) }).strict();
export const assignmentParams = z.object({ id: uuid, assignmentId: uuid });
export const unassignDriverBody = z.object({ reason: safeText(500).optional() }).strict();
