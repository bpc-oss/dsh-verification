import { describe, expect, it } from 'vitest';

import { applyEpochEvent, emptyIncrementalEpochState, foldTaskEpochs, type GoalLogEvent } from '../src/task-epoch';

/**
 * 会话事件数组必须稠密且 seq === 数组索引（dsh-session contiguity 契约：seq = log.length）。
 * 所有测试事件按此构造。
 */
function goalEvent(seq: number, data: Record<string, unknown>): GoalLogEvent {
  return { type: 'goal/change', data, seq, time: seq * 1000 };
}

function createEvent(seq: number, goalId = 'g1'): GoalLogEvent {
  return goalEvent(seq, { kind: 'goal/change', operation: 'create', goal: { id: goalId, revision: 1, phase: 'active', objective: 'x', maxGoalRounds: 10 } });
}

function completeEvent(seq: number, goalId = 'g1'): GoalLogEvent {
  return goalEvent(seq, { kind: 'goal/change', operation: 'complete', goal: { id: goalId, revision: 2, phase: 'complete', objective: 'x', maxGoalRounds: 10 } });
}

function userEvent(seq: number, kind = 'user'): GoalLogEvent {
  return { type: 'user/message', data: { source: { kind } }, seq, time: seq * 1000 };
}

describe('foldTaskEpochs (v9: goal-bound, no goal-less epoch)', () => {
  it('establishes an epoch from a root create with rootSeq = nearest authoritative user message', () => {
    const events = [userEvent(0), userEvent(1), createEvent(2)];
    const epochs = foldTaskEpochs(events, 's-1');
    expect(epochs).toHaveLength(1);
    expect(epochs[0]!.rootGoalId).toBe('g1');
    expect(epochs[0]!.rootSeq).toBe(1);
    expect(epochs[0]!.status).toBe('active');
  });

  it('FAILS CLOSED: create without a prior authoritative user message builds no epoch', () => {
    const events = [userEvent(0, 'goal'), createEvent(1)];
    expect(foldTaskEpochs(events, 's-1')).toHaveLength(0);
  });

  it('closes the epoch from the root goal terminal event', () => {
    const events = [userEvent(0), createEvent(1), completeEvent(2)];
    const epochs = foldTaskEpochs(events, 's-1');
    expect(epochs[0]!.status).toBe('closed');
    expect(epochs[0]!.closedSeq).toBe(2);
  });

  it('a later create after close starts a NEW epoch anchored after the close', () => {
    const events = [userEvent(0), createEvent(1), completeEvent(2), userEvent(3), createEvent(4, 'g2')];
    const epochs = foldTaskEpochs(events, 's-1');
    const second = epochs.find((epoch) => epoch.rootGoalId === 'g2');
    expect(second).toBeDefined();
    expect(second!.rootSeq).toBe(3);
    expect(epochs.find((epoch) => epoch.rootGoalId === 'g1')!.status).toBe('closed');
  });

  it('a child goal complete does NOT close the root epoch (different goal id)', () => {
    const events = [userEvent(0), createEvent(1), completeEvent(2, 'child-g')];
    const epochs = foldTaskEpochs(events, 's-1');
    expect(epochs[0]!.status).toBe('active');
  });

  it('crash between goal create commit and any epoch record: replay derives the same epoch from the goal log', () => {
    const events = [userEvent(0), createEvent(1)];
    const a = foldTaskEpochs(events, 's-1');
    const b = foldTaskEpochs(events, 's-1');
    expect(a).toEqual(b);
    expect(a[0]!.epochId).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('applyEpochEvent (incremental parity)', () => {
  it('derives the same epoch as the batch fold over the same event sequence', () => {
    const events = [userEvent(0), createEvent(1), completeEvent(2), userEvent(3), createEvent(4, 'g2')];
    const batch = foldTaskEpochs(events, 's-1');
    let state = emptyIncrementalEpochState();
    for (const event of events) {
      state = applyEpochEvent(state, event, 's-1');
    }
    expect(state.epochs).toEqual(batch);
  });
});
