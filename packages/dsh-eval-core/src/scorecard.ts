import type { EvalRunConfig } from './run-config';
import type { EvalRunOutcome } from './runner';

export interface EvalScorecard {
  readonly configId: string;
  readonly taskCount: number;
  readonly sampleCount: number;
  readonly passAt1: number;
  readonly passAtK: number;
  readonly k: number;
  readonly meanTurns: number;
  readonly meanDurationMs: number;
  readonly terminalBreakdown: Partial<Record<EvalRunOutcome['finalStatus'], number>>;
  readonly failureBreakdown: Partial<Record<EvalRunOutcome['failureKind'], number>>;
}

export function buildEvalScorecard(config: EvalRunConfig, outcomes: EvalRunOutcome[]): EvalScorecard {
  const taskCount = new Set(outcomes.map((outcome) => outcome.taskId)).size;
  const sampleCount = outcomes.length;
  const passAt1Hits = new Set(outcomes.filter((outcome) => outcome.sampleIndex === 0 && outcome.passed).map((outcome) => outcome.taskId)).size;
  const passAtKHits = new Set(outcomes.filter((outcome) => outcome.passed).map((outcome) => outcome.taskId)).size;
  const terminalBreakdown: Partial<Record<EvalRunOutcome['finalStatus'], number>> = {};
  const failureBreakdown: Partial<Record<EvalRunOutcome['failureKind'], number>> = {};
  for (const outcome of outcomes) {
    terminalBreakdown[outcome.finalStatus] = (terminalBreakdown[outcome.finalStatus] ?? 0) + 1;
    failureBreakdown[outcome.failureKind] = (failureBreakdown[outcome.failureKind] ?? 0) + 1;
  }

  return {
    configId: config.id,
    taskCount,
    sampleCount,
    passAt1: ratio(passAt1Hits, taskCount),
    passAtK: ratio(passAtKHits, taskCount),
    k: config.samples,
    meanTurns: average(outcomes.map((outcome) => outcome.turns)),
    meanDurationMs: average(outcomes.map((outcome) => outcome.durationMs)),
    terminalBreakdown,
    failureBreakdown
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1_000_000) / 1_000_000;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1_000_000) / 1_000_000;
}
