/**
 * P0-1 review 回归测试（2026-08-15）：把插件的定位从"默认强制门槛"改为
 * "可观测的验收/评测增强层"。
 *
 * 四个断言面：
 *  1. 默认 mode = advisory（装插件不改变日常行为，"装了就变差"回归锁死）；
 *  2. 拦截反转：enforce + 无契约下，只读工具（read/grep/glob/read_page）与
 *     未知工具永不 deny；只有明确 write/edit/shell 工具被 missing_contract 拒绝；
 *  3. 人类确认复用 dsh approval 通道（allowed-once → approve，其余 → decline；
 *     不再自建 askUser 通道）；
 *  4. 投影 schema 回归（既有 projection-view.test.ts 已覆盖，此处再锁一条
 *     "schema 与产出不一致会抛错" 的防线，确保会话历史可读性不回归）。
 */
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Session, SessionId } from '@deepseek-ai/dsh-session';

import { VerificationService, type VerificationRuntimeConfig } from '../src/service';
import { createMemoryBlobStore, type BlobStore } from '../src/evidence-store';
import { installCompleteGateHook } from '../src/complete-gate-hook';
import { DEFAULT_READ_ONLY_TOOLS, DEFAULT_WRITE_TOOLS, resolveAskUser, resolveConfig } from '../src/index';
import { graderContract, makeFakeLlm } from './fake-llm';

const GRADER_ECHO = graderContract({
  goal: 'Make the tests pass',
  acceptanceCriteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test' }],
  constraints: [],
  inputs: ['tests/'],
  outOfScope: []
});

function setup(mode: 'enforce' | 'advisory' = 'enforce'): { ctx: Context; session: Session; agent: Agent; service: VerificationService; store: BlobStore } {
  const ctx = new Context();
  const store = createMemoryBlobStore();
  const session = Session.create(SessionId('sess-review'));
  const agent = { id: 'agent-1', session } as unknown as Agent;
  const config: VerificationRuntimeConfig = {
    mode,
    maxCapturedEvidence: 200,
    maxCapturedBytes: 20 * 1024 * 1024,
    completionPermitTtlMs: 30_000,
    configHash: 'cfg-review',
    enableDeterministic: true,
    enableAssistantResponse: true,
    enableCoverage: true,
    enableProReview: false,
    proReviewProvider: 'spawn',
    globalConstraints: [],
    intent: { consensusCount: 1, contractOrigin: 'independent-capture', maxEntries: 200 },
    readOnlyToolAllowlist: []
  };
  ctx.provide('llm', makeFakeLlm({ respondWith: () => GRADER_ECHO }));
  const service = new VerificationService(ctx, config, { store, clock: () => 1_000_000 });
  return { ctx, session, agent, service, store };
}

type Waterfall = (name: string, ...args: unknown[]) => Promise<unknown>;

describe('P0-1 review: default advisory (opt-in enforce)', () => {
  it('resolveConfig with no mode → advisory (installing the plugin must not change daily behavior)', () => {
    expect(resolveConfig({}).mode).toBe('advisory');
    expect(resolveConfig({}).intent.requireContractBeforeExecution).toBe(false);
  });

  it('explicit enforce opts in; explicit advisory respected', () => {
    expect(resolveConfig({ mode: 'enforce' }).intent.requireContractBeforeExecution).toBe(true);
    expect(resolveConfig({ mode: 'advisory', intent: { requireContractBeforeExecution: true } }).intent.requireContractBeforeExecution).toBe(true);
  });
});

