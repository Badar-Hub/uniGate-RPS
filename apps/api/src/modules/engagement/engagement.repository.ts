import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Ratings and complaints (database.md §13.2). Ratings are read by subject (PUBLISHED for
 * everyone with ratings.read; every status for moderators). Complaints are OWN (raised by the
 * actor) → GLOBAL (complaints.read_any); internal notes are filtered by the service.
 */

export const ratingSelect = {
  id: true, bookingId: true, tripId: true, raterUserId: true, raterRole: true, subjectType: true, subjectId: true, score: true, comment: true, status: true, moderatedByUserId: true, createdAt: true,
  booking: { select: { bookingNumber: true } },
} satisfies Prisma.RatingSelect;
export type RatingRow = Prisma.RatingGetPayload<{ select: typeof ratingSelect }>;

export const complaintSelect = {
  id: true, complaintNumber: true, raisedByUserId: true, bookingId: true, tripId: true, againstType: true, againstId: true, category: true, subject: true, description: true, severity: true, status: true, assignedToUserId: true, resolution: true, resolvedAt: true, createdAt: true, updatedAt: true,
  booking: { select: { bookingNumber: true } },
  notes: { select: { id: true, authorUserId: true, body: true, isInternal: true, createdAt: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ComplaintSelect;
export type ComplaintRow = Prisma.ComplaintGetPayload<{ select: typeof complaintSelect }>;

// ── ratings ──────────────────────────────────────────────────────────────────

export interface RatingFilters {
  subjectType?: string | undefined;
  subjectId?: string | undefined;
  bookingId?: string | undefined;
  minScore?: number | undefined;
  status?: string | undefined;
}

export async function listRatings(scope: AnyScope, f: RatingFilters, page: { page: number; pageSize: number }): Promise<{ items: RatingRow[]; total: number }> {
  const moderator = scope.kind === 'GLOBAL' || scope.kind === 'SYSTEM';
  const where: Prisma.RatingWhereInput = {
    ...(f.subjectType ? { subjectType: f.subjectType as RatingRow['subjectType'] } : {}), ...(f.subjectId ? { subjectId: f.subjectId } : {}), ...(f.bookingId ? { bookingId: f.bookingId } : {}), ...(f.minScore ? { score: { gte: f.minScore } } : {}),
    status: moderator && f.status ? (f.status as RatingRow['status']) : 'PUBLISHED',
  };
  const [items, total] = await Promise.all([
    prisma().rating.findMany({ where, select: ratingSelect, orderBy: [{ createdAt: 'desc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().rating.count({ where }),
  ]);
  return { items, total };
}

export async function findRating(_scope: AnyScope, id: string): Promise<RatingRow | null> {
  return prisma().rating.findUnique({ where: { id }, select: ratingSelect });
}

export async function ratingsForBookingByRater(_scope: AnyScope, bookingIds: string[], raterUserId: string): Promise<{ bookingId: string; subjectType: string; subjectId: string }[]> {
  if (!bookingIds.length) return [];
  return prisma().rating.findMany({ where: { bookingId: { in: bookingIds }, raterUserId }, select: { bookingId: true, subjectType: true, subjectId: true } });
}

export async function insertRating(_scope: AnyScope, data: Prisma.RatingUncheckedCreateInput, tx: Prisma.TransactionClient): Promise<void> {
  await tx.rating.create({ data });
}

export async function setRatingStatus(_scope: AnyScope, id: string, status: RatingRow['status'], moderatedByUserId: string, tx: Prisma.TransactionClient): Promise<void> {
  await tx.rating.update({ where: { id }, data: { status, moderatedByUserId } });
}

/** Published aggregate for a subject — the same number the summary endpoint and the denormalised columns carry. */
export async function aggregate(_scope: AnyScope, subjectType: RatingRow['subjectType'], subjectId: string): Promise<{ avg: number; count: number; histogram: Record<'1' | '2' | '3' | '4' | '5', number> }> {
  const groups = await prisma().rating.groupBy({ by: ['score'], where: { subjectType, subjectId, status: 'PUBLISHED' }, _count: { _all: true } });
  const histogram: Record<'1' | '2' | '3' | '4' | '5', number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let count = 0;
  let sum = 0;
  for (const g of groups) {
    const key = String(g.score) as keyof typeof histogram;
    histogram[key] = g._count._all;
    count += g._count._all;
    sum += g.score * g._count._all;
  }
  return { avg: count ? Math.round((sum / count) * 100) / 100 : 0, count, histogram };
}

export async function writeAggregate(_scope: AnyScope, subjectType: RatingRow['subjectType'], subjectId: string, avg: number, count: number): Promise<void> {
  const data = { ratingAvg: avg, ratingCount: count };
  switch (subjectType) {
    case 'DRIVER':
      await prisma().driverProfile.updateMany({ where: { id: subjectId }, data });
      return;
    case 'VEHICLE':
      await prisma().vehicle.updateMany({ where: { id: subjectId }, data });
      return;
    case 'OWNER':
      await prisma().ownerProfile.updateMany({ where: { id: subjectId }, data });
      return;
    case 'CUSTOMER':
      await prisma().customerProfile.updateMany({ where: { id: subjectId }, data });
      return;
    case 'TRIP':
      return;
  }
}

/** The actor's COMPLETED bookings (in the claimed roles) completed after `since` — the "rate your trip" prompt. */
export async function completedBookingsFor(_scope: AnyScope, parties: { customerProfileId: string | null; ownerProfileId: string | null; driverProfileId: string | null }, since: Date): Promise<{ id: string; bookingNumber: string; completedAt: Date | null; customerProfileId: string; ownerProfileId: string; driverProfileId: string | null; vehicleId: string; vehiclePlateSnapshot: string; ownerNameSnapshot: string; trip: { id: string } | null; driverProfile: { user: { fullNameEn: string } } | null; customerProfile: { user: { fullNameEn: string } } }[]> {
  const or: Prisma.BookingWhereInput[] = [];
  if (parties.customerProfileId) or.push({ customerProfileId: parties.customerProfileId });
  if (parties.ownerProfileId) or.push({ ownerProfileId: parties.ownerProfileId });
  if (parties.driverProfileId) or.push({ driverProfileId: parties.driverProfileId });
  if (!or.length) return [];
  return prisma().booking.findMany({
    where: { status: 'COMPLETED', completedAt: { gte: since }, OR: or },
    select: { id: true, bookingNumber: true, completedAt: true, customerProfileId: true, ownerProfileId: true, driverProfileId: true, vehicleId: true, vehiclePlateSnapshot: true, ownerNameSnapshot: true, trip: { select: { id: true } }, driverProfile: { select: { user: { select: { fullNameEn: true } } } }, customerProfile: { select: { user: { select: { fullNameEn: true } } } } },
    orderBy: { completedAt: 'desc' },
    take: 50,
  });
}

export async function bookingParties(_scope: AnyScope, bookingId: string): Promise<{ id: string; bookingNumber: string; status: string; completedAt: Date | null; customerProfileId: string; ownerProfileId: string; driverProfileId: string | null; vehicleId: string; trip: { id: string } | null } | null> {
  return prisma().booking.findUnique({ where: { id: bookingId }, select: { id: true, bookingNumber: true, status: true, completedAt: true, customerProfileId: true, ownerProfileId: true, driverProfileId: true, vehicleId: true, trip: { select: { id: true } } } });
}

export async function userNames(_scope: AnyScope, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const rows = await prisma().user.findMany({ where: { id: { in: ids } }, select: { id: true, fullNameEn: true } });
  return new Map(rows.map((r) => [r.id, r.fullNameEn]));
}

// ── complaints ───────────────────────────────────────────────────────────────

function complaintScope(scope: AnyScope): Prisma.ComplaintWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  return { raisedByUserId: scope.actor.userId };
}

export interface ComplaintFilters {
  status?: string | undefined;
  severity?: string | undefined;
  category?: string | undefined;
  againstType?: string | undefined;
  bookingId?: string | undefined;
  assignedToUserId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export async function listComplaints(scope: AnyScope, f: ComplaintFilters, page: { page: number; pageSize: number }): Promise<{ items: ComplaintRow[]; total: number }> {
  const where: Prisma.ComplaintWhereInput = {
    AND: [
      complaintScope(scope),
      ...(f.status ? [{ status: f.status as ComplaintRow['status'] }] : []), ...(f.severity ? [{ severity: f.severity as ComplaintRow['severity'] }] : []), ...(f.category ? [{ category: f.category }] : []),
      ...(f.againstType ? [{ againstType: f.againstType as ComplaintRow['againstType'] }] : []), ...(f.bookingId ? [{ bookingId: f.bookingId }] : []), ...(f.assignedToUserId ? [{ assignedToUserId: f.assignedToUserId }] : []),
      ...(f.dateFrom ? [{ createdAt: { gte: new Date(f.dateFrom) } }] : []), ...(f.dateTo ? [{ createdAt: { lte: new Date(f.dateTo) } }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma().complaint.findMany({ where, select: complaintSelect, orderBy: [{ createdAt: 'desc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().complaint.count({ where }),
  ]);
  return { items, total };
}

export async function findComplaint(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<ComplaintRow | null> {
  return (tx ?? prisma()).complaint.findFirst({ where: { AND: [{ id }, complaintScope(scope)] }, select: complaintSelect });
}

export async function nextComplaintNumber(_scope: AnyScope, tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_complaint_number') AS n`;
  return `CMP-${new Date().getUTCFullYear()}-${String(rows[0]?.n ?? 0).padStart(6, '0')}`;
}

export async function insertComplaint(_scope: AnyScope, data: Prisma.ComplaintUncheckedCreateInput, tx: Prisma.TransactionClient): Promise<void> {
  await tx.complaint.create({ data });
}

export async function updateComplaint(_scope: AnyScope, id: string, data: Prisma.ComplaintUncheckedUpdateInput, tx: Prisma.TransactionClient): Promise<void> {
  await tx.complaint.update({ where: { id }, data });
}

export async function insertNote(_scope: AnyScope, data: Prisma.ComplaintNoteUncheckedCreateInput, tx: Prisma.TransactionClient | null = null): Promise<void> {
  await (tx ?? prisma()).complaintNote.create({ data });
}
