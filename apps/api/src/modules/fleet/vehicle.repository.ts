import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Vehicles, calendar entries and driver assignments (database.md §7). OWN scope = the acting
 * owner's fleet; `vehicles.read_any` (GLOBAL) sees all. PARTY scope (a customer reading the
 * vehicle on their booking) is added with bookings in Phase 8.
 */

export const vehicleSelect = {
  id: true, ownerProfileId: true, vehicleCategoryId: true, vehicleMakeId: true, vehicleModelId: true, modelYear: true, plateNumberEn: true, plateNumberAr: true,
  sequenceNumber: true, registrationNumber: true, vin: true, colorCode: true, passengerCapacity: true, payloadCapacityKg: true, cargoVolumeM3: true, cargoLengthCm: true,
  cargoWidthCm: true, cargoHeightCm: true, bodyType: true, hasRefrigeration: true, hasTailLift: true, approvalStatus: true, lifecycleStatus: true, operationalStatus: true,
  approvedByUserId: true, approvedAt: true, rejectionReason: true, insurancePolicyNumber: true, insuranceExpiryDate: true, registrationExpiryDate: true, inspectionExpiryDate: true,
  odometerKm: true, baseCityId: true, notes: true, ratingAvg: true, ratingCount: true, createdAt: true, updatedAt: true, deletedAt: true,
  category: { select: { id: true, code: true, nameEn: true, nameAr: true, transportType: true, minPassengerCapacity: true, maxPassengerCapacity: true, minPayloadKg: true, maxPayloadKg: true } },
  make: { select: { id: true, name: true } },
  model: { select: { id: true, name: true } },
  ownerProfile: { select: { onboardingStatus: true, isPlatformFleet: true } },
  driverAssignments: { where: { assignedTo: null }, select: { id: true, driverProfileId: true, isPrimary: true, assignedFrom: true, driverProfile: { select: { user: { select: { fullNameEn: true } } } } }, orderBy: { assignedFrom: 'desc' } },
} satisfies Prisma.VehicleSelect;

export type VehicleRow = Prisma.VehicleGetPayload<{ select: typeof vehicleSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.VehicleWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  return { ownerProfileId: scope.actor.ownerProfileId ?? '00000000-0000-0000-0000-000000000000' };
}

export async function findVehicle(scope: AnyScope, id: string): Promise<VehicleRow | null> {
  return prisma().vehicle.findFirst({ where: { AND: [{ id }, scopeWhere(scope)], deletedAt: null }, select: vehicleSelect });
}

export interface VehicleFilters {
  approvalStatus?: string | undefined;
  lifecycleStatus?: string | undefined;
  operationalStatus?: string | undefined;
  vehicleCategoryId?: string | undefined;
  baseCityId?: string | undefined;
  ownerProfileId?: string | undefined;
  documentsExpiringWithinDays?: number | undefined;
  q?: string | undefined;
}

