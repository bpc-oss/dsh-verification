import { describe, expect, it } from 'vitest';
import type { BoundEvidence, ContractIdentity, EvidenceType, SelectorV1 } from '@bpc-oss/dsh-evidence';
import { normalizedArgsHash as hash } from '@bpc-oss/dsh-evidence';
import { createMemoryBlobStore, storePayload } from '../src/evidence-store';
import { bindSelectorForAc, findDuplicateSelectors } from '../src/binders';
import type { AcceptanceCriterion } from '@bpc-oss/dsh-evidence';
import type { EvidenceRef, CaptureFailureRecord } from '../src/projection';

const identity: ContractIdentity = { contractId: 'c-1', revision: 0, contractContentHash: 'cc', basisHash: 'bb', sessionId: 's-1' };

function selector(toolIdentity: string, argsHash: string, evidenceType: EvidenceType): SelectorV1 {
  return { schemaVersion: 1, toolIdentity, normalizedArgsHash: argsHash, evidenceType };
}

function ref(callId: string, tool: string, args: Record<string, unknown>, type: EvidenceType, resultSeq: number, blobHash: string): EvidenceRef {
  return { callId, toolIdentity: tool, normalizedArgsHash: hash(args), blobHash, truncated: false, originalLength: 1, schemaVersion: 1, contractIdentity: identity, evidenceType: type, resultSeq, summary: `${tool} ${type}` };
}

function failure(callId: string, tool: string, args: Record<string, unknown>, type: EvidenceType, resultSeq: number): CaptureFailureRecord {
  return { contractIdentity: identity, callId, toolIdentity: tool, normalizedArgsHash: hash(args), evidenceType: type, resultSeq, error: 'boom' };
}

async function makeBlob(store: ReturnType<typeof createMemoryBlobStore>, tool: string, argsHash: string, type: EvidenceType, failed = false): Promise<string> {
  const captured = { callId: 'x', toolIdentity: tool, schemaVersion: 1, normalizedArgs: {}, normalizedArgsHash: argsHash, evidenceType: type, payload: { exitCode: 0 }, producedBy: 'tool', failed, contractIdentity: identity };
  const stored = await storePayload(store, captured);
  return stored.blobKey;
}

describe('bindSelectorForAc (v9 exact-only, highest committed seq, one-evidence-one-AC)', () => {
  it('binds the exact selector match', async () => {
    const store = createMemoryBlobStore();
    const args = { command: 'npm test' };
    const blob = await makeBlob(store, 'bash', hash(args), 'test_run');
    const outcome = await bindSelectorForAc(
      { id: 'AC1', desc: 'run tests', oracleHint: 'test', selector: selector('bash', hash(args), 'test_run') },
      { contractIdentity: identity, refs: [ref('call-1', 'bash', args, 'test_run', 7, blob)], captureFailures: [], loadBlob: (k) => store.read(k) },
      () => 'test_run'
    );
    expect(outcome.kind).toBe('bound');
    if (outcome.kind === 'bound') {
      expect(outcome.evidence).toMatchObject({ acId: 'AC1', selectorRef: 'c-1:0:AC1', callId: 'call-1' });
    }
  });

  it('does NOT bind an echo PASS impersonating npm test', async () => {
    const store = createMemoryBlobStore();
    const testArgs = { command: 'npm test' };
    const echoArgs = { command: 'echo PASS' };
    const blob = await makeBlob(store, 'bash', hash(echoArgs), 'test_run');
    const outcome = await bindSelectorForAc(
      { id: 'AC1', desc: 'run tests', oracleHint: 'test', selector: selector('bash', hash(testArgs), 'test_run') },
      { contractIdentity: identity, refs: [ref('call-1', 'bash', echoArgs, 'test_run', 7, blob)], captureFailures: [], loadBlob: (k) => store.read(k) },
      () => 'test_run'
    );
    expect(outcome.kind).toBe('no-evidence');
  });

  it('a capture-failure at a HIGHER seq than an old PASS wins (no cherry-pick of the old PASS)', async () => {
    const store = createMemoryBlobStore();
    const args = { command: 'npm test' };
    const blob = await makeBlob(store, 'bash', hash(args), 'test_run');
    const outcome = await bindSelectorForAc(
      { id: 'AC1', desc: 'run tests', oracleHint: 'test', selector: selector('bash', hash(args), 'test_run') },
      {
        contractIdentity: identity,
        refs: [ref('call-1', 'bash', args, 'test_run', 5, blob)],
        captureFailures: [failure('call-2', 'bash', args, 'test_run', 9)],
        loadBlob: (k) => store.read(k)
      },
      () => 'test_run'
    );
    expect(outcome.kind).toBe('capture-failure');
  });

  it('a missing/corrupt blob yields missing-blob (fail closed)', async () => {
    const args = { command: 'npm test' };
    const outcome = await bindSelectorForAc(
      { id: 'AC1', desc: 'run tests', oracleHint: 'test', selector: selector('bash', hash(args), 'test_run') },
      { contractIdentity: identity, refs: [ref('call-1', 'bash', args, 'test_run', 7, 'deadbeef')], captureFailures: [], loadBlob: async () => null },
      () => 'test_run'
    );
    expect(outcome.kind).toBe('missing-blob');
  });

  it('AC without a frozen selector is not-harnessed (routes to T2/T4)', async () => {
    const outcome = await bindSelectorForAc(
      { id: 'AC1', desc: 'review my work', oracleHint: 'review' },
      { contractIdentity: identity, refs: [], captureFailures: [], loadBlob: async () => null },
      () => 'assistant_response'
    );
    expect(outcome.kind).toBe('not-harnessed');
  });
});

