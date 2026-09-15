import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Unit tests live beside the code (src/*.test.ts) and need no infrastructure.
 * Database tests live in test/db and run against TEST_DATABASE_URL; each file skips itself
 * with a clear message when that variable is unset. They run sequentially.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
