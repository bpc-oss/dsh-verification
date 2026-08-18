import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSha256 } from './trust';
import type { LoadedEvalFixture } from './fixture-loader';
import type { EvalRunConfig } from './run-config';
import { EvalRunConfigSchema } from './run-config';

export interface CandidateFixtureEntry {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly trustLevel: string;
}

export interface CandidateConfigEntry {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
}

export interface CandidateManifest {
  readonly schemaVersion: 1;
  readonly fixtureSetId: string;
  readonly generatedAt: string;
  readonly readOnly: true;
  readonly fixtures: CandidateFixtureEntry[];
  readonly configs: CandidateConfigEntry[];
}

export function buildCandidateManifest(input: {
  fixtureSetId: string;
  fixtures: LoadedEvalFixture[];
  configs: EvalRunConfig[];
  generatedAt?: string;
}): CandidateManifest {
  return {
    schemaVersion: 1,
    fixtureSetId: input.fixtureSetId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    readOnly: true,
    fixtures: input.fixtures.map((entry) => ({
      id: entry.fixture.id,
      path: entry.sourcePath,
      sha256: entry.sha256,
      trustLevel: entry.trustLevel
    })),
    configs: input.configs.map((config) => ({
      id: config.id,
      path: config.id,
      sha256: fileSha256(JSON.stringify(config))
    }))
  };
}

export async function loadEvalRunConfigs(input: string | URL): Promise<EvalRunConfig[]> {
  const dir = input instanceof URL ? fileURLToPath(input) : input;
  const entries = await readdir(dir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const configs: EvalRunConfig[] = [];
  for (const fileName of jsonFiles) {
    const filePath = path.join(dir, fileName);
    const raw = await readFile(filePath, 'utf8');
    const config = EvalRunConfigSchema.parse(JSON.parse(raw));
    configs.push(config);
  }
  return configs;
}
