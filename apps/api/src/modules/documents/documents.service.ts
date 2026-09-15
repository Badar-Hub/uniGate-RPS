import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, DocumentAppliesTo, DocumentDto, DocumentRequirementDto, DownloadUrlDto, UploadUrlDto } from '@unigate/types';
import type { uploadUrlBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { config } from '@/config/index.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { scanProvider } from '@/integrations/scan/scan.provider.js';
import { storageProvider } from '@/integrations/storage/storage.provider.js';
import { logger } from '@/logging/logger.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { onVehicleDocumentsChanged } from '@/modules/fleet/vehicle.service.js';
import { onOwnerDocumentsChanged } from '@/modules/profiles/owner.service.js';
import { targetColumn, toDocumentDto, toRequirementDto, targetOf } from './documents.mapper.js';
import * as repo from './documents.repository.js';
import { SNIFF_LENGTH, detectMime, extensionFor, mimeMatches } from './mime.sniff.js';

/** Documents (api.md §8.10). Bytes go client ↔ object store; this service holds metadata and decisions. */

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 120;
const PENDING_SWEEP_AFTER_MS = 24 * 3_600_000;

function actorOf(scope: AnyScope): { actorUserId: string | null; actorType: 'USER' | 'SYSTEM'; actorRoles?: string[] } {
  return scope.kind === 'SYSTEM' ? { actorUserId: null, actorType: 'SYSTEM' } : { actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles] };
}

async function loadType(code: string) {
  const t = await prisma().documentType.findFirst({ where: { code, isActive: true } });
  if (!t) throw new BusinessRuleError('DOCUMENT_TYPE_NOT_ALLOWED', `Unknown or inactive document type ${code}`);
  return t;
}

/** Step 1 — validate, insert PENDING row with a server-generated key, presign the PUT. */
export async function requestUploadUrl(scope: ActorScope, body: z.infer<typeof uploadUrlBody>): Promise<UploadUrlDto> {
  const type = await loadType(body.documentTypeCode);
  if (type.appliesTo !== body.target.kind) {
    throw new BusinessRuleError('DOCUMENT_TYPE_NOT_ALLOWED', `${type.code} applies to ${type.appliesTo}, not ${body.target.kind}`, { appliesTo: type.appliesTo });
  }
  const mime = body.mimeType.toLowerCase();
  if (!type.allowedMimeTypes.map((m) => m.toLowerCase()).includes(mime)) {
    throw new BusinessRuleError('DOCUMENT_MIME_NOT_ALLOWED', 'MIME type is not accepted for this document type', { declared: mime, allowed: type.allowedMimeTypes });
  }
  if (BigInt(body.sizeBytes) > type.maxSizeBytes) {
    throw new BusinessRuleError('DOCUMENT_SIZE_EXCEEDED', 'File exceeds the size limit for this document type', { maxSizeBytes: Number(type.maxSizeBytes) });
  }
  if (type.requiresExpiry && !body.expiryDate) throw new BusinessRuleError('DOCUMENT_EXPIRY_REQUIRED', 'expiryDate is required for this document type');
  if (!(await repo.targetInScope(scope, body.target.kind, body.target.id))) throw new NotFoundError();

  const id = newId();
  const bucket = config().storage.bucket;
  // Server-generated: never derived from originalFilename (traversal, collisions, filename XSS).
  const key = `${body.target.kind.toLowerCase()}/${body.target.id}/${id}.${extensionFor(mime)}`;
  await prisma().document.create({
    data: {
      id,
      documentTypeCode: type.code,
      [targetColumn(body.target.kind)]: body.target.id,
      storageBucket: bucket,
      storageKey: key,
      originalFilename: body.originalFilename,
      mimeType: mime,
      sizeBytes: BigInt(body.sizeBytes),
      checksumSha256: body.checksumSha256,
      uploadStatus: 'PENDING',
      verificationStatus: 'PENDING',
      issueDate: body.issueDate ? new Date(body.issueDate) : null,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
      visibility: body.visibility,
    },
  });
  const upload = await storageProvider().getUploadUrl({ bucket, key, contentType: mime, contentLength: body.sizeBytes, ttlSeconds: UPLOAD_URL_TTL_SECONDS });
  return { documentId: id, uploadStatus: 'PENDING', upload: { method: 'PUT', url: upload.url, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() } };
}

