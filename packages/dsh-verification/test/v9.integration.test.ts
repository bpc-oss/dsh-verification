import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import '@deepseek-ai/dsh-goal';
import type { ContractIdentity, ToolRecord } from '@bpc-oss/dsh-evidence';

import { VerificationService, VerificationError } from '../src/service';
import type { VerificationRuntimeConfig } from '../src/service';
import { createMemoryBlobStore, type BlobStore } from '../src/evidence-store';
import { installCompleteGateHook } from '../src/complete-gate-hook';
import { contractJson, graderContract, makeFakeLlm } from './fake-llm';

const IDENTITY_FIXTURE: ContractIdentity = { contractId: 'c-test', revision: 0, contractContentHash: 'cc', basisHash: 'bb', sessionId: 'sess-v9' };

/** grader 回显体（与 testProposal 内容一致；selector 由服务端按 acId 从提案回填）。 */
const GRADER_ECHO = graderContract({
  goal: 'Make the tests pass',
  acceptanceCriteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test' }],
  constraints: [],
  inputs: ['tests/'],
  outOfScope: []
});

interface Setup {
  ctx: Context;
  session: Session;
  agent: Agent;
  service: VerificationService;
  store: BlobStore;
}

function setup(mode: 'enforce' | 'advisory' = 'enforce', overrides: Partial<VerificationRuntimeConfig> = {}, suppliedStore?: BlobStore): Setup {
  const ctx = new Context();
  const store = suppliedStore ?? createMemoryBlobStore();
  const session = Session.create(SessionId('sess-v9'));
  const agent = { id: 'agent-1', session } as unknown as Agent;
  const config: VerificationRuntimeConfig = {
    mode,
    maxCapturedEvidence: 200,
    maxCapturedBytes: 20 * 1024 * 1024,
    completionPermitTtlMs: 30_000,
    configHash: 'cfg-test',
    enableDeterministic: true,
    enableAssistantResponse: true,
    enableCoverage: true,
    enableProReview: false,
    proReviewProvider: 'spawn',
    globalConstraints: [],
    intent: { consensusCount: 1, contractOrigin: 'independent-capture', maxEntries: 200 },
    readOnlyToolAllowlist: [],
    ...overrides
  };
  // S1-2：主测试路径必须走正当独立捕获（grader 回显）——无 llm 的显式拒绝路径单独测试。
  ctx.provide('llm', makeFakeLlm({ respondWith: () => GRADER_ECHO }));
  const service = new VerificationService(ctx, config, { store, clock: () => 1_000_000 });
  return { ctx, session, agent, service, store };
}

/** 完全无 llm/askUser 的 bare service（用于断言 enforce 拒绝/ advisory 降级标签）。 */
async function makeBareService(mode: 'enforce' | 'advisory'): Promise<{ service: VerificationService; session: Session; agent: Agent }> {
  const ctx = new Context();
  const session = Session.create(SessionId('sess-bare'));
  const agent = { id: 'bare', session } as unknown as Agent;
  const config: VerificationRuntimeConfig = {
    mode,
    maxCapturedEvidence: 200,
    maxCapturedBytes: 20 * 1024 * 1024,
    completionPermitTtlMs: 30_000,
    configHash: 'cfg-bare',
    enableDeterministic: true,
    enableAssistantResponse: true,
    enableCoverage: true,
    enableProReview: false,
    proReviewProvider: 'spawn',
    globalConstraints: [],
    intent: { consensusCount: 1, contractOrigin: 'independent-capture', maxEntries: 200 },
    readOnlyToolAllowlist: []
  };
  const service = new VerificationService(ctx, config, { store: createMemoryBlobStore(), clock: () => 1_000_000 });
  return { service, session, agent };
}

