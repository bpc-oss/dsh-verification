import { describe, expect, it } from 'vitest';
import {
  DisabledCommandOracleExecutor,
  MockCommandOracleExecutor,
  NO_QUALIFIED_EXECUTOR_MESSAGE
} from '../src/command-executor';

describe('CommandOracleExecutor', () => {
  it('default rc.6 executor refuses before spawn', async () => {
    const executor = new DisabledCommandOracleExecutor();
    await expect(executor.execute({ cwd: process.cwd(), cmd: 'echo', args: ['hi'] })).rejects.toThrow(
      NO_QUALIFIED_EXECUTOR_MESSAGE
    );
  });

  it('mock executor is deterministic and records calls', async () => {
    const executor = new MockCommandOracleExecutor([{ cmd: 'node', args: ['-v'], exitCode: 0, stdout: 'v24\n' }]);
    const result = await executor.execute({ cwd: process.cwd(), cmd: 'node', args: ['-v'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('v24\n');
    expect(executor.calls).toHaveLength(1);
  });
});