/** Reads the whole object once: SHA-256 for integrity, first bytes for the MIME sniff. */
async function hashAndSniff(bucket: string, key: string): Promise<{ sha256: string; head: Buffer; bytes: number }> {
  const stream = await storageProvider().readStream(bucket, key);
  const hash = createHash('sha256');
  let head = Buffer.alloc(0);
  let bytes = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += b.length;
    hash.update(b);
    if (head.length < SNIFF_LENGTH) head = Buffer.concat([head, b]).subarray(0, SNIFF_LENGTH);
  }
  return { sha256: hash.digest('hex'), head, bytes };
}

/** Step 2 — the object must exist, match size + checksum, pass the magic-byte check and the scan. */
export async function confirmUpload(scope: ActorScope, id: string, declaredChecksum: string): Promise<DocumentDto> {
  const doc = await repo.findDocument(scope, id);
  if (!doc) throw new NotFoundError();
  if (doc.uploadStatus === 'UPLOADED') return toDocumentDto(doc);
  if (doc.uploadStatus === 'QUARANTINED') throw new BusinessRuleError('DOCUMENT_SCAN_QUARANTINED', 'This upload was quarantined by the malware scan');
  if (declaredChecksum !== doc.checksumSha256) throw new BusinessRuleError('DOCUMENT_CHECKSUM_MISMATCH', 'Checksum does not match the one declared at upload-url time');

  const storage = storageProvider();
  const head = await storage.head(doc.storageBucket, doc.storageKey);
  if (!head) throw new ConflictError('DOCUMENT_UPLOAD_INCOMPLETE', 'The object has not been uploaded yet');
  if (BigInt(head.sizeBytes) !== doc.sizeBytes) throw new BusinessRuleError('DOCUMENT_CHECKSUM_MISMATCH', 'Stored size differs from the declared size', { declaredSizeBytes: Number(doc.sizeBytes), storedSizeBytes: head.sizeBytes });

  const { sha256, head: first } = await hashAndSniff(doc.storageBucket, doc.storageKey);
  if (sha256 !== doc.checksumSha256) throw new BusinessRuleError('DOCUMENT_CHECKSUM_MISMATCH', 'Stored checksum differs from the declared checksum');
  const detected = detectMime(first);
  if (!mimeMatches(doc.mimeType, detected)) {
    throw new BusinessRuleError('DOCUMENT_MIME_NOT_ALLOWED', 'The file content does not match the declared MIME type', { declared: doc.mimeType, detected, allowed: doc.mimeType });
  }

  const verdict = await scanProvider().scan(doc.storageBucket, doc.storageKey);
  if (verdict.result === 'INFECTED') {
    await prisma().$transaction(async (tx) => {
      await tx.document.update({ where: { id }, data: { uploadStatus: 'QUARANTINED' } });
      await writeAudit({ ...actorOf(scope), action: 'document.quarantined', entityType: 'document', entityId: id, severity: 'SECURITY', afterValue: { signature: verdict.signature, documentTypeCode: doc.documentTypeCode } }, tx);
      await publishEvent('document', id, 'document.quarantined', { target: targetOf(doc), signature: verdict.signature }, tx);
    });
    throw new BusinessRuleError('DOCUMENT_SCAN_QUARANTINED', 'The malware scan rejected this file');
  }

  const updated = await prisma().$transaction(async (tx) => {
    const u = await tx.document.update({ where: { id }, data: { uploadStatus: 'UPLOADED' }, select: repo.documentSelect });
    await writeAudit({ ...actorOf(scope), action: 'document.uploaded', entityType: 'document', entityId: id, afterValue: { documentTypeCode: doc.documentTypeCode, target: targetOf(doc), scanned: verdict.result === 'CLEAN' } }, tx);
    await publishEvent('document', id, 'document.uploaded', { target: targetOf(doc), documentTypeCode: doc.documentTypeCode }, tx);
    return u;
  });
  // A vendor's profile enters the review queue by itself once every mandatory document is in (no separate "submit" click needed).
  const target = targetOf(doc);
  if (target.kind === 'OWNER') await onOwnerDocumentsChanged(target.id);
  else if (target.kind === 'USER') await onOwnerDocumentsChanged(null, target.id);
  else if (target.kind === 'VEHICLE') await onVehicleDocumentsChanged(target.id);
  return toDocumentDto(updated);
}

