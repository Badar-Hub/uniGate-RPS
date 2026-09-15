import { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Owner expenses (api.md §8.22). Scope: OWN — the owner's own rows; GLOBAL — expenses.read_any.
 * Soft-deleted rows never surface.
 */

export const expenseSelect = {
  id: true, ownerProfileId: true, vehicleId: true, driverProfileId: true, tripId: true, expenseCategoryId: true, amount: true, vatAmount: true, totalAmount: true, currency: true, expenseDate: true, description: true, vendorName: true, odometerKm: true, receiptDocumentId: true, isReimbursable: true, createdAt: true, updatedAt: true,
  category: { select: { code: true } },
  vehicle: { select: { plateNumberEn: true } },
} satisfies Prisma.ExpenseSelect;
export type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.ExpenseWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return { deletedAt: null };
  return scope.actor.ownerProfileId ? { ownerProfileId: scope.actor.ownerProfileId, deletedAt: null } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findExpense(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<ExpenseRow | null> {
  return (tx ?? prisma()).expense.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: expenseSelect });
}

export interface ExpenseFilters {
  ownerProfileId?: string | undefined;
  expenseCategoryId?: string | undefined;
  vehicleId?: string | undefined;
  driverProfileId?: string | undefined;
  tripId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
  isReimbursable?: boolean | undefined;
}

function filterWhere(scope: AnyScope, f: ExpenseFilters): Prisma.ExpenseWhereInput {
  return {
    AND: [
      scopeWhere(scope),
      ...(f.ownerProfileId ? [{ ownerProfileId: f.ownerProfileId }] : []),
      ...(f.expenseCategoryId ? [{ expenseCategoryId: f.expenseCategoryId }] : []),
      ...(f.vehicleId ? [{ vehicleId: f.vehicleId }] : []),
      ...(f.driverProfileId ? [{ driverProfileId: f.driverProfileId }] : []),
      ...(f.tripId ? [{ tripId: f.tripId }] : []),
      ...(f.dateFrom ? [{ expenseDate: { gte: new Date(f.dateFrom) } }] : []),
      ...(f.dateTo ? [{ expenseDate: { lte: new Date(f.dateTo) } }] : []),
      ...(f.minAmount ? [{ totalAmount: { gte: new Prisma.Decimal(f.minAmount) } }] : []),
      ...(f.maxAmount ? [{ totalAmount: { lte: new Prisma.Decimal(f.maxAmount) } }] : []),
      ...(f.isReimbursable !== undefined ? [{ isReimbursable: f.isReimbursable }] : []),
    ],
  };
}

export async function listExpenses(scope: AnyScope, f: ExpenseFilters, page: { page: number; pageSize: number }): Promise<{ items: ExpenseRow[]; total: number }> {
  const where = filterWhere(scope, f);
  const [items, total] = await Promise.all([
    prisma().expense.findMany({ where, select: expenseSelect, orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().expense.count({ where }),
  ]);
  return { items, total };
}

export async function createExpense(_scope: AnyScope, data: Prisma.ExpenseUncheckedCreateInput, tx: Prisma.TransactionClient): Promise<ExpenseRow> {
  return tx.expense.create({ data, select: expenseSelect });
}

export async function updateExpense(_scope: AnyScope, id: string, data: Prisma.ExpenseUncheckedUpdateInput, tx: Prisma.TransactionClient): Promise<ExpenseRow> {
  return tx.expense.update({ where: { id }, data, select: expenseSelect });
}

export interface SummaryRow {
  key: string;
  label: string | null;
  count: number;
  amount: string;
  vat: string;
  total: string;
}

export async function summary(scope: AnyScope, f: { ownerProfileId?: string | undefined; vehicleId?: string | undefined; dateFrom?: string | undefined; dateTo?: string | undefined; groupBy: 'category' | 'vehicle' | 'month' }): Promise<SummaryRow[]> {
  const ownerId = scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? f.ownerProfileId ?? null : scope.actor.ownerProfileId ?? '00000000-0000-0000-0000-000000000000';
  const keyExpr = f.groupBy === 'category' ? Prisma.sql`c.code` : f.groupBy === 'vehicle' ? Prisma.sql`COALESCE(e.vehicle_id::text, 'NONE')` : Prisma.sql`to_char(e.expense_date, 'YYYY-MM')`;
  const labelExpr = f.groupBy === 'category' ? Prisma.sql`MAX(c.name_en)` : f.groupBy === 'vehicle' ? Prisma.sql`MAX(v.plate_number_en)` : Prisma.sql`NULL::text`;
  return prisma().$queryRaw<SummaryRow[]>`
    SELECT ${keyExpr} AS key, ${labelExpr} AS label, COUNT(*)::int AS count, COALESCE(SUM(e.amount), 0)::text AS amount, COALESCE(SUM(e.vat_amount), 0)::text AS vat, COALESCE(SUM(e.total_amount), 0)::text AS total
    FROM expenses e JOIN expense_categories c ON c.id = e.expense_category_id LEFT JOIN vehicles v ON v.id = e.vehicle_id
    WHERE e.deleted_at IS NULL
      AND (${ownerId}::uuid IS NULL OR e.owner_profile_id = ${ownerId}::uuid)
      AND (${f.vehicleId ?? null}::uuid IS NULL OR e.vehicle_id = ${f.vehicleId ?? null}::uuid)
      AND (${f.dateFrom ?? null}::date IS NULL OR e.expense_date >= ${f.dateFrom ?? null}::date)
      AND (${f.dateTo ?? null}::date IS NULL OR e.expense_date <= ${f.dateTo ?? null}::date)
    GROUP BY 1 ORDER BY 1`;
}
