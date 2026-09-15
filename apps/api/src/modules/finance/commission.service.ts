import type { Prisma } from '@prisma/client';
import type { AnyScope, MoneyString } from '@unigate/types';
import { BusinessRuleError } from '@/common/errors.js';
import { Decimal, money, round2, round4, toMoneyString } from '@/common/money.js';
import * as repo from './commission.repository.js';

/**
 * Commission resolution and the booking financial split (database.md §12.3, §12.8).
 * Award-time override → request-level override → rule (priority, then specificity). All money is
 * Prisma.Decimal, rounded half-up at each named step; the identity
 *   ownerNet + commission + commissionVat + paymentFee = gross
 * is asserted before anything is written.
 */

export const CALCULATION_VERSION = 1;

export interface CommissionOverride {
  type: 'NONE' | 'PERCENTAGE' | 'FIXED';
  value?: string | undefined;
  basis?: 'GROSS' | 'NET_OF_VAT' | undefined;
  reason: string;
  setByUserId?: string | null | undefined;
  setAt?: string | null | undefined;
}

export interface ResolvedCommission {
  source: 'RULE' | 'OVERRIDE' | 'NONE';
  type: 'NONE' | 'PERCENTAGE' | 'FIXED';
  /** A fraction for PERCENTAGE (0.1000 = 10 %, as stored in commission_rules.percentage_rate), absolute for FIXED, null for NONE. */
  value: Decimal | null;
  basis: 'GROSS' | 'NET_OF_VAT';
  minAmount: Decimal | null;
  maxAmount: Decimal | null;
  rule: repo.CommissionRuleRow | null;
  override: CommissionOverride | null;
}

const SPECIFICITY: Record<repo.CommissionRuleRow['scope'], number> = { OWNER_CATEGORY: 4, OWNER: 3, VEHICLE_CATEGORY: 2, GLOBAL: 1 };

