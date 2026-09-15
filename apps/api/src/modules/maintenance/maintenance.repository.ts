import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Maintenance records and schedules (database.md §13). Scope:
 *   OWN    — rows on the owner's own vehicles
 *   GLOBAL — maintenance.read_any / staff
 */

export const recordSelect = {
  id: true, vehicleId: true, maintenanceServiceTypeId: true, maintenanceKind: true, status: true, scheduledStartAt: true, scheduledEndAt: true, actualStartAt: true, actualEndAt: true, odometerKm: true,
  costAmount: true, vatAmount: true, totalAmount: true, currency: true, workshopName: true, workshopContact: true, description: true, partsReplaced: true, nextServiceDate: true, nextServiceOdometerKm: true, createdByUserId: true, createdAt: true, updatedAt: true,
  vehicle: { select: { plateNumberEn: true, ownerProfileId: true, odometerKm: true, operationalStatus: true } },
  serviceType: { select: { code: true, nameEn: true, nameAr: true } },
  calendarEntry: { select: { id: true, status: true } },
  documents: { select: { id: true } },
} satisfies Prisma.MaintenanceRecordSelect;
export type RecordRow = Prisma.MaintenanceRecordGetPayload<{ select: typeof recordSelect }>;

export const scheduleSelect = {
  id: true, vehicleId: true, maintenanceServiceTypeId: true, intervalKm: true, intervalDays: true, lastServiceAt: true, lastServiceOdometerKm: true, nextDueAt: true, nextDueOdometerKm: true, isActive: true, createdAt: true, updatedAt: true,
  vehicle: { select: { plateNumberEn: true, ownerProfileId: true, odometerKm: true } },
  serviceType: { select: { code: true, nameEn: true, nameAr: true } },
} satisfies Prisma.MaintenanceScheduleSelect;
export type ScheduleRow = Prisma.MaintenanceScheduleGetPayload<{ select: typeof scheduleSelect }>;

function vehicleScope(scope: AnyScope): Prisma.VehicleWhereInput | null {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return null;
  return scope.actor.ownerProfileId ? { ownerProfileId: scope.actor.ownerProfileId } : { id: '00000000-0000-0000-0000-000000000000' };
}
/** Adds the owner scope as a relation filter; SYSTEM/GLOBAL see everything. */
function withScope<T extends Record<string, unknown>>(scope: AnyScope, where: T): T & { vehicle?: Prisma.VehicleWhereInput } {
  const v = vehicleScope(scope);
  return v ? { ...where, vehicle: v } : { ...where };
}

