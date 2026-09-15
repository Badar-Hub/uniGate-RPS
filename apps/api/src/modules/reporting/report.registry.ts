import { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { z } from 'zod';
import { money, toMoneyString } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';

/**
 * The report registry (api.md §8.28, BRIEF-§25). One entry per code: its filters (a strict Zod
 * object — an unsupported filter is a 422, not silently ignored), its columns, whether it is
 * financial, its scope, and `run()` which returns one page of plain rows. Exports drive the same
 * `run()` page by page; the admin Reports screen is generated from `describe()`.
 *
 * Scope: OWN restricts to the actor's owner / customer / SPO profile; GLOBAL sees everything.
 * Every query here is a read over committed rows — no report ever writes.
 */

export type Cell = string | number | boolean | null;
type St<T> = Exclude<T, undefined>;
export type Row = Record<string, Cell>;
export interface ReportContext {
  scope: AnyScope;
  ownerProfileId: string | null;
  customerProfileId: string | null;
  spoProfileId: string | null;
  page: number;
  pageSize: number;
}
export interface ReportColumn {
  key: string;
  labelEn: string;
  labelAr: string;
  type: 'string' | 'number' | 'money' | 'date' | 'datetime' | 'boolean';
}
export interface ReportDef<F extends z.ZodTypeAny = z.ZodTypeAny> {
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  financial: boolean;
  /** `own-global`: owners / customers / SPOs run it on their own rows, staff on all. `global`: staff only. */
  scope: 'own-global' | 'global';
  maxDays: number;
  filters: F;
  columns: ReportColumn[];
  run(ctx: ReportContext, f: z.infer<F>): Promise<{ rows: Row[]; total: number }>;
}

/** Keeps `f` typed as the report's own filter shape inside run() while the registry stays homogeneous. */
function defineReport<F extends z.ZodTypeAny>(def: ReportDef<F>): ReportDef {
  return def as ReportDef;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const dateRange = { dateFrom: isoDate.optional(), dateTo: isoDate.optional() };
const col = (key: string, labelEn: string, labelAr: string, type: ReportColumn['type'] = 'string'): ReportColumn => ({ key, labelEn, labelAr, type });
const d = (v: Date | null | undefined) => (v ? v.toISOString() : null);
const day = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);
const m = (v: Prisma.Decimal | number | string | null | undefined) => toMoneyString(money(v ?? 0));
const skip = (ctx: ReportContext) => (ctx.page - 1) * ctx.pageSize;
const from = (f: { dateFrom?: string | undefined }) => (f.dateFrom ? new Date(f.dateFrom) : undefined);
const to = (f: { dateTo?: string | undefined }) => (f.dateTo ? new Date(new Date(f.dateTo).getTime() + 86_400_000) : undefined);
const between = (f: { dateFrom?: string | undefined; dateTo?: string | undefined }): { gte?: Date; lt?: Date } | undefined => {
  const g = from(f);
  const l = to(f);
  if (!g && !l) return undefined;
  return { ...(g ? { gte: g } : {}), ...(l ? { lt: l } : {}) };
};
const own = (ctx: ReportContext, key: 'ownerProfileId' | 'customerProfileId' | 'attributedSpoProfileId'): Record<string, string> => {
  if (ctx.scope.kind === 'GLOBAL' || ctx.scope.kind === 'SYSTEM') return {};
  const id = key === 'ownerProfileId' ? ctx.ownerProfileId : key === 'customerProfileId' ? ctx.customerProfileId : ctx.spoProfileId;
  return { [key]: id ?? '00000000-0000-0000-0000-000000000000' };
};

// ── operational ──────────────────────────────────────────────────────────────

const bookings = defineReport({
  code: 'bookings', nameEn: 'Bookings', nameAr: 'الحجوزات', descriptionEn: 'One row per booking with parties, schedule, status and value.', financial: false, scope: 'own-global', maxDays: 366,
  filters: z.object({ ...dateRange, status: z.string().max(32).optional(), transportType: z.enum(['PASSENGER', 'GOODS']).optional(), ownerProfileId: uuid.optional(), customerProfileId: uuid.optional() }).strict(),
  columns: [col('bookingNumber', 'Booking', 'الحجز'), col('requestNumber', 'Request', 'الطلب'), col('transportType', 'Vertical', 'القطاع'), col('status', 'Status', 'الحالة'), col('customer', 'Customer', 'العميل'), col('owner', 'Owner', 'المالك'), col('vehiclePlate', 'Vehicle', 'المركبة'), col('scheduledStartAt', 'Start', 'البداية', 'datetime'), col('scheduledEndAt', 'End', 'النهاية', 'datetime'), col('totalAmount', 'Total', 'الإجمالي', 'money'), col('paymentStatus', 'Payment', 'الدفع'), col('createdAt', 'Created', 'أُنشئ', 'datetime')],
  async run(ctx, f) {
    const rng = between(f);
    const where: Prisma.BookingWhereInput = { ...own(ctx, ctx.ownerProfileId ? 'ownerProfileId' : 'customerProfileId'), ...(f.status ? { status: f.status as St<Prisma.BookingWhereInput['status']> } : {}), ...(f.transportType ? { transportType: f.transportType } : {}), ...(f.ownerProfileId ? { ownerProfileId: f.ownerProfileId } : {}), ...(f.customerProfileId ? { customerProfileId: f.customerProfileId } : {}), ...(rng ? { createdAt: rng } : {}) };
    const [rows, total] = await Promise.all([
      prisma().booking.findMany({ where, select: { bookingNumber: true, transportType: true, status: true, paymentStatus: true, scheduledStartAt: true, scheduledEndAt: true, totalAmount: true, createdAt: true, vehiclePlateSnapshot: true, ownerNameSnapshot: true, tripRequest: { select: { requestNumber: true } }, customerProfile: { select: { user: { select: { fullNameEn: true } } } } }, orderBy: { createdAt: 'desc' }, skip: skip(ctx), take: ctx.pageSize }),
      prisma().booking.count({ where }),
    ]);
    return { total, rows: rows.map((b) => ({ bookingNumber: b.bookingNumber, requestNumber: b.tripRequest.requestNumber, transportType: b.transportType, status: b.status, customer: b.customerProfile.user.fullNameEn, owner: b.ownerNameSnapshot, vehiclePlate: b.vehiclePlateSnapshot, scheduledStartAt: d(b.scheduledStartAt), scheduledEndAt: d(b.scheduledEndAt), totalAmount: m(b.totalAmount), paymentStatus: b.paymentStatus, createdAt: d(b.createdAt) })) };
  },
});

const trips = defineReport({
  code: 'trips', nameEn: 'Trips', nameAr: 'الرحلات', descriptionEn: 'One row per trip with driver, timings, distance and status.', financial: false, scope: 'own-global', maxDays: 366,
  filters: z.object({ ...dateRange, status: z.string().max(32).optional(), transportType: z.enum(['PASSENGER', 'GOODS']).optional(), driverProfileId: uuid.optional() }).strict(),
  columns: [col('tripNumber', 'Trip', 'الرحلة'), col('bookingNumber', 'Booking', 'الحجز'), col('transportType', 'Vertical', 'القطاع'), col('status', 'Status', 'الحالة'), col('driver', 'Driver', 'السائق'), col('vehiclePlate', 'Vehicle', 'المركبة'), col('actualStartAt', 'Started', 'بدأت', 'datetime'), col('actualEndAt', 'Ended', 'انتهت', 'datetime'), col('actualDistanceKm', 'Distance km', 'المسافة كم', 'number')],
  async run(ctx, f) {
    const rng = between(f);
    const where: Prisma.TripWhereInput = { booking: { ...own(ctx, ctx.ownerProfileId ? 'ownerProfileId' : 'customerProfileId') }, ...(f.status ? { status: f.status as St<Prisma.TripWhereInput['status']> } : {}), ...(f.transportType ? { transportType: f.transportType } : {}), ...(f.driverProfileId ? { driverProfileId: f.driverProfileId } : {}), ...(rng ? { createdAt: rng } : {}) };
    const [rows, total] = await Promise.all([
      prisma().trip.findMany({ where, select: { tripNumber: true, transportType: true, status: true, actualStartAt: true, actualEndAt: true, actualDistanceKm: true, booking: { select: { bookingNumber: true, vehiclePlateSnapshot: true } }, driverProfile: { select: { user: { select: { fullNameEn: true } } } } }, orderBy: { createdAt: 'desc' }, skip: skip(ctx), take: ctx.pageSize }),
      prisma().trip.count({ where }),
    ]);
    return { total, rows: rows.map((t) => ({ tripNumber: t.tripNumber, bookingNumber: t.booking.bookingNumber, transportType: t.transportType, status: t.status, driver: t.driverProfile?.user.fullNameEn ?? null, vehiclePlate: t.booking.vehiclePlateSnapshot, actualStartAt: d(t.actualStartAt), actualEndAt: d(t.actualEndAt), actualDistanceKm: t.actualDistanceKm ? Number(t.actualDistanceKm) : null })) };
  },
});

interface UtilRow { vehicle_id: string; plate: string; category: string; owner: string; bookings: bigint; completed: bigint; cancelled: bigint; booked_hours: string | null; revenue: string | null; maintenance_days: string | null }
const vehicleUtilisation = defineReport({
  code: 'vehicle-utilisation', nameEn: 'Vehicle utilisation', nameAr: 'استغلال المركبات', descriptionEn: 'Per vehicle: bookings, completed, cancelled, booked hours, revenue and maintenance days in the period.', financial: false, scope: 'own-global', maxDays: 366,
  filters: z.object({ ...dateRange, ownerProfileId: uuid.optional() }).strict(),
  columns: [col('plate', 'Vehicle', 'المركبة'), col('category', 'Category', 'الفئة'), col('owner', 'Owner', 'المالك'), col('bookings', 'Bookings', 'الحجوزات', 'number'), col('completed', 'Completed', 'مكتملة', 'number'), col('cancelled', 'Cancelled', 'ملغاة', 'number'), col('bookedHours', 'Booked hours', 'ساعات الحجز', 'number'), col('revenue', 'Revenue', 'الإيراد', 'money'), col('maintenanceDays', 'Maintenance days', 'أيام الصيانة', 'number')],
  // @raw-sql-reviewed: aggregate per vehicle; every filter is a bound parameter.
  async run(ctx, f) {
    const ownerId = own(ctx, 'ownerProfileId')['ownerProfileId'] ?? f.ownerProfileId ?? null;
    const fromD = from(f) ?? new Date(0);
    const toD = to(f) ?? new Date('2100-01-01');
    const ownerSql = ownerId ? Prisma.sql`AND v.owner_profile_id = ${ownerId}::uuid` : Prisma.empty;
    const rows = await prisma().$queryRaw<UtilRow[]>`
      SELECT v.id AS vehicle_id, v.plate_number_en AS plate, c.code AS category, COALESCE(o.business_name_en, u.full_name_en) AS owner,
        (SELECT COUNT(*) FROM bookings b WHERE b.vehicle_id = v.id AND b.created_at >= ${fromD} AND b.created_at < ${toD}) AS bookings,
        (SELECT COUNT(*) FROM bookings b WHERE b.vehicle_id = v.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS completed,
        (SELECT COUNT(*) FROM bookings b WHERE b.vehicle_id = v.id AND b.status = 'CANCELLED' AND b.cancelled_at >= ${fromD} AND b.cancelled_at < ${toD}) AS cancelled,
        (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (b.scheduled_end_at - b.scheduled_start_at)) / 3600), 0)::text FROM bookings b WHERE b.vehicle_id = v.id AND b.status NOT IN ('CANCELLED', 'REFUNDED') AND b.scheduled_start_at >= ${fromD} AND b.scheduled_start_at < ${toD}) AS booked_hours,
        (SELECT COALESCE(SUM(b.total_amount), 0)::text FROM bookings b WHERE b.vehicle_id = v.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS revenue,
        (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(mr.scheduled_end_at, ${toD}::timestamptz) - GREATEST(mr.scheduled_start_at, ${fromD}::timestamptz))) / 86400), 0)::text FROM maintenance_records mr WHERE mr.vehicle_id = v.id AND mr.status <> 'CANCELLED' AND mr.scheduled_end_at > ${fromD} AND mr.scheduled_start_at < ${toD}) AS maintenance_days
      FROM vehicles v JOIN vehicle_categories c ON c.id = v.vehicle_category_id JOIN owner_profiles o ON o.id = v.owner_profile_id JOIN users u ON u.id = o.user_id
      WHERE v.deleted_at IS NULL ${ownerSql}
      ORDER BY v.plate_number_en
      LIMIT ${ctx.pageSize} OFFSET ${skip(ctx)}`;
    const total = await prisma().vehicle.count({ where: { deletedAt: null, ...(ownerId ? { ownerProfileId: ownerId } : {}) } });
    return { total, rows: rows.map((r) => ({ plate: r.plate, category: r.category, owner: r.owner, bookings: Number(r.bookings), completed: Number(r.completed), cancelled: Number(r.cancelled), bookedHours: Math.round(Number(r.booked_hours ?? 0) * 10) / 10, revenue: m(r.revenue), maintenanceDays: Math.round(Number(r.maintenance_days ?? 0) * 10) / 10 })) };
  },
});

interface CustRow { id: string; name: string; customer_type: string; requests: bigint; bookings: bigint; completed: bigint; cancelled: bigint; spend: string | null; last_booking_at: Date | null }
const customerActivity = defineReport({
  code: 'customer-activity', nameEn: 'Customer activity', nameAr: 'نشاط العملاء', descriptionEn: 'Per customer: requests, bookings, completed, cancelled, spend and last booking.', financial: false, scope: 'global', maxDays: 366,
  filters: z.object({ ...dateRange, customerType: z.enum(['INDIVIDUAL', 'CORPORATE']).optional() }).strict(),
  columns: [col('name', 'Customer', 'العميل'), col('customerType', 'Type', 'النوع'), col('requests', 'Requests', 'الطلبات', 'number'), col('bookings', 'Bookings', 'الحجوزات', 'number'), col('completed', 'Completed', 'مكتملة', 'number'), col('cancelled', 'Cancelled', 'ملغاة', 'number'), col('spend', 'Spend', 'الإنفاق', 'money'), col('lastBookingAt', 'Last booking', 'آخر حجز', 'datetime')],
  // @raw-sql-reviewed: aggregate per customer; bound parameters only.
  async run(ctx, f) {
    const fromD = from(f) ?? new Date(0);
    const toD = to(f) ?? new Date('2100-01-01');
    const typeSql = f.customerType ? Prisma.sql`AND cp.customer_type = ${f.customerType}::customer_type` : Prisma.empty;
    const rows = await prisma().$queryRaw<CustRow[]>`
      SELECT cp.id, COALESCE(cc.company_name_en, u.full_name_en) AS name, cp.customer_type::text AS customer_type,
        (SELECT COUNT(*) FROM trip_requests r WHERE r.customer_profile_id = cp.id AND r.created_at >= ${fromD} AND r.created_at < ${toD}) AS requests,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_profile_id = cp.id AND b.created_at >= ${fromD} AND b.created_at < ${toD}) AS bookings,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_profile_id = cp.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS completed,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_profile_id = cp.id AND b.status = 'CANCELLED' AND b.cancelled_at >= ${fromD} AND b.cancelled_at < ${toD}) AS cancelled,
        (SELECT COALESCE(SUM(b.total_amount), 0)::text FROM bookings b WHERE b.customer_profile_id = cp.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS spend,
        (SELECT MAX(b.created_at) FROM bookings b WHERE b.customer_profile_id = cp.id) AS last_booking_at
      FROM customer_profiles cp JOIN users u ON u.id = cp.user_id LEFT JOIN corporate_customer_profiles cc ON cc.customer_profile_id = cp.id
      WHERE TRUE ${typeSql}
      ORDER BY spend DESC NULLS LAST, name
      LIMIT ${ctx.pageSize} OFFSET ${skip(ctx)}`;
    const total = await prisma().customerProfile.count({ where: f.customerType ? { customerType: f.customerType } : {} });
    return { total, rows: rows.map((r) => ({ name: r.name, customerType: r.customer_type, requests: Number(r.requests), bookings: Number(r.bookings), completed: Number(r.completed), cancelled: Number(r.cancelled), spend: m(r.spend), lastBookingAt: d(r.last_booking_at) })) };
  },
});

const vehicleMaintenance = defineReport({
  code: 'vehicle-maintenance', nameEn: 'Vehicle maintenance', nameAr: 'صيانة المركبات', descriptionEn: 'Maintenance records with workshop, window, odometer and cost.', financial: false, scope: 'own-global', maxDays: 366,
  filters: z.object({ ...dateRange, status: z.string().max(24).optional(), vehicleId: uuid.optional(), ownerProfileId: uuid.optional() }).strict(),
  columns: [col('plate', 'Vehicle', 'المركبة'), col('serviceType', 'Service', 'الخدمة'), col('kind', 'Kind', 'النوع'), col('status', 'Status', 'الحالة'), col('scheduledStartAt', 'From', 'من', 'datetime'), col('scheduledEndAt', 'To', 'إلى', 'datetime'), col('odometerKm', 'Odometer', 'العداد', 'number'), col('workshop', 'Workshop', 'الورشة'), col('totalAmount', 'Cost', 'التكلفة', 'money')],
  async run(ctx, f) {
    const ownerId = own(ctx, 'ownerProfileId')['ownerProfileId'] ?? f.ownerProfileId;
    const rng = between(f);
    const where: Prisma.MaintenanceRecordWhereInput = { ...(ownerId ? { vehicle: { ownerProfileId: ownerId } } : {}), ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}), ...(f.status ? { status: f.status as St<Prisma.MaintenanceRecordWhereInput['status']> } : {}), ...(rng ? { scheduledStartAt: rng } : {}) };
    const [rows, total] = await Promise.all([
      prisma().maintenanceRecord.findMany({ where, select: { maintenanceKind: true, status: true, scheduledStartAt: true, scheduledEndAt: true, odometerKm: true, workshopName: true, totalAmount: true, vehicle: { select: { plateNumberEn: true } }, serviceType: { select: { nameEn: true } } }, orderBy: { scheduledStartAt: 'desc' }, skip: skip(ctx), take: ctx.pageSize }),
      prisma().maintenanceRecord.count({ where }),
    ]);
    return { total, rows: rows.map((r) => ({ plate: r.vehicle.plateNumberEn, serviceType: r.serviceType.nameEn, kind: r.maintenanceKind, status: r.status, scheduledStartAt: d(r.scheduledStartAt), scheduledEndAt: d(r.scheduledEndAt), odometerKm: r.odometerKm, workshop: r.workshopName, totalAmount: m(r.totalAmount) })) };
  },
});

