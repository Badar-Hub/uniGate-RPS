import createMiddleware from 'next-intl/middleware';
import { routing } from '@/lib/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Every route except API proxies, Next internals and static files gets a locale prefix.
  matcher: ['/((?!api|_next|_vercel|.*[.].*).*)'],
};