export async function findRecord(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<RecordRow | null> {
  return (tx ?? prisma()).maintenanceRecord.findFirst({ where: withScope(scope, { id }), select: recordSelect });
}

export interface RecordFilters {
  vehicleId?: string | undefined;
  ownerProfileId?: string | undefined;
  maintenanceKind?: string | undefined;
  status?: string | undefined;
  serviceTypeId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  workshopName?: string | undefined;
}

export async function listRecords(scope: AnyScope, f: RecordFilters, page: { page: number; pageSize: number }): Promise<{ items: RecordRow[]; total: number }> {
  const where: Prisma.MaintenanceRecordWhereInput = withScope(scope, {
    AND: [
      ...(f.vehicleId ? [{ vehicleId: f.vehicleId }] : []),
      ...(f.ownerProfileId ? [{ vehicle: { ownerProfileId: f.ownerProfileId } }] : []),
      ...(f.maintenanceKind ? [{ maintenanceKind: f.maintenanceKind as RecordRow['maintenanceKind'] }] : []),
      ...(f.status ? [{ status: f.status as RecordRow['status'] }] : []),
      ...(f.serviceTypeId ? [{ maintenanceServiceTypeId: f.serviceTypeId }] : []),
      ...(f.dateFrom ? [{ scheduledEndAt: { gt: new Date(f.dateFrom) } }] : []),
      ...(f.dateTo ? [{ scheduledStartAt: { lt: new Date(f.dateTo) } }] : []),
      ...(f.workshopName ? [{ workshopName: { contains: f.workshopName, mode: 'insensitive' as const } }] : []),
    ],
  });
  const [items, total] = await Promise.all([
    prisma().maintenanceRecord.findMany({ where, select: recordSelect, orderBy: [{ scheduledStartAt: 'desc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().maintenanceRecord.count({ where }),
  ]);
  return { items, total };
}

export async function lockRecord(_scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM maintenance_records WHERE id = ${id}::uuid FOR UPDATE`;
}

/** The MAINTENANCE calendar entry — the EXCLUDE constraint decides; a 23P01 is the caller's 409. */
export async function insertCalendarHold(_scope: AnyScope, input: { id: string; vehicleId: string; recordId: string; from: Date; to: Date; createdByUserId: string | null; notes: string | null }, tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO vehicle_calendar_entries (id, vehicle_id, entry_type, period, maintenance_record_id, status, created_by_user_id, notes, updated_at)
    VALUES (${input.id}::uuid, ${input.vehicleId}::uuid, 'MAINTENANCE', tstzrange(${input.from}, ${input.to}, '[)'), ${input.recordId}::uuid, 'CONFIRMED', ${input.createdByUserId}::uuid, ${input.notes}, now())`;
}

export async function releaseCalendarHold(_scope: AnyScope, recordId: string, tx: Prisma.TransactionClient): Promise<void> {
  await tx.vehicleCalendarEntry.deleteMany({ where: { maintenanceRecordId: recordId } });
}

// ── schedules ────────────────────────────────────────────────────────────────

export async function findSchedule(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<ScheduleRow | null> {
  return (tx ?? prisma()).maintenanceSchedule.findFirst({ where: withScope(scope, { id }), select: scheduleSelect });
}

export async function listSchedules(scope: AnyScope, f: { vehicleId?: string | undefined; ownerProfileId?: string | undefined; isActive?: boolean | undefined }, page: { page: number; pageSize: number }): Promise<{ items: ScheduleRow[]; total: number }> {
  const where: Prisma.MaintenanceScheduleWhereInput = withScope(scope, {
    AND: [
      ...(f.vehicleId ? [{ vehicleId: f.vehicleId }] : []),
      ...(f.ownerProfileId ? [{ vehicle: { ownerProfileId: f.ownerProfileId } }] : []),
      ...(f.isActive !== undefined ? [{ isActive: f.isActive }] : []),
    ],
  });
  const [items, total] = await Promise.all([
    prisma().maintenanceSchedule.findMany({ where, select: scheduleSelect, orderBy: [{ nextDueAt: 'asc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().maintenanceSchedule.count({ where }),
  ]);
  return { items, total };
}

/** The schedule for (vehicle, service type), if one exists — completion rolls it forward. */
export async function scheduleFor(_scope: AnyScope, vehicleId: string, serviceTypeId: string, tx: Prisma.TransactionClient): Promise<ScheduleRow | null> {
  return tx.maintenanceSchedule.findFirst({ where: { vehicleId, maintenanceServiceTypeId: serviceTypeId, isActive: true }, select: scheduleSelect });
}

/** Active schedules due (by date or by odometer) within the horizon; overdue = already past either threshold. */
export async function listDue(scope: AnyScope, f: { ownerProfileId?: string | undefined; vehicleId?: string | undefined; withinDays: number; withinKm: number }): Promise<ScheduleRow[]> {
  const horizon = new Date(Date.now() + f.withinDays * 86_400_000);
  const rows = await prisma().maintenanceSchedule.findMany({
    where: withScope(scope, {
      isActive: true,
      ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
      ...(f.ownerProfileId ? { vehicle: { ownerProfileId: f.ownerProfileId } } : {}),
      OR: [{ nextDueAt: { lte: horizon } }, { nextDueOdometerKm: { not: null } }],
    }),
    select: scheduleSelect,
    orderBy: [{ nextDueAt: 'asc' }],
  });
  return rows.filter((s) => (s.nextDueAt !== null && s.nextDueAt <= horizon) || (s.nextDueOdometerKm !== null && s.vehicle.odometerKm !== null && s.nextDueOdometerKm - s.vehicle.odometerKm <= f.withinKm));
}
