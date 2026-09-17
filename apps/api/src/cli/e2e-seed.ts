/**
 * Deterministic data for the golden-path E2E (Phase 15, docs/testing.md).
 *
 *   E2E_PASSWORD='…' pnpm --filter @unigate/api e2e:seed
 *
 * Ensures — idempotently, against the DATABASE_URL of the environment it runs in — a customer, a
 * vendor approved for passenger transport who serves Riyadh, and an APPROVED, dispatchable minibus
 * with verified documents, so the portal flow request → bid → accept → pay can run end to end
 * without an admin in the loop. The accounts are `e2e.*@unigate.local`; the password comes from
 * the environment only and is set on every run (so a rotated E2E secret never strands CI).
 * Refused in production: this is test data with a known credential.
 */
import '@/config/dotenv.js';
import { config } from '@/config/index.js';
import { hashPassword } from '@/common/crypto.js';
import { newId } from '@/common/ids.js';
import { disconnectPrisma, prisma } from '@/database/prisma.js';
import { disconnectRedis } from '@/database/redis.js';
import { initLogger } from '@/logging/logger.js';

export const E2E = {
  customer: 'e2e.customer@unigate.local',
  vendor: 'e2e.vendor@unigate.local',
  plate: '9001 E2E',
  pickupCityCode: 'RUH',
  categoryCode: 'MINIBUS',
} as const;

async function ensureUser(email: string, roleCode: string, fullNameEn: string, passwordHash: string): Promise<string> {
  const db = prisma();
  const role = await db.role.findUniqueOrThrow({ where: { code: roleCode }, select: { id: true } });
  const existing = await db.user.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: { passwordHash, status: 'ACTIVE', phoneVerifiedAt: new Date(), emailVerifiedAt: new Date() } });
    await db.userRole.upsert({ where: { userId_roleId: { userId: existing.id, roleId: role.id } }, create: { userId: existing.id, roleId: role.id }, update: {} });
    return existing.id;
  }
  const id = newId();
  const digits = String(Math.abs(hashCode(email)) % 1e8).padStart(8, '0');
  await db.user.create({
    data: {
      id, email, phoneE164: `+9665${digits}`, phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), passwordHash, passwordChangedAt: new Date(Date.now() - 5000),
      fullNameEn, status: 'ACTIVE', preferredLocale: 'en', userRoles: { create: [{ roleId: role.id }] },
    },
  });
  return id;
}

function hashCode(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

async function main(): Promise<number> {
  const cfg = config();
  initLogger({ level: 'warn', env: cfg.env, service: 'unigate-cli', version: cfg.version, pretty: cfg.isDevelopment });
  if (cfg.isProduction) {
    console.error('e2e-seed: refused in production');
    return 2;
  }
  const password = process.env['E2E_PASSWORD'];
  if (!password || password.length < 12) {
    console.error('e2e-seed: E2E_PASSWORD (≥ 12 chars) is required');
    return 2;
  }
  const db = prisma();
  const passwordHash = await hashPassword(password);

  // Customer (individual, prepaid).
  const customerUserId = await ensureUser(E2E.customer, 'CUSTOMER', 'E2E Customer', passwordHash);
  const customer = await db.customerProfile.upsert({ where: { userId: customerUserId }, create: { id: newId(), userId: customerUserId, customerType: 'INDIVIDUAL' }, update: {}, select: { id: true } });

  // Vendor: approved, passenger vertical approved, serves Riyadh.
  const vendorUserId = await ensureUser(E2E.vendor, 'VEHICLE_OWNER', 'E2E Vendor', passwordHash);
  const owner = await db.ownerProfile.upsert({
    where: { userId: vendorUserId },
    create: { id: newId(), userId: vendorUserId, ownerType: 'INDIVIDUAL', businessNameEn: 'E2E Transport', businessNameAr: 'إي تو إي للنقل', onboardingStatus: 'APPROVED', approvedAt: new Date() },
    update: { onboardingStatus: 'APPROVED', approvedAt: new Date() },
    select: { id: true },
  });
  await db.ownerVerticalApproval.upsert({
    where: { ownerProfileId_transportType: { ownerProfileId: owner.id, transportType: 'PASSENGER' } },
    create: { id: newId(), ownerProfileId: owner.id, transportType: 'PASSENGER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const city = await db.city.findFirstOrThrow({ where: { code: E2E.pickupCityCode }, select: { id: true } });
  await db.ownerServiceArea.upsert({ where: { ownerProfileId_cityId: { ownerProfileId: owner.id, cityId: city.id } }, create: { ownerProfileId: owner.id, cityId: city.id }, update: { isActive: true } });

  // Vehicle: approved minibus with every mandatory passenger document verified until 2032.
  const category = await db.vehicleCategory.findFirstOrThrow({ where: { code: E2E.categoryCode }, select: { id: true } });
  let vehicle = await db.vehicle.findFirst({ where: { plateNumberEn: E2E.plate, deletedAt: null }, select: { id: true } });
  if (!vehicle) {
    vehicle = await db.vehicle.create({
      data: { id: newId(), ownerProfileId: owner.id, vehicleCategoryId: category.id, modelYear: 2023, plateNumberEn: E2E.plate, registrationNumber: 'REG-E2E-0001', colorCode: 'WHITE', passengerCapacity: 20, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE', approvedAt: new Date(), baseCityId: city.id },
      select: { id: true },
    });
  } else {
    await db.vehicle.update({ where: { id: vehicle.id }, data: { ownerProfileId: owner.id, approvalStatus: 'APPROVED', lifecycleStatus: 'ACTIVE' } });
  }
  const types = await db.documentType.findMany({ where: { appliesTo: 'VEHICLE', isMandatory: true, isActive: true, OR: [{ transportType: null }, { transportType: 'PASSENGER' }] } });
  for (const t of types) {
    const has = await db.document.findFirst({ where: { vehicleId: vehicle.id, documentTypeCode: t.code, uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', deletedAt: null }, select: { id: true } });
    if (has) continue;
    await db.document.create({
      data: {
        id: newId(), documentTypeCode: t.code, vehicleId: vehicle.id, storageBucket: 'e2e', storageKey: `e2e/${vehicle.id}/${t.code}`, originalFilename: 'e2e.pdf', mimeType: 'application/pdf', sizeBytes: 10n, checksumSha256: 'e'.repeat(64),
        uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), expiryDate: t.requiresExpiry ? new Date('2032-01-01') : null,
      },
    });
  }
  // Free the vehicle of leftover reservations from earlier runs so the matcher always finds it.
  await db.vehicleCalendarEntry.updateMany({ where: { vehicleId: vehicle.id, status: { not: 'RELEASED' }, entryType: { not: 'OWNER_BLOCK' } }, data: { status: 'RELEASED' } });

  console.log(JSON.stringify({ customer: E2E.customer, customerProfileId: customer.id, vendor: E2E.vendor, ownerProfileId: owner.id, vehicleId: vehicle.id, plate: E2E.plate, pickupCity: E2E.pickupCityCode, category: E2E.categoryCode }));
  return 0;
}

main()
  .then(async (code) => {
    await disconnectPrisma();
    await disconnectRedis();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await disconnectPrisma().catch(() => undefined);
    process.exit(1);
  });
