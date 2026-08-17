/**
 * `pro_review` 工具（v9）：模型可主动请求 Pro 对抗审查（独立于完成闸门自动 T2 路径）。
 * 对指定 AC（或整个计划）以 spawn（non-inheriting，T2 决策门）跑敌意审查，返回结构化缺陷清单。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { JsonValue } from '@deepseek-ai/dsh-session';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

import { compileParameterJsonSchema, VerificationToolError } from './tool-utils';
import { bindSelectorForAc } from './binders';
import { contractIdentityOf } from '@bpc-oss/dsh-evidence';
import { hintToEvidenceType } from './verdicts';
import { createSubagentProReviewRunner } from './pro-review-runner';
import type { VerificationService } from './service';

const OPEN_OBJECT_SCHEMA = { type: 'object', additionalProperties: true } as const;
const textBlock = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

export function installProReviewTool(ctx: Context, service: VerificationService, provider: string): void {
  const definition: ToolDefinition = {
    name: 'pro_review',
    description:
      'Run an adversarial Pro review of the current session evidence for one acceptance criterion (or the whole plan) and return the structured review. Use it to double-check a claim before completion, or after the completion gate rejects you.',
    parameters: compileParameterJsonSchema({
      ac_id: { type: 'string', description: 'Acceptance criterion id to review; omit to review every criterion in the plan.' }
    }),
    output: { schema: OPEN_OBJECT_SCHEMA, render: textBlock },
    execute: async (rawArgs, exec) => {
      const agent = exec.agent;
      if (!agent) {
        throw new VerificationToolError('pro_review requires a calling agent', 'VERIFICATION_AGENT_REQUIRED');
      }
      const contract = service.getContract(agent);
      if (!contract) {
        throw new VerificationToolError('no verification plan declared; call set_verification_plan first', 'VERIFICATION_NO_PLAN');
      }
      const acId = (rawArgs as { ac_id?: string }).ac_id;
      const acs = acId ? contract.acceptanceCriteria.filter((ac) => ac.id === acId) : [...contract.acceptanceCriteria];
      if (acId !== undefined && acs.length === 0) {
        throw new VerificationToolError(`unknown acceptance criterion: ${acId}`, 'VERIFICATION_UNKNOWN_AC');
      }

      const identity = contractIdentityOf(contract);
      const projection = service.getProjection(agent);
      const runner = createSubagentProReviewRunner(ctx, { provider, agent });
      const reviews: Array<{ acId: string; verdict: string; defects: unknown[]; unverifiable: string[]; note?: string }> = [];
      for (const ac of acs) {
        const outcome = await bindSelectorForAc(
          ac,
          {
            contractIdentity: identity,
            refs: projection.evidenceRefs,
            captureFailures: projection.captureFailures,
            loadBlob: async (key) => service.readBlob(key)
          },
          (ac2) => hintToEvidenceType(ac2.oracleHint)
        );
        if (outcome.kind !== 'bound') {
          reviews.push({ acId: ac.id, verdict: 'fail', defects: [], unverifiable: [outcome.reason] });
          continue;
        }
        const review = await runner({ ac, evidence: [outcome.evidence] });
        reviews.push({ acId: ac.id, verdict: review.verdict, defects: review.defects, unverifiable: review.unverifiable });
      }
      return { reviews } as unknown as Record<string, JsonValue>;
    }
  };
  ctx.tools.register(definition);
}
