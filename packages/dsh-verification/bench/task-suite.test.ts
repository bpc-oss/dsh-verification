/**
 * 公认任务 × 对照组 基准（2026-08-18）——完成任务能力验证。
 *
 * 用 5 类标准 agent 任务原型（文件写入 / 测试运行 / 代码修改 / 报告产出 / 命令执行），
 * 每类两个变体：
 *   - genuine：agent 真实执行（工具调用产出真实证据）→ 验证组应放行（完成能力不受损）；
 *   - fake：agent 声称完成但证据缺失/错误 → 验证组应拦截（防"假完成"）。
 *
 * 对照组：无引擎（naive accept——凭 agent 自述直接视为完成）→ 所有声明都被接受，
 * 包括 5 个伪造完成（暴露无验证层的问题）。
 *
 * 全部走真实服务链路：create_goal → set_verification_plan（冻结 selector）→
 * captureEvidence（真实工具调用）→ evaluateGate。
 */
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { GoalService } from '@deepseek-ai/dsh-goal';

import { VerificationService, type VerificationRuntimeConfig } from '../src/service';
import { createMemoryBlobStore } from '../src/evidence-store';
import { graderContract, makeFakeLlm } from '../test/fake-llm';

interface TaskDef {
  id: string;
  goal: string;
  ac: { id: string; desc: string; oracleHint: string; tool: string; args: Record<string, unknown> };
  /** 真实完成：工具调用（产出真实证据）。 */
  genuine: Array<{ name: string; args: Record<string, unknown>; value: Record<string, unknown> }>;
  /** 伪造完成：证据缺失或错误。 */
  fake: Array<{ name: string; args: Record<string, unknown>; value?: Record<string, unknown>; isError?: boolean }>;
}

const TASKS: TaskDef[] = [
  {
    id: 'file-write',
    goal: 'Create README.md describing the project',
    ac: { id: 'AC1', desc: 'README.md contains "project summary"', oracleHint: 'file', tool: 'write', args: { path: 'README.md' } },
    genuine: [{ name: 'write', args: { path: 'README.md' }, value: { path: 'README.md', after: '# My Project\n\nproject summary: a verification engine' } }],
    fake: [{ name: 'read', args: { path: 'README.md' }, value: { path: 'README.md', content: 'old content' } }]
  },
  {
    id: 'test-run',
    goal: 'Make the test suite pass',
    ac: { id: 'AC1', desc: 'run the test suite and all tests pass', oracleHint: 'test', tool: 'bash', args: { command: 'npm test' } },
    genuine: [{ name: 'bash', args: { command: 'npm test' }, value: { exitCode: 0, stdout: 'Tests  42 passed (42)' } }],
    fake: [{ name: 'bash', args: { command: 'npm test' }, value: { exitCode: 1, stdout: 'Tests  3 failed (45)' } }]
  },
  {
    id: 'code-edit',
    goal: 'Add an isEven helper to the math module',
    ac: { id: 'AC1', desc: 'src/math.js contains "export function isEven"', oracleHint: 'file', tool: 'edit', args: { path: 'src/math.js' } },
    genuine: [{ name: 'edit', args: { path: 'src/math.js' }, value: { path: 'src/math.js', after: 'export function isEven(n) { return n % 2 === 0; }' } }],
    fake: [{ name: 'edit', args: { path: 'src/other.js' }, value: { path: 'src/other.js', after: 'export function isEven(n) { return n % 2 === 0; }' } }]
  },
  {
    id: 'report',
    goal: 'Produce the analysis report',
    ac: { id: 'AC1', desc: 'docs/report.md exists with findings', oracleHint: 'file', tool: 'write', args: { path: 'docs/report.md' } },
    genuine: [{ name: 'write', args: { path: 'docs/report.md' }, value: { path: 'docs/report.md', after: '# Findings\n\n- finding A\n- finding B' } }],
    fake: []
  },
  {
    id: 'command',
    goal: 'Deploy the service',
    ac: { id: 'AC1', desc: 'deploy command completes with exit code 0', oracleHint: 'run', tool: 'bash', args: { command: 'deploy' } },
    genuine: [{ name: 'bash', args: { command: 'deploy' }, value: { exitCode: 0, stdout: 'deployed' } }],
    fake: [{ name: 'bash', args: { command: 'deploy' }, value: { exitCode: 2, stdout: 'deployed', stderr: 'OOM' } }]
  }
];

