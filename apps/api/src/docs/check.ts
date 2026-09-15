// CI: the committed openapi.json must equal the generated one (api.md P5).
import { readFileSync } from 'node:fs';
import '@/docs/all.js';
import { generateSpec } from '@/docs/registry.js';

const generated = JSON.stringify(generateSpec('http://localhost:4000', '0.1.0'), null, 2) + '\n';
let committed = '';
try {
  committed = readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8');
} catch {
  console.error('openapi.json is missing — run `pnpm openapi:generate > openapi.json`');
  process.exit(1);
}
if (committed !== generated) {
  console.error('openapi.json is stale — run `pnpm openapi:generate > openapi.json` and commit the result');
  process.exit(1);
}
console.error('openapi.json is up to date');
