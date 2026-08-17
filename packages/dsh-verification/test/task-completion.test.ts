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

function makeEnv(binderFamilyFallback: boolean) {
  const ctx = new Context();
  const session = Session.create(SessionId('sess-completion'));
  const agent = { id: 'completion-agent', session } as unknown as Agent;
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
  ctx.provide('llm', makeFakeLlm({ respondWith: () => GRADER }));
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
});
