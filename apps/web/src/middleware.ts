import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from '@/lib/i18n/routing';

const intl = createMiddleware(routing);

/**
 * Content-Security-Policy for the portal (security.md §6.3). Per-request nonce with
 * `strict-dynamic`, so no script runs unless Next emitted it; inline styles stay allowed
 * because Radix / Leaflet set `style` attributes (a nonce cannot cover those).
 *
 * Report-only until `CSP_ENFORCE=true` (go-live), with violations posted to the API's
 * `/platform/csp-report`. Origins follow the page host the same way the API client does
 * (apps/web/src/lib/api.ts): a configured `localhost` / IP host is swapped for the host the
 * tester opened, so LAN testing does not flood the report log.
 */
function followHost(configured: string, pageHost: string): URL | null {
  try {
    const u = new URL(configured);
    if (u.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) u.hostname = pageHost;
    return u;
  } catch {
    return null;
  }
}

function buildCsp(nonce: string, req: NextRequest): { header: string; value: string } {
  // The Host header, not nextUrl — behind `next dev -H 0.0.0.0` nextUrl reports the bind address.
  const pageHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.hostname).split(':')[0] ?? req.nextUrl.hostname;
  const dev = process.env.NODE_ENV !== 'production';
  const api = followHost(process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1', pageHost);
  const connect = new Set<string>(["'self'"]);
  if (api) {
    connect.add(api.origin);
    connect.add(`${api.protocol === 'https:' ? 'wss' : 'ws'}://${api.host}`);
  }
  // Presigned uploads go straight to object storage (S3 / MinIO) — its origin must be listed before enforcing.
  for (const o of (process.env['NEXT_PUBLIC_UPLOAD_ORIGINS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const u = followHost(o, pageHost);
    if (u) connect.add(u.origin);
  }
  const tiles = (() => {
    try {
      return new URL(process.env['NEXT_PUBLIC_MAP_TILE_URL'] ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').origin;
    } catch {
      return null;
    }
  })();
  const reportUri = api ? `${api.origin}/api/v1/platform/csp-report` : null;

  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "media-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${tiles ? ` ${tiles}` : ''}`,
    "font-src 'self' data:",
    `connect-src ${[...connect].join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'self'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
    ...(reportUri ? [`report-uri ${reportUri}`] : []),
  ];
  const enforce = process.env['CSP_ENFORCE'] === 'true';
  return { header: enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', value: directives.join('; ') };
}

export default function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, req);
  // Next.js reads the nonce from the request's CSP header to tag its own inline scripts.
  req.headers.set('x-nonce', nonce);
  req.headers.set('content-security-policy', csp.value);
  const res = intl(req);
  res.headers.set(csp.header, csp.value);
  return res;
}

export const config = {
  // Every route except API proxies, Next internals and static files gets a locale prefix.
  matcher: ['/((?!api|_next|_vercel|.*[.].*).*)'],
};
