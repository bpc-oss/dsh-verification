import { describe, expect, it } from 'vitest';

import { BasisTooLargeError, collectBasisEntries, MAX_SOURCE_BASIS_ENTRIES } from '../src/contract-authority';

describe('collectBasisEntries', () => {
  it('rejects an authority basis above 200 entries instead of truncating it', () => {
    const messages = Array.from({ length: MAX_SOURCE_BASIS_ENTRIES + 1 }, (_, seq) => ({ eventRef: `e-${seq}`, seq, text: `message ${seq}` }));
    expect(() => collectBasisEntries(messages)).toThrow(BasisTooLargeError);
  });
});
