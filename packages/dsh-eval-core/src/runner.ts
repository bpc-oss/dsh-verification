import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DisabledCommandOracleExecutor, type CommandOracleExecutor } from './command-executor';
import { DshEvalSubject, type DshAgentHost } from './dsh-subject';
import { MockEvalSubject } from './mock-subject';
import { evaluateEvalOracle } from './oracle';
import type { EvalRunConfig } from './run-config';
import type { EvalSubject, EvalUsage } from './subject';
import { normalizeWorkspaceSeedPath, type EvalTaskCase } from './task-case';

export type EvalFinalStatus = 'done' | 'failed' | 'blocked' | 'aborted' | 'timeout';
export type EvalFailureKind = 'none' | 'schema_reject' | 'wrong_path' | 'unknown_tool' | 'timeout' | 'oracle_fail' | 'runner_error' | 'blocked';

export interface EvalRunOutcome {
  taskId: string;
  configId: string;
  sampleIndex: number;
  passed: boolean;
  finalStatus: EvalFinalStatus;
  failureKind: EvalFailureKind;
  turns: number;
  durationMs: number;
  workspaceRoot: string;
  sessionId?: string;
  usage?: EvalUsage;
  notes?: string[];
}

export interface RunEvalCaseOptions {
  readonly workspaceRootFactory?: () => Promise<string>;
  readonly subjectFactory?: (input: { taskCase: EvalTaskCase; config: EvalRunConfig; workspaceRoot: string }) => EvalSubject | Promise<EvalSubject>;
  readonly commandExecutor?: CommandOracleExecutor;
  readonly timeoutMs?: number;
  readonly dshHost?: DshAgentHost;
}

export async function runEvalCase(
  taskCase: EvalTaskCase,
  config: EvalRunConfig,
  options: RunEvalCaseOptions = {}
): Promise<EvalRunOutcome> {
  const startedAt = Date.now();
  const workspaceRoot = await (options.workspaceRootFactory?.() ?? createTempWorkspaceRoot());
  const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? 10_000;

  try {
    await materializeWorkspaceSeed(workspaceRoot, taskCase);
    const subject =
      (await options.subjectFactory?.({ taskCase, config, workspaceRoot })) ??
      createDefaultSubject(taskCase, config, options.dshHost, options.commandExecutor);
    const result = await withTimeout(subject.run({ taskCase, config, workspaceRoot }), timeoutMs);
    const turns = result.turns;
    const durationMs = Date.now() - startedAt;

    if (result.finalStatus === 'timeout') {
      return outcome(taskCase, config, startedAt, {
        passed: false,
        finalStatus: 'timeout',
        failureKind: 'timeout',
        turns,
        workspaceRoot,
        sessionId: result.sessionId,
        usage: result.usage,
        notes: result.notes
      });
    }

    if (result.finalStatus === 'done') {
      const oraclePassed = await evaluateEvalOracle(workspaceRoot, taskCase.oracle, {
        commandExecutor: options.commandExecutor ?? new DisabledCommandOracleExecutor()
      });
      if (oraclePassed) {
        return outcome(taskCase, config, startedAt, {
          passed: true,
          finalStatus: 'done',
          failureKind: 'none',
          turns,
          workspaceRoot,
          sessionId: result.sessionId,
          usage: result.usage,
          notes: result.notes
        });
      }
      return outcome(taskCase, config, startedAt, {
        passed: false,
        finalStatus: 'failed',
        failureKind: 'oracle_fail',
        turns,
        workspaceRoot,
        sessionId: result.sessionId,
        usage: result.usage,
        notes: [...(result.notes ?? []), 'eval oracle did not pass']
      });
    }

    return outcome(taskCase, config, startedAt, {
      passed: false,
      finalStatus: result.finalStatus === 'blocked' ? 'blocked' : 'failed',
      failureKind: result.finalStatus === 'blocked' ? 'blocked' : 'runner_error',
      turns,
      workspaceRoot,
      sessionId: result.sessionId,
      usage: result.usage,
      notes: result.notes
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return outcome(taskCase, config, startedAt, {
      passed: false,
      finalStatus: 'failed',
      failureKind: classifyFailure(message),
      turns: 0,
      workspaceRoot,
      notes: [message]
    });
  }
}

function createDefaultSubject(
  taskCase: EvalTaskCase,
  config: EvalRunConfig,
  dshHost?: DshAgentHost,
  commandExecutor?: CommandOracleExecutor
): EvalSubject {
  if (config.mode === 'mock') {
    return new MockEvalSubject({ commandExecutor });
  }
  if (dshHost) {
    return new DshEvalSubject(dshHost);
  }
  throw new Error('Live eval requires a DSH agent host (pass dshHost or subjectFactory)');
}

async function createTempWorkspaceRoot(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'dsh-eval-core-'));
}

async function materializeWorkspaceSeed(workspaceRoot: string, taskCase: EvalTaskCase): Promise<void> {
  const seen = new Set<string>();
  for (const entry of taskCase.workspaceSeed) {
    const normalized = normalizeWorkspaceSeedPath(entry.path);
    if (normalized === '..' || normalized.startsWith('../') || path.isAbsolute(normalized) || seen.has(normalized)) {
      throw new Error(`Invalid workspace seed path: ${entry.path}`);
    }
    seen.add(normalized);
    const absolutePath = path.join(workspaceRoot, normalized);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, entry.content, 'utf8');
  }
}

function outcome(
  taskCase: EvalTaskCase,
  config: EvalRunConfig,
  startedAt: number,
  data: Omit<EvalRunOutcome, 'taskId' | 'configId' | 'sampleIndex' | 'durationMs'>
): EvalRunOutcome {
  return {
    taskId: taskCase.id,
    configId: config.id,
    sampleIndex: 0,
    durationMs: Date.now() - startedAt,
    ...data
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`eval run timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function classifyFailure(message: string): EvalFailureKind {
  if (/schema|invalid|validation/i.test(message)) {
    return 'schema_reject';
  }
  if (/path escapes|outside workspace|wrong_path|escape/i.test(message)) {
    return 'wrong_path';
  }
  if (/unknown tool|no tool/i.test(message)) {
    return 'unknown_tool';
  }
  if (/timed out/i.test(message)) {
    return 'timeout';
  }
  return 'runner_error';
}
