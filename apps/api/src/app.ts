import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from '@/config/index.js';
import { logger } from '@/logging/logger.js';
import { requestId } from '@/middleware/request-id.js';
import { errorHandler, notFoundHandler } from '@/middleware/error-handler.js';
import { healthRouter } from '@/health/health.routes.js';
import { docsRouter } from '@/docs/docs.routes.js';
import { settingsRouter } from '@/modules/reference/settings.routes.js';
import { catalogueRouter } from '@/modules/reference/catalogue.routes.js';
import { authRouter } from '@/modules/iam/auth.routes.js';
import { adminIamRouter, meRouter } from '@/modules/iam/iam.routes.js';
import { documentsRouter } from '@/modules/documents/documents.routes.js';
import { profilesRouter } from '@/modules/profiles/profiles.routes.js';
import { fleetRouter } from '@/modules/fleet/fleet.routes.js';
import '@/docs/all.js';

/**
 * Express app assembly. Order matters:
 *   request id → security headers → CORS → body parsing → access log → routes → 404 → error
 */
export function createApp(cfg: AppConfig): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('strict routing', true); // trailing slashes are 404 (api.md §1.2)
  app.set('json spaces', 0);

  app.use(requestId);
  app.use(
    helmet({
      // The docs page loads a CDN script; API responses are JSON and carry no scripts.
      ...(cfg.apiDocsEnabled ? { contentSecurityPolicy: false as const } : {}),
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: cfg.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // Non-browser clients send no Origin; browsers must match the allow-list exactly.
        if (!origin || cfg.corsOrigins.includes(origin)) cb(null, true);
        else cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'Accept-Language', 'X-Requested-With', 'X-Step-Up-Token'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'Location', 'Idempotency-Replayed'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb', type: 'application/json' }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger: logger(),
      genReqId: (req) => (req as { id?: string }).id ?? 'unknown',
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' || req.url === '/api/v1/ready' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      customSuccessMessage: () => 'request completed',
      customErrorMessage: () => 'request errored',
      customProps: (_req, res) => ({ durationMs: res.getHeader('x-response-time') }),
    }),
  );

  const v1 = express.Router({ strict: true });
  v1.use(healthRouter());
  v1.use(authRouter());
  v1.use(meRouter());
  v1.use(adminIamRouter());
  v1.use(settingsRouter());
  v1.use(catalogueRouter());
  v1.use(documentsRouter());
  v1.use(profilesRouter());
  v1.use(fleetRouter());
  if (cfg.apiDocsEnabled) v1.use(docsRouter(cfg.apiUrl, cfg.version));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler(cfg.isProduction));
  return app;
}
