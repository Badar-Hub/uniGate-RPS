import type { ActorScope, AnyScope, ExpenseDto, ExpenseSummaryDto } from '@unigate/types';
import type { createExpenseBody, expenseSummaryQuery, patchExpenseBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { Decimal, money, round2, toMoneyString } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { getDocument } from '@/modules/documents/documents.service.js';
import { getVehicle } from '@/modules/fleet/vehicle.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getDriver } from '@/modules/profiles/driver.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { getTrip } from '@/modules/trips/trip.service.js';
import { toExpenseDto } from './finance.mapper.js';
import * as repo from './expense.repository.js';
import { isExpenseLocked } from './settlement.service.js';

/**
 * Owner expenses (api.md §8.22). VAT is captured beside the net amount; references (vehicle,
 * driver, trip, receipt) are resolved through the owning modules under the caller's scope, so an
 * owner cannot attach someone else's vehicle. An expense inside a PAID settlement period is
 * immutable (409 EXPENSE_IMMUTABLE).
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function withLock(scope: AnyScope, row: repo.ExpenseRow): Promise<ExpenseDto> {
  return toExpenseDto(row, await isExpenseLocked(scope, row.ownerProfileId, row.expenseDate));
}

export async function getExpense(scope: AnyScope, id: string): Promise<ExpenseDto> {
  const row = await repo.findExpense(scope, id);
  if (!row) throw new NotFoundError();
  return withLock(scope, row);
}

export async function listExpenses(scope: AnyScope, f: repo.ExpenseFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listExpenses(scope, f, page);
  const dtos: ExpenseDto[] = [];
  for (const r of items) dtos.push(await withLock(scope, r));
  return { items: dtos, total };
}

/** References must resolve under the actor's own scope; a foreign id reads as a validation failure, not a leak. */
async function assertReferences(scope: AnyScope, ownerProfileId: string, refs: { vehicleId?: string | null | undefined; driverProfileId?: string | null | undefined; tripId?: string | null | undefined; receiptDocumentId?: string | null | undefined }): Promise<void> {
  const fail = (field: string) => new BusinessRuleError('VALIDATION_FAILED', `${field} does not reference one of the owner's records`, { field });
  if (refs.vehicleId) {
    const v = await getVehicle(scope, refs.vehicleId).catch(() => null);
    if (v?.ownerProfileId !== ownerProfileId) throw fail('vehicleId');
  }
  if (refs.driverProfileId) {
    const d = await getDriver(scope, refs.driverProfileId).catch(() => null);
    if (d?.ownerProfileId !== ownerProfileId) throw fail('driverProfileId');
  }
  if (refs.tripId) {
    const t = await getTrip(scope, refs.tripId).catch(() => null);
    if (t?.ownerProfileId !== ownerProfileId) throw fail('tripId');
  }
  if (refs.receiptDocumentId) {
    const doc = await getDocument(scope, refs.receiptDocumentId).catch(() => null);
    if (!doc) throw fail('receiptDocumentId');
  }
}

function ownerFor(scope: ActorScope, requested: string | undefined): string {
  if (scope.kind === 'GLOBAL') {
    if (!requested) throw new BusinessRuleError('VALIDATION_FAILED', 'ownerProfileId is required', { field: 'ownerProfileId' });
    return requested;
  }
  const own = scope.actor.ownerProfileId;
  if (!own || (requested && requested !== own)) throw new NotFoundError();
  return own;
}

export async function createExpense(scope: ActorScope, body: z.infer<typeof createExpenseBody>): Promise<ExpenseDto> {
  const ownerProfileId = ownerFor(scope, body.ownerProfileId);
  const category = await prisma().expenseCategory.findFirst({ where: { id: body.expenseCategoryId, isActive: true }, select: { id: true } });
  if (!category) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown or inactive expense category', { field: 'expenseCategoryId' });
  await assertReferences(scope, ownerProfileId, body);
  const currency = await getSettingValue<string>('finance.currency', 'SAR');
  const amount = round2(money(body.amount));
  const vat = round2(money(body.vatAmount));
  const id = newId();
  const row = await prisma().$transaction(async (tx) => {
    const created = await repo.createExpense(scope, {
      id, ownerProfileId, vehicleId: body.vehicleId ?? null, driverProfileId: body.driverProfileId ?? null, tripId: body.tripId ?? null, expenseCategoryId: body.expenseCategoryId, amount, vatAmount: vat, totalAmount: amount.add(vat), currency,
      expenseDate: utcDate(body.expenseDate), description: body.description ?? null, vendorName: body.vendorName ?? null, odometerKm: body.odometerKm ?? null, receiptDocumentId: body.receiptDocumentId ?? null, isReimbursable: body.isReimbursable, createdByUserId: scope.actor.userId,
    }, tx);
    await writeAudit({ ...audit(scope), action: 'expense.created', entityType: 'expense', entityId: id, afterValue: { ownerProfileId, totalAmount: amount.add(vat).toFixed(2), expenseDate: body.expenseDate, expenseCategoryId: body.expenseCategoryId } }, tx);
    return created;
  });
  return toExpenseDto(row, false);
}

async function loadMutable(scope: ActorScope, id: string): Promise<repo.ExpenseRow> {
  const row = await repo.findExpense(scope, id);
  if (!row) throw new NotFoundError();
  if (await isExpenseLocked(scope, row.ownerProfileId, row.expenseDate)) throw new ConflictError('EXPENSE_IMMUTABLE', 'The expense falls inside a PAID settlement period and can no longer change');
  return row;
}

export async function patchExpense(scope: ActorScope, id: string, body: z.infer<typeof patchExpenseBody>): Promise<ExpenseDto> {
  const cur = await loadMutable(scope, id);
  if (body.expenseCategoryId) {
    const category = await prisma().expenseCategory.findFirst({ where: { id: body.expenseCategoryId, isActive: true }, select: { id: true } });
    if (!category) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown or inactive expense category', { field: 'expenseCategoryId' });
  }
  await assertReferences(scope, cur.ownerProfileId, body);
  const amount = body.amount !== undefined ? round2(money(body.amount)) : cur.amount;
  const vat = body.vatAmount !== undefined ? round2(money(body.vatAmount)) : cur.vatAmount;
  if (amount.add(vat).lte(0)) throw new BusinessRuleError('VALIDATION_FAILED', 'The expense must be greater than zero', { field: 'amount' });
  if (body.expenseDate && (await isExpenseLocked(scope, cur.ownerProfileId, utcDate(body.expenseDate)))) throw new ConflictError('EXPENSE_IMMUTABLE', 'The new date falls inside a PAID settlement period');
  const row = await prisma().$transaction(async (tx) => {
    const updated = await repo.updateExpense(scope, id, {
      ...(body.vehicleId !== undefined ? { vehicleId: body.vehicleId } : {}), ...(body.driverProfileId !== undefined ? { driverProfileId: body.driverProfileId } : {}), ...(body.tripId !== undefined ? { tripId: body.tripId } : {}),
      ...(body.expenseCategoryId ? { expenseCategoryId: body.expenseCategoryId } : {}), amount, vatAmount: vat, totalAmount: amount.add(vat), ...(body.expenseDate ? { expenseDate: utcDate(body.expenseDate) } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}), ...(body.vendorName !== undefined ? { vendorName: body.vendorName } : {}), ...(body.odometerKm !== undefined ? { odometerKm: body.odometerKm } : {}),
      ...(body.receiptDocumentId !== undefined ? { receiptDocumentId: body.receiptDocumentId } : {}), ...(body.isReimbursable !== undefined ? { isReimbursable: body.isReimbursable } : {}),
    }, tx);
    await writeAudit({ ...audit(scope), action: 'expense.updated', entityType: 'expense', entityId: id, beforeValue: { totalAmount: cur.totalAmount.toFixed(2), expenseDate: cur.expenseDate.toISOString().slice(0, 10) }, afterValue: { ...body } }, tx);
    return updated;
  });
  return toExpenseDto(row, false);
}

