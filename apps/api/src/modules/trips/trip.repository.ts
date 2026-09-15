import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Trips (database.md §11.1). Scope:
 *   OWN    — the driver's assigned trips; the owner's fleet trips; the customer's own trips
 *   PARTY  — same three parties (a trip has no wider party set)
 *   GLOBAL — trips.read_any / trips.manage
 */

export const tripSelect = {
  id: true, tripNumber: true, bookingId: true, vehicleId: true, driverProfileId: true, transportType: true, status: true, actualStartAt: true, actualEndAt: true, startOdometerKm: true, endOdometerKm: true,
  actualDistanceKm: true, driverNotes: true, customerNotes: true, delayMinutes: true, createdAt: true, updatedAt: true,
  booking: {
    select: {
      bookingNumber: true, status: true, customerProfileId: true, ownerProfileId: true, tripRequestId: true, scheduledStartAt: true, scheduledEndAt: true,
      pickupAddressLine: true, pickupCityId: true, pickupLatitude: true, pickupLongitude: true, dropoffAddressLine: true, dropoffCityId: true, dropoffLatitude: true, dropoffLongitude: true,
      customerProfile: { select: { userId: true } },
    },
  },
  vehicle: { select: { plateNumberEn: true, modelYear: true, colorCode: true, odometerKm: true, ownerProfileId: true, make: { select: { name: true } }, model: { select: { name: true } }, category: { select: { nameEn: true } } } },
  driverProfile: { select: { id: true, ratingAvg: true, user: { select: { fullNameEn: true, phoneE164: true } } } },
  trackingSessions: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 },
} satisfies Prisma.TripSelect;
export type TripRow = Prisma.TripGetPayload<{ select: typeof tripSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.TripWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  const a = scope.actor;
  const or: Prisma.TripWhereInput[] = [];
  if (a.driverProfileId) or.push({ driverProfileId: a.driverProfileId });
  if (a.ownerProfileId) or.push({ booking: { ownerProfileId: a.ownerProfileId } });
  if (a.customerProfileId) or.push({ booking: { customerProfileId: a.customerProfileId } });
  return or.length ? { OR: or } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findTrip(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<TripRow | null> {
  const db = tx ?? prisma();
  return db.trip.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: tripSelect });
}

export interface TripFilters {
  status?: string[] | undefined;
  transportType?: string | undefined;
  vehicleId?: string | undefined;
  driverProfileId?: string | undefined;
  bookingId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  activeOnly?: boolean | undefined;
}

const ACTIVE: TripRow['status'][] = ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'TRIP_STARTED', 'IN_PROGRESS', 'LOADING', 'LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING', 'DELIVERED', 'EXCEPTION'];

export async function listTrips(scope: AnyScope, f: TripFilters, page: { page: number; pageSize: number }): Promise<{ items: TripRow[]; total: number }> {
  const where: Prisma.TripWhereInput = {
    AND: [
      scopeWhere(scope),
      ...(f.status?.length ? [{ status: { in: f.status as TripRow['status'][] } }] : []),
      ...(f.activeOnly ? [{ status: { in: ACTIVE } }] : []),
      ...(f.transportType ? [{ transportType: f.transportType as TripRow['transportType'] }] : []),
      ...(f.vehicleId ? [{ vehicleId: f.vehicleId }] : []),
      ...(f.driverProfileId ? [{ driverProfileId: f.driverProfileId }] : []),
      ...(f.bookingId ? [{ bookingId: f.bookingId }] : []),
      ...(f.dateFrom || f.dateTo ? [{ booking: { scheduledStartAt: { ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}), ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}) } } }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma().trip.findMany({ where, select: tripSelect, orderBy: { booking: { scheduledStartAt: 'asc' } }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().trip.count({ where }),
  ]);
  return { items, total };
}

export async function lockTrip(_scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM trips WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export const historySelect = { id: true, fromStatus: true, toStatus: true, changedByUserId: true, actorType: true, latitude: true, longitude: true, accuracyM: true, note: true, occurredAt: true, recordedAt: true } satisfies Prisma.TripStatusHistorySelect;
export type TripHistoryRow = Prisma.TripStatusHistoryGetPayload<{ select: typeof historySelect }>;

export async function listHistory(scope: AnyScope, tripId: string): Promise<TripHistoryRow[] | null> {
  const t = await prisma().trip.findFirst({ where: { AND: [{ id: tripId }, scopeWhere(scope)] }, select: { id: true } });
  if (!t) return null;
  return prisma().tripStatusHistory.findMany({ where: { tripId }, select: historySelect, orderBy: { occurredAt: 'asc' } });
}

export const proofSelect = { id: true, tripId: true, proofType: true, recipientName: true, recipientIdLast4: true, signatureDocumentId: true, latitude: true, longitude: true, notes: true, capturedByUserId: true, capturedAt: true } satisfies Prisma.TripProofSelect;
export type TripProofRow = Prisma.TripProofGetPayload<{ select: typeof proofSelect }>;

export async function listProofs(scope: AnyScope, tripId: string): Promise<TripProofRow[] | null> {
  const t = await prisma().trip.findFirst({ where: { AND: [{ id: tripId }, scopeWhere(scope)] }, select: { id: true } });
  if (!t) return null;
  return prisma().tripProof.findMany({ where: { tripId }, select: proofSelect, orderBy: { capturedAt: 'asc' } });
}

export async function findProof(_scope: AnyScope, tripId: string, proofId: string, tx: Prisma.TransactionClient | null = null): Promise<TripProofRow | null> {
  const db = tx ?? prisma();
  return db.tripProof.findFirst({ where: { id: proofId, tripId }, select: proofSelect });
}
