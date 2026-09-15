import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';
import { money, type Decimal } from '@/common/money.js';

/**
 * Customer + corporate profiles (database.md §6.2, §12.6). Scope: a customer sees their own
 * profile; `customers.read` (GLOBAL) sees all. PARTY scope (an owner reading the customer on
 * a shared booking) arrives in Phase 8 with bookings.
 */

export const corporateSelect = {
  id: true, companyNameEn: true, companyNameAr: true, crNumber: true,
  addressBuildingNumber: true, addressStreetEn: true, addressStreetAr: true, addressDistrictEn: true, addressDistrictAr: true,
  addressCityId: true, addressPostalCode: true, addressAdditionalNumber: true, addressShortCode: true,
  contactPersonName: true, contactPersonPhone: true, contactPersonEmail: true,
  creditStatus: true, creditLimitAmount: true, creditTermsDays: true, billingCycle: true, creditApprovedByUserId: true, creditApprovedAt: true,
  creditSuspendedReason: true, invoiceLineGranularity: true, isVerified: true, createdAt: true, updatedAt: true,
} satisfies Prisma.CorporateCustomerProfileSelect;

export const customerSelect = {
  id: true, userId: true, customerType: true, vatNumber: true, vatNumberVerifiedAt: true, defaultCityId: true,
  ratingAvg: true, ratingCount: true, totalBookings: true, acquiredBySpoId: true, createdAt: true, updatedAt: true,
  user: { select: { fullNameEn: true, fullNameAr: true, phoneE164: true, email: true, status: true, deletedAt: true } },
  corporate: { select: corporateSelect },
  // The first invoice issued against the VAT number locks it (api.md §8.4).
  invoices: { where: { status: { notIn: ['DRAFT'] } }, select: { issueDate: true, invoiceNumber: true }, orderBy: { issueDate: 'asc' }, take: 1 },
} satisfies Prisma.CustomerProfileSelect;

export type CustomerRow = Prisma.CustomerProfileGetPayload<{ select: typeof customerSelect }>;

function scopeWhere(scope: AnyScope): Prisma.CustomerProfileWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  return { id: scope.actor.customerProfileId ?? '00000000-0000-0000-0000-000000000000' };
}

export async function findCustomer(scope: AnyScope, id: string): Promise<CustomerRow | null> {
  return prisma().customerProfile.findFirst({ where: { AND: [{ id }, scopeWhere(scope)], user: { deletedAt: null } }, select: customerSelect });
}

export interface CustomerFilters {
  customerType?: string | undefined;
  cityId?: string | undefined;
  acquiredBySpoId?: string | undefined;
  creditStatus?: string | undefined;
  billingCycle?: string | undefined;
  hasVatNumber?: boolean | undefined;
  q?: string | undefined;
}

