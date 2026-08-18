/**
 * 完成任务能力端到端验证（2026-08-18）。
 *
 * 背景：真实任务审计发现 ac-research 是"真实完成被误拒"——交付物由 write 产生
 * （file_diff 证据），但冻结 selector 是 glob，exact-only 绑定看不到真实交付 → 假阴性。
 *
 * 本测试证明 v9.2 family fallback 修复后：同一场景（glob selector + write 交付）下，
 * 完成闸门放行（gate=done）；而关闭 family fallback 时该真实完成会被误拒（gate=failed）。
 */
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { GoalService } from '@deepseek-ai/dsh-goal';

import { VerificationService, type VerificationRuntimeConfig } from '../src/service';
import { createMemoryBlobStore } from '../src/evidence-store';
import { graderContract, makeFakeLlm } from './fake-llm';

const GRADER = graderContract({
  goal: 'Produce a research summary document',
  acceptanceCriteria: [
    { id: 'AC1', desc: 'docs/02-external-research-summary.md exists with research notes', oracleHint: 'file', tool: 'glob', args: { pattern: 'docs/*.md' } }
  ],
  constraints: [],
  inputs: [],
  outOfScope: []
});

const GRADER_LIVE_README = graderContract({
  goal: '创建 README.md 含 live-verification-ok',
  acceptanceCriteria: [{ id: 'AC1', desc: '文件 README.md 包含字符串 live-verification-ok', oracleHint: 'file' }],
  constraints: [],
  inputs: [],
  outOfScope: []
});

const GRADER_LIVE_HE54 = graderContract({
  goal: '实现 same_chars 并通过测试',
  acceptanceCriteria: [
    { id: 'AC1', desc: 'same_chars.py 实现文件已创建且包含 same_chars 函数定义', oracleHint: 'file' },
    { id: 'AC2', desc: 'python 真实运行 7 个官方测试断言，输出显示全部通过（exit code 0，无 AssertionError）', oracleHint: 'run' }
  ],
  constraints: [],
  inputs: [],
  outOfScope: []
});

let _envSeq = 0;
function makeEnv(binderFamilyFallback: boolean, grader: string = GRADER) {
  const ctx = new Context();
  const session = Session.create(SessionId(`sess-completion-${++_envSeq}`));
  const agent = { id: `completion-agent-${_envSeq}`, session } as unknown as Agent;
  ctx.provide('agents', {
    get: (id: string) => (id === agent.id ? agent : undefined)
  } as never);
  new GoalService(ctx, { defaultMaxGoalRounds: 16 });
  const goals = ctx.get('goals') as GoalService;
  const config: VerificationRuntimeConfig = {
    mode: 'enforce',
    maxCapturedEvidence: 200,
    maxCapturedBytes: 20 * 1024 * 1024,
    completionPermitTtlMs: 60_000,
    configHash: 'cfg-completion',
    enableDeterministic: true,
    enableAssistantResponse: true,
    enableCoverage: true,
    enableProReview: false,
    proReviewProvider: 'spawn',
    globalConstraints: [],
    intent: { consensusCount: 1, contractOrigin: 'independent-capture', maxEntries: 200 },
    readOnlyToolAllowlist: [],
    binderFamilyFallback
  };
  const store = createMemoryBlobStore();
  const svc = new VerificationService(ctx, config, { store });
  ctx.provide('llm', makeFakeLlm({ respondWith: () => grader }));
  return { ctx, session, agent, goals, svc, store };
}

type Env = ReturnType<typeof makeEnv>;

async function bootstrapFilePlan(env: Env) {
  env.session.append(
    'user/message',
    { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'Produce the research summary document' }] },
    { surfaceOp: 'append' }
  );
  const view = env.goals.create(env.agent, { objective: 'Produce a research summary document' });
  const result = await env.svc.setPlanFromProposal(env.agent, view.id, view.revision, {
    goal_value: 'Produce a research summary document',
    acceptance_criteria: [
      { id: 'AC1', desc: 'docs/02-external-research-summary.md exists with research notes', oracleHint: 'file', tool: 'glob', args: { pattern: 'docs/*.md' } }
    ],
    constraints: [],
    inputs: [],
    outOfScope: []
  });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return view;
}

