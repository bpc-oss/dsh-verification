import { z } from 'zod';

import { SelectorV1Schema, type ContractIdentity } from './evidence';
import { stableHash } from './hash';

/** 验收标准可用的裁判提示（Bobby oracle_hint 移植）。 */
export const OracleHintSchema = z.enum(['test', 'run', 'file', 'schema', 'review', 'human']);
export type OracleHint = z.infer<typeof OracleHintSchema>;

/**
 * 一条验收标准。
 * `selector` 为服务端冻结的 exact-only 证据选择器（可选）：
 * 无法为 AC 生成 exact selector → 该 AC 走 T2/T4 或 need_evidence，不生成宽泛模式。
 */
export const AcceptanceCriterionSchema = z
  .object({
    id: z.string().min(1),
    desc: z.string().min(1),
    oracleHint: OracleHintSchema,
    selector: SelectorV1Schema.optional()
  })
  .strict();
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

/** 一条禁令：`check` 仅支持机器可检语法 `path:<prefix>` / `network:`，其余转人工/Pro 复核。 */
export const ConstraintSchema = z
  .object({
    id: z.string().min(1),
    desc: z.string().min(1),
    check: z.string().min(1)
  })
  .strict();
export type Constraint = z.infer<typeof ConstraintSchema>;

/** sourceBasis 条目类型（v6）。 */
export const SourceBasisEntrySchema = z
  .object({
    kind: z.enum(['user-message', 'attachment', 'control-doc', 'user-correction']),
    eventRef: z.string().min(1),
    seq: z.number().int().min(0),
    contentHash: z.string().min(1)
  })
  .strict();
export type SourceBasisEntry = z.infer<typeof SourceBasisEntrySchema>;

/** sourceBasis（v6：服务端按确定 task boundary 收集，非模型指定）。 */
export const SourceBasisSchema = z
  .object({
    sessionId: z.string().min(1),
    entries: z.array(SourceBasisEntrySchema),
    basisHash: z.string().min(1)
  })
  .strict();
export type SourceBasis = z.infer<typeof SourceBasisSchema>;

/** 计算 basisHash：sessionId + 有序条目集合的稳定 hash（防删减/乱序/跨 session 替换）。 */
export function computeBasisHash(sessionId: string, entries: SourceBasisEntry[]): string {
  return stableHash({ sessionId, entries });
}

/** ContractRef（v6：服务端 mint；模型提交的 id/revision/hash 一律忽略/拒绝）。 */
export const ContractRefSchema = z
  .object({
    contractId: z.string().min(1),
    revision: z.number().int().min(0),
    contractContentHash: z.string().min(1),
    sourceBasis: SourceBasisSchema
  })
  .strict();
export type ContractRef = z.infer<typeof ContractRefSchema>;

/** 意图契约（v6；S1-2 真机修复：origin 增加 `model-self-declared` 以反映降级路径真实来源）。 */
export const TaskContractSchema = z
  .object({
    ref: ContractRefSchema,
    origin: z.enum(['independent-capture', 'human-confirmed', 'model-self-declared']),
    goal: z.string().min(1),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
    constraints: z.array(ConstraintSchema).default([]),
    inputs: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).default([])
  })
  .strict()
  .superRefine((contract, ctx) => {
    const seen = new Set<string>();
    for (const [index, criterion] of contract.acceptanceCriteria.entries()) {
      if (seen.has(criterion.id)) {
        ctx.addIssue({ code: 'custom', path: ['acceptanceCriteria', index, 'id'], message: `duplicate acceptance criterion id: ${criterion.id}` });
      }
      seen.add(criterion.id);
    }
  });
export type TaskContract = z.infer<typeof TaskContractSchema>;

/** 从契约推导唯一身份五元组。 */
export function contractIdentityOf(contract: TaskContract): ContractIdentity {
  return {
    contractId: contract.ref.contractId,
    revision: contract.ref.revision,
    contractContentHash: contract.ref.contractContentHash,
    basisHash: contract.ref.sourceBasis.basisHash,
    sessionId: contract.ref.sourceBasis.sessionId
  };
}

/** 契约内容体（不含 ref/origin；用于内容 hash 与 mint 前的形状约束）。 */
export interface ContractBodyShape {
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  constraints: Constraint[];
  inputs: string[];
  outOfScope: string[];
}

/** 契约内容 hash（goal + ACs + constraints + inputs + outOfScope；不含 ref/sourceBasis/origin）。 */
export function computeContractContentHash(contract: ContractBodyShape): string {
  return stableHash({
    goal: contract.goal,
    acceptanceCriteria: contract.acceptanceCriteria,
    constraints: contract.constraints,
    inputs: contract.inputs,
    outOfScope: contract.outOfScope
  });
}