export async function getDocument(scope: AnyScope, id: string): Promise<DocumentDto> {
  const d = await repo.findDocument(scope, id);
  if (!d) throw new NotFoundError();
  return toDocumentDto(d);
}

export async function listDocuments(scope: AnyScope, filters: repo.DocumentFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listDocuments(scope, filters, page);
  return { items: items.map(toDocumentDto), total };
}

/**
 * Is the actor the counterparty on a live booking that links the document's subject
 * (api.md §8.10 download rule 2)? Owner/vehicle/driver documents shared with the customer of
 * a booking, and corporate documents shared with the owner side of one.
 */
async function isBookingCounterparty(scope: ActorScope, doc: repo.DocumentRow): Promise<boolean> {
  const a = scope.actor;
  const live: Prisma.BookingWhereInput = { status: { in: ['CONFIRMED', 'DRIVER_ASSIGNED', 'READY', 'IN_PROGRESS', 'COMPLETED'] } };
  const db = prisma();
  if (a.customerProfileId && (doc.ownerProfileId || doc.vehicleId || doc.driverProfileId)) {
    const hit = await db.booking.findFirst({
      where: {
        ...live,
        customerProfileId: a.customerProfileId,
        ...(doc.ownerProfileId ? { ownerProfileId: doc.ownerProfileId } : {}),
        ...(doc.vehicleId ? { vehicleId: doc.vehicleId } : {}),
        ...(doc.driverProfileId ? { driverProfileId: doc.driverProfileId } : {}),
      },
      select: { id: true },
    });
    return Boolean(hit);
  }
  if (a.ownerProfileId && doc.corporateCustomerProfileId) {
    const hit = await db.booking.findFirst({
      where: { ...live, ownerProfileId: a.ownerProfileId, customerProfile: { corporate: { id: doc.corporateCustomerProfileId } } },
      select: { id: true },
    });
    return Boolean(hit);
  }
  return false;
}

/** 120-second signed GET, minted after the scope check, audited on every issuance. */
export async function getDownloadUrl(scope: ActorScope, id: string, meta: { ipAddress: string | null }): Promise<DownloadUrlDto> {
  let doc = await repo.findDocument(scope, id);
  if (!doc && scope.actor.permissions.has('documents.download_any')) {
    doc = await repo.findDocument({ ...scope, kind: 'GLOBAL' }, id);
  }
  if (!doc) {
    const shared = await repo.findDocument({ ...scope, kind: 'GLOBAL' }, id);
    if (shared?.visibility === 'SHARED_WITH_COUNTERPARTY' && (await isBookingCounterparty(scope, shared))) doc = shared;
  }
  if (!doc) throw new NotFoundError();
  if (doc.uploadStatus === 'QUARANTINED') throw new BusinessRuleError('DOCUMENT_SCAN_QUARANTINED', 'This document was quarantined by the malware scan');
  if (doc.uploadStatus !== 'UPLOADED') throw new NotFoundError();

  const signed = await storageProvider().getDownloadUrl({ bucket: doc.storageBucket, key: doc.storageKey, filename: doc.originalFilename, contentType: doc.mimeType, ttlSeconds: DOWNLOAD_URL_TTL_SECONDS });
  // The URL itself is never written anywhere (security.md T-02).
  await writeAudit({ ...actorOf(scope), action: 'document.download_url_issued', entityType: 'document', entityId: id, severity: 'NOTICE', ipAddress: meta.ipAddress, afterValue: { documentTypeCode: doc.documentTypeCode, target: targetOf(doc), expiresAt: signed.expiresAt.toISOString() } });
  return { url: signed.url, expiresAt: signed.expiresAt.toISOString(), mimeType: doc.mimeType, originalFilename: doc.originalFilename, sizeBytes: Number(doc.sizeBytes) };
}

