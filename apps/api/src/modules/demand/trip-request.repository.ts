import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Trip requests and invitations (database.md §8). Scope:
 *   OWN    — the customer's own requests (customerProfileId)
 *   PARTY  — an owner who holds an invitation on the request (redacted projection)
 *   GLOBAL — trip_requests.read_any
 */

export const tripRequestSelect = {
  id: true, requestNumber: true, customerProfileId: true, createdByUserId: true, attributedSpoProfileId: true, transportType: true, vehicleCategoryId: true,
  vehiclesRequired: true, allowPartialFulfilment: true, tripDirection: true,
  pickupAddressLine: true, pickupCityId: true, pickupLatitude: true, pickupLongitude: true, pickupPlaceId: true,
  dropoffAddressLine: true, dropoffCityId: true, dropoffLatitude: true, dropoffLongitude: true, dropoffPlaceId: true,
  estimatedDistanceKm: true, estimatedDurationMinutes: true, pickupAt: true, returnAt: true, biddingClosesAt: true, remainderClosesAt: true,
  status: true, vehiclesAwarded: true, vehiclesDispatched: true, vehiclesCompleted: true, vehiclesCancelled: true,
  budgetAmount: true, currency: true, specialInstructions: true, cancellationReason: true, createdAt: true, updatedAt: true,
  vehicleCategory: { select: { id: true, code: true, nameEn: true, nameAr: true, transportType: true } },
  passengerDetails: true,
  goodsDetails: true,
  _count: { select: { invitations: true } },
} satisfies Prisma.TripRequestSelect;

export type TripRequestRow = Prisma.TripRequestGetPayload<{ select: typeof tripRequestSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.TripRequestWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  const a = scope.actor;
  const or: Prisma.TripRequestWhereInput[] = [];
  if (a.customerProfileId) or.push({ customerProfileId: a.customerProfileId });
  if (scope.kind === 'PARTY' && a.ownerProfileId) or.push({ invitations: { some: { ownerProfileId: a.ownerProfileId } } });
  return or.length ? { OR: or } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findTripRequest(scope: AnyScope, id: string): Promise<TripRequestRow | null> {
  return prisma().tripRequest.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: tripRequestSelect });
}

export interface TripRequestFilters {
  status?: string | undefined;
  transportType?: string | undefined;
  vehicleCategoryId?: string | undefined;
  pickupCityId?: string | undefined;
  allowPartialFulfilment?: boolean | undefined;
  hasOpenRemainder?: boolean | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  q?: string | undefined;
}

