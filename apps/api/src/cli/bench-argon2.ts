/**
 * Argon2id parameter benchmark (security.md §3.1, G-17 / Phase 14).
 *
 *   pnpm --filter @unigate/api bench:argon2            # measures the configured ARGON2_* set
 *   pnpm --filter @unigate/api bench:argon2 -- --sweep # also tries the neighbouring sets
 *
 * Target: 250–350 ms per hash on the instance type that serves /auth/login (a login costs one
 * verify, plus a dummy hash for unknown identifiers so timing is uniform). Below ~150 ms the
 * parameters are weaker than they should be; above ~500 ms a modest login burst becomes a
 * memory-exhaustion DoS. Re-run on any instance-type change; raising the parameters is safe at
 * any time because hashes are upgraded on the next successful login (re-hash-on-login).
 *
 * Prints JSON on the last line so CI can record it. Never touches the database.
 */
import '@/config/dotenv.js';
import argon2 from 'argon2';
import { config } from '@/config/index.js';

interface Set_ {
  memoryKib: number;
  timeCost: number;
  parallelism: number;
}

async function measure(s: Set_, rounds: number): Promise<{ meanMs: number; p95Ms: number }> {
  const opts = { type: argon2.argon2id, memoryCost: s.memoryKib, timeCost: s.timeCost, parallelism: s.parallelism, hashLength: 32 } as const;
  const samples: number[] = [];
  await argon2.hash('warm-up-password-0000', opts);
  for (let i = 0; i < rounds; i++) {
    const t = process.hrtime.bigint();
    await argon2.hash(`bench-password-${i}`, opts);
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const meanMs = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p95Ms = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? meanMs;
  return { meanMs: Math.round(meanMs), p95Ms: Math.round(p95Ms) };
}

function verdict(meanMs: number): 'WEAK' | 'OK' | 'SLOW' {
  if (meanMs < 150) return 'WEAK';
  if (meanMs > 500) return 'SLOW';
  return 'OK';
}

async function main(): Promise<number> {
  const current = config().auth.argon2;
  const sweep = process.argv.includes('--sweep');
  const rounds = Number(process.env['BENCH_ROUNDS'] ?? 8);
  const sets: Set_[] = [current];
  if (sweep) {
    for (const memoryKib of [19_456, 32_768, 65_536, 131_072]) {
      for (const timeCost of [2, 3, 4]) sets.push({ memoryKib, timeCost, parallelism: current.parallelism });
    }
  }
  const results = [];
  for (const s of sets) {
    const m = await measure(s, rounds);
    const row = { ...s, ...m, verdict: verdict(m.meanMs), configured: s === current };
    results.push(row);
    console.log(`${row.configured ? '*' : ' '} m=${String(s.memoryKib).padStart(6)} KiB t=${s.timeCost} p=${s.parallelism}  mean ${String(m.meanMs).padStart(4)} ms  p95 ${String(m.p95Ms).padStart(4)} ms  ${row.verdict}`);
  }
  console.log(JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, cpus: (await import('node:os')).cpus().length, rounds, results }));
  const configured = results.find((r) => r.configured);
  return configured?.verdict === 'OK' ? 0 : 2;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
