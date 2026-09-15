import { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Invoices (database.md §12.6–12.7). Scope:
 *   OWN / PARTY — the buyer's own invoices
 *   GLOBAL      — invoices.issue staff
 * `cryptographic_stamp` and `clearance_response` are never selected here: the serialiser cannot
 * leak what the row projection never carries (api.md §8.19).
 */

export const invoiceSelect = {
  id: true, invoiceNumber: true, invoiceType: true, issuedToCustomerProfileId: true, corporateCustomerProfileId: true, correctsInvoiceId: true, billingPeriodStart: true, billingPeriodEnd: true, sellerVatNumber: true, buyerVatNumber: true, lineGranularitySnapshot: true,
  subtotalAmount: true, vatAmount: true, totalAmount: true, paidAmount: true, outstandingAmount: true, currency: true, issueDate: true, supplyDate: true, dueDate: true, status: true, pdfDocumentId: true,
  einvoiceUuid: true, icv: true, previousInvoiceHash: true, invoiceHash: true, qrCodeTlv: true, xmlDocumentId: true, clearedXmlDocumentId: true, clearanceStatus: true, clearanceSubmittedAt: true, clearanceCompletedAt: true, clearanceAttemptCount: true, providerReference: true,
  createdAt: true, updatedAt: true,
  corrects: { select: { invoiceNumber: true } },
  issuedTo: { select: { user: { select: { fullNameEn: true } }, corporate: { select: { companyNameEn: true } } } },
  _count: { select: { lines: true } },
} satisfies Prisma.InvoiceSelect;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

export const invoiceLineSelect = {
  id: true, invoiceId: true, lineType: true, tripRequestId: true, bookingId: true, descriptionEn: true, descriptionAr: true, quantity: true, unitAmount: true, netAmount: true, vatRate: true, vatAmount: true, totalAmount: true, vatCategory: true, sortOrder: true,
  tripRequest: { select: { requestNumber: true } },
  booking: { select: { bookingNumber: true } },
  bookings: { select: { bookingId: true } },
} satisfies Prisma.InvoiceLineSelect;
export type InvoiceLineRow = Prisma.InvoiceLineGetPayload<{ select: typeof invoiceLineSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.InvoiceWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  return scope.actor.customerProfileId ? { issuedToCustomerProfileId: scope.actor.customerProfileId } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findInvoice(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<InvoiceRow | null> {
  return (tx ?? prisma()).invoice.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: invoiceSelect });
}

export interface InvoiceFilters {
  invoiceType?: string | undefined;
  status?: string | undefined;
  clearanceStatus?: string | undefined;
  bookingId?: string | undefined;
  issuedToCustomerProfileId?: string | undefined;
  corporateCustomerProfileId?: string | undefined;
  overdueOnly?: boolean | undefined;
  dueFrom?: string | undefined;
  dueTo?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  minOutstanding?: string | undefined;
}

export async function listInvoices(scope: AnyScope, f: InvoiceFilters, page: { page: number; pageSize: number }): Promise<{ items: InvoiceRow[]; total: number }> {
  const where: Prisma.InvoiceWhereInput = {
    AND: [
      scopeWhere(scope),
      ...(f.invoiceType ? [{ invoiceType: f.invoiceType as InvoiceRow['invoiceType'] }] : []),
      ...(f.status ? [{ status: f.status as InvoiceRow['status'] }] : []),
      ...(f.clearanceStatus ? [{ clearanceStatus: f.clearanceStatus as InvoiceRow['clearanceStatus'] }] : []),
      ...(f.bookingId ? [{ lines: { some: { OR: [{ bookingId: f.bookingId }, { bookings: { some: { bookingId: f.bookingId } } }] } } }] : []),
      ...(f.issuedToCustomerProfileId ? [{ issuedToCustomerProfileId: f.issuedToCustomerProfileId }] : []),
      ...(f.corporateCustomerProfileId ? [{ corporateCustomerProfileId: f.corporateCustomerProfileId }] : []),
      ...(f.overdueOnly ? [{ status: 'OVERDUE' as const }] : []),
      ...(f.dueFrom ? [{ dueDate: { gte: new Date(f.dueFrom) } }] : []),
      ...(f.dueTo ? [{ dueDate: { lte: new Date(f.dueTo) } }] : []),
      ...(f.dateFrom ? [{ issueDate: { gte: new Date(f.dateFrom) } }] : []),
      ...(f.dateTo ? [{ issueDate: { lte: new Date(f.dateTo) } }] : []),
      ...(f.minOutstanding ? [{ outstandingAmount: { gte: new Prisma.Decimal(f.minOutstanding) } }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma().invoice.findMany({ where, select: invoiceSelect, orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().invoice.count({ where }),
  ]);
  return { items, total };
}

export async function listLines(scope: AnyScope, invoiceId: string, page: { page: number; pageSize: number }): Promise<{ items: InvoiceLineRow[]; total: number } | null> {
  const inv = await prisma().invoice.findFirst({ where: { AND: [{ id: invoiceId }, scopeWhere(scope)] }, select: { id: true } });
  if (!inv) return null;
  const [items, total] = await Promise.all([
    prisma().invoiceLine.findMany({ where: { invoiceId }, select: invoiceLineSelect, orderBy: { sortOrder: 'asc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().invoiceLine.count({ where: { invoiceId } }),
  ]);
  return { items, total };
}

export async function allLines(_scope: AnyScope, invoiceId: string, tx: Prisma.TransactionClient): Promise<InvoiceLineRow[]> {
  return tx.invoiceLine.findMany({ where: { invoiceId }, select: invoiceLineSelect, orderBy: { sortOrder: 'asc' } });
}

export async function lockInvoice(_scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
}

/**
 * Gapless numbering and the ICV chain: a transaction-scoped advisory lock serialises issuers, and the
 * next values are MAX+1 read under that lock — a rolled-back issuance leaves no hole, which a plain
 * sequence cannot promise (api.md §8.19: "consumes the next gapless number … inside the transaction").
 */
export async function nextInvoiceIdentity(_scope: AnyScope, tx: Prisma.TransactionClient): Promise<{ invoiceNumber: string; icv: number; previousInvoiceHash: string | null }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoices.identity'))`;
  const rows = await tx.$queryRaw<{ n: number | null; icv: number | null }[]>`SELECT COUNT(*)::int AS n, COALESCE(MAX(icv), 0)::int AS icv FROM invoices`;
  const n = (rows[0]?.n ?? 0) + 1;
  const icv = (rows[0]?.icv ?? 0) + 1;
  const prev = await tx.invoice.findFirst({ where: { icv: { not: null } }, orderBy: { icv: 'desc' }, select: { invoiceHash: true } });
  return { invoiceNumber: `INV-${new Date().getUTCFullYear()}-${String(n).padStart(6, '0')}`, icv, previousInvoiceHash: prev?.invoiceHash ?? null };
}

export interface BillableBooking {
  id: string;
  bookingNumber: string;
  tripRequestId: string;
  requestNumber: string;
  customerProfileId: string;
  ownerProfileId: string;
  completedAt: Date | null;
  scheduledStartAt: Date;
  pickupAddressLine: string;
  dropoffAddressLine: string;
  vehicleDescriptionSnapshot: string;
  totalAmount: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  currency: string;
  creditTermsDaysSnapshot: number | null;
  ownerIsPlatformFleet: boolean;
  split: { ownerNetAmount: Prisma.Decimal; commissionAmount: Prisma.Decimal; commissionVatAmount: Prisma.Decimal; paymentFeeAmount: Prisma.Decimal } | null;
}

const billableSelect = {
  id: true, bookingNumber: true, tripRequestId: true, customerProfileId: true, ownerProfileId: true, completedAt: true, scheduledStartAt: true, pickupAddressLine: true, dropoffAddressLine: true, vehicleDescriptionSnapshot: true, totalAmount: true, vatRate: true, vatAmount: true, currency: true, creditTermsDaysSnapshot: true, billingMode: true, status: true,
  tripRequest: { select: { requestNumber: true } },
  ownerProfile: { select: { isPlatformFleet: true } },
  financialSnapshot: { select: { ownerNetAmount: true, commissionAmount: true, commissionVatAmount: true, paymentFeeAmount: true } },
  invoiceLineLinks: { select: { invoiceLine: { select: { invoice: { select: { status: true } } } } } },
} satisfies Prisma.BookingSelect;
type BillableRaw = Prisma.BookingGetPayload<{ select: typeof billableSelect }>;

function toBillable(b: BillableRaw): BillableBooking {
  return {
    id: b.id, bookingNumber: b.bookingNumber, tripRequestId: b.tripRequestId, requestNumber: b.tripRequest.requestNumber, customerProfileId: b.customerProfileId, ownerProfileId: b.ownerProfileId, completedAt: b.completedAt, scheduledStartAt: b.scheduledStartAt,
    pickupAddressLine: b.pickupAddressLine, dropoffAddressLine: b.dropoffAddressLine, vehicleDescriptionSnapshot: b.vehicleDescriptionSnapshot, totalAmount: b.totalAmount, vatRate: b.vatRate, vatAmount: b.vatAmount, currency: b.currency, creditTermsDaysSnapshot: b.creditTermsDaysSnapshot, ownerIsPlatformFleet: b.ownerProfile.isPlatformFleet,
    split: b.financialSnapshot,
  };
}

/** One booking with its billing state; the service decides whether it is billable. */
export async function bookingForInvoice(_scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<(BillableBooking & { billingMode: string; status: string; alreadyBilled: boolean }) | null> {
  const b = await tx.booking.findUnique({ where: { id }, select: billableSelect });
  if (!b) return null;
  return { ...toBillable(b), billingMode: b.billingMode, status: b.status, alreadyBilled: b.invoiceLineLinks.some((l) => l.invoiceLine.invoice.status !== 'VOID') };
}

/** Unbilled COMPLETED INVOICED bookings completed inside the period (dates inclusive), grouped by customer by the caller. */
export async function unbilledInvoicedBookings(_scope: AnyScope, from: Date, toExclusive: Date, customerProfileId: string | null, tx: Prisma.TransactionClient): Promise<BillableBooking[]> {
  const rows = await tx.booking.findMany({
    where: {
      status: 'COMPLETED', billingMode: 'INVOICED', completedAt: { gte: from, lt: toExclusive }, ...(customerProfileId ? { customerProfileId } : {}),
      invoiceLineLinks: { none: { invoiceLine: { invoice: { status: { not: 'VOID' } } } } },
    },
    select: billableSelect,
    orderBy: [{ customerProfileId: 'asc' }, { completedAt: 'asc' }],
  });
  return rows.map(toBillable);
}

/** Bookings covered by the invoice (through the line links), with their frozen split for the postings. */
export async function bookingsOfInvoice(_scope: AnyScope, invoiceId: string, tx: Prisma.TransactionClient): Promise<BillableBooking[]> {
  const rows = await tx.booking.findMany({ where: { invoiceLineLinks: { some: { invoiceLine: { invoiceId } } } }, select: billableSelect });
  return rows.map(toBillable);
}

export async function clearanceQueue(_scope: AnyScope, f: { clearanceStatus?: string | undefined; invoiceType?: string | undefined; minAgeSeconds?: number | undefined; customerProfileId?: string | undefined }, page: { page: number; pageSize: number }): Promise<{ items: InvoiceRow[]; total: number }> {
  const where: Prisma.InvoiceWhereInput = {
    AND: [
      { status: { in: ['PENDING_CLEARANCE', 'CLEARANCE_FAILED'] } },
      ...(f.clearanceStatus ? [{ clearanceStatus: f.clearanceStatus as InvoiceRow['clearanceStatus'] }] : []),
      ...(f.invoiceType ? [{ invoiceType: f.invoiceType as InvoiceRow['invoiceType'] }] : []),
      ...(f.customerProfileId ? [{ issuedToCustomerProfileId: f.customerProfileId }] : []),
      ...(f.minAgeSeconds ? [{ createdAt: { lte: new Date(Date.now() - f.minAgeSeconds * 1000) } }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma().invoice.findMany({ where, select: invoiceSelect, orderBy: { createdAt: 'asc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().invoice.count({ where }),
  ]);
  return { items, total };
}

/** Last clearance error code, read from the retained authority response (audit-only column, never serialised as a whole). */
export async function lastClearanceError(_scope: AnyScope, id: string): Promise<string | null> {
  const row = await prisma().invoice.findUnique({ where: { id }, select: { clearanceResponse: true } });
  const r = row?.clearanceResponse as { errorCode?: unknown } | null;
  return typeof r?.errorCode === 'string' ? r.errorCode : null;
}

export async function listDueForOverdue(_scope: AnyScope, today: Date, take = 500): Promise<{ id: string; invoiceNumber: string; issuedToCustomerProfileId: string; dueDate: Date; outstandingAmount: Prisma.Decimal; status: InvoiceRow['status'] }[]> {
  return prisma().invoice.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lt: today }, outstandingAmount: { gt: 0 } }, select: { id: true, invoiceNumber: true, issuedToCustomerProfileId: true, dueDate: true, outstandingAmount: true, status: true }, take });
}
