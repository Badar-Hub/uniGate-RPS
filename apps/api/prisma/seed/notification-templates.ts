/**
 * Notification template catalogue (FR-NOTIFICATIONS-02/03, BRIEF-§23). One entry per code with
 * both locales; the seed expands it to one row per (code, channel, locale). Interpolation is
 * `{{variable}}`; the `variables` list is what the preview endpoint asks for and what the
 * renderer refuses to leave unfilled.
 *
 * Bodies live in the database so operations can correct wording without a deploy: the seed
 * creates missing rows and refreshes rows still at version 1 (never edited through the API).
 */
export type TemplateChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';

export interface TemplateSeed {
  code: string;
  category: string;
  channels: TemplateChannel[];
  variables: string[];
  en: { title: string; body: string };
  ar: { title: string; body: string };
}

const ALL: TemplateChannel[] = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'];
const APP: TemplateChannel[] = ['IN_APP', 'EMAIL', 'PUSH'];
const QUIET: TemplateChannel[] = ['IN_APP', 'EMAIL'];

export const NOTIFICATION_TEMPLATES: TemplateSeed[] = [
  // ── opportunities & bidding ───────────────────────────────────────────────
  { code: 'NEW_TRIP_OPPORTUNITY', category: 'OPPORTUNITY', channels: APP, variables: ['requestNumber', 'transportType', 'pickupAt'],
    en: { title: 'New trip opportunity {{requestNumber}}', body: 'A new {{transportType}} request {{requestNumber}} matches your fleet (pickup {{pickupAt}}). Open Opportunities to bid.' },
    ar: { title: 'فرصة رحلة جديدة {{requestNumber}}', body: 'طلب {{transportType}} جديد رقم {{requestNumber}} يطابق أسطولك (الانطلاق {{pickupAt}}). افتح الفرص لتقديم عرض.' } },
  { code: 'BID_RECEIVED', category: 'BIDDING', channels: APP, variables: ['requestNumber', 'bidNumber', 'totalAmount', 'currency'],
    en: { title: 'New bid on {{requestNumber}}', body: 'Bid {{bidNumber}} of {{totalAmount}} {{currency}} was received on your request {{requestNumber}}. Compare bids in your requests.' },
    ar: { title: 'عرض جديد على {{requestNumber}}', body: 'تم استلام العرض {{bidNumber}} بقيمة {{totalAmount}} {{currency}} على طلبك {{requestNumber}}. قارن العروض من صفحة طلباتك.' } },
  { code: 'BID_ACCEPTED', category: 'BIDDING', channels: ALL, variables: ['bookingNumber', 'requestNumber', 'totalAmount', 'currency'],
    en: { title: 'Your bid was accepted — booking {{bookingNumber}}', body: 'Your bid on {{requestNumber}} was accepted. Booking {{bookingNumber}} ({{totalAmount}} {{currency}}) is created; assign a driver when ready.' },
    ar: { title: 'تم قبول عرضك — الحجز {{bookingNumber}}', body: 'تم قبول عرضك على {{requestNumber}}. تم إنشاء الحجز {{bookingNumber}} ({{totalAmount}} {{currency}})؛ عيّن سائقاً عند الجاهزية.' } },
  { code: 'BID_REJECTED', category: 'BIDDING', channels: QUIET, variables: ['bidNumber', 'requestNumber'],
    en: { title: 'Bid {{bidNumber}} not selected', body: 'Your bid {{bidNumber}} on {{requestNumber}} was not selected. Thank you for bidding.' },
    ar: { title: 'لم يتم اختيار العرض {{bidNumber}}', body: 'لم يتم اختيار عرضك {{bidNumber}} على {{requestNumber}}. شكراً لمشاركتك.' } },
  // ── bookings ──────────────────────────────────────────────────────────────
  { code: 'BOOKING_CONFIRMED', category: 'BOOKING', channels: ALL, variables: ['bookingNumber'],
    en: { title: 'Booking {{bookingNumber}} confirmed', body: 'Booking {{bookingNumber}} is confirmed. You will be notified when a driver is assigned.' },
    ar: { title: 'تم تأكيد الحجز {{bookingNumber}}', body: 'تم تأكيد الحجز {{bookingNumber}}. سيتم إشعارك عند تعيين السائق.' } },
  { code: 'BOOKING_CANCELLED', category: 'BOOKING', channels: ALL, variables: ['bookingNumber', 'reason'],
    en: { title: 'Booking {{bookingNumber}} cancelled', body: 'Booking {{bookingNumber}} was cancelled ({{reason}}). Any fee or refund is shown on the booking.' },
    ar: { title: 'تم إلغاء الحجز {{bookingNumber}}', body: 'تم إلغاء الحجز {{bookingNumber}} ({{reason}}). تظهر أي رسوم أو استرداد على صفحة الحجز.' } },
  { code: 'BOOKING_COMPLETED', category: 'BOOKING', channels: APP, variables: ['bookingNumber', 'totalAmount', 'currency'],
    en: { title: 'Booking {{bookingNumber}} completed', body: 'Booking {{bookingNumber}} ({{totalAmount}} {{currency}}) is complete. Rate your experience from the booking page.' },
    ar: { title: 'اكتمل الحجز {{bookingNumber}}', body: 'اكتمل الحجز {{bookingNumber}} ({{totalAmount}} {{currency}}). قيّم تجربتك من صفحة الحجز.' } },
  // ── payments ──────────────────────────────────────────────────────────────
  { code: 'PAYMENT_SUCCESSFUL', category: 'PAYMENT', channels: ALL, variables: ['paymentNumber', 'amount', 'currency'],
    en: { title: 'Payment {{paymentNumber}} received', body: 'We received your payment of {{amount}} {{currency}} ({{paymentNumber}}). Thank you.' },
    ar: { title: 'تم استلام الدفعة {{paymentNumber}}', body: 'استلمنا دفعتك بقيمة {{amount}} {{currency}} ({{paymentNumber}}). شكراً لك.' } },
  { code: 'PAYMENT_FAILED', category: 'PAYMENT', channels: ALL, variables: ['paymentNumber', 'failureCode'],
    en: { title: 'Payment {{paymentNumber}} failed', body: 'Payment {{paymentNumber}} did not go through ({{failureCode}}). Please try again from the booking page before the payment window closes.' },
    ar: { title: 'فشلت الدفعة {{paymentNumber}}', body: 'لم تتم الدفعة {{paymentNumber}} ({{failureCode}}). يرجى المحاولة مجدداً من صفحة الحجز قبل انتهاء مهلة الدفع.' } },
  { code: 'REFUND_COMPLETED', category: 'PAYMENT', channels: ALL, variables: ['refundNumber', 'amount', 'currency'],
    en: { title: 'Refund {{refundNumber}} issued', body: 'A refund of {{amount}} {{currency}} ({{refundNumber}}) was issued to your original payment method.' },
    ar: { title: 'تم إصدار الاسترداد {{refundNumber}}', body: 'تم إصدار استرداد بقيمة {{amount}} {{currency}} ({{refundNumber}}) إلى وسيلة الدفع الأصلية.' } },
  // ── trips ─────────────────────────────────────────────────────────────────
  { code: 'DRIVER_ASSIGNED', category: 'TRIP', channels: ALL, variables: ['bookingNumber', 'tripNumber'],
    en: { title: 'Driver assigned to {{bookingNumber}}', body: 'A driver has been assigned to booking {{bookingNumber}} (trip {{tripNumber}}). Driver details are on the booking.' },
    ar: { title: 'تم تعيين سائق للحجز {{bookingNumber}}', body: 'تم تعيين سائق للحجز {{bookingNumber}} (الرحلة {{tripNumber}}). تفاصيل السائق على صفحة الحجز.' } },
  { code: 'TRIP_DRIVER_EN_ROUTE', category: 'TRIP', channels: APP, variables: ['tripNumber'],
    en: { title: 'Your driver is on the way', body: 'The driver for trip {{tripNumber}} is on the way to the pickup point. Track the trip live from the booking.' },
    ar: { title: 'السائق في الطريق إليك', body: 'سائق الرحلة {{tripNumber}} في طريقه إلى نقطة الانطلاق. تابع الرحلة مباشرة من صفحة الحجز.' } },
  { code: 'TRIP_DRIVER_ARRIVED', category: 'TRIP', channels: ALL, variables: ['tripNumber'],
    en: { title: 'Your driver has arrived', body: 'The driver for trip {{tripNumber}} has arrived at the pickup point.' },
    ar: { title: 'وصل السائق', body: 'وصل سائق الرحلة {{tripNumber}} إلى نقطة الانطلاق.' } },
  { code: 'TRIP_STARTED', category: 'TRIP', channels: APP, variables: ['tripNumber'],
    en: { title: 'Trip {{tripNumber}} started', body: 'Trip {{tripNumber}} is under way.' },
    ar: { title: 'بدأت الرحلة {{tripNumber}}', body: 'الرحلة {{tripNumber}} جارية الآن.' } },
  { code: 'TRIP_DELIVERED', category: 'TRIP', channels: ALL, variables: ['tripNumber'],
    en: { title: 'Shipment {{tripNumber}} delivered', body: 'Your shipment on trip {{tripNumber}} has been delivered. The proof of delivery is on the booking.' },
    ar: { title: 'تم تسليم الشحنة {{tripNumber}}', body: 'تم تسليم شحنتك في الرحلة {{tripNumber}}. إثبات التسليم متاح على صفحة الحجز.' } },
  { code: 'TRIP_COMPLETED', category: 'TRIP', channels: APP, variables: ['tripNumber'],
    en: { title: 'Trip {{tripNumber}} completed', body: 'Trip {{tripNumber}} is complete. Thank you for travelling with UniGate.' },
    ar: { title: 'اكتملت الرحلة {{tripNumber}}', body: 'اكتملت الرحلة {{tripNumber}}. شكراً لاختيارك يونيجيت.' } },
  { code: 'TRIP_CANCELLED', category: 'TRIP', channels: ALL, variables: ['tripNumber', 'reason'],
    en: { title: 'Trip {{tripNumber}} cancelled', body: 'Trip {{tripNumber}} was cancelled by operations: {{reason}}.' },
    ar: { title: 'تم إلغاء الرحلة {{tripNumber}}', body: 'ألغت العمليات الرحلة {{tripNumber}}: {{reason}}.' } },
  // ── documents ─────────────────────────────────────────────────────────────
  { code: 'DOCUMENT_EXPIRING', category: 'DOCUMENTS', channels: APP, variables: ['documentType', 'daysLeft', 'expiryDate'],
    en: { title: '{{documentType}} expires in {{daysLeft}} days', body: 'Your {{documentType}} expires on {{expiryDate}}. Upload a renewed copy to stay dispatchable.' },
    ar: { title: 'تنتهي صلاحية {{documentType}} خلال {{daysLeft}} يوم', body: 'تنتهي صلاحية {{documentType}} في {{expiryDate}}. ارفع نسخة مجددة لتبقى جاهزاً للتشغيل.' } },
  { code: 'DOCUMENT_EXPIRED', category: 'DOCUMENTS', channels: APP, variables: ['documentType'],
    en: { title: '{{documentType}} has expired', body: 'Your {{documentType}} has expired. Vehicles or drivers depending on it are not dispatchable until a renewed copy is verified.' },
    ar: { title: 'انتهت صلاحية {{documentType}}', body: 'انتهت صلاحية {{documentType}}. لن تكون المركبات أو السائقون المرتبطون به جاهزين للتشغيل حتى التحقق من نسخة مجددة.' } },
  { code: 'DOCUMENT_VERIFIED', category: 'DOCUMENTS', channels: QUIET, variables: ['documentType'],
    en: { title: '{{documentType}} verified', body: 'Your {{documentType}} has been verified.' },
    ar: { title: 'تم التحقق من {{documentType}}', body: 'تم التحقق من {{documentType}}.' } },
  { code: 'DOCUMENT_REJECTED', category: 'DOCUMENTS', channels: APP, variables: ['documentType', 'reason'],
    en: { title: '{{documentType}} rejected', body: 'Your {{documentType}} was rejected: {{reason}}. Please upload a corrected copy.' },
    ar: { title: 'تم رفض {{documentType}}', body: 'تم رفض {{documentType}}: {{reason}}. يرجى رفع نسخة مصححة.' } },
  // ── maintenance ───────────────────────────────────────────────────────────
  { code: 'MAINTENANCE_DUE', category: 'MAINTENANCE', channels: QUIET, variables: ['vehiclePlate', 'serviceType', 'dueBy'],
    en: { title: 'Maintenance due — {{vehiclePlate}}', body: '{{serviceType}} for vehicle {{vehiclePlate}} is due {{dueBy}}. Plan a workshop visit from Maintenance.' },
    ar: { title: 'صيانة مستحقة — {{vehiclePlate}}', body: '{{serviceType}} للمركبة {{vehiclePlate}} مستحقة {{dueBy}}. خطط لزيارة الورشة من صفحة الصيانة.' } },
  // ── onboarding ────────────────────────────────────────────────────────────
  { code: 'OWNER_APPROVED', category: 'ONBOARDING', channels: APP, variables: [],
    en: { title: 'Your company is approved', body: 'Your vehicle-owner account is approved. You can now register your fleet and start bidding.' },
    ar: { title: 'تمت الموافقة على شركتك', body: 'تمت الموافقة على حساب مالك المركبات. يمكنك الآن تسجيل أسطولك والبدء بتقديم العروض.' } },
  { code: 'OWNER_REJECTED', category: 'ONBOARDING', channels: APP, variables: ['reason'],
    en: { title: 'Your application needs attention', body: 'Your vehicle-owner application was not approved: {{reason}}. Update your documents and resubmit.' },
    ar: { title: 'طلبك يحتاج إلى مراجعة', body: 'لم تتم الموافقة على طلب مالك المركبات: {{reason}}. حدّث مستنداتك وأعد الإرسال.' } },
  { code: 'VEHICLE_APPROVED', category: 'ONBOARDING', channels: QUIET, variables: ['vehiclePlate'],
    en: { title: 'Vehicle {{vehiclePlate}} approved', body: 'Vehicle {{vehiclePlate}} is approved and can now be offered on bids.' },
    ar: { title: 'تمت الموافقة على المركبة {{vehiclePlate}}', body: 'تمت الموافقة على المركبة {{vehiclePlate}} ويمكن الآن عرضها في العروض.' } },
  { code: 'VEHICLE_REJECTED', category: 'ONBOARDING', channels: APP, variables: ['vehiclePlate', 'reason'],
    en: { title: 'Vehicle {{vehiclePlate}} not approved', body: 'Vehicle {{vehiclePlate}} was not approved: {{reason}}.' },
    ar: { title: 'لم تتم الموافقة على المركبة {{vehiclePlate}}', body: 'لم تتم الموافقة على المركبة {{vehiclePlate}}: {{reason}}.' } },
  { code: 'DRIVER_APPROVED', category: 'ONBOARDING', channels: APP, variables: [],
    en: { title: 'You are approved to drive', body: 'Your driver profile is approved. You will be notified when a trip is assigned to you.' },
    ar: { title: 'تمت الموافقة عليك كسائق', body: 'تمت الموافقة على ملفك كسائق. سيتم إشعارك عند تعيين رحلة لك.' } },
  { code: 'VENDOR_ACTIVATION', category: 'ONBOARDING', channels: ['EMAIL', 'SMS'], variables: ['companyName', 'activationUrl', 'expiresAt'],
    en: { title: 'Activate your UniGate vendor account', body: 'UniGate created a vendor account for {{companyName}}. Set your password here: {{activationUrl}} (valid until {{expiresAt}}). Then upload your company documents for approval.' },
    ar: { title: 'فعّل حساب المورد في يونيجيت', body: 'أنشأت يونيجيت حساب مورد لـ {{companyName}}. عيّن كلمة المرور من هنا: {{activationUrl}} (صالح حتى {{expiresAt}}). ثم ارفع مستندات الشركة للموافقة.' } },
  // ── security ──────────────────────────────────────────────────────────────
  { code: 'PASSWORD_RESET', category: 'SECURITY', channels: ['EMAIL', 'SMS'], variables: ['resetUrl'],
    en: { title: 'Reset your UniGate password', body: 'Use this link to choose a new password: {{resetUrl}}. It expires in 30 minutes. If you did not ask for this, ignore this message.' },
    ar: { title: 'إعادة تعيين كلمة مرور يونيجيت', body: 'استخدم هذا الرابط لاختيار كلمة مرور جديدة: {{resetUrl}}. ينتهي خلال 30 دقيقة. إذا لم تطلب ذلك فتجاهل هذه الرسالة.' } },
  { code: 'SECURITY_NEW_DEVICE', category: 'SECURITY', channels: QUIET, variables: ['clientType', 'ipAddress', 'at'],
    en: { title: 'New sign-in to your account', body: 'Your account was signed in from a new device ({{clientType}}, {{ipAddress}}) at {{at}}. If this was not you, change your password now.' },
    ar: { title: 'تسجيل دخول جديد إلى حسابك', body: 'تم تسجيل الدخول إلى حسابك من جهاز جديد ({{clientType}}، {{ipAddress}}) في {{at}}. إن لم يكن أنت، غيّر كلمة المرور فوراً.' } },
  { code: 'SECURITY_PASSWORD_CHANGED', category: 'SECURITY', channels: QUIET, variables: ['at'],
    en: { title: 'Your password was changed', body: 'Your UniGate password was changed at {{at}}. Other sessions were signed out. If this was not you, contact support immediately.' },
    ar: { title: 'تم تغيير كلمة المرور', body: 'تم تغيير كلمة مرور يونيجيت في {{at}} وتم تسجيل الخروج من الجلسات الأخرى. إن لم يكن أنت، تواصل مع الدعم فوراً.' } },
  { code: 'SECURITY_SESSION_REVOKED', category: 'SECURITY', channels: QUIET, variables: ['at'],
    en: { title: 'A session was revoked for your safety', body: 'Unusual activity was detected on one of your sessions at {{at}} and it was signed out. Sign in again; if you do not recognise this, change your password.' },
    ar: { title: 'تم إنهاء جلسة لحمايتك', body: 'رُصد نشاط غير معتاد في إحدى جلساتك في {{at}} وتم إنهاؤها. سجّل الدخول مجدداً؛ إن لم تتعرف على ذلك فغيّر كلمة المرور.' } },
  { code: 'ACCESS_CHANGED', category: 'SECURITY', channels: QUIET, variables: [],
    en: { title: 'Your access was updated', body: 'Your roles or permissions on UniGate were changed by an administrator. The change applies to your next request.' },
    ar: { title: 'تم تحديث صلاحياتك', body: 'قام مسؤول بتغيير أدوارك أو صلاحياتك في يونيجيت. يسري التغيير من طلبك التالي.' } },
  // ── finance ───────────────────────────────────────────────────────────────
  { code: 'SETTLEMENT_PAID', category: 'FINANCE', channels: APP, variables: ['settlementNumber', 'amount', 'currency', 'ibanLast4'],
    en: { title: 'Settlement {{settlementNumber}} paid', body: '{{amount}} {{currency}} was transferred to your account ending {{ibanLast4}} for settlement {{settlementNumber}}.' },
    ar: { title: 'تم دفع التسوية {{settlementNumber}}', body: 'تم تحويل {{amount}} {{currency}} إلى حسابك المنتهي بـ {{ibanLast4}} للتسوية {{settlementNumber}}.' } },
  { code: 'INVOICE_ISSUED', category: 'FINANCE', channels: QUIET, variables: ['invoiceNumber', 'totalAmount', 'currency', 'dueDate'],
    en: { title: 'Invoice {{invoiceNumber}} issued', body: 'Invoice {{invoiceNumber}} for {{totalAmount}} {{currency}} is available. Due {{dueDate}}.' },
    ar: { title: 'صدرت الفاتورة {{invoiceNumber}}', body: 'الفاتورة {{invoiceNumber}} بقيمة {{totalAmount}} {{currency}} متاحة الآن. الاستحقاق {{dueDate}}.' } },
  { code: 'INVOICE_OVERDUE', category: 'FINANCE', channels: QUIET, variables: ['invoiceNumber', 'outstandingAmount', 'currency', 'daysOverdue'],
    en: { title: 'Invoice {{invoiceNumber}} is overdue', body: 'Invoice {{invoiceNumber}} has {{outstandingAmount}} {{currency}} outstanding, {{daysOverdue}} days past due. Please arrange payment.' },
    ar: { title: 'الفاتورة {{invoiceNumber}} متأخرة', body: 'الفاتورة {{invoiceNumber}} عليها {{outstandingAmount}} {{currency}} مستحقة منذ {{daysOverdue}} يوم. يرجى ترتيب السداد.' } },
  // ── engagement ────────────────────────────────────────────────────────────
  { code: 'COMPLAINT_RECEIVED', category: 'ENGAGEMENT', channels: QUIET, variables: ['complaintNumber', 'subject'],
    en: { title: 'Complaint {{complaintNumber}} received', body: 'We received your complaint "{{subject}}" ({{complaintNumber}}). Our team will review it and reply here.' },
    ar: { title: 'تم استلام الشكوى {{complaintNumber}}', body: 'استلمنا شكواك "{{subject}}" ({{complaintNumber}}). سيراجعها فريقنا ويرد عليك هنا.' } },
  { code: 'COMPLAINT_RESOLVED', category: 'ENGAGEMENT', channels: APP, variables: ['complaintNumber', 'status', 'resolution'],
    en: { title: 'Complaint {{complaintNumber}} {{status}}', body: 'Your complaint {{complaintNumber}} is {{status}}: {{resolution}}' },
    ar: { title: 'الشكوى {{complaintNumber}}: {{status}}', body: 'شكواك {{complaintNumber}} أصبحت {{status}}: {{resolution}}' } },
  { code: 'COMPLAINT_AWAITING_RESPONSE', category: 'ENGAGEMENT', channels: APP, variables: ['complaintNumber'],
    en: { title: 'Complaint {{complaintNumber}} needs your reply', body: 'Our team asked a question on complaint {{complaintNumber}}. Open it to reply.' },
    ar: { title: 'الشكوى {{complaintNumber}} بانتظار ردك', body: 'طرح فريقنا سؤالاً في الشكوى {{complaintNumber}}. افتحها للرد.' } },
  { code: 'RATE_YOUR_TRIP', category: 'ENGAGEMENT', channels: APP, variables: ['bookingNumber', 'deadline'],
    en: { title: 'How was booking {{bookingNumber}}?', body: 'Rate your experience on booking {{bookingNumber}} before {{deadline}}. It takes a minute and helps everyone.' },
    ar: { title: 'كيف كان الحجز {{bookingNumber}}؟', body: 'قيّم تجربتك في الحجز {{bookingNumber}} قبل {{deadline}}. يستغرق دقيقة ويفيد الجميع.' } },
  // ── operations ────────────────────────────────────────────────────────────
  { code: 'OPS_ANNOUNCEMENT', category: 'OPERATIONS', channels: APP, variables: ['title', 'message'],
    en: { title: '{{title}}', body: '{{message}}' },
    ar: { title: '{{title}}', body: '{{message}}' } },
];
