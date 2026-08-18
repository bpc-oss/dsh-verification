import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DisabledCommandOracleExecutor, type CommandOracleExecutor } from './command-executor';
import type { EvalOracle } from './task-case';

export interface EvaluateOracleOptions {
  readonly commandExecutor?: CommandOracleExecutor;
}

export async function evaluateEvalOracle(
  workspaceRoot: string,
  oracle: EvalOracle,
  options: EvaluateOracleOptions = {}
): Promise<boolean> {
  switch (oracle.kind) {
    case 'file_exists':
      return await fileExists(path.join(workspaceRoot, oracle.path));
    case 'file_contains':
      return (await readWorkspaceFile(workspaceRoot, oracle.path)).includes(oracle.text);
    case 'file_not_contains':
      return !(await readWorkspaceFile(workspaceRoot, oracle.path)).includes(oracle.text);
    case 'command_exit_code': {
      const executor = options.commandExecutor ?? new DisabledCommandOracleExecutor();
      try {
        const result = await executor.execute({
          cwd: workspaceRoot,
          cmd: oracle.cmd,
          args: oracle.args,
          timeoutMs: 1_000
        });
        return !result.timedOut && result.exitCode === oracle.expectedExitCode;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

async function readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string> {
  return await readFile(path.join(workspaceRoot, relativePath), 'utf8');
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