/** agent 的真实交付：write 调用（写 docs/02-external-research-summary.md）→ file_diff 证据。 */
async function agentWritesDoc(env: Env, seq: number) {
  await env.svc.captureEvidence(
    env.agent,
    {
      callId: 'w1',
      name: 'write',
      arguments: { path: 'docs/02-external-research-summary.md', content: 'research notes: source A (url), source B (url)' },
      isError: false,
      value: { path: 'docs/02-external-research-summary.md', bytes: 200, content: 'research notes: source A (url), source B (url)' }
    },
    seq
  );
}

describe('task completion capability (family fallback fixes false rejection of genuine completions)', () => {
  it('WITH family fallback: genuine completion passes the gate (glob selector + write deliverable) → gate=done', async () => {
    const env = makeEnv(true);
    await bootstrapFilePlan(env);
    await agentWritesDoc(env, 40);

    const outcome = await env.svc.evaluateGate(env.agent);
    expect(outcome.gate.status).toBe('done');

    // 裁决为 pass，且 detail 注明 family evidence fallback（可审计）
    const verdicts = env.svc.getProjection(env.agent).verdicts;
    expect(verdicts.AC1?.result).toBe('pass');
    expect(verdicts.AC1?.detail ?? '').toContain('family evidence fallback');
  });

  it('WITHOUT family fallback: the SAME genuine completion is falsely rejected (reproduces the ac-research false negative) → gate=failed', async () => {
    const env = makeEnv(false);
    await bootstrapFilePlan(env);
    await agentWritesDoc(env, 40);

    const outcome = await env.svc.evaluateGate(env.agent);
    expect(outcome.gate.status).toBe('failed');
    const verdicts = env.svc.getProjection(env.agent).verdicts;
    expect(verdicts.AC1?.result).toBe('fail');
    expect(verdicts.AC1?.detail ?? '').toContain('no committed run for selector');
  });

  it('LIVE reproduction (2026-08-18 real model): agent froze selector {path:README.md} but wrote with {file_path: absolute} → family fallback makes the genuine completion pass', async () => {
    // 真实 live 会话 session-efdad254：agent 用 set_verification_plan 冻结了 write + {path:'README.md'}，
    // 但实际 write 调用是 {file_path:'C:\\...\\README.md'}（参数名 + 绝对路径不同）→ exact 哈希不匹配。
    // 文件真实存在且内容正确；family fallback（路径对齐 README.md）应将其转 pass。
    const env = makeEnv(true, GRADER_LIVE_README);
    env.session.append('user/message', { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: '创建 README.md 含 live-verification-ok' }] }, { surfaceOp: 'append' });
    const view = env.goals.create(env.agent, { objective: '创建 README.md 含 live-verification-ok' });
    const proposal = {
      goal_value: '创建 README.md 含 live-verification-ok',
      acceptance_criteria: [{ id: 'AC1', desc: '文件 README.md 包含字符串 live-verification-ok', oracleHint: 'file', tool: 'write', args: { path: 'README.md' } }],
      constraints: [],
      inputs: [],
      outOfScope: []
    };
    const result = await env.svc.setPlanFromProposal(env.agent, view.id, view.revision, proposal);
    if (!result.ok) throw new Error(result.reason);

    // agent 的真实 write 调用（live 形状：file_path 绝对路径）
    await env.svc.captureEvidence(
      env.agent,
      {
        callId: 'w1',
        name: 'write',
        arguments: { file_path: 'C:\\Users\\Administrator\\.dsh\\tmp\\live-demo\\README.md', content: '# Live Demo\n\nlive-verification-ok' },
        isError: false,
        value: { path: 'C:\\Users\\Administrator\\.dsh\\tmp\\live-demo\\README.md', after: '# Live Demo\n\nlive-verification-ok' }
      },
      40
    );

    const outcome = await env.svc.evaluateGate(env.agent);
    expect(outcome.gate.status).toBe('done');
    const verdicts = env.svc.getProjection(env.agent).verdicts;
    expect(verdicts.AC1?.result).toBe('pass');
    expect(verdicts.AC1?.detail ?? '').toContain('family evidence fallback');
  });

  it('LIVE reproduction (2026-08-18 HE/54): run-family selector mismatch → contract-level command alignment → gate=done', async () => {
    // 真实 live 会话（v9.3 复测）：契约含 file AC（same_chars.py）+ run AC（描述"输出显示全部通过"，
    // 无文件名特征）→ 实际 shell 运行 `python same_chars.py`（与冻结 selector 参数不同）→
    // run 族兜底需用契约级提示（file AC 的 same_chars）对齐命令 → 应转 pass。
    const env = makeEnv(true, GRADER_LIVE_HE54);
    env.session.append('user/message', { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: '实现 same_chars 并通过测试' }] }, { surfaceOp: 'append' });
    const view = env.goals.create(env.agent, { objective: '实现 same_chars 并通过测试' });
    const proposal = {
      goal_value: '实现 same_chars 并通过测试',
      acceptance_criteria: [
        { id: 'AC1', desc: 'same_chars.py 实现文件已创建且包含 same_chars 函数定义', oracleHint: 'file', tool: 'write', args: { path: 'same_chars.py' } },
        { id: 'AC2', desc: 'python 真实运行 7 个官方测试断言，输出显示全部通过（exit code 0，无 AssertionError）', oracleHint: 'run', tool: 'shell', args: { command: 'python test_same_chars.py' } }
      ],
      constraints: [],
      inputs: [],
      outOfScope: []
    };
    const result = await env.svc.setPlanFromProposal(env.agent, view.id, view.revision, proposal);
    if (!result.ok) throw new Error(result.reason);

    // 真实 write（file AC 证据，路径含 same_chars.py）
    await env.svc.captureEvidence(
      env.agent,
      { callId: 'w1', name: 'write', arguments: { file_path: 'C:\\work\\same_chars.py', content: 'def same_chars(s0, s1): return set(s0) == set(s1)' }, isError: false, value: { path: 'C:\\work\\same_chars.py', after: 'def same_chars(s0, s1): return set(s0) == set(s1)' } },
      40
    );
    // 真实 shell 运行（与冻结 selector 参数不同，命令含 same_chars）
    await env.svc.captureEvidence(
      env.agent,
      { callId: 'r1', name: 'shell', arguments: { command: 'python same_chars.py; echo "EXIT_CODE=$LASTEXITCODE"' }, isError: false, value: { exitCode: 0, stdout: 'all 7 passed' } },
      45
    );

    const outcome = await env.svc.evaluateGate(env.agent);
    expect(outcome.gate.status).toBe('done');
    const verdicts = env.svc.getProjection(env.agent).verdicts;
    expect(verdicts.AC1?.result).toBe('pass');
    expect(verdicts.AC2?.result).toBe('pass');
    expect(verdicts.AC2?.detail ?? '').toContain('family evidence fallback');
  });

  it('M1 lockout regression: stale plan + no active epoch → getContract degrades to null (no throw, no tool lockout)', async () => {
    // 2026-08 真实故障：goal complete 后 epoch 关闭，残留 plan + 无活跃 epoch →
    // 旧引擎 getPlanView 抛 VERIFICATION_MISSING_ROOT_GOAL → 写工具/update_goal complete 全被锁死。
    // 修复（ef708a8）：getPlanView 降级返回 null → advisory 写工具放行、complete 走无契约路径。
    const env = makeEnv(true, GRADER);
    await bootstrapFilePlan(env);
    // 完成 goal → epoch 关闭
    await env.svc.captureEvidence(env.agent, { callId: 'w1', name: 'write', arguments: { path: 'docs/r.md', content: 'x' }, isError: false, value: { path: 'docs/r.md', after: 'x' } }, 40);
    const cur = env.goals.get(env.agent)!;
    await env.svc.prepareGoalCompletion(env.agent, cur.id, cur.revision);
    env.goals.complete(env.agent, { id: cur.id, revision: cur.revision });
    // goal complete → 无活跃 epoch
    expect(env.svc.getActiveEpoch(env.agent)).toBeUndefined();
    // 残留 plan 存在，但 getContract 必须降级为 null（不抛错）
    expect(env.svc.getContract(env.agent)).toBeNull();
  });
});
