import { defineConfig, devices } from '@playwright/test';

/**
 * Golden-path E2E against a RUNNING stack (Phase 15, docs/testing.md).
 *
 *   E2E_BASE_URL=http://localhost:3001 E2E_PASSWORD='…' pnpm --filter @unigate/web e2e
 *
 * The API must be reachable from the browser at the address the portal is configured with, and
 * `pnpm --filter @unigate/api e2e:seed` must have run with the same E2E_PASSWORD. Two projects
 * run the same journey in `en` and `ar`; the Arabic run also compares screenshots of the key
 * screens against the checked-in baselines (`--update-snapshots` to refresh them deliberately).
 * Tests are serial per project: they share the request they create.
 *
 * The target stack must run with RATE_LIMIT_ENABLED=false (or a raised RATE_LIMIT_GLOBAL_PER_5MIN):
 * one run issues ~150 API calls from a single IP and repeated runs trip the 600 / 5 min global tier —
 * which is the limiter working, not the app.
 */
export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  outputDir: '../.e2e-results',
  snapshotDir: './__screenshots__',
  timeout: 90_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.04, animations: 'disabled', caret: 'hide' } },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never', outputFolder: '../.e2e-report' }]] : [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: 'en', use: { ...devices['Desktop Chrome'], locale: 'en-GB' }, metadata: { locale: 'en' } },
    { name: 'ar', use: { ...devices['Desktop Chrome'], locale: 'ar-SA' }, metadata: { locale: 'ar' } },
  ],
});
