import type { Prisma } from '@prisma/client';
import type { AnyScope, LedgerGroupDto } from '@unigate/types';
import { AppError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { Decimal, round2 } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { toLedgerGroupDto } from './finance.mapper.js';
import { listGroups, type LedgerFilters } from './ledger.repository.js';

/**
 * Double-entry ledger (database.md §12.4). Append-only; corrections are reversing entries. Every
 * posting is one transaction group whose debits equal its credits — asserted before the write and
 * refused with LEDGER_UNBALANCED (a calculation defect) otherwise.
 */

export type LedgerAccountCode =
  | 'CASH_GATEWAY' | 'CASH_BANK' | 'CUSTOMER_RECEIVABLE' | 'VAT_RECOVERABLE' | 'OWNER_PAYABLE' | 'VAT_PAYABLE' | 'SPO_COMMISSION_PAYABLE' | 'BAD_DEBT_PROVISION'
  | 'PLATFORM_COMMISSION_REVENUE' | 'TRANSPORT_REVENUE' | 'PAYMENT_PROCESSING_FEES' | 'SUBCONTRACTED_TRANSPORT_COST' | 'REFUNDS_ISSUED' | 'BAD_DEBT_EXPENSE';

export interface LedgerLine {
  account: LedgerAccountCode;
  direction: 'DEBIT' | 'CREDIT';
  amount: Decimal;
  ownerProfileId?: string | null;
  customerProfileId?: string | null;
}

export interface LedgerPosting {
  description: string;
  occurredAt: Date;
  currency: string;
  bookingId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  settlementId?: string | null;
  invoiceId?: string | null;
  lines: LedgerLine[];
}

/** 500 — a calculation defect, never a client error (api.md §4). */
class LedgerUnbalancedError extends AppError {
  readonly status = 500;
  override readonly expose = false;
  constructor(message: string) {
    super('LEDGER_UNBALANCED', message);
  }
}

const accountIds = new Map<string, string>();

async function accountId(code: LedgerAccountCode, tx: Prisma.TransactionClient): Promise<string> {
  const hit = accountIds.get(code);
  if (hit) return hit;
  const row = await tx.ledgerAccount.findUnique({ where: { code }, select: { id: true } });
  if (!row) throw new LedgerUnbalancedError(`ledger account ${code} is not seeded`);
  accountIds.set(code, row.id);
  return row.id;
}

/** Writes one balanced transaction group; returns its id. Zero-amount lines are dropped. */
export async function postLedger(posting: LedgerPosting, tx: Prisma.TransactionClient): Promise<string> {
  const lines = posting.lines.map((l) => ({ ...l, amount: round2(l.amount) })).filter((l) => l.amount.gt(0));
  const debits = lines.filter((l) => l.direction === 'DEBIT').reduce((a, l) => a.add(l.amount), new Decimal(0));
  const credits = lines.filter((l) => l.direction === 'CREDIT').reduce((a, l) => a.add(l.amount), new Decimal(0));
  if (!debits.eq(credits)) throw new LedgerUnbalancedError(`debits ${debits.toFixed(2)} ≠ credits ${credits.toFixed(2)} for "${posting.description}"`);
  const groupId = newId();
  if (!lines.length) return groupId;
  const rows: Prisma.LedgerEntryCreateManyInput[] = [];
  for (const l of lines) {
    rows.push({
      id: newId(), transactionGroupId: groupId, ledgerAccountId: await accountId(l.account, tx), direction: l.direction, amount: l.amount, currency: posting.currency,
      ownerProfileId: l.ownerProfileId ?? null, customerProfileId: l.customerProfileId ?? null, bookingId: posting.bookingId ?? null, paymentId: posting.paymentId ?? null, refundId: posting.refundId ?? null, settlementId: posting.settlementId ?? null, invoiceId: posting.invoiceId ?? null,
      description: posting.description, occurredAt: posting.occurredAt,
    });
  }
  await tx.ledgerEntry.createMany({ data: rows });
  return groupId;
}

/** Owner balance = credits − debits over OWNER_PAYABLE (one query, never drifts). */
export async function ownerPayableBalance(ownerProfileId: string): Promise<Decimal> {
  const rows = await prisma().$queryRaw<{ balance: string | null }[]>`
    SELECT COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END), 0)::text AS balance
    FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.ledger_account_id
    WHERE a.code = 'OWNER_PAYABLE' AND e.owner_profile_id = ${ownerProfileId}::uuid`;
  return new Decimal(rows[0]?.balance ?? '0');
}

export function resetLedgerCacheForTests(): void {
  accountIds.clear();
}

// ── reads (api.md §8.21) ─────────────────────────────────────────────────────

export async function listLedgerGroups(scope: AnyScope, f: LedgerFilters, page: { page: number; pageSize: number }): Promise<{ items: LedgerGroupDto[]; total: number }> {
  const { groups, total } = await listGroups(scope, f, page);
  return { items: groups.filter((g) => g.length).map(toLedgerGroupDto), total };
}
