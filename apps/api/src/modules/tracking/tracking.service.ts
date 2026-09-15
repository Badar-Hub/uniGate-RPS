import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, TrackingBatchResultDto, TrackingHistoryPointDto, TrackingPingResultDto, TrackingPositionDto, TripTrackingDto, VehicleLivePositionDto } from '@unigate/types';
import type { trackingPingBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, NotFoundError, RateLimitError, isAppError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { money, toMoneyString } from '@/common/money.js';
import { hit } from '@/common/throttle.js';
import { config } from '@/config/index.js';
import { prisma } from '@/database/prisma.js';
import { redis } from '@/database/redis.js';
import { mapsProvider } from '@/integrations/maps/maps.provider.js';
import { logger } from '@/logging/logger.js';
import { canTrackTrip, tripRowFor } from '@/modules/trips/trip.service.js';
import { emitToRoom } from '@/realtime/hub.js';
import * as repo from './tracking.repository.js';

/**
 * Tracking (api.md §8.16, §6.4 `POST /tracking/ping`): the highest-volume path, tiered so 1,000
 * tracked vehicles cost bounded writes — Redis on every ping (60 s TTL, drives the socket
 * fan-out), one upserted row per vehicle, and a *sampled* append to the partitioned history.
 */

const LIVE_TTL_S = 60;
const STALE_AFTER_S = 120;
const FUTURE_TOLERANCE_MS = 60_000;
const REORDER_TOLERANCE_MS = 5 * 60_000;
const SAMPLE_SECONDS = 30;
const SAMPLE_METRES = 50;
const SAMPLE_HEADING_DEG = 30;
const LOW_CONFIDENCE_M = 500;
const PINGS_PER_MINUTE = 30;

const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'tracking', requestId: 'internal' };

interface Live {
  vehicleId: string;
  tripId: string | null;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  headingDeg: number | null;
  speedKmh: number | null;
  recordedAt: string;
  seq: number;
}

function toPosition(l: { latitude: number; longitude: number; accuracyM: number | null; headingDeg: number | null; speedKmh: number | null; recordedAt: Date | string }, now = Date.now()): TrackingPositionDto {
  const at = new Date(l.recordedAt);
  const age = Math.max(0, Math.round((now - at.getTime()) / 1000));
  return { latitude: l.latitude, longitude: l.longitude, headingDeg: l.headingDeg, speedKmh: l.speedKmh, accuracyM: l.accuracyM, recordedAt: at.toISOString(), ageSeconds: age, stale: age > STALE_AFTER_S };
}

async function liveGet(vehicleId: string): Promise<Live | null> {
  try {
    const raw = await redis(config().redisUrl).get(`loc:${vehicleId}`);
    return raw ? (JSON.parse(raw) as Live) : null;
  } catch (e) {
    logger().warn({ err: e }, 'tracking: redis read failed; falling back to the database mirror');
    return null;
  }
}

