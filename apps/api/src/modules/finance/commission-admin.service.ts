import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, CommissionEarningsDto, CommissionPreviewDto, CommissionRuleDto, RequestCommissionDto } from '@unigate/types';
import type { commissionEarningsQuery, commissionPreviewBody, createCommissionRuleBody, patchCommissionRuleBody, requestCommissionBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { Decimal, money, round2, round4, toMoneyString } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { countBidsOnRequest, requestOverride } from '@/modules/bidding/bid.service.js';
import { requestRowForBidding, setRequestCommissionOverride } from '@/modules/demand/trip-request.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { ownerVatStatusOf } from '@/modules/profiles/owner.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { computeFinancials, describeCommission, resolveCommission, type CommissionOverride } from './commission.service.js';
import { toCommissionRuleDto } from './finance.mapper.js';
import * as repo from './commission.repository.js';

/**
 * Commission administration (api.md §8.20): rules CRUD with the "exactly one active GLOBAL rule"
 * invariant, the per-request override with its guards, a dry-run preview and the earnings view.
 * Editing a rule never rewrites history — snapshots hold their own frozen copy (D6).
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

const patch = <T>(v: T | undefined, cur: T): T => (v === undefined ? cur : v); // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- null is a valid patch value

/** API percent (0–100) → stored fraction (4 dp). */
const pctToFraction = (pct: string | null | undefined): Decimal | null => (pct === null || pct === undefined ? null : round4(money(pct).div(100)));

export async function listRules(scope: AnyScope, f: repo.RuleFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listRules(scope, f, page);
  return { items: items.map(toCommissionRuleDto), total };
}

export async function getRule(scope: AnyScope, id: string): Promise<CommissionRuleDto> {
  const r = await repo.findRule(scope, id);
  if (!r) throw new NotFoundError();
  return toCommissionRuleDto(r);
}

async function assertNoOverlap(scope: AnyScope, r: Parameters<typeof repo.findOverlapping>[1], tx: Prisma.TransactionClient): Promise<void> {
  const dup = await repo.findOverlapping(scope, r, tx);
  if (dup) throw new ConflictError('COMMISSION_RULE_OVERLAP', `Rule "${dup.name}" already covers this scope for an overlapping window`, { conflictingRuleId: dup.id });
}

export async function createRule(scope: ActorScope, body: z.infer<typeof createCommissionRuleBody>): Promise<CommissionRuleDto> {
  const basisDefault = await getSettingValue<'GROSS' | 'NET_OF_VAT'>('finance.commission_basis_default', 'NET_OF_VAT');
  const id = newId();
  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
  const effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : null;
  const target = { id: null, scope: body.scope, vehicleCategoryId: body.vehicleCategoryId ?? null, ownerProfileId: body.ownerProfileId ?? null, transportType: body.transportType ?? null, effectiveFrom, effectiveTo };
  const row = await prisma().$transaction(async (tx) => {
    // A second active GLOBAL rule would violate ck_commission_rules_global; refuse it as a clear 409 rather than a 500.
    if (body.scope === 'GLOBAL' && body.isActive && (await repo.countActiveGlobal(scope, null, tx)) > 0) throw new ConflictError('COMMISSION_RULE_OVERLAP', 'Exactly one active GLOBAL rule may exist; edit or deactivate the current one first');
    await assertNoOverlap(scope, target, tx);
    const created = await repo.createRule(scope, {
      id, name: body.name, scope: body.scope, vehicleCategoryId: target.vehicleCategoryId, ownerProfileId: target.ownerProfileId, transportType: target.transportType, calculationType: body.calculationType,
      percentageRate: body.calculationType === 'PERCENTAGE' ? pctToFraction(body.percentageRate) : null, fixedAmount: body.calculationType === 'FIXED' ? money(body.fixedAmount ?? '0.00') : null,
      basis: body.basis ?? basisDefault, minAmount: body.minAmount ? money(body.minAmount) : null, maxAmount: body.maxAmount ? money(body.maxAmount) : null, priority: body.priority, effectiveFrom, effectiveTo, isActive: body.isActive, createdByUserId: scope.actor.userId,
    }, tx);
    await writeAudit({ ...audit(scope), action: 'commission_rule.created', entityType: 'commission_rule', entityId: id, severity: 'NOTICE', afterValue: { ...body } }, tx);
    return created;
  });
  return toCommissionRuleDto(row);
}

export async function patchRule(scope: ActorScope, id: string, body: z.infer<typeof patchCommissionRuleBody>): Promise<CommissionRuleDto> {
  const row = await prisma().$transaction(async (tx) => {
    const cur = await repo.findRule(scope, id, tx);
    if (!cur) throw new NotFoundError();
    const next = {
      scope: body.scope ?? cur.scope, vehicleCategoryId: body.vehicleCategoryId === undefined ? cur.vehicleCategoryId : body.vehicleCategoryId, ownerProfileId: body.ownerProfileId === undefined ? cur.ownerProfileId : body.ownerProfileId,
      transportType: patch(body.transportType, cur.transportType), effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : cur.effectiveFrom, effectiveTo: body.effectiveTo === undefined ? cur.effectiveTo : body.effectiveTo ? new Date(body.effectiveTo) : null,
      isActive: body.isActive ?? cur.isActive, calculationType: body.calculationType ?? cur.calculationType,
    };
    const wasGlobalActive = cur.scope === 'GLOBAL' && cur.isActive;
    const willBeGlobalActive = next.scope === 'GLOBAL' && next.isActive;
    if (wasGlobalActive && !willBeGlobalActive && (await repo.countActiveGlobal(scope, id, tx)) === 0) throw new BusinessRuleError('COMMISSION_GLOBAL_RULE_REQUIRED', 'The platform must keep one active GLOBAL rule; create its replacement first');
    if (!wasGlobalActive && willBeGlobalActive && (await repo.countActiveGlobal(scope, id, tx)) > 0) throw new ConflictError('COMMISSION_RULE_OVERLAP', 'Exactly one active GLOBAL rule may exist');
    if (next.isActive) await assertNoOverlap(scope, { id, ...next }, tx);
    const pct = body.percentageRate !== undefined ? pctToFraction(body.percentageRate) : undefined;
    const updated = await repo.updateRule(scope, id, {
      ...(body.name !== undefined ? { name: body.name } : {}), scope: next.scope, vehicleCategoryId: next.vehicleCategoryId, ownerProfileId: next.ownerProfileId, transportType: next.transportType, calculationType: next.calculationType,
      ...(pct !== undefined ? { percentageRate: pct } : {}), ...(body.fixedAmount !== undefined ? { fixedAmount: body.fixedAmount === null ? null : money(body.fixedAmount) } : {}),
      ...(next.calculationType === 'NONE' ? { percentageRate: null, fixedAmount: null } : {}),
      ...(body.basis !== undefined ? { basis: body.basis } : {}), ...(body.minAmount !== undefined ? { minAmount: body.minAmount === null ? null : money(body.minAmount) } : {}), ...(body.maxAmount !== undefined ? { maxAmount: body.maxAmount === null ? null : money(body.maxAmount) } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}), effectiveFrom: next.effectiveFrom, effectiveTo: next.effectiveTo, isActive: next.isActive,
    }, tx);
    await writeAudit({ ...audit(scope), action: 'commission_rule.updated', entityType: 'commission_rule', entityId: id, severity: 'NOTICE', beforeValue: { ...cur, percentageRate: cur.percentageRate?.toString() ?? null, fixedAmount: cur.fixedAmount?.toString() ?? null, minAmount: cur.minAmount?.toString() ?? null, maxAmount: cur.maxAmount?.toString() ?? null }, afterValue: { ...body } }, tx);
    return updated;
  });
  return toCommissionRuleDto(row);
}

