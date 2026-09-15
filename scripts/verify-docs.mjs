// Asserts every OQ-/A-/AR-/ADR-/FR- reference in docs/ resolves to a definition and every
// relative markdown link points at an existing file. The same check that ran by hand during
// Phase 0/1, now in CI so a renamed file or dropped ID fails the build.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.md')) files.push(p);
  }
})(docs);

const all = files.map((f) => [f, readFileSync(f, 'utf8')]);
const txt = all.map((x) => x[1]).join('\n');
let failed = false;

const checks = [
  ['OQ', /\| \*{0,2}~{0,2}(OQ-\d{2})/g, /\bOQ-\d{2}\b/g],
  ['A', /\| (A-\d{2}) \|/g, /\bA-\d{2}\b/g],
  ['AR', /\| (AR-\d{1,2}) \|/g, /\bAR-\d{1,2}\b/g],
  ['ADR', /^# (ADR-\d{3})/gm, /\bADR-\d{3}\b/g],
];
for (const [tag, defRe, useRe] of checks) {
  const defs = new Set([...txt.matchAll(defRe)].map((m) => m[1]));
  const uses = new Set([...txt.matchAll(useRe)].map((m) => m[0]));
  const dangling = [...uses].filter((u) => !defs.has(u));
  if (dangling.length) {
    failed = true;
    console.error(`${tag}: dangling references: ${dangling.join(', ')}`);
  } else console.log(`${tag}: ${defs.size} defined, no dangling references`);
}

let bad = 0;
for (const [f, c] of all) {
  for (const m of c.matchAll(/\]\(([^)#]+?)(#[^)]*)?\)/g)) {
    const t = m[1];
    if (/^https?:|^mailto:/.test(t)) continue;
    if (!existsSync(path.resolve(path.dirname(f), t))) {
      bad++;
      console.error(`broken link in ${path.relative(root, f)} -> ${t}`);
    }
  }
}
if (bad) failed = true;
else console.log('links: all OK');
process.exit(failed ? 1 : 0);
