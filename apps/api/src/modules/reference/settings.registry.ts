import { z, type ZodTypeAny } from 'zod';
import type { SettingScope, SettingValueType, SettingsSection } from '@unigate/types';

/**
 * The settings registry — the code-side half of docs/settings-catalogue.md (ADR-009).
 *
 * Every key the platform reads at runtime is declared here with its section, type, scope,
 * per-key Zod schema and PRODUCTION seed. The seed script writes these rows; the API validates
 * PUT /settings/{key} against `schema`; the catalogue test asserts every key in the markdown
 * catalogue exists here and vice versa.
 *
 * Seeds are conservative on purpose: charge nothing, block nothing, expire nothing without a
 * human. The go-live checklist lists what an admin must set.
 */
export interface SettingDefinition<T = unknown> {
  key: string;
  section: SettingsSection;
  valueType: SettingValueType;
  scope: SettingScope;
  schema: ZodTypeAny;
  seed: T;
  descriptionEn: string;
  descriptionAr: string;
  /** Immutable via the API (409 SETTINGS_KEY_IMMUTABLE). */
  codeManaged?: boolean;
  /** True when the value is snapshotted onto the record it produces. Documentation only. */
  snapshotted?: boolean;
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const intOrNull = (min: number, max: number) => z.number().int().min(min).max(max).nullable();
const dec = (min: number, max: number) => z.number().min(min).max(max);
const bool = z.boolean();

function def<T>(d: SettingDefinition<T>): SettingDefinition<T> {
  return d;
}

export const SETTINGS: readonly SettingDefinition[] = [
  // ── booking ────────────────────────────────────────────────────────────────
  def({ key: 'booking.min_lead_time_hours', section: 'booking', valueType: 'INTEGER', scope: 'PUBLIC', schema: int(0, 168), seed: 2, descriptionEn: 'Minimum hours between request creation and pickup', descriptionAr: 'الحد الأدنى للساعات بين إنشاء الطلب وموعد الانطلاق' }),
  def({ key: 'booking.max_lead_time_days', section: 'booking', valueType: 'INTEGER', scope: 'PUBLIC', schema: int(1, 365), seed: 90, descriptionEn: 'Maximum days ahead a trip may be requested', descriptionAr: 'الحد الأقصى للأيام التي يمكن طلب رحلة قبلها' }),
  def({ key: 'booking.payment_window_minutes', section: 'booking', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(5, 1440), seed: 30, snapshotted: true, descriptionEn: 'Minutes a PREPAID booking may stay PENDING_PAYMENT before it is cancelled', descriptionAr: 'الدقائق المسموح بها لبقاء الحجز المدفوع مسبقاً بانتظار الدفع قبل إلغائه' }),
  def({ key: 'booking.turnaround_buffer_minutes', section: 'booking', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(0, 240), seed: 60, snapshotted: true, descriptionEn: 'Turnaround buffer (minutes) applied at both ends of a vehicle reservation; the calendar EXCLUDE constraint sees the buffered window (A-07)', descriptionAr: 'هامش الوقت (بالدقائق) المضاف قبل وبعد كل حجز على تقويم المركبة' }),
  def({ key: 'booking.allow_partial_fulfilment_default.passenger', section: 'booking', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: false, snapshotted: true, descriptionEn: 'Default for partial fulfilment on passenger requests', descriptionAr: 'الإعداد الافتراضي للتنفيذ الجزئي لطلبات نقل الركاب' }),
  def({ key: 'booking.allow_partial_fulfilment_default.goods', section: 'booking', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: true, snapshotted: true, descriptionEn: 'Default for partial fulfilment on goods requests', descriptionAr: 'الإعداد الافتراضي للتنفيذ الجزئي لطلبات نقل البضائع' }),
  def({ key: 'booking.remainder_closes_after_days', section: 'booking', valueType: 'INTEGER', scope: 'INTERNAL', schema: intOrNull(1, 90), seed: null, snapshotted: true, descriptionEn: 'Days an unfilled remainder stays open; null = until the customer closes it', descriptionAr: 'عدد الأيام التي يبقى فيها المتبقي غير المنفذ مفتوحاً؛ فارغ = حتى يغلقه العميل' }),
  def({ key: 'booking.remainder_reminder_after_days', section: 'booking', valueType: 'INTEGER', scope: 'INTERNAL', schema: intOrNull(1, 30), seed: 7, descriptionEn: 'Days before the customer is reminded about an open remainder', descriptionAr: 'الأيام قبل تذكير العميل بالمتبقي المفتوح' }),
  def({ key: 'booking.later_wave_requires_customer_approval', section: 'booking', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: true, descriptionEn: 'Whether the customer must approve each later dispatch wave', descriptionAr: 'هل يجب على العميل الموافقة على كل دفعة إرسال لاحقة' }),
  def({ key: 'booking.customer_cancellation_fee_owner_share_pct', section: 'booking', valueType: 'DECIMAL', scope: 'INTERNAL', schema: dec(0, 100), seed: 100, snapshotted: true, descriptionEn: 'Share of a customer cancellation fee passed to the owner (%)', descriptionAr: 'نسبة رسوم إلغاء العميل المحوّلة للمالك (%)' }),

  // ── bidding ────────────────────────────────────────────────────────────────
  def({ key: 'bidding.close_before_pickup_hours', section: 'bidding', valueType: 'DECIMAL', scope: 'PUBLIC', schema: dec(0, 72), seed: 2, snapshotted: true, descriptionEn: 'Bidding closes this many hours before pickup', descriptionAr: 'يُغلق تقديم العروض قبل موعد الانطلاق بهذا العدد من الساعات' }),
  def({ key: 'bidding.max_window_hours', section: 'bidding', valueType: 'DECIMAL', scope: 'PUBLIC', schema: dec(1, 168), seed: 24, snapshotted: true, descriptionEn: 'Maximum bidding window from request creation', descriptionAr: 'الحد الأقصى لفترة تقديم العروض من إنشاء الطلب' }),
  def({ key: 'bidding.bid_validity_hours', section: 'bidding', valueType: 'DECIMAL', scope: 'PUBLIC', schema: dec(1, 168), seed: 24, snapshotted: true, descriptionEn: 'How long a submitted bid stays valid', descriptionAr: 'مدة صلاحية العرض المقدم' }),
  def({ key: 'bidding.drivers_may_bid', section: 'bidding', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: false, descriptionEn: 'Whether independent drivers may bid', descriptionAr: 'هل يمكن للسائقين المستقلين تقديم عروض' }),
  def({ key: 'bidding.bid_requires_driver_nomination', section: 'bidding', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: false, descriptionEn: 'Whether a bid must name a driver at submission', descriptionAr: 'هل يجب تسمية السائق عند تقديم العرض' }),
  def({ key: 'bidding.max_active_bids_per_owner_per_request', section: 'bidding', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 5), seed: 1, descriptionEn: 'Maximum live bids one owner may hold on one request', descriptionAr: 'الحد الأقصى للعروض الحية لمالك واحد على طلب واحد' }),
  def({ key: 'bidding.show_effective_commission_to_owners', section: 'bidding', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: true, descriptionEn: 'Show the effective commission on a request to invited owners before they bid', descriptionAr: 'عرض العمولة الفعلية على الطلب للمالكين المدعوين قبل تقديم العروض' }),
  def({ key: 'bidding.non_circumvention_months', section: 'bidding', valueType: 'INTEGER', scope: 'PUBLIC', schema: int(0, 36), seed: 12, snapshotted: true, descriptionEn: 'Non-circumvention period after an introduced booking (months)', descriptionAr: 'فترة عدم الالتفاف بعد الحجز المُعرَّف (أشهر)' }),

