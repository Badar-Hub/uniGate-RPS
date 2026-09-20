import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

/**
 * Security headers mirror security.md §6.3 at the web tier; the API sets its own.
 * A nonce-based CSP is added when the first inline script appears (Phase 3 auth pages).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server for docker/Dockerfile.web (deployment.md); the tracing root is the monorepo so workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@unigate/types', '@unigate/validation'],
  headers: () => Promise.resolve([{ source: '/(.*)', headers: securityHeaders }]),
  // Prisma must never be bundled into the web app (architecture.md §3) — this makes an
  // accidental import a build failure rather than a silent inclusion.
  webpack: (config) => {
    config.resolve.alias['@prisma/client'] = false;
    return config;
  },
};

export default withNextIntl(nextConfig);
