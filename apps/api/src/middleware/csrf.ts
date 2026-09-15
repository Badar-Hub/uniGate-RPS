import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError } from '@/common/errors.js';
import { config } from '@/config/index.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOf, isAuthenticated } from '@/middleware/authenticate.js';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'unigate-web';

/**
 * CSRF defence for cookie mode (api.md §6.4 layers 2 and 4). Applied to every non-GET route
 * after authenticate(): a cookie-mode request must carry `X-Requested-With: unigate-web`
 * (a custom header a cross-origin form cannot set without a CORS preflight we refuse) AND
 * an allow-listed Origin. Bearer mode is exempt — a header credential is not ambient.
 *
 * `/auth/refresh` and `/auth/logout` call this with `cookieOnlyRoute: true` because they can
 * be reached before authenticate() has run: they decide mode by the presence of the cookie.
 */
export function csrfGuard(opts: { cookieOnlyRoute?: boolean } = {}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }

    const cookieMode = isAuthenticated(req)
      ? req.credentialMode === 'cookie'
      : opts.cookieOnlyRoute
        ? Boolean(cookieOf(req, REFRESH_COOKIE) ?? cookieOf(req, ACCESS_COOKIE)) && !req.header('authorization')
        : false;
    if (!cookieMode) {
      next();
      return;
    }
    if (req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      next(
        new ForbiddenError(
          'AUTH_CSRF_HEADER_MISSING',
          `Cookie-mode requests must send ${CSRF_HEADER}: ${CSRF_HEADER_VALUE}`,
        ),
      );
      return;
    }
    const origin = req.header('origin') ?? originOf(req.header('referer'));
    if (!origin || !config().corsOrigins.includes(origin)) {
      next(new ForbiddenError('AUTH_CSRF_ORIGIN_MISMATCH', 'Origin is not an allowed web origin'));
      return;
    }
    next();
  };
}

function originOf(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