const expenses = defineReport({
  code: 'expenses', nameEn: 'Expenses', nameAr: 'المصروفات', descriptionEn: 'Owner expenses by date, category and vehicle.', financial: false, scope: 'own-global', maxDays: 366,
  filters: z.object({ ...dateRange, ownerProfileId: uuid.optional(), vehicleId: uuid.optional(), categoryCode: z.string().max(48).optional() }).strict(),
  columns: [col('expenseDate', 'Date', 'التاريخ', 'date'), col('owner', 'Owner', 'المالك'), col('category', 'Category', 'الفئة'), col('plate', 'Vehicle', 'المركبة'), col('vendor', 'Vendor', 'المورد'), col('amount', 'Net', 'الصافي', 'money'), col('vatAmount', 'VAT', 'الضريبة', 'money'), col('totalAmount', 'Total', 'الإجمالي', 'money')],
  async run(ctx, f) {
    const where: Prisma.ExpenseWhereInput = { ...own(ctx, 'ownerProfileId'), ...(f.ownerProfileId ? { ownerProfileId: f.ownerProfileId } : {}), ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}), ...(f.categoryCode ? { category: { code: f.categoryCode } } : {}), ...(f.dateFrom || f.dateTo ? { expenseDate: { ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}), ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}) } } : {}) };
    const [rows, total] = await Promise.all([
      prisma().expense.findMany({ where, select: { expenseDate: true, amount: true, vatAmount: true, totalAmount: true, vendorName: true, category: { select: { code: true } }, vehicle: { select: { plateNumberEn: true } }, ownerProfile: { select: { businessNameEn: true, user: { select: { fullNameEn: true } } } } }, orderBy: { expenseDate: 'desc' }, skip: skip(ctx), take: ctx.pageSize }),
      prisma().expense.count({ where }),
    ]);
    return { total, rows: rows.map((e) => ({ expenseDate: day(e.expenseDate), owner: e.ownerProfile.businessNameEn ?? e.ownerProfile.user.fullNameEn, category: e.category.code, plate: e.vehicle?.plateNumberEn ?? null, vendor: e.vendorName, amount: m(e.amount), vatAmount: m(e.vatAmount), totalAmount: m(e.totalAmount) })) };
  },
});

