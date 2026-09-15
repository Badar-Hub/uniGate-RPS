import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, TripDto, TripProofDto, TripStatusHistoryDto, TripStatusResultDto } from '@unigate/types';
import type { patchTripBody, tripProofBody, tripStatusBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { money } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { applyTripCompleted, applyTripStarted, cancelFromTrip } from '@/modules/bookings/booking.service.js';
import { recordCompletion, recordDispatch } from '@/modules/demand/trip-request.service.js';
import { setOperationalStatus, updateOdometer } from '@/modules/fleet/vehicle.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { setDriverAvailabilityForTrip } from '@/modules/profiles/driver.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { closeTrackingSession, currentPosition, openTrackingSession } from '@/modules/tracking/tracking.service.js';
import { emitToRoom, evictRoom } from '@/realtime/hub.js';
import { verticalFor } from '@/verticals/registry.js';
import type { TripStatusCode } from '@/verticals/plugin.js';
import { toTripDto, toTripHistoryDto, toTripProofDto } from './trips.mapper.js';
import * as repo from './trip.repository.js';

/**
 * Trip execution (api.md §8.15, §6.4 `POST /trips/{id}/status`, database.md §11). One transition
 * endpoint; the legal targets come from the vertical's own map — this module never inspects
 * transport_type. Every transition writes trip_status_history with where it happened.
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
const TERMINAL: TripStatusCode[] = ['COMPLETED', 'CANCELLED'];
const OCCURRED_PAST_MS = 24 * 3_600_000;
const OCCURRED_FUTURE_MS = 15 * 60_000;

function plugin(t: Pick<repo.TripRow, 'transportType'>) {
  return verticalFor(t.transportType).trips;
}
function regulatory(t: Pick<repo.TripRow, 'transportType'>) {
  return verticalFor(t.transportType).regulatory;
}
export function allowedNext(t: Pick<repo.TripRow, 'transportType' | 'status'>): string[] {
  return [...plugin(t).transitions[t.status]];
}
function isActive(t: Pick<repo.TripRow, 'transportType' | 'status'>): boolean {
  return plugin(t).activeStatuses.includes(t.status);
}

/** Party predicate shared with tracking and the socket room (api.md §9.2): customer, owner, assigned driver, or tracking.read_any. */
function isParty(scope: AnyScope, t: repo.TripRow): boolean {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return true;
  const a = scope.actor;
  return a.customerProfileId === t.booking.customerProfileId || a.ownerProfileId === t.booking.ownerProfileId || (a.driverProfileId !== null && a.driverProfileId === t.driverProfileId);
}

async function dto(scope: AnyScope, t: repo.TripRow): Promise<TripDto> {
  const showPhone = isActive(t) && scope.kind !== 'SYSTEM' && scope.kind !== 'GLOBAL' && scope.actor.customerProfileId === t.booking.customerProfileId;
  const position = isParty(scope, t) ? await currentPosition(t.vehicleId) : null;
  return toTripDto(t, allowedNext(t), position, showPhone);
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function getTrip(scope: AnyScope, id: string): Promise<TripDto> {
  const t = await repo.findTrip(scope, id);
  if (!t) throw new NotFoundError();
  return dto(scope, t);
}

export async function listTrips(scope: AnyScope, f: repo.TripFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listTrips(scope, f, page);
  const dtos: TripDto[] = [];
  for (const t of items) dtos.push(await dto(scope, t));
  return { items: dtos, total };
}

export async function listHistory(scope: AnyScope, id: string): Promise<TripStatusHistoryDto[]> {
  const rows = await repo.listHistory(scope, id);
  if (!rows) throw new NotFoundError();
  return rows.map(toTripHistoryDto);
}

// ── cross-module facts (tracking, sockets) ───────────────────────────────────

export async function tripRowFor(scope: AnyScope, id: string): Promise<repo.TripRow | null> {
  return repo.findTrip(scope, id);
}

export interface TrackableTrip {
  id: string;
  status: string;
  active: boolean;
  bookingNumber: string;
  customerProfileId: string;
  vehicleId: string;
  driverProfileId: string | null;
  vehicle: { plateNumberEn: string; description: string; colorCode: string | null };
  driver: { fullNameEn: string; phoneE164: string | null; ratingAvg: string } | null;
  pickup: { latitude: number; longitude: number; addressLine: string };
  dropoff: { latitude: number; longitude: number; addressLine: string };
}

/** The tracking predicate: the trip within scope and the actor a party to it (or tracking.read_any). Null = 404. */
export async function canTrackTrip(scope: AnyScope, id: string): Promise<TrackableTrip | null> {
  const t = await repo.findTrip(scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? scope : { ...scope, kind: 'PARTY' }, id);
  if (!t || !isParty(scope, t)) return null;
  const v = t.vehicle;
  return {
    id: t.id, status: t.status, active: isActive(t), bookingNumber: t.booking.bookingNumber, customerProfileId: t.booking.customerProfileId, vehicleId: t.vehicleId, driverProfileId: t.driverProfileId,
    vehicle: { plateNumberEn: v.plateNumberEn, description: [v.make?.name, v.model?.name, String(v.modelYear), '—', v.category.nameEn].filter(Boolean).join(' '), colorCode: v.colorCode },
    driver: t.driverProfile ? { fullNameEn: t.driverProfile.user.fullNameEn, phoneE164: t.driverProfile.user.phoneE164, ratingAvg: t.driverProfile.ratingAvg.toFixed(2) } : null,
    pickup: { latitude: t.booking.pickupLatitude.toNumber(), longitude: t.booking.pickupLongitude.toNumber(), addressLine: t.booking.pickupAddressLine },
    dropoff: { latitude: t.booking.dropoffLatitude.toNumber(), longitude: t.booking.dropoffLongitude.toNumber(), addressLine: t.booking.dropoffAddressLine },
  };
}

/** Room-join backfill (api.md §9.6). */
export async function tripBackfill(scope: AnyScope, id: string): Promise<{ status: string; allowedNextStatuses: string[]; position: unknown } | null> {
  const t = await canTrackTrip(scope, id);
  if (!t) return null;
  const row = await repo.findTrip(scope.kind === 'GLOBAL' || scope.kind === 'SYSTEM' ? scope : { ...scope, kind: 'PARTY' }, id);
  return { status: t.status, allowedNextStatuses: row ? allowedNext(row) : [], position: await currentPosition(t.vehicleId) };
}

// ── the transition endpoint ──────────────────────────────────────────────────

export async function transitionTrip(scope: ActorScope, id: string, body: z.infer<typeof tripStatusBody>): Promise<TripStatusResultDto> {
  const now = new Date();
  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now;
  if (occurredAt.getTime() > now.getTime() + OCCURRED_FUTURE_MS || occurredAt.getTime() < now.getTime() - OCCURRED_PAST_MS) {
    throw new BusinessRuleError('VALIDATION_FAILED', 'occurredAt is outside the accepted window', { fieldErrors: { occurredAt: ['at most 15 minutes ahead or 24 hours behind server time'] }, formErrors: [] });
  }
  const peek = await repo.findTrip(scope, id);
  if (!peek) throw new NotFoundError();
  // A driver moves their own trip; ops (trips.manage → GLOBAL) may move any. Owners and customers read only.
  if (scope.kind !== 'GLOBAL' && (scope.actor.driverProfileId === null || peek.driverProfileId !== scope.actor.driverProfileId)) throw new NotFoundError();
  const target: TripStatusCode = body.status;
  if (target === 'CANCELLED') throw new BusinessRuleError('TRIP_INVALID_TRANSITION', 'Cancellation is its own operation: POST /trips/{id}/cancel (trips.manage)', { tripId: id, from: peek.status, to: target, allowed: allowedNext(peek).filter((s) => s !== 'CANCELLED') });

  const result = await prisma().$transaction(async (tx) => {
    await repo.lockTrip(scope, id, tx);
    const t = await repo.findTrip(scope, id, tx);
    if (!t) throw new NotFoundError();
    const p = plugin(t);
    if (TERMINAL.includes(t.status)) {
      if (t.status === 'COMPLETED' && target === 'COMPLETED') throw new ConflictError('TRIP_ALREADY_COMPLETED', `Trip ${t.tripNumber} is already completed`);
      throw new BusinessRuleError('TRIP_NOT_ACTIVE', `Trip ${t.tripNumber} is ${t.status}`, { status: t.status });
    }
    const allowed = p.transitions[t.status];
    if (!allowed.includes(target)) throw new BusinessRuleError('TRIP_INVALID_TRANSITION', `A ${t.transportType.toLowerCase()} trip cannot move from ${t.status} to ${target}`, { tripId: id, transportType: t.transportType, from: t.status, to: target, allowed: [...allowed] });
    if (p.odometerRequiredOn.includes(target)) {
      if (body.odometerKm === undefined) throw new BusinessRuleError('TRIP_ODOMETER_REQUIRED', `${target} needs the odometer reading`, { status: target });
      const current = t.vehicle.odometerKm ?? 0;
      const floor = target === p.startStatus ? current : Math.max(current, t.startOdometerKm ?? 0);
      if (body.odometerKm < floor) throw new BusinessRuleError('VALIDATION_FAILED', 'Odometer cannot go backwards', { fieldErrors: { odometerKm: [`must be at least ${floor}`] }, formErrors: [] });
    }
    if (p.proofRequiredOn.includes(target)) {
      const proof = body.proofId ? await repo.findProof(scope, id, body.proofId, tx) : null;
      if (proof?.proofType !== 'DELIVERY_CONFIRMATION') throw new BusinessRuleError('TRIP_PROOF_REQUIRED', `${target} needs a DELIVERY_CONFIRMATION proof`, { status: target });
    }
    if (target === 'DRIVER_EN_ROUTE' && scope.kind !== 'GLOBAL' && (await getSettingValue<boolean>('dispatch.ready_check_required', true)) && t.booking.status === 'DRIVER_ASSIGNED') {
      throw new BusinessRuleError('BOOKING_INVALID_TRANSITION', 'The owner has not marked the booking READY (dispatch.ready_check_required)', { bookingStatus: t.booking.status });
    }

    if (target === 'DRIVER_EN_ROUTE') {
      // The vertical's regulatory gate (goods: the Bayan transport document — OQ-29); ops may still override through trips.manage.
      const verdict = await regulatory(t).beforeDispatch({ tripNumber: t.tripNumber, status: t.status, regulatoryReference: t.regulatoryReference, regulatoryReferenceType: t.regulatoryReferenceType });
      if (!verdict.ok && scope.kind !== 'GLOBAL') throw new BusinessRuleError(verdict.code ?? 'TRIP_REGULATORY_DOCUMENT_REQUIRED', verdict.message ?? 'A regulatory document is required before dispatch', verdict.details);
    }

    const data: Prisma.TripUpdateInput = { status: target };
    const effects: string[] = [];
    if (target === 'DRIVER_EN_ROUTE') {
      await openTrackingSession(scope, { id: t.id, vehicleId: t.vehicleId, driverProfileId: t.driverProfileId }, tx);
      if (t.driverProfileId) await setDriverAvailabilityForTrip(t.driverProfileId, 'ON_TRIP', tx);
      await setOperationalStatus(t.vehicleId, 'ON_TRIP', tx);
      await recordDispatch(scope, t.booking.tripRequestId, tx);
      effects.push('tracking_session_opened', 'vehicle_on_trip', 'driver_on_trip');
    }
    if (target === p.startStatus) {
      data.actualStartAt = occurredAt;
      if (body.odometerKm !== undefined) data.startOdometerKm = body.odometerKm;
      await applyTripStarted(scope, t.bookingId, tx);
      effects.push('booking_in_progress');
    }
    if (body.odometerKm !== undefined && (target === 'DELIVERED' || target === 'COMPLETED')) data.endOdometerKm = body.odometerKm;
    if (target === 'COMPLETED') {
      data.actualEndAt = occurredAt;
      const session = await closeTrackingSession(scope, t.id, 'ENDED', tx);
      const endKm: number | null = body.odometerKm ?? t.endOdometerKm;
      const startKm = t.startOdometerKm;
      const byOdometer = endKm !== null && startKm !== null ? endKm - startKm : null;
      data.actualDistanceKm = money(byOdometer !== null && byOdometer >= 0 ? byOdometer : (session?.totalDistanceKm ?? '0'));
      if (endKm !== null) await updateOdometer(t.vehicleId, endKm, tx);
      await applyTripCompleted(scope, t.bookingId, tx);
      await setOperationalStatus(t.vehicleId, 'IDLE', tx);
      if (t.driverProfileId) await setDriverAvailabilityForTrip(t.driverProfileId, 'AVAILABLE', tx);
      await recordCompletion(scope, t.booking.tripRequestId, tx);
      effects.push('tracking_session_closed', 'booking_completed', 'vehicle_idle', 'driver_available');
    }
    await tx.trip.update({ where: { id }, data });
    await tx.tripStatusHistory.create({ data: { id: newId(), tripId: id, fromStatus: t.status, toStatus: target, changedByUserId: scope.actor.userId, actorType: 'USER', latitude: body.latitude ?? null, longitude: body.longitude ?? null, accuracyM: body.accuracyM ?? null, note: body.note ?? null, occurredAt } });
    await writeAudit({ ...audit(scope), action: 'trip.status_changed', entityType: 'trip', entityId: id, beforeValue: { status: t.status }, afterValue: { status: target, occurredAt: occurredAt.toISOString(), effects, actedFor: scope.kind === 'GLOBAL' ? 'ops' : 'driver' } }, tx);
    await publishEvent('trip', id, 'trip.status', { tripNumber: t.tripNumber, bookingId: t.bookingId, customerProfileId: t.booking.customerProfileId, ownerProfileId: t.booking.ownerProfileId, driverProfileId: t.driverProfileId, status: target, previousStatus: t.status, occurredAt: occurredAt.toISOString() }, tx);
    return { previous: t.status, tripNumber: t.tripNumber, bookingId: t.bookingId, transportType: t.transportType };
  }, { maxWait: 10_000, timeout: 30_000 });

  const after = await repo.findTrip(scope, id);
  if (!after) throw new NotFoundError();
  const next = allowedNext(after);
  emitToRoom(`trip:${id}`, 'trip.status', { tripId: id, bookingId: after.bookingId, status: after.status, previousStatus: result.previous, occurredAt: occurredAt.toISOString(), allowedNextStatuses: next });
  emitToRoom(`booking:${after.bookingId}`, 'trip.status', { tripId: id, bookingId: after.bookingId, status: after.status, previousStatus: result.previous, occurredAt: occurredAt.toISOString(), allowedNextStatuses: next });
  return { id, tripNumber: result.tripNumber, status: after.status, previousStatus: result.previous, transportType: result.transportType, occurredAt: occurredAt.toISOString(), recordedAt: now.toISOString(), allowedNextStatuses: next, booking: { id: after.bookingId, status: after.booking.status } };
}

export async function patchTrip(scope: ActorScope, id: string, body: z.infer<typeof patchTripBody>): Promise<TripDto> {
  const t = await repo.findTrip(scope, id);
  if (!t) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && (scope.actor.driverProfileId === null || t.driverProfileId !== scope.actor.driverProfileId)) throw new NotFoundError();
  if (body.regulatoryReferenceType) {
    const accepted = regulatory(t).referenceTypes;
    const list = accepted.length ? accepted.join(', ') : '—';
    if (!accepted.includes(body.regulatoryReferenceType)) throw new BusinessRuleError('VALIDATION_FAILED', `A ${t.transportType.toLowerCase()} trip accepts regulatory reference types: ${list}`, { fieldErrors: { regulatoryReferenceType: [`one of: ${list}`] }, formErrors: [] });
  }
  await prisma().$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data: { ...(body.driverNotes !== undefined ? { driverNotes: body.driverNotes } : {}), ...(body.customerNotes !== undefined ? { customerNotes: body.customerNotes } : {}), ...(body.startOdometerKm !== undefined ? { startOdometerKm: body.startOdometerKm } : {}), ...(body.endOdometerKm !== undefined ? { endOdometerKm: body.endOdometerKm } : {}), ...(body.regulatoryReference !== undefined ? { regulatoryReference: body.regulatoryReference, regulatoryReferenceType: body.regulatoryReferenceType ?? null } : {}) } });
    await writeAudit({ ...audit(scope), action: 'trip.updated', entityType: 'trip', entityId: id, beforeValue: { driverNotes: t.driverNotes, customerNotes: t.customerNotes, startOdometerKm: t.startOdometerKm, endOdometerKm: t.endOdometerKm, regulatoryReference: t.regulatoryReference }, afterValue: { ...body }, changedFields: Object.keys(body) }, tx);
  });
  return getTrip(scope, id);
}

