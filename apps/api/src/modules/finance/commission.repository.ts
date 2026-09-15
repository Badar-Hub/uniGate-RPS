import { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/** Commission rules are platform configuration: readable by any actor that reaches an award, never filtered per actor. */
export const commissionRuleSelect = {
  id: true, name: true, scope: true, vehicleCategoryId: true, ownerProfileId: true, transportType: true, calculationType: true, percentageRate: true, fixedAmount: true,
  basis: true, minAmount: true, maxAmount: true, currency: true, priority: true, effectiveFrom: true, effectiveTo: true, isActive: true,
} satisfies Prisma.CommissionRuleSelect;
export type CommissionRuleRow = Prisma.CommissionRuleGetPayload<{ select: typeof commissionRuleSelect }>;

/** Every active rule whose scope could apply to this owner/category/vertical and whose window contains `at`. */
export async function listApplicableRules(_scope: AnyScope, input: { ownerProfileId: string; vehicleCategoryId: string; transportType: 'PASSENGER' | 'GOODS'; at: Date }, tx: Prisma.TransactionClient | null = null): Promise<CommissionRuleRow[]> {
  const db = tx ?? prisma();
  return db.commissionRule.findMany({
    where: {
      isActive: true,
      effectiveFrom: { lte: input.at },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.at } }] },
        { OR: [{ transportType: null }, { transportType: input.transportType }] },
        {
          OR: [
            { scope: 'GLOBAL' },
            { scope: 'VEHICLE_CATEGORY', vehicleCategoryId: input.vehicleCategoryId },
            { scope: 'OWNER', ownerProfileId: input.ownerProfileId },
            { scope: 'OWNER_CATEGORY', ownerProfileId: input.ownerProfileId, vehicleCategoryId: input.vehicleCategoryId },
          ],
        },
      ],
    },
    select: commissionRuleSelect,
  });
}

// ── admin (api.md §8.20) ─────────────────────────────────────────────────────

export const commissionRuleAdminSelect = { ...commissionRuleSelect, createdAt: true, updatedAt: true } satisfies Prisma.CommissionRuleSelect;
export type CommissionRuleAdminRow = Prisma.CommissionRuleGetPayload<{ select: typeof commissionRuleAdminSelect }>;

export interface RuleFilters {
  scope?: string | undefined;
  vehicleCategoryId?: string | undefined;
  ownerProfileId?: string | undefined;
  isActive?: boolean | undefined;
  effectiveOn?: string | undefined;
}

