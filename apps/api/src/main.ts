import { createServer } from 'node:http';
import { config } from '@/config/index.js';
import { initLogger } from '@/logging/logger.js';
import { createApp } from '@/app.js';
import { disconnectPrisma, prisma } from '@/database/prisma.js';
import { disconnectRedis, redis } from '@/database/redis.js';

/**
 * HTTP entrypoint. Config is validated before anything else; a bad env exits(1) here.
 * Graceful shutdown: stop accepting, drain in-flight (up to 10 s), close DB/Redis, exit.
 */
async function main(): Promise<void> {
  const cfg = config();
  const log = initLogger({
    level: cfg.logLevel,
    env: cfg.env,
    service: 'unigate-api',
    version: cfg.version,
    pretty: cfg.isDevelopment,
  });

  await prisma().$connect();
  await redis(cfg.redisUrl).connect().catch((err: unknown) => { log.warn({ err }, 'redis not reachable at boot; /ready will report it'); });

  const app = createApp(cfg);
  const server = createServer(app);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  server.listen(cfg.port, () => { log.info({ port: cfg.port, env: cfg.env }, 'api listening'); });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutdown requested');
    const forceExit = setTimeout(() => {
      log.error('forced exit after drain timeout');
      process.exit(1);
    }, 10_000).unref();
    server.close(() => {
      void (async () => {
        await disconnectPrisma();
        await disconnectRedis();
        clearTimeout(forceExit);
        log.info('shutdown complete');
        process.exit(0);
      })();
    });
  };
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('unhandledRejection', (reason) => { log.error({ err: reason }, 'unhandled rejection'); });
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((err: unknown) => {
  console.error('[main] fatal', err instanceof Error ? err.message : err);
  process.exit(1);
});
