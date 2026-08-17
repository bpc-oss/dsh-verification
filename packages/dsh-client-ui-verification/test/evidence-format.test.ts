import { describe, expect, it } from 'vitest';
import type { Evidence } from '@bpc-oss/dsh-evidence';
import type { EvidenceRef } from '@bpc-oss/dsh-verification';

import { summarizeEvidence, toPlainLanguage, verdictLabel } from '../src/evidence-format';

const identity = { contractId: 'c-1', revision: 0, contractContentHash: 'cc', basisHash: 'bb', sessionId: 's-1' };

describe('toPlainLanguage (Bobby port)', () => {
  it('formats command_output', () => {
    const evidence: Evidence = {
      callId: 'c1',
      toolIdentity: 'bash',
      schemaVersion: 1,
      normalizedArgs: { command: 'x' },
      normalizedArgsHash: 'h',
      evidenceType: 'command_output',
      payload: { exitCode: 0, stdout: 'done' },
      producedBy: 'tool',
      failed: false,
      contractIdentity: identity,
      acId: 'AC1',
      selectorRef: 'c-1:0:AC1'
    };
    const plain = toPlainLanguage(evidence);
    expect(plain.ok).toBe(true);
    expect(plain.summary).toContain('成功');
    expect(plain.detail).toContain('done');
  });

  it('marks failed commands', () => {
    const plain = toPlainLanguage({
      callId: 'c1',
      toolIdentity: 'bash',
      schemaVersion: 1,
      normalizedArgs: {},
      normalizedArgsHash: 'h',
      evidenceType: 'command_output',
      payload: { exitCode: 2 },
      producedBy: 'tool',
      failed: true,
      contractIdentity: identity,
      acId: 'AC1',
      selectorRef: 'c-1:0:AC1'
    });
    expect(plain.ok).toBe(false);
  });
});

describe('summarizeEvidence (projection evidence refs)', () => {
  const ref: EvidenceRef = {
    callId: 'call-9',
    toolIdentity: 'bash',
    normalizedArgsHash: 'h',
    blobHash: 'deadbeef',
    truncated: false,
    originalLength: 5,
    schemaVersion: 1,
    contractIdentity: identity,
    evidenceType: 'test_run',
    resultSeq: 4,
    summary: 'bash test_run exit:0'
  };

  it('renders the ref summary with blob/seq detail', () => {
    const plain = summarizeEvidence(ref);
    expect(plain.ok).toBe(true);
    expect(plain.summary).toContain('exit:0');
    expect(plain.detail).toContain('call-9');
  });

  it('marks truncated evidence as not-ok (incomplete)', () => {
    const plain = summarizeEvidence({ ...ref, truncated: true });
    expect(plain.ok).toBe(false);
  });
});

describe('verdictLabel', () => {
  it('maps verdicts and missing', () => {
    expect(verdictLabel(undefined)).toBe('missing');
    expect(verdictLabel({ claimId: 'c', acId: 'AC1', result: 'pass', oracleTier: 'T0', contractIdentity: identity })).toBe('pass');
    expect(verdictLabel({ claimId: 'c', acId: 'AC1', result: 'need_human', oracleTier: 'T4', contractIdentity: identity })).toBe('need_human');
  });
});