export async function listRules(_scope: AnyScope, f: RuleFilters, page: { page: number; pageSize: number }): Promise<{ items: CommissionRuleAdminRow[]; total: number }> {
  const at = f.effectiveOn ? new Date(f.effectiveOn) : null;
  const where: Prisma.CommissionRuleWhereInput = {
    AND: [
      ...(f.scope ? [{ scope: f.scope as CommissionRuleRow['scope'] }] : []),
      ...(f.vehicleCategoryId ? [{ vehicleCategoryId: f.vehicleCategoryId }] : []),
      ...(f.ownerProfileId ? [{ ownerProfileId: f.ownerProfileId }] : []),
      ...(f.isActive !== undefined ? [{ isActive: f.isActive }] : []),
      ...(at ? [{ effectiveFrom: { lte: at } }, { OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma().commissionRule.findMany({ where, select: commissionRuleAdminSelect, orderBy: [{ priority: 'desc' }, { effectiveFrom: 'desc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().commissionRule.count({ where }),
  ]);
  return { items, total };
}

export async function findRule(_scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<CommissionRuleAdminRow | null> {
  return (tx ?? prisma()).commissionRule.findUnique({ where: { id }, select: commissionRuleAdminSelect });
}

export async function createRule(_scope: AnyScope, data: Prisma.CommissionRuleUncheckedCreateInput, tx: Prisma.TransactionClient): Promise<CommissionRuleAdminRow> {
  return tx.commissionRule.create({ data, select: commissionRuleAdminSelect });
}

export async function updateRule(_scope: AnyScope, id: string, data: Prisma.CommissionRuleUncheckedUpdateInput, tx: Prisma.TransactionClient): Promise<CommissionRuleAdminRow> {
  return tx.commissionRule.update({ where: { id }, data, select: commissionRuleAdminSelect });
}

/** Active GLOBAL rules other than `exceptId` — the platform must always have exactly one (ck_commission_rules_global). */
export async function countActiveGlobal(_scope: AnyScope, exceptId: string | null, tx: Prisma.TransactionClient): Promise<number> {
  return tx.commissionRule.count({ where: { scope: 'GLOBAL', isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) } });
}

/** An active rule of the same scope/target whose window overlaps [from, to). */
export async function findOverlapping(_scope: AnyScope, r: { id: string | null; scope: string; vehicleCategoryId: string | null; ownerProfileId: string | null; transportType: string | null; effectiveFrom: Date; effectiveTo: Date | null }, tx: Prisma.TransactionClient): Promise<CommissionRuleRow | null> {
  return tx.commissionRule.findFirst({
    where: {
      isActive: true,
      scope: r.scope as CommissionRuleRow['scope'],
      vehicleCategoryId: r.vehicleCategoryId,
      ownerProfileId: r.ownerProfileId,
      transportType: r.transportType as CommissionRuleRow['transportType'],
      ...(r.id ? { id: { not: r.id } } : {}),
      ...(r.effectiveTo ? { effectiveFrom: { lt: r.effectiveTo } } : {}),
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: r.effectiveFrom } }],
    },
    select: commissionRuleSelect,
  });
}

export interface EarningsFilters {
  ownerProfileId?: string | undefined;
  vehicleCategoryId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  groupBy: 'none' | 'owner' | 'category' | 'month';
}
export interface EarningsRow {
  key: string;
  label: string | null;
  bookingCount: number;
  gross: string;
  commission: string;
  commissionVat: string;
  ownerNet: string;
}

/** Aggregated commission over completed bookings whose money has landed (PAID or invoiced). Owners are restricted to their own rows by the scope. */
export async function earnings(scope: AnyScope, f: EarningsFilters): Promise<EarningsRow[]> {
  const ownerId = scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? f.ownerProfileId ?? null : scope.actor.ownerProfileId ?? '00000000-0000-0000-0000-000000000000';
  const keyExpr = f.groupBy === 'owner' ? Prisma.sql`b.owner_profile_id::text` : f.groupBy === 'category' ? Prisma.sql`b.vehicle_category_code_snapshot` : f.groupBy === 'month' ? Prisma.sql`to_char(b.completed_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM')` : Prisma.sql`'ALL'`;
  const labelExpr = f.groupBy === 'owner' ? Prisma.sql`MAX(b.owner_name_snapshot)` : f.groupBy === 'category' ? Prisma.sql`MAX(b.vehicle_category_code_snapshot)` : Prisma.sql`NULL::text`;
  return prisma().$queryRaw<EarningsRow[]>`
    SELECT ${keyExpr} AS key, ${labelExpr} AS label, COUNT(*)::int AS "bookingCount",
           COALESCE(SUM(s.gross_amount), 0)::text AS gross, COALESCE(SUM(s.commission_amount), 0)::text AS commission,
           COALESCE(SUM(s.commission_vat_amount), 0)::text AS "commissionVat", COALESCE(SUM(s.owner_net_amount), 0)::text AS "ownerNet"
    FROM bookings b JOIN booking_financial_snapshots s ON s.booking_id = b.id
    WHERE b.status = 'COMPLETED'
      AND (b.payment_status = 'PAID' OR EXISTS (SELECT 1 FROM invoice_line_bookings ilb JOIN invoice_lines il ON il.id = ilb.invoice_line_id JOIN invoices i ON i.id = il.invoice_id WHERE ilb.booking_id = b.id AND i.status <> 'VOID'))
      AND (${ownerId}::uuid IS NULL OR b.owner_profile_id = ${ownerId}::uuid)
      AND (${f.vehicleCategoryId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM trip_requests r WHERE r.id = b.trip_request_id AND r.vehicle_category_id = ${f.vehicleCategoryId ?? null}::uuid))
      AND (${f.dateFrom ?? null}::timestamptz IS NULL OR b.completed_at >= ${f.dateFrom ?? null}::timestamptz)
      AND (${f.dateTo ?? null}::timestamptz IS NULL OR b.completed_at < ${f.dateTo ?? null}::timestamptz)
    GROUP BY 1 ORDER BY 1`;
}