export async function listCustomers(scope: AnyScope, f: CustomerFilters, page: { page: number; pageSize: number }): Promise<{ items: CustomerRow[]; total: number }> {
  const where: Prisma.CustomerProfileWhereInput = {
    ...scopeWhere(scope),
    user: { deletedAt: null },
    ...(f.customerType ? { customerType: f.customerType as CustomerRow['customerType'] } : {}),
    ...(f.cityId ? { defaultCityId: f.cityId } : {}),
    ...(f.acquiredBySpoId ? { acquiredBySpoId: f.acquiredBySpoId } : {}),
    ...(f.creditStatus ? { corporate: { creditStatus: f.creditStatus as NonNullable<CustomerRow['corporate']>['creditStatus'] } } : {}),
    ...(f.billingCycle ? { corporate: { billingCycle: f.billingCycle as NonNullable<CustomerRow['corporate']>['billingCycle'] } } : {}),
    ...(f.hasVatNumber === true ? { vatNumber: { not: null } } : f.hasVatNumber === false ? { vatNumber: null } : {}),
    ...(f.q
      ? {
          OR: [
            { user: { fullNameEn: { contains: f.q, mode: 'insensitive' } } },
            { user: { fullNameAr: { contains: f.q } } },
            { user: { email: { contains: f.q, mode: 'insensitive' } } },
            { user: { phoneE164: { contains: f.q } } },
            { corporate: { companyNameEn: { contains: f.q, mode: 'insensitive' } } },
            { corporate: { companyNameAr: { contains: f.q } } },
            { corporate: { crNumber: { contains: f.q } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma().customerProfile.findMany({ where, select: customerSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().customerProfile.count({ where }),
  ]);
  return { items, total };
}

/**
 * Outstanding receivable = Σ debits − Σ credits over CUSTOMER_RECEIVABLE in ledger_entries for
 * this customer — computed on read, never cached in a column (database.md §12.6).
 */
export async function outstandingReceivable(_scope: AnyScope, customerProfileId: string): Promise<Decimal> {
  const rows = await prisma().$queryRaw<{ balance: Decimal | null }[]>`
    SELECT COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS balance
    FROM ledger_entries le
    JOIN ledger_accounts la ON la.id = le.ledger_account_id
    WHERE la.code = 'CUSTOMER_RECEIVABLE' AND le.customer_profile_id = ${customerProfileId}::uuid`;
  return money(rows[0]?.balance ?? 0);
}

export interface StatementRows {
  opening: Decimal;
  movements: { occurredAt: Date; description: string; direction: string; amount: Decimal; invoiceNumber: string | null; paymentNumber: string | null }[];
  invoices: { id: string; invoiceNumber: string; invoiceType: string; issueDate: Date; dueDate: Date; totalAmount: Decimal; outstandingAmount: Decimal; status: string }[];
  ageing: { bucket: string; amount: Decimal }[];
}

/** Statement figures over CUSTOMER_RECEIVABLE — the same ledger the credit check reads (api.md §8.4). */
export async function statementRows(_scope: AnyScope, customerProfileId: string, from: Date, to: Date): Promise<StatementRows> {
  const db = prisma();
  const opening = await db.$queryRaw<{ balance: Decimal | null }[]>`
    SELECT COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE -le.amount END), 0) AS balance
    FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.ledger_account_id
    WHERE la.code = 'CUSTOMER_RECEIVABLE' AND le.customer_profile_id = ${customerProfileId}::uuid AND le.occurred_at < ${from}`;
  const movements = await db.$queryRaw<{ occurredAt: Date; description: string; direction: string; amount: Decimal; invoiceNumber: string | null; paymentNumber: string | null }[]>`
    SELECT le.occurred_at AS "occurredAt", le.description, le.direction::text AS direction, le.amount, i.invoice_number AS "invoiceNumber", p.payment_number AS "paymentNumber"
    FROM ledger_entries le
    JOIN ledger_accounts la ON la.id = le.ledger_account_id
    LEFT JOIN invoices i ON i.id = le.invoice_id
    LEFT JOIN payments p ON p.id = le.payment_id
    WHERE la.code = 'CUSTOMER_RECEIVABLE' AND le.customer_profile_id = ${customerProfileId}::uuid AND le.occurred_at >= ${from} AND le.occurred_at < ${to}
    ORDER BY le.occurred_at ASC`;
  const invoices = await db.invoice.findMany({
    where: { issuedToCustomerProfileId: customerProfileId, status: { notIn: ['DRAFT', 'VOID'] }, issueDate: { gte: from, lt: to } },
    select: { id: true, invoiceNumber: true, invoiceType: true, issueDate: true, dueDate: true, totalAmount: true, outstandingAmount: true, status: true },
    orderBy: { issueDate: 'asc' },
  });
  const ageing = await db.$queryRaw<{ bucket: string; amount: Decimal }[]>`
    SELECT CASE WHEN due_date >= ${to}::date THEN 'current'
                WHEN ${to}::date - due_date <= 30 THEN 'd1to30'
                WHEN ${to}::date - due_date <= 60 THEN 'd31to60'
                WHEN ${to}::date - due_date <= 90 THEN 'd61to90'
                ELSE 'over90' END AS bucket,
           COALESCE(SUM(outstanding_amount), 0) AS amount
    FROM invoices
    WHERE issued_to_customer_profile_id = ${customerProfileId}::uuid AND status NOT IN ('DRAFT', 'VOID', 'PAID') AND outstanding_amount > 0 AND issue_date < ${to}::date
    GROUP BY 1`;
  return { opening: money(opening[0]?.balance ?? 0), movements, invoices, ageing };
}
