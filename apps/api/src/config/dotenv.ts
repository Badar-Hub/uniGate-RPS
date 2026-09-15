import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Development convenience: load the monorepo root `.env` (and `apps/api/.env`) into
 * process.env before the config is validated, without overriding anything the shell already
 * set. Production/staging get their environment from the platform and never from a file —
 * the loader is a no-op there. Import this module FIRST in every entrypoint.
 */
if (process.env['NODE_ENV'] !== 'production' && process.env['NODE_ENV'] !== 'staging' && process.env['UNIGATE_SKIP_DOTENV'] !== 'true') {
  const here = import.meta.dirname;
  for (const candidate of [path.resolve(here, '../../../../.env'), path.resolve(here, '../../.env')]) {
    if (existsSync(candidate)) process.loadEnvFile(candidate);
  }
}