  // ── dispatch ───────────────────────────────────────────────────────────────
  def({ key: 'dispatch.driver_assignment_deadline_hours_before_pickup', section: 'dispatch', valueType: 'DECIMAL', scope: 'INTERNAL', schema: dec(0, 48), seed: 1, descriptionEn: 'Escalate if no driver is assigned this many hours before pickup', descriptionAr: 'التصعيد إذا لم يُعيَّن سائق قبل الانطلاق بهذا العدد من الساعات' }),
  def({ key: 'dispatch.ready_check_required', section: 'dispatch', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: true, descriptionEn: 'Require the pre-dispatch READY check', descriptionAr: 'اشتراط فحص الجاهزية قبل الإرسال' }),
  def({ key: 'dispatch.no_show_grace_minutes', section: 'dispatch', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(0, 240), seed: 30, snapshotted: true, descriptionEn: 'Grace period before a no-show may be recorded', descriptionAr: 'فترة السماح قبل تسجيل عدم الحضور' }),

  // ── settlement ─────────────────────────────────────────────────────────────
  def({ key: 'settlement.cycle', section: 'settlement', valueType: 'ENUM', scope: 'INTERNAL', schema: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY']), seed: 'WEEKLY', snapshotted: true, descriptionEn: 'Owner settlement cycle', descriptionAr: 'دورة تسوية المالكين' }),
  def({ key: 'settlement.cut_off_day', section: 'settlement', valueType: 'STRING', scope: 'INTERNAL', schema: z.union([z.enum(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']), int(1, 28)]), seed: 'SUN', snapshotted: true, descriptionEn: 'Cut-off day (weekday for weekly/biweekly, day-of-month for monthly)', descriptionAr: 'يوم الإقفال (يوم الأسبوع للأسبوعي، يوم الشهر للشهري)' }),
  def({ key: 'settlement.hold_days_after_completion', section: 'settlement', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(0, 30), seed: 3, snapshotted: true, descriptionEn: 'Hold period after trip completion before earnings are eligible', descriptionAr: 'فترة الحجز بعد إتمام الرحلة قبل استحقاق الأرباح' }),
  def({ key: 'settlement.minimum_payout_amount', section: 'settlement', valueType: 'DECIMAL', scope: 'INTERNAL', schema: dec(0, 1_000_000), seed: 0, snapshotted: true, descriptionEn: 'Minimum payout; smaller balances carry forward', descriptionAr: 'الحد الأدنى للدفع؛ الأرصدة الأصغر تُرحَّل' }),
  def({ key: 'settlement.payout_rail', section: 'settlement', valueType: 'ENUM', scope: 'INTERNAL', schema: z.enum(['BANK_TRANSFER', 'GATEWAY_PAYOUT']), seed: 'BANK_TRANSFER', snapshotted: true, descriptionEn: 'How owners are paid', descriptionAr: 'طريقة الدفع للمالكين' }),
  def({ key: 'settlement.bank_account_cooloff_hours', section: 'settlement', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(0, 336), seed: 72, snapshotted: true, descriptionEn: 'Cool-off before a new/changed payout account can receive funds', descriptionAr: 'فترة الانتظار قبل استلام حساب دفع جديد أو معدَّل للأموال' }),
  def({ key: 'settlement.requires_approval', section: 'settlement', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: true, descriptionEn: 'Settlements require finance approval before payment', descriptionAr: 'تتطلب التسويات موافقة المالية قبل الدفع' }),
  def({ key: 'settlement.auto_approve_below_amount', section: 'settlement', valueType: 'DECIMAL', scope: 'INTERNAL', schema: dec(0, 1_000_000).nullable(), seed: null, descriptionEn: 'Auto-approve settlements below this amount (null = never)', descriptionAr: 'الموافقة التلقائية على التسويات دون هذا المبلغ (فارغ = أبداً)' }),
  def({ key: 'settlement.supplier_invoice_hold_periods_before_suspension', section: 'settlement', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 12), seed: 2, descriptionEn: 'Held settlement periods before a supplier without an invoice is suspended', descriptionAr: 'فترات التسوية المحجوزة قبل تعليق المورد الذي لم يقدم فاتورة' }),

  // ── billing ────────────────────────────────────────────────────────────────
  def({ key: 'billing.default_cycle', section: 'billing', valueType: 'ENUM', scope: 'INTERNAL', schema: z.enum(['PER_BOOKING', 'WEEKLY', 'MONTHLY']), seed: 'MONTHLY', snapshotted: true, descriptionEn: 'Default corporate billing cycle', descriptionAr: 'دورة الفوترة الافتراضية للشركات' }),
  def({ key: 'billing.default_credit_terms_days', section: 'billing', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(0, 120), seed: 30, snapshotted: true, descriptionEn: 'Default corporate payment term (days)', descriptionAr: 'مدة السداد الافتراضية للشركات (أيام)' }),
  def({ key: 'billing.invoice_issue_day', section: 'billing', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 28), seed: 1, descriptionEn: 'Day of month consolidated invoices are issued', descriptionAr: 'يوم الشهر لإصدار الفواتير المجمعة' }),
  def({ key: 'billing.overdue_reminder_days', section: 'billing', valueType: 'INTEGER_ARRAY', scope: 'INTERNAL', schema: z.array(int(1, 180)).min(1).refine((a) => a.every((v, i) => i === 0 || v > (a[i - 1] ?? 0)), 'must be ascending'), seed: [7, 14, 30], descriptionEn: 'Days after due date at which reminders are sent', descriptionAr: 'الأيام بعد تاريخ الاستحقاق لإرسال التذكيرات' }),
  def({ key: 'billing.auto_suspend_on_overdue_days', section: 'billing', valueType: 'INTEGER', scope: 'INTERNAL', schema: intOrNull(1, 180), seed: null, descriptionEn: 'Auto-suspend credit after this many overdue days (null = never; UniGate: the limit is the only gate)', descriptionAr: 'تعليق الائتمان تلقائياً بعد هذا العدد من أيام التأخير (فارغ = أبداً)' }),
  def({ key: 'billing.count_uninvoiced_bookings_in_exposure', section: 'billing', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: z.literal(true), seed: true, codeManaged: true, descriptionEn: 'Live un-invoiced bookings count against the credit limit (code-managed, always true)', descriptionAr: 'الحجوزات الحية غير المفوترة تُحتسب ضمن حد الائتمان (تُدار برمجياً، دائماً مفعّل)' }),

  // ── finance ────────────────────────────────────────────────────────────────
  def({ key: 'finance.vat_rate_pct', section: 'finance', valueType: 'DECIMAL', scope: 'PUBLIC', schema: dec(0, 100), seed: 15, snapshotted: true, descriptionEn: 'VAT rate (%)', descriptionAr: 'نسبة ضريبة القيمة المضافة (%)' }),
  def({ key: 'finance.currency', section: 'finance', valueType: 'STRING', scope: 'PUBLIC', schema: z.literal('SAR'), seed: 'SAR', codeManaged: true, descriptionEn: 'Platform currency (single-currency at MVP)', descriptionAr: 'عملة المنصة (عملة واحدة في الإصدار الأول)' }),
  def({ key: 'finance.payment_methods_enabled', section: 'finance', valueType: 'STRING_ARRAY', scope: 'PUBLIC', schema: z.array(z.enum(['MADA', 'VISA', 'MASTERCARD', 'STC_PAY', 'APPLE_PAY', 'BANK_TRANSFER', 'CASH'])).min(1), seed: ['MADA', 'VISA', 'MASTERCARD', 'STC_PAY', 'APPLE_PAY', 'BANK_TRANSFER'], descriptionEn: 'Payment methods offered at checkout; the active gateway further restricts them (GET /payments/config)', descriptionAr: 'طرق الدفع المتاحة عند السداد؛ تقيدها بوابة الدفع الفعّالة' }),
  def({ key: 'finance.invoice_line_granularity', section: 'finance', valueType: 'ENUM', scope: 'INTERNAL', schema: z.enum(['ORDER', 'BOOKING']), seed: 'ORDER', snapshotted: true, descriptionEn: 'Customer invoice lines per order (service) or per booking (vehicle)', descriptionAr: 'بنود فاتورة العميل لكل طلب (خدمة) أو لكل حجز (مركبة)' }),
  def({ key: 'finance.commission_basis_default', section: 'finance', valueType: 'ENUM', scope: 'INTERNAL', schema: z.enum(['GROSS', 'NET_OF_VAT']), seed: 'NET_OF_VAT', snapshotted: true, descriptionEn: 'Default basis for commission rules', descriptionAr: 'الأساس الافتراضي لقواعد العمولة' }),
  def({ key: 'finance.rounding_mode', section: 'finance', valueType: 'ENUM', scope: 'INTERNAL', schema: z.literal('HALF_UP'), seed: 'HALF_UP', codeManaged: true, descriptionEn: 'Money rounding mode (code-managed)', descriptionAr: 'طريقة تقريب المبالغ (تُدار برمجياً)' }),
  def({ key: 'finance.seller_vat_number', section: 'finance', valueType: 'STRING', scope: 'INTERNAL', schema: z.string().regex(/^3[0-9]{13}3$/).or(z.literal('')), seed: '', snapshotted: true, descriptionEn: 'UniGate VAT registration number printed on every customer invoice (empty = invoicing refused with INVOICE_SELLER_VAT_NOT_CONFIGURED)', descriptionAr: 'رقم تسجيل يونيغيت في ضريبة القيمة المضافة المطبوع على كل فاتورة عميل (فارغ = يُرفض إصدار الفواتير)' }),
  def({ key: 'finance.seller_name_en', section: 'finance', valueType: 'STRING', scope: 'INTERNAL', schema: z.string().max(160), seed: '', snapshotted: true, descriptionEn: 'Seller legal name (English) on invoices and the invoice QR', descriptionAr: 'الاسم القانوني للبائع (إنجليزي) على الفواتير ورمز الاستجابة السريعة' }),
  def({ key: 'finance.seller_name_ar', section: 'finance', valueType: 'STRING', scope: 'INTERNAL', schema: z.string().max(160), seed: '', snapshotted: true, descriptionEn: 'Seller legal name (Arabic) on invoices', descriptionAr: 'الاسم القانوني للبائع (عربي) على الفواتير' }),
  def({ key: 'finance.bad_debt_writeoff_requires_approval', section: 'finance', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: true, descriptionEn: 'Bad-debt write-off requires finance approval', descriptionAr: 'شطب الديون المعدومة يتطلب موافقة المالية' }),

  // ── onboarding ─────────────────────────────────────────────────────────────
  def({ key: 'onboarding.approval_sla_hours', section: 'onboarding', valueType: 'INTEGER', scope: 'INTERNAL', schema: intOrNull(1, 720), seed: null, descriptionEn: 'Target hours to approve an owner/driver/vehicle (null = no SLA)', descriptionAr: 'الساعات المستهدفة للموافقة على مالك/سائق/مركبة (فارغ = لا يوجد)' }),
  def({ key: 'onboarding.reapprove_on_document_renewal', section: 'onboarding', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: false, descriptionEn: 'A renewed document re-opens full approval (false = re-verify the document only)', descriptionAr: 'تجديد المستند يعيد فتح الموافقة الكاملة (لا = إعادة التحقق من المستند فقط)' }),
  def({ key: 'onboarding.vehicle_max_age_years', section: 'onboarding', valueType: 'INTEGER', scope: 'INTERNAL', schema: intOrNull(1, 40), seed: null, descriptionEn: 'Maximum vehicle age accepted (null = no limit)', descriptionAr: 'الحد الأقصى لعمر المركبة المقبول (فارغ = بلا حد)' }),
  def({ key: 'onboarding.owner_vat_status_recheck_days', section: 'onboarding', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 365), seed: 90, descriptionEn: 'Re-verify owner VAT registration every N days', descriptionAr: 'إعادة التحقق من تسجيل المالك في ضريبة القيمة المضافة كل N يوم' }),
  def({ key: 'onboarding.individual_owner_max_vehicles', section: 'onboarding', valueType: 'INTEGER', scope: 'INTERNAL', schema: intOrNull(1, 1000), seed: null, descriptionEn: 'Cap on vehicles per individual owner (null = none; TGA cap pending OQ-29)', descriptionAr: 'الحد الأقصى للمركبات لكل مالك فرد (فارغ = بلا حد)' }),

  // ── documents ──────────────────────────────────────────────────────────────
  def({ key: 'documents.expiry_warning_days_default', section: 'documents', valueType: 'INTEGER_ARRAY', scope: 'INTERNAL', schema: z.array(int(1, 365)).min(1).refine((a) => a.every((v, i) => i === 0 || v < (a[i - 1] ?? Infinity)), 'must be descending'), seed: [30, 7, 1], descriptionEn: 'Days before expiry at which warnings are sent', descriptionAr: 'الأيام قبل انتهاء الصلاحية لإرسال التنبيهات' }),
  def({ key: 'documents.expired_document_blocks_dispatch', section: 'documents', valueType: 'BOOLEAN', scope: 'INTERNAL', schema: bool, seed: true, descriptionEn: 'An expired mandatory document blocks READY', descriptionAr: 'المستند الإلزامي المنتهي يمنع الجاهزية' }),
  def({ key: 'documents.max_upload_mb_default', section: 'documents', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 50), seed: 10, descriptionEn: 'Default maximum upload size (MB)', descriptionAr: 'الحد الأقصى الافتراضي لحجم الرفع (ميجابايت)' }),

  // ── spo ────────────────────────────────────────────────────────────────────
  def({ key: 'spo.default_commission_model_id', section: 'spo', valueType: 'STRING', scope: 'INTERNAL', schema: z.string().uuid().nullable(), seed: null, snapshotted: true, descriptionEn: 'Default SPO commission model (set by seed to the NONE model)', descriptionAr: 'نموذج عمولة مندوب المبيعات الافتراضي' }),
  def({ key: 'spo.attribution_window_days', section: 'spo', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 365), seed: 30, snapshotted: true, descriptionEn: 'Days after acquisition during which bookings are attributed to the SPO', descriptionAr: 'الأيام بعد الاستقطاب التي تُنسب فيها الحجوزات لمندوب المبيعات' }),
  def({ key: 'spo.lead_expiry_days', section: 'spo', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 365), seed: 30, descriptionEn: 'Days before an untouched lead expires', descriptionAr: 'الأيام قبل انتهاء العميل المحتمل غير المتابَع' }),

  // ── tracking ───────────────────────────────────────────────────────────────
  def({ key: 'tracking.location_ping_interval_seconds', section: 'tracking', valueType: 'INTEGER', scope: 'PUBLIC', schema: int(5, 120), seed: 15, descriptionEn: 'Driver-app location ping interval', descriptionAr: 'الفاصل الزمني لإرسال الموقع من تطبيق السائق' }),
  def({ key: 'tracking.location_retention_days', section: 'tracking', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(30, 3650), seed: 365, descriptionEn: 'Location history retention (pending legal review OQ-08)', descriptionAr: 'مدة الاحتفاظ بسجل المواقع (بانتظار المراجعة القانونية)' }),
  def({ key: 'tracking.share_link_ttl_hours', section: 'tracking', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 168), seed: 24, snapshotted: true, descriptionEn: 'Live-tracking share link lifetime', descriptionAr: 'مدة صلاحية رابط مشاركة التتبع' }),
  def({ key: 'tracking.geofence_radius_m', section: 'tracking', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(50, 2000), seed: 200, descriptionEn: 'Arrival geofence radius (m)', descriptionAr: 'نصف قطر السياج الجغرافي للوصول (م)' }),

