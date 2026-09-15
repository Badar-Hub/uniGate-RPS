/**
 * The permission catalogue — architecture.md §6.2 is the authoritative source; this file is
 * the seed generated from it, and the migration-integrity test asserts the two match.
 *
 * Format: `resource[.subresource].action`. Codes are referenced in source
 * (`requirePermission('vehicles.approve')`) and are never user-created.
 */
export interface PermissionSeed {
  code: string;
  module: string;
  descriptionEn: string;
  descriptionAr: string;
  isAssignable?: boolean;
}

const P = (module: string, code: string, en: string, ar: string, isAssignable = true): PermissionSeed => ({
  code,
  module,
  descriptionEn: en,
  descriptionAr: ar,
  isAssignable,
});

export const PERMISSIONS: readonly PermissionSeed[] = [
  // users
  P('users', 'users.read', 'View users', 'عرض المستخدمين'),
  P('users', 'users.create', 'Create users', 'إنشاء المستخدمين'),
  P('users', 'users.update', 'Update users', 'تعديل المستخدمين'),
  P('users', 'users.delete', 'Delete users', 'حذف المستخدمين'),
  P('users', 'users.suspend', 'Suspend users', 'تعليق المستخدمين'),
  P('users', 'users.impersonate', 'Impersonate a user (audited)', 'انتحال هوية مستخدم (مسجّل)'),
  // roles
  P('roles', 'roles.read', 'View roles', 'عرض الأدوار'),
  P('roles', 'roles.manage', 'Create and edit roles', 'إدارة الأدوار'),
  P('roles', 'permissions.read', 'View permissions', 'عرض الصلاحيات'),
  P('roles', 'permissions.assign', 'Assign permissions to roles', 'إسناد الصلاحيات للأدوار'),
  // customers
  P('customers', 'customers.read', 'View customers', 'عرض العملاء'),
  P('customers', 'customers.create', 'Create customers', 'إنشاء العملاء'),
  P('customers', 'customers.update', 'Update customers', 'تعديل العملاء'),
  P('customers', 'customers.verify', 'Verify customers and approve credit', 'التحقق من العملاء واعتماد الائتمان'),
  // owners
  P('owners', 'owners.read', 'View owners', 'عرض المالكين'),
  P('owners', 'owners.create', 'Create owners', 'إنشاء المالكين'),
  P('owners', 'owners.update', 'Update owners', 'تعديل المالكين'),
  P('owners', 'owners.approve', 'Approve owners', 'اعتماد المالكين'),
  P('owners', 'owners.suspend', 'Suspend owners', 'تعليق المالكين'),
  P('owners', 'owners.pii.reveal', 'Reveal owner identity documents', 'كشف بيانات هوية المالك'),
  // drivers
  P('drivers', 'drivers.read', 'View own drivers', 'عرض السائقين'),
  P('drivers', 'drivers.read_any', 'View any driver', 'عرض أي سائق'),
  P('drivers', 'drivers.create', 'Create drivers', 'إنشاء السائقين'),
  P('drivers', 'drivers.update', 'Update drivers', 'تعديل السائقين'),
  P('drivers', 'drivers.approve', 'Approve drivers', 'اعتماد السائقين'),
  P('drivers', 'drivers.assign', 'Assign drivers to vehicles', 'إسناد السائقين للمركبات'),
  P('drivers', 'drivers.pii.reveal', 'Reveal driver identity documents', 'كشف بيانات هوية السائق'),
  // spo
  P('spo', 'spo.read', 'View SPO profiles', 'عرض مندوبي المبيعات'),
  P('spo', 'spo.create', 'Create SPO profiles', 'إنشاء مندوبي المبيعات'),
  P('spo', 'spo.update', 'Update SPO profiles', 'تعديل مندوبي المبيعات'),
  P('spo', 'spo.leads.manage', 'Manage SPO leads', 'إدارة العملاء المحتملين'),
  P('spo', 'spo.commissions.read', 'View SPO commissions', 'عرض عمولات مندوبي المبيعات'),
  // vehicles
  P('vehicles', 'vehicles.read', 'View own vehicles', 'عرض المركبات'),
  P('vehicles', 'vehicles.read_any', 'View any vehicle', 'عرض أي مركبة'),
  P('vehicles', 'vehicles.create', 'Register vehicles', 'تسجيل المركبات'),
  P('vehicles', 'vehicles.update', 'Update vehicles', 'تعديل المركبات'),
  P('vehicles', 'vehicles.delete', 'Delete vehicles', 'حذف المركبات'),
  P('vehicles', 'vehicles.approve', 'Approve vehicles', 'اعتماد المركبات'),
  P('vehicles', 'vehicles.suspend', 'Suspend vehicles', 'تعليق المركبات'),
  P('vehicles', 'vehicles.availability.manage', 'Manage vehicle availability', 'إدارة توفر المركبات'),
  // reference
  P('reference', 'reference.read', 'View reference data', 'عرض البيانات المرجعية'),
  P('reference', 'reference.manage', 'Manage reference data', 'إدارة البيانات المرجعية'),
  P('reference', 'geo.use', 'Use geocoding and routing', 'استخدام خدمات الخرائط'),
  // documents
  P('documents', 'documents.read', 'View own documents', 'عرض المستندات'),
  P('documents', 'documents.read_any', 'View any document', 'عرض أي مستند'),
  P('documents', 'documents.upload', 'Upload documents', 'رفع المستندات'),
  P('documents', 'documents.verify', 'Verify documents', 'التحقق من المستندات'),
  P('documents', 'documents.delete', 'Delete documents', 'حذف المستندات'),
  P('documents', 'documents.download_any', 'Download any document', 'تنزيل أي مستند'),
  // trip requests
  P('trip-requests', 'trip_requests.read', 'View own trip requests', 'عرض طلبات الرحلات'),
  P('trip-requests', 'trip_requests.read_any', 'View any trip request', 'عرض أي طلب رحلة'),
  P('trip-requests', 'trip_requests.create', 'Create trip requests', 'إنشاء طلبات الرحلات'),
  P('trip-requests', 'trip_requests.update', 'Update trip requests', 'تعديل طلبات الرحلات'),
  P('trip-requests', 'trip_requests.cancel', 'Cancel trip requests', 'إلغاء طلبات الرحلات'),
  P('trip-requests', 'opportunities.dismiss', 'Dismiss opportunities', 'تجاهل الفرص'),
  // bids
  P('bids', 'bids.read', 'View own bids', 'عرض العروض'),
  P('bids', 'bids.read_any', 'View any bid', 'عرض أي عرض'),
  P('bids', 'bids.create', 'Submit bids', 'تقديم العروض'),
  P('bids', 'bids.update', 'Revise bids', 'تعديل العروض'),
  P('bids', 'bids.withdraw', 'Withdraw bids', 'سحب العروض'),
  P('bids', 'bids.accept', 'Accept bids', 'قبول العروض'),
  // bookings
  P('bookings', 'bookings.read', 'View own bookings', 'عرض الحجوزات'),
  P('bookings', 'bookings.read_any', 'View any booking', 'عرض أي حجز'),
  P('bookings', 'bookings.create', 'Create bookings', 'إنشاء الحجوزات'),
  P('bookings', 'bookings.manage', 'Manage bookings', 'إدارة الحجوزات'),
  P('bookings', 'bookings.cancel', 'Cancel bookings', 'إلغاء الحجوزات'),
  P('bookings', 'bookings.assign_driver', 'Assign drivers to bookings', 'إسناد السائقين للحجوزات'),
  // trips
  P('trips', 'trips.read', 'View own trips', 'عرض الرحلات'),
  P('trips', 'trips.read_any', 'View any trip', 'عرض أي رحلة'),
  P('trips', 'trips.update_status', 'Update trip status', 'تحديث حالة الرحلة'),
  P('trips', 'trips.manage', 'Manage trips', 'إدارة الرحلات'),
  // tracking
  P('tracking', 'tracking.read', 'View tracking for own trips', 'عرض التتبع'),
  P('tracking', 'tracking.read_any', 'View any tracking', 'عرض أي تتبع'),
  P('tracking', 'tracking.publish', 'Publish location', 'نشر الموقع'),
  // payments
  P('payments', 'payments.read', 'View own payments', 'عرض المدفوعات'),
  P('payments', 'payments.read_any', 'View any payment', 'عرض أي دفعة'),
  P('payments', 'payments.create', 'Initiate payments', 'بدء المدفوعات'),
  P('payments', 'payments.manage', 'Manage payments', 'إدارة المدفوعات'),
  P('payments', 'payments.refund', 'Approve and process refunds', 'اعتماد ومعالجة المبالغ المستردة'),
  P('payments', 'payments.config.manage', 'Manage payment gateway configuration', 'إدارة إعدادات بوابة الدفع'),
  // finance
  P('finance', 'commissions.read', 'View commission rules and earnings', 'عرض قواعد العمولة'),
  P('finance', 'commissions.manage', 'Manage commission rules', 'إدارة قواعد العمولة'),
  P('finance', 'commissions.override', 'Override commission per trip', 'تجاوز العمولة لكل رحلة'),
  P('finance', 'settlements.read', 'View settlements', 'عرض التسويات'),
  P('finance', 'settlements.create', 'Create settlements', 'إنشاء التسويات'),
  P('finance', 'settlements.approve', 'Approve settlements', 'اعتماد التسويات'),
  P('finance', 'settlements.pay', 'Pay settlements', 'دفع التسويات'),
  P('finance', 'invoices.read', 'View invoices', 'عرض الفواتير'),
  P('finance', 'invoices.issue', 'Issue invoices', 'إصدار الفواتير'),
  P('finance', 'ledger.read', 'View the ledger', 'عرض دفتر الأستاذ'),
  // expenses
  P('expenses', 'expenses.read', 'View own expenses', 'عرض المصروفات'),
  P('expenses', 'expenses.read_any', 'View any expense', 'عرض أي مصروف'),
  P('expenses', 'expenses.create', 'Record expenses', 'تسجيل المصروفات'),
  P('expenses', 'expenses.update', 'Update expenses', 'تعديل المصروفات'),
  P('expenses', 'expenses.delete', 'Delete expenses', 'حذف المصروفات'),
  // maintenance
  P('maintenance', 'maintenance.read', 'View own maintenance', 'عرض الصيانة'),
  P('maintenance', 'maintenance.read_any', 'View any maintenance', 'عرض أي صيانة'),
  P('maintenance', 'maintenance.create', 'Record maintenance', 'تسجيل الصيانة'),
  P('maintenance', 'maintenance.update', 'Update maintenance', 'تعديل الصيانة'),
  P('maintenance', 'maintenance.delete', 'Delete maintenance', 'حذف الصيانة'),
  // engagement
  P('engagement', 'ratings.read', 'View ratings', 'عرض التقييمات'),
  P('engagement', 'ratings.create', 'Submit ratings', 'تقديم التقييمات'),
  P('engagement', 'ratings.moderate', 'Moderate ratings', 'الإشراف على التقييمات'),
  P('engagement', 'complaints.read', 'View own complaints', 'عرض الشكاوى'),
  P('engagement', 'complaints.read_any', 'View any complaint', 'عرض أي شكوى'),
  P('engagement', 'complaints.create', 'Raise complaints', 'رفع الشكاوى'),
  P('engagement', 'complaints.manage', 'Manage complaints', 'إدارة الشكاوى'),
  // notifications
  P('notifications', 'notifications.read', 'View notifications', 'عرض الإشعارات'),
  P('notifications', 'notifications.send', 'Send notifications', 'إرسال الإشعارات'),
  P('notifications', 'notifications.templates.manage', 'Manage notification templates', 'إدارة قوالب الإشعارات'),
  // reports
  P('reports', 'reports.read', 'View reports', 'عرض التقارير'),
  P('reports', 'reports.export', 'Export reports', 'تصدير التقارير'),
  P('reports', 'reports.financial.read', 'View financial reports', 'عرض التقارير المالية'),
  // platform
  P('platform', 'dashboard.read', 'View dashboards', 'عرض لوحات المعلومات'),
  P('platform', 'audit_logs.read', 'View the audit log (audited)', 'عرض سجل التدقيق'),
  P('platform', 'settings.read', 'View settings', 'عرض الإعدادات'),
  P('platform', 'settings.manage', 'Manage settings', 'إدارة الإعدادات'),
  P('platform', 'system.health.read', 'View system health', 'عرض حالة النظام'),
  P('platform', 'platform.jobs.manage', 'Manage background jobs', 'إدارة المهام الخلفية'),
];