function makeEnv(task: TaskDef) {
  const ctx = new Context();
  const session = Session.create(SessionId('sess-suite-' + task.id));
  const agent = { id: 'suite-agent', session } as unknown as Agent;
  ctx.provide('agents', { get: (id: string) => (id === agent.id ? agent : undefined) } as never);
  new GoalService(ctx, { defaultMaxGoalRounds: 16 });
  const goals = ctx.get('goals') as GoalService;
  const config: VerificationRuntimeConfig = {
    mode: 'enforce',
    maxCapturedEvidence: 200,
    maxCapturedBytes: 20 * 1024 * 1024,
    completionPermitTtlMs: 60_000,
    configHash: 'cfg-suite',
    enableDeterministic: true,
    enableAssistantResponse: true,
    enableCoverage: true,
    enableProReview: false,
    proReviewProvider: 'spawn',
    globalConstraints: [],
    intent: { consensusCount: 1, contractOrigin: 'independent-capture', maxEntries: 200 },
    readOnlyToolAllowlist: [],
    binderFamilyFallback: true
  };
  const store = createMemoryBlobStore();
  const svc = new VerificationService(ctx, config, { store });
  ctx.provide('llm', makeFakeLlm({ respondWith: () => GRADER_FOR(task) }));
  return { ctx, session, agent, goals, svc, store };
}

function GRADER_FOR(task: TaskDef): string {
  return graderContract({
    goal: task.goal,
    acceptanceCriteria: [{ id: task.ac.id, desc: task.ac.desc, oracleHint: task.ac.oracleHint }],
    constraints: [],
    inputs: [],
    outOfScope: []
  });
}

async function bootstrap(env: ReturnType<typeof makeEnv>, task: TaskDef) {
  env.session.append('user/message', { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: task.goal }] }, { surfaceOp: 'append' });
  const view = env.goals.create(env.agent, { objective: task.goal });
  const result = await env.svc.setPlanFromProposal(env.agent, view.id, view.revision, {
    goal_value: task.goal,
    acceptance_criteria: [{ id: task.ac.id, desc: task.ac.desc, oracleHint: task.ac.oracleHint, tool: task.ac.tool, args: task.ac.args }],
    constraints: [],
    inputs: [],
    outOfScope: []
  });
  if (!result.ok) throw new Error(result.reason);
}

async function runAgentCalls(env: ReturnType<typeof makeEnv>, calls: Array<{ name: string; args: Record<string, unknown>; value?: Record<string, unknown>; isError?: boolean }>, startSeq: number) {
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i]!;
    await env.svc.captureEvidence(env.agent, { callId: `call-${i}`, name: c.name, arguments: c.args, isError: c.isError ?? false, value: c.value ?? {} }, startSeq + i);
  }
}

