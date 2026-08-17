/**
 * S2-2 回归：部署级 globalConstraints + network: 禁令真实接线到 gate（此前 fail-open）。
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

function setup(globalConstraints: VerificationRuntimeConfig['globalConstraints']) {
  const ctx = new Context();
  const session = Session.create(SessionId('sess-s2'));
  const agent = { id: 's2', session } as unknown as Agent;
  const config: VerificationRuntimeConfig = {
    mode: 'enforce',
    maxCapturedEvidence: 200,
    maxCapturedBytes: 20 * 1024 * 1024,
    completionPermitTtlMs: 30_000,
    configHash: 'cfg-s2',
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

function tool(callId: string, name: string, args: Record<string, unknown>, value: unknown): ToolRecord {
  return { callId, name, arguments: args, isError: false, value };
}

async function bootstrap(env: ReturnType<typeof setup>) {
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

describe('S2-2: global constraints + network: actually enforced at the gate', () => {
  it('global path:constraint fails the enforce gate when the forbidden path was touched', async () => {
    const env = setup([{ id: 'G1', desc: 'never touch legacy', check: 'path:src/legacy' }]);
    await bootstrap(env);
    await env.service.captureEvidence(env.agent, tool('c1', 'bash', { command: 'npm test' }, { exitCode: 0, stdout: 'Tests  5 passed (5)' }), 10);
    await env.service.captureEvidence(env.agent, tool('c2', 'write', { path: 'src/legacy/x.ts', content: 'x' }, { path: 'src/legacy/x.ts', operation: 'write', after: 'x' }), 11);
    const gate = (await env.service.evaluateGate(env.agent)).gate;
    expect(gate.status).toBe('failed');
    expect(gate.reasons.join(' ')).toContain('G1');
  });

  it('global path:constraint passes when only allowed paths were touched', async () => {
    const env = setup([{ id: 'G1', desc: 'never touch legacy', check: 'path:src/legacy' }]);
    await bootstrap(env);
    await env.service.captureEvidence(env.agent, tool('c1', 'bash', { command: 'npm test' }, { exitCode: 0, stdout: 'Tests  5 passed (5)' }), 10);
    const gate = (await env.service.evaluateGate(env.agent)).gate;
    expect(gate.status).toBe('done');
  });

  it('network: constraint fails the gate when a web-type tool actually ran (no more fail-open)', async () => {
    const env = setup([{ id: 'G2', desc: 'no network', check: 'network:' }]);
    await bootstrap(env);
    // durable tool/call 事件（S3-1：network 记录从会话日志重建）
    env.session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-web-1',
      name: 'web_search',
      arguments: JSON.stringify({ query: 'deepseek' })
    });
    await env.service.captureEvidence(env.agent, tool('c1', 'bash', { command: 'npm test' }, { exitCode: 0, stdout: 'Tests  5 passed (5)' }), 10);
    const gate = (await env.service.evaluateGate(env.agent)).gate;
    expect(gate.status).toBe('failed');
    expect(gate.reasons.join(' ')).toContain('G2');
  });

  it('network: constraint passes when no web-type tool ran', async () => {
    const env = setup([{ id: 'G3', desc: 'keep it local', check: 'network:' }]);
    await bootstrap(env);
    await env.service.captureEvidence(env.agent, tool('c1', 'bash', { command: 'npm test' }, { exitCode: 0, stdout: 'Tests  5 passed (5)' }), 10);
    const gate = (await env.service.evaluateGate(env.agent)).gate;
    expect(gate.status).toBe('done');
  });
});
