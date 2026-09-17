import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { PickedFile } from './upload';

/**
 * Picking a document on the phone: the camera or the gallery for a photo of the paper, the
 * system file picker for a PDF. Photos are re-encoded as JPEG and shrunk until they fit the
 * 2 MB budget (a phone camera easily produces 5–10 MB, which the document types refuse), PDFs
 * are taken as they are — the API enforces `maxSizeBytes` again.
 */

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type PickSource = 'camera' | 'gallery' | 'file';

export type PickOutcome =
  | { ok: true; file: PickedFile }
  | { ok: false; reason: 'cancelled' | 'permission' | 'failed' | 'too_large'; message?: string | undefined };

/** Width / quality ladder tried in order until the JPEG fits the budget. */
export const COMPRESSION_STEPS: readonly { width: number; quality: number }[] = [
  { width: 2048, quality: 0.85 },
  { width: 1600, quality: 0.8 },
  { width: 1280, quality: 0.75 },
  { width: 1024, quality: 0.7 },
  { width: 800, quality: 0.6 },
];

function sizeOf(uri: string): number | null {
  try {
    const f = new File(uri);
    return f.exists ? f.size : null;
  } catch {
    return null;
  }
}

/** Re-encodes an image as JPEG within `maxBytes`; returns the last attempt if none fits (the API decides). */
export async function compressImage(uri: string, maxBytes: number = MAX_IMAGE_BYTES): Promise<{ uri: string; size: number | null }> {
  const original = sizeOf(uri);
  if (original !== null && original <= maxBytes && /\.jpe?g$/i.test(uri)) return { uri, size: original };
  let last: { uri: string; size: number | null } = { uri, size: original };
  for (const step of COMPRESSION_STEPS) {
    const image = await ImageManipulator.manipulate(uri).resize({ width: step.width }).renderAsync();
    const saved = await image.saveAsync({ compress: step.quality, format: SaveFormat.JPEG });
    image.release();
    last = { uri: saved.uri, size: sizeOf(saved.uri) };
    if (last.size !== null && last.size <= maxBytes) return last;
  }
  return last;
}

function fileName(uri: string, fallback: string): string {
  const tail = uri.split('/').pop() ?? '';
  return tail.length > 0 && tail.includes('.') ? tail : fallback;
}

async function fromImageAsset(asset: ImagePicker.ImagePickerAsset, maxBytes: number): Promise<PickOutcome> {
  const compressed = await compressImage(asset.uri, maxBytes);
  if (compressed.size !== null && compressed.size > maxBytes) return { ok: false, reason: 'too_large' };
  return {
    ok: true,
    file: {
      uri: compressed.uri,
      name: fileName(compressed.uri, asset.fileName ?? `photo-${Date.now()}.jpg`).replace(/\.[^.]+$/, '.jpg'),
      mimeType: 'image/jpeg',
      size: compressed.size,
    },
  };
}

/**
 * Opens the chosen source. `allowedMimeTypes` (from the document type) narrows the file picker;
 * camera / gallery always produce a JPEG. Permission refusals and cancellations are outcomes, not throws.
 */
export async function pickDocumentFile(source: PickSource, allowedMimeTypes: readonly string[] = [], maxImageBytes: number = MAX_IMAGE_BYTES): Promise<PickOutcome> {
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'permission' };
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
      const asset = res.assets?.[0];
      if (res.canceled || !asset) return { ok: false, reason: 'cancelled' };
      return await fromImageAsset(asset, maxImageBytes);
    }
    if (source === 'gallery') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'permission' };
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      const asset = res.assets?.[0];
      if (res.canceled || !asset) return { ok: false, reason: 'cancelled' };
      return await fromImageAsset(asset, maxImageBytes);
    }
    const res = await DocumentPicker.getDocumentAsync({
      type: allowedMimeTypes.length ? [...allowedMimeTypes] : ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    const asset = res.assets?.[0];
    if (res.canceled || !asset) return { ok: false, reason: 'cancelled' };
    const mime = asset.mimeType ?? (asset.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    if (mime.startsWith('image/')) {
      const compressed = await compressImage(asset.uri, maxImageBytes);
      return { ok: true, file: { uri: compressed.uri, name: asset.name.replace(/\.[^.]+$/, '.jpg'), mimeType: 'image/jpeg', size: compressed.size } };
    }
    return { ok: true, file: { uri: asset.uri, name: asset.name, mimeType: mime, size: asset.size ?? sizeOf(asset.uri) } };
  } catch (e) {
    return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : undefined };
  }
}

/** `1234567` → `1.2 MB`, for the file line on the upload sheet. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