describe('contract authority (S1-2: no silent degrade)', () => {
  async function prepBare(session: Session): Promise<void> {
    session.append('user/message', { id: 'u-bare', source: { kind: 'user' }, content: [{ type: 'text', text: 'Make the tests pass' }] }, { surfaceOp: 'append' });
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: { id: 'g-1', revision: 1, phase: 'active', objective: 'Make the tests pass', maxGoalRounds: 10 },
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 1
    });
  }

  it('enforce + independent-capture unavailable → explicit rejection, no contract', async () => {
    const { service, session, agent } = await makeBareService('enforce');
    await prepBare(session);
    const result = await service.setPlanFromProposal(agent, 'g-1', 1, {
      goal_value: 'Make the tests pass',
      acceptance_criteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test', tool: 'bash', args: { command: 'npm test' } }],
      constraints: [],
      inputs: [],
      outOfScope: []
    });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('independent-capture unavailable');
    expect(service.getContract(agent)).toBeNull();
  });

  it('advisory + independent-capture unavailable → plan still set, origin honestly model-self-declared', async () => {
    const { service, session, agent } = await makeBareService('advisory');
    await prepBare(session);
    const result = await service.setPlanFromProposal(agent, 'g-1', 1, {
      goal_value: 'Make the tests pass',
      acceptance_criteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test', tool: 'bash', args: { command: 'npm test' } }],
      constraints: [],
      inputs: [],
      outOfScope: []
    });
    expect(result.ok).toBe(true);
    expect(service.getContract(agent)!.origin).toBe('model-self-declared');
  });

  it('enforce + human-confirmed without askUser → explicit rejection, no contract; advisory → model-self-declared', async () => {
    const enforce = await makeBareService('enforce');
    await prepBare(enforce.session);
    const rej = await enforce.service.setPlanFromProposal(enforce.agent, 'g-1', 1, {
      goal_value: 'x',
      acceptance_criteria: [{ id: 'AC1', desc: 'r', oracleHint: 'test' }],
      constraints: [],
      inputs: [],
      outOfScope: []
    });
    expect(rej.ok).toBe(false);
    expect((rej as { reason: string }).reason).toContain('human-confirmed');

    const advisory = await makeBareService('advisory');
    await prepBare(advisory.session);
    const ok = await advisory.service.setPlanFromProposal(advisory.agent, 'g-1', 1, {
      goal_value: 'x',
      acceptance_criteria: [{ id: 'AC1', desc: 'r', oracleHint: 'test' }],
      constraints: [],
      inputs: [],
      outOfScope: []
    });
    expect(ok.ok).toBe(true);
  });

  it('enforce + fake grader → authoritative contract (origin independent-capture) keeps the proposal frozen selector by acId', async () => {
    const s = setup();
    userMessage(s.session, 'Make the tests pass');
    createGoal(s.session);
    // 注意：grader 回显体不含 selector —— 服务端按 acId 从提案回填（grader 无法预测工具参数）
    const result = await s.service.setPlanFromProposal(s.agent, 'g-1', 1, testProposal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.origin).toBe('independent-capture');
      const ac1 = result.contract.acceptanceCriteria.find((ac) => ac.id === 'AC1')!;
      expect(ac1.selector).toBeDefined();
      expect(ac1.selector!.toolIdentity).toBe('bash');
    }
  });
});

function userMessage(session: Session, text: string): void {
  session.append('user/message', { id: `u-${session.seq}`, source: { kind: 'user' }, content: [{ type: 'text', text }] }, { surfaceOp: 'append' });
}

function createGoal(session: Session, goalId = 'g-1', revision = 1): void {
  session.append('goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'create',
    goal: { id: goalId, revision, phase: 'active', objective: 'Make the tests pass', maxGoalRounds: 10 },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1
  });
}

function completeGoal(session: Session, goalId = 'g-1', revision = 2): void {
  session.append('goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'complete',
    goal: { id: goalId, revision, phase: 'complete', objective: 'Make the tests pass', maxGoalRounds: 10 },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 2
  });
}

function testProposal() {
  return {
    goal_value: 'Make the tests pass',
    acceptance_criteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test' as const, tool: 'bash', args: { command: 'npm test' } }],
    constraints: [],
    inputs: ['tests/'],
    outOfScope: []
  };
}

