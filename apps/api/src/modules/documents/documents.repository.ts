import type { Prisma } from '@prisma/client';
import type { AnyScope, DocumentAppliesTo } from '@unigate/types';
import { prisma } from '@/database/prisma.js';
import { targetColumn } from './documents.mapper.js';

/**
 * Documents (database.md §6.1). A document belongs to exactly one target through eight typed
 * nullable FKs (`ck_documents_single_owner`). Ownership for the scope layer is derived from
 * that target inside this file — never from the controller (security.md T-02).
 */

export const documentSelect = {
  id: true, documentTypeCode: true, userId: true, ownerProfileId: true, driverProfileId: true, vehicleId: true,
  corporateCustomerProfileId: true, expenseId: true, maintenanceRecordId: true, tripProofId: true, paymentId: true,
  storageBucket: true, storageKey: true, originalFilename: true, mimeType: true, sizeBytes: true, checksumSha256: true,
  uploadStatus: true, verificationStatus: true, verifiedByUserId: true, verifiedAt: true, rejectionReason: true,
  issueDate: true, expiryDate: true, visibility: true, createdAt: true, updatedAt: true, deletedAt: true,
  documentType: { select: { appliesTo: true, requiresExpiry: true, isMandatory: true, transportType: true } },
} satisfies Prisma.DocumentSelect;

export type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;

/** Every predicate under which the actor "owns" a document — OR-ed together. */
export function ownershipWhere(scope: AnyScope): Prisma.DocumentWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  const a = scope.actor;
  const or: Prisma.DocumentWhereInput[] = [{ userId: a.userId }];
  if (a.ownerProfileId) {
    or.push(
      { ownerProfileId: a.ownerProfileId },
      { driverProfile: { ownerProfileId: a.ownerProfileId } },
      { vehicle: { ownerProfileId: a.ownerProfileId } },
      { expense: { ownerProfileId: a.ownerProfileId } },
      { maintenanceRecord: { vehicle: { ownerProfileId: a.ownerProfileId } } },
    );
  }
  if (a.driverProfileId) or.push({ driverProfileId: a.driverProfileId }, { tripProof: { trip: { driverProfileId: a.driverProfileId } } });
  if (a.customerProfileId) or.push({ corporateCustomer: { customerProfileId: a.customerProfileId } }, { payment: { customerProfileId: a.customerProfileId } });
  return { OR: or };
}

/** Does the actor's scope cover this upload target? Same predicates as ownershipWhere, per kind. */
export async function targetInScope(scope: AnyScope, kind: DocumentAppliesTo, id: string): Promise<boolean> {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return targetExists(kind, id);
  const a = scope.actor;
  const db = prisma();
  switch (kind) {
    case 'USER':
      return id === a.userId;
    case 'OWNER':
      return id === a.ownerProfileId;
    case 'DRIVER':
      if (id === a.driverProfileId) return true;
      return a.ownerProfileId ? Boolean(await db.driverProfile.findFirst({ where: { id, ownerProfileId: a.ownerProfileId }, select: { id: true } })) : false;
    case 'VEHICLE':
      return a.ownerProfileId ? Boolean(await db.vehicle.findFirst({ where: { id, ownerProfileId: a.ownerProfileId }, select: { id: true } })) : false;
    case 'CORPORATE_CUSTOMER':
      return a.customerProfileId ? Boolean(await db.corporateCustomerProfile.findFirst({ where: { id, customerProfileId: a.customerProfileId }, select: { id: true } })) : false;
    case 'EXPENSE':
      return a.ownerProfileId ? Boolean(await db.expense.findFirst({ where: { id, ownerProfileId: a.ownerProfileId }, select: { id: true } })) : false;
    case 'MAINTENANCE_RECORD':
      return a.ownerProfileId ? Boolean(await db.maintenanceRecord.findFirst({ where: { id, vehicle: { ownerProfileId: a.ownerProfileId } }, select: { id: true } })) : false;
    case 'TRIP_PROOF':
      return a.driverProfileId ? Boolean(await db.tripProof.findFirst({ where: { id, trip: { driverProfileId: a.driverProfileId } }, select: { id: true } })) : false;
    case 'PAYMENT':
      // The payer attaches the bank-transfer receipt to their own payment.
      return a.customerProfileId ? Boolean(await db.payment.findFirst({ where: { id, customerProfileId: a.customerProfileId }, select: { id: true } })) : false;
  }
}

