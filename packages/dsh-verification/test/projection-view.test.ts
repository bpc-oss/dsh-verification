/**
 * P0 修复 #1 回归：投影 view 输出必须通过 `VerificationProjectionSchema`
 * （含 goal/change 的会话历史加载曾因 schema 与产出不一致整体不可读）。
 * 契约统一：schema 与 FoldedEpoch 对齐（createdSeq 必填、closedSeq 可选、contentHash 可选），
 * view 显式白名单输出。
 */
import { describe, expect, it } from 'vitest';

import { emptyVerificationProjection, EvidenceRefSchema, extractVerificationRecords, taskEpochViews, VerificationProjectionSchema } from '../src/projection';
import type { FoldedEpoch } from '../src/task-epoch';

function epoch(partial: Partial<FoldedEpoch> & { epochId: string; rootSeq: number; rootGoalId: string; createdSeq: number; status: 'active' | 'closed' }): FoldedEpoch {
  return { ...partial };
}

describe('taskEpochViews → VerificationProjectionSchema (P0 #1 regression)', () => {
  it('tolerates evidence without authority scope and policy facts (legacy pre-scope records)', () => {
    expect(EvidenceRefSchema.safeParse({
      callId: 'c', toolIdentity: 'bash', normalizedArgsHash: 'h', blobHash: 'b', truncated: false,
      originalLength: 1, schemaVersion: 1,
      contractIdentity: { contractId: 'c', revision: 0, contractContentHash: 'h', basisHash: 'b', sessionId: 's' },
      evidenceType: 'test_run', resultSeq: 1, summary: ''
    }).success).toBe(true);
  });

  it('accepts legacy verification records missing authority scope (backward-compat read path)', () => {
    const records = extractVerificationRecords([{
      type: 'verification/change', seq: 1, time: 1,
      data: { kind: 'verification/change', version: 1, record: { kind: 'gate', entry: { at: 1, status: 'done', mode: 'enforce', reasons: [] } } }
    }]);
    expect(records).toHaveLength(1);
    expect(records[0].record.kind).toBe('gate');
  });

  it('active + closed epochs validate against the projection schema (contentHash optional, no unknown keys)', () => {
    const epochs: FoldedEpoch[] = [
      epoch({ epochId: 'e-1', rootSeq: 7, rootGoalId: 'g-1', createdSeq: 254, status: 'active' }),
      epoch({ epochId: 'e-2', rootSeq: 3, rootGoalId: 'g-0', createdSeq: 10, closedSeq: 40, status: 'closed' })
    ];
    const views = taskEpochViews(epochs);
    expect(views[0]).toEqual({ epochId: 'e-1', rootSeq: 7, rootGoalId: 'g-1', status: 'active', createdSeq: 254 });
    expect(views[1]).toEqual({ epochId: 'e-2', rootSeq: 3, rootGoalId: 'g-0', status: 'closed', createdSeq: 10, closedSeq: 40 });

    const projection = { ...emptyVerificationProjection(), taskEpochs: views };
    const validated = VerificationProjectionSchema.safeParse(projection);
    expect(validated.success).toBe(true);
  });

  it('full projection view with evidence/verdicts/epochs round-trips (session history load path)', () => {
    const epochs: FoldedEpoch[] = [epoch({ epochId: 'e-1', rootSeq: 7, rootGoalId: 'g-1', createdSeq: 254, status: 'active' })];
    const base = {
      ...emptyVerificationProjection(),
      plan: {
        authorityScope: { epochId: 'e-1', rootGoalId: 'g-1', ownerAgentId: 'agent-1' },
        contract: {
          ref: {
            contractId: 'c',
            revision: 0,
            contractContentHash: 'cc',
            sourceBasis: { sessionId: 's', entries: [], basisHash: 'bb' }
          },
          origin: 'independent-capture' as const,
          goal: 'x',
          acceptanceCriteria: [{ id: 'A', desc: 'd', oracleHint: 'test' as const, selector: { schemaVersion: 1 as const, toolIdentity: 'bash', normalizedArgsHash: 'h', evidenceType: 'test_run' as const } }],
          constraints: [],
          inputs: [],
          outOfScope: []
        }
      },
      verdicts: {},
      taskEpochs: taskEpochViews(epochs)
    };
    const validated = VerificationProjectionSchema.safeParse(base);
    expect(validated.success).toBe(true);
    expect(validated.success ? validated.data.taskEpochs.length : -1).toBe(1);
  });
});
