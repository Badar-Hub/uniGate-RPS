import '@/config/dotenv.js';
import { config } from '@/config/index.js';
import { initLogger } from '@/logging/logger.js';
import { disconnectPrisma, prisma } from '@/database/prisma.js';
import { disconnectRedis, redis } from '@/database/redis.js';
import { startOutboxRelay } from '@/jobs/outbox.relay.js';
import { startEventWorker } from '@/jobs/event.handlers.js';
import { closeQueues } from '@/jobs/queues.js';
import { ensureNextMonthPartitions, purgeExpired } from '@/jobs/maintenance.js';
import { markExpiredDocuments, sweepPendingUploads } from '@/modules/documents/documents.service.js';
import { expireStaleRequests } from '@/modules/demand/trip-request.service.js';

/**
 * Worker entrypoint — same image as the API, different process. Runs the outbox relay, the
 * BullMQ event consumer and the housekeeping schedule.
 */
async function main(): Promise<void> {
  const cfg = config();
  const log = initLogger({
    level: cfg.logLevel,
    env: cfg.env,
    service: 'unigate-worker',
    version: cfg.version,
    pretty: cfg.isDevelopment,
  });
  await prisma().$connect();
  await redis(cfg.redisUrl).connect();

  const stopRelay = startOutboxRelay(1000);
  const eventWorker = startEventWorker();

  const runMaintenance = () => {
    ensureNextMonthPartitions().catch((err: unknown) => {
      log.error({ err }, 'partition maintenance failed');
    });
  };
  const runPurge = () => {
    purgeExpired().catch((err: unknown) => {
      log.error({ err }, 'purge failed');
    });
  };
  // Documents: unconfirmed uploads are swept after 24h; verified documents past expiry flip to EXPIRED.
  const runDocuments = () => {
    sweepPendingUploads()
      .then((n) => {
        if (n) log.info({ swept: n }, 'pending uploads swept');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'pending upload sweep failed');
      });
    markExpiredDocuments()
      .then((n) => {
        if (n) log.info({ expired: n }, 'documents marked expired');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'document expiry job failed');
      });
  };
  // Demand: PUBLISHED requests past their deadline with nothing awarded expire; partially awarded ones never do (A-45).
  const runDemand = () => {
    expireStaleRequests()
      .then((n) => {
        if (n) log.info({ expired: n }, 'trip requests expired');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'trip request expiry failed');
      });
  };
  runMaintenance();
  runPurge();
  runDocuments();
  runDemand();
  const t1 = setInterval(runMaintenance, 60 * 60_000);
  const t2 = setInterval(runPurge, 6 * 60 * 60_000);
  const t3 = setInterval(runDocuments, 60 * 60_000);
  const t4 = setInterval(runDemand, 5 * 60_000);
  log.info('worker started: outbox relay, event consumer, maintenance');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'worker shutdown');
    clearInterval(t1);
    clearInterval(t2);
    clearInterval(t3);
    clearInterval(t4);
    stopRelay();
    await eventWorker.close();
    await closeQueues();
    await disconnectPrisma();
    await disconnectRedis();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('[worker] fatal', err instanceof Error ? err.message : err);
  process.exit(1);
});
