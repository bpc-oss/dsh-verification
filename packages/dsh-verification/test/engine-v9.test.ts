import { describe, expect, it } from 'vitest';
import type { AcceptanceCriterion, BoundEvidence, ContractIdentity, OracleTier } from '@bpc-oss/dsh-evidence';

import { VerificationEngine } from '../src/engine';
import { stampVerdict, type Oracle, type VerdictBody } from '../src/oracle';

const identity: ContractIdentity = { contractId: 'c-1', revision: 0, contractContentHash: 'cc', basisHash: 'bb', sessionId: 's-1' };

function bound(acId: string, evidenceType: BoundEvidence['evidenceType'], payload: Record<string, unknown>): BoundEvidence {
  return {
    callId: 'call-1',
    toolIdentity: 'bash',
    schemaVersion: 1,
    normalizedArgs: { command: 'x' },
    normalizedArgsHash: 'h',
    evidenceType,
    payload,
    producedBy: 'tool',
    failed: false,
    contractIdentity: identity,
    acId,
    selectorRef: `${identity.contractId}:${identity.revision}:${acId}`
  };
}

function makeOracle(tier: OracleTier, name: string, canJudge: Oracle['canJudge'], body: VerdictBody): Oracle {
  return { tier, name, canJudge, judge: async () => body };
}

describe('VerificationEngine (v9: bound-only + identity stamping)', () => {
  it('picks the hardest oracle that can judge and stamps contractIdentity', async () => {
    const soft = makeOracle('T3', 'soft', () => true, { claimId: 'c', acId: 'AC1', result: 'pass', oracleTier: 'T3' });
    const hard = makeOracle('T0', 'hard', () => true, { claimId: 'c', acId: 'AC1', result: 'fail', oracleTier: 'T0' });
    const engine = new VerificationEngine([soft, hard]);
    const verdict = await engine.verify({ id: 'AC1', desc: 'x', oracleHint: 'test' } as AcceptanceCriterion, [bound('AC1', 'test_run', {})], identity);
    expect(verdict.oracleTier).toBe('T0');
    expect(verdict.contractIdentity).toEqual(identity);
  });

  it('ignores evidence bound to OTHER ACs (cross-AC reuse rejected)', async () => {
    let seen = 0;
    const counting: Oracle = {
      tier: 'T0',
      name: 'counting',
      canJudge: () => true,
      judge: async (_ac, evidence) => {
        seen = evidence.length;
        return { claimId: 'c', acId: 'AC1', result: 'pass', oracleTier: 'T0' };
      }
    };
    const engine = new VerificationEngine([counting]);
    await engine.verify({ id: 'AC1', desc: 'x', oracleHint: 'test' } as AcceptanceCriterion, [bound('AC1', 'test_run', {}), bound('AC2', 'file_diff', {})], identity);
    expect(seen).toBe(1);
  });

  it('throws when no oracle can judge', async () => {
    const engine = new VerificationEngine([makeOracle('T0', 'never', () => false, { claimId: 'c', acId: 'AC1', result: 'pass', oracleTier: 'T0' })]);
    await expect(engine.verify({ id: 'AC1', desc: 'x', oracleHint: 'test' } as AcceptanceCriterion, [bound('AC1', 'test_run', {})], identity)).rejects.toThrow('no oracle');
  });
});

describe('stampVerdict', () => {
  it('adds the five-tuple identity to a raw verdict body', () => {
    const verdict = stampVerdict({ claimId: 'c', acId: 'AC1', result: 'pass', oracleTier: 'T0' }, identity);
    expect(verdict.contractIdentity).toEqual(identity);
    expect(verdict.result).toBe('pass');
  });
});
