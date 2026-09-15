import type { DocumentRequirementDto } from '@unigate/types';
import type { VehicleRow } from './vehicle.repository.js';

/**
 * The dispatchability predicate (database.md §7.1), implemented once and consumed by matching,
 * bidding and booking. Pure: the caller supplies the vehicle row, its document checklist and the
 * `documents.expired_document_blocks_dispatch` setting; nothing here touches the database.
 */
export interface Dispatchability {
  ok: boolean;
  reasons: string[];
}

export function dispatchability(v: VehicleRow, requirements: DocumentRequirementDto[], opts: { expiredDocumentBlocksDispatch: boolean; at?: Date }): Dispatchability {
  const at = opts.at ?? new Date();
  const reasons: string[] = [];
  if (v.approvalStatus !== 'APPROVED') reasons.push('VEHICLE_NOT_APPROVED');
  if (v.lifecycleStatus !== 'ACTIVE') reasons.push(`VEHICLE_${v.lifecycleStatus}`);
  if (v.ownerProfile.onboardingStatus !== 'APPROVED') reasons.push('OWNER_NOT_APPROVED');
  for (const r of requirements) {
    if (!r.isMandatory) continue;
    if (r.status === 'MISSING' || r.status === 'PENDING' || r.status === 'REJECTED') reasons.push(`DOCUMENT_${r.status}:${r.documentTypeCode}`);
    else if (r.status === 'EXPIRED' || (r.expiryDate && new Date(r.expiryDate) < at)) {
      if (opts.expiredDocumentBlocksDispatch) reasons.push(`DOCUMENT_EXPIRED:${r.documentTypeCode}`);
    }
  }
  const dated: [string, Date | null][] = [
    ['INSURANCE_EXPIRED', v.insuranceExpiryDate],
    ['REGISTRATION_EXPIRED', v.registrationExpiryDate],
    ['INSPECTION_EXPIRED', v.inspectionExpiryDate],
  ];
  for (const [code, d] of dated) if (d && d < at && opts.expiredDocumentBlocksDispatch) reasons.push(code);
  return { ok: reasons.length === 0, reasons };
}