export async function listTripRequests(scope: AnyScope, f: TripRequestFilters, page: { page: number; pageSize: number }): Promise<{ items: TripRequestRow[]; total: number }> {
  const where: Prisma.TripRequestWhereInput = {
    ...scopeWhere(scope),
    ...(f.status ? { status: f.status as TripRequestRow['status'] } : {}),
    ...(f.transportType ? { transportType: f.transportType as TripRequestRow['transportType'] } : {}),
    ...(f.vehicleCategoryId ? { vehicleCategoryId: f.vehicleCategoryId } : {}),
    ...(f.pickupCityId ? { pickupCityId: f.pickupCityId } : {}),
    ...(f.allowPartialFulfilment !== undefined ? { allowPartialFulfilment: f.allowPartialFulfilment } : {}),
    ...(f.dateFrom ? { pickupAt: { gte: new Date(f.dateFrom) } } : {}),
    ...(f.dateTo ? { pickupAt: { lte: new Date(f.dateTo) } } : {}),
    ...(f.q ? { requestNumber: { contains: f.q.toUpperCase() } } : {}),
  };
  // hasOpenRemainder: awarded > 0 AND awarded < required — a column comparison, done in SQL below.
  const ids = f.hasOpenRemainder === undefined ? null : await prisma().$queryRaw<{ id: string }[]>`SELECT id FROM trip_requests WHERE (vehicles_awarded > 0 AND vehicles_awarded < vehicles_required) = ${f.hasOpenRemainder}`;
  const finalWhere: Prisma.TripRequestWhereInput = ids ? { AND: [where, { id: { in: ids.map((r) => r.id) } }] } : where;
  const [items, total] = await Promise.all([
    prisma().tripRequest.findMany({ where: finalWhere, select: tripRequestSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().tripRequest.count({ where: finalWhere }),
  ]);
  return { items, total };
}

/** Next human-readable number: TR-<year>-<6 digits> from the sequence (gaps on rollback are acceptable). */
export async function nextRequestNumber(_scope: AnyScope, tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_trip_request_number') AS n`;
  return `TR-${new Date().getUTCFullYear()}-${String(rows[0]?.n ?? 0).padStart(6, '0')}`;
}

// ── invitations ──────────────────────────────────────────────────────────────

export const invitationSelect = {
  id: true, tripRequestId: true, ownerProfileId: true, vehicleId: true, matchScore: true, matchReason: true, notifiedAt: true, notificationChannels: true, viewedAt: true, dismissedAt: true, createdAt: true,
  ownerProfile: { select: { businessNameEn: true, user: { select: { fullNameEn: true } } } },
  vehicle: { select: { plateNumberEn: true } },
} satisfies Prisma.TripRequestInvitationSelect;
export type InvitationRow = Prisma.TripRequestInvitationGetPayload<{ select: typeof invitationSelect }>;

export async function listInvitations(_scope: AnyScope, tripRequestId: string): Promise<InvitationRow[]> {
  return prisma().tripRequestInvitation.findMany({ where: { tripRequestId }, select: invitationSelect, orderBy: [{ matchScore: 'desc' }, { createdAt: 'asc' }] });
}

/** One invitation of the acting owner (the opportunity), with its request. */
export async function findOwnerInvitation(scope: AnyScope, invitationId: string) {
  const ownerProfileId = scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? undefined : (scope.actor.ownerProfileId ?? '00000000-0000-0000-0000-000000000000');
  return prisma().tripRequestInvitation.findFirst({
    where: { id: invitationId, ...(ownerProfileId ? { ownerProfileId } : {}) },
    select: { ...invitationSelect, tripRequest: { select: tripRequestSelect } },
  });
}
export type OwnerInvitationRow = NonNullable<Awaited<ReturnType<typeof findOwnerInvitation>>>;

export interface OpportunityFilters {
  transportType?: string | undefined;
  vehicleCategoryId?: string | undefined;
  pickupCityId?: string | undefined;
  pickupFrom?: string | undefined;
  pickupTo?: string | undefined;
  closingWithinHours?: number | undefined;
  includeDismissed?: boolean | undefined;
}

/** Open invitations for the acting owner: one row per request (the best-scoring vehicle match). */
export async function listOpportunities(scope: AnyScope, f: OpportunityFilters, page: { page: number; pageSize: number }): Promise<{ items: OwnerInvitationRow[]; total: number }> {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' || !scope.actor.ownerProfileId) return { items: [], total: 0 };
  const now = new Date();
  const where: Prisma.TripRequestInvitationWhereInput = {
    ownerProfileId: scope.actor.ownerProfileId,
    ...(f.includeDismissed ? {} : { dismissedAt: null }),
    tripRequest: {
      status: { in: ['PUBLISHED', 'PARTIALLY_AWARDED'] },
      ...(f.transportType ? { transportType: f.transportType as TripRequestRow['transportType'] } : {}),
      ...(f.vehicleCategoryId ? { vehicleCategoryId: f.vehicleCategoryId } : {}),
      ...(f.pickupCityId ? { pickupCityId: f.pickupCityId } : {}),
      ...(f.pickupFrom ? { pickupAt: { gte: new Date(f.pickupFrom) } } : {}),
      ...(f.pickupTo ? { pickupAt: { lte: new Date(f.pickupTo) } } : {}),
      ...(f.closingWithinHours ? { biddingClosesAt: { gte: now, lte: new Date(now.getTime() + f.closingWithinHours * 3_600_000) } } : {}),
    },
  };
  // Distinct per request: pick the invitation with the best score for that request.
  const all = await prisma().tripRequestInvitation.findMany({ where, select: { ...invitationSelect, tripRequest: { select: tripRequestSelect } }, orderBy: [{ matchScore: 'desc' }, { createdAt: 'asc' }] });
  const seen = new Set<string>();
  const distinct = all.filter((i) => (seen.has(i.tripRequestId) ? false : (seen.add(i.tripRequestId), true)));
  return { items: distinct.slice((page.page - 1) * page.pageSize, page.page * page.pageSize), total: distinct.length };
}