interface FulfilRow { id: string; request_number: string; status: string; transport_type: string; allow_partial: boolean; customer: string; vehicles_required: number; vehicles_awarded: number; dispatched: bigint; completed: bigint; cancelled: bigint; waves: bigint; days_to_fill: string | null; created_at: Date }
const orderFulfilment = defineReport({
  code: 'order-fulfilment', nameEn: 'Order fulfilment', nameAr: 'إتمام الطلبات', descriptionEn: 'Per trip request: required vs awarded / dispatched / completed / cancelled, fill rate, waves and days to fill (A-45).', financial: false, scope: 'own-global', maxDays: 366,
  filters: z.object({ ...dateRange, status: z.string().max(32).optional(), transportType: z.enum(['PASSENGER', 'GOODS']).optional(), allowPartialFulfilment: z.coerce.boolean().optional(), customerProfileId: uuid.optional(), minFillRate: z.coerce.number().min(0).max(1).optional() }).strict(),
  columns: [col('requestNumber', 'Request', 'الطلب'), col('status', 'Status', 'الحالة'), col('transportType', 'Vertical', 'القطاع'), col('customer', 'Customer', 'العميل'), col('allowPartialFulfilment', 'Partial allowed', 'يسمح بالجزئي', 'boolean'), col('vehiclesRequired', 'Required', 'المطلوب', 'number'), col('vehiclesAwarded', 'Awarded', 'المُسند', 'number'), col('vehiclesDispatched', 'Dispatched', 'المُرسل', 'number'), col('vehiclesCompleted', 'Completed', 'المكتمل', 'number'), col('vehiclesCancelled', 'Cancelled', 'الملغى', 'number'), col('fillRate', 'Fill rate', 'نسبة الإتمام', 'number'), col('waveCount', 'Waves', 'الموجات', 'number'), col('daysToFill', 'Days to fill', 'أيام الإتمام', 'number'), col('createdAt', 'Created', 'أُنشئ', 'datetime')],
  // @raw-sql-reviewed: per-request aggregate over bookings; bound parameters only.
  async run(ctx, f) {
    const customerId = own(ctx, 'customerProfileId')['customerProfileId'] ?? f.customerProfileId ?? null;
    const fromD = from(f) ?? new Date(0);
    const toD = to(f) ?? new Date('2100-01-01');
    const conds = [
      customerId ? Prisma.sql`AND r.customer_profile_id = ${customerId}::uuid` : Prisma.empty,
      f.status ? Prisma.sql`AND r.status::text = ${f.status}` : Prisma.empty,
      f.transportType ? Prisma.sql`AND r.transport_type = ${f.transportType}::transport_type` : Prisma.empty,
      f.allowPartialFulfilment !== undefined ? Prisma.sql`AND r.allow_partial_fulfilment = ${f.allowPartialFulfilment}` : Prisma.empty,
    ];
    const base = Prisma.sql`FROM trip_requests r JOIN customer_profiles cp ON cp.id = r.customer_profile_id JOIN users u ON u.id = cp.user_id LEFT JOIN corporate_customer_profiles cc ON cc.customer_profile_id = cp.id WHERE r.created_at >= ${fromD} AND r.created_at < ${toD} ${conds[0]} ${conds[1]} ${conds[2]} ${conds[3]}`;
    const rows = await prisma().$queryRaw<FulfilRow[]>`
      SELECT r.id, r.request_number, r.status::text AS status, r.transport_type::text AS transport_type, r.allow_partial_fulfilment AS allow_partial, COALESCE(cc.company_name_en, u.full_name_en) AS customer, r.vehicles_required, r.vehicles_awarded,
        (SELECT COUNT(*) FROM bookings b WHERE b.trip_request_id = r.id AND b.status IN ('DRIVER_ASSIGNED', 'READY', 'IN_PROGRESS', 'COMPLETED')) AS dispatched,
        (SELECT COUNT(*) FROM bookings b WHERE b.trip_request_id = r.id AND b.status = 'COMPLETED') AS completed,
        (SELECT COUNT(*) FROM bookings b WHERE b.trip_request_id = r.id AND b.status IN ('CANCELLED', 'REFUNDED')) AS cancelled,
        (SELECT COUNT(DISTINCT b.fulfilment_sequence) FROM bookings b WHERE b.trip_request_id = r.id) AS waves,
        (SELECT EXTRACT(EPOCH FROM (MAX(b.created_at) - r.created_at)) / 86400 FROM bookings b WHERE b.trip_request_id = r.id)::text AS days_to_fill,
        r.created_at
      ${base}
      ORDER BY r.created_at DESC
      LIMIT ${ctx.pageSize} OFFSET ${skip(ctx)}`;
    const count = await prisma().$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n ${base}`;
    const mapped = rows.map((r) => {
      const fill = r.vehicles_required ? Math.round((Number(r.completed) / r.vehicles_required) * 10_000) / 10_000 : 0;
      return { requestNumber: r.request_number, status: r.status, transportType: r.transport_type, customer: r.customer, allowPartialFulfilment: r.allow_partial, vehiclesRequired: r.vehicles_required, vehiclesAwarded: r.vehicles_awarded, vehiclesDispatched: Number(r.dispatched), vehiclesCompleted: Number(r.completed), vehiclesCancelled: Number(r.cancelled), fillRate: fill, waveCount: Number(r.waves), daysToFill: r.days_to_fill ? Math.round(Number(r.days_to_fill) * 100) / 100 : null, createdAt: d(r.created_at) };
    });
    return { total: Number(count[0]?.n ?? 0), rows: f.minFillRate !== undefined ? mapped.filter((r) => r.fillRate >= (f.minFillRate ?? 0)) : mapped };
  },
});

// ── financial ────────────────────────────────────────────────────────────────

interface RevenueRow { bucket: Date; transport_revenue: string | null; commission_revenue: string | null; vat_payable: string | null; refunds: string | null; fees: string | null }
const revenue = defineReport({
  code: 'revenue', nameEn: 'Revenue', nameAr: 'الإيرادات', descriptionEn: 'Ledger-derived revenue per day: transport revenue (platform fleet), platform commission, VAT payable, refunds issued, processing fees.', financial: true, scope: 'global', maxDays: 366,
  filters: z.object({ ...dateRange }).strict(),
  columns: [col('date', 'Date', 'التاريخ', 'date'), col('transportRevenue', 'Transport revenue', 'إيراد النقل', 'money'), col('commissionRevenue', 'Commission', 'العمولة', 'money'), col('vatPayable', 'VAT payable', 'الضريبة المستحقة', 'money'), col('refundsIssued', 'Refunds', 'الاستردادات', 'money'), col('processingFees', 'Processing fees', 'رسوم المعالجة', 'money'), col('netRevenue', 'Net revenue', 'صافي الإيراد', 'money')],
  // @raw-sql-reviewed: ledger aggregate per day over account codes; bound range.
  async run(ctx, f) {
    const fromD = from(f) ?? new Date(Date.now() - 30 * 86_400_000);
    const toD = to(f) ?? new Date();
    const rows = await prisma().$queryRaw<RevenueRow[]>`
      SELECT date_trunc('day', le.occurred_at) AS bucket,
        COALESCE(SUM(CASE WHEN la.code = 'TRANSPORT_REVENUE' THEN CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END END), 0)::text AS transport_revenue,
        COALESCE(SUM(CASE WHEN la.code = 'PLATFORM_COMMISSION_REVENUE' THEN CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END END), 0)::text AS commission_revenue,
        COALESCE(SUM(CASE WHEN la.code = 'VAT_PAYABLE' THEN CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END END), 0)::text AS vat_payable,
        COALESCE(SUM(CASE WHEN la.code = 'REFUNDS_ISSUED' THEN CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE -le.amount END END), 0)::text AS refunds,
        COALESCE(SUM(CASE WHEN la.code = 'PAYMENT_PROCESSING_FEES' THEN CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE -le.amount END END), 0)::text AS fees
      FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.ledger_account_id
      WHERE le.occurred_at >= ${fromD} AND le.occurred_at < ${toD}
      GROUP BY 1 ORDER BY 1 DESC
      LIMIT ${ctx.pageSize} OFFSET ${skip(ctx)}`;
    const count = await prisma().$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT date_trunc('day', occurred_at)) AS n FROM ledger_entries WHERE occurred_at >= ${fromD} AND occurred_at < ${toD}`;
    return { total: Number(count[0]?.n ?? 0), rows: rows.map((r) => ({ date: day(r.bucket), transportRevenue: m(r.transport_revenue), commissionRevenue: m(r.commission_revenue), vatPayable: m(r.vat_payable), refundsIssued: m(r.refunds), processingFees: m(r.fees), netRevenue: m(money(r.transport_revenue ?? 0).add(money(r.commission_revenue ?? 0)).sub(money(r.refunds ?? 0)).sub(money(r.fees ?? 0))) })) };
  },
});

