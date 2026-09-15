/**
 * Magic-byte detection for the MIME types the platform accepts (seed `document_types`).
 * The client's declared type and the object store's Content-Type are both advisory; the
 * first bytes of the object decide (api.md §8.10, FR-DOCUMENTS-02).
 */
export const SNIFF_LENGTH = 32;

const PDF = Buffer.from('%PDF-');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF = Buffer.from('RIFF');
const WEBP = Buffer.from('WEBP');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function detectMime(head: Buffer): string | null {
  if (head.subarray(0, PDF.length).equals(PDF)) return 'application/pdf';
  if (head.subarray(0, PNG.length).equals(PNG)) return 'image/png';
  if (head.subarray(0, JPEG.length).equals(JPEG)) return 'image/jpeg';
  if (head.subarray(0, 4).equals(RIFF) && head.subarray(8, 12).equals(WEBP)) return 'image/webp';
  const text = (head.subarray(0, BOM.length).equals(BOM) ? head.subarray(BOM.length) : head).toString('utf8').trimStart();
  if (text.startsWith('<?xml') || /^<[A-Za-z]/.test(text)) return 'application/xml';
  return null;
}

/** `text/xml` and `application/xml` are the same bytes; everything else must match exactly. */
export function mimeMatches(declared: string, detected: string | null): boolean {
  if (!detected) return false;
  const norm = (m: string) => (m.toLowerCase() === 'text/xml' ? 'application/xml' : m.toLowerCase());
  return norm(declared) === norm(detected);
}

export function extensionFor(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'application/xml':
    case 'text/xml':
      return 'xml';
    default:
      return 'bin';
  }
}