/** Highest priority wins; ties go to the most specific scope. Exactly one GLOBAL rule always exists (seeded NONE). */
export function pickRule(rules: repo.CommissionRuleRow[]): repo.CommissionRuleRow | null {
  return [...rules].sort((a, b) => b.priority - a.priority || SPECIFICITY[b.scope] - SPECIFICITY[a.scope] || b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null;
}

export interface ResolveInput {
  ownerProfileId: string;
  vehicleCategoryId: string;
  transportType: 'PASSENGER' | 'GOODS';
  at: Date;
  awardOverride?: CommissionOverride | null | undefined;
  requestOverride?: CommissionOverride | null | undefined;
  basisDefault: 'GROSS' | 'NET_OF_VAT';
}

export async function resolveCommission(scope: AnyScope, input: ResolveInput, tx: Prisma.TransactionClient | null = null): Promise<ResolvedCommission> {
  const override = input.awardOverride ?? input.requestOverride ?? null;
  if (override) {
    // The API takes a percentage override as a percent (0–100); internally every rate is a fraction.
    const value = override.value ? (override.type === 'PERCENTAGE' ? round4(money(override.value).div(100)) : money(override.value)) : null;
    return { source: override.type === 'NONE' ? 'NONE' : 'OVERRIDE', type: override.type, value, basis: override.basis ?? input.basisDefault, minAmount: null, maxAmount: null, rule: null, override };
  }
  const rule = pickRule(await repo.listApplicableRules(scope, input, tx));
  if (!rule || rule.calculationType === 'NONE') return { source: 'NONE', type: 'NONE', value: null, basis: rule?.basis ?? input.basisDefault, minAmount: null, maxAmount: null, rule, override: null };
  return { source: 'RULE', type: rule.calculationType, value: rule.calculationType === 'PERCENTAGE' ? rule.percentageRate : rule.fixedAmount, basis: rule.basis, minAmount: rule.minAmount, maxAmount: rule.maxAmount, rule, override: null };
}

export interface FinancialInput {
  grossAmount: Decimal;
  vatRate: Decimal;
  vatAmount: Decimal;
  commission: ResolvedCommission;
  ownerIsVatRegistered: boolean;
  /** Payment fee is known only once a payment lands (Phase 9); zero at award. */
  paymentFeeAmount?: Decimal | undefined;
}

export interface FinancialFigures {
  grossAmount: Decimal;
  vatRate: Decimal;
  vatAmount: Decimal;
  netOfVatAmount: Decimal;
  commissionBasis: 'GROSS' | 'NET_OF_VAT' | null;
  commissionRate: Decimal | null;
  commissionAmount: Decimal;
  commissionSource: 'RULE' | 'OVERRIDE' | 'NONE';
  commissionVatAmount: Decimal;
  paymentFeeAmount: Decimal;
  ownerGrossAmount: Decimal;
  ownerNetAmount: Decimal;
  vatTreatment: 'DEEMED_SUPPLIER' | 'OWNER_IS_SUPPLIER';
}

/** Pure. Throws FINANCIAL_SNAPSHOT_UNBALANCED rather than let a row that does not add up be written. */
export function computeFinancials(input: FinancialInput): FinancialFigures {
  const gross = round2(input.grossAmount);
  const vat = round2(input.vatAmount);
  const net = gross.sub(vat);
  const c = input.commission;
  const basisAmount = c.basis === 'GROSS' ? gross : net;
  let commission = new Decimal(0);
  let rate: Decimal | null = null;
  if (c.type === 'PERCENTAGE' && c.value) {
    rate = round4(c.value);
    commission = round2(basisAmount.mul(rate));
  } else if (c.type === 'FIXED' && c.value) {
    commission = round2(c.value);
  }
  if (c.minAmount && commission.lt(c.minAmount)) commission = round2(c.minAmount);
  if (c.maxAmount && commission.gt(c.maxAmount)) commission = round2(c.maxAmount);
  if (commission.gt(gross)) commission = gross;
  // §12.8: commission is a taxable supply to a registered owner; under the deemed-supplier model it
  // is margin inside the customer price and carries no separate VAT.
  const vatTreatment = input.ownerIsVatRegistered ? 'OWNER_IS_SUPPLIER' : 'DEEMED_SUPPLIER';
  const commissionVat = vatTreatment === 'OWNER_IS_SUPPLIER' ? round2(commission.mul(input.vatRate)) : new Decimal(0);
  const paymentFee = round2(input.paymentFeeAmount ?? new Decimal(0));
  const ownerNet = gross.sub(commission).sub(commissionVat).sub(paymentFee);
  const sum = ownerNet.add(commission).add(commissionVat).add(paymentFee);
  if (!sum.eq(gross) || ownerNet.lt(0)) {
    throw new BusinessRuleError('FINANCIAL_SNAPSHOT_UNBALANCED', 'The financial split does not balance', { gross: gross.toFixed(2), ownerNet: ownerNet.toFixed(2), commission: commission.toFixed(2), commissionVat: commissionVat.toFixed(2), paymentFee: paymentFee.toFixed(2) });
  }
  return { grossAmount: gross, vatRate: round4(input.vatRate), vatAmount: vat, netOfVatAmount: net, commissionBasis: c.type === 'NONE' ? null : c.basis, commissionRate: rate, commissionAmount: commission, commissionSource: c.source, commissionVatAmount: commissionVat, paymentFeeAmount: paymentFee, ownerGrossAmount: gross, ownerNetAmount: ownerNet, vatTreatment };
}

/** What an owner is shown before bidding (FR-FINANCE-22): a percent for PERCENTAGE, an amount for FIXED. */
export function describeCommission(c: ResolvedCommission): { type: string; value: MoneyString | null; basis: string | null; source: string } {
  const value = c.value ? toMoneyString(c.type === 'PERCENTAGE' ? c.value.mul(100) : c.value) : null;
  return { type: c.type, value, basis: c.type === 'NONE' ? null : c.basis, source: c.source };
}

export function ruleSnapshot(c: ResolvedCommission): Record<string, unknown> {
  if (!c.rule) return {};
  const r = c.rule;
  return { id: r.id, name: r.name, scope: r.scope, calculationType: r.calculationType, percentageRate: r.percentageRate?.toString() ?? null, fixedAmount: r.fixedAmount?.toString() ?? null, basis: r.basis, minAmount: r.minAmount?.toString() ?? null, maxAmount: r.maxAmount?.toString() ?? null, priority: r.priority, effectiveFrom: r.effectiveFrom.toISOString(), effectiveTo: r.effectiveTo?.toISOString() ?? null };
}