export async function deleteExpense(scope: ActorScope, id: string): Promise<void> {
  const cur = await loadMutable(scope, id);
  await prisma().$transaction(async (tx) => {
    await repo.updateExpense(scope, id, { deletedAt: new Date() }, tx);
    await writeAudit({ ...audit(scope), action: 'expense.deleted', entityType: 'expense', entityId: id, beforeValue: { totalAmount: cur.totalAmount.toFixed(2) } }, tx);
  });
}

export async function summary(scope: AnyScope, q: z.infer<typeof expenseSummaryQuery>): Promise<ExpenseSummaryDto> {
  const currency = await getSettingValue<string>('finance.currency', 'SAR');
  const rows = await repo.summary(scope, q);
  const sum = (k: 'amount' | 'vat' | 'total') => toMoneyString(rows.reduce((a, r) => a.add(money(r[k])), new Decimal(0)));
  return {
    groupBy: q.groupBy, currency,
    rows: rows.map((r) => ({ key: r.key, label: r.label, count: r.count, amount: toMoneyString(money(r.amount)), vatAmount: toMoneyString(money(r.vat)), totalAmount: toMoneyString(money(r.total)) })),
    totals: { count: rows.reduce((a, r) => a + r.count, 0), amount: sum('amount'), vatAmount: sum('vat'), totalAmount: sum('total') },
  };
}
