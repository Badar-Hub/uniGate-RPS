import type { Prisma } from '@prisma/client';
import type { DocumentAppliesTo, DocumentDto, DocumentRequirementDto } from '@unigate/types';
import type { DocumentRow } from './documents.repository.js';

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** The FK column a target kind writes to. */
export function targetColumn(kind: DocumentAppliesTo): keyof Prisma.DocumentUncheckedCreateInput {
  switch (kind) {
    case 'USER':
      return 'userId';
    case 'OWNER':
      return 'ownerProfileId';
    case 'DRIVER':
      return 'driverProfileId';
    case 'VEHICLE':
      return 'vehicleId';
    case 'CORPORATE_CUSTOMER':
      return 'corporateCustomerProfileId';
    case 'EXPENSE':
      return 'expenseId';
    case 'MAINTENANCE_RECORD':
      return 'maintenanceRecordId';
    case 'TRIP_PROOF':
      return 'tripProofId';
  }
}

export function targetOf(d: DocumentRow): { kind: string; id: string } {
  if (d.userId) return { kind: 'USER', id: d.userId };
  if (d.ownerProfileId) return { kind: 'OWNER', id: d.ownerProfileId };
  if (d.driverProfileId) return { kind: 'DRIVER', id: d.driverProfileId };
  if (d.vehicleId) return { kind: 'VEHICLE', id: d.vehicleId };
  if (d.corporateCustomerProfileId) return { kind: 'CORPORATE_CUSTOMER', id: d.corporateCustomerProfileId };
  if (d.expenseId) return { kind: 'EXPENSE', id: d.expenseId };
  if (d.maintenanceRecordId) return { kind: 'MAINTENANCE_RECORD', id: d.maintenanceRecordId };
  if (d.tripProofId) return { kind: 'TRIP_PROOF', id: d.tripProofId };
  throw new Error(`document ${d.id} has no target`);
}

/** Metadata only — never the bucket, the storage key, or a URL (api.md §8.10). */
export function toDocumentDto(d: DocumentRow): DocumentDto {
  return {
    id: d.id,
    documentTypeCode: d.documentTypeCode,
    target: targetOf(d),
    originalFilename: d.originalFilename,
    mimeType: d.mimeType,
    sizeBytes: Number(d.sizeBytes),
    checksumSha256: d.checksumSha256,
    uploadStatus: d.uploadStatus,
    verificationStatus: d.verificationStatus,
    verifiedAt: iso(d.verifiedAt),
    rejectionReason: d.rejectionReason,
    issueDate: isoDate(d.issueDate),
    expiryDate: isoDate(d.expiryDate),
    visibility: d.visibility,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toRequirementDto(
  t: { code: string; nameEn: string; nameAr: string; isMandatory: boolean; requiresExpiry: boolean; transportType: string | null },
  current: DocumentRow | null,
): DocumentRequirementDto {
  let status: DocumentRequirementDto['status'] = 'MISSING';
  if (current) {
    if (current.verificationStatus === 'VERIFIED' && current.expiryDate && current.expiryDate < new Date()) status = 'EXPIRED';
    else status = current.verificationStatus;
  }
  return {
    documentTypeCode: t.code,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    isMandatory: t.isMandatory,
    requiresExpiry: t.requiresExpiry,
    transportType: t.transportType,
    status,
    documentId: current?.id ?? null,
    expiryDate: current ? isoDate(current.expiryDate) : null,
  };
}
