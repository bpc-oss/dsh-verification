import type { EvalRunConfig } from './run-config';
import type { EvalRunOutcome } from './runner';
import { buildEvalScorecard, type EvalScorecard } from './scorecard';
import type { EvalTaskCase } from './task-case';

export interface EvalMatrixReport {
  readonly fixtureSetId: string;
  readonly fixtureIds: string[];
  readonly configs: EvalRunConfig[];
  readonly scorecards: EvalScorecard[];
  readonly outcomes: EvalRunOutcome[];
  readonly leaderboard: Array<{ configId: string; passAtK: number; sampleCount: number }>;
}

export function buildEvalMatrixReport(input: {
  fixtureSetId: string;
  configs: EvalRunConfig[];
  fixtures: EvalTaskCase[];
  outcomes: EvalRunOutcome[];
}): EvalMatrixReport {
  const configs = input.configs.slice().sort((left, right) => left.id.localeCompare(right.id));
  const fixtureIds = input.fixtures.map((fixture) => fixture.id).sort((left, right) => left.localeCompare(right));
  const scorecards = configs.map((config) =>
    buildEvalScorecard(config, input.outcomes.filter((outcome) => outcome.configId === config.id))
  );
  const leaderboard = scorecards
    .slice()
    .sort((left, right) => right.passAtK - left.passAtK || left.configId.localeCompare(right.configId))
    .map((scorecard) => ({
      configId: scorecard.configId,
      passAtK: scorecard.passAtK,
      sampleCount: scorecard.sampleCount
    }));

  return {
    fixtureSetId: input.fixtureSetId,
    fixtureIds,
    configs,
    scorecards,
    outcomes: input.outcomes.slice(),
    leaderboard
  };
}
