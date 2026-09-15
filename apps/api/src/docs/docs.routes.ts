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
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>UniGate API</title></head>
<body><script id="api-reference" data-url="${apiUrl}/api/v1/docs/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>`);
  });
  return r;
}
