import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Runs `pnpm --filter @unigate/api e2e:seed` before the suite so the deterministic accounts exist,
 * their password matches E2E_PASSWORD, and the seeded minibus has no stale reservations from
 * earlier runs (the matcher would otherwise skip it). Set E2E_SKIP_SEED=1 to run against a stack
 * that was seeded separately (e.g. a shared staging database you do not own).
 */
export default function globalSetup(): void {
  if (process.env['E2E_SKIP_SEED'] === '1') return;
  if (!process.env['E2E_PASSWORD']) return; // the spec skips itself with a clear message
  const root = path.resolve(__dirname, '../../..');
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const out = execFileSync(pnpm, ['--filter', '@unigate/api', 'e2e:seed'], { cwd: root, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
  const last = out.trim().split('\n').pop() ?? '';
  process.stdout.write(`[e2e] seeded: ${last}\n`);
}
