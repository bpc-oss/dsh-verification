import type { EvalRunConfig } from './run-config';
import type { EvalTaskCase } from './task-case';

export interface EvalUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface EvalSubjectRunInput {
  readonly taskCase: EvalTaskCase;
  readonly config: EvalRunConfig;
  readonly workspaceRoot: string;
  readonly signal?: AbortSignal;
}

export interface EvalSubjectRunResult {
  readonly finalStatus: 'done' | 'failed' | 'blocked' | 'aborted' | 'timeout';
  readonly turns: number;
  readonly usage?: EvalUsage;
  readonly notes?: string[];
  readonly sessionId?: string;
}

export interface EvalSubject {
  run(input: EvalSubjectRunInput): Promise<EvalSubjectRunResult>;
}
