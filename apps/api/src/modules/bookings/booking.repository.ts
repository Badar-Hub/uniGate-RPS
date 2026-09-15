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
  tripRequest: { select: { requestNumber: true } },
  financialSnapshot: { select: { grossAmount: true, netOfVatAmount: true, commissionAmount: true, commissionVatAmount: true, commissionSource: true, paymentFeeAmount: true, ownerNetAmount: true, vatTreatment: true } },
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
