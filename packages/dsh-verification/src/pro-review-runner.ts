/**
 * Pro 对抗审查执行器（v9 §4.3 / v11）。
 * T2 为 upstream authorityIsolation 决策门：rc.6 无 capability → `proReview.enabled` 默认 false；
 * 显式开启而 provider 无能力 → 返回 `need_evidence`（fail closed），不伪造"零工具 reviewer"。
 * 走 `ctx.subagents.start(provider, …)` 一次性 run：独立上下文 + outputSchema + await result + finally dispose。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import { extractTextFromContent } from '@bpc-oss/dsh-evidence';

import type { ProReviewInput, ReviewOutput } from './oracles/pro-review';
import { buildReviewPrompt } from './oracles/pro-review';

const REVIEW_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'defects', 'unverifiable'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'acId', 'evidence', 'mustFix'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium'] },
          acId: { type: 'string' },
          evidence: { type: 'string' },
          mustFix: { type: 'boolean' }
        }
      }
    },
    unverifiable: { type: 'array', items: { type: 'string' } }
  }
};

function isReviewOutput(value: unknown): value is ReviewOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.verdict === 'pass' || record.verdict === 'fail') &&
    Array.isArray(record.defects) &&
    Array.isArray(record.unverifiable)
  );
}

export interface ProReviewRunnerOptions {
  provider: string;
  agent: Agent;
  signal?: AbortSignal;
}

/**
 * 能力检查（决策门）：rc.6 `SubagentStartRequest` 无 preset/setup override，
 * `ToolRestriction` 也不覆盖 scoped/Code Mode → 除非 provider 声明 authorityIsolation，否则视为无能力。
 */
export function providerHasAuthorityIsolation(ctx: Context, providerName: string): boolean {
  const subagents = ctx.get('subagents');
  if (!subagents) {
    return false;
  }
  const provider = subagents.getProvider(providerName);
  if (!provider) {
    return false;
  }
  return (
    (provider.inheritsParentContext === false || provider.inheritsParentContext === undefined) &&
    Boolean((provider as { capabilities?: { authorityIsolation?: boolean } }).capabilities?.authorityIsolation)
  );
}

export function createSubagentProReviewRunner(ctx: Context, options: ProReviewRunnerOptions) {
  return async (input: ProReviewInput): Promise<ReviewOutput> => {
    const subagents = ctx.get('subagents');
    if (!subagents) {
      throw new Error('verification: subagents service is not mounted; cannot run pro-review');
    }
    if (!providerHasAuthorityIsolation(ctx, options.provider)) {
      throw new Error(`verification: provider ${options.provider} lacks authorityIsolation; T2 unavailable (need_evidence)`);
    }

    const run = await subagents.start(options.provider, {
      label: 'pro-review',
      prompt: [{ type: 'text', text: buildReviewPrompt(input.ac, input.evidence) }],
      parent: options.agent,
      signal: options.signal ?? new AbortController().signal,
      outputSchema: REVIEW_OUTPUT_SCHEMA
    });

    try {
      const result = await run.result;
      if (result.stopReason !== 'completed') {
        throw new Error(`pro-review run ${result.stopReason}`);
      }
      if (result.structured !== undefined && isReviewOutput(result.structured)) {
        return result.structured;
      }
      const text = extractTextFromContent(result.output);
      if (text.length === 0) {
        throw new Error(`pro-review subagent returned no output (stop: ${result.stopReason})`);
      }
      const parsed = JSON.parse(text) as unknown;
      if (!isReviewOutput(parsed)) {
        throw new Error('pro-review subagent returned malformed review JSON');
      }
      return parsed;
    } finally {
      await run.dispose();
    }
  };
}