async function liveSet(l: Live): Promise<void> {
  try {
    await redis(config().redisUrl).set(`loc:${l.vehicleId}`, JSON.stringify(l), 'EX', LIVE_TTL_S);
  } catch (e) {
    logger().warn({ err: e }, 'tracking: redis write failed; the database mirror still has the position');
  }
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** The last known position of a vehicle: Redis first, then the database mirror. */
export async function currentPosition(vehicleId: string): Promise<TrackingPositionDto | null> {
  const live = await liveGet(vehicleId);
  if (live) return toPosition(live);
  const row = await repo.findCurrent(systemScope, vehicleId);
  return row ? toPosition({ latitude: row.latitude.toNumber(), longitude: row.longitude.toNumber(), accuracyM: row.accuracyM?.toNumber() ?? null, headingDeg: row.headingDeg?.toNumber() ?? null, speedKmh: row.speedKmh?.toNumber() ?? null, recordedAt: row.recordedAt }) : null;
}

// ── ingestion ────────────────────────────────────────────────────────────────

/** One sample. The scope layer requires the actor to be the trip's assigned driver (404 otherwise). */
export async function ping(scope: ActorScope, body: z.infer<typeof trackingPingBody>): Promise<TrackingPingResultDto> {
  const trip = await tripRowFor({ ...scope, kind: 'PARTY' }, body.tripId);
  if (!trip || scope.actor.driverProfileId === null || trip.driverProfileId !== scope.actor.driverProfileId) throw new NotFoundError();
  const session = await repo.findActiveSession(scope, trip.id);
  if (!session) throw new BusinessRuleError('TRACKING_SESSION_NOT_ACTIVE', 'The trip is not being tracked: it has not reached DRIVER_EN_ROUTE, or it has ended', { tripId: trip.id, status: trip.status });
  // 30 pings/min per trip (api.md §11.1) — a malfunctioning device is bounded, a healthy one never notices.
  const limited = await hit(`track:${trip.id}`, { limit: PINGS_PER_MINUTE, seconds: 60 });
  if (limited.exceeded) throw new RateLimitError(limited.retryAfterSeconds, 'RATE_LIMITED', 'Rate limit exceeded for policy tracking-ping');

  const recordedAt = new Date(body.recordedAt);
  const now = Date.now();
  if (recordedAt.getTime() > now + FUTURE_TOLERANCE_MS) throw new BusinessRuleError('TRACKING_STALE_POINT', 'recordedAt is in the future beyond tolerance', { recordedAt: body.recordedAt });
  const last = await repo.lastPersistedPoint(scope, session.id);
  if (last && recordedAt.getTime() < last.recordedAt.getTime() - REORDER_TOLERANCE_MS) throw new BusinessRuleError('TRACKING_STALE_POINT', 'Sample is older than the last persisted point beyond the reorder tolerance', { recordedAt: body.recordedAt, lastPersistedAt: last.recordedAt.toISOString() });

  const lowConfidence = (body.accuracyM ?? 0) > LOW_CONFIDENCE_M;
  const prev = await liveGet(trip.vehicleId);
  const seq = (prev?.seq ?? 0) + 1;
  const live: Live = { vehicleId: trip.vehicleId, tripId: trip.id, latitude: body.latitude, longitude: body.longitude, accuracyM: body.accuracyM ?? null, headingDeg: body.headingDeg ?? null, speedKmh: body.speedKmh ?? null, recordedAt: recordedAt.toISOString(), seq };
  await liveSet(live);
  await repo.upsertCurrent(scope, { vehicleId: trip.vehicleId, latitude: body.latitude, longitude: body.longitude, accuracyM: body.accuracyM ?? null, headingDeg: body.headingDeg ?? null, speedKmh: body.speedKmh ?? null, source: body.source, tripId: trip.id, recordedAt });

  // Sampled history: ≥30 s elapsed, ≥50 m moved, or heading changed >30° since the last persisted point.
  let persisted = false;
  const moved = last ? haversineM(last.latitude.toNumber(), last.longitude.toNumber(), body.latitude, body.longitude) : Infinity;
  const elapsed = last ? recordedAt.getTime() - last.recordedAt.getTime() : Infinity;
  const turned = last?.headingDeg !== null && last?.headingDeg !== undefined && body.headingDeg !== undefined ? Math.abs(((body.headingDeg - last.headingDeg.toNumber() + 540) % 360) - 180) : 0;
  if (!last || elapsed >= SAMPLE_SECONDS * 1000 || moved >= SAMPLE_METRES || turned > SAMPLE_HEADING_DEG) {
    if (recordedAt.getTime() > (last?.recordedAt.getTime() ?? 0)) {
      await repo.insertPoint(scope, { id: newId(), trackingSessionId: session.id, vehicleId: trip.vehicleId, latitude: body.latitude, longitude: body.longitude, accuracyM: body.accuracyM ?? null, headingDeg: body.headingDeg ?? null, speedKmh: body.speedKmh ?? null, recordedAt });
      persisted = true;
    }
  }
  emitToRoom(`trip:${trip.id}`, 'trip.location', { tripId: trip.id, latitude: body.latitude, longitude: body.longitude, headingDeg: body.headingDeg ?? null, speedKmh: body.speedKmh ?? null, accuracyM: body.accuracyM ?? null, recordedAt: recordedAt.toISOString(), stale: false });
  return { accepted: true, persisted, sequence: seq, lowConfidence };
}

/** Up to 200 buffered samples; per-item results so one bad sample does not reject the rest. */
export async function pingBatch(scope: ActorScope, points: z.infer<typeof trackingPingBody>[]): Promise<TrackingBatchResultDto> {
  const results: TrackingBatchResultDto['results'] = [];
  let acceptedCount = 0;
  const ordered = points.map((p, index) => ({ p, index })).sort((a, b) => new Date(a.p.recordedAt).getTime() - new Date(b.p.recordedAt).getTime());
  for (const { p, index } of ordered) {
    try {
      const r = await ping(scope, p);
      results.push({ index, ...r });
      acceptedCount++;
    } catch (e) {
      results.push({ index, accepted: false, code: isAppError(e) ? e.code : 'INTERNAL_ERROR' });
    }
  }
  results.sort((a, b) => a.index - b.index);
  return { results, acceptedCount };
}

// ── sessions (called by the trip lifecycle) ──────────────────────────────────

export async function openTrackingSession(scope: AnyScope, trip: { id: string; vehicleId: string; driverProfileId: string | null }, tx: Prisma.TransactionClient): Promise<string> {
  const existing = await repo.findActiveSession(scope, trip.id, tx);
  if (existing) return existing.id;
  const id = newId();
  await repo.openSession(scope, { id, tripId: trip.id, vehicleId: trip.vehicleId, driverProfileId: trip.driverProfileId, providerCode: 'DRIVER_APP' }, tx);
  return id;
}

export async function closeTrackingSession(scope: AnyScope, tripId: string, status: 'ENDED' | 'INTERRUPTED', tx: Prisma.TransactionClient): Promise<{ pointCount: number; totalDistanceKm: string } | null> {
  const s = await repo.findActiveSession(scope, tripId, tx);
  if (!s) return null;
  return repo.closeSession(scope, s.id, status, tx);
}

/** POST /tracking/sessions/{id}/end — the driver's app or ops closes a session explicitly. */
export async function endSession(scope: ActorScope, sessionId: string, reason: 'ENDED' | 'INTERRUPTED') {
  const s = await repo.findSession(scope, sessionId);
  if (!s) throw new NotFoundError();
  const trip = await tripRowFor(scope.kind === 'GLOBAL' ? scope : { ...scope, kind: 'PARTY' }, s.tripId);
  if (!trip) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && trip.driverProfileId !== scope.actor.driverProfileId) throw new NotFoundError();
  if (s.status !== 'ACTIVE') return sessionDto({ ...s });
  const r = await prisma().$transaction((tx) => repo.closeSession(scope, s.id, reason, tx));
  return sessionDto({ ...s, status: reason, endedAt: new Date(), pointCount: r.pointCount, totalDistanceKm: money(r.totalDistanceKm) });
}