async function targetExists(kind: DocumentAppliesTo, id: string): Promise<boolean> {
  const db = prisma();
  const sel = { select: { id: true } } as const;
  switch (kind) {
    case 'USER':
      return Boolean(await db.user.findFirst({ where: { id, deletedAt: null }, ...sel }));
    case 'OWNER':
      return Boolean(await db.ownerProfile.findUnique({ where: { id }, ...sel }));
    case 'DRIVER':
      return Boolean(await db.driverProfile.findUnique({ where: { id }, ...sel }));
    case 'VEHICLE':
      return Boolean(await db.vehicle.findUnique({ where: { id }, ...sel }));
    case 'CORPORATE_CUSTOMER':
      return Boolean(await db.corporateCustomerProfile.findUnique({ where: { id }, ...sel }));
    case 'EXPENSE':
      return Boolean(await db.expense.findUnique({ where: { id }, ...sel }));
    case 'MAINTENANCE_RECORD':
      return Boolean(await db.maintenanceRecord.findUnique({ where: { id }, ...sel }));
    case 'TRIP_PROOF':
      return Boolean(await db.tripProof.findUnique({ where: { id }, ...sel }));
    case 'PAYMENT':
      return Boolean(await db.payment.findUnique({ where: { id }, ...sel }));
  }
}

export async function findDocument(scope: AnyScope, id: string): Promise<DocumentRow | null> {
  return prisma().document.findFirst({ where: { id, deletedAt: null, ...ownershipWhere(scope) }, select: documentSelect });
}

export interface DocumentFilters {
  documentTypeCode?: string | undefined;
  verificationStatus?: string | undefined;
  uploadStatus?: string | undefined;
  vehicleId?: string | undefined;
  driverProfileId?: string | undefined;
  ownerProfileId?: string | undefined;
  corporateCustomerProfileId?: string | undefined;
  userId?: string | undefined;
  expiringWithinDays?: number | undefined;
}

export async function listDocuments(scope: AnyScope, f: DocumentFilters, page: { page: number; pageSize: number }): Promise<{ items: DocumentRow[]; total: number }> {
  const where: Prisma.DocumentWhereInput = {
    deletedAt: null,
    ...ownershipWhere(scope),
    ...(f.documentTypeCode ? { documentTypeCode: f.documentTypeCode } : {}),
    ...(f.verificationStatus ? { verificationStatus: f.verificationStatus as DocumentRow['verificationStatus'] } : {}),
    ...(f.uploadStatus ? { uploadStatus: f.uploadStatus as DocumentRow['uploadStatus'] } : {}),
    ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
    ...(f.driverProfileId ? { driverProfileId: f.driverProfileId } : {}),
    ...(f.ownerProfileId ? { ownerProfileId: f.ownerProfileId } : {}),
    ...(f.corporateCustomerProfileId ? { corporateCustomerProfileId: f.corporateCustomerProfileId } : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.expiringWithinDays ? { expiryDate: { not: null, lte: new Date(Date.now() + f.expiringWithinDays * 86_400_000) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma().document.findMany({ where, select: documentSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().document.count({ where }),
  ]);
  return { items, total };
}

/** Live (non-deleted) documents of one target, newest first — the input to the requirements checklist. */
export async function listForTarget(scope: AnyScope, kind: DocumentAppliesTo, id: string): Promise<DocumentRow[]> {
  return prisma().document.findMany({ where: { [targetColumn(kind)]: id, deletedAt: null, ...ownershipWhere(scope) }, select: documentSelect, orderBy: { createdAt: 'desc' } });
}
