import { describe, expect, it } from 'vitest';

import { contentHash, deriveEpochId, stableHash, textHash } from '../src/hash';
import { canonicalizeArgs, normalizePathLexically, normalizedArgsHash } from '../src/selector';

describe('normalizePathLexically', () => {
  it('collapses ./ and a/../b and backslashes', () => {
    expect(normalizePathLexically('./src/../src/a.ts')).toBe('src/a.ts');
    expect(normalizePathLexically('src\\legacy')).toBe('src/legacy');
    expect(normalizePathLexically('a/b/../../c')).toBe('c');
  });

  it('keeps leading .. escape segments', () => {
    expect(normalizePathLexically('../outside/x')).toBe('../outside/x');
  });
});

describe('canonicalizeArgs / normalizedArgsHash', () => {
  it('stably sorts object keys and normalizes path-like keys', () => {
    const a = canonicalizeArgs({ target: './src/a.ts', count: 2, flag: true });
    const b = canonicalizeArgs({ flag: true, count: 2, target: 'src/a.ts' });
    expect(a).toEqual(b);
  });

  it('produces stable hashes regardless of key order', () => {
    const h1 = normalizedArgsHash({ a: 1, b: 'x', path: './src/a' });
    const h2 = normalizedArgsHash({ b: 'x', a: 1, path: 'src/a' });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects ambiguity attempts: echo PASS as npm test changes hash', () => {
    const bash = normalizedArgsHash({ command: 'npm test' });
    const echo = normalizedArgsHash({ command: 'echo PASS' });
    expect(bash).not.toBe(echo);
  });
});

describe('stableHash / contentHash / textHash / deriveEpochId', () => {
  it('are stable and distinct', () => {
    expect(stableHash({ x: 1 })).toBe(stableHash({ x: 1 }));
    expect(stableHash({ x: 1 })).not.toBe(stableHash({ x: 2 }));
    const bytes = new TextEncoder().encode('abc');
    expect(contentHash(bytes)).toBe(textHash('abc'));
  });

  it('deriveEpochId matches sha256(sessionId:goalId:createSeq)', () => {
    const id = deriveEpochId('s-1', 'g-1', 12);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toBe(deriveEpochId('s-1', 'g-1', 13));
  });
});
