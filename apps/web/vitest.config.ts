import { defineConfig } from 'vitest/config';

// Unit tests only; the Playwright golden path lives in e2e/ and runs through `pnpm e2e` (docs/testing.md).
export default defineConfig({
  test: { exclude: ['e2e/**', 'node_modules/**', '.next/**'] },
});