/** DELETE = deactivate (rules are referenced by snapshots and never physically removed). */
export async function deactivateRule(scope: ActorScope, id: string): Promise<void> {
  await patchRule(scope, id, { isActive: false });
}

export async function previewCommission(scope: AnyScope, body: z.infer<typeof commissionPreviewBody>): Promise<CommissionPreviewDto> {
  const owner = await ownerVatStatusOf(scope, body.ownerProfileId);
  if (!owner) throw new NotFoundError('NOT_FOUND', 'Owner not found');
  const [basisDefault, vatPct, currency] = await Promise.all([getSettingValue<'GROSS' | 'NET_OF_VAT'>('finance.commission_basis_default', 'NET_OF_VAT'), getSettingValue<number>('finance.vat_rate_pct', 15), getSettingValue<string>('finance.currency', 'SAR')]);
  let reqOverride: CommissionOverride | null = null;
  if (body.tripRequestId) {
    const r = await requestRowForBidding(scope, body.tripRequestId);
    if (!r) throw new NotFoundError('NOT_FOUND', 'Trip request not found');
    reqOverride = requestOverride(r);
  }
  const at = body.at ? new Date(body.at) : new Date();
  const c = await resolveCommission(scope, { ownerProfileId: body.ownerProfileId, vehicleCategoryId: body.vehicleCategoryId, transportType: body.transportType, at, awardOverride: body.commissionOverride ?? null, requestOverride: reqOverride, basisDefault });
  const gross = round2(money(body.grossAmount));
  const vatRate = round4(money(vatPct).div(100));
  // The gross on the API is VAT-inclusive (a booking total); back out the VAT the way award does.
  const net = round2(gross.div(new Decimal(1).add(vatRate)));
  const vat = gross.sub(net);
  const f = computeFinancials({ grossAmount: gross, vatRate, vatAmount: vat, commission: c, ownerIsVatRegistered: owner.isVatRegistered });
  const d = describeCommission(c);
  return {
    source: c.source, type: d.type, value: d.value, basis: d.basis, ruleId: c.rule?.id ?? null, ruleName: c.rule?.name ?? null,
    grossAmount: toMoneyString(f.grossAmount), vatAmount: toMoneyString(f.vatAmount), netOfVatAmount: toMoneyString(f.netOfVatAmount), commissionAmount: toMoneyString(f.commissionAmount), commissionVatAmount: toMoneyString(f.commissionVatAmount), ownerNetAmount: toMoneyString(f.ownerNetAmount), vatTreatment: f.vatTreatment, currency,
  };
}