interface AgeingRow { customer_profile_id: string; company: string; credit_status: string; credit_limit: Prisma.Decimal; outstanding: string | null; current: string | null; d1_30: string | null; d31_60: string | null; d61_90: string | null; over_90: string | null; oldest_number: string | null; oldest_due: Date | null }
const arAgeing = defineReport({
  code: 'accounts-receivable-ageing', nameEn: 'Accounts receivable ageing', nameAr: 'أعمار الذمم المدينة', descriptionEn: 'Per corporate customer: outstanding balance and ageing buckets keyed on invoice due date (A-46).', financial: true, scope: 'global', maxDays: 366,
  filters: z.object({ creditStatus: z.string().max(24).optional(), minOutstanding: z.coerce.number().min(0).optional(), asOf: isoDate.optional() }).strict(),
  columns: [col('companyNameEn', 'Customer', 'العميل'), col('creditStatus', 'Credit', 'الائتمان'), col('creditLimitAmount', 'Limit', 'الحد', 'money'), col('outstandingAmount', 'Outstanding', 'المستحق', 'money'), col('current', 'Current', 'جارٍ', 'money'), col('d1to30', '1–30', '1–30', 'money'), col('d31to60', '31–60', '31–60', 'money'), col('d61to90', '61–90', '61–90', 'money'), col('over90', '90+', '90+', 'money'), col('oldestInvoiceNumber', 'Oldest invoice', 'أقدم فاتورة'), col('oldestDueDate', 'Oldest due', 'أقدم استحقاق', 'date')],
  // @raw-sql-reviewed: balances from CUSTOMER_RECEIVABLE, buckets from invoices; bound parameters.
  async run(ctx, f) {
    const asOf = f.asOf ? new Date(f.asOf) : new Date();
    const statusSql = f.creditStatus ? Prisma.sql`AND cc.credit_status::text = ${f.creditStatus}` : Prisma.empty;
    const rows = await prisma().$queryRaw<AgeingRow[]>`
      SELECT cc.customer_profile_id, cc.company_name_en AS company, cc.credit_status::text AS credit_status, cc.credit_limit_amount AS credit_limit,
        (SELECT COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE -le.amount END), 0)::text FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.ledger_account_id WHERE la.code = 'CUSTOMER_RECEIVABLE' AND le.customer_profile_id = cc.customer_profile_id AND le.occurred_at <= ${asOf}) AS outstanding,
        (SELECT COALESCE(SUM(outstanding_amount), 0)::text FROM invoices i WHERE i.issued_to_customer_profile_id = cc.customer_profile_id AND i.status NOT IN ('DRAFT', 'VOID', 'PAID') AND i.due_date >= ${asOf}::date) AS current,
        (SELECT COALESCE(SUM(outstanding_amount), 0)::text FROM invoices i WHERE i.issued_to_customer_profile_id = cc.customer_profile_id AND i.status NOT IN ('DRAFT', 'VOID', 'PAID') AND ${asOf}::date - i.due_date BETWEEN 1 AND 30) AS d1_30,
        (SELECT COALESCE(SUM(outstanding_amount), 0)::text FROM invoices i WHERE i.issued_to_customer_profile_id = cc.customer_profile_id AND i.status NOT IN ('DRAFT', 'VOID', 'PAID') AND ${asOf}::date - i.due_date BETWEEN 31 AND 60) AS d31_60,
        (SELECT COALESCE(SUM(outstanding_amount), 0)::text FROM invoices i WHERE i.issued_to_customer_profile_id = cc.customer_profile_id AND i.status NOT IN ('DRAFT', 'VOID', 'PAID') AND ${asOf}::date - i.due_date BETWEEN 61 AND 90) AS d61_90,
        (SELECT COALESCE(SUM(outstanding_amount), 0)::text FROM invoices i WHERE i.issued_to_customer_profile_id = cc.customer_profile_id AND i.status NOT IN ('DRAFT', 'VOID', 'PAID') AND ${asOf}::date - i.due_date > 90) AS over_90,
        (SELECT i.invoice_number FROM invoices i WHERE i.issued_to_customer_profile_id = cc.customer_profile_id AND i.status NOT IN ('DRAFT', 'VOID', 'PAID') AND i.outstanding_amount > 0 ORDER BY i.due_date ASC LIMIT 1) AS oldest_number,
        (SELECT i.due_date FROM invoices i WHERE i.issued_to_customer_profile_id = cc.customer_profile_id AND i.status NOT IN ('DRAFT', 'VOID', 'PAID') AND i.outstanding_amount > 0 ORDER BY i.due_date ASC LIMIT 1) AS oldest_due
      FROM corporate_customer_profiles cc
      WHERE TRUE ${statusSql}
      ORDER BY outstanding DESC NULLS LAST, company
      LIMIT ${ctx.pageSize} OFFSET ${skip(ctx)}`;
    const total = await prisma().corporateCustomerProfile.count({ where: f.creditStatus ? { creditStatus: f.creditStatus as never } : {} });
    const mapped = rows.map((r) => ({ companyNameEn: r.company, creditStatus: r.credit_status, creditLimitAmount: m(r.credit_limit), outstandingAmount: m(r.outstanding), current: m(r.current), d1to30: m(r.d1_30), d31to60: m(r.d31_60), d61to90: m(r.d61_90), over90: m(r.over_90), oldestInvoiceNumber: r.oldest_number, oldestDueDate: day(r.oldest_due) }));
    return { total, rows: f.minOutstanding !== undefined ? mapped.filter((r) => Number(r.outstandingAmount) >= (f.minOutstanding ?? 0)) : mapped };
  },
});

