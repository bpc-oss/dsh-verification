/**
 * enforce 模式演示（2026-08-18）：插件优势的可视化证明。
 *
 * 真实场景回放（heterogeneous-dates，Terminal Bench 2 官方任务）：
 * - 官方要求：交付 avg_temp.txt，内容为 11.428571
 * - v1 模式（无插件/自声明 AC）：agent 产出 compute_avg_temp.py + sf_daily_temp_change.csv（误解需求）
 *   → 官方测试 FAIL，但 agent 声称完成 → 直接"上线"
 * - 本测试：同一 agent 证据，契约用【官方 AC】，引擎 enforce → gate FAILED
 *   → update_goal complete 被 DENY（GOAL_TRANSITION_DENIED），goal 保持 active + 缺陷清单
 * - 对照：agent 修正为真实写出 avg_temp.txt → gate DONE → complete 放行
 *
 * 结论：插件（enforce + 权威 AC）把"错交付物直接上线"变成"被拦截 + 缺陷清单 + 必须修对"。
 */
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { GoalService } from '@deepseek-ai/dsh-goal';

import { VerificationService, type VerificationRuntimeConfig } from '../src/service';
import { createMemoryBlobStore } from '../src/evidence-store';
import { installGoalTransitionGuard } from '../src/goal-guard';
import { graderContract, makeFakeLlm } from './fake-llm';

let _seq = 0;

function makeEnforceEnv(grader: string) {
  const ctx = new Context();
  const session = Session.create(SessionId(`sess-enforce-${++_seq}`));
  const agent = { id: `enforce-agent-${_seq}`, session } as unknown as Agent;
  ctx.provide('agents', { get: (id: string) => (id === agent.id ? agent : undefined) } as never);
  new GoalService(ctx, { defaultMaxGoalRounds: 16 });
  const goals = ctx.get('goals') as GoalService;
  const config: VerificationRuntimeConfig = {
    mode: 'enforce',
    maxCapturedEvidence: 200,
    maxCapturedBytes: 20 * 1024 * 1024,
    completionPermitTtlMs: 60_000,
    configHash: 'cfg-enforce-demo',
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
  ctx.provide('llm', makeFakeLlm({ respondWith: () => grader }));
  const disposeGuard = installGoalTransitionGuard(ctx, svc);
  if (!disposeGuard) throw new Error('goal transition guard not installed');
  return { ctx, session, agent, goals, svc, store, disposeGuard };
}

const GRADER_OFFICIAL = graderContract({
  goal: '计算旧金山每日温度平均变化量并写入 avg_temp.txt',
  acceptanceCriteria: [
    { id: 'AC1', desc: '交付物文件 avg_temp.txt 必须存在于工作目录', oracleHint: 'file' },
    { id: 'AC2', desc: 'avg_temp.txt 内容为纯数字且值等于 11.428571（保留 3 位小数比对 11.429）', oracleHint: 'run' }
  ],
  constraints: [],
  inputs: [],
  outOfScope: []
});

async function bootstrap(env: ReturnType<typeof makeEnforceEnv>) {
  env.session.append('user/message', { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: '计算温度平均变化量并写入 avg_temp.txt' }] }, { surfaceOp: 'append' });
  const view = env.goals.create(env.agent, { objective: '计算温度平均变化量并写入 avg_temp.txt' });
  const result = await env.svc.setPlanFromProposal(env.agent, view.id, view.revision, {
    goal_value: '计算温度平均变化量并写入 avg_temp.txt',
    acceptance_criteria: [
      { id: 'AC1', desc: '交付物文件 avg_temp.txt 必须存在于工作目录', oracleHint: 'file', tool: 'file_exists', args: { path: 'avg_temp.txt' } },
      { id: 'AC2', desc: 'avg_temp.txt 内容为纯数字且值等于 11.428571（保留 3 位小数比对 11.429）', oracleHint: 'run', tool: 'shell', args: { command: 'python check_avg.py' } }
    ],
    constraints: [],
    inputs: [],
    outOfScope: []
  });
  if (!result.ok) throw new Error(result.reason);
  return view;
}

