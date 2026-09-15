import { getSettingValue } from '@/modules/reference/settings.service.js';
import { notify, type NotifyInput } from './notification.service.js';
import * as who from './recipients.js';

/**
 * Domain event → notification (FR-NOTIFICATIONS-03). Each subscriber names recipients and a
 * template; the text lives in the database. The dedupe key is the outbox row id, so a retried
 * job never produces a second row per recipient × channel (FR-NOTIFICATIONS-05).
 */
export interface DomainEvent {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

type Subscriber = (e: DomainEvent) => Promise<void>;

const s = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);
const when = (v: unknown): string => (typeof v === 'string' ? v.replace('T', ' ').slice(0, 16) + ' UTC' : new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC');

async function currency(): Promise<string> {
  return getSettingValue<string>('finance.currency', 'SAR');
}

async function send(e: DomainEvent, userIds: string[], templateCode: string, variables: Record<string, string>, extra: Partial<NotifyInput> = {}): Promise<void> {
  if (!userIds.length) return;
  await notify({ userIds, templateCode, variables, dedupeKey: `evt:${e.id}`, ...extra });
}

const TRIP_TEMPLATES: Record<string, string> = {
  DRIVER_EN_ROUTE: 'TRIP_DRIVER_EN_ROUTE',
  ARRIVED_AT_PICKUP: 'TRIP_DRIVER_ARRIVED',
  TRIP_STARTED: 'TRIP_STARTED',
  IN_TRANSIT: 'TRIP_STARTED',
  DELIVERED: 'TRIP_DELIVERED',
  COMPLETED: 'TRIP_COMPLETED',
};

export const subscribers: Record<string, Subscriber> = {
  // ── opportunities & bidding ────────────────────────────────────────────────
  'trip_request.published': async (e) => {
    const owners = await who.usersOfOwners(e.payload['invitedOwnerProfileIds']);
    const pickupAt = await who.tripRequestPickup(e.aggregateId);
    const t = s(e.payload['transportType']);
    await send(e, owners, 'NEW_TRIP_OPPORTUNITY', { requestNumber: s(e.payload['requestNumber']), transportType: t, pickupAt }, { variablesByLocale: { en: { transportType: t === 'GOODS' ? 'goods' : 'passenger' }, ar: { transportType: t === 'GOODS' ? 'بضائع' : 'ركاب' } }, data: { tripRequestId: e.aggregateId } });
  },
  'bid.submitted': async (e) => {
    await send(e, await who.usersOfCustomer(e.payload['customerProfileId']), 'BID_RECEIVED', { requestNumber: s(e.payload['requestNumber']), bidNumber: s(e.payload['bidNumber']), totalAmount: s(e.payload['totalAmount']), currency: await currency() }, { data: { tripRequestId: s(e.payload['tripRequestId']), bidId: e.aggregateId } });
  },
  'bid.rejected': async (e) => {
    await send(e, await who.usersOfOwner(e.payload['ownerProfileId']), 'BID_REJECTED', { bidNumber: s(e.payload['bidNumber']), requestNumber: s(e.payload['requestNumber']) }, { data: { bidId: e.aggregateId } });
  },
  'booking.created': async (e) => {
    await send(e, await who.usersOfOwner(e.payload['ownerProfileId']), 'BID_ACCEPTED', { bookingNumber: s(e.payload['bookingNumber']), requestNumber: await who.bookingRequestNumber(e.payload['tripRequestId']), totalAmount: s(e.payload['totalAmount']), currency: await currency() }, { data: { bookingId: e.aggregateId } });
  },
  // ── bookings ───────────────────────────────────────────────────────────────
  'booking.confirmed': async (e) => {
    const users = [...(await who.usersOfCustomer(e.payload['customerProfileId'])), ...(await who.usersOfOwner(e.payload['ownerProfileId']))];
    await send(e, users, 'BOOKING_CONFIRMED', { bookingNumber: s(e.payload['bookingNumber']) }, { data: { bookingId: e.aggregateId } });
  },
  'booking.cancelled': async (e) => {
    const role = s(e.payload['role']);
    const users = [
      ...(role === 'CUSTOMER' ? [] : await who.usersOfCustomer(e.payload['customerProfileId'])),
      ...(role === 'OWNER' ? [] : await who.usersOfOwner(e.payload['ownerProfileId'])),
      ...(await who.usersOfDriver(e.payload['driverProfileId'])),
    ];
    await send(e, users, 'BOOKING_CANCELLED', { bookingNumber: s(e.payload['bookingNumber']), reason: s(e.payload['reasonCode'], 'cancelled').toLowerCase().replace(/_/g, ' ') }, { data: { bookingId: e.aggregateId } });
  },
  'booking.completed': async (e) => {
    const users = [...(await who.usersOfCustomer(e.payload['customerProfileId'])), ...(await who.usersOfOwner(e.payload['ownerProfileId']))];
    await send(e, users, 'BOOKING_COMPLETED', { bookingNumber: s(e.payload['bookingNumber']), totalAmount: s(e.payload['totalAmount']), currency: await currency() }, { data: { bookingId: e.aggregateId } });
    const windowDays = await getSettingValue<number>('booking.rating_window_days', 14);
    const deadline = new Date(Date.now() + windowDays * 86_400_000).toISOString().slice(0, 10);
    await notify({ userIds: users, templateCode: 'RATE_YOUR_TRIP', variables: { bookingNumber: s(e.payload['bookingNumber']), deadline }, dedupeKey: `evt:${e.id}:rate`, data: { bookingId: e.aggregateId, rate: true } });
  },
  'booking.driver_assigned': async (e) => {
    const users = [...(await who.usersOfCustomer(e.payload['customerProfileId'])), ...(await who.usersOfDriver(e.payload['driverProfileId']))];
    await send(e, users, 'DRIVER_ASSIGNED', { bookingNumber: s(e.payload['bookingNumber']), tripNumber: s(e.payload['tripNumber']) }, { data: { bookingId: e.aggregateId } });
  },
  // ── payments ───────────────────────────────────────────────────────────────
  'payment.captured': async (e) => {
    await send(e, await who.usersOfCustomer(e.payload['customerProfileId']), 'PAYMENT_SUCCESSFUL', { paymentNumber: s(e.payload['paymentNumber']), amount: s(e.payload['amount']), currency: await currency() }, { data: { paymentId: e.aggregateId, bookingId: s(e.payload['bookingId']), invoiceId: s(e.payload['invoiceId']) } });
  },
  'payment.failed': async (e) => {
    await send(e, await who.usersOfCustomer(e.payload['customerProfileId']), 'PAYMENT_FAILED', { paymentNumber: s(e.payload['paymentNumber']), failureCode: s(e.payload['failureCode'], 'declined') }, { data: { paymentId: e.aggregateId, bookingId: s(e.payload['bookingId']) } });
  },
  'refund.completed': async (e) => {
    await send(e, await who.usersOfCustomer(e.payload['customerProfileId']), 'REFUND_COMPLETED', { refundNumber: s(e.payload['refundNumber']), amount: s(e.payload['amount']), currency: await currency() }, { data: { refundId: e.aggregateId, bookingId: s(e.payload['bookingId']) } });
  },
  // ── trips ──────────────────────────────────────────────────────────────────
  'trip.status': async (e) => {
    const template = TRIP_TEMPLATES[s(e.payload['status'])];
    if (!template) return;
    const users = [...(await who.usersOfCustomer(e.payload['customerProfileId'])), ...(template === 'TRIP_COMPLETED' ? await who.usersOfOwner(e.payload['ownerProfileId']) : [])];
    await send(e, users, template, { tripNumber: s(e.payload['tripNumber']) }, { data: { tripId: e.aggregateId, bookingId: s(e.payload['bookingId']) } });
  },
  'trip.cancelled': async (e) => {
    const users = [...(await who.usersOfCustomer(e.payload['customerProfileId'])), ...(await who.usersOfOwner(e.payload['ownerProfileId'])), ...(await who.usersOfDriver(e.payload['driverProfileId']))];
    await send(e, users, 'TRIP_CANCELLED', { tripNumber: s(e.payload['tripNumber']), reason: s(e.payload['reason'], '—') }, { data: { tripId: e.aggregateId, bookingId: s(e.payload['bookingId']) } });
  },
  // ── documents ──────────────────────────────────────────────────────────────
  'document.expiring': async (e) => {
    const users = await who.usersOfDocumentTarget(e.payload['target']);
    const label = await who.documentTypeLabels(e.payload['documentTypeCode']);
    await send(e, users, 'DOCUMENT_EXPIRING', { documentType: label.en, daysLeft: s(e.payload['daysLeft']), expiryDate: s(e.payload['expiryDate']) }, { variablesByLocale: { ar: { documentType: label.ar } }, data: { documentId: e.aggregateId } });
  },
  'document.expired': async (e) => {
    const target = e.payload['userId'] ? { kind: 'USER', id: e.payload['userId'] } : e.payload['ownerProfileId'] ? { kind: 'OWNER', id: e.payload['ownerProfileId'] } : e.payload['driverProfileId'] ? { kind: 'DRIVER', id: e.payload['driverProfileId'] } : { kind: 'VEHICLE', id: e.payload['vehicleId'] };
    const label = await who.documentTypeLabels(e.payload['documentTypeCode']);
    await send(e, await who.usersOfDocumentTarget(target), 'DOCUMENT_EXPIRED', { documentType: label.en }, { variablesByLocale: { ar: { documentType: label.ar } }, data: { documentId: e.aggregateId } });
  },
  'document.verified': async (e) => {
    const label = await who.documentTypeLabels(e.payload['documentTypeCode']);
    await send(e, await who.usersOfDocumentTarget(e.payload['target']), 'DOCUMENT_VERIFIED', { documentType: label.en }, { variablesByLocale: { ar: { documentType: label.ar } }, data: { documentId: e.aggregateId } });
  },
  'document.rejected': async (e) => {
    const label = await who.documentTypeLabels(e.payload['documentTypeCode']);
    await send(e, await who.usersOfDocumentTarget(e.payload['target']), 'DOCUMENT_REJECTED', { documentType: label.en, reason: s(e.payload['rejectionReason'], '—') }, { variablesByLocale: { ar: { documentType: label.ar } }, data: { documentId: e.aggregateId } });
  },
  // ── maintenance ────────────────────────────────────────────────────────────
  'maintenance.due': async (e) => {
    const label = await who.serviceTypeLabels(e.payload['serviceTypeCode']);
    const dueAt = s(e.payload['nextDueAt']);
    const dueKm = s(e.payload['nextDueOdometerKm']);
    const en = dueAt ? `by ${dueAt.slice(0, 10)}` : dueKm ? `at ${dueKm} km` : 'now';
    const ar = dueAt ? `بحلول ${dueAt.slice(0, 10)}` : dueKm ? `عند ${dueKm} كم` : 'الآن';
    await send(e, await who.usersOfOwner(e.payload['ownerProfileId']), 'MAINTENANCE_DUE', { vehiclePlate: await who.vehiclePlate(e.payload['vehicleId']), serviceType: label.en, dueBy: en }, { variablesByLocale: { ar: { serviceType: label.ar, dueBy: ar } }, data: { vehicleId: s(e.payload['vehicleId']), scheduleId: e.aggregateId } });
  },
  // ── onboarding ─────────────────────────────────────────────────────────────
  'owner.approved': async (e) => {
    await send(e, [s(e.payload['userId'])].filter(Boolean), 'OWNER_APPROVED', {}, { data: { ownerProfileId: e.aggregateId } });
  },
  'owner.rejected': async (e) => {
    await send(e, [s(e.payload['userId'])].filter(Boolean), 'OWNER_REJECTED', { reason: s(e.payload['rejectionReason'], '—') }, { data: { ownerProfileId: e.aggregateId } });
  },
  'vehicle.approved': async (e) => {
    await send(e, await who.usersOfOwner(e.payload['ownerProfileId']), 'VEHICLE_APPROVED', { vehiclePlate: await who.vehiclePlate(e.aggregateId) }, { data: { vehicleId: e.aggregateId } });
  },
  'vehicle.rejected': async (e) => {
    await send(e, await who.usersOfOwner(e.payload['ownerProfileId']), 'VEHICLE_REJECTED', { vehiclePlate: await who.vehiclePlate(e.aggregateId), reason: s(e.payload['rejectionReason'], '—') }, { data: { vehicleId: e.aggregateId } });
  },
  'driver.approved': async (e) => {
    await send(e, [s(e.payload['userId'])].filter(Boolean), 'DRIVER_APPROVED', {}, { data: { driverProfileId: e.aggregateId } });
  },
  // ── security (the user is the aggregate) ───────────────────────────────────
  'auth.session_opened': async (e) => {
    if (e.payload['newDevice'] !== true) return;
    await send(e, [e.aggregateId], 'SECURITY_NEW_DEVICE', { clientType: s(e.payload['clientType'], 'web'), ipAddress: s(e.payload['ipAddress'], '—'), at: when(e.payload['at']) });
  },
  'auth.password_changed': async (e) => {
    await send(e, [e.aggregateId], 'SECURITY_PASSWORD_CHANGED', { at: when(e.payload['at']) });
  },
  'security.refresh_reuse': async (e) => {
    await send(e, [e.aggregateId], 'SECURITY_SESSION_REVOKED', { at: when(e.payload['at']) });
  },
  'user.roles_changed': async (e) => {
    await send(e, [e.aggregateId], 'ACCESS_CHANGED', {});
  },
  'user.permissions_changed': async (e) => {
    await send(e, [e.aggregateId], 'ACCESS_CHANGED', {});
  },
  // ── engagement ─────────────────────────────────────────────────────────────
  'complaint.raised': async (e) => {
    await send(e, [s(e.payload['raisedByUserId'])].filter(Boolean), 'COMPLAINT_RECEIVED', { complaintNumber: s(e.payload['complaintNumber']), subject: s(e.payload['subject'], '—') }, { data: { complaintId: e.aggregateId } });
  },
  'complaint.resolved': async (e) => {
    const st = s(e.payload['status']);
    await send(e, [s(e.payload['raisedByUserId'])].filter(Boolean), 'COMPLAINT_RESOLVED', { complaintNumber: s(e.payload['complaintNumber']), status: st.toLowerCase(), resolution: s(e.payload['resolution'], '—') }, { variablesByLocale: { ar: { status: st === 'RESOLVED' ? 'محلولة' : 'مرفوضة' } }, data: { complaintId: e.aggregateId } });
  },
  'complaint.awaiting_response': async (e) => {
    await send(e, [s(e.payload['raisedByUserId'])].filter(Boolean), 'COMPLAINT_AWAITING_RESPONSE', { complaintNumber: s(e.payload['complaintNumber']) }, { data: { complaintId: e.aggregateId } });
  },
  // ── finance ────────────────────────────────────────────────────────────────
  'settlement.paid': async (e) => {
    await send(e, await who.usersOfOwner(e.payload['ownerProfileId']), 'SETTLEMENT_PAID', { settlementNumber: s(e.payload['settlementNumber']), amount: s(e.payload['netPayableAmount']), currency: await currency(), ibanLast4: s(e.payload['ibanLast4'], '••••') }, { data: { settlementId: e.aggregateId } });
  },
  'invoice.issued': async (e) => {
    await send(e, await who.usersOfCustomer(e.payload['customerProfileId']), 'INVOICE_ISSUED', { invoiceNumber: s(e.payload['invoiceNumber']), totalAmount: s(e.payload['totalAmount']), currency: await currency(), dueDate: s(e.payload['dueDate'], '—') }, { data: { invoiceId: e.aggregateId } });
  },
  'invoice.overdue_reminder': async (e) => {
    await send(e, await who.usersOfCustomer(e.payload['customerProfileId']), 'INVOICE_OVERDUE', { invoiceNumber: s(e.payload['invoiceNumber']), outstandingAmount: s(e.payload['outstandingAmount']), currency: await currency(), daysOverdue: s(e.payload['daysOverdue']) }, { data: { invoiceId: e.aggregateId } });
  },
};

export async function handleDomainEvent(e: DomainEvent): Promise<boolean> {
  const sub = subscribers[e.eventType];
  if (!sub) return false;
  await sub(e);
  return true;
}