const commission = defineReport({
  code: 'commission', nameEn: 'Commission', nameAr: 'العمولات', descriptionEn: 'Per completed booking: gross, commission, commission VAT, owner net and the rule source.', financial: true, scope: 'global', maxDays: 366,
  filters: z.object({ ...dateRange, ownerProfileId: uuid.optional(), transportType: z.enum(['PASSENGER', 'GOODS']).optional() }).strict(),
  columns: [col('completedAt', 'Completed', 'اكتمل', 'datetime'), col('bookingNumber', 'Booking', 'الحجز'), col('transportType', 'Vertical', 'القطاع'), col('owner', 'Owner', 'المالك'), col('grossAmount', 'Gross', 'الإجمالي', 'money'), col('commissionAmount', 'Commission', 'العمولة', 'money'), col('commissionVatAmount', 'Commission VAT', 'ضريبة العمولة', 'money'), col('paymentFeeAmount', 'Payment fee', 'رسوم الدفع', 'money'), col('ownerNetAmount', 'Owner net', 'صافي المالك', 'money'), col('commissionSource', 'Source', 'المصدر')],
  async run(ctx, f) {
    const rng = between(f);
    const where: Prisma.BookingWhereInput = { status: 'COMPLETED', financialSnapshot: { isNot: null }, ...(f.ownerProfileId ? { ownerProfileId: f.ownerProfileId } : {}), ...(f.transportType ? { transportType: f.transportType } : {}), ...(rng ? { completedAt: rng } : {}) };
    const [rows, total] = await Promise.all([
      prisma().booking.findMany({ where, select: { bookingNumber: true, transportType: true, completedAt: true, ownerNameSnapshot: true, financialSnapshot: { select: { grossAmount: true, commissionAmount: true, commissionVatAmount: true, paymentFeeAmount: true, ownerNetAmount: true, commissionSource: true } } }, orderBy: { completedAt: 'desc' }, skip: skip(ctx), take: ctx.pageSize }),
      prisma().booking.count({ where }),
    ]);
    return { total, rows: rows.map((b) => ({ completedAt: d(b.completedAt), bookingNumber: b.bookingNumber, transportType: b.transportType, owner: b.ownerNameSnapshot, grossAmount: m(b.financialSnapshot?.grossAmount), commissionAmount: m(b.financialSnapshot?.commissionAmount), commissionVatAmount: m(b.financialSnapshot?.commissionVatAmount), paymentFeeAmount: m(b.financialSnapshot?.paymentFeeAmount), ownerNetAmount: m(b.financialSnapshot?.ownerNetAmount), commissionSource: b.financialSnapshot?.commissionSource ?? null })) };
  },
});