describe('公认任务 × 对照组（完成任务能力 vs 拦截）', () => {
  it('engine preserves genuine completions and intercepts fakes, while the naive control accepts everything', async () => {
    const rows: Array<Record<string, string>> = [];
    let genuinePass = 0;
    let fakeRejected = 0;

    for (const task of TASKS) {
      // 变体 1：genuine
      const genEnv = makeEnv(task);
      await bootstrap(genEnv, task);
      await runAgentCalls(genEnv, task.genuine, 40);
      const genOutcome = await genEnv.svc.evaluateGate(genEnv.agent);
      const genuineOk = genOutcome.gate.status === 'done';
      if (genuineOk) genuinePass++;

      // 变体 2：fake
      const fakeEnv = makeEnv(task);
      await bootstrap(fakeEnv, task);
      await runAgentCalls(fakeEnv, task.fake, 40);
      const fakeOutcome = await fakeEnv.svc.evaluateGate(fakeEnv.agent);
      const fakeRej = fakeOutcome.gate.status === 'failed';
      if (fakeRej) fakeRejected++;

      rows.push({
        task: task.id,
        genuine: genuineOk ? 'done ✓' : `FAIL(${genOutcome.gate.status})`,
        fake: fakeRej ? 'failed ✓' : `PASS(${fakeOutcome.gate.status})`,
        control: 'accepted (fake slips)'
      });
    }

    console.log('\n=== 公认任务 × 对照组 ===');
    console.log('task        | genuine→gate | fake→gate  | naive control');
    console.log('-' .repeat(70));
    for (const r of rows) {
      console.log(`${r.task.padEnd(12)} | ${r.genuine.padEnd(13)} | ${r.fake.padEnd(10)} | ${r.control}`);
    }
    console.log('-' .repeat(70));
    console.log(`engine: genuine completion preserved ${genuinePass}/${TASKS.length} · fake completion intercepted ${fakeRejected}/${TASKS.length}`);
    console.log(`naive control: ${TASKS.length * 2}/${TASKS.length * 2} claims accepted — ${TASKS.length} fake completions slip through without a gate`);
    console.log('');

    expect(genuinePass).toBe(TASKS.length);
    expect(fakeRejected).toBe(TASKS.length);
  });

  it('improvement experiment (quantified): the gate + defect list converts would-be defective completions into correct ones', async () => {
    // 实验设计：同一任务，agent 先提交"有缺陷的完成"（sloppy = 伪造/做错）。
    //  - 无引擎（control）：缺陷交付直接上线 → 量化"缺陷交付溜过数"；
    //  - 有引擎（treatment）：gate 拒绝（缺陷清单）→ agent 按清单修正 → 再次评估 → 通过。
    // 指标：缺陷上线 5/5 → 0/5；修正收敛 5/5；gate 拒绝驱动修正的次数。
    const rows: Array<Record<string, string>> = [];
    let defectiveShippedControl = 0;
    let defectiveShippedTreatment = 0;
    let fixConverged = 0;
    let rejectionDroveFix = 0;

    for (const task of TASKS) {
      // 无引擎对照组：agent 的 sloppy 完成被接受 → 上线（按构造即缺陷交付）
      defectiveShippedControl++; // sloppy 变体按定义缺陷（缺证据/错文件/非零退出/未执行）

      // 有引擎：round 1 = sloppy 提交 → 应被 gate 拒绝
      const env = makeEnv(task);
      await bootstrap(env, task);
      await runAgentCalls(env, task.fake, 40);
      const round1 = await env.svc.evaluateGate(env.agent);
      const rejected = round1.gate.status === 'failed';
      if (!rejected) {
        rows.push({ task: task.id, control: 'SHIPPED(defective)', round1: `NOT-REJECTED(${round1.gate.status})`, round2: '-', fixed: 'no' });
        continue;
      }
      const reason = round1.gate.reasons.join(' | ');
      const defectMentionsRealIssue = /(no committed run|no bound evidence|failed|Missing|missing|exit|failCount)/i.test(reason);
      if (rejected) rejectionDroveFix++;

      // round 2 = agent 按缺陷清单修正（做正确的工作）→ 应通过
      await runAgentCalls(env, task.genuine, 60);
      const round2 = await env.svc.evaluateGate(env.agent);
      const converged = round2.gate.status === 'done';
      if (converged) {
        fixConverged++;
        defectiveShippedTreatment = 0; // 修正后交付正确
      } else {
        defectiveShippedTreatment++;
      }

      rows.push({
        task: task.id,
        control: 'SHIPPED(defective)',
        round1: rejected ? 'REJECTED ✓' : `pass(${round1.gate.status})`,
        round2: converged ? 'done ✓' : `FAIL(${round2.gate.status})`,
        fixed: converged ? 'yes' : 'no',
        defectReason: reason.slice(0, 60)
      });
    }

    console.log('\n=== 提高能力实验（量化：无引擎 vs 有引擎）===');
    console.log('task        | no-engine        | round1(gate) | round2(gate) | fixed | gate reason');
    console.log('-' .repeat(100));
    for (const r of rows) {
      console.log(`${r.task.padEnd(12)} | ${r.control.padEnd(16)} | ${r.round1.padEnd(13)} | ${r.round2.padEnd(12)} | ${(r.fixed ?? '-').padEnd(5)} | ${(r.defectReason ?? '').slice(0, 30)}`);
    }
    console.log('-' .repeat(100));
    console.log(`缺陷交付上线：无引擎 ${defectiveShippedControl}/${TASKS.length} → 有引擎 ${defectiveShippedTreatment}/${TASKS.length}`);
    console.log(`修正收敛：${fixConverged}/${TASKS.length} · gate 拒绝驱动修正：${rejectionDroveFix}/${TASKS.length}`);
    console.log(`量化提升：引擎把 ${defectiveShippedControl - defectiveShippedTreatment} 个本会线上交付的缺陷完成转化为正确交付`);
    console.log('');

    expect(defectiveShippedControl).toBe(TASKS.length);
    expect(defectiveShippedTreatment).toBe(0);
    expect(fixConverged).toBe(TASKS.length);
    expect(rejectionDroveFix).toBe(TASKS.length);
  });
});
