import type { DocumentDto, UploadUrlDto } from '@unigate/types';
import { api, idempotencyKey, type ApiResult } from '@/lib/api-client';

/** SHA-256 of a File in the browser — the API verifies it against the stored object. */
export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The presigned two-step (api.md §8.10): upload-url → PUT straight to the object store →
 * confirm with Idempotency-Key. File bytes never pass through the API.
 */
export async function uploadDocument(input: {
  documentTypeCode: string;
  target: { kind: string; id: string };
  file: File;
  issueDate?: string;
  expiryDate?: string;
  visibility?: 'PRIVATE' | 'INTERNAL' | 'SHARED_WITH_COUNTERPARTY';
  onProgress?: (stage: 'hashing' | 'requesting' | 'uploading' | 'confirming') => void;
}): Promise<ApiResult<DocumentDto>> {
  input.onProgress?.('hashing');
  const checksumSha256 = await sha256Hex(input.file);
  input.onProgress?.('requesting');
  const url = await api<UploadUrlDto>('/documents/upload-url', {
    method: 'POST',
    body: {
      documentTypeCode: input.documentTypeCode,
      target: input.target,
      originalFilename: input.file.name,
      mimeType: input.file.type,
      sizeBytes: input.file.size,
      checksumSha256,
      ...(input.issueDate ? { issueDate: input.issueDate } : {}),
      ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}),
      visibility: input.visibility ?? 'PRIVATE',
    },
  });
  if (!url.ok) return url;
  input.onProgress?.('uploading');
  try {
    const put = await fetch(url.data.upload.url, { method: 'PUT', headers: url.data.upload.headers, body: input.file });
    if (!put.ok) return { ok: false, error: { status: put.status, code: 'DOCUMENT_UPLOAD_INCOMPLETE', message: `store answered ${put.status}` } };
  } catch {
    return { ok: false, error: { status: 0, code: 'NETWORK', message: 'upload failed' } };
  }
  input.onProgress?.('confirming');
  return api<DocumentDto>(`/documents/${url.data.documentId}/confirm`, { method: 'POST', body: { checksumSha256 }, headers: { 'Idempotency-Key': idempotencyKey() } });
}