interface EarnRow { owner_profile_id: string; owner: string; completed: bigint; gross: string | null; commission: string | null; net: string | null; settled: string | null; penalties: string | null }
const ownerEarnings = defineReport({
  code: 'owner-earnings', nameEn: 'Owner earnings', nameAr: 'أرباح المالكين', descriptionEn: 'Per owner: completed bookings, gross, commission, net earned, settled to date and penalties.', financial: true, scope: 'own-global', maxDays: 366,
  filters: z.object({ ...dateRange, ownerProfileId: uuid.optional() }).strict(),
  columns: [col('owner', 'Owner', 'المالك'), col('completedBookings', 'Completed', 'مكتملة', 'number'), col('grossAmount', 'Gross', 'الإجمالي', 'money'), col('commissionAmount', 'Commission', 'العمولة', 'money'), col('netEarned', 'Net earned', 'الصافي', 'money'), col('settledAmount', 'Settled', 'المسوّى', 'money'), col('penalties', 'Penalties', 'الغرامات', 'money')],
  // @raw-sql-reviewed: aggregate per owner; bound parameters only.
  async run(ctx, f) {
    const ownerId = own(ctx, 'ownerProfileId')['ownerProfileId'] ?? f.ownerProfileId ?? null;
    const fromD = from(f) ?? new Date(0);
    const toD = to(f) ?? new Date('2100-01-01');
    const ownerSql = ownerId ? Prisma.sql`AND o.id = ${ownerId}::uuid` : Prisma.empty;
    const rows = await prisma().$queryRaw<EarnRow[]>`
      SELECT o.id AS owner_profile_id, COALESCE(o.business_name_en, u.full_name_en) AS owner,
        (SELECT COUNT(*) FROM bookings b WHERE b.owner_profile_id = o.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS completed,
        (SELECT COALESCE(SUM(f.gross_amount), 0)::text FROM booking_financial_snapshots f JOIN bookings b ON b.id = f.booking_id WHERE b.owner_profile_id = o.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS gross,
        (SELECT COALESCE(SUM(f.commission_amount + f.commission_vat_amount), 0)::text FROM booking_financial_snapshots f JOIN bookings b ON b.id = f.booking_id WHERE b.owner_profile_id = o.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS commission,
        (SELECT COALESCE(SUM(f.owner_net_amount), 0)::text FROM booking_financial_snapshots f JOIN bookings b ON b.id = f.booking_id WHERE b.owner_profile_id = o.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS net,
        (SELECT COALESCE(SUM(s.net_payable_amount), 0)::text FROM settlements s WHERE s.owner_profile_id = o.id AND s.status = 'PAID' AND s.paid_at >= ${fromD} AND s.paid_at < ${toD}) AS settled,
        (SELECT COALESCE(SUM(c.cancellation_fee_amount), 0)::text FROM booking_cancellations c JOIN bookings b ON b.id = c.booking_id WHERE b.owner_profile_id = o.id AND c.fee_payer = 'OWNER' AND c.fee_waived_at IS NULL AND c.cancelled_at >= ${fromD} AND c.cancelled_at < ${toD}) AS penalties
      FROM owner_profiles o JOIN users u ON u.id = o.user_id
      WHERE o.is_platform_fleet = FALSE ${ownerSql}
      ORDER BY net DESC NULLS LAST, owner
      LIMIT ${ctx.pageSize} OFFSET ${skip(ctx)}`;
    const total = await prisma().ownerProfile.count({ where: { isPlatformFleet: false, ...(ownerId ? { id: ownerId } : {}) } });
    return { total, rows: rows.map((r) => ({ owner: r.owner, completedBookings: Number(r.completed), grossAmount: m(r.gross), commissionAmount: m(r.commission), netEarned: m(r.net), settledAmount: m(r.settled), penalties: m(r.penalties) })) };
  },
});

