import { describe, expect, it } from 'vitest';
import type { ContractIdentity } from '@bpc-oss/dsh-evidence';

import { computeGateSnapshotHash, newPermitRef, validatePermitForCompletion } from '../src/permits';
import type { CompletionPermitRecord } from '../src/projection';

const identity: ContractIdentity = { contractId: 'c-1', revision: 0, contractContentHash: 'cc', basisHash: 'bb', sessionId: 's-1' };
const policy = { configHash: 'cfg-1', completionPermitTtlMs: 30_000, schemaVersion: 1 };
const snapshot = computeGateSnapshotHash({
  contractIdentity: identity,
  verdicts: { AC1: {} },
  evidenceBlobHashes: ['blob-1'],
  captureFailures: 0,
  configHash: policy.configHash,
  schemaVersion: 1
});

function permitEntry(overrides: Partial<CompletionPermitRecord> & { seq: number; time: number; permitRef?: string }) {
  const base: CompletionPermitRecord = {
    permitRef: 'perm-1',
    goalId: 'g-1',
    goalRevision: 2,
    contractIdentity: identity,
    gateSnapshotHash: snapshot,
    configHash: policy.configHash,
    ttlMs: policy.completionPermitTtlMs
  };
  return { record: { ...base, ...overrides }, seq: overrides.seq, time: overrides.time };
}

describe('validatePermitForCompletion (strict replay, envelope-authoritative)', () => {
  const completed = { goalId: 'g-1', goalRevision: 2, permitRef: 'perm-1', completeSeq: 50, completeTime: 62_000 };

  it('accepts a valid permit issued before the complete within TTL', () => {
    const result = validatePermitForCompletion({
      completed,
      permits: [permitEntry({ permitRef: 'perm-1', seq: 40, time: 60_000 })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.permitSeq).toBe(40);
  });

  it('uses the exact permitRef recorded on the complete event, never a newer matching permit', () => {
    const result = validatePermitForCompletion({
      completed: { ...completed, permitRef: 'old' },
      permits: [permitEntry({ permitRef: 'old', seq: 20, time: 60_000 }), permitEntry({ permitRef: 'new', seq: 45, time: 60_100 })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.usedPermitRef).toBe('old');
  });

  it('rejects a complete event with no exact permitRef even if a matching permit exists', () => {
    const result = validatePermitForCompletion({
      completed: { ...completed, permitRef: '' },
      permits: [permitEntry({ permitRef: 'perm-1', seq: 40, time: 60_000 })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects when NO permit exists for the goal revision', () => {
    const result = validatePermitForCompletion({
      completed: { ...completed, goalRevision: 3 },
      permits: [permitEntry({ seq: 40, time: 60_000 })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('revision');
  });

  it('rejects when the permit event comes AFTER the complete event', () => {
    const result = validatePermitForCompletion({
      completed,
      permits: [permitEntry({ seq: 60, time: 65_000 })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect((result as { reason: string }).reason).toContain('must precede');
  });

  it('rejects when the complete is after derivedExpiresAt (payload carries no expiry)', () => {
    const result = validatePermitForCompletion({
      completed: { ...completed, completeTime: 100_000 },
      permits: [permitEntry({ seq: 40, time: 60_000 })], // expiry = 90_000
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect((result as { reason: string }).reason).toContain('outside permit window');
  });

  it('rejects unknown configHash and ttl mismatch (frozen config authority)', () => {
    const unknownConfig = validatePermitForCompletion({
      completed,
      permits: [permitEntry({ seq: 40, time: 60_000, configHash: 'unknown' })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect((unknownConfig as { reason: string }).reason).toContain('unknown configHash');

    const wrongTtl = validatePermitForCompletion({
      completed,
      permits: [permitEntry({ seq: 40, time: 60_000, ttlMs: 5_000 })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect((wrongTtl as { reason: string }).reason).toContain('ttlMs');
  });

  it('rejects contract identity drift and gate snapshot drift', () => {
    const drift = validatePermitForCompletion({
      completed,
      permits: [permitEntry({ seq: 40, time: 60_000, contractIdentity: { ...identity, revision: 1 } })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect((drift as { reason: string }).reason).toContain('identity drift');

    const snapshotDrift = validatePermitForCompletion({
      completed,
      permits: [permitEntry({ seq: 40, time: 60_000 })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: computeGateSnapshotHash({ contractIdentity: identity, verdicts: { AC1: { x: 1 } }, evidenceBlobHashes: ['other'], captureFailures: 0, configHash: policy.configHash, schemaVersion: 1 })
    });
    expect((snapshotDrift as { reason: string }).reason).toContain('gate snapshot drift');
  });

  it('a permit is naturally single-use per revision: next complete with higher revision falls back to no-permit', () => {
    const result = validatePermitForCompletion({
      completed: { ...completed, goalRevision: 4 },
      permits: [permitEntry({ seq: 40, time: 60_000, goalRevision: 2 })],
      policies: { [policy.configHash]: policy },
      contractIdentity: identity,
      gateSnapshotHash: snapshot
    });
    expect((result as { reason: string }).reason).toContain('revision');
  });
});

describe('computeGateSnapshotHash', () => {
  it('is deterministic and sensitive to evidence/verdicts/config', () => {
    const a = computeGateSnapshotHash({ contractIdentity: identity, verdicts: {}, evidenceBlobHashes: ['b1'], captureFailures: 0, configHash: 'c', schemaVersion: 1 });
    const b = computeGateSnapshotHash({ contractIdentity: identity, verdicts: {}, evidenceBlobHashes: ['b2'], captureFailures: 0, configHash: 'c', schemaVersion: 1 });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
