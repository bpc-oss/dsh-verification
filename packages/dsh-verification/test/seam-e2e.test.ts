/**
 * GoalTransitionGuard seam 端到端（v9）：挂载**真实（vendored）GoalService**，证明：
 *  - 无 permit 直接 ctx.goals.complete() → GOAL_TRANSITION_DENIED，goal revision/phase 不变；
 *  - 合法 prepare → complete 成功 + complete 事件携带 permitRef 归因；
 *  - stale revision（edit 后旧 permit）→ 拒绝；
 *  - guard 注销 → 向后兼容放行（上游 seam 兼容性证明）；
 *  - strict replay（envelope 权威、插件真实身份+快照）对 committed complete 验证通过。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { GoalService, GoalError } from '@deepseek-ai/dsh-goal';
import { contractIdentityOf } from '@bpc-oss/dsh-evidence';

import { installGoalTransitionGuard } from '../src/goal-guard';
import { apply } from '../src/index';
import { VerificationService } from '../src/service';
import type { VerificationRuntimeConfig } from '../src/service';
import { createMemoryBlobStore } from '../src/evidence-store';
import { computeGateSnapshotHash, validatePermitForCompletion } from '../src/permits';
import type { PermitLogEntry } from '../src/permits';
import { contractJson, graderContract, makeFakeLlm } from './fake-llm';

// grader 回显体（与 bootstrapPlan 的提案一致；selector 由服务端按 acId 回填）
const GRADER_ECHO = graderContract({
  goal: 'Make the tests pass',
  acceptanceCriteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test' }],
  constraints: [],
  inputs: [],
  outOfScope: []
});

// 进程级 guard 注册表：每个测试后清理，避免跨测试 "guards bleed"
const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()!();
  }
});

function makeEnv() {
  const ctx = new Context();
  const session = Session.create(SessionId('sess-seam'));
  const agent = { id: 'seam-agent', session } as unknown as Agent;
  ctx.provide('agents', {
    get: (id: string) => (id === agent.id ? agent : undefined)
  } as never);
  // 构造即自动注册 'goals'；统一使用 ctx 解析出的同一实例（guard 注册与 complete 走同一对象）
  new GoalService(ctx, { defaultMaxGoalRounds: 16 });
  const goals = ctx.get('goals') as GoalService;
  const config: VerificationRuntimeConfig = {
    mode: 'enforce',
    maxCapturedEvidence: 200,
    maxCapturedBytes: 20 * 1024 * 1024,
    completionPermitTtlMs: 60_000,
    configHash: 'cfg-seam',
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
  ctx.provide('llm', makeFakeLlm({ respondWith: () => GRADER_ECHO }));
  const disposeGuard = installGoalTransitionGuard(ctx, svc);
  if (!disposeGuard) {
    throw new Error('seam not present: vendored dsh-goal must expose registerTransitionGuard');
  }
  disposers.push(disposeGuard);
  return { ctx, session, agent, goals, svc, store, disposeGuard };
}

type Env = ReturnType<typeof makeEnv>;

async function bootstrapPlan(env: Env): Promise<{ id: string; revision: number }> {
  env.session.append('user/message', { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'Make the tests pass' }] }, { surfaceOp: 'append' });
  const view = env.goals.create(env.agent, { objective: 'Make the tests pass' });
  const result = await env.svc.setPlanFromProposal(env.agent, view.id, view.revision, {
    goal_value: 'Make the tests pass',
    acceptance_criteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test', tool: 'bash', args: { command: 'npm test' } }],
    constraints: [],
    inputs: [],
    outOfScope: []
  });
  if (!result.ok) throw new Error(result.reason);
  return { id: view.id, revision: view.revision };
}

function permitLogOf(env: { session: Session }): PermitLogEntry[] {
  const out: PermitLogEntry[] = [];
  for (const event of env.session.events) {
    if (event.type === 'verification/change') {
      const rec = (event.data as { record?: { kind?: string; permitRef?: string; goalId?: string; goalRevision?: number; contractIdentity?: PermitLogEntry['record']['contractIdentity']; gateSnapshotHash?: string; configHash?: string; ttlMs?: number } }).record;
      if (rec?.kind === 'permit') {
        out.push({ record: rec as PermitLogEntry['record'], seq: event.seq, time: event.time });
      }
    }
  }
  return out;
}

function strictReplayCheck(env: Env, completeEvent: { seq: number; time: number; permitRef: string }, goalId: string, preCompleteRevision: number): boolean {
  const contract = env.svc.getProjection(env.agent).plan!.contract;
  const identity = contractIdentityOf(contract);
  const projection = env.svc.getProjection(env.agent);
  const snapshot = computeGateSnapshotHash({
    contractIdentity: identity,
    verdicts: projection.verdicts,
    evidenceBlobHashes: projection.evidenceRefs.map((ref) => ref.blobHash),
    captureFailures: projection.captureFailures.length,
    configHash: 'cfg-seam',
    schemaVersion: 1
  });
  const result = validatePermitForCompletion({
    completed: { goalId, goalRevision: preCompleteRevision, permitRef: completeEvent.permitRef, completeSeq: completeEvent.seq, completeTime: completeEvent.time },
    permits: permitLogOf(env),
    policies: { 'cfg-seam': { configHash: 'cfg-seam', completionPermitTtlMs: 60_000, schemaVersion: 1 } },
    contractIdentity: identity,
    gateSnapshotHash: snapshot
  });
  return result.ok;
}

describe('GoalTransitionGuard seam E2E (real GoalService)', () => {
  function completeOrThrow(env: Env, id: string, revision: number): unknown {
    try {
      env.goals.complete(env.agent, { id, revision });
      return undefined;
    } catch (error) {
      return error;
    }
  }

  function expectDenied(thrown: unknown): asserts thrown is GoalError {
    expect(thrown).toBeInstanceOf(GoalError);
    expect((thrown as GoalError).code).toBe('GOAL_TRANSITION_DENIED');
  }

  it('direct ctx.goals.complete() without a permit is DENIED with zero mutation', async () => {
    const env = makeEnv();
    const view = await bootstrapPlan(env);
    expectDenied(completeOrThrow(env, view.id, view.revision));
    const current = env.goals.get(env.agent)!;
    expect(current.phase).toBe('active');
    expect(current.revision).toBe(view.revision);
  });

  it('permit-minted completion succeeds with permitRef attribution; strict replay validates it', async () => {
    const env = makeEnv();
    const view = await bootstrapPlan(env);
    await env.svc.captureEvidence(
      env.agent,
      { callId: 'c1', name: 'bash', arguments: { command: 'npm test' }, isError: false, value: { exitCode: 0, stdout: 'Tests  5 passed (5)' } },
      30
    );
    await env.svc.prepareGoalCompletion(env.agent, view.id, view.revision);

    const completed = env.goals.complete(env.agent, { id: view.id, revision: view.revision });
    expect(completed.phase).toBe('complete');

    const completeEvent = env.session.events.find((e) => e.type === 'goal/change' && (e.data as { operation?: string }).operation === 'complete')!;
    const data = completeEvent.data as { permitRef?: string; goal?: { id: string; revision: number } };
    expect(data.permitRef).toBeDefined();
    expect(data.goal!.id).toBe(view.id);

    // strict replay：pre-complete revision = complete 事件 goal.revision - 1（完成前 revision）
    expect(strictReplayCheck(env, { seq: completeEvent.seq, time: completeEvent.time, permitRef: data.permitRef! }, view.id, data.goal!.revision - 1)).toBe(true);
  });

  it('stale revision / old permit is denied after an edit', async () => {
    const env = makeEnv();
    const view = await bootstrapPlan(env);
    await env.svc.captureEvidence(
      env.agent,
      { callId: 'c1', name: 'bash', arguments: { command: 'npm test' }, isError: false, value: { exitCode: 0, stdout: 'ok' } },
      40
    );
    await env.svc.prepareGoalCompletion(env.agent, view.id, view.revision); // permit for rev 1

    const edited = env.goals.edit(env.agent, { id: view.id, revision: 1 }, { objective: 'changed' });
    expect(edited.revision).toBe(2);
    expectDenied(completeOrThrow(env, view.id, 2));

    await env.svc.prepareGoalCompletion(env.agent, view.id, 2);
    expect(env.goals.complete(env.agent, { id: view.id, revision: 2 }).phase).toBe('complete');
  });

  it('removing the guard restores upstream default (backward compatibility: allow without permit)', async () => {
    const env = makeEnv();
    const view = await bootstrapPlan(env);
    env.disposeGuard();
    const completed = env.goals.complete(env.agent, { id: view.id, revision: view.revision });
    expect(completed.phase).toBe('complete');
    const completeEvent = env.session.events.find((e) => e.type === 'goal/change' && (e.data as { operation?: string }).operation === 'complete')!;
    expect((completeEvent.data as { permitRef?: string }).permitRef).toBeUndefined();
  });
});

/**
 * S1-1 回归：插件 apply() 只在 enforce 安装 GoalTransitionGuard。
 * advisory 必须永不 deny（§4.2 v7/v8）——经真实 GoalService + vendored seam 端到端验证。
 */
