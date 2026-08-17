/**
 * S3-4 对账规则 + S3-1 network 从 durable 日志重建（服务重启/插件缺席后不回退 fail-open）。
 * 对账：契约存在后，每个"可采集" durable `tool/call` 必须对应 evidenceRef 或 durable capture-failure。
 */
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { ToolRecord } from '@bpc-oss/dsh-evidence';

import { VerificationService } from '../src/service';
import type { VerificationRuntimeConfig } from '../src/service';
import { createMemoryBlobStore } from '../src/evidence-store';
import { graderContract, makeFakeLlm } from './fake-llm';

const ECHO = graderContract({
  goal: 'Make the tests pass',
  acceptanceCriteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test' }],
  constraints: [],
  inputs: [],
  outOfScope: []
});

function setup(globalConstraints: VerificationRuntimeConfig['globalConstraints'] = []) {
  const ctx = new Context();
  const session = Session.create(SessionId('sess-rec'));
  const agent = { id: 'rec', session } as unknown as Agent;
  const config: VerificationRuntimeConfig = {
    mode: 'enforce',
    maxCapturedEvidence: 200,
    maxCapturedBytes: 20 * 1024 * 1024,
    completionPermitTtlMs: 30_000,
    configHash: 'cfg-rec',
    enableDeterministic: true,
    enableAssistantResponse: true,
    enableCoverage: true,
    enableProReview: false,
    proReviewProvider: 'spawn',
    globalConstraints,
    intent: { consensusCount: 1, contractOrigin: 'independent-capture', maxEntries: 200 },
    readOnlyToolAllowlist: []
  };
  ctx.provide('llm', makeFakeLlm({ respondWith: () => ECHO }));
  const service = new VerificationService(ctx, config, { store: createMemoryBlobStore(), clock: () => 1_000_000 });
  return { ctx, session, agent, service };
}

async function bootstrapPlan(env: ReturnType<typeof setup>) {
  env.session.append('user/message', { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'Make the tests pass' }] }, { surfaceOp: 'append' });
  env.session.append('goal/change', { kind: 'goal/change', version: 1, operation: 'create', goal: { id: 'g-1', revision: 1, phase: 'active', objective: 'x', maxGoalRounds: 10 }, roundsStarted: 0, createdAt: 1, updatedAt: 1 });
  const result = await env.service.setPlanFromProposal(env.agent, 'g-1', 1, {
    goal_value: 'Make the tests pass',
    acceptance_criteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test', tool: 'bash', args: { command: 'npm test' } }],
    constraints: [],
    inputs: [],
    outOfScope: []
  });
  if (!result.ok) throw new Error(result.reason);
}

function durableCall(callId: string, name: string, args: Record<string, unknown>) {
  return { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) };
}

function bash(callId: string, value: unknown): ToolRecord {
  return { callId, name: 'bash', arguments: { command: 'npm test' }, isError: false, value };
}

