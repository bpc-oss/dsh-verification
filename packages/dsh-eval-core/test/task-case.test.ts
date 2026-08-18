import { describe, expect, it } from 'vitest';
import { EvalTaskCaseSchema } from '../src/task-case';

const base = {
  id: 't1',
  title: 'Create file',
  prompt: 'Create hello.txt',
  difficulty: 'simple',
  workspaceSeed: [],
  contract: {
    goal: 'Create hello.txt',
    acceptanceCriteria: [{ id: 'AC1', desc: 'hello.txt exists', oracleHint: 'file' }],
    constraints: [],
    inputs: [],
    outOfScope: []
  },
  mockScenario: {
    runnerResponses: [JSON.stringify({ calls: [], final: 'done' })]
  },
  oracle: { kind: 'file_exists', path: 'hello.txt' },
  tags: []
};

describe('EvalTaskCaseSchema', () => {
  it('parses a valid task case', () => {
    expect(EvalTaskCaseSchema.parse(base).id).toBe('t1');
  });

  it('rejects a fixture-declared trusted field because trust must be injected', () => {
    expect(() => EvalTaskCaseSchema.parse({ ...base, trusted: true })).toThrow();
  });

  it('rejects duplicate workspace seed paths', () => {
    expect(() =>
      EvalTaskCaseSchema.parse({
        ...base,
        workspaceSeed: [
          { path: 'a.txt', content: '1' },
          { path: './a.txt', content: '2' }
        ]
      })
    ).toThrow();
  });
});