describe('bindSelectorForAc (v9.1 file-family compatibility)', () => {
  it('binds a read quote against a file_diff selector (same tool + args, different derived type)', async () => {
    const store = createMemoryBlobStore();
    const args = { path: 'artifact.txt' };
    const blob = await makeBlob(store, 'read', hash(args), 'quote_with_location');
    const outcome = await bindSelectorForAc(
      { id: 'AC1', desc: 'artifact contains DONE', oracleHint: 'file', selector: selector('read', hash(args), 'file_diff') },
      { contractIdentity: identity, refs: [ref('call-1', 'read', args, 'quote_with_location', 7, blob)], captureFailures: [], loadBlob: (k) => store.read(k) },
      () => 'file_diff'
    );
    expect(outcome.kind).toBe('bound');
  });

  it('still rejects CROSS-family type mismatches (test_run vs command_output selector)', async () => {
    const store = createMemoryBlobStore();
    const args = { command: 'npm test' };
    const blob = await makeBlob(store, 'bash', hash(args), 'test_run');
    const outcome = await bindSelectorForAc(
      { id: 'AC1', desc: 'run tests', oracleHint: 'run', selector: selector('bash', hash(args), 'command_output') },
      { contractIdentity: identity, refs: [ref('call-1', 'bash', args, 'test_run', 7, blob)], captureFailures: [], loadBlob: (k) => store.read(k) },
      () => 'command_output'
    );
    expect(outcome.kind).toBe('no-evidence');
  });

  it('propagates a file-family capture failure at the highest seq (fail closed)', async () => {
    const store = createMemoryBlobStore();
    const args = { path: 'artifact.txt' };
    const blob = await makeBlob(store, 'read', hash(args), 'quote_with_location');
    const outcome = await bindSelectorForAc(
      { id: 'AC1', desc: 'artifact contains DONE', oracleHint: 'file', selector: selector('read', hash(args), 'file_diff') },
      {
        contractIdentity: identity,
        refs: [ref('call-1', 'read', args, 'quote_with_location', 5, blob)],
        captureFailures: [failure('call-2', 'read', args, 'quote_with_location', 9)],
        loadBlob: (k) => store.read(k)
      },
      () => 'file_diff'
    );
    expect(outcome.kind).toBe('capture-failure');
  });
});

describe('findDuplicateSelectors', () => {
  it('rejects two ACs sharing one exact selector', () => {
    const acs: AcceptanceCriterion[] = [
      { id: 'AC1', desc: 'a', oracleHint: 'test', selector: selector('bash', hash({ command: 'npm test' }), 'test_run') },
      { id: 'AC2', desc: 'b', oracleHint: 'test', selector: selector('bash', hash({ command: 'npm test' }), 'test_run') }
    ];
    expect(findDuplicateSelectors(acs)).toHaveLength(1);
  });
});
