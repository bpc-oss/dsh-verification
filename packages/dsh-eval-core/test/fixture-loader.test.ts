import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEvalFixturePack, loadEvalFixtures } from '../src/fixture-loader';

const task = {
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
    runnerResponses: [JSON.stringify({ calls: [{ tool: 'write_file', input: { path: 'hello.txt', content: 'hi\n' } }], final: 'done' })]
  },
  oracle: { kind: 'file_exists', path: 'hello.txt' },
  tags: []
};

async function makeFixtureDir(extra: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-eval-fixtures-'));
  await writeFile(path.join(dir, 'task.json'), JSON.stringify({ ...task, ...extra }), 'utf8');
  return dir;
}

describe('fixture-loader', () => {
  it('loads a fixture and injects untrusted trustLevel', async () => {
    const dir = await makeFixtureDir();
    const loaded = await loadEvalFixturePack(dir, { source: 'external' });
    expect(loaded).toHaveLength(1);
    expect(loaded[0].trustLevel).toBe('untrusted');
    expect(loaded[0].fixture.id).toBe('t1');
  });

  it('rejects fixture-declared trust fields by default', async () => {
    const dir = await makeFixtureDir({ trusted: true });
    await expect(loadEvalFixtures(dir)).rejects.toThrow(/trust fields/i);
  });

  it('can ignore trust fields when configured', async () => {
    const dir = await makeFixtureDir({ trusted: true });
    const loaded = await loadEvalFixtures(dir, { onTrustField: 'ignore' });
    expect(loaded).toHaveLength(1);
  });

  it('marks allowlisted hashes', async () => {
    const dir = await makeFixtureDir();
    const raw = JSON.stringify({ ...task });
    const { fileSha256 } = await import('../src/trust');
    const hash = fileSha256(raw);
    const loaded = await loadEvalFixturePack(dir, { source: 'external', allowlistHashes: new Set([hash]) });
    expect(loaded[0].trustLevel).toBe('allowlisted');
  });

  it('rejects command_exit_code oracles on untrusted fixtures', async () => {
    const dir = await makeFixtureDir({
      oracle: { kind: 'command_exit_code', cmd: 'echo', args: [], expectedExitCode: 0 }
    });
    await expect(loadEvalFixtures(dir)).rejects.toThrow(/command_exit_code.*untrusted/i);
  });

  it('allows command_exit_code oracles on builtin fixtures', async () => {
    const dir = await makeFixtureDir({
      oracle: { kind: 'command_exit_code', cmd: 'echo', args: [], expectedExitCode: 0 }
    });
    const loaded = await loadEvalFixturePack(dir, { source: 'builtin' });
    expect(loaded[0].trustLevel).toBe('builtin');
  });
});
