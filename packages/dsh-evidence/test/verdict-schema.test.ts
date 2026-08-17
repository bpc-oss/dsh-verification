import { describe, expect, it } from 'vitest';

import { VerdictSchema, type ContractIdentity } from '../src/index';

const identity: ContractIdentity = { contractId: 'c-1', revision: 0, contractContentHash: 'cc', basisHash: 'bb', sessionId: 's-1' };

describe('VerdictSchema (claimId compatibility fix regression)', () => {
  it('accepts legacy verdicts with empty claimId (no committed run) — the 2026-08-17 history-load fix', () => {
    const verdict = {
      claimId: '',
      acId: 'ac-review-pass',
      result: 'fail',
      oracleTier: 'T3',
      contractIdentity: identity,
      detail: 'AC ac-review-pass: no committed run for selector'
    };
    const parsed = VerdictSchema.safeParse(verdict);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.claimId).toBe('');
  });

  it('accepts normal verdicts with a real claimId', () => {
    const parsed = VerdictSchema.safeParse({
      claimId: 'call_00_ET_L5aSzjWQaPHxkFdCn9ho4738',
      acId: 'ac-research',
      result: 'fail',
      oracleTier: 'T0',
      contractIdentity: identity
    });
    expect(parsed.success).toBe(true);
  });

  it('still rejects a verdict missing contractIdentity (schema remains strict elsewhere)', () => {
    const parsed = VerdictSchema.safeParse({ claimId: 'c', acId: 'ac1', result: 'pass', oracleTier: 'T0' });
    expect(parsed.success).toBe(false);
  });

  it('still rejects an empty acId (acId min(1) is not relaxed)', () => {
    const parsed = VerdictSchema.safeParse({ claimId: 'c', acId: '', result: 'pass', oracleTier: 'T0', contractIdentity: identity });
    expect(parsed.success).toBe(false);
  });
});
