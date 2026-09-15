import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/** Ledger reads (api.md §8.21) — GLOBAL only (`ledger.read`); grouped by transaction so a page never splits a posting. */

export const ledgerEntrySelect = {
  id: true, transactionGroupId: true, direction: true, amount: true, currency: true, ownerProfileId: true, customerProfileId: true, bookingId: true, paymentId: true, refundId: true, settlementId: true, invoiceId: true, description: true, occurredAt: true,
  account: { select: { code: true, type: true } },
} satisfies Prisma.LedgerEntrySelect;
export type LedgerEntryRow = Prisma.LedgerEntryGetPayload<{ select: typeof ledgerEntrySelect }>;

export interface LedgerFilters {
  ledgerAccountCode?: string | undefined;
  bookingId?: string | undefined;
  paymentId?: string | undefined;
  settlementId?: string | undefined;
  invoiceId?: string | undefined;
  ownerProfileId?: string | undefined;
  customerProfileId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

function where(f: LedgerFilters): Prisma.LedgerEntryWhereInput {
  return {
    AND: [
      ...(f.ledgerAccountCode ? [{ account: { code: f.ledgerAccountCode } }] : []),
      ...(f.bookingId ? [{ bookingId: f.bookingId }] : []),
      ...(f.paymentId ? [{ paymentId: f.paymentId }] : []),
      ...(f.settlementId ? [{ settlementId: f.settlementId }] : []),
      ...(f.invoiceId ? [{ invoiceId: f.invoiceId }] : []),
      ...(f.ownerProfileId ? [{ ownerProfileId: f.ownerProfileId }] : []),
      ...(f.customerProfileId ? [{ customerProfileId: f.customerProfileId }] : []),
      ...(f.dateFrom ? [{ occurredAt: { gte: new Date(f.dateFrom) } }] : []),
      ...(f.dateTo ? [{ occurredAt: { lt: new Date(f.dateTo) } }] : []),
    ],
  };
}

/** Pages over transaction groups (newest first); every entry of a matched group is returned, not only the matching lines. */
export async function listGroups(_scope: AnyScope, f: LedgerFilters, page: { page: number; pageSize: number }): Promise<{ groups: LedgerEntryRow[][]; total: number }> {
  const w = where(f);
  const grouped = await prisma().ledgerEntry.groupBy({ by: ['transactionGroupId'], where: w, _max: { occurredAt: true }, orderBy: { _max: { occurredAt: 'desc' } }, skip: (page.page - 1) * page.pageSize, take: page.pageSize });
  const total = (await prisma().ledgerEntry.groupBy({ by: ['transactionGroupId'], where: w })).length;
  const ids = grouped.map((g) => g.transactionGroupId);
  if (!ids.length) return { groups: [], total };
  const rows = await prisma().ledgerEntry.findMany({ where: { transactionGroupId: { in: ids } }, select: ledgerEntrySelect, orderBy: [{ occurredAt: 'desc' }, { direction: 'asc' }] });
  const byGroup = new Map<string, LedgerEntryRow[]>();
  for (const r of rows) byGroup.set(r.transactionGroupId, [...(byGroup.get(r.transactionGroupId) ?? []), r]);
  return { groups: ids.map((id) => byGroup.get(id) ?? []), total };
}
