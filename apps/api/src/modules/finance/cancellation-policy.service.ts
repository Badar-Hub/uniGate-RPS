import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { Decimal, money, round2 } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';

/**
 * Cancellation / no-show charging (database.md §10.3, OQ-05 answered): standing admin policies,
 * resolved like commission rules (specificity → priority → effective date), plus a per-case
 * override. Percentages here are percents (0–100, the DB CHECK), applied to the booking total.
 * Production seeds NONE for every (event, role) pair — nobody is charged until an admin decides.
 */

export interface PolicyRow {
  id: string;
  name: string;
  eventType: 'CANCELLATION' | 'NO_SHOW';
  cancelledByRole: 'CUSTOMER' | 'OWNER';
  scope: 'GLOBAL' | 'VEHICLE_CATEGORY' | 'CUSTOMER' | 'OWNER';
  chargeType: 'NONE' | 'PERCENTAGE' | 'FIXED';
  value: Decimal | null;
  tiers: unknown;
  noCancelWindowHours: Decimal | null;
  priority: number;
  effectiveFrom: Date;
}

export interface FeeOverride {
  type: 'NONE' | 'PERCENTAGE' | 'FIXED';
  value?: string | undefined;
  reason: string;
  setByUserId?: string | null | undefined;
}

export interface FeeVerdict {
  feeAmount: Decimal;
  refundAmount: Decimal;
  feeSource: 'RULE' | 'OVERRIDE' | 'NONE';
  windowPassed: boolean;
  ruleSnapshot: Record<string, unknown>;
  overrideSnapshot: Record<string, unknown> | null;
}

interface Tier {
  minHoursBeforePickup: number;
  chargeType: 'NONE' | 'PERCENTAGE' | 'FIXED';
  value?: string | number | null;
}

const SPECIFICITY: Record<PolicyRow['scope'], number> = { CUSTOMER: 4, OWNER: 4, VEHICLE_CATEGORY: 2, GLOBAL: 1 };

export async function resolvePolicy(_scope: AnyScope, input: { eventType: 'CANCELLATION' | 'NO_SHOW'; role: 'CUSTOMER' | 'OWNER'; customerProfileId: string; ownerProfileId: string; vehicleCategoryId: string | null; at: Date }, tx: Prisma.TransactionClient | null = null): Promise<PolicyRow | null> {
  const db = tx ?? prisma();
  const rows = await db.cancellationPolicy.findMany({
    where: {
      isActive: true, eventType: input.eventType, cancelledByRole: input.role, effectiveFrom: { lte: input.at },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.at } }] },
        { OR: [{ scope: 'GLOBAL' }, ...(input.vehicleCategoryId ? [{ scope: 'VEHICLE_CATEGORY' as const, vehicleCategoryId: input.vehicleCategoryId }] : []), { scope: 'CUSTOMER', customerProfileId: input.customerProfileId }, { scope: 'OWNER', ownerProfileId: input.ownerProfileId }] },
      ],
    },
    select: { id: true, name: true, eventType: true, cancelledByRole: true, scope: true, chargeType: true, value: true, tiers: true, noCancelWindowHours: true, priority: true, effectiveFrom: true },
  });
  return rows.sort((a, b) => b.priority - a.priority || SPECIFICITY[b.scope] - SPECIFICITY[a.scope] || b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null;
}

function charge(total: Decimal, type: 'NONE' | 'PERCENTAGE' | 'FIXED', value: Decimal | null): Decimal {
  if (type === 'PERCENTAGE' && value) return round2(total.mul(value).div(100));
  if (type === 'FIXED' && value) return round2(value);
  return new Decimal(0);
}

/** Tiers are ordered by minHoursBeforePickup descending; the first whose floor the notice clears applies. */
function tierFor(tiers: unknown, hoursBefore: Decimal): Tier | null {
  if (!Array.isArray(tiers)) return null;
  const list = (tiers as Tier[]).filter((t) => typeof t.minHoursBeforePickup === 'number').sort((a, b) => b.minHoursBeforePickup - a.minHoursBeforePickup);
  return list.find((t) => hoursBefore.gte(t.minHoursBeforePickup)) ?? list[list.length - 1] ?? null;
}

/** Pure: the fee the policy (or override) charges for this notice. */
export function computeFee(input: { total: Decimal; hoursBeforePickup: Decimal; policy: PolicyRow | null; override?: FeeOverride | null | undefined }): FeeVerdict {
  const total = round2(input.total);
  if (input.override) {
    const fee = Decimal.min(charge(total, input.override.type, input.override.value ? money(input.override.value) : null), total);
    return { feeAmount: fee, refundAmount: total.sub(fee), feeSource: input.override.type === 'NONE' ? 'NONE' : 'OVERRIDE', windowPassed: false, ruleSnapshot: {}, overrideSnapshot: { type: input.override.type, value: input.override.value ?? null, reason: input.override.reason, setByUserId: input.override.setByUserId ?? null } };
  }
  const p = input.policy;
  if (!p) return { feeAmount: new Decimal(0), refundAmount: total, feeSource: 'NONE', windowPassed: false, ruleSnapshot: {}, overrideSnapshot: null };
  const windowPassed = Boolean(p.noCancelWindowHours && input.hoursBeforePickup.lt(p.noCancelWindowHours));
  const tier = tierFor(p.tiers, input.hoursBeforePickup);
  const fee = tier ? Decimal.min(charge(total, tier.chargeType, tier.value !== null && tier.value !== undefined ? money(tier.value) : null), total) : Decimal.min(charge(total, p.chargeType, p.value), total);
  const source = fee.gt(0) ? 'RULE' : 'NONE';
  const ruleSnapshot = { policyId: p.id, name: p.name, scope: p.scope, eventType: p.eventType, cancelledByRole: p.cancelledByRole, chargeType: tier ? tier.chargeType : p.chargeType, value: tier ? (tier.value ?? null) : (p.value?.toString() ?? null), tier: tier ? { minHoursBeforePickup: tier.minHoursBeforePickup } : null, noCancelWindowHours: p.noCancelWindowHours?.toString() ?? null, openQuestion: 'OQ-05' };
  return { feeAmount: fee, refundAmount: total.sub(fee), feeSource: source, windowPassed, ruleSnapshot, overrideSnapshot: null };
}
