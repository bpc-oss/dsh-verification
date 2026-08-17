import { describe, expect, it } from 'vitest';

import { scanForDirectHumanInput } from '../src/human-turn';

describe('scanForDirectHumanInput', () => {
  it('detects a direct human message in the current turn', () => {
    const events = [
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'user' } } },
      { type: 'assistant/message', data: {} }
    ];
    expect(scanForDirectHumanInput(events)).toBe(true);
  });

  it('ignores non-human sources (goal round, tool, plugin)', () => {
    const events = [
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'goal', goalId: 'g1', revision: 1, round: 2 } } },
      { type: 'user/message', data: { source: { kind: 'tool', callId: 'c1' } } }
    ];
    expect(scanForDirectHumanInput(events)).toBe(false);
  });

  it('stops at the turn boundary', () => {
    const events = [
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'user' } } },
      { type: 'turn/end', data: {} },
      { type: 'user/message', data: { source: { kind: 'goal', goalId: 'g1', revision: 1, round: 1 } } }
    ];
    // 当前 turn（turn/end 之后）只有 goal 消息 → false
    expect(scanForDirectHumanInput(events)).toBe(false);
  });

  it('returns false for an empty log', () => {
    expect(scanForDirectHumanInput([])).toBe(false);
  });
});
