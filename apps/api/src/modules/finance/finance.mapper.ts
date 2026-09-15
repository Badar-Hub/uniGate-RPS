import type { CommissionRuleDto, ExpenseDto, InvoiceDto, InvoiceLineDto, LedgerGroupDto, SettlementDto, SettlementLineDto } from '@unigate/types';
import { Decimal, toMoneyString, toRateString } from '@/common/money.js';
import type { CommissionRuleAdminRow } from './commission.repository.js';
import type { ExpenseRow } from './expense.repository.js';
import type { InvoiceLineRow, InvoiceRow } from './invoice.repository.js';
import type { LedgerEntryRow } from './ledger.repository.js';
import type { SettlementLineRow, SettlementRow } from './settlement.repository.js';

/** Finance DTOs — allow-listed field by field. The invoice mapper never sees a stamp or a raw authority response (api.md §8.19). */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export function toCommissionRuleDto(r: CommissionRuleAdminRow): CommissionRuleDto {
  return {
    id: r.id, name: r.name, scope: r.scope, vehicleCategoryId: r.vehicleCategoryId, ownerProfileId: r.ownerProfileId, transportType: r.transportType, calculationType: r.calculationType,
    percentageRate: r.percentageRate ? toMoneyString(r.percentageRate.mul(100)) : null, fixedAmount: r.fixedAmount ? toMoneyString(r.fixedAmount) : null, basis: r.basis,
    minAmount: r.minAmount ? toMoneyString(r.minAmount) : null, maxAmount: r.maxAmount ? toMoneyString(r.maxAmount) : null, currency: r.currency, priority: r.priority,
    effectiveFrom: r.effectiveFrom.toISOString(), effectiveTo: iso(r.effectiveTo), isActive: r.isActive, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

export function toSettlementDto(s: SettlementRow): SettlementDto {
  return {
    id: s.id, settlementNumber: s.settlementNumber, ownerProfileId: s.ownerProfileId, ownerName: s.ownerProfile.businessNameEn ?? s.ownerProfile.user.fullNameEn, periodStart: s.periodStart.toISOString(), periodEnd: s.periodEnd.toISOString(),
    grossAmount: toMoneyString(s.grossAmount), commissionAmount: toMoneyString(s.commissionAmount), adjustmentsAmount: toMoneyString(s.adjustmentsAmount), netPayableAmount: toMoneyString(s.netPayableAmount), currency: s.currency, status: s.status,
    bankAccount: s.bankAccount ? { id: s.bankAccount.id, bankName: s.bankAccount.bankName, ibanLast4: s.bankAccount.ibanLast4, accountHolderName: s.bankAccount.accountHolderName } : null,
    paymentReference: s.paymentReference, approvedByUserId: s.approvedByUserId, paidAt: iso(s.paidAt), notes: s.notes, lineCount: s._count.lines, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
  };
}

export function toSettlementLineDto(l: SettlementLineRow): SettlementLineDto {
  return {
    id: l.id, settlementId: l.settlementId, bookingId: l.bookingId, bookingNumber: l.booking?.bookingNumber ?? null, lineType: l.lineType, amount: toMoneyString(l.amount), currency: l.currency, description: l.description,
    holdReason: l.holdReason, heldSince: iso(l.heldSince), releasedAt: iso(l.releasedAt), eligibleAt: iso(l.eligibleAt), createdAt: l.createdAt.toISOString(),
  };
}

export function toInvoiceDto(i: InvoiceRow, lastErrorCode: string | null): InvoiceDto {
  const notRequired = i.clearanceStatus === 'NOT_REQUIRED';
  return {
    id: i.id, invoiceNumber: i.invoiceNumber, invoiceType: i.invoiceType, issuedToCustomerProfileId: i.issuedToCustomerProfileId, corporateCustomerProfileId: i.corporateCustomerProfileId,
    buyerName: i.issuedTo.corporate?.companyNameEn ?? i.issuedTo.user.fullNameEn, correctsInvoiceId: i.correctsInvoiceId, correctsInvoiceNumber: i.corrects?.invoiceNumber ?? null,
    billingPeriodStart: day(i.billingPeriodStart), billingPeriodEnd: day(i.billingPeriodEnd), sellerVatNumber: i.sellerVatNumber, buyerVatNumber: i.buyerVatNumber, lineGranularity: i.lineGranularitySnapshot,
    subtotalAmount: toMoneyString(i.subtotalAmount), vatAmount: toMoneyString(i.vatAmount), totalAmount: toMoneyString(i.totalAmount), paidAmount: toMoneyString(i.paidAmount), outstandingAmount: toMoneyString(i.outstandingAmount), currency: i.currency,
    issueDate: day(i.issueDate) ?? '', supplyDate: day(i.supplyDate) ?? '', dueDate: day(i.dueDate) ?? '', status: i.status, lineCount: i._count.lines,
    einvoice: {
      einvoiceUuid: notRequired ? null : i.einvoiceUuid, icv: notRequired || i.icv === null ? null : Number(i.icv), invoiceHash: notRequired ? null : i.invoiceHash, previousInvoiceHash: notRequired ? null : i.previousInvoiceHash, qrCodeTlv: notRequired ? null : i.qrCodeTlv,
      clearanceStatus: i.clearanceStatus, clearanceSubmittedAt: iso(i.clearanceSubmittedAt), clearanceCompletedAt: iso(i.clearanceCompletedAt), clearanceAttemptCount: i.clearanceAttemptCount, xmlDocumentId: i.xmlDocumentId, clearedXmlDocumentId: i.clearedXmlDocumentId, lastErrorCode,
    },
    pdfDocumentId: i.pdfDocumentId, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString(),
  };
}

export function toInvoiceLineDto(l: InvoiceLineRow): InvoiceLineDto {
  return {
    id: l.id, invoiceId: l.invoiceId, lineType: l.lineType, tripRequestId: l.tripRequestId, requestNumber: l.tripRequest?.requestNumber ?? null, bookingId: l.bookingId, bookingNumber: l.booking?.bookingNumber ?? null, bookingIds: l.bookings.map((b) => b.bookingId),
    descriptionEn: l.descriptionEn, descriptionAr: l.descriptionAr, quantity: toMoneyString(l.quantity), unitAmount: toMoneyString(l.unitAmount), netAmount: toMoneyString(l.netAmount), vatRate: toRateString(l.vatRate), vatAmount: toMoneyString(l.vatAmount), totalAmount: toMoneyString(l.totalAmount), vatCategory: l.vatCategory, sortOrder: l.sortOrder,
  };
}

export function toExpenseDto(e: ExpenseRow, isLocked: boolean): ExpenseDto {
  return {
    id: e.id, ownerProfileId: e.ownerProfileId, vehicleId: e.vehicleId, vehiclePlate: e.vehicle?.plateNumberEn ?? null, driverProfileId: e.driverProfileId, tripId: e.tripId, expenseCategoryId: e.expenseCategoryId, categoryCode: e.category.code,
    amount: toMoneyString(e.amount), vatAmount: toMoneyString(e.vatAmount), totalAmount: toMoneyString(e.totalAmount), currency: e.currency, expenseDate: day(e.expenseDate) ?? '', description: e.description, vendorName: e.vendorName, odometerKm: e.odometerKm,
    receiptDocumentId: e.receiptDocumentId, isReimbursable: e.isReimbursable, isLocked, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString(),
  };
}

export function toLedgerGroupDto(entries: LedgerEntryRow[]): LedgerGroupDto {
  const first = entries[0];
  if (!first) throw new Error('empty ledger group');
  const debit = entries.filter((e) => e.direction === 'DEBIT').reduce((a, e) => a.add(e.amount), new Decimal(0));
  const credit = entries.filter((e) => e.direction === 'CREDIT').reduce((a, e) => a.add(e.amount), new Decimal(0));
  return {
    transactionGroupId: first.transactionGroupId, description: first.description, occurredAt: first.occurredAt.toISOString(), bookingId: first.bookingId, paymentId: first.paymentId, refundId: first.refundId, settlementId: first.settlementId, invoiceId: first.invoiceId,
    entries: entries.map((e) => ({ id: e.id, accountCode: e.account.code, accountType: e.account.type, direction: e.direction, amount: toMoneyString(e.amount), currency: e.currency, ownerProfileId: e.ownerProfileId, customerProfileId: e.customerProfileId })),
    debitTotal: toMoneyString(debit), creditTotal: toMoneyString(credit),
  };
}