export async function verifyDocument(scope: ActorScope, id: string, body: { issueDate?: string | undefined; expiryDate?: string | undefined; notes?: string | undefined }): Promise<DocumentDto> {
  const doc = await repo.findDocument(scope, id);
  if (!doc) throw new NotFoundError();
  if (doc.uploadStatus !== 'UPLOADED') throw new ConflictError('DOCUMENT_UPLOAD_INCOMPLETE', 'Only an uploaded document can be verified');
  if (doc.verificationStatus === 'VERIFIED') throw new ConflictError('DOCUMENT_ALREADY_VERIFIED', 'Document is already verified');
  const expiry = body.expiryDate ? new Date(body.expiryDate) : doc.expiryDate;
  if (doc.documentType.requiresExpiry && !expiry) throw new BusinessRuleError('DOCUMENT_EXPIRY_REQUIRED', 'expiryDate is required for this document type');
  if (expiry && expiry < new Date()) throw new BusinessRuleError('DOCUMENT_EXPIRED', 'The document has already expired');
  const updated = await prisma().$transaction(async (tx) => {
    const u = await tx.document.update({
      where: { id },
      data: { verificationStatus: 'VERIFIED', verifiedByUserId: scope.actor.userId, verifiedAt: new Date(), rejectionReason: null, expiryDate: expiry, ...(body.issueDate ? { issueDate: new Date(body.issueDate) } : {}) },
      select: repo.documentSelect,
    });
    await writeAudit({ ...actorOf(scope), action: 'document.verified', entityType: 'document', entityId: id, severity: 'NOTICE', beforeValue: { verificationStatus: doc.verificationStatus }, afterValue: { verificationStatus: 'VERIFIED', expiryDate: expiry?.toISOString().slice(0, 10) ?? null, notes: body.notes ?? null } }, tx);
    await publishEvent('document', id, 'document.verified', { target: targetOf(doc), documentTypeCode: doc.documentTypeCode }, tx);
    return u;
  });
  return toDocumentDto(updated);
}

export async function rejectDocument(scope: ActorScope, id: string, rejectionReason: string): Promise<DocumentDto> {
  const doc = await repo.findDocument(scope, id);
  if (!doc) throw new NotFoundError();
  const updated = await prisma().$transaction(async (tx) => {
    const u = await tx.document.update({ where: { id }, data: { verificationStatus: 'REJECTED', rejectionReason, verifiedByUserId: scope.actor.userId, verifiedAt: new Date() }, select: repo.documentSelect });
    await writeAudit({ ...actorOf(scope), action: 'document.rejected', entityType: 'document', entityId: id, severity: 'NOTICE', beforeValue: { verificationStatus: doc.verificationStatus }, afterValue: { verificationStatus: 'REJECTED', rejectionReason } }, tx);
    await publishEvent('document', id, 'document.rejected', { target: targetOf(doc), documentTypeCode: doc.documentTypeCode, rejectionReason }, tx);
    return u;
  });
  return toDocumentDto(updated);
}

export async function setVisibility(scope: ActorScope, id: string, visibility: 'PRIVATE' | 'INTERNAL' | 'SHARED_WITH_COUNTERPARTY'): Promise<DocumentDto> {
  const doc = await repo.findDocument(scope, id);
  if (!doc) throw new NotFoundError();
  const u = await prisma().document.update({ where: { id }, data: { visibility }, select: repo.documentSelect });
  await writeAudit({ ...actorOf(scope), action: 'document.visibility_changed', entityType: 'document', entityId: id, beforeValue: { visibility: doc.visibility }, afterValue: { visibility } });
  return toDocumentDto(u);
}

/** Soft delete; refused when a VERIFIED approval decision references the document. */
export async function deleteDocument(scope: ActorScope, id: string): Promise<void> {
  const doc = await repo.findDocument(scope, id);
  if (!doc) throw new NotFoundError();
  const referenced = await prisma().ownerVerticalApproval.count({ where: { licenceDocumentId: id, status: 'APPROVED' } });
  if (referenced > 0) throw new ConflictError('CONFLICT', 'Document is referenced by an approval decision and cannot be deleted');
  await prisma().$transaction(async (tx) => {
    await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit({ ...actorOf(scope), action: 'document.deleted', entityType: 'document', entityId: id, beforeValue: { documentTypeCode: doc.documentTypeCode, target: targetOf(doc) } }, tx);
  });
}

