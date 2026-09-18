/**
 * Reference data (database.md §6.3, §14.3). All environments. Admin-editable afterwards
 * through the reference module; the seed is idempotent (upsert on code).
 */

export const REGIONS = [
  { code: 'RIYADH', nameEn: 'Riyadh', nameAr: 'الرياض' },
  { code: 'MAKKAH', nameEn: 'Makkah', nameAr: 'مكة المكرمة' },
  { code: 'MADINAH', nameEn: 'Madinah', nameAr: 'المدينة المنورة' },
  { code: 'QASSIM', nameEn: 'Al-Qassim', nameAr: 'القصيم' },
  { code: 'EASTERN', nameEn: 'Eastern Province', nameAr: 'المنطقة الشرقية' },
  { code: 'ASIR', nameEn: 'Asir', nameAr: 'عسير' },
  { code: 'TABUK', nameEn: 'Tabuk', nameAr: 'تبوك' },
  { code: 'HAIL', nameEn: "Ha'il", nameAr: 'حائل' },
  { code: 'NORTHERN', nameEn: 'Northern Borders', nameAr: 'الحدود الشمالية' },
  { code: 'JAZAN', nameEn: 'Jazan', nameAr: 'جازان' },
  { code: 'NAJRAN', nameEn: 'Najran', nameAr: 'نجران' },
  { code: 'BAHAH', nameEn: 'Al-Bahah', nameAr: 'الباحة' },
  { code: 'JAWF', nameEn: 'Al-Jawf', nameAr: 'الجوف' },
] as const;

export const CITIES = [
  { region: 'RIYADH', code: 'RUH', nameEn: 'Riyadh', nameAr: 'الرياض', lat: 24.7135517, lng: 46.6752957 },
  { region: 'RIYADH', code: 'KHARJ', nameEn: 'Al Kharj', nameAr: 'الخرج', lat: 24.1483, lng: 47.3050 },
  { region: 'RIYADH', code: 'DAWADMI', nameEn: 'Ad Dawadimi', nameAr: 'الدوادمي', lat: 24.5077, lng: 44.3924 },
  { region: 'RIYADH', code: 'MAJMAAH', nameEn: 'Al Majmaah', nameAr: 'المجمعة', lat: 25.9040, lng: 45.3450 },
  { region: 'MAKKAH', code: 'JED', nameEn: 'Jeddah', nameAr: 'جدة', lat: 21.4858, lng: 39.1925 },
  { region: 'MAKKAH', code: 'MAKKAH', nameEn: 'Makkah', nameAr: 'مكة المكرمة', lat: 21.3891, lng: 39.8579 },
  { region: 'MAKKAH', code: 'TAIF', nameEn: 'Taif', nameAr: 'الطائف', lat: 21.2703, lng: 40.4158 },
  { region: 'MAKKAH', code: 'RABIGH', nameEn: 'Rabigh', nameAr: 'رابغ', lat: 22.7986, lng: 39.0349 },
  { region: 'MAKKAH', code: 'KAEC', nameEn: 'King Abdullah Economic City', nameAr: 'مدينة الملك عبدالله الاقتصادية', lat: 22.4459, lng: 39.1044 },
  { region: 'MADINAH', code: 'MED', nameEn: 'Madinah', nameAr: 'المدينة المنورة', lat: 24.5247, lng: 39.5692 },
  { region: 'MADINAH', code: 'YANBU', nameEn: 'Yanbu', nameAr: 'ينبع', lat: 24.0895, lng: 38.0618 },
  { region: 'QASSIM', code: 'BURAYDAH', nameEn: 'Buraydah', nameAr: 'بريدة', lat: 26.3260, lng: 43.9750 },
  { region: 'QASSIM', code: 'UNAYZAH', nameEn: 'Unaizah', nameAr: 'عنيزة', lat: 26.0844, lng: 43.9935 },
  { region: 'EASTERN', code: 'DMM', nameEn: 'Dammam', nameAr: 'الدمام', lat: 26.4207, lng: 50.0888 },
  { region: 'EASTERN', code: 'KHOBAR', nameEn: 'Al Khobar', nameAr: 'الخبر', lat: 26.2172, lng: 50.1971 },
  { region: 'EASTERN', code: 'DHAHRAN', nameEn: 'Dhahran', nameAr: 'الظهران', lat: 26.2361, lng: 50.0393 },
  { region: 'EASTERN', code: 'JUBAIL', nameEn: 'Jubail', nameAr: 'الجبيل', lat: 27.0046, lng: 49.6460 },
  { region: 'EASTERN', code: 'HOFUF', nameEn: 'Al Hofuf', nameAr: 'الهفوف', lat: 25.3648, lng: 49.5856 },
  { region: 'EASTERN', code: 'QATIF', nameEn: 'Qatif', nameAr: 'القطيف', lat: 26.5196, lng: 50.0115 },
  { region: 'EASTERN', code: 'HAFR', nameEn: 'Hafar Al Batin', nameAr: 'حفر الباطن', lat: 28.4328, lng: 45.9708 },
  { region: 'ASIR', code: 'ABHA', nameEn: 'Abha', nameAr: 'أبها', lat: 18.2164, lng: 42.5053 },
  { region: 'ASIR', code: 'KHAMIS', nameEn: 'Khamis Mushait', nameAr: 'خميس مشيط', lat: 18.3060, lng: 42.7297 },
  { region: 'TABUK', code: 'TABUK', nameEn: 'Tabuk', nameAr: 'تبوك', lat: 28.3838, lng: 36.5550 },
  { region: 'TABUK', code: 'NEOM', nameEn: 'NEOM', nameAr: 'نيوم', lat: 28.0086, lng: 35.2181 },
  { region: 'HAIL', code: 'HAIL', nameEn: "Ha'il", nameAr: 'حائل', lat: 27.5114, lng: 41.7208 },
  { region: 'NORTHERN', code: 'ARAR', nameEn: 'Arar', nameAr: 'عرعر', lat: 30.9753, lng: 41.0381 },
  { region: 'JAZAN', code: 'JAZAN', nameEn: 'Jazan', nameAr: 'جازان', lat: 16.8892, lng: 42.5511 },
  { region: 'NAJRAN', code: 'NAJRAN', nameEn: 'Najran', nameAr: 'نجران', lat: 17.4924, lng: 44.1277 },
  { region: 'BAHAH', code: 'BAHAH', nameEn: 'Al-Bahah', nameAr: 'الباحة', lat: 20.0129, lng: 41.4677 },
  { region: 'JAWF', code: 'SAKAKA', nameEn: 'Sakaka', nameAr: 'سكاكا', lat: 29.9697, lng: 40.2064 },
] as const;

