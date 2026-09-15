import '@/config/dotenv.js';
import { config } from '@/config/index.js';
import { initLogger } from '@/logging/logger.js';
import { disconnectPrisma, prisma } from '@/database/prisma.js';
import { disconnectRedis, redis } from '@/database/redis.js';
import { startOutboxRelay } from '@/jobs/outbox.relay.js';
import { startEventWorker } from '@/jobs/event.handlers.js';
import { closeQueues } from '@/jobs/queues.js';
import { ensureNextMonthPartitions, purgeExpired } from '@/jobs/maintenance.js';
import { markExpiredDocuments, sweepPendingUploads, warnExpiringDocuments } from '@/modules/documents/documents.service.js';
import { expireStaleRequests } from '@/modules/demand/trip-request.service.js';
import { expireStaleBids } from '@/modules/bidding/bid.service.js';
import { expireUnpaidBookings } from '@/modules/bookings/booking.service.js';
import { reconcilePendingPayments } from '@/modules/payments/payment.service.js';
import { startPaymentsWorker } from '@/modules/payments/payments.jobs.js';
import { processPendingWebhooks } from '@/modules/payments/webhook.service.js';
import { markOverdueInvoices, retryPendingClearances } from '@/modules/finance/invoice.service.js';
import { maintenanceReminders } from '@/modules/maintenance/maintenance.service.js';
import { deliverStale, purgeNotifications } from '@/modules/notifications/notification.service.js';
import { startNotificationsWorker } from '@/modules/notifications/notifications.jobs.js';
import { expireExports, processNextExport } from '@/modules/reporting/reporting.service.js';

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
  const paymentsWorker = startPaymentsWorker();
  const notificationsWorker = startNotificationsWorker();

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
        return expireStaleBids();
      })
      .then((n) => {
        if (n) log.info({ expired: n }, 'bids expired');
        return expireUnpaidBookings();
      })
      .then((n) => {
        if (n) log.info({ cancelled: n }, 'unpaid bookings expired');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'demand/bidding/bookings expiry failed');
      });
  };
  // Payments: reconcile stale PENDING payments against the gateway and sweep unprocessed webhook rows.
  const runPayments = () => {
    reconcilePendingPayments()
      .then((r) => {
        if (r.synced || r.expired) log.info(r, 'payments reconciled');
        return processPendingWebhooks();
      })
      .then((n) => {
        if (n) log.info({ processed: n }, 'webhook rows swept');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'payments reconciliation failed');
      });
  };
  // Finance: invoices past due flip to OVERDUE (reminders on the configured days); stalled clearances are re-presented.
  const runFinance = () => {
    markOverdueInvoices()
      .then((r) => {
        if (r.overdue || r.reminders) log.info(r, 'invoices overdue sweep');
        return retryPendingClearances();
      })
      .then((n) => {
        if (n) log.info({ cleared: n }, 'pending clearances re-presented');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'finance jobs failed');
      });
  };
  // Notifications: rows still QUEUED (a lost enqueue) are delivered; old inbox rows are purged daily.
  const runNotifications = () => {
    deliverStale()
      .then((n) => {
        if (n) log.info({ delivered: n }, 'stale notifications delivered');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'notification sweep failed');
      });
  };
  const runNotificationPurge = () => {
    purgeNotifications()
      .then((n) => {
        if (n) log.info({ purged: n }, 'notifications purged');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'notification purge failed');
      });
  };
  // Reports: exports are generated here (concurrency 1 per worker), completed files expire after 24 h.
  let exporting = false;
  const runExports = () => {
    if (exporting) return;
    exporting = true;
    (async () => {
      let n = 0;
      while ((await processNextExport()) && n < 20) n++;
      if (n) log.info({ exports: n }, 'report exports generated');
    })()
      .catch((err: unknown) => {
        log.error({ err }, 'report export loop failed');
      })
      .finally(() => {
        exporting = false;
      });
  };
  const runExportExpiry = () => {
    expireExports()
      .then((n) => {
        if (n) log.info({ expired: n }, 'report exports expired');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'export expiry failed');
      });
  };
  // Documents: expiry warnings at the configured days before expiry, daily.
  const runDocumentWarnings = () => {
    warnExpiringDocuments()
      .then((n) => {
        if (n) log.info({ warned: n }, 'document expiry warnings published');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'document expiry warnings failed');
      });
  };
  // Fleet maintenance: one reminder event per schedule inside the horizon, daily.
  const runFleetMaintenance = () => {
    maintenanceReminders()
      .then((n) => {
        if (n) log.info({ due: n }, 'maintenance reminders published');
      })
      .catch((err: unknown) => {
        log.error({ err }, 'maintenance reminders failed');
      });
  };
  runMaintenance();
  runPurge();
  runPayments();
  runFinance();
  runFleetMaintenance();
  runNotifications();
  runNotificationPurge();
  runDocumentWarnings();
  runExports();
  runExportExpiry();
  runDocuments();
  runDemand();
  const t1 = setInterval(runMaintenance, 60 * 60_000);
  const t2 = setInterval(runPurge, 6 * 60 * 60_000);
  const t3 = setInterval(runDocuments, 60 * 60_000);
  const t4 = setInterval(runDemand, 5 * 60_000);
  const t5 = setInterval(runPayments, 5 * 60_000);
  const t6 = setInterval(runFinance, 15 * 60_000);
  const t7 = setInterval(runFleetMaintenance, 24 * 60 * 60_000);
  const t8 = setInterval(runNotifications, 60_000);
  const t9 = setInterval(runNotificationPurge, 24 * 60 * 60_000);
  const t10 = setInterval(runDocumentWarnings, 24 * 60 * 60_000);
  const t11 = setInterval(runExports, 15_000);
  const t12 = setInterval(runExportExpiry, 60 * 60_000);
  log.info('worker started: outbox relay, event consumer, maintenance');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'worker shutdown');
    clearInterval(t1);
    clearInterval(t2);
    clearInterval(t3);
    clearInterval(t4);
    clearInterval(t5);
    clearInterval(t6);
    clearInterval(t7);
    clearInterval(t8);
    clearInterval(t9);
    clearInterval(t10);
    clearInterval(t11);
    clearInterval(t12);
    stopRelay();
    await eventWorker.close();
    await paymentsWorker.close();
    await notificationsWorker.close();
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
