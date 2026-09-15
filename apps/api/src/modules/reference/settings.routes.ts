import { Router, type Request, type RequestHandler, type Response } from 'express';
import { listSettingsQuery, updateSettingBody, updateSettingParams } from '@unigate/validation';
import { validate } from '@/middleware/validate.js';
import { authenticate, requirePermission } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { requireStepUp } from '@/middleware/step-up.js';
import * as c from './settings.controller.js';

/**
 * api.md §8.31 `/settings`. `settings.read` / `settings.manage`; the mutation is step-up
 * protected (security.md §3.6, SETTINGS class) because configuration is a code-equivalent surface.
 */
export function settingsRouter(): Router {
  const r = Router({ strict: true });
  r.get('/settings/public', wrap(c.listPublic));
  r.get('/settings/sections', authenticate(), requirePermission('settings.read'), wrap(c.sections));
  r.get('/settings', authenticate(), requirePermission('settings.read'), validate({ query: listSettingsQuery }), wrap(c.list));
  r.put(
    '/settings/:key',
    authenticate(),
    csrfGuard(),
    requirePermission('settings.manage'),
    requireStepUp('SETTINGS'),
    validate({ params: updateSettingParams, body: updateSettingBody }),
    wrap(c.update),
  );
  return r;
}

type Handler = (req: Request, res: Response) => Promise<void>;
function wrap(h: Handler): RequestHandler {
  return (req, res, next) => {
    h(req, res).catch(next);
  };
}
