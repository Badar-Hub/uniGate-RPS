import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '@/config/index.js';
import { logger } from '@/logging/logger.js';

/**
 * StorageProvider (architecture.md §8). File bytes never pass through the API: uploads are a
 * presigned PUT, downloads a presigned GET. MinIO in development, any S3-compatible store in
 * production — same adapter, different endpoint. No SDK type crosses this boundary.
 */
export interface StorageObjectHead {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
}

export interface StorageProvider {
  readonly code: string;
  /** Presigned PUT bound to the exact content type and length; valid `ttlSeconds`. */
  getUploadUrl(input: { bucket: string; key: string; contentType: string; contentLength: number; ttlSeconds: number }): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }>;
  /** Presigned GET forcing `Content-Disposition: attachment` with a sanitised filename. */
  getDownloadUrl(input: { bucket: string; key: string; filename: string; contentType: string; ttlSeconds: number }): Promise<{ url: string; expiresAt: Date }>;
  /** `null` when the object does not exist. */
  head(bucket: string, key: string): Promise<StorageObjectHead | null>;
  /** First `length` bytes of the object — enough for a magic-byte sniff, never the whole file. */
  readPrefix(bucket: string, key: string, length: number): Promise<Buffer>;
  /** Full object as a Node stream — used only by the malware scanner, never by a request handler. */
  readStream(bucket: string, key: string): Promise<NodeJS.ReadableStream>;
  delete(bucket: string, key: string): Promise<void>;
  /** Server-side write (report exports). Request handlers never stream user uploads through here. */
  put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
}

/** RFC 6266 filename*: keep it ASCII-safe; the original name is still shown by the client. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export class S3StorageProvider implements StorageProvider {
  readonly code = 's3';
  private readonly client: S3Client;

  constructor() {
    const s = config().storage;
    this.client = new S3Client({
      endpoint: s.endpoint,
      region: s.region,
      forcePathStyle: s.forcePathStyle,
      credentials: { accessKeyId: s.accessKey, secretAccessKey: s.secretKey },
    });
  }

  async getUploadUrl(input: { bucket: string; key: string; contentType: string; contentLength: number; ttlSeconds: number }) {
    const cmd = new PutObjectCommand({ Bucket: input.bucket, Key: input.key, ContentType: input.contentType, ContentLength: input.contentLength });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: input.ttlSeconds, signableHeaders: new Set(['content-type', 'content-length']) });
    return { url, headers: { 'Content-Type': input.contentType, 'Content-Length': String(input.contentLength) }, expiresAt: new Date(Date.now() + input.ttlSeconds * 1000) };
  }

  async getDownloadUrl(input: { bucket: string; key: string; filename: string; contentType: string; ttlSeconds: number }) {
    const cmd = new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ResponseContentDisposition: contentDisposition(input.filename),
      ResponseContentType: input.contentType,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: input.ttlSeconds });
    return { url, expiresAt: new Date(Date.now() + input.ttlSeconds * 1000) };
  }

  async head(bucket: string, key: string): Promise<StorageObjectHead | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { sizeBytes: out.ContentLength ?? 0, contentType: out.ContentType ?? null, etag: out.ETag ?? null };
    } catch (e) {
      if (e instanceof S3ServiceException && (e.name === 'NotFound' || e.$metadata.httpStatusCode === 404)) return null;
      throw e;
    }
  }

  async readPrefix(bucket: string, key: string, length: number): Promise<Buffer> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${Math.max(0, length - 1)}` }));
    const bytes = await out.Body?.transformToByteArray();
    return Buffer.from(bytes ?? new Uint8Array());
  }

  async readStream(bucket: string, key: string): Promise<NodeJS.ReadableStream> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!out.Body) throw new Error(`object ${key} has no body`);
    return out.Body as unknown as NodeJS.ReadableStream;
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
  }
}

let instance: StorageProvider | null = null;

export function storageProvider(): StorageProvider {
  if (!instance) {
    instance = new S3StorageProvider();
    logger().info({ provider: instance.code, endpoint: config().storage.endpoint }, 'storage provider ready');
  }
  return instance;
}

export function setStorageProviderForTests(p: StorageProvider | null): void {
  instance = p;
}
