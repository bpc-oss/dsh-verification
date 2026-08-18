import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEvalCli } from '../src/cli';

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

async function setup(): Promise<{ fixtures: string; config: string; out: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-eval-cli-'));
  const fixtures = path.join(dir, 'fixtures');
  const configDir = path.join(dir, 'configs');
  await mkdir(fixtures, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(fixtures, 'task.json'), JSON.stringify(task), 'utf8');
  const config = path.join(configDir, 'mock.json');
  await writeFile(config, JSON.stringify({ id: 'mock', label: 'Mock', mode: 'mock', samples: 1 }), 'utf8');
  const out = path.join(dir, 'report.json');
  return { fixtures, config, out };
}

describe('dsh-eval CLI', () => {
  it('runs a mock fixture and writes a JSON report', async () => {
    const { fixtures, config, out } = await setup();
    const logs: string[] = [];
    await runEvalCli({
      argv: ['run', '--fixtures', fixtures, '--config', config, '--out', out],
      log: (message) => logs.push(message),
      exit: () => undefined
    });
    const report = JSON.parse(await readFile(out, 'utf8'));
    expect(report.fixtureSetId).toBe('fixtures');
    expect(report.scorecards[0].passAt1).toBe(1);
  });

  it('builds a read-only manifest without writing configs', async () => {
    const { fixtures, config, out } = await setup();
    const manifestOut = path.join(path.dirname(out), 'manifest.json');
    const logs: string[] = [];
    await runEvalCli({
      argv: ['manifest', '--fixtures', fixtures, '--configs', path.dirname(config), '--out', manifestOut],
      log: (message) => logs.push(message),
      exit: () => undefined
    });
    const manifest = JSON.parse(await readFile(manifestOut, 'utf8'));
    expect(manifest.readOnly).toBe(true);
    expect(manifest.fixtures[0].id).toBe('t1');
  });
});
