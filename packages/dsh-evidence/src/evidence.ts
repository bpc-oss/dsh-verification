import { z } from 'zod';

/**
 * 证据域 schema（v9 两态模型 + SelectorV1 + 唯一身份五元组）。
 * 契约权威：`docs/dsh-p01-verification-port-plan.md` v9 / `docs/dsh-plugin-port-plan.md` v11 §1。
 * Bobby 移植：证据契约 `shared/contracts/evidence.ts` —— "模型不得代笔转述（L1/L3）"保留，
 * acId 归属改为服务端 exact-only selector 绑定。
 */

/** 证据类型：由工具/沙箱直接产出。 */
export const EvidenceTypeSchema = z.enum([
  'test_run',
  'command_output',
  'file_diff',
  'file_exists',
  'schema_valid',
  'symbol_exists',
  'quote_with_location',
  'assistant_response',
  'pro_review',
  'human_ack'
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceTypeValues = EvidenceTypeSchema.options as readonly EvidenceType[];

/**
 * 证据家族（v9.1 真机修复）：同一族内的不同类型是"同一工具+同一参数的一次调用"的
 * 不同派生视角（例如一次 `read` 调用按结果形状可派生为 quote_with_location / file_exists）。
 * selector 冻结的是 tool + args（模型只对这两者负责）；具体派生类型对模型不可见、也不构成承诺，
 * 因此族内互认是 binder 的合法放宽 —— 全等仍是默认，族内互认必须显式声明。
 */
const EVIDENCE_FAMILIES: ReadonlyArray<readonly EvidenceType[]> = [
  ['file_diff', 'file_exists', 'quote_with_location']
];

/** 证据类型全等或同族互认（供 binder/selector 匹配使用）。 */
export function evidenceTypesCompatible(left: EvidenceType, right: EvidenceType): boolean {
  if (left === right) {
    return true;
  }
  return EVIDENCE_FAMILIES.some((family) => family.includes(left) && family.includes(right));
}

/**
 * 唯一身份五元组（v6）：contractId + revision + contractContentHash + basisHash + sessionId。
 * Evidence/Verdict 持久化携带；gate 逐字段全等比较。
 */
export const ContractIdentitySchema = z
  .object({
    contractId: z.string().min(1),
    revision: z.number().int().min(0),
    contractContentHash: z.string().min(1),
    basisHash: z.string().min(1),
    sessionId: z.string().min(1)
  })
  .strict();
export type ContractIdentity = z.infer<typeof ContractIdentitySchema>;

export function identitiesEqual(left: ContractIdentity, right: ContractIdentity): boolean {
  return (
    left.contractId === right.contractId &&
    left.revision === right.revision &&
    left.contractContentHash === right.contractContentHash &&
    left.basisHash === right.basisHash &&
    left.sessionId === right.sessionId
  );
}

/**
 * SelectorV1（v11：v1 exact-only）。
 * 冻结于契约 AC：system 只匹配 toolIdentity + normalizedArgsHash + evidenceType 的全等。
 */
export const SelectorV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    toolIdentity: z.string().min(1),
    normalizedArgsHash: z.string().min(1),
    evidenceType: EvidenceTypeSchema
  })
  .strict();
export type SelectorV1 = z.infer<typeof SelectorV1Schema>;

/** Selector 的稳定引用 id（同一契约 revision 内唯一）：`<contractId>:<revision>:<acId>`。 */
export function selectorRefOf(identity: ContractIdentity, acId: string): string {
  return `${identity.contractId}:${identity.revision}:${acId}`;
}

/** 同一契约内两个 AC 冻结出相同 selector（exact 全等）→ 拒绝契约。 */
export function selectorKey(selector: SelectorV1): string {
  return `${selector.toolIdentity}|${selector.normalizedArgsHash}|${selector.evidenceType}`;
}

/**
 * 捕获态证据（v9）：无 acId / selectorRef。
 * 普通 bash/fs 调用不携带 AC 身份——模型自报一律拒绝。
 * 由 `tools/post-execute` 派生并持久化（内容寻址 blob），服务端 binder 才产生 BoundEvidence。
 */
export const CapturedEvidenceSchema = z
  .object({
    callId: z.string().min(1),
    toolIdentity: z.string().min(1),
    schemaVersion: z.literal(1).default(1),
    /** 规范化参数（按工具 schema 展开默认值 + 键稳定排序 + 路径 lexical 归一；服务端 binder 匹配依据）。 */
    normalizedArgs: z.record(z.string(), z.unknown()),
    normalizedArgsHash: z.string().min(1),
    evidenceType: EvidenceTypeSchema,
    payload: z.record(z.string(), z.unknown()),
    producedBy: z.enum(['tool', 'flash', 'pro', 'human']).default('tool'),
    failed: z.boolean().default(false),
    contractIdentity: ContractIdentitySchema
  })
  .strict();
export type CapturedEvidence = z.infer<typeof CapturedEvidenceSchema>;

/** 绑定态证据（v9）：captured + 服务端 acId + selectorRef。仅由 binder 产生。 */
export const BoundEvidenceSchema = CapturedEvidenceSchema.extend({
  acId: z.string().min(1),
  selectorRef: z.string().min(1)
}).strict();
export type BoundEvidence = z.infer<typeof BoundEvidenceSchema>;

/** 引擎只接受 bound 视图。 */
export function isBoundEvidence(value: unknown): value is BoundEvidence {
  return BoundEvidenceSchema.safeParse(value).success;
}

/** 兼容别名（v9：engine 眼中的"证据"即 bound evidence）。 */
export type Evidence = BoundEvidence;

export const VerdictResultSchema = z.enum(['pass', 'fail', 'need_human']);
export type VerdictResult = z.infer<typeof VerdictResultSchema>;

export const OracleTierSchema = z.enum(['T0', 'T1', 'T2', 'T3', 'T4']);
export type OracleTier = z.infer<typeof OracleTierSchema>;

/** 裁决（v9）：携带 contractIdentity 快照；gate 全等比较。claimId 允许空串以兼容旧版无证据裁决记录。 */
export const VerdictSchema = z
  .object({
    claimId: z.string(),
    acId: z.string().min(1),
    result: VerdictResultSchema,
    oracleTier: OracleTierSchema,
    contractIdentity: ContractIdentitySchema,
    detail: z.string().optional()
  })
  .strict();
export type Verdict = z.infer<typeof VerdictSchema>;

/** 一次完成闸门评估的结果。 */
export const GateResultSchema = z.object({
  status: z.enum(['done', 'failed', 'blocked']),
  reasons: z.array(z.string())
});
export type GateResult = z.infer<typeof GateResultSchema>;

/** 捕获态硬上限（v9）：超限停止采集并写 durable capture-failure，gate fail closed。 */
export const MAX_CAPTURED_EVIDENCE = 200;
export const MAX_CAPTURED_BYTES = 20 * 1024 * 1024;
/** 单条证据 payload 上限：超限截断并标记 completeness（256KB）。 */
export const MAX_EVIDENCE_PAYLOAD_BYTES = 256 * 1024;
