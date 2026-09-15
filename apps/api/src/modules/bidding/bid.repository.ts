import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Bids (database.md §9). Scope:
 *   OWN    — the owner's own bids, or bids on the customer's own requests
 *   PARTY  — same (the two parties to a bid)
 *   GLOBAL — bids.read_any
 */

export const bidSelect = {
  id: true, bidNumber: true, tripRequestId: true, ownerProfileId: true, vehicleId: true, driverProfileId: true, baseAmount: true, extrasAmount: true, extrasBreakdown: true, vatRate: true, vatAmount: true, totalAmount: true, currency: true,
  estimatedArrivalAt: true, estimatedDurationMinutes: true, validUntil: true, ownerNotes: true, status: true, version: true, lastRevisedAt: true, rejectedReason: true, submittedAt: true, decidedAt: true, createdAt: true, updatedAt: true,
  tripRequest: { select: { requestNumber: true, customerProfileId: true, status: true, vehicleCategoryId: true, transportType: true } },
  ownerProfile: { select: { businessNameEn: true, ratingAvg: true, isVatRegistered: true, vatNumber: true, onboardingStatus: true, user: { select: { fullNameEn: true } } } },
  vehicle: { select: { plateNumberEn: true, modelYear: true, passengerCapacity: true, payloadCapacityKg: true, ratingAvg: true, make: { select: { name: true } }, model: { select: { name: true } }, category: { select: { code: true, nameEn: true } } } },
  driverProfile: { select: { user: { select: { fullNameEn: true } } } },
  booking: { select: { id: true } },
} satisfies Prisma.BidSelect;
export type BidRow = Prisma.BidGetPayload<{ select: typeof bidSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.BidWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  const a = scope.actor;
  const or: Prisma.BidWhereInput[] = [];
  if (a.ownerProfileId) or.push({ ownerProfileId: a.ownerProfileId });
  if (a.customerProfileId) or.push({ tripRequest: { customerProfileId: a.customerProfileId } });
  return or.length ? { OR: or } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findBid(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<BidRow | null> {
  const db = tx ?? prisma();
  return db.bid.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: bidSelect });
}

export interface BidFilters {
  status?: string | undefined;
  tripRequestId?: string | undefined;
  vehicleId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
}

export async function listBids(scope: AnyScope, f: BidFilters, page: { page: number; pageSize: number }): Promise<{ items: BidRow[]; total: number }> {
  const where: Prisma.BidWhereInput = {
    ...scopeWhere(scope),
    ...(f.status ? { status: f.status as BidRow['status'] } : {}),
    ...(f.tripRequestId ? { tripRequestId: f.tripRequestId } : {}),
    ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
    ...(f.dateFrom || f.dateTo ? { submittedAt: { ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}), ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}) } } : {}),
    ...(f.minAmount || f.maxAmount ? { totalAmount: { ...(f.minAmount ? { gte: f.minAmount } : {}), ...(f.maxAmount ? { lte: f.maxAmount } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma().bid.findMany({ where, select: bidSelect, orderBy: { submittedAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().bid.count({ where }),
  ]);
  return { items, total };
}

/** The customer's comparison list on one request (an owner's scope filters to their own rows). */
export async function listRequestBids(scope: AnyScope, tripRequestId: string, f: { status?: string | undefined; sort: 'totalAmount' | 'submittedAt' | 'estimatedArrivalAt'; order: 'asc' | 'desc' }, page: { page: number; pageSize: number }): Promise<{ items: BidRow[]; total: number }> {
  const where: Prisma.BidWhereInput = { AND: [{ tripRequestId }, scopeWhere(scope)], ...(f.status ? { status: f.status as BidRow['status'] } : {}) };
  const [items, total] = await Promise.all([
    prisma().bid.findMany({ where, select: bidSelect, orderBy: [{ [f.sort]: f.order }, { submittedAt: 'asc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().bid.count({ where }),
  ]);
  return { items, total };
}

export async function countActiveForOwner(_scope: AnyScope, tripRequestId: string, ownerProfileId: string): Promise<number> {
  return prisma().bid.count({ where: { tripRequestId, ownerProfileId, status: 'SUBMITTED' } });
}

export async function hasLiveBidForVehicle(_scope: AnyScope, tripRequestId: string, vehicleId: string): Promise<boolean> {
  return (await prisma().bid.count({ where: { tripRequestId, vehicleId, status: 'SUBMITTED' } })) > 0;
}

/** The owner's live bid: SUBMITTED, or ACCEPTED with a booking that still stands (a cancelled booking frees the owner to bid again). */
export async function findOwnerBidOnRequest(_scope: AnyScope, tripRequestId: string, ownerProfileId: string): Promise<{ id: string; status: BidRow['status'] } | null> {
  return prisma().bid.findFirst({ where: { tripRequestId, ownerProfileId, OR: [{ status: 'SUBMITTED' }, { status: 'ACCEPTED', booking: { status: { notIn: ['CANCELLED', 'REFUNDED'] } } }] }, orderBy: { submittedAt: 'desc' }, select: { id: true, status: true } });
}

export async function ownerHasAcceptedBid(_scope: AnyScope, tripRequestId: string, ownerProfileId: string): Promise<boolean> {
  return (await prisma().bid.count({ where: { tripRequestId, ownerProfileId, status: 'ACCEPTED' } })) > 0;
}

export async function nextBidNumber(_scope: AnyScope, tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_bid_number') AS n`;
  return `BD-${new Date().getUTCFullYear()}-${String(rows[0]?.n ?? 0).padStart(6, '0')}`;
}

/** Row locks in the global order (trip_requests → bids → vehicles → corporate_customer_profiles). Ids are locked in ascending order. */
export async function lockBids(_scope: AnyScope, ids: string[], tx: Prisma.TransactionClient): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bids WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  return rows.map((r) => r.id);
}

export async function lockTripRequest(_scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM trip_requests WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export async function lockVehicles(_scope: AnyScope, ids: string[], tx: Prisma.TransactionClient): Promise<void> {
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

export async function lockCorporateProfile(_scope: AnyScope, customerProfileId: string, tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM corporate_customer_profiles WHERE customer_profile_id = ${customerProfileId}::uuid FOR UPDATE`;
}

/** SUBMITTED → REJECTED for every live sibling (full award, remainder closed, request cancelled). */
export async function rejectLiveBids(_scope: AnyScope, tripRequestId: string, reason: string, tx: Prisma.TransactionClient, except: string[] = []): Promise<string[]> {
  const live = await tx.bid.findMany({ where: { tripRequestId, status: 'SUBMITTED', ...(except.length ? { id: { notIn: except } } : {}) }, select: { id: true } });
  if (live.length) await tx.bid.updateMany({ where: { id: { in: live.map((b) => b.id) } }, data: { status: 'REJECTED', rejectedReason: reason, decidedAt: new Date() } });
  return live.map((b) => b.id);
}

export async function listExpired(_scope: AnyScope, at: Date, take = 500): Promise<{ id: string; bidNumber: string; ownerProfileId: string; tripRequestId: string }[]> {
  return prisma().bid.findMany({ where: { status: 'SUBMITTED', validUntil: { lt: at } }, select: { id: true, bidNumber: true, ownerProfileId: true, tripRequestId: true }, take });
}
