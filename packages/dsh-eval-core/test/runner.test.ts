import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvalRunConfigSchema } from '../src/run-config';
import { runEvalCase } from '../src/runner';
import type { EvalTaskCase } from '../src/task-case';

const config = EvalRunConfigSchema.parse({ id: 'mock', label: 'Mock', mode: 'mock', samples: 1 });
const task: EvalTaskCase = {
  id: 'hello',
  title: 'Create hello.txt',
  prompt: 'Create hello.txt containing hi.',
  difficulty: 'simple',
  workspaceSeed: [{ path: 'README.md', content: '# seed\n' }],
  contract: {
    goal: 'Create hello.txt',
    acceptanceCriteria: [{ id: 'AC1', desc: 'hello.txt exists', oracleHint: 'file' }],
    constraints: [],
    inputs: [],
    outOfScope: []
  },
  mockScenario: {
    runnerResponses: [
      JSON.stringify({
        calls: [{ tool: 'write_file', input: { path: 'hello.txt', content: 'hi\n' } }],
        final: 'done'
      })
    ]
  },
  oracle: { kind: 'file_exists', path: 'hello.txt' },
  tags: []
};

describe('runEvalCase', () => {
  it('seeds workspace, applies mock tool calls, and passes the file oracle', async () => {
    const outcome = await runEvalCase(task, config);
    expect(outcome.passed).toBe(true);
    expect(outcome.finalStatus).toBe('done');
    expect(outcome.failureKind).toBe('none');
    await expect(readFile(path.join(outcome.workspaceRoot, 'hello.txt'), 'utf8')).resolves.toBe('hi\n');
  });

  it('returns oracle_fail when the mock writes the wrong file', async () => {
    const wrongTask: EvalTaskCase = {
      ...task,
      id: 'wrong',
      mockScenario: {
        runnerResponses: [
          JSON.stringify({
            calls: [{ tool: 'write_file', input: { path: 'other.txt', content: 'nope\n' } }],
            final: 'done'
          })
        ]
      }
    };
    const outcome = await runEvalCase(wrongTask, config);
    expect(outcome.passed).toBe(false);
    expect(outcome.failureKind).toBe('oracle_fail');
  });

  it('rejects a live run without a DSH host', async () => {
    const liveConfig = EvalRunConfigSchema.parse({ id: 'live', label: 'Live', mode: 'live', samples: 1 });
    const outcome = await runEvalCase(task, liveConfig);
    expect(outcome.passed).toBe(false);
    expect(outcome.failureKind).toBe('runner_error');
    expect(outcome.notes?.[0]).toMatch(/DSH agent host/i);
  });
});