function completeOrThrow(env: ReturnType<typeof makeEnforceEnv>, id: string, revision: number): unknown {
  try {
    env.goals.complete(env.agent, { id, revision });
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('enforce 模式：插件把"错交付物直接上线"变成"拦截 + 必须修对"', () => {
  it('v1 证据（写错文件 compute_avg_temp.py / sf_daily_temp_change.csv）→ gate FAILED → complete 被 DENY', async () => {
    const env = makeEnforceEnv(GRADER_OFFICIAL);
    const view = await bootstrap(env);

    // 真实 v1 证据形状：agent 写了 compute_avg_temp.py + sf_daily_temp_change.csv（误解需求，没写 avg_temp.txt）
    await env.svc.captureEvidence(env.agent,
      { callId: 'w1', name: 'write', arguments: { file_path: 'C:\\work\\compute_avg_temp.py', content: 'print("avg")' }, isError: false, value: { path: 'C:\\work\\compute_avg_temp.py', after: 'print("avg")' } }, 40);
    await env.svc.captureEvidence(env.agent,
      { callId: 'w2', name: 'write', arguments: { file_path: 'C:\\work\\sf_daily_temp_change.csv', content: 'date,change\n1,2' }, isError: false, value: { path: 'C:\\work\\sf_daily_temp_change.csv', after: 'date,change\n1,2' } }, 42);
    await env.svc.captureEvidence(env.agent,
      { callId: 'r1', name: 'shell', arguments: { command: 'python compute_avg_temp.py' }, isError: false, value: { exitCode: 0, stdout: 'ok' } }, 44);

    const outcome = await env.svc.evaluateGate(env.agent);
    expect(outcome.gate.status).toBe('failed');

    // enforce：complete 被拒绝（goal 保持 active + 缺陷清单）
    const thrown = completeOrThrow(env, view.id, view.revision);
    expect(thrown).toBeDefined();
    const err = thrown as { code?: string; message?: string };
    expect(err.code).toBe('GOAL_TRANSITION_DENIED');
    const current = env.goals.get(env.agent)!;
    expect(current.phase).toBe('active');
    expect(env.svc.getProjection(env.agent).verdicts.AC1?.result).toBe('fail');
  });

  it('v2 证据（真实写出 avg_temp.txt）→ gate DONE → complete 放行', async () => {
    const env = makeEnforceEnv(GRADER_OFFICIAL);
    const view = await bootstrap(env);

    // v2 真实证据：avg_temp.txt 存在（正确交付物）
    await env.svc.captureEvidence(env.agent,
      { callId: 'w1', name: 'write', arguments: { file_path: 'C:\\work\\avg_temp.txt', content: '11.428571428571429' }, isError: false, value: { path: 'C:\\work\\avg_temp.txt', after: '11.428571428571429' } }, 40);
    await env.svc.captureEvidence(env.agent,
      { callId: 'r1', name: 'shell', arguments: { command: 'Get-Content avg_temp.txt; python -c "print(float(open(\'avg_temp.txt\').read()))"' }, isError: false, value: { exitCode: 0, stdout: '11.428571' } }, 45);

    const outcome = await env.svc.evaluateGate(env.agent);
    expect(outcome.gate.status).toBe('done');

    // enforce：gate done → prepareGoalCompletion mint permit → complete 放行
    await env.svc.prepareGoalCompletion(env.agent, view.id, view.revision);
    const thrown = completeOrThrow(env, view.id, view.revision);
    expect(thrown).toBeUndefined();
    expect(env.goals.get(env.agent)!.phase).toBe('complete');
  });

  it('加固：enforce 下冻结契约后，弱化重声明（删 AC）被拒绝；超集重声明（加 AC）允许', async () => {
    const env = makeEnforceEnv(GRADER_OFFICIAL);
    const view = await bootstrap(env);

    // 冻结契约（agent 已承诺执行：write 工具触发 freeze）
    env.svc.freezePlan(env.agent, 'call-w1');

    // 弱化重声明：删掉 AC1（avg_temp.txt 存在）——应被拒
    const weaken = await env.svc.setPlanFromProposal(env.agent, view.id, view.revision, {
      goal_value: '计算温度平均变化量并写入 avg_temp.txt',
      acceptance_criteria: [
        { id: 'AC2', desc: 'avg_temp.txt 内容为纯数字且值等于 11.428571（保留 3 位小数比对 11.429）', oracleHint: 'run', tool: 'shell', args: { command: 'python check_avg.py' } }
      ],
      constraints: [],
      inputs: [],
      outOfScope: []
    });
    expect(weaken.ok).toBe(false);
    if (!weaken.ok) {
      expect(weaken.reason).toContain('cannot weaken');
    }

    // 超集重声明：保留全部旧 AC + 新增一条 → 允许
    const strengthen = await env.svc.setPlanFromProposal(env.agent, view.id, view.revision, {
      goal_value: '计算温度平均变化量并写入 avg_temp.txt',
      acceptance_criteria: [
        { id: 'AC1', desc: '交付物文件 avg_temp.txt 必须存在于工作目录', oracleHint: 'file', tool: 'file_exists', args: { path: 'avg_temp.txt' } },
        { id: 'AC2', desc: 'avg_temp.txt 内容为纯数字且值等于 11.428571（保留 3 位小数比对 11.429）', oracleHint: 'run', tool: 'shell', args: { command: 'python check_avg.py' } },
        { id: 'AC3', desc: '额外约束：输入 CSV 必须被读取过', oracleHint: 'file', tool: 'read', args: { path: 'daily_temp_sf_high.csv' } }
      ],
      constraints: [],
      inputs: [],
      outOfScope: []
    });
    expect(strengthen.ok).toBe(true);
  });
});
