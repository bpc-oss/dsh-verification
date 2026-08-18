import { describe, expect, it, vi } from 'vitest';
import { DshEvalSubject, type DshAgentHandleLike, type DshAgentHost } from '../src/dsh-subject';
import { EvalRunConfigSchema } from '../src/run-config';
import type { EvalTaskCase } from '../src/task-case';

const task: EvalTaskCase = {
  id: 'live',
  title: 'Live task',
  prompt: 'Do the thing',
  difficulty: 'simple',
  workspaceSeed: [],
  contract: {
    goal: 'Do the thing',
    acceptanceCriteria: [{ id: 'AC1', desc: 'done', oracleHint: 'file' }],
    constraints: [],
    inputs: [],
    outOfScope: []
  },
  oracle: { kind: 'file_exists', path: 'x' },
  tags: []
};
const config = EvalRunConfigSchema.parse({ id: 'live', label: 'Live', mode: 'live', samples: 1 });

describe('DshEvalSubject', () => {
  it('creates a subagent in the workspace, follows up, waits, and disposes', async () => {
    const followup = vi.fn();
    const whenIdle = vi.fn().mockResolvedValue(undefined);
    const dispose = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({
      agent: { followup, whenIdle },
      dispose
    } satisfies DshAgentHandleLike);
    const host: DshAgentHost = { create };

    const subject = new DshEvalSubject(host, { createSessionId: () => 'session-1' });
    const result = await subject.run({ taskCase: task, config, workspaceRoot: '/tmp/ws' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        meta: { cwd: '/tmp/ws', origin: 'subagent' },
        agentOptions: { provider: undefined, model: undefined, maxTokens: undefined }
      })
    );
    expect(followup).toHaveBeenCalledTimes(1);
    expect(whenIdle).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(result.finalStatus).toBe('done');
  });
});
