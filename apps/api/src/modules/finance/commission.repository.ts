import type { Prisma } from '@prisma/client';
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
