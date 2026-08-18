import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MockCommandOracleExecutor, type CommandOracleExecutor } from './command-executor';
import type { EvalSubject, EvalSubjectRunInput, EvalSubjectRunResult } from './subject';
import type { EvalMockScenario } from './task-case';

interface MockToolCall {
  tool: string;
  input: Record<string, unknown>;
}

interface MockRunnerPayload {
  calls?: MockToolCall[];
  final?: 'done' | 'failed' | 'blocked' | 'aborted' | 'timeout';
}

function parseRunnerPayload(raw: string): MockRunnerPayload {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('mock runner response must be a JSON object');
  }
  return parsed as MockRunnerPayload;
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string): string {
  const resolved = path.resolve(workspaceRoot, targetPath);
  const root = path.resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`mock tool call path escapes workspace root: ${targetPath}`);
  }
  return resolved;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`mock tool call ${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Deterministic in-memory eval subject. It consumes the fixture's
 * mockScenario.runnerResponses as a queue of tool-call payloads and applies
 * only safe workspace mutations (write/mkdir). It never spawns a real command.
 */
export class MockEvalSubject implements EvalSubject {
  readonly kind = 'mock';
  private readonly commandExecutor: CommandOracleExecutor;

  constructor(options: { commandExecutor?: CommandOracleExecutor } = {}) {
    this.commandExecutor = options.commandExecutor ?? new MockCommandOracleExecutor();
  }

  async run(input: EvalSubjectRunInput): Promise<EvalSubjectRunResult> {
    const scenario = input.taskCase.mockScenario;
    if (!scenario) {
      throw new Error(`Fixture ${input.taskCase.id} has no mockScenario and cannot run in mock mode`);
    }

    const responses = [...scenario.runnerResponses];
    if (responses.length === 0) {
      throw new Error(`Fixture ${input.taskCase.id} has an empty mockScenario.runnerResponses queue`);
    }

    const raw = responses.shift()!;
    const payload = parseRunnerPayload(raw);

    for (const call of payload.calls ?? []) {
      await this.applyToolCall(input.workspaceRoot, call);
    }

    return {
      finalStatus: payload.final ?? 'done',
      turns: 1,
      notes: [`mock: applied ${payload.calls?.length ?? 0} tool call(s)`]
    };
  }

  private async applyToolCall(workspaceRoot: string, call: MockToolCall): Promise<void> {
    const input = call.input ?? {};
    switch (call.tool) {
      case 'write_file':
      case 'write':
      case 'edit':
      case 'replace': {
        const targetPath = asString(input.path ?? input.file_path, 'path');
        const content = typeof input.content === 'string' ? input.content : String(input.content ?? '');
        const absolutePath = assertInsideWorkspace(workspaceRoot, targetPath);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, 'utf8');
        return;
      }
      case 'mkdir': {
        const targetPath = asString(input.path, 'path');
        const absolutePath = assertInsideWorkspace(workspaceRoot, targetPath);
        await mkdir(absolutePath, { recursive: true });
        return;
      }
      case 'shell':
      case 'bash':
      case 'pwsh':
      case 'exec': {
        const cmd = asString(input.cmd ?? input.command, 'cmd');
        const args = Array.isArray(input.args) ? input.args.map(String) : [];
        await this.commandExecutor.execute({ cwd: workspaceRoot, cmd, args, timeoutMs: 1_000 });
        return;
      }
      default:
        // read/list/info/unknown tools are intentionally no-ops in the mock.
        return;
    }
  }
}

export function createMockEvalSubject(scenario?: EvalMockScenario, options: { commandExecutor?: CommandOracleExecutor } = {}): MockEvalSubject {
  if (scenario) {
    return new MockEvalSubject(options);
  }
  throw new Error('Mock mode requires a fixture with mockScenario');
}