// ── per-request override (PATCH /trip-requests/{id}/commission) ─────────────

async function requestCommissionDto(scope: AnyScope, tripRequestId: string): Promise<RequestCommissionDto> {
  const r = await requestRowForBidding(scope, tripRequestId);
  if (!r) throw new NotFoundError();
  const o = requestOverride(r);
  const bids = await countBidsOnRequest(scope, tripRequestId);
  let effective: RequestCommissionDto['effectiveCommission'] = null;
  if (r.vehicleCategoryId) {
    const basisDefault = await getSettingValue<'GROSS' | 'NET_OF_VAT'>('finance.commission_basis_default', 'NET_OF_VAT');
    // Without an owner the rule set is the GLOBAL/category one — the figure every invited owner sees before bidding.
    const c = await resolveCommission(scope, { ownerProfileId: '00000000-0000-0000-0000-000000000000', vehicleCategoryId: r.vehicleCategoryId, transportType: r.transportType, at: new Date(), requestOverride: o, basisDefault });
    effective = describeCommission(c);
  }
  return {
    tripRequestId, bidsExist: bids > 0, effectiveCommission: effective,
    override: o ? { type: o.type, value: o.value ? toMoneyString(money(o.value)) : null, basis: o.basis ?? null, reason: o.reason, setByUserId: o.setByUserId ?? null, setAt: o.setAt ?? null } : null,
  };
}

export async function getRequestCommission(scope: AnyScope, tripRequestId: string): Promise<RequestCommissionDto> {
  return requestCommissionDto(scope, tripRequestId);
}