/** POST /trips/{id}/cancel — ops only: any non-terminal state → CANCELLED, cascading to the booking. */
export async function cancelTrip(scope: ActorScope, id: string, reason: string): Promise<TripDto> {
  const peek = await repo.findTrip(scope, id);
  if (!peek) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    await repo.lockTrip(scope, id, tx);
    const t = await repo.findTrip(scope, id, tx);
    if (!t) throw new NotFoundError();
    if (TERMINAL.includes(t.status)) throw new BusinessRuleError('TRIP_NOT_ACTIVE', `Trip ${t.tripNumber} is ${t.status}`, { status: t.status });
    await closeTrackingSession(scope, id, 'INTERRUPTED', tx);
    await tx.trip.update({ where: { id }, data: { status: 'CANCELLED' } });
    await tx.tripStatusHistory.create({ data: { id: newId(), tripId: id, fromStatus: t.status, toStatus: 'CANCELLED', changedByUserId: scope.actor.userId, actorType: 'USER', note: reason, occurredAt: new Date() } });
    await setOperationalStatus(t.vehicleId, 'IDLE', tx);
    if (t.driverProfileId) await setDriverAvailabilityForTrip(t.driverProfileId, 'AVAILABLE', tx);
    await cancelFromTrip(scope, t.bookingId, reason, tx);
    await writeAudit({ ...audit(scope), action: 'trip.cancelled', entityType: 'trip', entityId: id, severity: 'NOTICE', beforeValue: { status: t.status }, afterValue: { status: 'CANCELLED', reason } }, tx);
    await publishEvent('trip', id, 'trip.cancelled', { tripNumber: t.tripNumber, bookingId: t.bookingId, customerProfileId: t.booking.customerProfileId, ownerProfileId: t.booking.ownerProfileId, driverProfileId: t.driverProfileId, reason }, tx);
  });
  emitToRoom(`trip:${id}`, 'trip.status', { tripId: id, bookingId: peek.bookingId, status: 'CANCELLED', previousStatus: peek.status, occurredAt: new Date().toISOString(), allowedNextStatuses: [] });
  await evictRoom(`trip:${id}`);
  return getTrip(scope, id);
}