export const VEHICLE_CATEGORIES = [
  { code: 'SEDAN', t: 'PASSENGER', nameEn: 'Sedan', nameAr: 'سيدان', minP: 1, maxP: 4, sort: 10 },
  { code: 'SUV', t: 'PASSENGER', nameEn: 'SUV', nameAr: 'دفع رباعي', minP: 1, maxP: 7, sort: 20 },
  { code: 'LUXURY_CAR', t: 'PASSENGER', nameEn: 'Luxury car', nameAr: 'سيارة فاخرة', minP: 1, maxP: 4, sort: 30 },
  { code: 'VAN', t: 'PASSENGER', nameEn: 'Van', nameAr: 'فان', minP: 5, maxP: 14, sort: 40 },
  { code: 'MINIBUS', t: 'PASSENGER', nameEn: 'Minibus', nameAr: 'حافلة صغيرة', minP: 15, maxP: 25, sort: 50 },
  { code: 'COASTER', t: 'PASSENGER', nameEn: 'Coaster', nameAr: 'كوستر', minP: 20, maxP: 30, sort: 60 },
  { code: 'BUS', t: 'PASSENGER', nameEn: 'Bus', nameAr: 'حافلة', minP: 31, maxP: 60, sort: 70, special: true },
  { code: 'PICKUP', t: 'GOODS', nameEn: 'Pickup', nameAr: 'بيك أب', minKg: 100, maxKg: 1500, sort: 110 },
  { code: 'LIGHT_TRUCK', t: 'GOODS', nameEn: 'Light truck', nameAr: 'شاحنة خفيفة', minKg: 1000, maxKg: 5000, sort: 120 },
  { code: 'HEAVY_TRUCK', t: 'GOODS', nameEn: 'Heavy truck', nameAr: 'شاحنة ثقيلة', minKg: 5000, maxKg: 25000, sort: 130, special: true },
  { code: 'FLATBED_TRAILER', t: 'GOODS', nameEn: 'Flatbed trailer', nameAr: 'مقطورة مسطحة', minKg: 10000, maxKg: 40000, sort: 140, special: true },
  { code: 'CURTAIN_TRAILER', t: 'GOODS', nameEn: 'Curtain-side trailer', nameAr: 'مقطورة ستائرية', minKg: 10000, maxKg: 40000, sort: 150, special: true },
  { code: 'REFRIGERATED_TRUCK', t: 'GOODS', nameEn: 'Refrigerated truck', nameAr: 'شاحنة مبردة', minKg: 1000, maxKg: 25000, sort: 160, special: true },
  { code: 'TANKER', t: 'GOODS', nameEn: 'Tanker', nameAr: 'صهريج', minKg: 5000, maxKg: 40000, sort: 170, special: true },
  { code: 'CAR_CARRIER', t: 'GOODS', nameEn: 'Car carrier', nameAr: 'ناقلة سيارات', minKg: 5000, maxKg: 30000, sort: 180, special: true },
  { code: 'LOWBED_TRAILER', t: 'GOODS', nameEn: 'Lowbed trailer', nameAr: 'مقطورة منخفضة', minKg: 20000, maxKg: 80000, sort: 190, special: true },
] as const;

