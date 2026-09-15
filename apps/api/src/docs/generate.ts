// Prints the generated OpenAPI document. Used by `pnpm openapi:generate` and the CI diff.
import '@/docs/all.js';
import { generateSpec } from '@/docs/registry.js';

process.stdout.write(JSON.stringify(generateSpec('http://localhost:4000', '0.1.0'), null, 2) + '\n');
