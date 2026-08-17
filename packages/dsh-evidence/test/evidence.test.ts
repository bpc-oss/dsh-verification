import { describe, expect, it } from 'vitest';

import {
  BoundEvidenceSchema,
  CapturedEvidenceSchema,
  ContractIdentitySchema,
  SelectorV1Schema,
  isBoundEvidence,
  selectorKey,
  selectorRefOf
} from '../src/evidence';

const identity = {
  contractId: 'c-1',
  revision: 0,
  contractContentHash: 'aaa',
  basisHash: 'bbb',
  sessionId: 's-1'
};

function capturedInput() {
  return {
    callId: 'call-1',
    toolIdentity: 'bash',
    schemaVersion: 1,
    normalizedArgs: { command: 'npm test' },
    normalizedArgsHash: 'h-1',
    evidenceType: 'command_output',
    payload: { exitCode: 0, stdout: 'ok' },
    producedBy: 'tool',
    failed: false,
    contractIdentity: identity
  };
}

describe('ContractIdentitySchema', () => {
  it('accepts a full five-tuple and rejects partial identity', () => {
    expect(ContractIdentitySchema.safeParse(identity).success).toBe(true);
    const { sessionId: _omit, ...partial } = identity;
    expect(ContractIdentitySchema.safeParse(partial).success).toBe(false);
  });
});

describe('CapturedEvidenceSchema (v9: no acId / selectorRef)', () => {
  it('accepts captured state', () => {
    expect(CapturedEvidenceSchema.safeParse(capturedInput()).success).toBe(true);
  });

  it('REJECTS acId in captured state', () => {
    expect(CapturedEvidenceSchema.safeParse({ ...capturedInput(), acId: 'AC1' }).success).toBe(false);
  });

  it('REJECTS selectorRef in captured state', () => {
    expect(CapturedEvidenceSchema.safeParse({ ...capturedInput(), selectorRef: 'x' }).success).toBe(false);
  });
});

describe('BoundEvidenceSchema (v9: captured + acId + selectorRef)', () => {
  it('accepts a bound view', () => {
    const bound = { ...capturedInput(), acId: 'AC1', selectorRef: selectorRefOf(identity, 'AC1') };
    expect(BoundEvidenceSchema.safeParse(bound).success).toBe(true);
    expect(isBoundEvidence(bound)).toBe(true);
  });

  it('REQUIRES acId and selectorRef', () => {
    expect(BoundEvidenceSchema.safeParse(capturedInput()).success).toBe(false);
    expect(BoundEvidenceSchema.safeParse({ ...capturedInput(), acId: 'AC1' }).success).toBe(false);
    expect(BoundEvidenceSchema.safeParse({ ...capturedInput(), selectorRef: 'x' }).success).toBe(false);
  });
});

describe('SelectorV1 (v11: exact-only)', () => {
  it('accepts a frozen selector with schemaVersion 1', () => {
    const selector = {
      schemaVersion: 1,
      toolIdentity: 'bash',
      normalizedArgsHash: 'h-1',
      evidenceType: 'test_run'
    };
    expect(SelectorV1Schema.safeParse(selector).success).toBe(true);
  });

  it('rejects evidenceType outside the enum (glob/regex 后置，schema 层无宽松类型)', () => {
    expect(
      SelectorV1Schema.safeParse({ schemaVersion: 1, toolIdentity: 'bash', normalizedArgsHash: 'h', evidenceType: 'glob' }).success
    ).toBe(false);
  });

  it('selectorKey is exact-full-equality key', () => {
    const a = { schemaVersion: 1 as const, toolIdentity: 'bash', normalizedArgsHash: 'h-1', evidenceType: 'command_output' as const };
    const b = { ...a, normalizedArgsHash: 'h-2' };
    expect(selectorKey(a)).not.toBe(selectorKey(b));
    expect(selectorKey({ ...a, toolIdentity: 'pwsh' })).not.toBe(selectorKey(a));
  });
});

describe('selectorRefOf', () => {
  it('derives a stable per-AC selector ref under a contract identity', () => {
    expect(selectorRefOf(identity, 'AC1')).toBe('c-1:0:AC1');
    expect(selectorRefOf(identity, 'AC1')).toBe(selectorRefOf(identity, 'AC1'));
    expect(selectorRefOf({ ...identity, revision: 1 }, 'AC1')).toBe('c-1:1:AC1');
  });
});
