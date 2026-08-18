import { describe, expect, it } from 'vitest';
import { hasTrustField, resolveTrustLevel, stripTrustFields } from '../src/trust';

describe('trust injection', () => {
  it('resolves builtin/external trust from loader-controlled inputs', () => {
    expect(resolveTrustLevel({ source: 'builtin' })).toBe('builtin');
    expect(resolveTrustLevel({ source: 'external', fixtureHash: 'abc', allowlistHashes: new Set(['abc']) })).toBe('allowlisted');
    expect(resolveTrustLevel({ source: 'external', fixtureHash: 'abc', allowlistHashes: new Set(['def']) })).toBe('untrusted');
  });

  it('detects and strips trust fields', () => {
    expect(hasTrustField({ trusted: true })).toBe(true);
    expect(hasTrustField({ trustLevel: 'builtin' })).toBe(true);
    expect(stripTrustFields({ id: 'x', trusted: true, trustLevel: 'untrusted' })).toEqual({ id: 'x' });
  });
});
