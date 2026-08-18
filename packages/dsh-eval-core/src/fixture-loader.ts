import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSha256, hasTrustField, resolveTrustLevel, stripTrustFields, type TrustLevel } from './trust';
import { EvalTaskCaseSchema, type EvalTaskCase } from './task-case';

export interface LoadedEvalFixture {
  readonly fixture: EvalTaskCase;
  readonly sourcePath: string;
  readonly sha256: string;
  readonly trustLevel: TrustLevel;
}

export interface LoadEvalFixturesOptions {
  readonly source?: 'builtin' | 'external';
  readonly allowlistHashes?: ReadonlySet<string>;
  readonly onTrustField?: 'reject' | 'ignore';
}

function resolveInput(input: string | URL): string {
  return input instanceof URL ? fileURLToPath(input) : input;
}

function resolveSource(source: 'builtin' | 'external' | undefined): 'builtin' | 'external' {
  return source ?? 'external';
}

export async function loadEvalFixtures(input: string | URL, options: LoadEvalFixturesOptions = {}): Promise<EvalTaskCase[]> {
  const loaded = await loadEvalFixturePack(input, options);
  return loaded.map((entry) => entry.fixture);
}

export async function loadEvalFixturePack(input: string | URL, options: LoadEvalFixturesOptions = {}): Promise<LoadedEvalFixture[]> {
  const dir = resolveInput(input);
  const entries = await readdir(dir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const loaded: LoadedEvalFixture[] = [];
  for (const fileName of jsonFiles) {
    const filePath = path.join(dir, fileName);
    const raw = await readFile(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse eval fixture ${fileName}: ${message}`);
    }

    if (hasTrustField(parsed)) {
      if (options.onTrustField === 'ignore') {
        parsed = stripTrustFields(parsed);
      } else {
        throw new Error(`Fixture ${fileName} declares trust fields; trustLevel must be injected by the loader`);
      }
    }

    let fixture: EvalTaskCase;
    try {
      fixture = EvalTaskCaseSchema.parse(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to validate eval fixture ${fileName}: ${message}`);
    }

    const trustLevel = resolveTrustLevel({
      source: resolveSource(options.source),
      fixtureHash: fileSha256(raw),
      allowlistHashes: options.allowlistHashes
    });
    if (trustLevel === 'untrusted' && fixture.oracle.kind === 'command_exit_code') {
      throw new Error(
        `Fixture ${fileName} uses command_exit_code oracle but is untrusted; only allowlisted/builtin fixtures may run commands`
      );
    }

    loaded.push({
      fixture,
      sourcePath: filePath,
      sha256: fileSha256(raw),
      trustLevel
    });
  }

  return loaded;
}
