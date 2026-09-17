import * as Crypto from 'expo-crypto';
import { File, UploadType } from 'expo-file-system';
import { idempotencyKey, type ApiResult } from '@unigate/api-client';
import type { DocumentDto, UploadUrlDto } from '@unigate/types';
import { api } from '@/lib/api';
import { sha256HexChunked, toHex } from './sha256';

/**
 * The presigned two-step upload (api.md §8.10), the same flow as the web portal's
 * `lib/documents/upload.ts`: hash the bytes on the device → `POST /documents/upload-url` with
 * the declared type / size / MIME / checksum → `PUT` the bytes straight to the object store with
 * the headers the API returned → `POST /documents/{id}/confirm { checksumSha256 }` with an
 * Idempotency-Key. File bytes never pass through the API; the API verifies the size, the
 * checksum and the magic bytes before the row becomes UPLOADED and the malware scan is queued.
 */

/** A file chosen from the camera, the gallery or the document picker, on the device's disk. */
export interface PickedFile {
  /** `file://` URI. */
  uri: string;
  name: string;
  mimeType: string;
  /** Bytes on disk, when the picker knows; otherwise read from the file. */
  size: number | null;
}

export type UploadStage = 'hashing' | 'requesting' | 'uploading' | 'confirming';

export interface UploadProgress {
  stage: UploadStage;
  /** 0–1 within the stage when known (hashing and uploading report it), else null. */
  fraction: number | null;
}

export type DocumentVisibility = 'PRIVATE' | 'INTERNAL' | 'SHARED_WITH_COUNTERPARTY';

export interface UploadInput {
  documentTypeCode: string;
  target: { kind: string; id: string };
  file: PickedFile;
  issueDate?: string | undefined;
  expiryDate?: string | undefined;
  visibility?: DocumentVisibility | undefined;
  onProgress?: ((p: UploadProgress) => void) | undefined;
}

/**
 * SHA-256 hex over the file's bytes. `expo-crypto`'s native digest is used when available
 * (fast, byte-identical); the streaming JS hasher is the fallback and also drives the progress
 * callback, so a large PDF shows movement rather than a frozen sheet.
 */
export async function hashFile(file: File, onProgress?: (fraction: number) => void): Promise<{ hex: string; size: number }> {
  const bytes = await file.bytes();
  try {
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    onProgress?.(1);
    return { hex: toHex(new Uint8Array(digest)), size: bytes.byteLength };
  } catch {
    const hex = await sha256HexChunked(bytes, (done, total) => onProgress?.(total === 0 ? 1 : done / total));
    return { hex, size: bytes.byteLength };
  }
}

function fail(code: string, message: string, status = 0): ApiResult<DocumentDto> {
  return { ok: false, error: { status, code, message } };
}

export async function uploadDocument(input: UploadInput): Promise<ApiResult<DocumentDto>> {
  const report = (stage: UploadStage, fraction: number | null = null) => input.onProgress?.({ stage, fraction });

  report('hashing', 0);
  let checksumSha256: string;
  let sizeBytes: number;
  try {
    const file = new File(input.file.uri);
    const hashed = await hashFile(file, (f) => {
      report('hashing', f);
    });
    checksumSha256 = hashed.hex;
    sizeBytes = hashed.size;
  } catch (e) {
    // An unreadable file must surface in the sheet, never hang it.
    return fail('DOCUMENT_UPLOAD_INCOMPLETE', e instanceof Error ? e.message : 'hashing failed');
  }
  if (sizeBytes <= 0) return fail('DOCUMENT_UPLOAD_INCOMPLETE', 'empty file');

  report('requesting');
  const url = await api<UploadUrlDto>('/documents/upload-url', {
    method: 'POST',
    body: {
      documentTypeCode: input.documentTypeCode,
      target: input.target,
      originalFilename: input.file.name,
      mimeType: input.file.mimeType,
      sizeBytes,
      checksumSha256,
      ...(input.issueDate ? { issueDate: input.issueDate } : {}),
      ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}),
      visibility: input.visibility ?? 'PRIVATE',
    },
  });
  if (!url.ok) return url;

  report('uploading', 0);
  try {
    const result = await new File(input.file.uri).upload(url.data.upload.url, {
      httpMethod: url.data.upload.method,
      uploadType: UploadType.BINARY_CONTENT,
      headers: url.data.upload.headers,
      onProgress: ({ bytesSent, totalBytes }) => {
        report('uploading', totalBytes > 0 ? bytesSent / totalBytes : null);
      },
    });
    if (result.status < 200 || result.status >= 300)
      return fail('DOCUMENT_UPLOAD_INCOMPLETE', `store answered ${result.status}`, result.status);
  } catch (e) {
    return fail('NETWORK', e instanceof Error ? e.message : 'upload failed');
  }

  report('confirming');
  return api<DocumentDto>(`/documents/${url.data.documentId}/confirm`, {
    method: 'POST',
    body: { checksumSha256 },
    headers: { 'Idempotency-Key': idempotencyKey() },
  });
}
