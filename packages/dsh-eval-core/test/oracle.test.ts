import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DisabledCommandOracleExecutor, MockCommandOracleExecutor } from '../src/command-executor';
import { evaluateEvalOracle } from '../src/oracle';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-eval-oracle-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  // Vitest will clean temp dirs on most platforms; keep list for debugging only.
});

describe('evaluateEvalOracle', () => {
  it('checks file_exists and file_contains', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'a.txt'), 'hello world', 'utf8');
    await expect(evaluateEvalOracle(root, { kind: 'file_exists', path: 'a.txt' })).resolves.toBe(true);
    await expect(evaluateEvalOracle(root, { kind: 'file_contains', path: 'a.txt', text: 'world' })).resolves.toBe(true);
    await expect(evaluateEvalOracle(root, { kind: 'file_not_contains', path: 'a.txt', text: 'nope' })).resolves.toBe(true);
  });

  it('fails closed when no qualified command executor is available', async () => {
    const root = await tempRoot();
    await expect(
      evaluateEvalOracle(root, { kind: 'command_exit_code', cmd: 'echo', args: [], expectedExitCode: 0 })
    ).resolves.toBe(false);
  });

  it('uses a mock command executor deterministically', async () => {
    const root = await tempRoot();
    const executor = new MockCommandOracleExecutor([{ cmd: 'node', args: ['-e', '0'], exitCode: 0 }]);
    await expect(
      evaluateEvalOracle(root, { kind: 'command_exit_code', cmd: 'node', args: ['-e', '0'], expectedExitCode: 0 }, { commandExecutor: executor })
    ).resolves.toBe(true);
    expect(executor.calls).toHaveLength(1);
  });

  it('does not invoke DisabledCommandOracleExecutor for file oracles', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'x'), 'x', 'utf8');
    await expect(
      evaluateEvalOracle(root, { kind: 'file_exists', path: 'x' }, { commandExecutor: new DisabledCommandOracleExecutor() })
    ).resolves.toBe(true);
  });
});