// ── proofs ───────────────────────────────────────────────────────────────────

export async function listProofs(scope: AnyScope, id: string): Promise<TripProofDto[]> {
  const rows = await repo.listProofs(scope, id);
  if (!rows) throw new NotFoundError();
  return rows.map(toTripProofDto);
}

export async function addProof(scope: ActorScope, id: string, body: z.infer<typeof tripProofBody>): Promise<TripProofDto> {
  const t = await repo.findTrip(scope, id);
  if (!t) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && (scope.actor.driverProfileId === null || t.driverProfileId !== scope.actor.driverProfileId)) throw new NotFoundError();
  const proofId = newId();
  await prisma().$transaction(async (tx) => {
    await tx.tripProof.create({ data: { id: proofId, tripId: id, proofType: body.proofType, recipientName: body.recipientName ?? null, recipientIdLast4: body.recipientIdLast4 ?? null, signatureDocumentId: body.signatureDocumentId ?? null, latitude: body.latitude ?? null, longitude: body.longitude ?? null, notes: body.notes ?? null, capturedByUserId: scope.actor.userId } });
    if (body.documentIds.length) await tx.document.updateMany({ where: { id: { in: body.documentIds } }, data: { tripProofId: proofId } });
    await writeAudit({ ...audit(scope), action: 'trip.proof_recorded', entityType: 'trip', entityId: id, afterValue: { proofId, proofType: body.proofType, documents: body.documentIds.length } }, tx);
  });
  const row = await repo.findProof(scope, id, proofId);
  if (!row) throw new NotFoundError();
  return toTripProofDto(row);
}