  // ── notifications ──────────────────────────────────────────────────────────
  def({ key: 'notifications.otp_length', section: 'notifications', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(4, 8), seed: 6, descriptionEn: 'OTP code length', descriptionAr: 'طول رمز التحقق' }),
  def({ key: 'notifications.otp_ttl_seconds', section: 'notifications', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(60, 900), seed: 300, snapshotted: true, descriptionEn: 'OTP lifetime', descriptionAr: 'مدة صلاحية رمز التحقق' }),
  def({ key: 'notifications.otp_max_attempts', section: 'notifications', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(3, 10), seed: 5, descriptionEn: 'OTP verification attempts', descriptionAr: 'محاولات التحقق من الرمز' }),
  def({ key: 'notifications.otp_resend_cooldown_seconds', section: 'notifications', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(30, 600), seed: 60, descriptionEn: 'Cool-down between OTP sends', descriptionAr: 'فترة الانتظار بين إرسال رموز التحقق' }),
  def({ key: 'notifications.sms_sender_id', section: 'notifications', valueType: 'STRING', scope: 'INTERNAL', schema: z.string().max(11), seed: '', descriptionEn: 'Registered SMS sender ID (empty until CST registration — go-live checklist)', descriptionAr: 'معرّف مرسل الرسائل النصية المسجل (فارغ حتى التسجيل)' }),
  def({ key: 'notifications.default_locale', section: 'notifications', valueType: 'ENUM', scope: 'PUBLIC', schema: z.enum(['ar', 'en']), seed: 'ar', descriptionEn: 'Default notification locale', descriptionAr: 'لغة الإشعارات الافتراضية' }),
  def({ key: 'notifications.quiet_hours', section: 'notifications', valueType: 'JSON', scope: 'INTERNAL', schema: z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }).nullable(), seed: null, descriptionEn: 'Quiet hours for non-urgent notifications (null = none)', descriptionAr: 'ساعات الهدوء للإشعارات غير العاجلة (فارغ = لا يوجد)' }),

  // ── retention ──────────────────────────────────────────────────────────────
  def({ key: 'retention.audit_log_months', section: 'retention', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(12, 240), seed: 24, descriptionEn: 'Audit log retention (months) — pending legal review', descriptionAr: 'الاحتفاظ بسجل التدقيق (أشهر) — بانتظار المراجعة القانونية' }),
  def({ key: 'retention.financial_records_years', section: 'retention', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(6, 30), seed: 10, descriptionEn: 'Financial records retention (years) — floor 6 per VAT IR Art 66', descriptionAr: 'الاحتفاظ بالسجلات المالية (سنوات) — الحد الأدنى 6' }),
  def({ key: 'retention.documents_after_closure_months', section: 'retention', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 120), seed: 12, descriptionEn: 'Document retention after account closure (months)', descriptionAr: 'الاحتفاظ بالمستندات بعد إغلاق الحساب (أشهر)' }),
  def({ key: 'retention.login_attempts_days', section: 'retention', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(30, 365), seed: 90, descriptionEn: 'Login attempt record retention (days)', descriptionAr: 'الاحتفاظ بسجلات محاولات الدخول (أيام)' }),
  def({ key: 'retention.otp_requests_days', section: 'retention', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(7, 90), seed: 30, descriptionEn: 'OTP request record retention (days)', descriptionAr: 'الاحتفاظ بسجلات طلبات رموز التحقق (أيام)' }),

  // ── platform ───────────────────────────────────────────────────────────────
  def({ key: 'platform.maintenance_mode', section: 'platform', valueType: 'BOOLEAN', scope: 'PUBLIC', schema: bool, seed: false, descriptionEn: 'Maintenance mode banner and write-lock', descriptionAr: 'وضع الصيانة' }),
  def({ key: 'platform.supported_locales', section: 'platform', valueType: 'STRING_ARRAY', scope: 'PUBLIC', schema: z.array(z.enum(['ar', 'en'])).min(1), seed: ['ar', 'en'], codeManaged: true, descriptionEn: 'Supported locales (code-managed at MVP)', descriptionAr: 'اللغات المدعومة' }),
  def({ key: 'platform.timezone', section: 'platform', valueType: 'STRING', scope: 'PUBLIC', schema: z.literal('Asia/Riyadh'), seed: 'Asia/Riyadh', codeManaged: true, descriptionEn: 'Display timezone (code-managed)', descriptionAr: 'المنطقة الزمنية للعرض' }),
  def({ key: 'platform.support_phone', section: 'platform', valueType: 'STRING', scope: 'PUBLIC', schema: z.string().max(20), seed: '', descriptionEn: 'Support phone shown to users', descriptionAr: 'هاتف الدعم المعروض للمستخدمين' }),
  def({ key: 'platform.support_email', section: 'platform', valueType: 'STRING', scope: 'PUBLIC', schema: z.string().email().or(z.literal('')), seed: '', descriptionEn: 'Support email shown to users', descriptionAr: 'بريد الدعم المعروض للمستخدمين' }),
  def({ key: 'platform.terms_version', section: 'platform', valueType: 'STRING', scope: 'PUBLIC', schema: z.string().max(20), seed: '', descriptionEn: 'Terms version; bumping forces re-acceptance', descriptionAr: 'إصدار الشروط؛ التغيير يفرض إعادة القبول' }),
  def({ key: 'platform.max_sessions_per_user', section: 'platform', valueType: 'INTEGER', scope: 'INTERNAL', schema: int(1, 50), seed: 10, descriptionEn: 'Concurrent sessions per user; the oldest is revoked on overflow', descriptionAr: 'عدد الجلسات المتزامنة لكل مستخدم؛ تُلغى الأقدم عند التجاوز' }),
  def({ key: 'platform.verticals_enabled', section: 'platform', valueType: 'STRING_ARRAY', scope: 'PUBLIC', schema: z.array(z.enum(['PASSENGER', 'GOODS'])).min(1), seed: ['PASSENGER'], descriptionEn: 'Enabled verticals (GOODS refused until Phase 11b ships)', descriptionAr: 'القطاعات المفعّلة' }),
];

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(SETTINGS.map((s) => [s.key, s]));