describe('apply() guard wiring by mode (S1-1 regression)', () => {
  function applyEnv(mode: 'enforce' | 'advisory') {
    const ctx = new Context();
    const session = Session.create(SessionId(`sess-mode-${mode}`));
    const agent = { id: `agent-${mode}`, session } as unknown as Agent;
    new GoalService(ctx, { defaultMaxGoalRounds: 16 });
    ctx.provide('agents', { get: (id: string) => (id === agent.id ? agent : undefined) } as never);
    ctx.provide('tools', { register: () => () => undefined } as never);
    ctx.provide('systemPrompt', { section: () => undefined } as never);
    ctx.provide('sessionProjections', {
      register: () => () => undefined
    } as never);
    ctx.provide('llm', makeFakeLlm({ respondWith: () => GRADER_ECHO }));
    apply(ctx, { mode });
    const goals = ctx.get('goals') as GoalService;
    return { ctx, session, agent, goals, mode };
  }

  async function plan(env: ReturnType<typeof applyEnv>) {
    env.session.append('user/message', { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'Make the tests pass' }] }, { surfaceOp: 'append' });
    const view = env.goals.create(env.agent, { objective: 'Make the tests pass' });
    const svc = env.ctx.get('verification') as VerificationService;
    const result = await svc.setPlanFromProposal(env.agent, view.id, view.revision, {
      goal_value: 'Make the tests pass',
      acceptance_criteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test', tool: 'bash', args: { command: 'npm test' } }],
      constraints: [],
      inputs: [],
      outOfScope: []
    });
    if (!result.ok) throw new Error(result.reason);
    return view;
  }

  it('advisory mode installs NO guard → complete passes with zero permits and no permitRef (never-deny)', async () => {
    const env = applyEnv('advisory');
    const view = await plan(env);
    // grader 正常工作时 advisory 走正当独立捕获（origin=independent-capture）；重点断言：
    // advisory 不安装 guard → complete 永不 deny，且全程没有 mint 任何 permit
    const svc = env.ctx.get('verification') as VerificationService;
    expect(svc.getContract(env.agent)!.origin).toBe('independent-capture');
    const permits = permitLogOf(env);
    expect(permits).toHaveLength(0);

    // advisory + seam（guard 未安装）→ 直接 complete 成功，事件不带 permitRef
    const completed = env.goals.complete(env.agent, { id: view.id, revision: view.revision });
    expect(completed.phase).toBe('complete');
    const completeEvent = env.session.events.find((e) => e.type === 'goal/change' && (e.data as { operation?: string }).operation === 'complete')!;
    expect((completeEvent.data as { permitRef?: string }).permitRef).toBeUndefined();
  });

  it('enforce mode DOES install the guard → complete without permit is DENIED; with permit passes', async () => {
    const env = applyEnv('enforce');
    const view = await plan(env);
    const svc = env.ctx.get('verification') as VerificationService;

    let thrown: unknown;
    try {
      env.goals.complete(env.agent, { id: view.id, revision: view.revision });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GoalError);
    expect((thrown as GoalError).code).toBe('GOAL_TRANSITION_DENIED');

    // 证据通过 → prepare → complete 成功 + permitRef 归因
    await svc.captureEvidence(
      env.agent,
      { callId: 'c1', name: 'bash', arguments: { command: 'npm test' }, isError: false, value: { exitCode: 0, stdout: 'Tests  5 passed (5)' } },
      30
    );
    await svc.prepareGoalCompletion(env.agent, view.id, view.revision);
    const completed = env.goals.complete(env.agent, { id: view.id, revision: view.revision });
    expect(completed.phase).toBe('complete');
    const completeEvent = env.session.events.find((e) => e.type === 'goal/change' && (e.data as { operation?: string }).operation === 'complete')!;
    expect((completeEvent.data as { permitRef?: string }).permitRef).toBeDefined();
  });
});


