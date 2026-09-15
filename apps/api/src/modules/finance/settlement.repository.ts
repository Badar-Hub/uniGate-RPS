import { Prisma } from '@prisma/client';
import type { Decimal } from '@/common/money.js';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Settlements (database.md §12.5). Scope:
 *   OWN    — the owner's own settlements
 *   GLOBAL — settlements.* staff
 */

export const settlementSelect = {
  id: true, settlementNumber: true, ownerProfileId: true, periodStart: true, periodEnd: true, grossAmount: true, commissionAmount: true, adjustmentsAmount: true, netPayableAmount: true, currency: true, status: true,
  bankAccountId: true, paymentReference: true, approvedByUserId: true, paidAt: true, notes: true, createdAt: true, updatedAt: true,
  ownerProfile: { select: { businessNameEn: true, user: { select: { fullNameEn: true } } } },
  bankAccount: { select: { id: true, bankName: true, ibanLast4: true, accountHolderName: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.SettlementSelect;
export type SettlementRow = Prisma.SettlementGetPayload<{ select: typeof settlementSelect }>;

export const settlementLineSelect = {
  id: true, settlementId: true, bookingId: true, lineType: true, amount: true, currency: true, description: true, holdReason: true, heldSince: true, releasedAt: true, eligibleAt: true, createdAt: true,
  booking: { select: { bookingNumber: true } },
} satisfies Prisma.SettlementLineSelect;
export type SettlementLineRow = Prisma.SettlementLineGetPayload<{ select: typeof settlementLineSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.SettlementWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  return scope.actor.ownerProfileId ? { ownerProfileId: scope.actor.ownerProfileId } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findSettlement(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<SettlementRow | null> {
  return (tx ?? prisma()).settlement.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: settlementSelect });
}

export interface SettlementFilters {
  status?: string | undefined;
  ownerProfileId?: string | undefined;
  periodFrom?: string | undefined;
  periodTo?: string | undefined;
  minAmount?: string | undefined;
}

export async function listSettlements(scope: AnyScope, f: SettlementFilters, page: { page: number; pageSize: number }): Promise<{ items: SettlementRow[]; total: number }> {
  const where: Prisma.SettlementWhereInput = {
    AND: [
      scopeWhere(scope),
      ...(f.status ? [{ status: f.status as SettlementRow['status'] }] : []),
      ...(f.ownerProfileId ? [{ ownerProfileId: f.ownerProfileId }] : []),
      ...(f.periodFrom ? [{ periodEnd: { gt: new Date(f.periodFrom) } }] : []),
      ...(f.periodTo ? [{ periodStart: { lt: new Date(f.periodTo) } }] : []),
      ...(f.minAmount ? [{ netPayableAmount: { gte: new Prisma.Decimal(f.minAmount) } }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma().settlement.findMany({ where, select: settlementSelect, orderBy: [{ createdAt: 'desc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().settlement.count({ where }),
  ]);
  return { items, total };
}

export async function listLines(scope: AnyScope, settlementId: string): Promise<SettlementLineRow[] | null> {
  const s = await prisma().settlement.findFirst({ where: { AND: [{ id: settlementId }, scopeWhere(scope)] }, select: { id: true } });
  if (!s) return null;
  return prisma().settlementLine.findMany({ where: { settlementId }, select: settlementLineSelect, orderBy: [{ lineType: 'asc' }, { createdAt: 'asc' }] });
}

export async function nextSettlementNumber(_scope: AnyScope, tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_settlement_number') AS n`;
  const n = Number(rows[0]?.n ?? 0);
  return `ST-${new Date().getUTCFullYear()}-${String(n).padStart(6, '0')}`;
}

export async function lockSettlement(_scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM settlements WHERE id = ${id}::uuid FOR UPDATE`;
}

/** Serialises settlement creation per owner so two concurrent builds cannot both pass the "already settled" check. */
export async function lockOwnerForSettlement(_scope: AnyScope, ownerProfileId: string, tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM owner_profiles WHERE id = ${ownerProfileId}::uuid FOR UPDATE`;
}

export interface EligibleBooking {
  id: string;
  bookingNumber: string;
  completedAt: Date | null;
  grossAmount: Prisma.Decimal;
  commissionAmount: Prisma.Decimal;
  commissionVatAmount: Prisma.Decimal;
  paymentFeeAmount: Prisma.Decimal;
  ownerNetAmount: Prisma.Decimal;
  currency: string;
  /** Money has landed: PAID for PREPAID, an issued invoice for INVOICED. */
  funded: boolean;
  /** Already carried by a BOOKING_EARNING line (of a non-cancelled settlement). */
  settled: boolean;
}

/** COMPLETED bookings of the owner completed inside [from, to) with a financial snapshot, whatever their funding/settled state — the service sorts them. */
export async function completedBookingsInPeriod(_scope: AnyScope, ownerProfileId: string, from: Date, to: Date, tx: Prisma.TransactionClient | null = null): Promise<EligibleBooking[]> {
  const db = tx ?? prisma();
  const rows = await db.booking.findMany({
    where: { ownerProfileId, status: 'COMPLETED', completedAt: { gte: from, lt: to }, financialSnapshot: { isNot: null } },
    select: {
      id: true, bookingNumber: true, completedAt: true, paymentStatus: true, billingMode: true, currency: true,
      financialSnapshot: { select: { grossAmount: true, commissionAmount: true, commissionVatAmount: true, paymentFeeAmount: true, ownerNetAmount: true } },
      invoiceLineLinks: { select: { invoiceLine: { select: { invoice: { select: { status: true } } } } } },
      settlementLines: { where: { lineType: 'BOOKING_EARNING', settlement: { status: { not: 'CANCELLED' } } }, select: { id: true } },
    },
    orderBy: { completedAt: 'asc' },
  });
  return rows.flatMap((b) => {
    const f = b.financialSnapshot;
    if (!f) return [];
    const invoiced = b.invoiceLineLinks.some((l) => l.invoiceLine.invoice.status !== 'VOID');
    return [{
      id: b.id, bookingNumber: b.bookingNumber, completedAt: b.completedAt, grossAmount: f.grossAmount, commissionAmount: f.commissionAmount, commissionVatAmount: f.commissionVatAmount, paymentFeeAmount: f.paymentFeeAmount, ownerNetAmount: f.ownerNetAmount, currency: b.currency,
      funded: b.billingMode === 'PREPAID' ? b.paymentStatus === 'PAID' : invoiced, settled: b.settlementLines.length > 0,
    }];
  });
}

/** Net payable of every settlement of the owner that is on its way to being paid. */
export async function inFlightTotal(_scope: AnyScope, ownerProfileId: string): Promise<Prisma.Decimal> {
  const r = await prisma().settlement.aggregate({ where: { ownerProfileId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING'] } }, _sum: { netPayableAmount: true } });
  return r._sum.netPayableAmount ?? new Prisma.Decimal(0);
}

/** Who submitted the settlement for approval (four-eyes reads the audit trail, not a mutable column). */
export async function submitterOf(_scope: AnyScope, settlementId: string, tx: Prisma.TransactionClient): Promise<string | null> {
  const row = await tx.auditLog.findFirst({ where: { entityType: 'settlement', entityId: settlementId, action: 'settlement.submitted' }, orderBy: { occurredAt: 'desc' }, select: { actorUserId: true } });
  return row?.actorUserId ?? null;
}

/** A PAID settlement of the owner whose period contains the date (expense immutability). */
export async function paidSettlementCovering(_scope: AnyScope, ownerProfileId: string, at: Date): Promise<boolean> {
  const n = await prisma().settlement.count({ where: { ownerProfileId, status: 'PAID', periodStart: { lte: at }, periodEnd: { gt: at } } });
  return n > 0;
}

export interface OwnerPenalty {
  bookingId: string;
  bookingNumber: string;
  eventType: string;
  reasonCode: string;
  feeAmount: Decimal;
  currency: string;
  cancelledAt: Date;
}

/** Owner-payable cancellation / no-show fees in the period not yet carried by a PENALTY line (OQ-05). */
export async function ownerPenaltiesInPeriod(_scope: AnyScope, ownerProfileId: string, from: Date, to: Date, tx: Prisma.TransactionClient | null = null): Promise<OwnerPenalty[]> {
  const db = tx ?? prisma();
  const rows = await db.bookingCancellation.findMany({
    where: { feePayer: 'OWNER', feeWaivedAt: null, cancellationFeeAmount: { gt: 0 }, cancelledAt: { gte: from, lt: to }, booking: { ownerProfileId, settlementLines: { none: { lineType: 'PENALTY', settlement: { status: { not: 'CANCELLED' } } } } } },
    select: { bookingId: true, eventType: true, reasonCode: true, cancellationFeeAmount: true, currency: true, cancelledAt: true, booking: { select: { bookingNumber: true } } },
    orderBy: { cancelledAt: 'asc' },
  });
  return rows.map((r) => ({ bookingId: r.bookingId, bookingNumber: r.booking.bookingNumber, eventType: r.eventType, reasonCode: r.reasonCode, feeAmount: r.cancellationFeeAmount, currency: r.currency, cancelledAt: r.cancelledAt }));
}