function bashRecord(overrides: Partial<ToolRecord> = {}): ToolRecord {
  return { callId: 'call-1', name: 'bash', arguments: { command: 'npm test' }, isError: false, value: { exitCode: 0, stdout: 'Tests  5 passed (5)' }, ...overrides };
}

async function bootstrapContract(setupData: Setup): Promise<void> {
  userMessage(setupData.session, 'Make the tests pass');
  createGoal(setupData.session);
  const result = await setupData.service.setPlanFromProposal(setupData.agent, 'g-1', 1, testProposal());
  if (!result.ok) throw new Error(result.reason);
}

describe('verification v9: goal-bound epoch + contract authority', () => {
  it('plans MUST attach an active root goal; no goal → missing_root_goal, zero epoch', async () => {
    const s = setup();
    userMessage(s.session, 'do it');
    const result = await s.service.setPlanFromProposal(s.agent, 'g-1', 1, testProposal());
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('missing_root_goal');
    expect(s.service.getActiveEpoch(s.agent)).toBeUndefined();
  });

  it('rejects a stale goal revision', async () => {
    const s = setup();
    userMessage(s.session, 'do it');
    createGoal(s.session);
    const result = await s.service.setPlanFromProposal(s.agent, 'g-1', 99, testProposal());
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('stale_revision');
  });

  it('mints a server-side ContractRef with a five-tuple identity and sourceBasis', async () => {
    const s = setup();
    await bootstrapContract(s);
    const contract = s.service.getContract(s.agent)!;
    expect(contract.ref.contractId).toMatch(/^[0-9a-f]{64}$/);
    expect(contract.ref.sourceBasis.sessionId).toBe('sess-v9');
    expect(contract.ref.sourceBasis.entries.length).toBeGreaterThanOrEqual(1);
    const identity = contract.ref;
    expect(identity.contractContentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('freezes only after a mutating tool passes the pre-execute gate', async () => {
    const s = setup();
    installCompleteGateHook(s.ctx, s.service, { mode: 'enforce', readOnlyAllowlist: ['read_file'] });
    await bootstrapContract(s);
    expect(s.service.isFrozen(s.agent)).toBe(false);
    // 只读工具不触发冻结
    const read = await (s.ctx as unknown as { waterfall: (name: string, ...args: unknown[]) => Promise<unknown> }).waterfall('tools/pre-execute', { name: 'read_file', arguments: {}, agent: s.agent }, () => Promise.resolve({ kind: 'allow' }));
    expect(read).toEqual({ kind: 'allow' });
    expect(s.service.isFrozen(s.agent)).toBe(false);
    // 写入工具 → 冻结 + 放行
    const write = await (s.ctx as unknown as { waterfall: (name: string, ...args: unknown[]) => Promise<unknown> }).waterfall('tools/pre-execute', { name: 'write_file', arguments: { path: 'a.ts' }, agent: s.agent }, () => Promise.resolve({ kind: 'allow' }));
    expect(write).toEqual({ kind: 'allow' });
    expect(s.service.isFrozen(s.agent)).toBe(true);
  });
});

describe('verification v9: gate + permit + replay', () => {
  it('anti-lie: declares done with no evidence → gate failed, no permit', async () => {
    const s = setup('enforce');
    await bootstrapContract(s);
    const outcome = await s.service.evaluateGate(s.agent);
    expect(outcome.gate.status).toBe('failed');
    await s.service.prepareGoalCompletion(s.agent, 'g-1', 1);
    expect(s.service.assertCompletionPermit(s.agent, 'g-1', 1).ok).toBe(false);
  });

  it('runs the exact selector command successfully → gate done + permit valid', async () => {
    const s = setup('enforce');
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, bashRecord(), 20);
    const outcome = await s.service.evaluateGate(s.agent);
    expect(outcome.gate.status).toBe('done');
    await s.service.prepareGoalCompletion(s.agent, 'g-1', 1);
    const permit = s.service.assertCompletionPermit(s.agent, 'g-1', 1);
    expect(permit.ok).toBe(true);
  });

  it('test run FAILS → gate failed (fail closed)', async () => {
    const s = setup('enforce');
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, bashRecord({ value: { exitCode: 1, stdout: 'Test Files 1 failed (1)' } }), 20);
    const outcome = await s.service.evaluateGate(s.agent);
    expect(outcome.gate.status).toBe('failed');
    expect(outcome.gate.reasons.join(' ')).toContain('AC1');
  });

  it('echo PASS cannot impersonate npm test (exact selector)', async () => {
    const s = setup('enforce');
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, bashRecord({ arguments: { command: 'echo PASS' }, value: { exitCode: 0, stdout: 'PASS' } }), 20);
    const outcome = await s.service.evaluateGate(s.agent);
    expect(outcome.gate.status).toBe('failed');
    expect(outcome.gate.reasons.join(' ')).toContain('no committed run');
  });

  it('a later FAILED run overrides an earlier PASS (highest committed seq, no cherry-pick)', async () => {
    const s = setup('enforce');
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, bashRecord({ callId: 'pass', value: { exitCode: 0, stdout: 'Tests 5 passed' } }), 30);
    await s.service.captureEvidence(s.agent, bashRecord({ callId: 'fail', value: { exitCode: 1, stdout: 'Tests 1 failed' } }), 40);
    const outcome = await s.service.evaluateGate(s.agent);
    expect(outcome.gate.status).toBe('failed');
  });

  it('blob missing/corrupt → fail closed (no silent pass)', async () => {
    const s = setup('enforce');
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, bashRecord(), 20);
    for (const ref of s.service.getProjection(s.agent).evidenceRefs) {
      await s.store.delete(ref.blobHash);
    }
    const outcome = await s.service.evaluateGate(s.agent);
    expect(outcome.gate.status).toBe('failed');
    expect(outcome.gate.reasons.join(' ')).toContain('blob');
  });

  it('restart/replay: a fresh service over the same session + store reproduces the same gate verdict', async () => {
    const s = setup('enforce');
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, bashRecord(), 20);
    await s.service.evaluateGate(s.agent);
    await s.service.prepareGoalCompletion(s.agent, 'g-1', 1);
    const before = s.service.assertCompletionPermit(s.agent, 'g-1', 1);
    expect(before.ok).toBe(true);

    // 模拟重启：新进程（新 Context+新 service）共享同一 session 日志与 blob 存储
    const ctx2 = new Context();
    const session2 = s.session;
    const agent2 = { id: 'agent-1', session: session2 } as unknown as Agent;
    const resumed = new VerificationService(
      ctx2,
      {
        mode: 'enforce',
        maxCapturedEvidence: 200,
        maxCapturedBytes: 20 * 1024 * 1024,
        completionPermitTtlMs: 30_000,
        configHash: 'cfg-test',
        enableDeterministic: true,
        enableAssistantResponse: true,
        enableCoverage: true,
        enableProReview: false,
        proReviewProvider: 'spawn',
        globalConstraints: [],
        intent: { consensusCount: 1, contractOrigin: 'independent-capture', maxEntries: 200 },
        readOnlyToolAllowlist: []
      },
      { store: s.store, clock: () => 2_000_000 }
    );
    const replayed = await resumed.evaluateGate(agent2);
    expect(replayed.gate.status).toBe('done');
    expect(resumed.getContract(agent2)?.ref.contractId).toBe(s.service.getContract(s.agent)!.ref.contractId);
    expect(resumed.assertCompletionPermit(agent2, 'g-1', 1).ok).toBe(true);
  });

  it('enforce without a contract throws missing_contract', async () => {
    const s = setup('enforce');
    userMessage(s.session, 'x');
    await expect(s.service.evaluateGate(s.agent)).rejects.toThrow(VerificationError);
  });

  it('capture caps: exceeding maxCapturedEvidence writes a capture-failure and gate fails closed', async () => {
    const s = setup('enforce', { maxCapturedEvidence: 1 });
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, bashRecord({ callId: 'c1', value: { exitCode: 0, stdout: 'ok' } }), 20);
    await s.service.captureEvidence(s.agent, bashRecord({ callId: 'c2', value: { exitCode: 0, stdout: 'ok' } }), 30);
    const outcome = await s.service.evaluateGate(s.agent);
    expect(outcome.gate.status).toBe('failed');
    expect(s.service.getProjection(s.agent).captureFailures.length).toBeGreaterThan(0);
  });

  it('capture byte cap is cumulative within the full contract identity', async () => {
    const s = setup('enforce', { maxCapturedBytes: 1_000 });
    await bootstrapContract(s);
    const output = 'x'.repeat(300);
    await s.service.captureEvidence(s.agent, bashRecord({ callId: 'bytes-1', value: { exitCode: 0, stdout: output } }), 20);
    await s.service.captureEvidence(s.agent, bashRecord({ callId: 'bytes-2', value: { exitCode: 0, stdout: output } }), 30);
    expect(s.service.getProjection(s.agent).evidenceRefs).toHaveLength(1);
    expect(s.service.getProjection(s.agent).captureFailures.some((failure) => failure.callId === 'bytes-2' && failure.error.includes('maxCapturedBytes'))).toBe(true);
  });

  it('epoch closes from the root goal log; complete after close cannot reuse the old epoch', async () => {
    const s = setup('enforce');
    userMessage(s.session, 'task A');
    createGoal(s.session, 'g-a');
    completeGoal(s.session, 'g-a');
    userMessage(s.session, 'task B');
    createGoal(s.session, 'g-b');
    const active = s.service.getActiveEpoch(s.agent)!;
    expect(active.rootGoalId).toBe('g-b');
  });

  it('does not let task B consume task A plan, evidence, or permit after task A closes', async () => {
    const s = setup('enforce');
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, bashRecord({ callId: 'a-pass', value: { exitCode: 0, stdout: 'ok' } }), 20);
    await s.service.prepareGoalCompletion(s.agent, 'g-1', 1);
    completeGoal(s.session, 'g-1');
    userMessage(s.session, 'task B');
    createGoal(s.session, 'g-b');
    expect(s.service.getContract(s.agent)).toBeNull();
    await expect(s.service.evaluateGate(s.agent)).rejects.toThrow(VerificationError);
    expect(s.service.assertCompletionPermit(s.agent, 'g-b', 1).ok).toBe(false);
  });

  it('does not let another agent in the same session read or consume this agent scope', async () => {
    const s = setup('enforce');
    await bootstrapContract(s);
    const other = { id: 'agent-2', session: s.session } as unknown as Agent;
    expect(s.service.getContract(other)).toBeNull();
    expect(s.service.assertCompletionPermit(other, 'g-1', 1).ok).toBe(false);
  });

  it('fails a forbidden-path constraint when blob persistence fails after a write', async () => {
    const failingStore: BlobStore = { write: async () => { throw new Error('blob unavailable'); }, read: async () => null, has: async () => false, delete: async () => undefined };
    const s = setup('enforce', { globalConstraints: [{ id: 'no-secrets', desc: 'no secret writes', check: 'path:secrets/' }] }, failingStore);
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, { callId: 'write-secret', name: 'write_file', arguments: { path: './secrets/../secrets/key' }, isError: false, value: { path: 'secrets/key', after: 'x' } }, 20);
    await s.service.captureEvidence(s.agent, bashRecord({ callId: 'pass', value: { exitCode: 0, stdout: 'Tests  5 passed (5)' } }), 21);
    const gate = await s.service.evaluateGate(s.agent);
    expect(gate.gate.status).toBe('failed');
    expect(s.service.getProjection(s.agent).captureFailures.find((f) => f.callId === 'write-secret')?.policyFacts.paths).toEqual(['secrets/key']);
  });

  it('persists a failed network call as policy facts that blocks network constraints', async () => {
    const failingStore: BlobStore = { write: async () => { throw new Error('blob unavailable'); }, read: async () => null, has: async () => false, delete: async () => undefined };
    const s = setup('enforce', { globalConstraints: [{ id: 'offline', desc: 'offline only', check: 'network:' }] }, failingStore);
    await bootstrapContract(s);
    await s.service.captureEvidence(s.agent, { callId: 'net', name: 'web_fetch', arguments: { url: 'https://example.invalid/a' }, isError: true }, 20);
    await s.service.captureEvidence(s.agent, bashRecord({ callId: 'pass', value: { exitCode: 0, stdout: 'Tests  5 passed (5)' } }), 21);
    const gate = await s.service.evaluateGate(s.agent);
    expect(gate.gate.status).toBe('failed');
    expect(s.service.getProjection(s.agent).captureFailures.find((f) => f.callId === 'net')?.policyFacts.networkCalls).toEqual(['https://example.invalid/a']);
  });
});

