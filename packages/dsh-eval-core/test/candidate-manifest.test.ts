import { describe, expect, it } from 'vitest';
import { buildCandidateManifest } from '../src/candidate-manifest';
import type { LoadedEvalFixture } from '../src/fixture-loader';
import { EvalRunConfigSchema } from '../src/run-config';
import type { EvalTaskCase } from '../src/task-case';

const fixture: EvalTaskCase = {
  id: 'f1',
  title: 'T',
  prompt: 'P',
  difficulty: 'simple',
  workspaceSeed: [],
  contract: {
    goal: 'G',
    acceptanceCriteria: [{ id: 'AC1', desc: 'D', oracleHint: 'file' }],
    constraints: [],
    inputs: [],
    outOfScope: []
  },
  oracle: { kind: 'file_exists', path: 'x' },
  tags: []
};
const loaded: LoadedEvalFixture = {
  fixture,
  sourcePath: '/tmp/f1.json',
  sha256: 'abc',
  trustLevel: 'untrusted'
};
const config = EvalRunConfigSchema.parse({ id: 'c1', label: 'C', mode: 'mock' });

describe('candidate manifest', () => {
  it('is read-only and includes fixture trust + hashes', () => {
    const manifest = buildCandidateManifest({
      fixtureSetId: 'pack',
      fixtures: [loaded],
      configs: [config],
      generatedAt: 'fixed'
    });
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.readOnly).toBe(true);
    expect(manifest.fixtures[0]).toMatchObject({ id: 'f1', sha256: 'abc', trustLevel: 'untrusted' });
    expect(manifest.configs[0].id).toBe('c1');
  });
});