describe('S3-4: reconciliation of durable tool/call vs evidence', () => {
  it('a capturable durable call with no evidence nor failure gets a DURABLE reconcile capture-failure', async () => {
    const env = setup();
    await bootstrapPlan(env);
    env.session.append('tool/call', durableCall('call-bash-1', 'bash', { command: 'npm test' }));

    const gate = (await env.service.evaluateGate(env.agent)).gate;
    expect(gate.status).toBe('failed');
    const failures = env.service.getProjection(env.agent).captureFailures;
    const mine = failures.filter((f) => f.callId === 'call-bash-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.error).toContain('reconcile');
    // durable：该 failure 已作为事件写入会话
    expect(env.session.events.some((e) => e.type === 'verification/change' && JSON.stringify(e.data).includes('reconcile'))).toBe(true);
  });

  it('is idempotent across repeated evaluation (no duplicate reconcile writes)', async () => {
    const env = setup();
    await bootstrapPlan(env);
    env.session.append('tool/call', durableCall('call-bash-1', 'bash', { command: 'npm test' }));
    await env.service.evaluateGate(env.agent);
    await env.service.evaluateGate(env.agent);
    const failures = env.service.getProjection(env.agent).captureFailures.filter((f) => f.callId === 'call-bash-1');
    expect(failures).toHaveLength(1);
  });

  it('does NOT reconcile calls before the plan (unbound telemetry window)', async () => {
    const env = setup();
    // 先有调用（unbound），后 mint 契约
    env.session.append('user/message', { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'Make the tests pass' }] }, { surfaceOp: 'append' });
    env.session.append('tool/call', durableCall('call-early', 'bash', { command: 'npm test' }));
    env.session.append('goal/change', { kind: 'goal/change', version: 1, operation: 'create', goal: { id: 'g-1', revision: 1, phase: 'active', objective: 'x', maxGoalRounds: 10 }, roundsStarted: 0, createdAt: 1, updatedAt: 1 });
    await env.service.setPlanFromProposal(env.agent, 'g-1', 1, {
      goal_value: 'Make the tests pass',
      acceptance_criteria: [{ id: 'AC1', desc: 'run npm test and all pass', oracleHint: 'test', tool: 'bash', args: { command: 'npm test' } }],
      constraints: [],
      inputs: [],
      outOfScope: []
    });
    await env.service.evaluateGate(env.agent);
    const mine = env.service.getProjection(env.agent).captureFailures.filter((f) => f.callId === 'call-early');
    expect(mine).toHaveLength(0);
  });

  it('does NOT reconcile control-plane calls (create_goal/update_goal)', async () => {
    const env = setup();
    await bootstrapPlan(env);
    env.session.append('tool/call', durableCall('call-goal-1', 'create_goal', { objective: 'x' }));
    env.session.append('tool/call', durableCall('call-upd-1', 'update_goal', { action: 'complete' }));
    await env.service.evaluateGate(env.agent);
    const failures = env.service.getProjection(env.agent).captureFailures.filter((f) => f.toolIdentity === 'create_goal' || f.toolIdentity === 'update_goal');
    expect(failures).toHaveLength(0);
  });

  it('does NOT reconcile when real evidence already exists for that callId', async () => {
    const env = setup();
    await bootstrapPlan(env);
    env.session.append('tool/call', durableCall('call-bash-1', 'bash', { command: 'npm test' }));
    await env.service.captureEvidence(env.agent, bash('call-bash-1', { exitCode: 0, stdout: 'Tests  5 passed (5)' }), 30);
    const gate = (await env.service.evaluateGate(env.agent)).gate;
    expect(gate.status).toBe('done');
    const mine = env.service.getProjection(env.agent).captureFailures.filter((f) => f.callId === 'call-bash-1');
    expect(mine).toHaveLength(0);
  });
});

describe('S3-1: network: constraint derived from durable tool/call (restart-safe)', () => {
  it('rebuilds network calls from the session log even without post-execute capture', async () => {
    const env = setup([{ id: 'G1', desc: 'no network', check: 'network:' }]);
    await bootstrapPlan(env);
    // 模拟：某次运行/重启期间排过 web 调用，但插件从未在 post-execute 看到它
    env.session.append('tool/call', durableCall('call-web-1', 'web_search', { query: 'deepseek' }));
    await env.service.captureEvidence(env.agent, bash('call-bash-1', { exitCode: 0, stdout: 'Tests  5 passed (5)' }), 30);
    const gate = (await env.service.evaluateGate(env.agent)).gate;
    expect(gate.status).toBe('failed');
    expect(gate.reasons.join(' ')).toContain('G1');
  });

  it('static helper classifies network-like names', async () => {
    const { isNetworkLikeTool } = await import('../src/evidence-capture');
    expect(isNetworkLikeTool('web_search')).toBe(true);
    expect(isNetworkLikeTool('web_fetch')).toBe(true);
    expect(isNetworkLikeTool('mcp:github/search')).toBe(true);
    expect(isNetworkLikeTool('bash')).toBe(false);
    expect(isNetworkLikeTool('read')).toBe(false);
  });
});