export async function listVehicles(scope: AnyScope, f: VehicleFilters, page: { page: number; pageSize: number }): Promise<{ items: VehicleRow[]; total: number }> {
  const where: Prisma.VehicleWhereInput = {
    ...scopeWhere(scope),
    deletedAt: null,
    ...(f.approvalStatus ? { approvalStatus: f.approvalStatus as VehicleRow['approvalStatus'] } : {}),
    ...(f.lifecycleStatus ? { lifecycleStatus: f.lifecycleStatus as VehicleRow['lifecycleStatus'] } : {}),
    ...(f.operationalStatus ? { operationalStatus: f.operationalStatus as VehicleRow['operationalStatus'] } : {}),
    ...(f.vehicleCategoryId ? { vehicleCategoryId: f.vehicleCategoryId } : {}),
    ...(f.baseCityId ? { baseCityId: f.baseCityId } : {}),
    ...(f.ownerProfileId ? { ownerProfileId: f.ownerProfileId } : {}),
    ...(f.documentsExpiringWithinDays
      ? { documents: { some: { deletedAt: null, verificationStatus: 'VERIFIED', expiryDate: { lte: new Date(Date.now() + f.documentsExpiringWithinDays * 86_400_000) } } } }
      : {}),
    ...(f.q ? { OR: [{ plateNumberEn: { contains: f.q.replace(/\s+/g, ''), mode: 'insensitive' } }, { plateNumberEn: { contains: f.q, mode: 'insensitive' } }, { registrationNumber: { contains: f.q, mode: 'insensitive' } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma().vehicle.findMany({ where, select: vehicleSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().vehicle.count({ where }),
  ]);
  return { items, total };
}

// ── calendar (tstzrange is Prisma-Unsupported: raw SQL, parameterised) ────────

export interface CalendarRow {
  id: string;
  entry_type: string;
  status: string;
  period_from: Date;
  period_to: Date;
  booking_id: string | null;
  booking_number: string | null;
  maintenance_record_id: string | null;
  notes: string | null;
  created_at: Date;
}

/** Non-released entries overlapping [from, to). The vehicle must already be in scope (caller checks). */
export async function listCalendar(_scope: AnyScope, vehicleId: string, from: Date, to: Date): Promise<CalendarRow[]> {
  return prisma().$queryRaw<CalendarRow[]>`
    SELECT e.id, e.entry_type::text AS entry_type, e.status::text AS status,
           lower(e.period) AS period_from, upper(e.period) AS period_to,
           e.booking_id, b.booking_number, e.maintenance_record_id, e.notes, e.created_at
    FROM vehicle_calendar_entries e
    LEFT JOIN bookings b ON b.id = e.booking_id
    WHERE e.vehicle_id = ${vehicleId}::uuid
      AND e.status <> 'RELEASED'
      AND e.period && tstzrange(${from}, ${to}, '[)')
    ORDER BY lower(e.period)`;
}

/**
 * Inserts an OWNER_BLOCK. The EXCLUDE constraint (ex_vehicle_calendar_no_overlap) is the
 * guarantee: an overlap raises 23P01, which the service maps to VEHICLE_CALENDAR_CONFLICT.
 */
export async function insertOwnerBlock(_scope: AnyScope, input: { id: string; vehicleId: string; from: Date; to: Date; createdByUserId: string; notes: string | null }, tx: Prisma.TransactionClient | null = null): Promise<void> {
  const db = tx ?? prisma();
  await db.$executeRaw`
    INSERT INTO vehicle_calendar_entries (id, vehicle_id, entry_type, period, status, created_by_user_id, notes, updated_at)
    VALUES (${input.id}::uuid, ${input.vehicleId}::uuid, 'OWNER_BLOCK', tstzrange(${input.from}, ${input.to}, '[)'), 'CONFIRMED', ${input.createdByUserId}::uuid, ${input.notes}, now())`;
}

export async function findCalendarEntry(_scope: AnyScope, vehicleId: string, entryId: string): Promise<CalendarRow | null> {
  const rows = await prisma().$queryRaw<CalendarRow[]>`
    SELECT e.id, e.entry_type::text AS entry_type, e.status::text AS status, lower(e.period) AS period_from, upper(e.period) AS period_to,
           e.booking_id, NULL::text AS booking_number, e.maintenance_record_id, e.notes, e.created_at
    FROM vehicle_calendar_entries e WHERE e.id = ${entryId}::uuid AND e.vehicle_id = ${vehicleId}::uuid`;
  return rows[0] ?? null;
}

export async function releaseCalendarEntry(_scope: AnyScope, entryId: string): Promise<void> {
  await prisma().vehicleCalendarEntry.update({ where: { id: entryId }, data: { status: 'RELEASED' } });
}

// ── driver assignments ────────────────────────────────────────────────────────

export const assignmentSelect = {
  id: true, vehicleId: true, driverProfileId: true, isPrimary: true, assignedFrom: true, assignedTo: true, unassignedReason: true, assignedByUserId: true,
  driverProfile: { select: { user: { select: { fullNameEn: true } } } },
} satisfies Prisma.VehicleDriverAssignmentSelect;
export type AssignmentRow = Prisma.VehicleDriverAssignmentGetPayload<{ select: typeof assignmentSelect }>;

export async function listAssignments(_scope: AnyScope, vehicleId: string): Promise<AssignmentRow[]> {
  return prisma().vehicleDriverAssignment.findMany({ where: { vehicleId }, select: assignmentSelect, orderBy: { assignedFrom: 'desc' } });
}

export async function findAssignment(_scope: AnyScope, vehicleId: string, assignmentId: string): Promise<AssignmentRow | null> {
  return prisma().vehicleDriverAssignment.findFirst({ where: { id: assignmentId, vehicleId }, select: assignmentSelect });
}

/** Future or live reservations — what blocks a soft delete (api.md §8.8). */
export async function countFutureReservations(_scope: AnyScope, vehicleId: string): Promise<number> {
  const rows = await prisma().$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM vehicle_calendar_entries
    WHERE vehicle_id = ${vehicleId}::uuid AND entry_type = 'RESERVATION' AND status <> 'RELEASED' AND upper(period) > now()`;
  return Number(rows[0]?.n ?? 0);
}
