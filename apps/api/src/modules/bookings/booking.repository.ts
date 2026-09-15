import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Bookings (database.md §10). Phase 7 creates them at award; the read surface and the
 * lifecycle (cancellation, driver assignment, confirmation) are Phase 8. Scope:
 *   OWN    — the customer's bookings or the owner's bookings
 *   PARTY  — customer, owner or assigned driver of the booking
 *   GLOBAL — bookings.read_any
 */

export const bookingSelect = {
  id: true, bookingNumber: true, tripRequestId: true, bidId: true, customerProfileId: true, ownerProfileId: true, vehicleId: true, driverProfileId: true, attributedSpoProfileId: true,
  vehiclePlateSnapshot: true, vehicleDescriptionSnapshot: true, vehicleCategoryCodeSnapshot: true, ownerNameSnapshot: true, transportType: true,
  pickupAddressLine: true, pickupCityId: true, pickupLatitude: true, pickupLongitude: true, dropoffAddressLine: true, dropoffCityId: true, dropoffLatitude: true, dropoffLongitude: true,
  scheduledStartAt: true, scheduledEndAt: true, agreedBaseAmount: true, agreedExtrasAmount: true, vatRate: true, vatAmount: true, totalAmount: true, currency: true, billingMode: true, creditTermsDaysSnapshot: true,
  fulfilmentSequence: true, status: true, paymentStatus: true, paymentDueBy: true, nonCircumventionUntil: true, confirmedAt: true, completedAt: true, cancelledAt: true, createdAt: true, updatedAt: true,
  tripRequest: { select: { requestNumber: true, status: true, vehiclesRequired: true, vehiclesAwarded: true, vehiclesCancelled: true, vehicleCategoryId: true } },
  financialSnapshot: { select: { grossAmount: true, netOfVatAmount: true, commissionAmount: true, commissionVatAmount: true, commissionSource: true, paymentFeeAmount: true, ownerNetAmount: true, vatTreatment: true } },
  driverProfile: { select: { user: { select: { fullNameEn: true } } } },
  ownerProfile: { select: { isPlatformFleet: true } },
  trip: { select: { id: true, tripNumber: true, status: true } },
  cancellation: { select: { cancelledByRole: true, eventType: true, reasonCode: true, reasonText: true, hoursBeforePickup: true, feePayer: true, cancellationFeeAmount: true, refundAmount: true, currency: true, feeSource: true, feeRuleSnapshot: true, feeWaivedAt: true, feeWaivedReason: true, cancelledAt: true } },
  calendarEntry: { select: { id: true, status: true } },
} satisfies Prisma.BookingSelect;
export type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.BookingWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  const a = scope.actor;
  const or: Prisma.BookingWhereInput[] = [];
  if (a.customerProfileId) or.push({ customerProfileId: a.customerProfileId });
  if (a.ownerProfileId) or.push({ ownerProfileId: a.ownerProfileId });
  if (scope.kind === 'PARTY' && a.driverProfileId) or.push({ driverProfileId: a.driverProfileId });
  return or.length ? { OR: or } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findBooking(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<BookingRow | null> {
  const db = tx ?? prisma();
  return db.booking.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: bookingSelect });
}

export async function nextBookingNumber(_scope: AnyScope, tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_booking_number') AS n`;
  return `BK-${new Date().getUTCFullYear()}-${String(rows[0]?.n ?? 0).padStart(6, '0')}`;
}

/**
 * The reservation on the vehicle calendar — `[start − buffer, end + buffer)`, status HELD. The
 * EXCLUDE constraint (ex_vehicle_calendar_no_overlap) adjudicates here: an overlap raises 23P01,
 * which the award service maps to BID_VEHICLE_UNAVAILABLE and which rolls the whole award back.
 */
export async function insertReservation(_scope: AnyScope, input: { id: string; vehicleId: string; bookingId: string; from: Date; to: Date; bufferMinutes: number; createdByUserId: string | null }, tx: Prisma.TransactionClient): Promise<void> {
  const buffer = `${input.bufferMinutes} minutes`;
  await tx.$executeRaw`
    INSERT INTO vehicle_calendar_entries (id, vehicle_id, entry_type, period, booking_id, status, created_by_user_id, updated_at)
    VALUES (${input.id}::uuid, ${input.vehicleId}::uuid, 'RESERVATION', tstzrange(${input.from}::timestamptz - ${buffer}::interval, ${input.to}::timestamptz + ${buffer}::interval, '[)'), ${input.bookingId}::uuid, 'HELD', ${input.createdByUserId}::uuid, now())`;
}

/**
 * Credit exposure for an INVOICED customer (api.md §4.6 RULE_CREDIT_LIMIT_EXCEEDED): unpaid
 * receivables from the ledger plus live INVOICED bookings that have not been invoiced yet. Read
 * inside the award transaction after the corporate profile row is locked.
 */
export async function creditExposure(_scope: AnyScope, customerProfileId: string, tx: Prisma.TransactionClient): Promise<{ receivable: string; uninvoiced: string }> {
  const rows = await tx.$queryRaw<{ receivable: string | null; uninvoiced: string | null }[]>`
    SELECT
      (SELECT COALESCE(SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount ELSE -e.amount END), 0)::text
         FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.ledger_account_id
        WHERE a.code = 'CUSTOMER_RECEIVABLE' AND e.customer_profile_id = ${customerProfileId}::uuid) AS receivable,
      (SELECT COALESCE(SUM(b.total_amount), 0)::text
         FROM bookings b
        WHERE b.customer_profile_id = ${customerProfileId}::uuid AND b.billing_mode = 'INVOICED'
          AND b.status NOT IN ('CANCELLED', 'REFUNDED')
          AND NOT EXISTS (SELECT 1 FROM invoice_line_bookings ilb WHERE ilb.booking_id = b.id)) AS uninvoiced`;
  return { receivable: rows[0]?.receivable ?? '0', uninvoiced: rows[0]?.uninvoiced ?? '0' };
}

