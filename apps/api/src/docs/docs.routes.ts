import { Router } from 'express';
import { generateSpec } from '@/docs/registry.js';

/**
 * GET /api/v1/docs and /api/v1/docs/openapi.json. Mounted only when API_DOCS_ENABLED
 * (never in production — the env schema refuses it).
 */
export function docsRouter(apiUrl: string, version: string): Router {
  const r = Router({ strict: true });
  r.get('/docs/openapi.json', (_req, res) => {
    res.json(generateSpec(apiUrl, version));
  });
  r.get('/docs', (_req, res) => {
    // Dev-only page (API_DOCS_ENABLED is refused in production): relax the JSON-only policy for the Scalar bundle.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'");
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>UniGate API</title></head>
<body><script id="api-reference" data-url="${apiUrl}/api/v1/docs/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>`);
  });
  return r;
}