/**
 * Checklist for a target: every active document type for its kind (filtered by vertical) with
 * the latest live document's status. The same computation gates submit-for-review.
 */
export async function requirementsFor(scope: AnyScope, kind: DocumentAppliesTo, targetId: string, transportType?: 'PASSENGER' | 'GOODS'): Promise<DocumentRequirementDto[]> {
  if (!(await repo.targetInScope(scope, kind, targetId))) throw new NotFoundError();
  const types = await prisma().documentType.findMany({
    where: { appliesTo: kind, isActive: true, ...(transportType ? { OR: [{ transportType: null }, { transportType }] } : {}) },
    orderBy: { sortOrder: 'asc' },
  });
  const docs = await repo.listForTarget(scope, kind, targetId);
  return types.map((t) => {
    const forType = docs.filter((d) => d.documentTypeCode === t.code && d.uploadStatus === 'UPLOADED');
    // Prefer a VERIFIED one, then the newest.
    const current = forType.find((d) => d.verificationStatus === 'VERIFIED') ?? forType[0] ?? null;
    return toRequirementDto(t, current);
  });
}

/** True when every mandatory type for the kind (and vertical) has a VERIFIED, unexpired document. */
/**
 * Mandatory-document check at a threshold: `VERIFIED` (approval — every document reviewed by staff)
 * or `UPLOADED` (the applicant has supplied everything and the profile may enter the review queue).
 */
export async function mandatoryDocumentsSatisfied(kind: DocumentAppliesTo, targetId: string, transportTypes: ('PASSENGER' | 'GOODS')[], threshold: 'VERIFIED' | 'UPLOADED' = 'VERIFIED'): Promise<{ ok: boolean; missing: string[] }> {
  const reqs = await requirementsFor({ kind: 'SYSTEM', jobName: 'documents.requirements', requestId: 'internal' }, kind, targetId);
  const relevant = reqs.filter((r) => r.isMandatory && (!r.transportType || transportTypes.includes(r.transportType as 'PASSENGER' | 'GOODS')));
  const satisfied = (status: string) => (threshold === 'VERIFIED' ? status === 'VERIFIED' : status === 'VERIFIED' || status === 'PENDING' || status === 'UPLOADED');
  const missing = relevant.filter((r) => !satisfied(r.status)).map((r) => r.documentTypeCode);
  return { ok: missing.length === 0, missing };
}

// ── jobs ─────────────────────────────────────────────────────────────────────

/** PENDING rows never confirmed within 24h: delete the orphan object (if any) and mark FAILED. */
export async function sweepPendingUploads(): Promise<number> {
  const stale = await prisma().document.findMany({ where: { uploadStatus: 'PENDING', deletedAt: null, createdAt: { lt: new Date(Date.now() - PENDING_SWEEP_AFTER_MS) } }, select: { id: true, storageBucket: true, storageKey: true }, take: 500 });
  const storage = storageProvider();
  for (const d of stale) {
    try {
      if (await storage.head(d.storageBucket, d.storageKey)) await storage.delete(d.storageBucket, d.storageKey);
      await prisma().document.update({ where: { id: d.id }, data: { uploadStatus: 'FAILED', deletedAt: new Date() } });
    } catch (err) {
      logger().warn({ err, documentId: d.id }, 'pending upload sweep failed for one document');
    }
  }
  return stale.length;
}

/** VERIFIED documents past their expiry date become EXPIRED (FR-DOCUMENTS-05). */
export async function markExpiredDocuments(): Promise<number> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const expired = await prisma().document.findMany({ where: { verificationStatus: 'VERIFIED', deletedAt: null, expiryDate: { lt: today } }, select: { id: true, documentTypeCode: true, userId: true, ownerProfileId: true, driverProfileId: true, vehicleId: true }, take: 1000 });
  for (const d of expired) {
    await prisma().$transaction(async (tx) => {
      await tx.document.update({ where: { id: d.id }, data: { verificationStatus: 'EXPIRED' } });
      await publishEvent('document', d.id, 'document.expired', { documentTypeCode: d.documentTypeCode, ownerProfileId: d.ownerProfileId, driverProfileId: d.driverProfileId, vehicleId: d.vehicleId, userId: d.userId }, tx);
    });
  }
  return expired.length;
}