const PDF_IMG = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const IMG = ['image/jpeg', 'image/png', 'image/webp'];

/** Document checklist per entity (database.md §6.1). Vertical-specific licences carry transportType. */
export const DOCUMENT_TYPES = [
  // user / identity
  { code: 'NATIONAL_ID', a: 'USER', nameEn: 'National ID', nameAr: 'الهوية الوطنية', expiry: true, mandatory: true, mime: PDF_IMG, sort: 10 },
  { code: 'IQAMA', a: 'USER', nameEn: 'Iqama', nameAr: 'الإقامة', expiry: true, mandatory: false, mime: PDF_IMG, sort: 20 },
  // owner
  { code: 'OWNER_CR', a: 'OWNER', nameEn: 'Commercial registration', nameAr: 'السجل التجاري', expiry: true, mandatory: true, mime: PDF_IMG, sort: 10 },
  { code: 'OWNER_VAT_CERTIFICATE', a: 'OWNER', nameEn: 'VAT registration certificate', nameAr: 'شهادة التسجيل في ضريبة القيمة المضافة', expiry: false, mandatory: false, mime: PDF_IMG, sort: 20 },
  { code: 'OWNER_TGA_LICENCE_PASSENGER', a: 'OWNER', t: 'PASSENGER', nameEn: 'TGA passenger transport licence', nameAr: 'ترخيص هيئة النقل — نقل الركاب', expiry: true, mandatory: true, mime: PDF_IMG, sort: 30 },
  { code: 'OWNER_TGA_LICENCE_GOODS', a: 'OWNER', t: 'GOODS', nameEn: 'TGA goods transport licence', nameAr: 'ترخيص هيئة النقل — نقل البضائع', expiry: true, mandatory: true, mime: PDF_IMG, sort: 31 },
  { code: 'OWNER_BANK_LETTER', a: 'OWNER', nameEn: 'Bank IBAN letter', nameAr: 'خطاب الآيبان البنكي', expiry: false, mandatory: false, mime: PDF_IMG, sort: 40 },
  { code: 'OWNER_SELF_BILLING_AGREEMENT', a: 'OWNER', nameEn: 'Signed self-billing agreement', nameAr: 'اتفاقية الفوترة الذاتية الموقعة', expiry: true, mandatory: false, mime: ['application/pdf'], sort: 50 },
  { code: 'OWNER_ZATCA_APPROVAL', a: 'OWNER', nameEn: 'ZATCA self-billing approval', nameAr: 'موافقة الهيئة على الفوترة الذاتية', expiry: false, mandatory: false, mime: ['application/pdf'], sort: 51 },
  // driver
  { code: 'DRIVER_LICENCE', a: 'DRIVER', nameEn: 'Driving licence', nameAr: 'رخصة القيادة', expiry: true, mandatory: true, mime: PDF_IMG, sort: 10 },
  { code: 'DRIVER_TGA_CARD_PASSENGER', a: 'DRIVER', t: 'PASSENGER', nameEn: 'TGA professional driver card (passenger)', nameAr: 'بطاقة السائق المهني — ركاب', expiry: true, mandatory: true, mime: PDF_IMG, sort: 20 },
  { code: 'DRIVER_TGA_CARD_GOODS', a: 'DRIVER', t: 'GOODS', nameEn: 'TGA professional driver card (goods)', nameAr: 'بطاقة السائق المهني — بضائع', expiry: true, mandatory: true, mime: PDF_IMG, sort: 21 },
  { code: 'DRIVER_PHOTO', a: 'DRIVER', nameEn: 'Driver photo', nameAr: 'صورة السائق', expiry: false, mandatory: true, mime: IMG, sort: 30 },
  { code: 'DRIVER_MEDICAL', a: 'DRIVER', nameEn: 'Medical fitness certificate', nameAr: 'شهادة اللياقة الطبية', expiry: true, mandatory: false, mime: PDF_IMG, sort: 40 },
  // vehicle
  { code: 'VEHICLE_REGISTRATION', a: 'VEHICLE', nameEn: 'Vehicle registration (Istimara)', nameAr: 'استمارة المركبة', expiry: true, mandatory: true, mime: PDF_IMG, sort: 10 },
  { code: 'VEHICLE_INSURANCE', a: 'VEHICLE', nameEn: 'Insurance policy', nameAr: 'وثيقة التأمين', expiry: true, mandatory: true, mime: PDF_IMG, sort: 20 },
  { code: 'VEHICLE_INSPECTION', a: 'VEHICLE', nameEn: 'Periodic inspection (Fahs)', nameAr: 'الفحص الدوري', expiry: true, mandatory: true, mime: PDF_IMG, sort: 30 },
  { code: 'VEHICLE_OPERATING_CARD', a: 'VEHICLE', nameEn: 'TGA operating card', nameAr: 'بطاقة التشغيل', expiry: true, mandatory: true, mime: PDF_IMG, sort: 40 },
  { code: 'VEHICLE_PHOTO_FRONT', a: 'VEHICLE', nameEn: 'Photo — front', nameAr: 'صورة — أمامية', expiry: false, mandatory: true, mime: IMG, sort: 50 },
  { code: 'VEHICLE_PHOTO_SIDE', a: 'VEHICLE', nameEn: 'Photo — side', nameAr: 'صورة — جانبية', expiry: false, mandatory: true, mime: IMG, sort: 51 },
  { code: 'VEHICLE_PHOTO_INTERIOR', a: 'VEHICLE', nameEn: 'Photo — interior', nameAr: 'صورة — داخلية', expiry: false, mandatory: false, mime: IMG, sort: 52 },
  { code: 'VEHICLE_REFRIGERATION_CERT', a: 'VEHICLE', t: 'GOODS', nameEn: 'Refrigeration unit certificate', nameAr: 'شهادة وحدة التبريد', expiry: true, mandatory: false, mime: PDF_IMG, sort: 60 },
  { code: 'VEHICLE_HAZMAT_PERMIT', a: 'VEHICLE', t: 'GOODS', nameEn: 'Hazardous goods permit', nameAr: 'تصريح نقل المواد الخطرة', expiry: true, mandatory: false, mime: PDF_IMG, sort: 61 },
  // corporate customer
  { code: 'CORPORATE_CR', a: 'CORPORATE_CUSTOMER', nameEn: 'Commercial registration', nameAr: 'السجل التجاري', expiry: true, mandatory: true, mime: PDF_IMG, sort: 10 },
  { code: 'CORPORATE_VAT_CERTIFICATE', a: 'CORPORATE_CUSTOMER', nameEn: 'VAT registration certificate', nameAr: 'شهادة التسجيل في ضريبة القيمة المضافة', expiry: false, mandatory: true, mime: PDF_IMG, sort: 20 },
  { code: 'CORPORATE_NATIONAL_ADDRESS', a: 'CORPORATE_CUSTOMER', nameEn: 'National address certificate', nameAr: 'شهادة العنوان الوطني', expiry: true, mandatory: true, mime: PDF_IMG, sort: 30 },
  { code: 'CORPORATE_AUTHORISATION', a: 'CORPORATE_CUSTOMER', nameEn: 'Authorised signatory letter', nameAr: 'خطاب تفويض المفوض بالتوقيع', expiry: false, mandatory: false, mime: ['application/pdf'], sort: 40 },
  // expense / maintenance / proof
  { code: 'EXPENSE_RECEIPT', a: 'EXPENSE', nameEn: 'Receipt', nameAr: 'إيصال', expiry: false, mandatory: false, mime: PDF_IMG, sort: 10 },
  { code: 'MAINTENANCE_INVOICE', a: 'MAINTENANCE_RECORD', nameEn: 'Workshop invoice', nameAr: 'فاتورة الورشة', expiry: false, mandatory: false, mime: PDF_IMG, sort: 10 },
  { code: 'POD_PHOTO', a: 'TRIP_PROOF', nameEn: 'Proof of delivery photo', nameAr: 'صورة إثبات التسليم', expiry: false, mandatory: false, mime: IMG, sort: 10 },
  { code: 'PAYMENT_RECEIPT', a: 'PAYMENT', nameEn: 'Bank transfer receipt', nameAr: 'إيصال التحويل البنكي', expiry: false, mandatory: true, mime: PDF_IMG, sort: 10 },
  { code: 'POD_SIGNATURE', a: 'TRIP_PROOF', nameEn: 'Recipient signature', nameAr: 'توقيع المستلم', expiry: false, mandatory: false, mime: IMG, sort: 20 },
  { code: 'REPORT_EXPORT', a: 'USER', nameEn: 'Report export', nameAr: 'تصدير تقرير', expiry: false, mandatory: false, mime: ['text/csv'], sort: 90 },
  { code: 'SUPPLIER_INVOICE_PDF', a: 'OWNER', nameEn: 'Supplier tax invoice (PDF)', nameAr: 'فاتورة المورد الضريبية', expiry: false, mandatory: false, mime: ['application/pdf'], sort: 60 },
  { code: 'SUPPLIER_INVOICE_XML', a: 'OWNER', nameEn: 'Supplier tax invoice (XML)', nameAr: 'فاتورة المورد الضريبية (XML)', expiry: false, mandatory: false, mime: ['application/xml', 'text/xml'], sort: 61 },
] as const;

