import { z } from 'zod';
import { MAINTENANCE_KIND, MAINTENANCE_STATUS } from '@unigate/types';
import { isoDate, isoTimestamp, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/** Maintenance schemas (api.md §8.23). Windows are half-open [scheduledStartAt, scheduledEndAt). */

const decimalString = z.string().regex(/^\d{1,12}\.\d{2}$/, 'must be a non-negative decimal string with exactly 2 fraction digits');
const part = z.object({ name: safeText(120).pipe(z.string().min(1)), quantity: z.number().int().min(1).max(1000).default(1), amount: decimalString.nullable().optional() }).strict();
const window = { scheduledStartAt: isoTimestamp, scheduledEndAt: isoTimestamp };
const refineWindow = (b: { scheduledStartAt?: string | undefined; scheduledEndAt?: string | undefined }, ctx: z.RefinementCtx) => {
  if (b.scheduledStartAt && b.scheduledEndAt && b.scheduledEndAt <= b.scheduledStartAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledEndAt'], message: 'must be after scheduledStartAt' });
};

const recordCore = z.object({
  vehicleId: uuid,
  maintenanceServiceTypeId: uuid,
  maintenanceKind: z.enum(MAINTENANCE_KIND),
  /** PLANNED (default) or IN_PROGRESS — both hold the vehicle on its calendar. */
  status: z.enum(['PLANNED', 'IN_PROGRESS']).default('PLANNED'),
  ...window,
  odometerKm: z.number().int().min(0).max(9_999_999).optional(),
  costAmount: decimalString.default('0.00'),
  vatAmount: decimalString.default('0.00'),
  workshopName: safeText(160).nullable().optional(),
  workshopContact: safeText(160).nullable().optional(),
  description: safeText(2000).nullable().optional(),
  partsReplaced: z.array(part).max(100).default([]),
  nextServiceDate: isoDate.nullable().optional(),
  nextServiceOdometerKm: z.number().int().min(0).max(9_999_999).nullable().optional(),
  documentIds: z.array(uuid).max(20).default([]),
});
export const createMaintenanceRecordBody = recordCore.strict().superRefine(refineWindow);
export const patchMaintenanceRecordBody = recordCore.omit({ vehicleId: true, status: true, documentIds: true }).partial().strict().superRefine(refineWindow);
export const completeMaintenanceRecordBody = z
  .object({
    actualEndAt: isoTimestamp.optional(),
    odometerKm: z.number().int().min(0).max(9_999_999).optional(),
    costAmount: decimalString.optional(),
    vatAmount: decimalString.optional(),
    partsReplaced: z.array(part).max(100).optional(),
    nextServiceDate: isoDate.nullable().optional(),
    nextServiceOdometerKm: z.number().int().min(0).max(9_999_999).nullable().optional(),
    /** Book the cost as a MAINTENANCE expense of the owner (default true when the total is above zero). */
    recordExpense: z.boolean().default(true),
    notes: safeText(1000).optional(),
  })
  .strict();
export const cancelMaintenanceRecordBody = z.object({ reason: safeText(500).pipe(z.string().min(3)) }).strict();
export const listMaintenanceRecordsQuery = offsetPagination
  .extend({
    vehicleId: uuid.optional(), ownerProfileId: uuid.optional(), maintenanceKind: z.enum(MAINTENANCE_KIND).optional(), status: z.enum(MAINTENANCE_STATUS).optional(), serviceTypeId: uuid.optional(),
    dateFrom: isoTimestamp.optional(), dateTo: isoTimestamp.optional(), workshopName: safeText(160).optional(),
  })
  .strict();

const scheduleCore = z.object({
  vehicleId: uuid,
  maintenanceServiceTypeId: uuid,
  intervalKm: z.number().int().min(100).max(1_000_000).nullable().optional(),
  intervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  lastServiceAt: isoTimestamp.nullable().optional(),
  lastServiceOdometerKm: z.number().int().min(0).max(9_999_999).nullable().optional(),
  isActive: z.boolean().default(true),
});
const refineSchedule = (s: { intervalKm?: number | null | undefined; intervalDays?: number | null | undefined }, ctx: z.RefinementCtx) => {
  if (s.intervalKm === undefined && s.intervalDays === undefined) return;
  if (!s.intervalKm && !s.intervalDays) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intervalDays'], message: 'an interval in km or days is required' });
};
export const createMaintenanceScheduleBody = scheduleCore.strict().superRefine(refineSchedule);
export const patchMaintenanceScheduleBody = scheduleCore.omit({ vehicleId: true }).partial().strict().superRefine(refineSchedule);
export const listMaintenanceSchedulesQuery = offsetPagination.extend({ vehicleId: uuid.optional(), ownerProfileId: uuid.optional(), isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() }).strict();
export const maintenanceDueQuery = z
  .object({ ownerProfileId: uuid.optional(), vehicleId: uuid.optional(), withinDays: z.coerce.number().int().min(0).max(365).default(30), withinKm: z.coerce.number().int().min(0).max(100_000).default(1000), overdueOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional() })
  .strict();
