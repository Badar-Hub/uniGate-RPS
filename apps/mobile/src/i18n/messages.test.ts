import { describe, expect, it } from 'vitest';
import ar from './messages/ar.json';
import en from './messages/en.json';

interface Tree {
  [key: string]: string | Tree;
}

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else for (const [ck, cv] of flatten(v, key)) out.set(ck, cv);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]).sort();

/**
 * Catalogue parity: every key exists in both languages, no value is empty, and the
 * `{placeholder}` set of each message is the same in Arabic and English (a missing placeholder
 * would render the raw `{name}` on one side only).
 */
describe('message catalogues', () => {
  const enFlat = flatten(en);
  const arFlat = flatten(ar);

  it('have the same keys in Arabic and English', () => {
    const onlyEn = [...enFlat.keys()].filter((k) => !arFlat.has(k));
    const onlyAr = [...arFlat.keys()].filter((k) => !enFlat.has(k));
    expect(onlyEn).toEqual([]);
    expect(onlyAr).toEqual([]);
  });

  it('have no empty messages', () => {
    const empty = [...enFlat.entries(), ...arFlat.entries()].filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('use the same placeholders in both languages', () => {
    const mismatched = [...enFlat.entries()]
      .filter(([k, v]) => arFlat.has(k) && placeholders(v).join(',') !== placeholders(arFlat.get(k) ?? '').join(','))
      .map(([k]) => k);
    expect(mismatched).toEqual([]);
  });
});