export const EXPENSE_CATEGORIES = [
  { code: 'FUEL', nameEn: 'Fuel', nameAr: 'وقود', sort: 10 },
  { code: 'TOLLS', nameEn: 'Tolls & parking', nameAr: 'رسوم الطرق والمواقف', sort: 20 },
  { code: 'MAINTENANCE', nameEn: 'Maintenance', nameAr: 'صيانة', sort: 30 },
  { code: 'TYRES', nameEn: 'Tyres', nameAr: 'إطارات', sort: 40 },
  { code: 'INSURANCE', nameEn: 'Insurance', nameAr: 'تأمين', sort: 50 },
  { code: 'REGISTRATION_FEES', nameEn: 'Registration & inspection fees', nameAr: 'رسوم التسجيل والفحص', sort: 60 },
  { code: 'DRIVER_ALLOWANCE', nameEn: 'Driver allowance', nameAr: 'بدل السائق', sort: 70 },
  { code: 'FINES', nameEn: 'Fines', nameAr: 'مخالفات', sort: 80 },
  { code: 'OTHER', nameEn: 'Other', nameAr: 'أخرى', sort: 90 },
] as const;

export const MAINTENANCE_SERVICE_TYPES = [
  { code: 'OIL_CHANGE', nameEn: 'Oil change', nameAr: 'تغيير الزيت', sort: 10 },
  { code: 'TYRE_ROTATION', nameEn: 'Tyre rotation', nameAr: 'تدوير الإطارات', sort: 20 },
  { code: 'BRAKES', nameEn: 'Brake service', nameAr: 'صيانة الفرامل', sort: 30 },
  { code: 'AC_SERVICE', nameEn: 'Air-conditioning service', nameAr: 'صيانة التكييف', sort: 40 },
  { code: 'PERIODIC_INSPECTION', nameEn: 'Periodic inspection', nameAr: 'الفحص الدوري', sort: 50 },
  { code: 'ENGINE', nameEn: 'Engine repair', nameAr: 'إصلاح المحرك', sort: 60 },
  { code: 'TRANSMISSION', nameEn: 'Transmission', nameAr: 'ناقل الحركة', sort: 70 },
  { code: 'BODYWORK', nameEn: 'Bodywork', nameAr: 'هيكل المركبة', sort: 80 },
  { code: 'REFRIGERATION_UNIT', nameEn: 'Refrigeration unit', nameAr: 'وحدة التبريد', sort: 90 },
  { code: 'OTHER', nameEn: 'Other', nameAr: 'أخرى', sort: 100 },
] as const;

