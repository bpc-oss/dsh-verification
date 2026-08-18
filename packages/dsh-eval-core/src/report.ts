import type { EvalMatrixReport } from './matrix';
import type { EvalRunOutcome } from './runner';
import type { EvalScorecard } from './scorecard';
import type { EvalRunConfig } from './run-config';

export interface EvalJsonReport {
  readonly generatedAt: string;
  readonly fixtureSetId: string;
  readonly fixtureIds: string[];
  readonly configs: EvalRunConfig[];
  readonly scorecards: EvalScorecard[];
  readonly outcomes: EvalRunOutcome[];
}

export function toEvalJsonReport(matrix: EvalMatrixReport, generatedAt = new Date().toISOString()): EvalJsonReport {
  return {
    generatedAt,
    fixtureSetId: matrix.fixtureSetId,
    fixtureIds: matrix.fixtureIds,
    configs: matrix.configs,
    scorecards: matrix.scorecards,
    outcomes: matrix.outcomes
  };
}

export function renderEvalMarkdownReport(matrix: EvalMatrixReport): string {
  const lines: string[] = [];
  lines.push(`# Eval Report: ${matrix.fixtureSetId}`);
  lines.push('');
  lines.push(`Fixtures: ${matrix.fixtureIds.length}`);
  lines.push('');
  lines.push('| Config | Tasks | Samples | Pass@1 | Pass@K | Mean turns | Mean ms |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const scorecard of matrix.scorecards) {
    lines.push(
      `| ${scorecard.configId} | ${scorecard.taskCount} | ${scorecard.sampleCount} | ${scorecard.passAt1} | ${scorecard.passAtK} | ${scorecard.meanTurns} | ${scorecard.meanDurationMs} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}