/**
 * Cross-field rules (settings-catalogue.md "Cross-field validation"). Evaluated by the
 * service on every PUT with the proposed value merged over the current values.
 */
export interface CrossFieldRule {
  keys: readonly string[];
  message: string;
  check: (values: ReadonlyMap<string, unknown>) => boolean;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number.NaN);

export const CROSS_FIELD_RULES: readonly CrossFieldRule[] = [
  {
    keys: ['bidding.bid_validity_hours', 'bidding.max_window_hours'],
    message: 'bidding.bid_validity_hours must not exceed bidding.max_window_hours',
    check: (v) => num(v.get('bidding.bid_validity_hours')) <= num(v.get('bidding.max_window_hours')),
  },
  {
    keys: ['bidding.close_before_pickup_hours', 'booking.min_lead_time_hours'],
    message: 'bidding.close_before_pickup_hours must be less than booking.min_lead_time_hours, otherwise every request closes before it opens',
    check: (v) => num(v.get('bidding.close_before_pickup_hours')) < num(v.get('booking.min_lead_time_hours')),
  },
  {
    keys: ['settlement.cycle', 'settlement.cut_off_day'],
    message: 'settlement.cut_off_day must be a weekday for WEEKLY/BIWEEKLY and a day-of-month (1–28) for MONTHLY',
    check: (v) => {
      const cycle = v.get('settlement.cycle');
      const day = v.get('settlement.cut_off_day');
      return cycle === 'MONTHLY' ? typeof day === 'number' : typeof day === 'string';
    },
  },
  {
    keys: ['billing.auto_suspend_on_overdue_days', 'billing.overdue_reminder_days'],
    message: 'billing.auto_suspend_on_overdue_days, when set, must exceed the largest reminder day',
    check: (v) => {
      const suspend = v.get('billing.auto_suspend_on_overdue_days');
      const reminders = v.get('billing.overdue_reminder_days');
      if (suspend === null || suspend === undefined) return true;
      return Array.isArray(reminders) && num(suspend) > Math.max(...(reminders as number[]));
    },
  },
];
