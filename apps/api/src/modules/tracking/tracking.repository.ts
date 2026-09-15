import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Tracking (database.md §11.4): three tables, three access patterns. The live position lives in
 * Redis (60 s TTL) mirrored to current_vehicle_locations; history is the sampled, partitioned
 * vehicle_location_points. Scope on reads is decided by the trip (trips.service), not here.
 */

export interface CurrentLocation {
  vehicleId: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  headingDeg: number | null;
  speedKmh: number | null;
  source: 'DRIVER_APP' | 'GPS_DEVICE' | 'EXTERNAL_API';
  tripId: string | null;
  recordedAt: Date;
}

export async function upsertCurrent(_scope: AnyScope, l: CurrentLocation): Promise<void> {
  await prisma().currentVehicleLocation.upsert({
    where: { vehicleId: l.vehicleId },
    create: { vehicleId: l.vehicleId, latitude: l.latitude, longitude: l.longitude, accuracyM: l.accuracyM, headingDeg: l.headingDeg, speedKmh: l.speedKmh, source: l.source, tripId: l.tripId, recordedAt: l.recordedAt },
    update: { latitude: l.latitude, longitude: l.longitude, accuracyM: l.accuracyM, headingDeg: l.headingDeg, speedKmh: l.speedKmh, source: l.source, tripId: l.tripId, recordedAt: l.recordedAt },
  });
}

export async function findCurrent(_scope: AnyScope, vehicleId: string) {
  return prisma().currentVehicleLocation.findUnique({ where: { vehicleId } });
}

export interface FleetFilters {
  ownerProfileId?: string | undefined;
  cityId?: string | undefined;
  operationalStatus?: string | undefined;
  movedWithinMinutes?: number | undefined;
}

export async function listFleet(_scope: AnyScope, f: FleetFilters) {
  return prisma().currentVehicleLocation.findMany({
    where: {
      ...(f.movedWithinMinutes ? { recordedAt: { gte: new Date(Date.now() - f.movedWithinMinutes * 60_000) } } : {}),
      vehicle: {
        deletedAt: null,
        ...(f.ownerProfileId ? { ownerProfileId: f.ownerProfileId } : {}),
        ...(f.cityId ? { baseCityId: f.cityId } : {}),
        ...(f.operationalStatus ? { operationalStatus: f.operationalStatus as 'IDLE' } : {}),
      },
    },
    include: { vehicle: { select: { plateNumberEn: true, ownerProfileId: true, operationalStatus: true } } },
    orderBy: { recordedAt: 'desc' },
    take: 500,
  });
}

// ── sessions ─────────────────────────────────────────────────────────────────

export async function findActiveSession(_scope: AnyScope, tripId: string, tx: Prisma.TransactionClient | null = null) {
  const db = tx ?? prisma();
  return db.trackingSession.findFirst({ where: { tripId, status: 'ACTIVE' }, orderBy: { startedAt: 'desc' } });
}

export async function findSession(_scope: AnyScope, id: string) {
  return prisma().trackingSession.findUnique({ where: { id } });
}

export async function openSession(_scope: AnyScope, input: { id: string; tripId: string; vehicleId: string; driverProfileId: string | null; providerCode: string }, tx: Prisma.TransactionClient): Promise<void> {
  await tx.trackingSession.create({ data: { ...input, status: 'ACTIVE' } });
}

/** Finalises point_count and total_distance_km from the persisted points and closes the session. */
export async function closeSession(_scope: AnyScope, id: string, status: 'ENDED' | 'INTERRUPTED', tx: Prisma.TransactionClient): Promise<{ pointCount: number; totalDistanceKm: string }> {
  const rows = await tx.$queryRaw<{ n: bigint; km: string | null }[]>`
    WITH pts AS (
      SELECT latitude::float8 AS lat, longitude::float8 AS lng,
             lag(latitude::float8) OVER (ORDER BY recorded_at) AS plat, lag(longitude::float8) OVER (ORDER BY recorded_at) AS plng
      FROM vehicle_location_points WHERE tracking_session_id = ${id}::uuid
    )
    SELECT count(*) AS n,
           COALESCE(SUM(CASE WHEN plat IS NULL THEN 0 ELSE 2 * 6371 * asin(sqrt(power(sin(radians(lat - plat) / 2), 2) + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lng - plng) / 2), 2))) END), 0)::numeric(10,2)::text AS km
    FROM pts`;
  const pointCount = Number(rows[0]?.n ?? 0);
  const totalDistanceKm = rows[0]?.km ?? '0.00';
  await tx.trackingSession.update({ where: { id }, data: { status, endedAt: new Date(), pointCount, totalDistanceKm } });
  return { pointCount, totalDistanceKm };
}

// ── points ───────────────────────────────────────────────────────────────────

export async function lastPersistedPoint(_scope: AnyScope, sessionId: string) {
  return prisma().vehicleLocationPoint.findFirst({ where: { trackingSessionId: sessionId }, orderBy: { recordedAt: 'desc' }, select: { latitude: true, longitude: true, headingDeg: true, recordedAt: true } });
}

export async function insertPoint(_scope: AnyScope, p: { id: string; trackingSessionId: string; vehicleId: string; latitude: number; longitude: number; accuracyM: number | null; headingDeg: number | null; speedKmh: number | null; recordedAt: Date }): Promise<void> {
  await prisma().vehicleLocationPoint.create({ data: p });
}

export async function listPoints(_scope: AnyScope, tripId: string, q: { cursor?: string | undefined; limit: number; from?: string | undefined; to?: string | undefined }) {
  const cursorAt = q.cursor ? new Date(Number(q.cursor)) : null;
  const rows = await prisma().vehicleLocationPoint.findMany({
    where: {
      trackingSession: { tripId },
      recordedAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}), ...(cursorAt ? { gt: cursorAt } : {}) },
    },
    orderBy: { recordedAt: 'asc' },
    take: q.limit + 1,
    select: { latitude: true, longitude: true, headingDeg: true, speedKmh: true, accuracyM: true, recordedAt: true },
  });
  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? String(last.recordedAt.getTime()) : null };
}
