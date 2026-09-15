 
/**
 * Seed entrypoint — `pnpm db:seed`. Idempotent: every write is an upsert on a natural key.
 *
 *   all environments : permissions, roles, reference data, ledger accounts, system settings,
 *                      the platform-fleet owner, the NONE commission rule, NONE cancellation
 *                      policies, the NONE SPO commission model
 *   dev/staging      : one admin user — credentials from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD,
 *                      the seed ABORTS if they are unset (database.md §14.3). There is no
 *                      default password anywhere in the repository.
 *   dev only         : demo data (NODE_ENV !== 'production' && SEED_DEMO=true) — Phase 3+
 *
 * Production seeds reference data and permissions ONLY. The first production admin is created
 * by a one-off CLI (Phase 3) that forces a password change on first login.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { PERMISSIONS, ROLES } from './permissions.js';
import { NOTIFICATION_TEMPLATES } from './notification-templates.js';
import { CITIES, DOCUMENT_TYPES, EXPENSE_CATEGORIES, LEDGER_ACCOUNTS, MAINTENANCE_SERVICE_TYPES, REGIONS, VEHICLE_CATEGORIES, VEHICLE_MAKES } from './reference.js';
import { SETTINGS } from '../../src/modules/reference/settings.registry.js';

const prisma = new PrismaClient();
const nodeEnv = process.env['NODE_ENV'] ?? 'development';
const isProduction = nodeEnv === 'production';

async function seedPermissionsAndRoles(): Promise<void> {
  const permIds = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { code: p.code },
      create: { id: uuidv7(), code: p.code, module: p.module, descriptionEn: p.descriptionEn, descriptionAr: p.descriptionAr, isAssignable: p.isAssignable ?? true },
      update: { module: p.module, descriptionEn: p.descriptionEn, descriptionAr: p.descriptionAr, isAssignable: p.isAssignable ?? true },
    });
    permIds.set(p.code, row.id);
  }
  // Permissions removed from the catalogue are removed from the database (they are code constants).
  const removed = await prisma.permission.deleteMany({ where: { code: { notIn: PERMISSIONS.map((p) => p.code) } } });
  if (removed.count) console.log(`  removed ${removed.count} obsolete permission(s)`);

  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      create: { id: uuidv7(), code: r.code, nameEn: r.nameEn, nameAr: r.nameAr, description: r.description, isSystem: r.isSystem },
      update: { nameEn: r.nameEn, nameAr: r.nameAr, description: r.description, isSystem: r.isSystem },
    });
    const codes = r.permissions === 'ALL' ? [...permIds.keys()] : r.permissions;
    const unknown = codes.filter((c) => !permIds.has(c));
    if (unknown.length) throw new Error(`Role ${r.code} references unknown permissions: ${unknown.join(', ')}`);
    // System roles are reconciled to the catalogue; admin-created roles are never touched.
    if (r.isSystem) {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({ data: codes.map((c) => ({ roleId: role.id, permissionId: permIds.get(c) ?? '' })) });
    }
  }
  console.log(`✓ ${PERMISSIONS.length} permissions, ${ROLES.length} roles`);
}

async function seedReference(): Promise<Map<string, string>> {
  const regionIds = new Map<string, string>();
  for (const r of REGIONS) {
    const row = await prisma.region.upsert({ where: { code: r.code }, create: { id: uuidv7(), ...r }, update: { nameEn: r.nameEn, nameAr: r.nameAr } });
    regionIds.set(r.code, row.id);
  }
  const cityIds = new Map<string, string>();
  for (const c of CITIES) {
    const row = await prisma.city.upsert({
      where: { code: c.code },
      create: { id: uuidv7(), code: c.code, regionId: regionIds.get(c.region) ?? '', nameEn: c.nameEn, nameAr: c.nameAr, latitude: new Prisma.Decimal(c.lat), longitude: new Prisma.Decimal(c.lng) },
      update: { regionId: regionIds.get(c.region) ?? '', nameEn: c.nameEn, nameAr: c.nameAr, latitude: new Prisma.Decimal(c.lat), longitude: new Prisma.Decimal(c.lng) },
    });
    cityIds.set(c.code, row.id);
  }
  for (const v of VEHICLE_CATEGORIES) {
    const data = {
      nameEn: v.nameEn, nameAr: v.nameAr, transportType: v.t, sortOrder: v.sort,
      minPassengerCapacity: 'minP' in v ? v.minP : null, maxPassengerCapacity: 'maxP' in v ? v.maxP : null,
      minPayloadKg: 'minKg' in v ? new Prisma.Decimal(v.minKg) : null, maxPayloadKg: 'maxKg' in v ? new Prisma.Decimal(v.maxKg) : null,
      requiresSpecialLicense: 'special' in v ? v.special : false,
    };
    await prisma.vehicleCategory.upsert({ where: { code: v.code }, create: { id: uuidv7(), code: v.code, ...data }, update: data });
  }
  for (const d of DOCUMENT_TYPES) {
    const data = {
      nameEn: d.nameEn, nameAr: d.nameAr, appliesTo: d.a, transportType: 't' in d ? d.t : null, requiresExpiry: d.expiry, isMandatory: d.mandatory,
      allowedMimeTypes: [...d.mime], sortOrder: d.sort,
    };
    await prisma.documentType.upsert({ where: { code: d.code }, create: { code: d.code, ...data }, update: data });
  }
  for (const e of EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({ where: { code: e.code }, create: { id: uuidv7(), code: e.code, nameEn: e.nameEn, nameAr: e.nameAr, sortOrder: e.sort }, update: { nameEn: e.nameEn, nameAr: e.nameAr, sortOrder: e.sort } });
  }
  for (const m of MAINTENANCE_SERVICE_TYPES) {
    await prisma.maintenanceServiceType.upsert({ where: { code: m.code }, create: { id: uuidv7(), code: m.code, nameEn: m.nameEn, nameAr: m.nameAr, sortOrder: m.sort }, update: { nameEn: m.nameEn, nameAr: m.nameAr, sortOrder: m.sort } });
  }
  let models = 0;
  for (const mk of VEHICLE_MAKES) {
    const make = await prisma.vehicleMake.upsert({ where: { name: mk.name }, create: { id: uuidv7(), name: mk.name }, update: {} });
    for (const md of mk.models) {
      await prisma.vehicleModel.upsert({ where: { makeId_name: { makeId: make.id, name: md.name } }, create: { id: uuidv7(), makeId: make.id, name: md.name, bodyType: md.body ?? null }, update: { bodyType: md.body ?? null } });
      models++;
    }
  }
  // Notification templates: create missing rows; refresh rows never edited through the API (version 1).
  let templates = 0;
  for (const t of NOTIFICATION_TEMPLATES) {
    for (const channel of t.channels) {
      for (const locale of ['en', 'ar'] as const) {
        const copy = t[locale];
        const data = { subject: copy.title, body: copy.body, variables: t.variables, category: t.category };
        const existing = await prisma.notificationTemplate.findUnique({ where: { code_channel_locale: { code: t.code, channel, locale } }, select: { id: true, version: true } });
        if (!existing) await prisma.notificationTemplate.create({ data: { id: uuidv7(), code: t.code, channel, locale, ...data } });
        else if (existing.version === 1) await prisma.notificationTemplate.update({ where: { id: existing.id }, data });
        templates++;
      }
    }
  }
  for (const l of LEDGER_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({ where: { code: l.code }, create: { id: uuidv7(), code: l.code, nameEn: l.nameEn, nameAr: l.nameAr, type: l.type }, update: { nameEn: l.nameEn, nameAr: l.nameAr, type: l.type } });
  }
  console.log(`✓ ${REGIONS.length} regions, ${CITIES.length} cities, ${VEHICLE_CATEGORIES.length} vehicle categories, ${DOCUMENT_TYPES.length} document types, ${EXPENSE_CATEGORIES.length} expense categories, ${MAINTENANCE_SERVICE_TYPES.length} maintenance types, ${VEHICLE_MAKES.length} makes / ${models} models, ${LEDGER_ACCOUNTS.length} ledger accounts, ${templates} notification templates`);
  return cityIds;
}

async function seedSettings(): Promise<void> {
  // Insert missing keys with their seed; NEVER overwrite an existing value (admins own them).
  // Descriptions, type and scope are code-owned and are refreshed.
  let inserted = 0;
  for (const s of SETTINGS) {
    const seedValue = s.seed === null ? Prisma.JsonNull : (s.seed as Prisma.InputJsonValue);
    const existing = await prisma.systemSetting.findUnique({ where: { key: s.key } });
    if (existing) {
      await prisma.systemSetting.update({
        where: { key: s.key },
        data: { section: s.section, valueType: s.valueType, scope: s.scope, descriptionEn: s.descriptionEn, descriptionAr: s.descriptionAr, isCodeManaged: s.codeManaged ?? false },
      });
    } else {
      await prisma.systemSetting.create({
        data: { key: s.key, section: s.section, value: seedValue, valueType: s.valueType, scope: s.scope, descriptionEn: s.descriptionEn, descriptionAr: s.descriptionAr, isCodeManaged: s.codeManaged ?? false },
      });
      inserted++;
    }
  }
  console.log(`✓ ${SETTINGS.length} settings (${inserted} inserted, existing values untouched)`);
}

async function seedBusinessDefaults(): Promise<void> {
  // The NONE global commission rule — the platform charges nothing until an admin decides (OQ-01).
  const globalRule = await prisma.commissionRule.findFirst({ where: { scope: 'GLOBAL', isActive: true, effectiveTo: null } });
  if (!globalRule) {
    await prisma.commissionRule.create({
      data: { id: uuidv7(), name: 'Default — no commission (set by admin)', scope: 'GLOBAL', calculationType: 'NONE', basis: 'NET_OF_VAT', priority: 0, effectiveFrom: new Date('2026-01-01T00:00:00Z'), isActive: true },
    });
  }
  // NONE cancellation/no-show policies for every (event, role) pair (OQ-05).
  for (const eventType of ['CANCELLATION', 'NO_SHOW'] as const) {
    for (const role of ['CUSTOMER', 'OWNER'] as const) {
      const exists = await prisma.cancellationPolicy.findFirst({ where: { scope: 'GLOBAL', eventType, cancelledByRole: role, isActive: true, effectiveTo: null } });
      if (!exists) {
        await prisma.cancellationPolicy.create({
          data: { id: uuidv7(), name: `Default — no charge (${eventType.toLowerCase()} by ${role.toLowerCase()})`, eventType, cancelledByRole: role, scope: 'GLOBAL', chargeType: 'NONE', priority: 0, effectiveFrom: new Date('2026-01-01T00:00:00Z'), isActive: true },
        });
      }
    }
  }
  // NONE SPO commission model, set as default and referenced from the setting (OQ-09).
  let spoModel = await prisma.spoCommissionModel.findFirst({ where: { isDefault: true } });
  spoModel ??= await prisma.spoCommissionModel.create({
    data: { id: uuidv7(), name: 'Default — no SPO commission (set by admin)', basis: 'NONE', calculationType: 'NONE', isDefault: true, isActive: true },
  });
  const spoSetting = await prisma.systemSetting.findUnique({ where: { key: 'spo.default_commission_model_id' } });
  if (spoSetting?.value === null) {
    await prisma.systemSetting.update({ where: { key: 'spo.default_commission_model_id' }, data: { value: spoModel.id } });
  }
  // The platform-fleet owner: UniGate's own vehicles (A-57). Backed by a system user with no login.
  const fleet = await prisma.ownerProfile.findFirst({ where: { isPlatformFleet: true } });
  if (!fleet) {
    const userId = uuidv7();
    await prisma.user.create({
      data: { id: userId, email: 'fleet@unigate.internal', fullNameEn: 'UniGate Fleet', fullNameAr: 'أسطول يونيجيت', status: 'ACTIVE', preferredLocale: 'ar' },
    });
    await prisma.ownerProfile.create({
      data: { id: uuidv7(), userId, ownerType: 'PLATFORM', isPlatformFleet: true, businessNameEn: 'UniGate', businessNameAr: 'يونيجيت', onboardingStatus: 'APPROVED', approvedAt: new Date() },
    });
  }
  console.log('✓ business defaults: NONE commission rule, NONE cancellation policies, NONE SPO model, platform-fleet owner');
}

async function seedAdmin(): Promise<void> {
  if (isProduction) {
    console.log('• production: no admin account seeded (create with the one-off CLI)');
    return;
  }
  const email = process.env['SEED_ADMIN_EMAIL'];
  const password = process.env['SEED_ADMIN_PASSWORD'];
  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set for a non-production seed (no default credentials exist).');
  }
  if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const superAdmin = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
  const existing = await prisma.user.findFirst({ where: { email } });
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, passwordChangedAt: new Date(), status: 'ACTIVE' } })
    : await prisma.user.create({
        data: { id: uuidv7(), email, emailVerifiedAt: new Date(), passwordHash, passwordChangedAt: new Date(), fullNameEn: 'Platform Administrator', fullNameAr: 'مدير المنصة', status: 'ACTIVE', preferredLocale: 'en' },
      });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: superAdmin.id } }, create: { userId: user.id, roleId: superAdmin.id }, update: {} });
  console.log(`✓ admin ${email} (SUPER_ADMIN)`);
}

async function main(): Promise<void> {
  console.log(`Seeding (${nodeEnv})…`);
  await seedPermissionsAndRoles();
  await seedReference();
  await seedSettings();
  await seedBusinessDefaults();
  await seedAdmin();
  console.log('Done.');
}

main()
  .catch((e: unknown) => {
    console.error('Seed failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