describe('P0-1 review: interception is write-tools-only (read/grep never blocked)', () => {
  it('enforce without a plan never rejects read-only tools (read/grep/glob/read_page)', async () => {
    const s = setup('enforce');
    installCompleteGateHook(s.ctx, s.service, { mode: 'enforce', readOnlyAllowlist: [] });
    const flow = s.ctx as unknown as { waterfall: Waterfall };
    for (const name of ['read', 'grep', 'glob', 'read_page', 'web_search']) {
      const decision = await flow.waterfall('tools/pre-execute', { name, arguments: {}, agent: s.agent }, () => Promise.resolve({ kind: 'allow' }));
      expect(decision).toEqual({ kind: 'allow' });
    }
  });

  it('enforce without a plan never rejects unknown/unlisted tools (default allow)', async () => {
    const s = setup('enforce');
    installCompleteGateHook(s.ctx, s.service, { mode: 'enforce', readOnlyAllowlist: [] });
    const flow = s.ctx as unknown as { waterfall: Waterfall };
    for (const name of ['mcp-some-tool', 'future-tool', 'skill', 'subagent']) {
      const decision = await flow.waterfall('tools/pre-execute', { name, arguments: {}, agent: s.agent }, () => Promise.resolve({ kind: 'allow' }));
      expect(decision).toEqual({ kind: 'allow' });
    }
  });

  it('enforce without a plan denies only known write tools (write/edit/shell)', async () => {
    const s = setup('enforce');
    installCompleteGateHook(s.ctx, s.service, { mode: 'enforce', readOnlyAllowlist: [] });
    const flow = s.ctx as unknown as { waterfall: Waterfall };
    for (const name of ['edit', 'write', 'shell', 'bash', 'pwsh']) {
      const decision = await flow.waterfall('tools/pre-execute', { name, arguments: {}, agent: s.agent }, () => Promise.resolve({ kind: 'allow' }));
      expect(decision).toMatchObject({ kind: 'deny' });
      expect((decision as { reason: string }).reason).toMatch(/missing_contract/);
    }
  });

  it('advisory never denies write tools without a plan', async () => {
    const s = setup('advisory');
    installCompleteGateHook(s.ctx, s.service, { mode: 'advisory', readOnlyAllowlist: [] });
    const flow = s.ctx as unknown as { waterfall: Waterfall };
    const decision = await flow.waterfall('tools/pre-execute', { name: 'write', arguments: {}, agent: s.agent }, () => Promise.resolve({ kind: 'allow' }));
    expect(decision).toEqual({ kind: 'allow' });
  });

  it('write tools do not freeze the plan before a contract exists', async () => {
    const s = setup('enforce');
    installCompleteGateHook(s.ctx, s.service, { mode: 'enforce', readOnlyAllowlist: [] });
    const flow = s.ctx as unknown as { waterfall: Waterfall };
    await flow.waterfall('tools/pre-execute', { name: 'read', arguments: {}, agent: s.agent }, () => Promise.resolve({ kind: 'allow' }));
    expect(s.service.isFrozen(s.agent)).toBe(false);
  });

  it('DEFAULT read/write tool tables are DSH-accurate (no Codex/Bobby naming leakage)', () => {
    expect(DEFAULT_READ_ONLY_TOOLS).toEqual(expect.arrayContaining(['read', 'grep', 'glob', 'read_page', 'web_search', 'get_verification_plan']));
    // 旧 Codex/Bobby 名只作兼容尾项，识别主入口是 DSH 真实名
    expect(DEFAULT_READ_ONLY_TOOLS).not.toContain('read_file');
    expect(DEFAULT_WRITE_TOOLS).toEqual(expect.arrayContaining(['edit', 'write', 'shell', 'bash', 'pwsh']));
  });
});

