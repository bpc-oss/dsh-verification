#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildCandidateManifest, loadEvalRunConfigs } from './candidate-manifest';
import { loadEvalFixturePack } from './fixture-loader';
import { buildEvalMatrixReport } from './matrix';
import { renderEvalMarkdownReport, toEvalJsonReport } from './report';
import { EvalRunConfigSchema, type EvalRunConfig } from './run-config';
import { runEvalCase, type EvalRunOutcome } from './runner';
import type { DshAgentHost } from './dsh-subject';
import type { EvalTaskCase } from './task-case';

export interface EvalCliOptions {
  readonly argv?: string[];
  readonly log?: (message: string) => void;
  readonly exit?: (code: number) => void;
  readonly runCase?: typeof runEvalCase;
}

function printHelp(log: (message: string) => void): void {
  log(`Usage: dsh-eval <command> [options]

Commands:
  run        Run one eval config against a fixture directory and write a report
  score      Run a matrix over config files and fixture directory, write JSON report
  manifest   Build a read-only candidate manifest (fixture + config hashes)

Options:
  --fixtures <dir>      fixture directory containing JSON task cases
  --config <file>       single run config JSON (run)
  --configs <dir>       directory of run config JSON files (score/manifest)
  --out <file>          output file (.json or .md)
  --mode <mock|live>    run mode (default: config.mode)
  --host <module>       live DSH host module exporting { create } (live)
  --fixture-set <id>    fixture set id for reports (default: fixtures)
  --help                show this help
`);
}

function parseCommon(argv: string[]): {
  values: Record<string, unknown>;
  positionals: string[];
} {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      fixtures: { type: 'string' },
      config: { type: 'string' },
      configs: { type: 'string' },
      out: { type: 'string' },
      mode: { type: 'string' },
      host: { type: 'string' },
      'fixture-set': { type: 'string' }
    }
  });
  return { values: values as Record<string, unknown>, positionals };
}

async function loadConfig(configPath: string): Promise<EvalRunConfig> {
  const raw = await readFile(configPath, 'utf8');
  return EvalRunConfigSchema.parse(JSON.parse(raw));
}

async function loadHost(hostPath: string): Promise<DshAgentHost> {
  const mod = await import(pathToFileURL(path.resolve(hostPath)).href);
  const candidate = (mod as { default?: DshAgentHost; host?: DshAgentHost }).default ?? (mod as { host?: DshAgentHost }).host ?? mod;
  if (!candidate || typeof (candidate as DshAgentHost).create !== 'function') {
    throw new Error(`Host module ${hostPath} must export a DshAgentHost with create(options)`);
  }
  return candidate as DshAgentHost;
}

export async function runEvalCli(options: EvalCliOptions = {}): Promise<void> {
  const log = options.log ?? ((message: string) => console.log(message));
  const exit = options.exit ?? ((code: number) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  });
  const argv = options.argv ?? process.argv.slice(2);
  const runCase = options.runCase ?? runEvalCase;

  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    printHelp(log);
    return;
  }

  const { values } = parseCommon(argv.slice(1));
  if (values.help) {
    printHelp(log);
    return;
  }

  const fixturesDir = asString(values.fixtures);
  if (!fixturesDir) {
    log('Missing required --fixtures <dir>');
    exit(1);
    return;
  }

  try {
    if (command === 'run') {
      const configPath = asString(values.config);
      if (!configPath) {
        log('Missing required --config <file> for run');
        exit(1);
        return;
      }
      const config = await loadConfig(configPath);
      const effectiveConfig = values.mode ? EvalRunConfigSchema.parse({ ...config, mode: values.mode }) : config;
      const loaded = await loadEvalFixturePack(fixturesDir, { source: 'external' });
      const host = values.host ? await loadHost(asString(values.host)!) : undefined;
      const outcomes: EvalRunOutcome[] = [];
      for (const entry of loaded) {
        outcomes.push(await runCase(entry.fixture, effectiveConfig, host ? { dshHost: host } : undefined));
      }
      const fixtureSetId = asString(values['fixture-set']) ?? 'fixtures';
      const matrix = buildEvalMatrixReport({
        fixtureSetId,
        configs: [effectiveConfig],
        fixtures: loaded.map((entry) => entry.fixture),
        outcomes
      });
      await writeReport(values.out ? asString(values.out)! : undefined, matrix, log);
      return;
    }

    if (command === 'score') {
      const configsDir = asString(values.configs);
      if (!configsDir) {
        log('Missing required --configs <dir> for score');
        exit(1);
        return;
      }
      const configs = await loadEvalRunConfigs(configsDir);
      const loaded = await loadEvalFixturePack(fixturesDir, { source: 'external' });
      const host = values.host ? await loadHost(asString(values.host)!) : undefined;
      const outcomes: EvalRunOutcome[] = [];
      for (const config of configs) {
        for (const entry of loaded) {
          outcomes.push(await runCase(entry.fixture, config, host ? { dshHost: host } : undefined));
        }
      }
      const fixtureSetId = asString(values['fixture-set']) ?? 'fixtures';
      const matrix = buildEvalMatrixReport({
        fixtureSetId,
        configs,
        fixtures: loaded.map((entry) => entry.fixture),
        outcomes
      });
      await writeReport(values.out ? asString(values.out)! : undefined, matrix, log);
      return;
    }

    if (command === 'manifest') {
      const configsDir = asString(values.configs);
      const configs = configsDir ? await loadEvalRunConfigs(configsDir) : [];
      const loaded = await loadEvalFixturePack(fixturesDir, { source: 'external' });
      const fixtureSetId = asString(values['fixture-set']) ?? 'fixtures';
      const manifest = buildCandidateManifest({ fixtureSetId, fixtures: loaded, configs });
      const json = `${JSON.stringify(manifest, null, 2)}\n`;
      const outPath = asString(values.out);
      if (outPath) {
        await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
        await writeFile(outPath, json, 'utf8');
      } else {
        log(json);
      }
      return;
    }

    log(`Unknown command: ${command}`);
    exit(1);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    exit(1);
  }
}

async function writeReport(
  outPath: string | undefined,
  matrix: ReturnType<typeof buildEvalMatrixReport>,
  log: (message: string) => void
): Promise<void> {
  if (!outPath) {
    log(renderEvalMarkdownReport(matrix));
    return;
  }
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  if (outPath.endsWith('.md')) {
    await writeFile(outPath, renderEvalMarkdownReport(matrix), 'utf8');
  } else {
    await writeFile(outPath, `${JSON.stringify(toEvalJsonReport(matrix), null, 2)}\n`, 'utf8');
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Direct execution support: `node lib/cli.js` or `dsh-eval`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runEvalCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