const settlements = defineReport({
  code: 'settlements', nameEn: 'Settlements', nameAr: 'التسويات', descriptionEn: 'Settlement batches with period, status, totals and payout.', financial: true, scope: 'own-global', maxDays: 366,
  filters: z.object({ ...dateRange, status: z.string().max(24).optional(), ownerProfileId: uuid.optional() }).strict(),
  columns: [col('settlementNumber', 'Settlement', 'التسوية'), col('owner', 'Owner', 'المالك'), col('periodStart', 'Period start', 'بداية الفترة', 'date'), col('periodEnd', 'Period end', 'نهاية الفترة', 'date'), col('status', 'Status', 'الحالة'), col('grossAmount', 'Gross', 'الإجمالي', 'money'), col('commissionAmount', 'Commission', 'العمولة', 'money'), col('adjustmentsAmount', 'Adjustments', 'التعديلات', 'money'), col('netPayableAmount', 'Net payable', 'الصافي المستحق', 'money'), col('paidAt', 'Paid', 'دُفعت', 'datetime')],
  async run(ctx, f) {
    const rng = between(f);
    const where: Prisma.SettlementWhereInput = { ...own(ctx, 'ownerProfileId'), ...(f.ownerProfileId ? { ownerProfileId: f.ownerProfileId } : {}), ...(f.status ? { status: f.status as St<Prisma.SettlementWhereInput['status']> } : {}), ...(rng ? { createdAt: rng } : {}) };
    const [rows, total] = await Promise.all([
      prisma().settlement.findMany({ where, select: { settlementNumber: true, periodStart: true, periodEnd: true, status: true, grossAmount: true, commissionAmount: true, adjustmentsAmount: true, netPayableAmount: true, paidAt: true, ownerProfile: { select: { businessNameEn: true, user: { select: { fullNameEn: true } } } } }, orderBy: { createdAt: 'desc' }, skip: skip(ctx), take: ctx.pageSize }),
      prisma().settlement.count({ where }),
    ]);
    return { total, rows: rows.map((s) => ({ settlementNumber: s.settlementNumber, owner: s.ownerProfile.businessNameEn ?? s.ownerProfile.user.fullNameEn, periodStart: day(s.periodStart), periodEnd: day(s.periodEnd), status: s.status, grossAmount: m(s.grossAmount), commissionAmount: m(s.commissionAmount), adjustmentsAmount: m(s.adjustmentsAmount), netPayableAmount: m(s.netPayableAmount), paidAt: d(s.paidAt) })) };
  },
});

const payments = defineReport({
  code: 'payments', nameEn: 'Payments', nameAr: 'المدفوعات', descriptionEn: 'Payments by status, method and provider.', financial: true, scope: 'global', maxDays: 366,
  filters: z.object({ ...dateRange, status: z.string().max(24).optional(), providerCode: z.string().max(48).optional(), methodType: z.string().max(24).optional() }).strict(),
  columns: [col('paymentNumber', 'Payment', 'الدفعة'), col('createdAt', 'Created', 'أُنشئت', 'datetime'), col('paidAt', 'Paid', 'دُفعت', 'datetime'), col('status', 'Status', 'الحالة'), col('providerCode', 'Provider', 'المزود'), col('methodType', 'Method', 'الوسيلة'), col('bookingNumber', 'Booking', 'الحجز'), col('invoiceNumber', 'Invoice', 'الفاتورة'), col('amount', 'Amount', 'المبلغ', 'money')],
  async run(ctx, f) {
    const rng = between(f);
    const where: Prisma.PaymentWhereInput = { ...(f.status ? { status: f.status as St<Prisma.PaymentWhereInput['status']> } : {}), ...(f.providerCode ? { providerCode: f.providerCode } : {}), ...(f.methodType ? { paymentMethodType: f.methodType as St<Prisma.PaymentWhereInput['paymentMethodType']> } : {}), ...(rng ? { createdAt: rng } : {}) };
    const [rows, total] = await Promise.all([
      prisma().payment.findMany({ where, select: { paymentNumber: true, createdAt: true, paidAt: true, status: true, providerCode: true, paymentMethodType: true, amount: true, booking: { select: { bookingNumber: true } }, invoice: { select: { invoiceNumber: true } } }, orderBy: { createdAt: 'desc' }, skip: skip(ctx), take: ctx.pageSize }),
      prisma().payment.count({ where }),
    ]);
    return { total, rows: rows.map((p) => ({ paymentNumber: p.paymentNumber, createdAt: d(p.createdAt), paidAt: d(p.paidAt), status: p.status, providerCode: p.providerCode, methodType: p.paymentMethodType, bookingNumber: p.booking?.bookingNumber ?? null, invoiceNumber: p.invoice?.invoiceNumber ?? null, amount: m(p.amount) })) };
  },
});

const refunds = defineReport({
  code: 'refunds', nameEn: 'Refunds', nameAr: 'الاستردادات', descriptionEn: 'Refunds by status and reason with the four-eyes trail.', financial: true, scope: 'global', maxDays: 366,
  filters: z.object({ ...dateRange, status: z.string().max(24).optional(), reasonCode: z.string().max(48).optional() }).strict(),
  columns: [col('refundNumber', 'Refund', 'الاسترداد'), col('createdAt', 'Requested', 'طُلب', 'datetime'), col('status', 'Status', 'الحالة'), col('reasonCode', 'Reason', 'السبب'), col('paymentNumber', 'Payment', 'الدفعة'), col('bookingNumber', 'Booking', 'الحجز'), col('amount', 'Amount', 'المبلغ', 'money'), col('requestedBy', 'Requested by', 'طلبه'), col('approvedBy', 'Approved by', 'وافق عليه')],
  async run(ctx, f) {
    const rng = between(f);
    const where: Prisma.RefundWhereInput = { ...(f.status ? { status: f.status as St<Prisma.RefundWhereInput['status']> } : {}), ...(f.reasonCode ? { reasonCode: f.reasonCode } : {}), ...(rng ? { createdAt: rng } : {}) };
    const [rows, total] = await Promise.all([
      prisma().refund.findMany({ where, select: { refundNumber: true, createdAt: true, status: true, reasonCode: true, amount: true, requestedByUserId: true, approvedByUserId: true, payment: { select: { paymentNumber: true } }, booking: { select: { bookingNumber: true } } }, orderBy: { createdAt: 'desc' }, skip: skip(ctx), take: ctx.pageSize }),
      prisma().refund.count({ where }),
    ]);
    const ids = [...new Set(rows.flatMap((r) => [r.requestedByUserId, r.approvedByUserId].filter((x): x is string => Boolean(x))))];
    const names = new Map((await prisma().user.findMany({ where: { id: { in: ids } }, select: { id: true, fullNameEn: true } })).map((u) => [u.id, u.fullNameEn]));
    return { total, rows: rows.map((r) => ({ refundNumber: r.refundNumber, createdAt: d(r.createdAt), status: r.status, reasonCode: r.reasonCode, paymentNumber: r.payment.paymentNumber, bookingNumber: r.booking?.bookingNumber ?? null, amount: m(r.amount), requestedBy: r.requestedByUserId ? (names.get(r.requestedByUserId) ?? null) : null, approvedBy: r.approvedByUserId ? (names.get(r.approvedByUserId) ?? null) : null })) };
  },
});

