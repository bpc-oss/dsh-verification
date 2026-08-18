/**
 * CommandOracleExecutor capability seam (P1-3 v6).
 *
 * DSH rc.6 sandbox does not provide verifiable network/process/memory
 * boundaries, so the default implementation refuses every real command before
 * spawn. CI uses a deterministic in-memory mock. A container/microVM
 * implementation may register only when every required boundary is proven.
 */
export interface CommandExecutionRequest {
  readonly cwd: string;
  readonly cmd: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
}

export interface CommandExecutionResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface CommandOracleExecutor {
  readonly kind: string;
  execute(request: CommandExecutionRequest): Promise<CommandExecutionResult>;
}

export const NO_QUALIFIED_EXECUTOR_MESSAGE =
  'This environment has no qualified command oracle executor; refusing to spawn a real command.';

/** rc.6 default: fail closed before spawn. */
export class DisabledCommandOracleExecutor implements CommandOracleExecutor {
  readonly kind = 'disabled';

  async execute(_request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    throw new Error(NO_QUALIFIED_EXECUTOR_MESSAGE);
  }
}

export interface MockCommandRecord {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** Deterministic in-memory command executor for CI / MockEvalSubject. */
export class MockCommandOracleExecutor implements CommandOracleExecutor {
  readonly kind = 'mock';
  readonly calls: CommandExecutionRequest[] = [];

  constructor(private readonly records: readonly MockCommandRecord[] = []) {}

  async execute(request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    this.calls.push(request);
    const record = this.records.find(
      (entry) => entry.cmd === request.cmd && entry.args.length === request.args.length && entry.args.every((arg, index) => arg === request.args[index])
    );
    if (!record) {
      return { exitCode: 127, stdout: '', stderr: `mock: no record for ${request.cmd}`, timedOut: false };
    }
    return {
      exitCode: record.exitCode ?? 0,
      stdout: record.stdout ?? '',
      stderr: record.stderr ?? '',
      timedOut: false
    };
  }
}

/**
 * Placeholder for a container/microVM executor. It is intentionally not
 * implemented in this release: it may be registered only when network, process
 * count, memory and process-tree termination boundaries are all provable.
 */
export class UnavailableContainerCommandOracleExecutor implements CommandOracleExecutor {
  readonly kind = 'unavailable-container';

  async execute(_request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    throw new Error(NO_QUALIFIED_EXECUTOR_MESSAGE);
  }
}