/** Seeded roles (database.md §14.3, V17). System roles cannot be deleted or renamed. */
export interface RoleSeed {
  code: string;
  nameEn: string;
  nameAr: string;
  description: string;
  isSystem: boolean;
  permissions: readonly string[] | 'ALL';
}

const ALL = PERMISSIONS.map((p) => p.code);
const byModule = (...modules: string[]) => PERMISSIONS.filter((p) => modules.includes(p.module)).map((p) => p.code);

export const ROLES: readonly RoleSeed[] = [
  { code: 'SUPER_ADMIN', nameEn: 'Super Administrator', nameAr: 'المدير العام', description: 'Every permission. Reserved for platform owners.', isSystem: true, permissions: 'ALL' },
  {
    code: 'ADMIN', nameEn: 'Administrator', nameAr: 'مدير', description: 'Back-office administration without user impersonation or role editing.', isSystem: true,
    permissions: ALL.filter((c) => !['users.impersonate', 'roles.manage', 'permissions.assign', 'platform.jobs.manage'].includes(c)),
  },
  {
    code: 'OPS_MANAGER', nameEn: 'Operations Manager', nameAr: 'مدير العمليات', description: 'Approvals, dispatch, trips, tracking and complaints.', isSystem: true,
    permissions: [
      ...byModule('owners', 'drivers', 'vehicles', 'documents', 'trip-requests', 'bids', 'bookings', 'trips', 'tracking', 'maintenance', 'engagement', 'notifications'),
      'customers.read', 'customers.update', 'reference.read', 'geo.use', 'dashboard.read', 'settings.read', 'reports.read', 'commissions.read', 'commissions.override',
    ].filter((c) => !['owners.pii.reveal', 'drivers.pii.reveal'].includes(c)),
  },
  {
    code: 'FINANCE_OFFICER', nameEn: 'Finance Officer', nameAr: 'موظف مالية', description: 'Settlements, refunds, invoices, commissions and financial reports.', isSystem: true,
    permissions: [
      ...byModule('finance', 'reports', 'payments', 'expenses'),
      'customers.read', 'customers.verify', 'owners.read', 'vehicles.read_any', 'bookings.read_any', 'trip_requests.read_any', 'dashboard.read', 'settings.read', 'audit_logs.read', 'reference.read', 'notifications.read',
    ].filter((c) => c !== 'payments.config.manage'),
  },
  {
    code: 'SUPPORT_AGENT', nameEn: 'Support Agent', nameAr: 'موظف دعم', description: 'Read-mostly access with complaint handling.', isSystem: true,
    permissions: [
      'users.read', 'customers.read', 'owners.read', 'drivers.read_any', 'vehicles.read_any', 'documents.read_any', 'trip_requests.read_any', 'bids.read_any',
      'bookings.read_any', 'trips.read_any', 'tracking.read_any', 'payments.read_any', 'invoices.read', 'ratings.read', 'complaints.read_any', 'complaints.manage',
      'notifications.read', 'notifications.send', 'reference.read', 'dashboard.read',
    ],
  },
  {
    code: 'CUSTOMER', nameEn: 'Customer', nameAr: 'عميل', description: 'Requests trips, compares bids, books and pays.', isSystem: true,
    permissions: [
      'trip_requests.read', 'trip_requests.create', 'trip_requests.update', 'trip_requests.cancel', 'bids.read', 'bids.accept', 'bookings.read', 'bookings.cancel',
      'trips.read', 'tracking.read', 'payments.read', 'payments.create', 'invoices.read', 'documents.read', 'documents.upload', 'ratings.read', 'ratings.create',
      'complaints.read', 'complaints.create', 'notifications.read', 'reference.read', 'geo.use', 'reports.read', 'reports.export',
    ],
  },
  {
    code: 'VEHICLE_OWNER', nameEn: 'Vehicle Owner', nameAr: 'مالك مركبة', description: 'Registers vehicles and drivers, bids, fulfils bookings, is settled.', isSystem: true,
    permissions: [
      'vehicles.read', 'vehicles.create', 'vehicles.update', 'vehicles.delete', 'vehicles.availability.manage', 'drivers.read', 'drivers.create', 'drivers.update', 'drivers.assign',
      'documents.read', 'documents.upload', 'documents.delete', 'trip_requests.read', 'opportunities.dismiss', 'bids.read', 'bids.create', 'bids.update', 'bids.withdraw',
      'bookings.read', 'bookings.cancel', 'bookings.assign_driver', 'trips.read', 'tracking.read', 'commissions.read', 'settlements.read', 'invoices.read',
      'expenses.read', 'expenses.create', 'expenses.update', 'expenses.delete', 'maintenance.read', 'maintenance.create', 'maintenance.update', 'maintenance.delete',
      'ratings.read', 'ratings.create', 'complaints.read', 'complaints.create', 'notifications.read', 'reference.read', 'geo.use', 'dashboard.read', 'reports.read', 'reports.export',
    ],
  },
  {
    code: 'DRIVER', nameEn: 'Driver', nameAr: 'سائق', description: 'Executes trips and publishes location.', isSystem: true,
    permissions: ['trips.read', 'trips.update_status', 'tracking.publish', 'tracking.read', 'bookings.read', 'documents.read', 'documents.upload', 'ratings.read', 'ratings.create', 'complaints.read', 'complaints.create', 'notifications.read', 'reference.read', 'geo.use'],
  },
  {
    code: 'SPO', nameEn: 'Sales Promotion Officer', nameAr: 'مندوب مبيعات', description: 'Acquires customers, manages leads, views attributed commissions.', isSystem: true,
    permissions: ['spo.read', 'spo.leads.manage', 'spo.commissions.read', 'customers.read', 'customers.create', 'trip_requests.read', 'trip_requests.create', 'notifications.read', 'reference.read', 'geo.use', 'dashboard.read', 'reports.read', 'reports.export'],
  },
];
