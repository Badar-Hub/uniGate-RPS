/** OpenAPI registrations for /documents (api.md §8.10). */
import { z } from 'zod';
import { confirmUploadBody, documentRequirementsQuery, idParams, listDocumentsQuery, patchDocumentVisibilityBody, rejectDocumentBody, uploadUrlBody, verifyDocumentBody } from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const bearer = [{ bearerAuth: [] }];

export const documentSchema = z
  .object({
    id: z.string().uuid(),
    documentTypeCode: z.string(),
    target: z.object({ kind: z.string(), id: z.string().uuid() }),
    originalFilename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    checksumSha256: z.string(),
    uploadStatus: z.enum(['PENDING', 'UPLOADED', 'FAILED', 'QUARANTINED']),
    verificationStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']),
    verifiedAt: z.string().datetime().nullable(),
    rejectionReason: z.string().nullable(),
    issueDate: z.string().nullable(),
    expiryDate: z.string().nullable(),
    visibility: z.enum(['PRIVATE', 'INTERNAL', 'SHARED_WITH_COUNTERPARTY']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Document', { description: 'Metadata only — never the storage key or a URL.' });

const uploadUrl = z
  .object({
    documentId: z.string().uuid(),
    uploadStatus: z.literal('PENDING'),
    upload: z.object({ method: z.literal('PUT'), url: z.string().url(), headers: z.record(z.string()), expiresAt: z.string().datetime() }),
  })
  .openapi('UploadUrl');
const downloadUrl = z.object({ url: z.string().url(), expiresAt: z.string().datetime(), mimeType: z.string(), originalFilename: z.string(), sizeBytes: z.number().int() }).openapi('DownloadUrl');
const requirement = z
  .object({
    documentTypeCode: z.string(), nameEn: z.string(), nameAr: z.string(), isMandatory: z.boolean(), requiresExpiry: z.boolean(), transportType: z.string().nullable(),
    status: z.enum(['MISSING', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']), documentId: z.string().uuid().nullable(), expiryDate: z.string().nullable(),
  })
  .openapi('DocumentRequirement');

registry.registerPath({
  method: 'post', path: '/documents/upload-url', tags: ['documents'], summary: 'Step 1 — validate and presign a 15-minute PUT (server-generated key)', security: bearer,
  request: { body: { content: { 'application/json': { schema: uploadUrlBody } } } },
  responses: { 201: ok(uploadUrl, 'UploadUrlEnvelope', 'Created'), 404: err('target out of scope'), 422: err('DOCUMENT_TYPE_NOT_ALLOWED / DOCUMENT_MIME_NOT_ALLOWED / DOCUMENT_SIZE_EXCEEDED / DOCUMENT_EXPIRY_REQUIRED') },
});
registry.registerPath({
  method: 'post', path: '/documents/{id}/confirm', tags: ['documents'], summary: 'Step 2 — object exists, size + SHA-256 + magic bytes match, malware scan (Idempotency-Key required)', security: bearer,
  request: { params: idParams, headers: z.object({ 'idempotency-key': z.string().uuid() }), body: { content: { 'application/json': { schema: confirmUploadBody } } } },
  responses: { 200: ok(documentSchema, 'DocumentEnvelope'), 409: err('DOCUMENT_UPLOAD_INCOMPLETE'), 422: err('DOCUMENT_CHECKSUM_MISMATCH / DOCUMENT_MIME_NOT_ALLOWED (details.declared, details.detected) / DOCUMENT_SCAN_QUARANTINED') },
});
registry.registerPath({
  method: 'get', path: '/documents', tags: ['documents'], summary: 'List (own → global with documents.read_any)', security: bearer,
  request: { query: listDocumentsQuery },
  responses: { 200: ok(z.array(documentSchema), 'DocumentListEnvelope', 'OK — paginated') },
});
registry.registerPath({
  method: 'get', path: '/documents/requirements', tags: ['documents'], summary: 'Checklist for a target: every document type with its current status', security: bearer,
  request: { query: documentRequirementsQuery },
  responses: { 200: ok(z.array(requirement), 'DocumentRequirementListEnvelope'), 404: err('target out of scope') },
});
registry.registerPath({ method: 'get', path: '/documents/{id}', tags: ['documents'], summary: 'Metadata', security: bearer, request: { params: idParams }, responses: { 200: ok(documentSchema, 'DocumentEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({
  method: 'get', path: '/documents/{id}/download-url', tags: ['documents'], summary: '120-second signed GET (attachment); every issuance audited', security: bearer,
  request: { params: idParams },
  responses: { 200: ok(downloadUrl, 'DownloadUrlEnvelope'), 404: err('NOT_FOUND (also for out-of-scope and not-yet-uploaded)'), 422: err('DOCUMENT_SCAN_QUARANTINED') },
});
registry.registerPath({
  method: 'post', path: '/documents/{id}/verify', tags: ['documents'], summary: 'PENDING → VERIFIED (documents.verify)', security: bearer,
  request: { params: idParams, body: { content: { 'application/json': { schema: verifyDocumentBody } } } },
  responses: { 200: ok(documentSchema, 'DocumentEnvelope'), 409: err('DOCUMENT_ALREADY_VERIFIED / DOCUMENT_UPLOAD_INCOMPLETE'), 422: err('DOCUMENT_EXPIRY_REQUIRED / DOCUMENT_EXPIRED') },
});
registry.registerPath({
  method: 'post', path: '/documents/{id}/reject', tags: ['documents'], summary: '→ REJECTED with a reason (documents.verify)', security: bearer,
  request: { params: idParams, body: { content: { 'application/json': { schema: rejectDocumentBody } } } },
  responses: { 200: ok(documentSchema, 'DocumentEnvelope'), 404: err('NOT_FOUND') },
});
registry.registerPath({
  method: 'patch', path: '/documents/{id}/visibility', tags: ['documents'], summary: 'PRIVATE / INTERNAL / SHARED_WITH_COUNTERPARTY', security: bearer,
  request: { params: idParams, body: { content: { 'application/json': { schema: patchDocumentVisibilityBody } } } },
  responses: { 200: ok(documentSchema, 'DocumentEnvelope'), 404: err('NOT_FOUND') },
});
registry.registerPath({
  method: 'delete', path: '/documents/{id}', tags: ['documents'], summary: 'Soft delete (documents.delete); refused when an approval decision references it', security: bearer,
  request: { params: idParams },
  responses: { 204: { description: 'Deleted' }, 404: err('NOT_FOUND'), 409: err('CONFLICT') },
});