/** Chart of accounts (database.md §12.4). */
export const LEDGER_ACCOUNTS = [
  { code: 'CASH_GATEWAY', nameEn: 'Cash — payment gateway', nameAr: 'نقد — بوابة الدفع', type: 'ASSET' },
  { code: 'CASH_BANK', nameEn: 'Cash — bank', nameAr: 'نقد — البنك', type: 'ASSET' },
  { code: 'CUSTOMER_RECEIVABLE', nameEn: 'Customer receivables', nameAr: 'ذمم العملاء المدينة', type: 'ASSET' },
  { code: 'VAT_RECOVERABLE', nameEn: 'VAT recoverable (input)', nameAr: 'ضريبة القيمة المضافة القابلة للاسترداد', type: 'ASSET' },
  { code: 'OWNER_PAYABLE', nameEn: 'Owner payables', nameAr: 'ذمم المالكين الدائنة', type: 'LIABILITY' },
  { code: 'VAT_PAYABLE', nameEn: 'VAT payable (output)', nameAr: 'ضريبة القيمة المضافة المستحقة', type: 'LIABILITY' },
  { code: 'SPO_COMMISSION_PAYABLE', nameEn: 'SPO commission payable', nameAr: 'عمولات مندوبي المبيعات المستحقة', type: 'LIABILITY' },
  { code: 'BAD_DEBT_PROVISION', nameEn: 'Bad debt provision', nameAr: 'مخصص الديون المعدومة', type: 'LIABILITY' },
  { code: 'PLATFORM_COMMISSION_REVENUE', nameEn: 'Platform commission revenue', nameAr: 'إيرادات عمولة المنصة', type: 'REVENUE' },
  { code: 'TRANSPORT_REVENUE', nameEn: 'Transport service revenue', nameAr: 'إيرادات خدمات النقل', type: 'REVENUE' },
  { code: 'PAYMENT_PROCESSING_FEES', nameEn: 'Payment processing fees', nameAr: 'رسوم معالجة المدفوعات', type: 'EXPENSE' },
  { code: 'SUBCONTRACTED_TRANSPORT_COST', nameEn: 'Subcontracted transport cost', nameAr: 'تكلفة النقل من الباطن', type: 'EXPENSE' },
  { code: 'REFUNDS_ISSUED', nameEn: 'Refunds issued', nameAr: 'المبالغ المستردة', type: 'EXPENSE' },
  { code: 'BAD_DEBT_EXPENSE', nameEn: 'Bad debt expense', nameAr: 'مصروف الديون المعدومة', type: 'EXPENSE' },
] as const;