function sessionDto(s: { id: string; tripId: string; vehicleId: string; driverProfileId: string | null; providerCode: string; status: string; startedAt: Date; endedAt: Date | null; pointCount: number; totalDistanceKm: { toString(): string } }) {
  return { id: s.id, tripId: s.tripId, vehicleId: s.vehicleId, driverProfileId: s.driverProfileId, providerCode: s.providerCode, status: s.status, startedAt: s.startedAt.toISOString(), endedAt: s.endedAt ? s.endedAt.toISOString() : null, pointCount: s.pointCount, totalDistanceKm: toMoneyString(s.totalDistanceKm.toString()) };
}

// ── reads ────────────────────────────────────────────────────────────────────

/** GET /tracking/trips/{id} — the customer's live read; the same predicate the socket room uses. */
export async function trackTrip(scope: ActorScope, tripId: string): Promise<{ dto: TripTrackingDto; degraded: string[] }> {
  const trip = await canTrackTrip(scope, tripId);
  if (!trip) throw new NotFoundError();
  const position = await currentPosition(trip.vehicleId);
  const degraded: string[] = [];
  let eta: TripTrackingDto['eta'] = null;
  if (position && !position.stale && (position.accuracyM ?? 0) <= LOW_CONFIDENCE_M && trip.active) {
    try {
      const est = await mapsProvider().route({ lat: position.latitude, lng: position.longitude }, { lat: trip.dropoff.latitude, lng: trip.dropoff.longitude });
      if (est) eta = { arrivalAt: new Date(Date.now() + est.durationMinutes * 60_000).toISOString(), remainingDistanceKm: toMoneyString(est.distanceKm), confidence: mapsProvider().code === 'estimate' ? 'LOW' : 'MEDIUM' };
      else degraded.push('maps');
    } catch {
      degraded.push('maps');
    }
  }
  // The counterparty's phone is not a permanent entitlement: the customer sees it only while the trip is active.
  const showPhone = trip.active && scope.kind !== 'GLOBAL' && scope.actor.customerProfileId === trip.customerProfileId;
  return {
    dto: {
      tripId: trip.id, tripStatus: trip.status, bookingNumber: trip.bookingNumber, position,
      vehicle: trip.vehicle, driver: trip.driver ? { fullNameEn: trip.driver.fullNameEn, phoneE164: showPhone ? trip.driver.phoneE164 : null, ratingAvg: trip.driver.ratingAvg } : null,
      pickup: trip.pickup, destination: trip.dropoff, eta, socket: { namespace: '/rt', room: `trip:${trip.id}` },
    },
    degraded,
  };
}

