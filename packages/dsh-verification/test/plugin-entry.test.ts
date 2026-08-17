/**
 * 插件入口 apply() 冒烟测试：最小 fake 服务验证挂载不抛错、工具注册与投影注入。
 */
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';

import { apply, computeConfigHash, resolveConfig as _r } from '../src/index';
import type { VerificationConfig } from '../src/index';

function fakeServices(ctx: Context, withGoalSeam = true): { registered: string[] } {
  const registered: string[] = [];
  ctx.provide('agents', { roots: () => [], get: () => undefined } as never);
  ctx.provide('tools', {
    register: (definition: { name: string }) => {
      registered.push(definition.name);
      return () => undefined;
    }
  } as never);
  ctx.provide('systemPrompt', { section: () => undefined } as never);
  if (withGoalSeam) {
    ctx.provide('goals', { registerTransitionGuard: () => () => undefined } as never);
  }
  return { registered };
}

describe('plugin entry (apply, v9)', () => {
  it('refuses enforce activation when GoalService lacks the transition-guard seam', () => {
    const ctx = new Context();
    fakeServices(ctx, false);
    expect(() => apply(ctx, { mode: 'enforce', systemPromptSection: false })).toThrow(/GoalTransitionGuard seam unavailable/);
  });

  it('mounts tools and service without throwing (enforce, proReview default off)', () => {
    const ctx = new Context();
    const { registered } = fakeServices(ctx);
    apply(ctx, { mode: 'enforce' });
    expect(ctx.get('verification')).toBeDefined();
    expect(registered).toEqual(expect.arrayContaining(['set_verification_plan', 'get_verification_plan', 'reset_verification_plan', 'pro_review']));
  });

  it('computes a stable frozen config hash including ttl and proReview state', () => {
    const base: VerificationConfig = {
      mode: 'enforce',
      maxCapturedEvidence: 200,
      maxCapturedBytes: 20 * 1024 * 1024,
      completionPermitTtlMs: 30_000,
      oracles: { deterministic: true, assistantResponse: true, coverage: { enabled: true }, proReview: { enabled: false, provider: 'spawn', maxDefects: 10 } },
      constraints: [],
      intent: { requireContractBeforeExecution: true, contractOrigin: 'independent-capture', freezeOnHumanConfirm: true, consensusCount: 1, readOnlyToolAllowlist: [], sourceBasis: { includeAttachments: true, includeControlDocs: true, maxEntries: 200 } },
      systemPromptSection: true
    };
    const a = computeConfigHash(base);
    const b = computeConfigHash({ ...base, completionPermitTtlMs: 60_000 });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