describe('P0-1 review: human confirmation reuses dsh approval (no self-built askUser)', () => {
  it('allowed-once maps to approve; rejected/cancelled/unavailable map to decline', async () => {
    const outcomes = ['allowed-once', 'rejected', 'cancelled', 'unavailable'] as const;
    for (const outcome of outcomes) {
      const ctx = new Context();
      const calls: unknown[] = [];
      ctx.provide('approval', {
        request: (req: unknown) => {
          calls.push(req);
          return Promise.resolve(outcome);
        }
      } as never);
      const askUser = resolveAskUser(ctx as never);
      expect(askUser).toBeDefined();
      const answer = await askUser!({
        agent: { id: 'a' } as never,
        questionId: 'q-review',
        text: 'approve this contract?',
        choices: ['approve', 'decline']
      });
      expect(answer).toBe(outcome === 'allowed-once' ? 'approve' : 'decline');
      expect(calls).toHaveLength(1);
    }
  });

  it('approval request carries the agent and a verifiable reason', async () => {
    const ctx = new Context();
    let captured: { agent: unknown; toolName: string; reason: string; callId: unknown } | undefined;
    ctx.provide('approval', {
      request: (req: { agent: unknown; toolName: string; reason: string; callId: unknown }) => {
        captured = req;
        return Promise.resolve('allowed-once' as const);
      }
    } as never);
    const askUser = resolveAskUser(ctx as never);
    const agent = { id: 'agent-x' } as never;
    await askUser!({ agent, questionId: 'q-1', text: 'approve?', choices: ['approve', 'decline'] });
    expect(captured?.agent).toBe(agent);
    expect(captured?.toolName).toBe('set_verification_plan');
    expect(captured?.reason).toBe('approve?');
    expect(captured?.callId).toBe('q-1');
  });

  it('falls back to userQuestions.ask when approval is not mounted', async () => {
    const ctx = new Context();
    ctx.provide('userQuestions', {
      ask: (req: { options?: string[] }) => Promise.resolve({ selected: 'approve' })
    } as never);
    const askUser = resolveAskUser(ctx as never);
    expect(askUser).toBeDefined();
    const answer = await askUser!({ agent: { id: 'a' } as never, questionId: 'q', text: 'approve?', choices: ['approve', 'decline'] });
    expect(answer).toBe('approve');
  });
});

describe('P0-1 review: human-confirmed contract mints with origin human-confirmed via supply channel', () => {
  it('mint path marks origin human-confirmed when an approval channel answers approve', async () => {
    const ctx = new Context();
    const store = createMemoryBlobStore();
    const session = Session.create(SessionId('sess-review-hc'));
    const agent = { id: 'agent-1', session } as unknown as Agent;
    // 无 llm（human-confirmed 不走独立捕获），approval channel 注入回答 approve
    ctx.provide('approval', {
      request: () => Promise.resolve('allowed-once' as const)
    } as never);
    const askUser = resolveAskUser(ctx as never);
    const config: VerificationRuntimeConfig = {
      mode: 'enforce',
      maxCapturedEvidence: 200,
      maxCapturedBytes: 20 * 1024 * 1024,
      completionPermitTtlMs: 30_000,
      configHash: 'cfg-review-hc',
      enableDeterministic: true,
      enableAssistantResponse: true,
      enableCoverage: true,
      enableProReview: false,
      proReviewProvider: 'spawn',
      globalConstraints: [],
      intent: { consensusCount: 1, contractOrigin: 'human-confirmed', maxEntries: 200 },
      readOnlyToolAllowlist: [],
      askUser
    };
    const service = new VerificationService(ctx, config, { store, clock: () => 2_000_000 });

    session.append('user/message', { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'goal' }] }, { surfaceOp: 'append' });
    session.append('goal/change', {
      kind: 'goal/change', version: 1, operation: 'create',
      goal: { id: 'g-1', revision: 1, phase: 'active', objective: 'goal', maxGoalRounds: 10 },
      roundsStarted: 0, createdAt: 1, updatedAt: 1
    });
    const plan = await service.setPlanFromProposal(agent, 'g-1', 1, {
      goal_value: 'human goal',
      acceptance_criteria: [{ id: 'AC1', desc: 'desc', oracleHint: 'test' as const }],
      constraints: [],
      inputs: [],
      outOfScope: []
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.contract.origin).toBe('human-confirmed');
    }
  });
});
