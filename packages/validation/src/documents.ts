import { z } from 'zod';
import { DOCUMENT_APPLIES_TO, DOCUMENT_VERIFICATION_STATUS, DOCUMENT_UPLOAD_STATUS, DOCUMENT_VISIBILITY } from '@unigate/types';
import { isoDate, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/** Documents module schemas (api.md §8.10). */

export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lower-case hex SHA-256');

/** A filename the client chose. Never becomes a storage key; sanitised again before it is echoed. */
const originalFilename = z
  .string()
  .min(1)
  .max(255)
  .transform((v) =>
    Array.from(v, (ch) => {
      // control characters, path separators and shell/URL-hostile punctuation become _
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f || '\\/:*?"<>|'.includes(ch) ? '_' : ch;
    })
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  .pipe(z.string().min(1));

export const documentTarget = z.object({ kind: z.enum(DOCUMENT_APPLIES_TO), id: uuid }).strict();
export type DocumentTarget = z.infer<typeof documentTarget>;

export const uploadUrlBody = z
  .object({
    documentTypeCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/),
    target: documentTarget,
    originalFilename,
    mimeType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/i).max(128),
    sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024 * 1024),
    checksumSha256: sha256Hex,
    issueDate: isoDate.optional(),
    expiryDate: isoDate.optional(),
    visibility: z.enum(DOCUMENT_VISIBILITY).default('PRIVATE'),
  })
  .strict()
  .refine((b) => !(b.issueDate && b.expiryDate) || b.issueDate <= b.expiryDate, { path: ['expiryDate'], message: 'expiryDate must not precede issueDate' });

export const confirmUploadBody = z.object({ checksumSha256: sha256Hex }).strict();

export const listDocumentsQuery = offsetPagination.extend({
  documentTypeCode: z.string().max(48).optional(),
  verificationStatus: z.enum(DOCUMENT_VERIFICATION_STATUS).optional(),
  uploadStatus: z.enum(DOCUMENT_UPLOAD_STATUS).optional(),
  vehicleId: uuid.optional(),
  driverProfileId: uuid.optional(),
  ownerProfileId: uuid.optional(),
  corporateCustomerProfileId: uuid.optional(),
  userId: uuid.optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const verifyDocumentBody = z.object({ issueDate: isoDate.optional(), expiryDate: isoDate.optional(), notes: safeText(500).optional() }).strict();
export const rejectDocumentBody = z.object({ rejectionReason: safeText(1000).pipe(z.string().min(5)) }).strict();
export const patchDocumentVisibilityBody = z.object({ visibility: z.enum(DOCUMENT_VISIBILITY) }).strict();

export const documentRequirementsQuery = z.object({ appliesTo: z.enum(DOCUMENT_APPLIES_TO), targetId: uuid, transportType: z.enum(['PASSENGER', 'GOODS']).optional() });