export interface BookingFilters {
  status?: string[] | undefined;
  paymentStatus?: string | undefined;
  billingMode?: string | undefined;
  transportType?: string | undefined;
  customerProfileId?: string | undefined;
  ownerProfileId?: string | undefined;
  vehicleId?: string | undefined;
  driverProfileId?: string | undefined;
  tripRequestId?: string | undefined;
  fulfilmentSequence?: number | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  q?: string | undefined;
}

export async function listBookings(scope: AnyScope, f: BookingFilters, page: { page: number; pageSize: number }): Promise<{ items: BookingRow[]; total: number }> {
  const where: Prisma.BookingWhereInput = {
    AND: [
      scopeWhere(scope),
      ...(f.status?.length ? [{ status: { in: f.status as BookingRow['status'][] } }] : []),
      ...(f.paymentStatus ? [{ paymentStatus: f.paymentStatus as BookingRow['paymentStatus'] }] : []),
      ...(f.billingMode ? [{ billingMode: f.billingMode as BookingRow['billingMode'] }] : []),
      ...(f.transportType ? [{ transportType: f.transportType as BookingRow['transportType'] }] : []),
      ...(f.customerProfileId ? [{ customerProfileId: f.customerProfileId }] : []),
      ...(f.ownerProfileId ? [{ ownerProfileId: f.ownerProfileId }] : []),
      ...(f.vehicleId ? [{ vehicleId: f.vehicleId }] : []),
      ...(f.driverProfileId ? [{ driverProfileId: f.driverProfileId }] : []),
      ...(f.tripRequestId ? [{ tripRequestId: f.tripRequestId }] : []),
      ...(f.fulfilmentSequence ? [{ fulfilmentSequence: f.fulfilmentSequence }] : []),
      ...(f.dateFrom || f.dateTo ? [{ scheduledStartAt: { ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}), ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}) } }] : []),
      ...(f.q ? [{ bookingNumber: { contains: f.q, mode: 'insensitive' as const } }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma().booking.findMany({ where, select: bookingSelect, orderBy: { scheduledStartAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().booking.count({ where }),
  ]);
  return { items, total };
}

export async function lockBooking(_scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export const historySelect = { id: true, fromStatus: true, toStatus: true, changedByUserId: true, actorType: true, reason: true, metadata: true, occurredAt: true } satisfies Prisma.BookingStatusHistorySelect;
export type HistoryRow = Prisma.BookingStatusHistoryGetPayload<{ select: typeof historySelect }>;

export async function listStatusHistory(scope: AnyScope, bookingId: string): Promise<HistoryRow[] | null> {
  const b = await prisma().booking.findFirst({ where: { AND: [{ id: bookingId }, scopeWhere(scope)] }, select: { id: true } });
  if (!b) return null;
  return prisma().bookingStatusHistory.findMany({ where: { bookingId }, select: historySelect, orderBy: { occurredAt: 'asc' } });
}

export async function findFinancialSnapshot(scope: AnyScope, bookingId: string) {
  return prisma().booking.findFirst({ where: { AND: [{ id: bookingId }, scopeWhere(scope)] }, select: { id: true, ownerProfileId: true, customerProfileId: true, financialSnapshot: true } });
}

/** Releases the reservation: retained for audit, excluded from the EXCLUDE constraint (status <> 'RELEASED'). */
export async function releaseReservation(_scope: AnyScope, bookingId: string, tx: Prisma.TransactionClient): Promise<boolean> {
  const r = await tx.vehicleCalendarEntry.updateMany({ where: { bookingId, status: { not: 'RELEASED' } }, data: { status: 'RELEASED' } });
  return r.count > 0;
}

/** Bookings the driver is already dispatched on whose window overlaps [from, to). */
export async function driverConflicts(_scope: AnyScope, driverProfileId: string, from: Date, to: Date, exceptBookingId: string, tx: Prisma.TransactionClient | null = null): Promise<{ id: string; bookingNumber: string }[]> {
  const db = tx ?? prisma();
  return db.booking.findMany({
    where: { driverProfileId, id: { not: exceptBookingId }, status: { in: ['DRIVER_ASSIGNED', 'READY', 'IN_PROGRESS'] }, scheduledStartAt: { lt: to }, scheduledEndAt: { gt: from } },
    select: { id: true, bookingNumber: true },
  });
}

export async function nextTripNumber(_scope: AnyScope, tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_trip_number') AS n`;
  return `TP-${new Date().getUTCFullYear()}-${String(rows[0]?.n ?? 0).padStart(6, '0')}`;
}

export async function listPaymentExpired(_scope: AnyScope, at: Date, take = 200): Promise<{ id: string; bookingNumber: string }[]> {
  return prisma().booking.findMany({ where: { status: 'PENDING_PAYMENT', paymentDueBy: { lt: at } }, select: { id: true, bookingNumber: true }, take });
}
