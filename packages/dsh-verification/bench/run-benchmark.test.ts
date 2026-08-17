/**
 * 验证引擎 benchmark 运行器（vitest）。
 *
 * 对每个场景：用真实确定性裁判（T0 TestRun/CommandExit/FileExists/FileDiff/SchemaValid + T3 Coverage）
 * 对 AC 逐一裁决（无 bound evidence → fail，模拟 service.judgeAc 的 "no committed run" 分支），
 * 然后跑 CompletionGate，与期望比对，输出 召回率（坏场景被拦比例）与误报率（好场景被误拦比例）。
 */
import { describe, expect, it } from 'vitest';
import type { BoundEvidence, ContractIdentity, TaskContract, Verdict } from '@bpc-oss/dsh-evidence';

import { VerificationEngine } from '../src/engine';
import { CompletionGate } from '../src/gate';
import { CommandExitOracle, FileDiffOracle, FileExistsOracle } from '../src/oracles/deterministic';
import { CoverageOracle, SchemaValidOracle, TestRunOracle } from '../src/oracles/run-based';
import { benchContractOf, benchIdentity, scenarios, type BenchmarkScenario } from './scenarios';

const oracles = [
  new TestRunOracle(),
  new CommandExitOracle(),
  new FileExistsOracle(),
  new FileDiffOracle(),
  new SchemaValidOracle(),
  new CoverageOracle()
];
const engine = new VerificationEngine(oracles);

/** 模拟 service.judgeAc：无 bound evidence → fail（"no committed run"）；引擎抛错 → fail。 */
async function judgeAc(ac: { id: string; desc: string; oracleHint: string }, evidence: BoundEvidence[], identity: ContractIdentity): Promise<Verdict> {
  if (!evidence.some((entry) => entry.acId === ac.id)) {
    return { claimId: ac.id, acId: ac.id, result: 'fail', oracleTier: 'T3', contractIdentity: identity, detail: `AC ${ac.id} has no bound evidence (no exact selector match)` };
  }
  try {
    return await engine.verify(ac as never, evidence, identity);
  } catch (error) {
    return { claimId: ac.id, acId: ac.id, result: 'fail', oracleTier: 'T3', contractIdentity: identity, detail: `no oracle can judge AC ${ac.id}: ${String(error)}` };
  }
}

interface RunResult {
  id: string;
  name: string;
  defect: string;
  expectedVerdicts: string;
  actualVerdicts: string;
  verdictsMatch: boolean;
  expectedGate: string;
  actualGate: string;
  gateMatch: boolean;
  reasons: string;
}

async function runScenario(s: BenchmarkScenario): Promise<RunResult> {
  const contract: TaskContract = benchContractOf(s);
  const verdicts = new Map<string, Verdict>();
  for (const ac of contract.acceptanceCriteria) {
    verdicts.set(ac.id, await judgeAc(ac, s.evidence, benchIdentity));
  }
  const gate = new CompletionGate().evaluate(contract, verdicts, []);
  const actualVerdicts = Object.fromEntries([...verdicts.entries()].map(([id, v]) => [id, v.result]));
  const verdictsMatch = Object.entries(s.expectedVerdicts).every(([id, r]) => actualVerdicts[id] === r);
  const gateMatch = gate.status === s.expectedGate;
  return {
    id: s.id,
    name: s.name,
    defect: s.defect,
    expectedVerdicts: JSON.stringify(s.expectedVerdicts),
    actualVerdicts: JSON.stringify(actualVerdicts),
    verdictsMatch,
    expectedGate: s.expectedGate,
    actualGate: gate.status,
    gateMatch,
    reasons: gate.reasons.join(' | ')
  };
}

describe('verification benchmark (recall / false positives)', () => {
  it('all scenarios behave as expected (recall = 1, false-positive rate = 0)', async () => {
    const results: RunResult[] = [];
    for (const s of scenarios) {
      results.push(await runScenario(s));
    }

    const pad = (t: string, n: number) => (t + ' '.repeat(n)).slice(0, n);
    const line = (r: RunResult) =>
      `${pad(r.id, 22)} | ${pad(r.actualGate, 6)} vs ${pad(r.expectedGate, 6)} | verdicts ${r.verdictsMatch ? 'ok' : 'MISMATCH ' + r.actualVerdicts} | gate ${r.gateMatch ? 'ok' : 'FAIL'} | ${r.name}`;
    console.log('\n=== verification benchmark results ===');
    console.log(pad('scenario', 22) + ' | gate(actual vs expected) | verdict | name');
    console.log('-'.repeat(120));
    for (const r of results) console.log(line(r));
    console.log('-'.repeat(120));

    const defective = results.filter((r) => r.expectedGate === 'failed');
    const clean = results.filter((r) => r.expectedGate === 'done');
    const caught = defective.filter((r) => r.gateMatch).length;
    const wronglyRejected = clean.filter((r) => !r.gateMatch).length;
    const recall = caught / defective.length;
    const fpRate = wronglyRejected / clean.length;

    console.log(`\ndefective scenarios: ${defective.length}  caught: ${caught}  →  recall = ${(recall * 100).toFixed(0)}%`);
    console.log(`clean scenarios: ${clean.length}  wrongly rejected: ${wronglyRejected}  →  false-positive rate = ${(fpRate * 100).toFixed(0)}%`);
    console.log(`per-AC verdict match: ${results.filter((r) => r.verdictsMatch).length}/${results.length}\n`);

    expect(recall).toBe(1);
    expect(fpRate).toBe(0);
    expect(results.every((r) => r.verdictsMatch && r.gateMatch)).toBe(true);
  });
});