/** Commission "size" for the after-bids comparison: a percent or an amount is comparable only within its own type. */
function overrideMagnitude(o: { type: string; value?: string | null | undefined }): Decimal {
  return o.type === 'NONE' ? new Decimal(0) : money(o.value ?? '0');
}

export async function setRequestCommission(scope: ActorScope, tripRequestId: string, body: z.infer<typeof requestCommissionBody>): Promise<RequestCommissionDto> {
  const r = await requestRowForBidding(scope, tripRequestId);
  if (!r) throw new NotFoundError();
  if (r.status === 'CANCELLED' || r.status === 'EXPIRED' || r.status === 'COMPLETED' || r.status === 'CLOSED_PARTIAL') throw new BusinessRuleError('COMMISSION_OVERRIDE_LOCKED', `Request is ${r.status}; its commission can no longer change`, { status: r.status });
  const current = requestOverride(r);
  const next = body.override;
  if (next && next.type !== 'NONE' && (next.value === undefined || money(next.value).lte(0))) throw new BusinessRuleError('COMMISSION_OVERRIDE_INVALID', `${next.type} needs a positive value`);
  const bids = await countBidsOnRequest(scope, tripRequestId);
  if (bids > 0) {
    // Owners priced against what they were shown: once bids exist the override may only lower the commission (or clear it), never raise it.
    if (next && next.type !== current?.type) {
      if (next.type !== 'NONE') throw new BusinessRuleError('COMMISSION_OVERRIDE_AFTER_BIDS', 'Bids exist: the override may only lower the commission — same type with a smaller value, or NONE');
    } else if (next && current && overrideMagnitude(next).gt(overrideMagnitude(current))) {
      throw new BusinessRuleError('COMMISSION_OVERRIDE_AFTER_BIDS', 'Bids exist: the override may only lower the commission', { current: current.value ?? null, requested: next.value ?? null });
    }
    if (!next && current) throw new BusinessRuleError('COMMISSION_OVERRIDE_AFTER_BIDS', 'Bids exist: clearing the override would change what owners priced against; lower it instead');
  }
  await prisma().$transaction(async (tx) => {
    await setRequestCommissionOverride(scope, tripRequestId, next ? { type: next.type, value: next.type === 'NONE' ? null : money(next.value ?? '0'), basis: next.basis ?? null, reason: next.reason } : null, tx);
    await writeAudit({ ...audit(scope), action: 'trip_request.commission_override', entityType: 'trip_request', entityId: tripRequestId, severity: 'NOTICE', beforeValue: { override: current }, afterValue: { override: next, bidsExisted: bids > 0 } }, tx);
  });
  return requestCommissionDto(scope, tripRequestId);
}

// ── earnings ─────────────────────────────────────────────────────────────────

export async function earnings(scope: AnyScope, q: z.infer<typeof commissionEarningsQuery>): Promise<CommissionEarningsDto> {
  const currency = await getSettingValue<string>('finance.currency', 'SAR');
  const rows = await repo.earnings(scope, q);
  const sum = (k: 'gross' | 'commission' | 'commissionVat' | 'ownerNet') => toMoneyString(rows.reduce((a, r) => a.add(money(r[k])), new Decimal(0)));
  return {
    groupBy: q.groupBy, currency,
    rows: rows.map((r) => ({ key: r.key, label: r.label, bookingCount: r.bookingCount, grossAmount: toMoneyString(money(r.gross)), commissionAmount: toMoneyString(money(r.commission)), commissionVatAmount: toMoneyString(money(r.commissionVat)), ownerNetAmount: toMoneyString(money(r.ownerNet)) })),
    totals: { bookingCount: rows.reduce((a, r) => a + r.bookingCount, 0), grossAmount: sum('gross'), commissionAmount: sum('commission'), commissionVatAmount: sum('commissionVat'), ownerNetAmount: sum('ownerNet') },
  };
}
