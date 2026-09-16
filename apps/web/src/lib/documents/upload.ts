import type { DocumentDto, UploadUrlDto } from '@unigate/types';
import { api, idempotencyKey, type ApiResult } from '@/lib/api-client';
import { sha256Bytes } from './sha256';

/** SHA-256 of a File in the browser — the API verifies it against the stored object. WebCrypto when the page is a secure context, a pure-JS digest otherwise (plain HTTP on a LAN address). */
export async function sha256Hex(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `subtle` is undefined outside secure contexts despite the lib typing
  const digest = typeof crypto.subtle?.digest === 'function' ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)) : sha256Bytes(new Uint8Array(bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  let checksumSha256: string;
  try {
    checksumSha256 = await sha256Hex(input.file);
  } catch (e) {
    // A failed hash (unreadable file, exotic browser) must surface in the dialog, never hang it.
    return { ok: false, error: { status: 0, code: 'DOCUMENT_UPLOAD_INCOMPLETE', message: e instanceof Error ? e.message : 'hashing failed' } };
  }
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
