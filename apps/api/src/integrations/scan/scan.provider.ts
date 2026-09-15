import { createConnection } from 'node:net';
import { config } from '@/config/index.js';
import { logger } from '@/logging/logger.js';
import { storageProvider } from '@/integrations/storage/storage.provider.js';

/**
 * Malware scan hook for uploaded documents (A-25). The verdict decides whether a confirmed
 * upload becomes UPLOADED or QUARANTINED.
 *
 * `none` is NOT a fake "clean" — it reports `SKIPPED`, the document is accepted unscanned, and
 * the fact is logged at boot (warn in production) and in IMPLEMENTATION_STATUS. `clamav` speaks
 * the clamd INSTREAM protocol, which is standard and needs no vendor SDK.
 */
export type ScanVerdict = { result: 'CLEAN' } | { result: 'INFECTED'; signature: string } | { result: 'SKIPPED' };

export interface ScanProvider {
  readonly code: string;
  scan(bucket: string, key: string): Promise<ScanVerdict>;
}

export class NoScanProvider implements ScanProvider {
  readonly code = 'none';
  async scan(): Promise<ScanVerdict> {
    return Promise.resolve({ result: 'SKIPPED' });
  }
}

/** clamd INSTREAM: "zINSTREAM\0", then <u32 length><chunk>… then <u32 0>; reply "stream: OK" / "… FOUND". */
export class ClamAvScanProvider implements ScanProvider {
  readonly code = 'clamav';
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  async scan(bucket: string, key: string): Promise<ScanVerdict> {
    const body = await storageProvider().readStream(bucket, key);
    const reply = await new Promise<string>((resolve, reject) => {
      const sock = createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      sock.setTimeout(120_000, () => {
        sock.destroy(new Error('clamd timeout'));
      });
      sock.once('error', reject);
      sock.on('data', (d: Buffer) => chunks.push(d));
      sock.once('close', () => {
        resolve(Buffer.concat(chunks).toString('utf8').replace(/\0+$/, '').trim());
      });
      sock.once('connect', () => {
        sock.write('zINSTREAM\0');
        body.on('data', (chunk: Buffer | string) => {
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(b.length, 0);
          sock.write(Buffer.concat([len, b]));
        });
        body.on('end', () => {
          sock.write(Buffer.alloc(4, 0));
        });
        body.on('error', (e: Error) => {
          sock.destroy(e);
        });
      });
    });
    if (/\bOK$/.test(reply)) return { result: 'CLEAN' };
    const found = /:\s*(.+?)\s+FOUND$/.exec(reply);
    if (found?.[1]) return { result: 'INFECTED', signature: found[1] };
    throw new Error(`unexpected clamd reply: ${reply.slice(0, 120)}`);
  }
}

let instance: ScanProvider | null = null;

export function scanProvider(): ScanProvider {
  if (instance) return instance;
  const cfg = config();
  if (cfg.providers.scan === 'clamav') {
    instance = new ClamAvScanProvider(cfg.providers.clamav.host ?? 'localhost', cfg.providers.clamav.port);
  } else {
    instance = new NoScanProvider();
    const log = logger();
    if (cfg.isProduction) log.warn('SCAN_PROVIDER=none: uploaded documents are accepted WITHOUT malware scanning (A-25)');
    else log.info('scan provider: none (uploads unscanned)');
  }
  return instance;
}

export function setScanProviderForTests(p: ScanProvider | null): void {
  instance = p;
}