describe('verification v9: hook (tools/pre-execute)', () => {
  it('enforce complete without a plan → deny missing_contract; advisory → allow', async () => {
    const s = setup('enforce');
    installCompleteGateHook(s.ctx, s.service, { mode: 'enforce', readOnlyAllowlist: [] });
    const deny = await (s.ctx as unknown as { waterfall: (name: string, ...args: unknown[]) => Promise<unknown> }).waterfall(
      'tools/pre-execute',
      { name: 'update_goal', arguments: { action: 'complete' }, agent: s.agent },
      () => Promise.resolve({ kind: 'allow' })
    );
    expect(deny).toMatchObject({ kind: 'deny' });

    const adv = setup('advisory');
    installCompleteGateHook(adv.ctx, adv.service, { mode: 'advisory', readOnlyAllowlist: [] });
    const allow = await (adv.ctx as unknown as { waterfall: (name: string, ...args: unknown[]) => Promise<unknown> }).waterfall(
      'tools/pre-execute',
      { name: 'update_goal', arguments: { action: 'complete' }, agent: adv.agent },
      () => Promise.resolve({ kind: 'allow' })
    );
    expect(allow).toEqual({ kind: 'allow' });
  });

  it('complete passes only when the gate is done; otherwise deny with defects', async () => {
    const s = setup('enforce');
    installCompleteGateHook(s.ctx, s.service, { mode: 'enforce', readOnlyAllowlist: [] });
    await bootstrapContract(s);
    const exec = { name: 'update_goal', arguments: { action: 'complete', goal_id: 'g-1', revision: 1 }, agent: s.agent };
    const flow = s.ctx as unknown as { waterfall: (name: string, ...args: unknown[]) => Promise<{ kind: string }> };
    const denied = await flow.waterfall('tools/pre-execute', exec, () => Promise.resolve({ kind: 'allow' }));
    expect(denied.kind).toBe('deny');

    await s.service.captureEvidence(s.agent, bashRecord(), 50);
    const allowed = await flow.waterfall('tools/pre-execute', exec, () => Promise.resolve({ kind: 'allow' }));
    expect(allowed.kind).toBe('allow');
  });

  it('advisory never denies and records a gate entry (never-throw over the whole evaluate)', async () => {
    const s = setup('advisory');
    installCompleteGateHook(s.ctx, s.service, { mode: 'advisory', readOnlyAllowlist: [] });
    await bootstrapContract(s);
    const flow = s.ctx as unknown as { waterfall: (name: string, ...args: unknown[]) => Promise<unknown> };
    const decision = await flow.waterfall('tools/pre-execute', { name: 'update_goal', arguments: { action: 'complete', goal_id: 'g-1', revision: 1 }, agent: s.agent }, () => Promise.resolve({ kind: 'allow' }));
    expect(decision).toEqual({ kind: 'allow' });
    expect(s.service.getProjection(s.agent).gateLog.length).toBeGreaterThan(0);
  });
});



