import pino, { type Logger, type LoggerOptions } from 'pino';
import { pinoRedactPaths, redact } from '@/common/redact.js';
import { getContext } from '@/common/request-context.js';

/**
 * Structured JSON logging to stdout (security.md §8.1). No file logging, no rotation here.
 *
 * Mandatory fields are added by the mixin (requestId, userId, sid) and by pino-http
 * (method, route pattern, statusCode, durationMs). Bodies are never logged. Redaction is the
 * shared allow/deny list — the same function the audit writer uses.
 */
export interface LoggerConfig {
  level: string;
  env: string;
  service: string;
  version: string;
  pretty: boolean;
}

export function createLogger(cfg: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: cfg.level,
    base: { service: cfg.service, env: cfg.env, version: cfg.version },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    redact: { paths: pinoRedactPaths(), censor: '[REDACTED]' },
    mixin() {
      const ctx = getContext();
      return ctx ? { requestId: ctx.requestId, userId: ctx.userId, sid: ctx.sessionId } : {};
    },
    // Backstop for ad-hoc objects: everything merged into a log line passes through redact().
    hooks: {
      logMethod(args, method) {
        if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
           
          args[0] = redact(args[0]);
        }
        method.apply(this, args);
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
      // Requests are logged with the ROUTE PATTERN, not the concrete URL, so ids never enter logs.
      req(req: { id?: string; method?: string; route?: { path?: string }; baseUrl?: string; url?: string }) {
        const pattern = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : (req.url ?? '').split('?')[0];
        return { id: req.id, method: req.method, path: pattern };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
    },
  };

  if (cfg.pretty) {
    return pino({ ...options, transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } } });
  }
  return pino(options);
}

/** Process-wide logger; initialised by bootstrap before anything else logs. */
let root: Logger | null = null;

export function initLogger(cfg: LoggerConfig): Logger {
  root = createLogger(cfg);
  return root;
}

export function logger(): Logger {
  root ??= createLogger({ level: 'info', env: 'unknown', service: 'unigate-api', version: 'dev', pretty: false });
  return root;
}
