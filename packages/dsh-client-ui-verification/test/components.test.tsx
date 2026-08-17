import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TaskContract, Verdict } from '@bpc-oss/dsh-evidence';
import type { EvidenceRef, GateSummary, VerificationProjection } from '@bpc-oss/dsh-verification';

import { ContractCard, EvidencePanel, VerificationDock, VerdictSummary } from '../src/components';

const identity = { contractId: 'c-1', revision: 0, contractContentHash: 'cc', basisHash: 'bb', sessionId: 's-1' };

const contract: TaskContract = {
  ref: { contractId: 'c-1', revision: 0, contractContentHash: 'cc', sourceBasis: { sessionId: 's-1', entries: [], basisHash: 'bb' } },
  origin: 'independent-capture',
  goal: 'Make the tests pass',
  acceptanceCriteria: [
    { id: 'AC1', desc: 'run tests', oracleHint: 'test', selector: { schemaVersion: 1, toolIdentity: 'bash', normalizedArgsHash: 'h1', evidenceType: 'test_run' } },
    { id: 'AC2', desc: 'fix parser', oracleHint: 'file' }
  ],
  constraints: [{ id: 'C1', desc: 'no legacy', check: 'path:src/legacy' }]
};

const verdicts: Record<string, Verdict> = {
  AC1: { claimId: 'call-1', acId: 'AC1', result: 'pass', oracleTier: 'T0', contractIdentity: identity },
  AC2: { claimId: 'call-2', acId: 'AC2', result: 'fail', oracleTier: 'T2', contractIdentity: identity, detail: 'edge case broken' }
};

const evidenceRefs: EvidenceRef[] = [
  { callId: 'call-1', toolIdentity: 'bash', normalizedArgsHash: 'h1', blobHash: 'b1', truncated: false, originalLength: 5, schemaVersion: 1, contractIdentity: identity, evidenceType: 'test_run', resultSeq: 3, summary: 'bash test_run exit:0' }
];

const gateLog: GateSummary[] = [{ at: 1, status: 'failed', mode: 'enforce', reasons: ['AC2 failed: edge case broken'] }];

const projection: VerificationProjection = {
  taskEpochs: [],
  plan: { contract, frozenAt: { callId: 'f1', at: 1 } },
  evidenceRefs,
  captureFailures: [],
  challenges: {},
  completionPermits: [],
  verdicts,
  gateLog,
  updatedAt: 1
};

describe('ContractCard', () => {
  it('renders goal and AC list with internal fields moved to title tooltip', () => {
    const html = renderToStaticMarkup(<ContractCard contract={contract} />);
    expect(html).toContain('Make the tests pass');
    expect(html).toContain('AC1');
    // internal verification fields (oracle hint, frozen selector, evidence type) live in the title attribute only
    expect(html).toContain('title="hint.test · bash · h1 · test_run"');
    expect(html).toContain('title="hint.file"');
    expect(html).not.toContain('verification-ac-hint');
    expect(html).not.toContain('verification-ac-selector');
    expect(html).toContain('src/legacy');
  });
});

describe('VerdictSummary', () => {
  it('renders per-AC verdict labels and tiers', () => {
    const html = renderToStaticMarkup(<VerdictSummary contract={contract} verdicts={verdicts} gateLog={gateLog} />);
    expect(html).toContain('data-verdict="pass"');
    expect(html).toContain('data-verdict="fail"');
    expect(html).toContain('edge case broken');
    expect(html).toContain('gate-failed');
  });
});

describe('EvidencePanel', () => {
  it('renders evidence refs and the truncated marker', () => {
    const html = renderToStaticMarkup(<EvidencePanel evidence={[{ ...evidenceRefs[0]!, truncated: true }]} />);
    expect(html).toContain('test_run');
    expect(html).toContain('truncated');
  });

  it('renders the empty state', () => {
    const html = renderToStaticMarkup(<EvidencePanel evidence={[]} />);
    expect(html).toContain('evidence-empty');
  });
});

describe('VerificationDock', () => {
  it('renders nothing without a projection', () => {
    const html = renderToStaticMarkup(<VerificationDock useProjection={() => null} />);
    expect(html).toBe('');
  });

  it('renders the full panel when a projection exists', () => {
    const html = renderToStaticMarkup(<VerificationDock useProjection={() => projection} />);
    expect(html).toContain('data-verification-dock');
    expect(html).toContain('Make the tests pass');
    expect(html).toContain('data-verdict="fail"');
  });
});
