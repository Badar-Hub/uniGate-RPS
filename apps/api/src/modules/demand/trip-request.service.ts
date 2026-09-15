import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, InvitationDto, OpportunityDto, TransportType, TripRequestDto } from '@unigate/types';
import type { createTripRequestBody, patchTripRequestBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ForbiddenError, NotFoundError, NotImplementedError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { money } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { mapsProvider } from '@/integrations/maps/maps.provider.js';
import { logger } from '@/logging/logger.js';
import { dispatchableCandidates, type DispatchableCandidate } from '@/modules/fleet/vehicle.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { verticalFor } from '@/verticals/registry.js';
import { ownerBidOnRequest, ownerHasAcceptedBid, rejectLiveBidsOnRequest } from '@/modules/bidding/bid.service.js';
import { biddingOpen, toInvitationDto, toTripRequestDto } from './demand.mapper.js';
import * as repo from './trip-request.repository.js';

/**
 * Demand (api.md §8.11–§8.12): the request lifecycle and opportunity matching. Everything
 * vertical-specific — detail validation, per-vehicle fit — goes through the VerticalPlugin.
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'demand', requestId: 'internal' };

/** Owners see the redacted projection until an accepted bid of theirs exists (api.md §8.11). */
function isRedactedFor(scope: AnyScope, r: repo.TripRequestRow): boolean {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return false;
  return scope.actor.customerProfileId !== r.customerProfileId;
}

async function dto(scope: AnyScope, r: repo.TripRequestRow): Promise<TripRequestDto> {
  let redacted = isRedactedFor(scope, r);
  if (redacted && scope.kind !== 'SYSTEM' && scope.actor.ownerProfileId && (await ownerHasAcceptedBid(scope, r.id, scope.actor.ownerProfileId))) redacted = false;
  return toTripRequestDto(r, redacted);
}

export async function listTripRequests(scope: AnyScope, filters: repo.TripRequestFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listTripRequests(scope, filters, page);
  const dtos: TripRequestDto[] = [];
  for (const r of items) dtos.push(await dto(scope, r));
  return { items: dtos, total };
}

export async function getTripRequest(scope: AnyScope, id: string): Promise<TripRequestDto> {
  const r = await repo.findTripRequest(scope, id);
  if (!r) throw new NotFoundError();
  return dto(scope, r);
}

/** Default bidding deadline (A-02): min(pickup − close_before, now + max_window), from settings. */
async function defaultBiddingClosesAt(pickupAt: Date, now = new Date()): Promise<Date> {
  const closeBefore = await getSettingValue<number>('bidding.close_before_pickup_hours', 2);
  const maxWindow = await getSettingValue<number>('bidding.max_window_hours', 24);
  const byPickup = pickupAt.getTime() - closeBefore * 3_600_000;
  const byWindow = now.getTime() + maxWindow * 3_600_000;
  return new Date(Math.min(byPickup, byWindow));
}

function assertVerticalEnabled(type: TransportType): void {
  if (!verticalFor(type).enabled) throw new NotImplementedError('VERTICAL_NOT_ENABLED', `${type} requests are not enabled on this platform yet`);
}

async function loadCategory(id: string, transportType: TransportType) {
  const c = await prisma().vehicleCategory.findFirst({ where: { id, isActive: true }, select: { id: true, transportType: true, code: true } });
  if (!c) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown or inactive category', { fieldErrors: { vehicleCategoryId: ['unknown or inactive category'] }, formErrors: [] });
  // Identity comparison of plugins, not a transport_type branch (ADR-010).
  if (verticalFor(c.transportType) !== verticalFor(transportType)) throw new BusinessRuleError('VALIDATION_FAILED', 'Category belongs to another vertical', { fieldErrors: { vehicleCategoryId: [`category ${c.code} is ${c.transportType}`] }, formErrors: [] });
  return c;
}

async function assertCities(...ids: string[]): Promise<void> {
  const rows = await prisma().city.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  const missing = ids.filter((i) => !rows.some((r) => r.id === i));
  if (missing.length) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown city', { fieldErrors: { cityId: missing }, formErrors: [] });
}

/** Exactly one detail block, and it must be the vertical's own (TRIP_REQUEST_DETAIL_MISMATCH). */
function detailFor(body: { transportType: TransportType; passengerDetails?: unknown; goodsDetails?: unknown }): unknown {
  const key = verticalFor(body.transportType).demand.detailKey;
  const present = (['passengerDetails', 'goodsDetails'] as const).filter((k) => body[k] !== undefined);
  if (present.length !== 1 || present[0] !== key) {
    throw new BusinessRuleError('TRIP_REQUEST_DETAIL_MISMATCH', `Exactly one detail block matching ${body.transportType} is required`);
  }
  return body[key];
}

/** The window the vehicle is needed for: pickup → return, or pickup + estimated duration (min 2 h). */
function occupancyWindow(pickupAt: Date, returnAt: Date | null, durationMinutes: number | null): { from: Date; to: Date } {
  const to = returnAt ?? new Date(pickupAt.getTime() + Math.max(120, durationMinutes ?? 0) * 60_000);
  return { from: pickupAt, to };
}

/** POST /trip-requests — create (and optionally publish) with the vertical's detail block. */
export async function createTripRequest(scope: ActorScope, body: z.infer<typeof createTripRequestBody>): Promise<{ dto: TripRequestDto; degraded: string[] }> {
  assertVerticalEnabled(body.transportType);
  const customerProfileId = scope.kind === 'GLOBAL' ? (body.customerProfileId ?? scope.actor.customerProfileId) : scope.actor.customerProfileId;
  if (!customerProfileId) throw new BusinessRuleError('VALIDATION_FAILED', 'A customer profile is required', { fieldErrors: { customerProfileId: ['required'] }, formErrors: [] });
  const customer = await prisma().customerProfile.findFirst({ where: { id: customerProfileId }, select: { id: true, acquiredBySpoId: true, user: { select: { phoneVerifiedAt: true, status: true } } } });
  if (!customer) throw new NotFoundError();
  if (scope.kind !== 'GLOBAL' && !customer.user.phoneVerifiedAt) throw new ForbiddenError('AUTH_PHONE_NOT_VERIFIED', 'Verify your phone number before raising a request');

  const pickupAt = new Date(body.pickupAt);
  const returnAt = body.returnAt ? new Date(body.returnAt) : null;
  const now = new Date();
  if (pickupAt <= now) throw new BusinessRuleError('VALIDATION_FAILED', 'pickupAt must be in the future', { fieldErrors: { pickupAt: ['must be in the future'] }, formErrors: [] });
  const biddingClosesAt = body.biddingClosesAt ? new Date(body.biddingClosesAt) : await defaultBiddingClosesAt(pickupAt, now);
  if (biddingClosesAt <= now) throw new BusinessRuleError('VALIDATION_FAILED', 'biddingClosesAt must be in the future', { fieldErrors: { biddingClosesAt: ['must be in the future — pickup is too soon for the configured bidding window'] }, formErrors: [] });
  const remainderClosesAt = body.remainderClosesAt ? new Date(body.remainderClosesAt) : null;
  if (remainderClosesAt && remainderClosesAt <= biddingClosesAt) throw new BusinessRuleError('VALIDATION_FAILED', 'remainderClosesAt must be after biddingClosesAt', { fieldErrors: { remainderClosesAt: ['must be after biddingClosesAt'] }, formErrors: [] });

  const plugin = verticalFor(body.transportType);
  const details = detailFor(body);
  const check = plugin.demand.validateRequest({ vehiclesRequired: body.vehiclesRequired, tripDirection: body.tripDirection, pickupAt, returnAt }, details);
  if (!check.ok) throw new BusinessRuleError('VALIDATION_FAILED', 'Detail block is invalid', { fieldErrors: check.fieldErrors, formErrors: [] });
  await loadCategory(body.vehicleCategoryId, body.transportType);
  await assertCities(body.pickup.cityId, body.dropoff.cityId);
  const allowPartial = body.vehiclesRequired === 1 ? false : (body.allowPartialFulfilment ?? plugin.demand.partialFulfilmentDefault);

  // Route estimate is a snapshot; a maps outage never blocks demand (meta.degraded).
  const degraded: string[] = [];
  let estimate: { distanceKm: number; durationMinutes: number } | null = null;
  try {
    estimate = await mapsProvider().route({ lat: body.pickup.latitude, lng: body.pickup.longitude }, { lat: body.dropoff.latitude, lng: body.dropoff.longitude });
  } catch (err) {
    logger().warn({ err }, 'maps estimate failed; request created without it');
    degraded.push('maps');
  }

  const id = newId();
  await prisma().$transaction(async (tx) => {
    const requestNumber = await repo.nextRequestNumber(scope, tx);
    await tx.tripRequest.create({
      data: {
        id, requestNumber, customerProfileId, createdByUserId: scope.actor.userId, attributedSpoProfileId: customer.acquiredBySpoId,
        transportType: body.transportType, vehicleCategoryId: body.vehicleCategoryId, vehiclesRequired: body.vehiclesRequired, allowPartialFulfilment: allowPartial, tripDirection: body.tripDirection,
        pickupAddressLine: body.pickup.addressLine, pickupCityId: body.pickup.cityId, pickupLatitude: body.pickup.latitude, pickupLongitude: body.pickup.longitude, pickupPlaceId: body.pickup.placeId ?? null,
        dropoffAddressLine: body.dropoff.addressLine, dropoffCityId: body.dropoff.cityId, dropoffLatitude: body.dropoff.latitude, dropoffLongitude: body.dropoff.longitude, dropoffPlaceId: body.dropoff.placeId ?? null,
        estimatedDistanceKm: estimate ? money(estimate.distanceKm) : null, estimatedDurationMinutes: estimate?.durationMinutes ?? null,
        pickupAt, returnAt, biddingClosesAt, remainderClosesAt, status: 'DRAFT',
        budgetAmount: body.budgetAmount !== undefined ? money(body.budgetAmount) : null, currency: body.currency, specialInstructions: body.specialInstructions ?? null,
        ...(plugin.demand.detailCreate(details) as Pick<Prisma.TripRequestUncheckedCreateInput, 'passengerDetails' | 'goodsDetails'>),
      },
    });
    await writeAudit({ ...audit(scope), action: 'trip_request.created', entityType: 'trip_request', entityId: id, afterValue: { requestNumber, transportType: body.transportType, vehiclesRequired: body.vehiclesRequired, pickupAt: pickupAt.toISOString(), estimate: estimate ?? null } }, tx);
  });
  if (body.publish) await publishTripRequest(scope, id);
  return { dto: await getTripRequest(scope, id), degraded };
}

/** PATCH — DRAFT only. Commercial terms cannot change under live bids. */
export async function patchTripRequest(scope: ActorScope, id: string, body: z.infer<typeof patchTripRequestBody>): Promise<TripRequestDto> {
  const r = await repo.findTripRequest(scope, id);
  if (!r) throw new NotFoundError();
  if (r.status !== 'DRAFT') throw new BusinessRuleError('TRIP_REQUEST_INVALID_TRANSITION', 'Only a draft can be edited; cancel and re-raise a published request', { status: r.status });
  if (isRedactedFor(scope, r)) throw new NotFoundError();
  const pickupAt = body.pickupAt ? new Date(body.pickupAt) : r.pickupAt;
  const returnAt = body.returnAt === undefined ? r.returnAt : body.returnAt ? new Date(body.returnAt) : null;
  const direction = body.tripDirection ?? r.tripDirection;
  const fieldErrors: Record<string, string[]> = {};
  if (pickupAt <= new Date()) fieldErrors['pickupAt'] = ['must be in the future'];
  if (direction === 'ROUND_TRIP' && !returnAt) fieldErrors['returnAt'] = ['required for a round trip'];
  if (returnAt && returnAt <= pickupAt) fieldErrors['returnAt'] = ['must be after pickupAt'];
  if (Object.keys(fieldErrors).length) throw new BusinessRuleError('VALIDATION_FAILED', 'Invalid times', { fieldErrors, formErrors: [] });
  if (body.vehicleCategoryId) await loadCategory(body.vehicleCategoryId, r.transportType);
  if (body.pickup || body.dropoff) await assertCities(...[body.pickup?.cityId, body.dropoff?.cityId].filter((c): c is string => Boolean(c)));
  const plugin = verticalFor(r.transportType);
  const details = body[plugin.demand.detailKey];
  if (details !== undefined) {
    const check = plugin.demand.validateRequest({ vehiclesRequired: body.vehiclesRequired ?? r.vehiclesRequired, tripDirection: direction, pickupAt, returnAt }, details);
    if (!check.ok) throw new BusinessRuleError('VALIDATION_FAILED', 'Detail block is invalid', { fieldErrors: check.fieldErrors, formErrors: [] });
  }
  const biddingClosesAt = body.biddingClosesAt ? new Date(body.biddingClosesAt) : body.pickupAt ? await defaultBiddingClosesAt(pickupAt) : r.biddingClosesAt;
  const vehiclesRequired = body.vehiclesRequired ?? r.vehiclesRequired;
  await prisma().$transaction(async (tx) => {
    await tx.tripRequest.update({
      where: { id },
      data: {
        ...(body.vehicleCategoryId ? { vehicleCategoryId: body.vehicleCategoryId } : {}),
        vehiclesRequired,
        allowPartialFulfilment: vehiclesRequired === 1 ? false : (body.allowPartialFulfilment ?? r.allowPartialFulfilment),
        tripDirection: direction,
        ...(body.pickup ? { pickupAddressLine: body.pickup.addressLine, pickupCityId: body.pickup.cityId, pickupLatitude: body.pickup.latitude, pickupLongitude: body.pickup.longitude, pickupPlaceId: body.pickup.placeId ?? null } : {}),
        ...(body.dropoff ? { dropoffAddressLine: body.dropoff.addressLine, dropoffCityId: body.dropoff.cityId, dropoffLatitude: body.dropoff.latitude, dropoffLongitude: body.dropoff.longitude, dropoffPlaceId: body.dropoff.placeId ?? null } : {}),
        pickupAt, returnAt, biddingClosesAt,
        ...(body.remainderClosesAt !== undefined ? { remainderClosesAt: body.remainderClosesAt ? new Date(body.remainderClosesAt) : null } : {}),
        ...(body.budgetAmount !== undefined ? { budgetAmount: body.budgetAmount ? money(body.budgetAmount) : null } : {}),
        ...(body.specialInstructions !== undefined ? { specialInstructions: body.specialInstructions } : {}),
        ...(details !== undefined ? (plugin.demand.detailUpdate(details) as Pick<Prisma.TripRequestUncheckedUpdateInput, 'passengerDetails' | 'goodsDetails'>) : {}),
      },
    });
    await writeAudit({ ...audit(scope), action: 'trip_request.updated', entityType: 'trip_request', entityId: id, afterValue: { changed: Object.keys(body) }, changedFields: Object.keys(body) }, tx);
  });
  return getTripRequest(scope, id);
}

// ── matching ─────────────────────────────────────────────────────────────────

interface Match {
  candidate: DispatchableCandidate;
  score: number;
  reasons: string[];
}

/** Category ∧ capacity ∧ dispatchable ∧ service area ∧ calendar free — the last three in fleet, the middle in the vertical. */
export async function matchVehicles(r: repo.TripRequestRow): Promise<Match[]> {
  if (!r.vehicleCategoryId) return [];
  const window = occupancyWindow(r.pickupAt, r.returnAt, r.estimatedDurationMinutes);
  const candidates = await dispatchableCandidates({ vehicleCategoryId: r.vehicleCategoryId, pickupCityId: r.pickupCityId, transportType: r.transportType, from: window.from, to: window.to });
  const plugin = verticalFor(r.transportType);
  const details = r[plugin.demand.detailKey];
  const out: Match[] = [];
  for (const c of candidates) {
    const verdict = plugin.demand.matchVehicle(details, { id: c.id, categoryId: c.categoryId, passengerCapacity: c.passengerCapacity, payloadCapacityKg: c.payloadCapacityKg, hasRefrigeration: c.hasRefrigeration, hasTailLift: c.hasTailLift });
    if (verdict.ok) out.push({ candidate: c, score: verdict.score, reasons: ['SERVICE_AREA', 'DISPATCHABLE', 'CALENDAR_FREE', ...verdict.reasons] });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** DRAFT → PUBLISHED: runs the matcher, writes invitations, emits the outbox event — one transaction. */
export async function publishTripRequest(scope: ActorScope, id: string): Promise<TripRequestDto> {
  const r = await repo.findTripRequest(scope, id);
  if (!r) throw new NotFoundError();
  if (isRedactedFor(scope, r)) throw new NotFoundError();
  if (r.status !== 'DRAFT') throw new BusinessRuleError('TRIP_REQUEST_INVALID_TRANSITION', `Only a draft can be published (current: ${r.status})`, { status: r.status });
  assertVerticalEnabled(r.transportType);
  if (r.biddingClosesAt <= new Date()) throw new BusinessRuleError('VALIDATION_FAILED', 'The bidding deadline has already passed; move pickupAt or biddingClosesAt', { fieldErrors: { biddingClosesAt: ['in the past'] }, formErrors: [] });
  const matches = await matchVehicles(r);
  await prisma().$transaction(async (tx) => {
    await tx.tripRequest.update({ where: { id }, data: { status: 'PUBLISHED' } });
    if (matches.length) {
      await tx.tripRequestInvitation.createMany({
        data: matches.map((m) => ({ id: newId(), tripRequestId: id, ownerProfileId: m.candidate.ownerProfileId, vehicleId: m.candidate.id, matchScore: money(m.score), matchReason: { reasons: m.reasons, vehiclePlate: m.candidate.plateNumberEn }, notificationChannels: [] })),
        skipDuplicates: true,
      });
    }
    const owners = [...new Set(matches.map((m) => m.candidate.ownerProfileId))];
    await writeAudit({ ...audit(scope), action: 'trip_request.published', entityType: 'trip_request', entityId: id, afterValue: { invitedOwners: owners.length, invitedVehicles: matches.length } }, tx);
    await publishEvent('trip_request', id, 'trip_request.published', { requestNumber: r.requestNumber, transportType: r.transportType, invitedOwnerProfileIds: owners }, tx);
  });
  return getTripRequest(scope, id);
}

export async function cancelTripRequest(scope: ActorScope, id: string, reason: string): Promise<TripRequestDto> {
  const r = await repo.findTripRequest(scope, id);
  if (!r) throw new NotFoundError();
  if (isRedactedFor(scope, r)) throw new NotFoundError();
  if (!['DRAFT', 'PUBLISHED', 'PARTIALLY_AWARDED'].includes(r.status)) throw new BusinessRuleError('TRIP_REQUEST_INVALID_TRANSITION', `Cannot cancel a request in status ${r.status}`, { status: r.status });
  if (r.vehiclesAwarded > 0) throw new BusinessRuleError('TRIP_REQUEST_INVALID_TRANSITION', 'Bookings have been awarded: cancel them individually or close the remainder', { vehiclesAwarded: r.vehiclesAwarded });
  await prisma().$transaction(async (tx) => {
    await tx.tripRequest.update({ where: { id }, data: { status: 'CANCELLED', cancellationReason: reason } });
    await rejectLiveBidsOnRequest(scope, id, 'request cancelled', tx);
    await writeAudit({ ...audit(scope), action: 'trip_request.cancelled', entityType: 'trip_request', entityId: id, beforeValue: { status: r.status }, afterValue: { status: 'CANCELLED', reason } }, tx);
    await publishEvent('trip_request', id, 'trip_request.cancelled', { requestNumber: r.requestNumber, reason }, tx);
  });
  return getTripRequest(scope, id);
}

/** DELETE — drafts only. */
export async function deleteDraft(scope: ActorScope, id: string): Promise<void> {
  const r = await repo.findTripRequest(scope, id);
  if (!r || isRedactedFor(scope, r)) throw new NotFoundError();
  if (r.status !== 'DRAFT') throw new BusinessRuleError('TRIP_REQUEST_INVALID_TRANSITION', 'Only a draft can be deleted; cancel a published request instead', { status: r.status });
  await prisma().$transaction(async (tx) => {
    await tx.tripRequest.delete({ where: { id } });
    await writeAudit({ ...audit(scope), action: 'trip_request.draft_deleted', entityType: 'trip_request', entityId: id, beforeValue: { requestNumber: r.requestNumber } }, tx);
  });
}

/** PARTIALLY_AWARDED → CLOSED_PARTIAL — only the customer or an admin acting for them (A-45). */
export async function closeRemainder(scope: ActorScope, id: string, reason?: string): Promise<TripRequestDto> {
  const r = await repo.findTripRequest(scope, id);
  if (!r || isRedactedFor(scope, r)) throw new NotFoundError();
  if (r.status !== 'PARTIALLY_AWARDED') throw new BusinessRuleError('TRIP_REQUEST_INVALID_TRANSITION', `Only a partially awarded request has a remainder to close (current: ${r.status})`, { status: r.status });
  await prisma().$transaction(async (tx) => {
    await tx.tripRequest.update({ where: { id }, data: { status: 'CLOSED_PARTIAL', remainderClosesAt: new Date() } });
    await rejectLiveBidsOnRequest(scope, id, 'remainder closed by the customer', tx);
    await writeAudit({ ...audit(scope), action: 'trip_request.remainder_closed', entityType: 'trip_request', entityId: id, severity: 'NOTICE', beforeValue: { vehiclesRequired: r.vehiclesRequired, vehiclesAwarded: r.vehiclesAwarded }, afterValue: { status: 'CLOSED_PARTIAL', reason: reason ?? null, actedFor: scope.kind === 'GLOBAL' ? 'customer' : 'self' } }, tx);
    await publishEvent('trip_request', id, 'trip_request.remainder_closed', { requestNumber: r.requestNumber, unfilled: r.vehiclesRequired - r.vehiclesAwarded }, tx);
  });
  return getTripRequest(scope, id);
}

/** PATCH …/remainder — adjust vehiclesRequired / remainderClosesAt while PARTIALLY_AWARDED. */
export async function adjustRemainder(scope: ActorScope, id: string, body: { vehiclesRequired?: number | undefined; remainderClosesAt?: string | null | undefined }): Promise<TripRequestDto> {
  const r = await repo.findTripRequest(scope, id);
  if (!r || isRedactedFor(scope, r)) throw new NotFoundError();
  if (r.status !== 'PARTIALLY_AWARDED') throw new BusinessRuleError('TRIP_REQUEST_INVALID_TRANSITION', `Remainder can only be adjusted while PARTIALLY_AWARDED (current: ${r.status})`, { status: r.status });
  const required = body.vehiclesRequired ?? r.vehiclesRequired;
  if (required < r.vehiclesAwarded) throw new BusinessRuleError('RULE_VEHICLES_REQUIRED_BELOW_AWARDED', `vehiclesRequired cannot drop below the ${r.vehiclesAwarded} already awarded`, { vehiclesAwarded: r.vehiclesAwarded });
  const nextStatus = required === r.vehiclesAwarded ? 'FULLY_AWARDED' : 'PARTIALLY_AWARDED';
  await prisma().$transaction(async (tx) => {
    await tx.tripRequest.update({ where: { id }, data: { vehiclesRequired: required, status: nextStatus, ...(body.remainderClosesAt !== undefined ? { remainderClosesAt: body.remainderClosesAt ? new Date(body.remainderClosesAt) : null } : {}) } });
    await writeAudit({ ...audit(scope), action: 'trip_request.remainder_adjusted', entityType: 'trip_request', entityId: id, beforeValue: { vehiclesRequired: r.vehiclesRequired, remainderClosesAt: r.remainderClosesAt?.toISOString() ?? null, status: r.status }, afterValue: { vehiclesRequired: required, remainderClosesAt: body.remainderClosesAt ?? r.remainderClosesAt?.toISOString() ?? null, status: nextStatus } }, tx);
  });
  return getTripRequest(scope, id);
}

export async function listInvitations(scope: AnyScope, id: string): Promise<InvitationDto[]> {
  const r = await repo.findTripRequest(scope, id);
  if (!r) throw new NotFoundError();
  return (await repo.listInvitations(scope, id)).map(toInvitationDto);
}

// ── opportunities ────────────────────────────────────────────────────────────

async function toOpportunity(scope: AnyScope, i: repo.OwnerInvitationRow): Promise<OpportunityDto> {
  const request = toTripRequestDto(i.tripRequest, true);
  // The owner's vehicles that fit right now (same predicate the matcher used).
  const matches = scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? [] : (await matchVehicles(i.tripRequest)).filter((m) => m.candidate.ownerProfileId === i.ownerProfileId);
  return {
    id: i.id,
    request,
    matchScore: i.matchScore ? i.matchScore.toFixed(2) : null,
    matchReason: (i.matchReason ?? {}) as Record<string, unknown>,
    viewedAt: i.viewedAt ? i.viewedAt.toISOString() : null,
    dismissedAt: i.dismissedAt ? i.dismissedAt.toISOString() : null,
    eligibleVehicles: matches.map((m) => ({ id: m.candidate.id, plateNumberEn: m.candidate.plateNumberEn, categoryCode: m.candidate.categoryCode, passengerCapacity: m.candidate.passengerCapacity, payloadCapacityKg: m.candidate.payloadCapacityKg ? money(m.candidate.payloadCapacityKg).toFixed(2) as OpportunityDto['eligibleVehicles'][number]['payloadCapacityKg'] : null })),
    ownBidId: scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? null : await ownerBidOnRequest(scope, i.tripRequest.id, i.ownerProfileId),
    createdAt: i.createdAt.toISOString(),
  };
}

export async function listOpportunities(scope: AnyScope, f: repo.OpportunityFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listOpportunities(scope, f, page);
  const dtos: OpportunityDto[] = [];
  for (const i of items) dtos.push(await toOpportunity(scope, i));
  return { items: dtos, total };
}

/** Marks viewed_at on first read. */
export async function getOpportunity(scope: ActorScope, invitationId: string): Promise<OpportunityDto> {
  const i = await repo.findOwnerInvitation(scope, invitationId);
  if (!i) throw new NotFoundError();
  if (!i.viewedAt) await prisma().tripRequestInvitation.update({ where: { id: i.id }, data: { viewedAt: new Date() } });
  return toOpportunity(scope, { ...i, viewedAt: i.viewedAt ?? new Date() });
}

export async function dismissOpportunity(scope: ActorScope, invitationId: string, undo: boolean): Promise<OpportunityDto> {
  const i = await repo.findOwnerInvitation(scope, invitationId);
  if (!i) throw new NotFoundError();
  await prisma().tripRequestInvitation.update({ where: { id: i.id }, data: { dismissedAt: undo ? null : new Date() } });
  const after = await repo.findOwnerInvitation(scope, invitationId);
  if (!after) throw new NotFoundError();
  return toOpportunity(scope, after);
}

// ── jobs ─────────────────────────────────────────────────────────────────────

/** PUBLISHED with the deadline passed and nothing awarded → EXPIRED. Partially awarded orders never expire (A-45). */
export async function expireStaleRequests(): Promise<number> {
  const stale = await prisma().tripRequest.findMany({ where: { status: 'PUBLISHED', vehiclesAwarded: 0, biddingClosesAt: { lt: new Date() } }, select: { id: true, requestNumber: true }, take: 500 });
  for (const r of stale) {
    await prisma().$transaction(async (tx) => {
      await tx.tripRequest.update({ where: { id: r.id }, data: { status: 'EXPIRED' } });
      await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'trip_request.expired', entityType: 'trip_request', entityId: r.id, afterValue: { status: 'EXPIRED' } }, tx);
      await publishEvent('trip_request', r.id, 'trip_request.expired', { requestNumber: r.requestNumber }, tx);
    });
  }
  return stale.length;
}

// ── cross-module facts (Phase 7) ──────────────────────────────────────────────

/** The row as bidding sees it — scoped; pass `tx` after locking the row so the re-read is current. */
export async function requestRowForBidding(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<repo.TripRequestRow | null> {
  return repo.findTripRequest(scope, id, tx);
}

/** The occupancy window the matcher and the reservation share. */
export function requestOccupancyWindow(r: Pick<repo.TripRequestRow, 'pickupAt' | 'returnAt' | 'estimatedDurationMinutes'>, bidDurationMinutes: number | null = null): { from: Date; to: Date } {
  return occupancyWindow(r.pickupAt, r.returnAt, bidDurationMinutes ?? r.estimatedDurationMinutes);
}

/** Counter + status flip after n bookings were created under the request's row lock (api.md §6.4 step 11). */
export async function recordAward(scope: AnyScope, r: repo.TripRequestRow, awardedNow: number, tx: Prisma.TransactionClient): Promise<{ status: 'PARTIALLY_AWARDED' | 'FULLY_AWARDED'; vehiclesAwarded: number }> {
  const vehiclesAwarded = r.vehiclesAwarded + awardedNow;
  const status = vehiclesAwarded >= r.vehiclesRequired ? 'FULLY_AWARDED' : 'PARTIALLY_AWARDED';
  await tx.tripRequest.update({ where: { id: r.id }, data: { vehiclesAwarded, status } });
  await writeAudit({ ...(scope.kind === 'SYSTEM' ? { actorUserId: null, actorType: 'SYSTEM' as const } : audit(scope)), action: 'trip_request.awarded', entityType: 'trip_request', entityId: r.id, beforeValue: { vehiclesAwarded: r.vehiclesAwarded, status: r.status }, afterValue: { vehiclesAwarded, status } }, tx);
  return { status, vehiclesAwarded };
}

export { biddingOpen, systemScope };

/** A booking was cancelled: vehicles_awarded--, vehicles_cancelled++ (cumulative), FULLY_AWARDED → PARTIALLY_AWARDED reopens the order (A-45). Under the request's row lock. */
export async function recordBookingCancellation(scope: AnyScope, tripRequestId: string, tx: Prisma.TransactionClient): Promise<{ status: string; vehiclesAwarded: number }> {
  await tx.$queryRaw`SELECT id FROM trip_requests WHERE id = ${tripRequestId}::uuid FOR UPDATE`;
  const r = await tx.tripRequest.findUniqueOrThrow({ where: { id: tripRequestId }, select: { status: true, vehiclesAwarded: true, vehiclesRequired: true, vehiclesCancelled: true, requestNumber: true } });
  const vehiclesAwarded = Math.max(0, r.vehiclesAwarded - 1);
  // A closed or completed order stays closed; an open one reopens for the balance.
  const status = r.status === 'FULLY_AWARDED' ? 'PARTIALLY_AWARDED' : r.status;
  await tx.tripRequest.update({ where: { id: tripRequestId }, data: { vehiclesAwarded, vehiclesCancelled: { increment: 1 }, status } });
  await writeAudit({ ...(scope.kind === 'SYSTEM' ? { actorUserId: null, actorType: 'SYSTEM' as const } : audit(scope)), action: 'trip_request.booking_cancelled', entityType: 'trip_request', entityId: tripRequestId, beforeValue: { vehiclesAwarded: r.vehiclesAwarded, status: r.status }, afterValue: { vehiclesAwarded, vehiclesCancelled: r.vehiclesCancelled + 1, status } }, tx);
  if (status !== r.status) await publishEvent('trip_request', tripRequestId, 'trip_request.reopened', { requestNumber: r.requestNumber, vehiclesRequired: r.vehiclesRequired, vehiclesAwarded }, tx);
  return { status, vehiclesAwarded };
}