/**
 * Makes and models common in the KSA commercial fleet (buses, vans, pickups, trucks). Owners pick
 * from this list; admins extend it through POST /reference/vehicle-makes|models (reference.manage).
 * A make that is missing never blocks registration — make/model are optional on the vehicle.
 */
export const VEHICLE_MAKES: { name: string; models: { name: string; body?: string }[] }[] = [
  { name: 'Toyota', models: [{ name: 'Hiace', body: 'VAN' }, { name: 'Coaster', body: 'MINIBUS' }, { name: 'Hilux', body: 'PICKUP' }, { name: 'Land Cruiser', body: 'SUV' }, { name: 'Dyna', body: 'LIGHT_TRUCK' }, { name: 'Camry', body: 'SEDAN' }, { name: 'Innova', body: 'MPV' }] },
  { name: 'Hyundai', models: [{ name: 'H-1', body: 'VAN' }, { name: 'Staria', body: 'VAN' }, { name: 'County', body: 'MINIBUS' }, { name: 'Universe', body: 'BUS' }, { name: 'Mighty', body: 'LIGHT_TRUCK' }, { name: 'Sonata', body: 'SEDAN' }] },
  { name: 'Kia', models: [{ name: 'Carnival', body: 'MPV' }, { name: 'K2700', body: 'LIGHT_TRUCK' }, { name: 'Bongo', body: 'LIGHT_TRUCK' }] },
  { name: 'Nissan', models: [{ name: 'Urvan', body: 'VAN' }, { name: 'Patrol', body: 'SUV' }, { name: 'Navara', body: 'PICKUP' }, { name: 'Sunny', body: 'SEDAN' }] },
  { name: 'Mitsubishi', models: [{ name: 'L200', body: 'PICKUP' }, { name: 'Canter', body: 'LIGHT_TRUCK' }, { name: 'Rosa', body: 'MINIBUS' }] },
  { name: 'Isuzu', models: [{ name: 'NPR', body: 'LIGHT_TRUCK' }, { name: 'NQR', body: 'TRUCK' }, { name: 'FVR', body: 'TRUCK' }, { name: 'D-Max', body: 'PICKUP' }] },
  { name: 'Mercedes-Benz', models: [{ name: 'Sprinter', body: 'VAN' }, { name: 'Vito', body: 'VAN' }, { name: 'Actros', body: 'TRACTOR' }, { name: 'Atego', body: 'TRUCK' }, { name: 'Travego', body: 'BUS' }, { name: 'S-Class', body: 'SEDAN' }, { name: 'V-Class', body: 'VAN' }] },
  { name: 'Ford', models: [{ name: 'Transit', body: 'VAN' }, { name: 'F-150', body: 'PICKUP' }] },
  { name: 'Chevrolet', models: [{ name: 'Tahoe', body: 'SUV' }, { name: 'Suburban', body: 'SUV' }, { name: 'Silverado', body: 'PICKUP' }] },
  { name: 'GMC', models: [{ name: 'Yukon', body: 'SUV' }, { name: 'Sierra', body: 'PICKUP' }] },
  { name: 'Lexus', models: [{ name: 'LX', body: 'SUV' }, { name: 'ES', body: 'SEDAN' }] },
  { name: 'Volvo', models: [{ name: 'FH', body: 'TRACTOR' }, { name: 'FM', body: 'TRUCK' }, { name: '9700', body: 'BUS' }] },
  { name: 'MAN', models: [{ name: 'TGS', body: 'TRACTOR' }, { name: 'TGX', body: 'TRACTOR' }, { name: 'TGL', body: 'TRUCK' }, { name: 'Lion’s Coach', body: 'BUS' }] },
  { name: 'Scania', models: [{ name: 'R-series', body: 'TRACTOR' }, { name: 'P-series', body: 'TRUCK' }, { name: 'Touring', body: 'BUS' }] },
  { name: 'Hino', models: [{ name: '300', body: 'LIGHT_TRUCK' }, { name: '500', body: 'TRUCK' }, { name: '700', body: 'TRACTOR' }] },
  { name: 'Yutong', models: [{ name: 'ZK6122', body: 'BUS' }, { name: 'ZK6938', body: 'MINIBUS' }] },
  { name: 'King Long', models: [{ name: 'XMQ6127', body: 'BUS' }, { name: 'XMQ6900', body: 'MINIBUS' }] },
  { name: 'JAC', models: [{ name: 'Sunray', body: 'VAN' }, { name: 'N-Series', body: 'LIGHT_TRUCK' }] },
  { name: 'Foton', models: [{ name: 'View', body: 'VAN' }, { name: 'Aumark', body: 'LIGHT_TRUCK' }] },
  { name: 'Changan', models: [{ name: 'Star', body: 'VAN' }, { name: 'Hunter', body: 'PICKUP' }] },
];
