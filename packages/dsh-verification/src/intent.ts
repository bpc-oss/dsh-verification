import type { Context } from '@deepseek-ai/cordis';
import type { JsonValue } from '@deepseek-ai/dsh-session';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

import { compileParameterJsonSchema, VerificationToolError } from './tool-utils';
import type { PlanProposal } from './contract-authority';
import type { VerificationService } from './service';
import type { TaskContract } from '@bpc-oss/dsh-evidence';

interface SetPlanArgs {
  goal_id: string;
  goal_revision: number;
  goal: string;
  acceptance_criteria: Array<{
    id: string;
    desc: string;
    oracle_hint: 'test' | 'run' | 'file' | 'schema' | 'review' | 'human';
    tool?: string;
    args?: Record<string, unknown>;
  }>;
  constraints?: Array<{ id: string; desc: string; check: string }>;
  inputs?: string[];
  out_of_scope?: string[];
}

function proposalOf(args: SetPlanArgs): PlanProposal {
  return {
    goal_value: args.goal,
    acceptance_criteria: args.acceptance_criteria.map((ac) => ({
      id: ac.id,
      desc: ac.desc,
      oracleHint: ac.oracle_hint,
      ...(ac.tool ? { tool: ac.tool } : {}),
      ...(ac.args ? { args: ac.args } : {})
    })),
    constraints: args.constraints ?? [],
    inputs: args.inputs ?? [],
    outOfScope: args.out_of_scope ?? []
  };
}

function contractReceipt(contract: TaskContract | null): unknown {
  return {
    contract_id: contract?.ref.contractId ?? null,
    revision: contract?.ref.revision ?? null,
    origin: contract?.origin ?? null,
    goal: contract?.goal ?? null,
    acceptance_criteria: contract?.acceptanceCriteria ?? null,
    constraints: contract?.constraints ?? null
  };
}

const OPEN_OBJECT_SCHEMA = { type: 'object', additionalProperties: true } as const;
const asJson = (value: unknown): Record<string, JsonValue> => value as Record<string, JsonValue>;
const textBlock = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

/** 注册 set_verification_plan / get_verification_plan / reset_verification_plan。 */
export function installIntentTools(ctx: Context, service: VerificationService): void {
  const setPlanDefinition: ToolDefinition = {
    name: 'set_verification_plan',
    description:
      'Declare the intent contract bound to the active root goal (goal_id + goal_revision). The server mints the authoritative ContractRef; your proposal is advisory. Each acceptance criterion SHOULD carry a tool + args proposal that the server freezes into an exact evidence selector; criteria WITHOUT a tool+args proposal freeze no exact selector, and in enforce mode they will fail the completion gate (no bound evidence) unless a human confirmation is later bound. So declare the exact tool + args that will prove each AC BEFORE mutating work in enforce mode. Selector guidance (2026-08-17): freeze the selector on the tool you will ACTUALLY use to produce the deliverable — for file deliverables prefer write/edit (evidence type file_diff) or file_exists over glob/read; a glob that finds nothing will fail the AC even if the files exist (the engine has a file-family fallback, but an exact match on your real work tool is stronger and avoids re-verification).',
    parameters: compileParameterJsonSchema({
      goal_id: { type: 'string', required: true, description: 'The active root goal id (from get_goal).' },
      goal_revision: { type: 'number', required: true, description: 'The goal revision (from get_goal).' },
      goal: { type: 'string', required: true, description: 'One-sentence goal the user asked for.' },
      acceptance_criteria: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            desc: { type: 'string' },
            oracle_hint: { type: 'string', enum: ['test', 'run', 'file', 'schema', 'review', 'human'] },
            tool: { type: 'string', description: 'Tool identity whose exact output proves this AC (e.g. bash).' },
            args: { type: 'object', additionalProperties: true, description: 'Exact tool args for the frozen selector.' }
          }
        }
      },
      constraints: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            desc: { type: 'string' },
            check: { type: 'string' }
          }
        }
      },
      inputs: { type: 'array', items: { type: 'string' } },
      out_of_scope: { type: 'array', items: { type: 'string' } }
    }),
    output: { schema: OPEN_OBJECT_SCHEMA, render: textBlock },
    execute: async (rawArgs, exec) => {
      const agent = exec.agent;
      if (!agent) {
        throw new VerificationToolError('set_verification_plan requires a calling agent', 'VERIFICATION_AGENT_REQUIRED');
      }
      const args = rawArgs as SetPlanArgs;
      const result = await service.setPlanFromProposal(agent, args.goal_id, args.goal_revision, proposalOf(args));
      if (!result.ok) {
        throw new VerificationToolError(result.reason, 'VERIFICATION_PLAN_REJECTED');
      }
      return asJson(contractReceipt(result.contract));
    }
  };
  ctx.tools.register(setPlanDefinition);

  const getPlanDefinition: ToolDefinition = {
    name: 'get_verification_plan',
    description: 'Read the current server-minted verification plan (contract) for this session, or null.',
    parameters: compileParameterJsonSchema({
      include_evidence: {
        type: 'boolean',
        description: 'Include captured evidence refs in the response (optional).'
      }
    }),
    output: { schema: OPEN_OBJECT_SCHEMA, render: textBlock },
    execute: async (_rawArgs, exec) => {
      const agent = exec.agent;
      if (!agent) {
        throw new VerificationToolError('get_verification_plan requires a calling agent', 'VERIFICATION_AGENT_REQUIRED');
      }
      const plan = service.getContract(agent);
      return asJson({
        plan: contractReceipt(plan),
        evidence_refs: plan ? service.getProjection(agent).evidenceRefs.slice(-20) : []
      });
    }
  };
  ctx.tools.register(getPlanDefinition);

  const resetPlanDefinition: ToolDefinition = {
    name: 'reset_verification_plan',
    description:
      'Re-basis the verification plan within the current task epoch (new contract id + revision 0, same sourceBasis boundary). Executes immediately when called; old confirmations and old evidence are invalidated by the new identity. The confirm parameter is accepted for compatibility and does not gate the rebase. Call create_goal first / use this to fix a contract you cannot satisfy.',
    parameters: compileParameterJsonSchema({
      confirm: {
        type: 'boolean',
        description: 'Accepted for compatibility; the rebase executes immediately regardless (no human confirmation gate).'
      }
    }),
    output: { schema: OPEN_OBJECT_SCHEMA, render: textBlock },
    execute: async (_rawArgs, exec) => {
      const agent = exec.agent;
      if (!agent) {
        throw new VerificationToolError('reset_verification_plan requires a calling agent', 'VERIFICATION_AGENT_REQUIRED');
      }
      const contract = service.resetPlan(agent);
      return asJson({ plan: contractReceipt(contract) });
    }
  };
  ctx.tools.register(resetPlanDefinition);
}