interface SpoRow { spo_profile_id: string; employee_code: string; name: string; customers: bigint; requests: bigint; bookings: bigint; completed: bigint; gross: string | null; commission: string | null }
const spoPerformance = defineReport({
  code: 'spo-performance', nameEn: 'SPO performance', nameAr: 'أداء مندوبي المبيعات', descriptionEn: 'Per sales officer: customers acquired, attributed requests, bookings, completed value and SPO commission.', financial: true, scope: 'own-global', maxDays: 366,
  filters: z.object({ ...dateRange, spoProfileId: uuid.optional() }).strict(),
  columns: [col('employeeCode', 'Code', 'الرمز'), col('name', 'Officer', 'المندوب'), col('customersAcquired', 'Customers', 'العملاء', 'number'), col('requests', 'Requests', 'الطلبات', 'number'), col('bookings', 'Bookings', 'الحجوزات', 'number'), col('completed', 'Completed', 'مكتملة', 'number'), col('grossValue', 'Completed value', 'قيمة المكتمل', 'money'), col('spoCommission', 'SPO commission', 'عمولة المندوب', 'money')],
  // @raw-sql-reviewed: aggregate per SPO profile; bound parameters only.
  async run(ctx, f) {
    const spoId = own(ctx, 'attributedSpoProfileId')['attributedSpoProfileId'] ?? f.spoProfileId ?? null;
    const fromD = from(f) ?? new Date(0);
    const toD = to(f) ?? new Date('2100-01-01');
    const spoSql = spoId ? Prisma.sql`AND s.id = ${spoId}::uuid` : Prisma.empty;
    const rows = await prisma().$queryRaw<SpoRow[]>`
      SELECT s.id AS spo_profile_id, s.employee_code, u.full_name_en AS name,
        (SELECT COUNT(*) FROM customer_profiles cp WHERE cp.acquired_by_spo_id = s.id AND cp.created_at >= ${fromD} AND cp.created_at < ${toD}) AS customers,
        (SELECT COUNT(*) FROM trip_requests r WHERE r.attributed_spo_profile_id = s.id AND r.created_at >= ${fromD} AND r.created_at < ${toD}) AS requests,
        (SELECT COUNT(*) FROM bookings b WHERE b.attributed_spo_profile_id = s.id AND b.created_at >= ${fromD} AND b.created_at < ${toD}) AS bookings,
        (SELECT COUNT(*) FROM bookings b WHERE b.attributed_spo_profile_id = s.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS completed,
        (SELECT COALESCE(SUM(b.total_amount), 0)::text FROM bookings b WHERE b.attributed_spo_profile_id = s.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS gross,
        (SELECT COALESCE(SUM(fs.spo_commission_amount), 0)::text FROM booking_financial_snapshots fs JOIN bookings b ON b.id = fs.booking_id WHERE b.attributed_spo_profile_id = s.id AND b.status = 'COMPLETED' AND b.completed_at >= ${fromD} AND b.completed_at < ${toD}) AS commission
      FROM spo_profiles s JOIN users u ON u.id = s.user_id
      WHERE TRUE ${spoSql}
      ORDER BY gross DESC NULLS LAST, name
      LIMIT ${ctx.pageSize} OFFSET ${skip(ctx)}`;
    const total = await prisma().spoProfile.count({ where: spoId ? { id: spoId } : {} });
    return { total, rows: rows.map((r) => ({ employeeCode: r.employee_code, name: r.name, customersAcquired: Number(r.customers), requests: Number(r.requests), bookings: Number(r.bookings), completed: Number(r.completed), grossValue: m(r.gross), spoCommission: m(r.commission) })) };
  },
});

export const REPORTS: readonly ReportDef[] = [bookings, trips, vehicleUtilisation, customerActivity, vehicleMaintenance, expenses, orderFulfilment, revenue, arAgeing, commission, ownerEarnings, settlements, payments, refunds, spoPerformance];

export function reportByCode(code: string): ReportDef | null {
  return REPORTS.find((r) => r.code === code) ?? null;
}

// ── audit export (api.md §8.30 — reachable only through POST /audit-logs/export) ──

interface AuditRow { id: string; occurredAt: Date; actorUserId: string | null; actorType: string; actorRoles: string[]; action: string; entityType: string; entityId: string; severity: string; ipAddress: string | null; requestId: string | null; changedFields: string[] }
export const auditLogsReport = defineReport({
  code: 'audit-logs', nameEn: 'Audit log export', nameAr: 'تصدير سجل التدقيق', descriptionEn: 'Audit rows for a bounded window (max 90 days). Before/after values are excluded from the export; use the entity history endpoint for those.', financial: false, scope: 'global', maxDays: 90,
  filters: z.object({ dateFrom: isoDate, dateTo: isoDate, actorUserId: uuid.optional(), action: z.string().max(96).optional(), entityType: z.string().max(64).optional(), severity: z.enum(['INFO', 'NOTICE', 'WARNING', 'SECURITY']).optional() }).strict(),
  columns: [col('occurredAt', 'When', 'متى', 'datetime'), col('severity', 'Severity', 'الخطورة'), col('action', 'Action', 'الإجراء'), col('entityType', 'Entity', 'الكيان'), col('entityId', 'Entity id', 'معرّف الكيان'), col('actorUserId', 'Actor', 'الفاعل'), col('actorType', 'Actor type', 'نوع الفاعل'), col('actorRoles', 'Roles', 'الأدوار'), col('changedFields', 'Changed fields', 'الحقول المتغيرة'), col('ipAddress', 'IP', 'IP'), col('requestId', 'Request', 'الطلب')],
  async run(ctx, f) {
    const where: Prisma.AuditLogWhereInput = { occurredAt: { gte: new Date(f.dateFrom), lt: new Date(new Date(f.dateTo).getTime() + 86_400_000) }, ...(f.actorUserId ? { actorUserId: f.actorUserId } : {}), ...(f.action ? { action: f.action } : {}), ...(f.entityType ? { entityType: f.entityType } : {}), ...(f.severity ? { severity: f.severity } : {}) };
    const [rows, total] = await Promise.all([
      prisma().auditLog.findMany({ where, select: { id: true, occurredAt: true, actorUserId: true, actorType: true, actorRoles: true, action: true, entityType: true, entityId: true, severity: true, ipAddress: true, requestId: true, changedFields: true }, orderBy: { occurredAt: 'asc' }, skip: skip(ctx), take: ctx.pageSize }),
      prisma().auditLog.count({ where }),
    ]);
    return { total, rows: (rows as AuditRow[]).map((r) => ({ occurredAt: d(r.occurredAt), severity: r.severity, action: r.action, entityType: r.entityType, entityId: r.entityId, actorUserId: r.actorUserId, actorType: r.actorType, actorRoles: r.actorRoles.join('|'), changedFields: r.changedFields.join('|'), ipAddress: r.ipAddress, requestId: r.requestId })) };
  },
});

export function exportableByCode(code: string): ReportDef | null {
  return code === auditLogsReport.code ? auditLogsReport : reportByCode(code);
}
