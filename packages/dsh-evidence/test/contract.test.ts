import { describe, expect, it } from 'vitest';

import {
  TaskContractSchema,
  computeBasisHash,
  computeContractContentHash,
  contractIdentityOf
} from '../src/contract';

function basis(sessionId = 's-1', entries: Array<{ kind: 'user-message' | 'attachment'; eventRef: string; seq: number; contentHash: string }> = []) {
  return {
    sessionId,
    entries,
    basisHash: computeBasisHash(sessionId, entries)
  };
}

function contractInput() {
  return {
    ref: {
      contractId: 'c-1',
      revision: 0,
      contractContentHash: 'content-hash',
      sourceBasis: basis('s-1', [
        { kind: 'user-message', eventRef: 'ev-1', seq: 5, contentHash: 'h-msg-1' }
      ])
    },
    origin: 'independent-capture',
    goal: 'Make the tests pass',
    acceptanceCriteria: [{ id: 'AC1', desc: 'run tests and all pass', oracleHint: 'test' }],
    constraints: [],
    inputs: [],
    outOfScope: []
  };
}

describe('TaskContractSchema (v6: ref + origin required)', () => {
  it('accepts a fully-authoritative contract', () => {
    expect(TaskContractSchema.safeParse(contractInput()).success).toBe(true);
  });

  it('REJECTS a contract without a server-minted ref', () => {
    const { ref: _omit, ...noRef } = contractInput();
    expect(TaskContractSchema.safeParse(noRef).success).toBe(false);
  });

  it('REJECTS an AC whose selector is not exact-only SelectorV1', () => {
    const c = contractInput();
    c.acceptanceCriteria[0]!.selector = { schemaVersion: 2, toolIdentity: 'bash', normalizedArgsHash: 'h', evidenceType: 'test_run' };
    expect(TaskContractSchema.safeParse(c).success).toBe(false);
  });

  it('REJECTS duplicate acceptance-criterion ids', () => {
    const c = contractInput();
    c.acceptanceCriteria = [
      { id: 'AC1', desc: 'first criterion', oracleHint: 'test' },
      { id: 'AC1', desc: 'second criterion', oracleHint: 'test' }
    ];
    expect(TaskContractSchema.safeParse(c).success).toBe(false);
  });

  it('defaults constraints/inputs/outOfScope when omitted', () => {
    const c = contractInput();
    delete c.constraints;
    delete c.inputs;
    delete c.outOfScope;
    const parsed = TaskContractSchema.safeParse(c);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.constraints).toEqual([]);
    }
  });
});

describe('five-tuple identity', () => {
  it('derives the identity from a contract', () => {
    const contract = TaskContractSchema.parse(contractInput());
    const identity = contractIdentityOf(contract);
    expect(identity).toEqual({
      contractId: 'c-1',
      revision: 0,
      contractContentHash: 'content-hash',
      basisHash: expect.any(String),
      sessionId: 's-1'
    });
  });

  it('contractContentHash is derived from content, not ref', () => {
    const c = contractInput();
    const contentHash = computeContractContentHash({
      goal: c.goal,
      acceptanceCriteria: c.acceptanceCriteria,
      constraints: c.constraints,
      inputs: c.inputs,
      outOfScope: c.outOfScope
    });
    expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
    // 弱契约（删 AC）→ 不同 hash
    const weak = computeContractContentHash({
      goal: c.goal,
      acceptanceCriteria: [],
      constraints: c.constraints,
      inputs: c.inputs,
      outOfScope: c.outOfScope
    } as Parameters<typeof computeContractContentHash>[0]);
    expect(weak).not.toBe(contentHash);
  });

  it('basisHash covers sessionId + ordered entries (reorder changes hash)', () => {
    const entries = [
      { kind: 'user-message' as const, eventRef: 'ev-1', seq: 5, contentHash: 'h-1' },
      { kind: 'user-correction' as const, eventRef: 'ev-2', seq: 9, contentHash: 'h-2' }
    ];
    const a = computeBasisHash('s-1', entries);
    const b = computeBasisHash('s-1', [entries[1]!, entries[0]!]);
    const c = computeBasisHash('s-2', entries);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