export async function tripHistory(scope: ActorScope, tripId: string, q: { cursor?: string | undefined; limit: number; from?: string | undefined; to?: string | undefined }): Promise<{ items: TrackingHistoryPointDto[]; nextCursor: string | null }> {
  const trip = await canTrackTrip(scope, tripId);
  if (!trip) throw new NotFoundError();
  const { items, nextCursor } = await repo.listPoints(scope, tripId, q);
  return { items: items.map((p) => ({ latitude: p.latitude.toNumber(), longitude: p.longitude.toNumber(), headingDeg: p.headingDeg?.toNumber() ?? null, speedKmh: p.speedKmh?.toNumber() ?? null, accuracyM: p.accuracyM?.toNumber() ?? null, recordedAt: p.recordedAt.toISOString() })), nextCursor };
}

/** GET /tracking/vehicles/{id} — ops/fleet only (tracking.read_any). */
export async function vehiclePosition(_scope: ActorScope, vehicleId: string): Promise<VehicleLivePositionDto> {
  const row = await prisma().currentVehicleLocation.findUnique({ where: { vehicleId }, include: { vehicle: { select: { plateNumberEn: true, ownerProfileId: true, operationalStatus: true } } } });
  if (!row) throw new NotFoundError();
  const position = (await currentPosition(vehicleId)) ?? toPosition({ latitude: row.latitude.toNumber(), longitude: row.longitude.toNumber(), accuracyM: row.accuracyM?.toNumber() ?? null, headingDeg: row.headingDeg?.toNumber() ?? null, speedKmh: row.speedKmh?.toNumber() ?? null, recordedAt: row.recordedAt });
  return { vehicleId, plateNumberEn: row.vehicle.plateNumberEn, ownerProfileId: row.vehicle.ownerProfileId, operationalStatus: row.vehicle.operationalStatus, tripId: row.tripId, position };
}

/** GET /tracking/vehicles — the fleet live map, served from the mirror. */
export async function fleetPositions(scope: ActorScope, f: repo.FleetFilters): Promise<VehicleLivePositionDto[]> {
  const rows = await repo.listFleet(scope, f);
  return rows.map((row) => ({ vehicleId: row.vehicleId, plateNumberEn: row.vehicle.plateNumberEn, ownerProfileId: row.vehicle.ownerProfileId, operationalStatus: row.vehicle.operationalStatus, tripId: row.tripId, position: toPosition({ latitude: row.latitude.toNumber(), longitude: row.longitude.toNumber(), accuracyM: row.accuracyM?.toNumber() ?? null, headingDeg: row.headingDeg?.toNumber() ?? null, speedKmh: row.speedKmh?.toNumber() ?? null, recordedAt: row.recordedAt }) }));
}
