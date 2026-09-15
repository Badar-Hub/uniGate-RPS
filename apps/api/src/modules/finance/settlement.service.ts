import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, OwnerBalanceDto, SettlementDto, SettlementLineDto, SettlementPreviewDto } from '@unigate/types';
import type { addSettlementLineBody, createSettlementBody, paySettlementBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError, NotImplementedError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { Decimal, money, round2, toMoneyString } from '@/common/money.js';
import { isUniqueViolation, prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { ownerVatStatusOf, payoutAccountOf } from '@/modules/profiles/owner.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { toSettlementDto, toSettlementLineDto } from './finance.mapper.js';
import { ownerPayableBalance, postLedger } from './ledger.service.js';
import * as repo from './settlement.repository.js';

/**
 * Owner settlements (api.md §8.21, database.md §12.5). A settlement carries one BOOKING_EARNING
 * line per completed, funded booking whose hold has elapsed; the partial unique index makes a
 * second settlement of the same booking impossible. DRAFT → PENDING_APPROVAL → APPROVED → PAID,
 * four-eyes between submitter and approver, and the payout posts DEBIT OWNER_PAYABLE / CREDIT
 * CASH_BANK so the owner's ledger balance and the settlement history never disagree.
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

interface SettlementSettings {
  holdDays: number;
  minimumPayout: Decimal;
  requiresApproval: boolean;
  autoApproveBelow: Decimal | null;
  payoutRail: 'BANK_TRANSFER' | 'GATEWAY_PAYOUT';
  currency: string;
}
async function settings(): Promise<SettlementSettings> {
  const [holdDays, min, requiresApproval, autoBelow, payoutRail, currency] = await Promise.all([
    getSettingValue<number>('settlement.hold_days_after_completion', 3),
    getSettingValue<number>('settlement.minimum_payout_amount', 0),
    getSettingValue<boolean>('settlement.requires_approval', true),
    getSettingValue<number | null>('settlement.auto_approve_below_amount', null),
    getSettingValue<'BANK_TRANSFER' | 'GATEWAY_PAYOUT'>('settlement.payout_rail', 'BANK_TRANSFER'),
    getSettingValue<string>('finance.currency', 'SAR'),
  ]);
  return { holdDays, minimumPayout: money(min), requiresApproval, autoApproveBelow: autoBelow === null ? null : money(autoBelow), payoutRail, currency };
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function getSettlement(scope: AnyScope, id: string): Promise<SettlementDto> {
  const s = await repo.findSettlement(scope, id);
  if (!s) throw new NotFoundError();
  return toSettlementDto(s);
}

export async function listSettlements(scope: AnyScope, f: repo.SettlementFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listSettlements(scope, f, page);
  return { items: items.map(toSettlementDto), total };
}

export async function listLines(scope: AnyScope, id: string): Promise<SettlementLineDto[]> {
  const rows = await repo.listLines(scope, id);
  if (!rows) throw new NotFoundError();
  return rows.map(toSettlementLineDto);
}

/** Owners preview their own; staff name the owner. */
function ownerFor(scope: AnyScope, requested: string | undefined): string {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') {
    if (!requested) throw new BusinessRuleError('VALIDATION_FAILED', 'ownerProfileId is required', { field: 'ownerProfileId' });
    return requested;
  }
  const own = scope.actor.ownerProfileId;
  if (!own || (requested && requested !== own)) throw new NotFoundError();
  return own;
}

interface Assessment {
  eligible: repo.EligibleBooking[];
  held: (repo.EligibleBooking & { holdReason: string; eligibleAt: Date })[];
  eligibleAtOf: (b: repo.EligibleBooking) => Date;
}

async function assess(scope: AnyScope, ownerProfileId: string, from: Date, to: Date, s: SettlementSettings, now: Date, tx: Prisma.TransactionClient | null): Promise<Assessment> {
  // A-57: UniGate's own fleet is never settled — its bookings are transport revenue, not an owner payable.
  const owner = await ownerVatStatusOf(scope, ownerProfileId);
  if (!owner) throw new NotFoundError('NOT_FOUND', 'Owner not found');
  const rows = owner.isPlatformFleet ? [] : await repo.completedBookingsInPeriod(scope, ownerProfileId, from, to, tx);
  const eligibleAtOf = (b: repo.EligibleBooking) => new Date((b.completedAt ?? now).getTime() + s.holdDays * 86_400_000);
  const eligible: repo.EligibleBooking[] = [];
  const held: Assessment['held'] = [];
  for (const b of rows) {
    if (b.settled) continue;
    const eligibleAt = eligibleAtOf(b);
    if (!b.funded) held.push({ ...b, holdReason: 'PAYMENT_PENDING', eligibleAt });
    else if (eligibleAt > now) held.push({ ...b, holdReason: 'HOLD_PERIOD', eligibleAt });
    else eligible.push(b);
  }
  return { eligible, held, eligibleAtOf };
}

const sum = (rows: { ownerNetAmount: Decimal }[]) => rows.reduce((a, r) => a.add(r.ownerNetAmount), new Decimal(0));

export async function preview(scope: AnyScope, q: { ownerProfileId?: string | undefined; periodStart: string; periodEnd: string }): Promise<SettlementPreviewDto> {
  const ownerProfileId = ownerFor(scope, q.ownerProfileId);
  const s = await settings();
  const now = new Date();
  const a = await assess(scope, ownerProfileId, new Date(q.periodStart), new Date(q.periodEnd), s, now, null);
  const gross = a.eligible.reduce((x, b) => x.add(b.grossAmount), new Decimal(0));
  const net = sum(a.eligible);
  const deductions = (b: repo.EligibleBooking) => b.commissionAmount.add(b.commissionVatAmount).add(b.paymentFeeAmount);
  return {
    ownerProfileId, periodStart: q.periodStart, periodEnd: q.periodEnd, currency: s.currency,
    eligible: a.eligible.map((b) => ({ bookingId: b.id, bookingNumber: b.bookingNumber, completedAt: b.completedAt?.toISOString() ?? null, eligibleAt: a.eligibleAtOf(b).toISOString(), grossAmount: toMoneyString(b.grossAmount), deductions: toMoneyString(deductions(b)), ownerNetAmount: toMoneyString(b.ownerNetAmount) })),
    held: a.held.map((b) => ({ bookingId: b.id, bookingNumber: b.bookingNumber, completedAt: b.completedAt?.toISOString() ?? null, eligibleAt: b.eligibleAt.toISOString(), holdReason: b.holdReason, ownerNetAmount: toMoneyString(b.ownerNetAmount) })),
    grossAmount: toMoneyString(gross), commissionAmount: toMoneyString(gross.sub(net)), adjustmentsAmount: toMoneyString(0), netPayableAmount: toMoneyString(net), minimumPayoutAmount: toMoneyString(s.minimumPayout), belowMinimum: net.lt(s.minimumPayout),
  };
}

// ── build ────────────────────────────────────────────────────────────────────

export async function createSettlement(scope: ActorScope, body: z.infer<typeof createSettlementBody>): Promise<SettlementDto> {
  const s = await settings();
  const now = new Date();
  const from = new Date(body.periodStart);
  const to = new Date(body.periodEnd);
  const id = newId();
  try {
    await prisma().$transaction(async (tx) => {
      await repo.lockOwnerForSettlement(scope, body.ownerProfileId, tx);
      const a = await assess(scope, body.ownerProfileId, from, to, s, now, tx);
      if (!a.eligible.length) throw new BusinessRuleError('SETTLEMENT_NO_ELIGIBLE_LINES', 'No completed, funded booking past its hold in this period', { held: a.held.length, ...((await ownerVatStatusOf(scope, body.ownerProfileId))?.isPlatformFleet ? { reason: 'PLATFORM_FLEET' } : {}) });
      const gross = a.eligible.reduce((x, b) => x.add(b.grossAmount), new Decimal(0));
      const net = round2(sum(a.eligible));
      if (net.lt(s.minimumPayout)) throw new BusinessRuleError('SETTLEMENT_BELOW_MINIMUM', `Net payable ${net.toFixed(2)} is below the minimum payout ${s.minimumPayout.toFixed(2)}; the balance carries forward`, { netPayableAmount: net.toFixed(2), minimumPayoutAmount: s.minimumPayout.toFixed(2) });
      const settlementNumber = await repo.nextSettlementNumber(scope, tx);
      await tx.settlement.create({ data: { id, settlementNumber, ownerProfileId: body.ownerProfileId, periodStart: from, periodEnd: to, grossAmount: gross, commissionAmount: gross.sub(net), adjustmentsAmount: 0, netPayableAmount: net, currency: s.currency, status: 'DRAFT', notes: body.notes ?? null } });
      await tx.settlementLine.createMany({
        data: a.eligible.map((b) => ({ id: newId(), settlementId: id, bookingId: b.id, lineType: 'BOOKING_EARNING' as const, amount: b.ownerNetAmount, currency: b.currency, description: `Earnings for booking ${b.bookingNumber}`, holdReason: 'NONE' as const, eligibleAt: a.eligibleAtOf(b) })),
      });
      await writeAudit({ ...audit(scope), action: 'settlement.created', entityType: 'settlement', entityId: id, afterValue: { settlementNumber, ownerProfileId: body.ownerProfileId, periodStart: body.periodStart, periodEnd: body.periodEnd, lines: a.eligible.length, netPayableAmount: net.toFixed(2) } }, tx);
      await publishEvent('settlement', id, 'settlement.created', { settlementNumber, ownerProfileId: body.ownerProfileId, netPayableAmount: net.toFixed(2) }, tx);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError('SETTLEMENT_BOOKING_ALREADY_SETTLED', 'A booking in this period is already carried by another settlement');
    throw e;
  }
  return getSettlement(scope, id);
}

async function loadFor(scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<repo.SettlementRow> {
  await repo.lockSettlement(scope, id, tx);
  const s = await repo.findSettlement(scope, id, tx);
  if (!s) throw new NotFoundError();
  return s;
}

function assertStatus(s: repo.SettlementRow, allowed: repo.SettlementRow['status'][], to: string): void {
  if (!allowed.includes(s.status)) throw new BusinessRuleError('SETTLEMENT_INVALID_TRANSITION', `Settlement ${s.settlementNumber} is ${s.status}; cannot move to ${to}`, { from: s.status, to, allowed });
}

async function recomputeTotals(id: string, tx: Prisma.TransactionClient): Promise<void> {
  const lines = await tx.settlementLine.findMany({ where: { settlementId: id }, select: { lineType: true, amount: true } });
  const earnings = lines.filter((l) => l.lineType === 'BOOKING_EARNING').reduce((a, l) => a.add(l.amount), new Decimal(0));
  const adjustments = lines.filter((l) => l.lineType !== 'BOOKING_EARNING').reduce((a, l) => a.add(l.amount), new Decimal(0));
  const net = round2(earnings.add(adjustments));
  if (net.lt(0)) throw new BusinessRuleError('SETTLEMENT_BELOW_MINIMUM', 'Adjustments cannot take the net payable below zero', { netPayableAmount: net.toFixed(2) });
  await tx.settlement.update({ where: { id }, data: { adjustmentsAmount: adjustments, netPayableAmount: net } });
}

/** POST /settlements/{id}/lines — a manual ADJUSTMENT/PENALTY while DRAFT. */
export async function addLine(scope: ActorScope, id: string, body: z.infer<typeof addSettlementLineBody>): Promise<SettlementLineDto> {
  const lineId = newId();
  await prisma().$transaction(async (tx) => {
    const s = await loadFor(scope, id, tx);
    assertStatus(s, ['DRAFT'], 'add line');
    await tx.settlementLine.create({ data: { id: lineId, settlementId: id, lineType: body.lineType, amount: money(body.amount), currency: s.currency, description: body.description, holdReason: 'NONE' } });
    await recomputeTotals(id, tx);
    await writeAudit({ ...audit(scope), action: 'settlement.line_added', entityType: 'settlement', entityId: id, afterValue: { lineId, ...body } }, tx);
  });
  const row = await prisma().settlementLine.findUniqueOrThrow({ where: { id: lineId }, select: repo.settlementLineSelect });
  return toSettlementLineDto(row);
}

export async function submit(scope: ActorScope, id: string): Promise<SettlementDto> {
  const s = await settings();
  await prisma().$transaction(async (tx) => {
    const row = await loadFor(scope, id, tx);
    assertStatus(row, ['DRAFT'], 'PENDING_APPROVAL');
    const autoApprove = !s.requiresApproval || (s.autoApproveBelow !== null && row.netPayableAmount.lt(s.autoApproveBelow));
    await tx.settlement.update({ where: { id }, data: { status: autoApprove ? 'APPROVED' : 'PENDING_APPROVAL', ...(autoApprove ? { approvedByUserId: null } : {}) } });
    await writeAudit({ ...audit(scope), action: 'settlement.submitted', entityType: 'settlement', entityId: id, beforeValue: { status: row.status }, afterValue: { status: autoApprove ? 'APPROVED' : 'PENDING_APPROVAL', autoApproved: autoApprove, netPayableAmount: row.netPayableAmount.toFixed(2) } }, tx);
    await publishEvent('settlement', id, 'settlement.submitted', { settlementNumber: row.settlementNumber, ownerProfileId: row.ownerProfileId, autoApproved: autoApprove }, tx);
  });
  return getSettlement(scope, id);
}

export async function approve(scope: ActorScope, id: string, notes?: string): Promise<SettlementDto> {
  await prisma().$transaction(async (tx) => {
    const row = await loadFor(scope, id, tx);
    assertStatus(row, ['PENDING_APPROVAL'], 'APPROVED');
    const submitter = await repo.submitterOf(scope, id, tx);
    if (submitter && submitter === scope.actor.userId) throw new BusinessRuleError('SETTLEMENT_FOUR_EYES', 'The approver must differ from the person who submitted the settlement');
    await tx.settlement.update({ where: { id }, data: { status: 'APPROVED', approvedByUserId: scope.actor.userId, ...(notes ? { notes: row.notes ? `${row.notes}\n${notes}` : notes } : {}) } });
    await writeAudit({ ...audit(scope), action: 'settlement.approved', entityType: 'settlement', entityId: id, severity: 'NOTICE', beforeValue: { status: row.status }, afterValue: { status: 'APPROVED', notes: notes ?? null } }, tx);
    await publishEvent('settlement', id, 'settlement.approved', { settlementNumber: row.settlementNumber, ownerProfileId: row.ownerProfileId, netPayableAmount: row.netPayableAmount.toFixed(2) }, tx);
  });
  return getSettlement(scope, id);
}

export async function reject(scope: ActorScope, id: string, reason: string): Promise<SettlementDto> {
  await prisma().$transaction(async (tx) => {
    const row = await loadFor(scope, id, tx);
    assertStatus(row, ['PENDING_APPROVAL', 'APPROVED'], 'DRAFT');
    await tx.settlement.update({ where: { id }, data: { status: 'DRAFT', approvedByUserId: null, notes: row.notes ? `${row.notes}\nRejected: ${reason}` : `Rejected: ${reason}` } });
    await writeAudit({ ...audit(scope), action: 'settlement.rejected', entityType: 'settlement', entityId: id, beforeValue: { status: row.status }, afterValue: { status: 'DRAFT', reason } }, tx);
  });
  return getSettlement(scope, id);
}

/**
 * POST /settlements/{id}/pay — the payout. Needs a verified payout account past its cool-off
 * (A-47). On the BANK_TRANSFER rail the transfer is executed outside the platform and the
 * reference is what finance records, so the settlement lands in PAID here; the gateway payout
 * rail is not wired (501) — nothing pretends a transfer happened.
 */
export async function pay(scope: ActorScope, id: string, body: z.infer<typeof paySettlementBody>): Promise<SettlementDto> {
  const s = await settings();
  if (s.payoutRail !== 'BANK_TRANSFER') throw new NotImplementedError('SETTLEMENT_PAYOUT_RAIL_NOT_AVAILABLE', `The ${s.payoutRail} rail has no adapter yet; set settlement.payout_rail to BANK_TRANSFER`);
  const now = new Date();
  await prisma().$transaction(async (tx) => {
    const row = await loadFor(scope, id, tx);
    assertStatus(row, ['APPROVED'], 'PAID');
    const account = await payoutAccountOf(scope, row.ownerProfileId, body.bankAccountId ?? null);
    if (!account) throw new BusinessRuleError('SETTLEMENT_BANK_ACCOUNT_MISSING', 'The owner has no payout account', { reason: 'MISSING' });
    if (!account.isVerified) throw new BusinessRuleError('SETTLEMENT_BANK_ACCOUNT_MISSING', 'The payout account is not verified', { reason: 'UNVERIFIED', bankAccountId: account.id });
    if (account.activationAt > now) throw new BusinessRuleError('SETTLEMENT_BANK_ACCOUNT_MISSING', 'The payout account is inside its cool-off window', { reason: 'COOLOFF', bankAccountId: account.id, activationAt: account.activationAt.toISOString() });
    const balance = await ownerPayableBalance(row.ownerProfileId);
    if (balance.lt(row.netPayableAmount)) throw new BusinessRuleError('SETTLEMENT_INVALID_TRANSITION', 'The owner’s payable balance is below the settlement amount', { balance: balance.toFixed(2), netPayableAmount: row.netPayableAmount.toFixed(2) });
    await tx.settlement.update({ where: { id }, data: { status: 'PAID', bankAccountId: account.id, paymentReference: body.paymentReference, paidAt: now, ...(body.notes ? { notes: row.notes ? `${row.notes}\n${body.notes}` : body.notes } : {}) } });
    await postLedger({ description: `payout ${row.settlementNumber}`, occurredAt: now, currency: row.currency, settlementId: id, lines: [{ account: 'OWNER_PAYABLE', direction: 'DEBIT', amount: row.netPayableAmount, ownerProfileId: row.ownerProfileId }, { account: 'CASH_BANK', direction: 'CREDIT', amount: row.netPayableAmount, ownerProfileId: row.ownerProfileId }] }, tx);
    await writeAudit({ ...audit(scope), action: 'settlement.paid', entityType: 'settlement', entityId: id, severity: 'NOTICE', beforeValue: { status: row.status }, afterValue: { status: 'PAID', bankAccountId: account.id, ibanLast4: account.ibanLast4, paymentReference: body.paymentReference, netPayableAmount: row.netPayableAmount.toFixed(2) } }, tx);
    await publishEvent('settlement', id, 'settlement.paid', { settlementNumber: row.settlementNumber, ownerProfileId: row.ownerProfileId, netPayableAmount: row.netPayableAmount.toFixed(2), ibanLast4: account.ibanLast4 }, tx);
  });
  return getSettlement(scope, id);
}

// ── balances ─────────────────────────────────────────────────────────────────

export async function ownerBalance(scope: AnyScope, ownerProfileId: string): Promise<OwnerBalanceDto> {
  const [balance, inFlight, currency] = await Promise.all([ownerPayableBalance(ownerProfileId), repo.inFlightTotal(scope, ownerProfileId), getSettingValue<string>('finance.currency', 'SAR')]);
  return { ownerProfileId, accountCode: 'OWNER_PAYABLE', balance: toMoneyString(balance), currency, inFlightSettlements: toMoneyString(inFlight), asOf: new Date().toISOString() };
}

/** Expense immutability: the expense date falls inside a PAID settlement period of the owner. */
export async function isExpenseLocked(scope: AnyScope, ownerProfileId: string, expenseDate: Date): Promise<boolean> {
  return repo.paidSettlementCovering(scope, ownerProfileId, expenseDate);
}
