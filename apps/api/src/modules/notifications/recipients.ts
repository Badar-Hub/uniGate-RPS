import { prisma } from '@/database/prisma.js';

/**
 * Recipient and label resolution for event subscribers. Outbox payloads carry profile ids and
 * business numbers; this file turns them into user ids and bilingual labels. Reads are narrow
 * (an id → a user id, a code → a name) and never return a DTO to a caller.
 */

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export async function usersOfOwner(ownerProfileId: unknown): Promise<string[]> {
  const id = str(ownerProfileId);
  if (!id) return [];
  const o = await prisma().ownerProfile.findUnique({ where: { id }, select: { userId: true } });
  return o ? [o.userId] : [];
}

export async function usersOfCustomer(customerProfileId: unknown): Promise<string[]> {
  const id = str(customerProfileId);
  if (!id) return [];
  const c = await prisma().customerProfile.findUnique({ where: { id }, select: { userId: true } });
  return c ? [c.userId] : [];
}

export async function usersOfDriver(driverProfileId: unknown): Promise<string[]> {
  const id = str(driverProfileId);
  if (!id) return [];
  const d = await prisma().driverProfile.findUnique({ where: { id }, select: { userId: true } });
  return d ? [d.userId] : [];
}

export async function usersOfOwners(ownerProfileIds: unknown): Promise<string[]> {
  if (!Array.isArray(ownerProfileIds)) return [];
  const ids = ownerProfileIds.filter((x): x is string => typeof x === 'string');
  if (!ids.length) return [];
  const rows = await prisma().ownerProfile.findMany({ where: { id: { in: ids } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** The user behind a document target (USER / OWNER / DRIVER / VEHICLE → its owner). */
export async function usersOfDocumentTarget(target: unknown): Promise<string[]> {
  if (typeof target !== 'object' || target === null) return [];
  const t = target as { kind?: unknown; id?: unknown };
  const id = str(t.id);
  if (!id) return [];
  switch (t.kind) {
    case 'USER':
      return [id];
    case 'OWNER':
      return usersOfOwner(id);
    case 'DRIVER':
      return usersOfDriver(id);
    case 'VEHICLE': {
      const v = await prisma().vehicle.findUnique({ where: { id }, select: { ownerProfileId: true } });
      return v ? usersOfOwner(v.ownerProfileId) : [];
    }
    default:
      return [];
  }
}

export async function usersOfVehicleOwner(vehicleId: unknown): Promise<string[]> {
  const id = str(vehicleId);
  if (!id) return [];
  const v = await prisma().vehicle.findUnique({ where: { id }, select: { ownerProfileId: true } });
  return v ? usersOfOwner(v.ownerProfileId) : [];
}

export async function vehiclePlate(vehicleId: unknown): Promise<string> {
  const id = str(vehicleId);
  if (!id) return '';
  const v = await prisma().vehicle.findUnique({ where: { id }, select: { plateNumberEn: true } });
  return v?.plateNumberEn ?? '';
}

export async function documentTypeLabels(code: unknown): Promise<{ en: string; ar: string }> {
  const c = str(code);
  if (!c) return { en: '', ar: '' };
  const t = await prisma().documentType.findUnique({ where: { code: c }, select: { nameEn: true, nameAr: true } });
  return { en: t?.nameEn ?? c, ar: t?.nameAr ?? c };
}

export async function serviceTypeLabels(code: unknown): Promise<{ en: string; ar: string }> {
  const c = str(code);
  if (!c) return { en: '', ar: '' };
  const t = await prisma().maintenanceServiceType.findUnique({ where: { code: c }, select: { nameEn: true, nameAr: true } });
  return { en: t?.nameEn ?? c, ar: t?.nameAr ?? c };
}

export async function ownerBusinessName(ownerProfileId: unknown): Promise<string> {
  const id = str(ownerProfileId);
  if (!id) return '';
  const o = await prisma().ownerProfile.findUnique({ where: { id }, select: { businessNameEn: true, user: { select: { fullNameEn: true } } } });
  return o?.businessNameEn ?? o?.user.fullNameEn ?? '';
}

export async function tripRequestPickup(tripRequestId: unknown): Promise<string> {
  const id = str(tripRequestId);
  if (!id) return '';
  const r = await prisma().tripRequest.findUnique({ where: { id }, select: { pickupAt: true } });
  return r ? r.pickupAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
}

export async function bookingRequestNumber(tripRequestId: unknown): Promise<string> {
  const id = str(tripRequestId);
  if (!id) return '';
  const r = await prisma().tripRequest.findUnique({ where: { id }, select: { requestNumber: true } });
  return r?.requestNumber ?? '';
}
