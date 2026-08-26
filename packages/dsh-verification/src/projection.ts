import { z } from 'zod';
import type { ContractIdentity, EvidenceType, Verdict } from '@bpc-oss/dsh-evidence';
import {
  ContractIdentitySchema,
  EvidenceTypeSchema,
  GateResultSchema,
  VerdictSchema
} from '@bpc-oss/dsh-evidence';
import type { TaskContract } from '@bpc-oss/dsh-evidence';
import { TaskContractSchema } from '@bpc-oss/dsh-evidence';
import type { FoldedEpoch } from './task-epoch';

export const VERIFICATION_CHANGE_VERSION = 1;

/** Immutable authority boundary for every durable verification fact. */
export const AuthorityScopeSchema = z.object({
  epochId: z.string().min(1),
  rootGoalId: z.string().min(1),
  ownerAgentId: z.string().min(1)
}).strict();
export type AuthorityScope = z.infer<typeof AuthorityScopeSchema>;

/** Policy-relevant facts captured before evidence blob persistence. */
export const PolicyFactsSchema = z.object({
  paths: z.array(z.string()),
  networkCalls: z.array(z.string())
}).strict();
export type PolicyFacts = z.infer<typeof PolicyFactsSchema>;

/**
 * verification 域 append-only 记录（v9）。
 * 每次提交一条不可变记录；投影折叠由所有记录确定性派生。
 * 依据：`dsh-plugin-port-plan.md` §1 / P0-1 文档 §4.4（epoch 由 goal log 权威，observer 不追加）。
 */
export type VerificationRecord =
  | {
      kind: 'plan';
      contract: TaskContract;
      authorityScope?: AuthorityScope;
      frozenAt?: { callId: string; at: number };
    }
  | {
      kind: 'evidence';
      callId: string;
      toolIdentity: string;
      normalizedArgsHash: string;
      blobHash: string;
      originalLength: number;
      rawHash: string;
      truncated: boolean;
      completeness: 'complete' | 'truncated';
      schemaVersion: number;
      contractIdentity: ContractIdentity;
      evidenceType: EvidenceType;
      resultSeq: number;
      summary: string;
      authorityScope?: AuthorityScope;
      policyFacts?: PolicyFacts;
    }
  | {
      kind: 'capture-failure';
      contractIdentity: ContractIdentity;
      callId: string;
      toolIdentity: string;
      normalizedArgsHash: string;
      evidenceType: EvidenceType;
      resultSeq: number;
      error: string;
      authorityScope?: AuthorityScope;
      policyFacts?: PolicyFacts;
    }
  | {
      kind: 'challenge';
      questionId: string;
      challengeKind: 'contract' | 'completion';
      identity: ContractIdentity;
      gateSnapshotHash?: string;
      consumed: boolean;
      authorityScope?: AuthorityScope;
    }
  | {
      kind: 'permit';
      permitRef: string;
      goalId: string;
      goalRevision: number;
      contractIdentity: ContractIdentity;
      gateSnapshotHash: string;
      configHash: string;
      ttlMs: number;
      authorityScope?: AuthorityScope;
    }
  | { kind: 'verdicts'; verdicts: Record<string, Verdict>; authorityScope?: AuthorityScope }
  | { kind: 'gate'; entry: GateSummary };

/** SessionEventMap 载荷（v9：每条 verification/change 事件承载一条不可变记录）。 */
export interface VerificationChangeEventData {
  kind: 'verification/change';
  version: typeof VERIFICATION_CHANGE_VERSION;
  record: VerificationRecord;
}

/** 任务 epoch（v9：goal-bound；active/closed；仅 root create 建立）。
 *  2026-08-15（P0 修复 #1）：与 `FoldedEpoch` 字段契约统一——新增 createdSeq（必填）/closedSeq（可选），
 *  contentHash 改 optional（当前无写入点，不得以空串兜底）。 */
export const TaskEpochRecordSchema = z
  .object({
    epochId: z.string().min(1),
    rootSeq: z.number().int().min(0),
    contentHash: z.string().optional(),
    rootGoalId: z.string().optional(),
    status: z.enum(['active', 'closed']),
    createdSeq: z.number().int().min(0),
    closedSeq: z.number().int().min(0).optional()
  })
  .strict();
export type TaskEpochRecord = z.infer<typeof TaskEpochRecordSchema>;

/** 把增量 epoch 状态折叠为 schema 可校验的视图（显式白名单，绝不外泄未知字段）。 */
export function taskEpochViews(epochs: readonly FoldedEpoch[]): TaskEpochRecord[] {
  return epochs.map((epoch) => ({
    epochId: epoch.epochId,
    rootSeq: epoch.rootSeq,
    rootGoalId: epoch.rootGoalId,
    status: epoch.status,
    createdSeq: epoch.createdSeq,
    ...(epoch.closedSeq !== undefined ? { closedSeq: epoch.closedSeq } : {})
  }));
}

/** 计划视图：契约 + 冻结标记（冻结先于副作用）。 */
export const VerificationPlanViewSchema = z
  .object({
    contract: TaskContractSchema,
    authorityScope: AuthorityScopeSchema.optional(),
    frozenAt: z
      .object({ callId: z.string().min(1), at: z.number() })
      .optional()
  })
  .strict();
export type VerificationPlanView = z.infer<typeof VerificationPlanViewSchema>;

export const EvidenceRefSchema = z
  .object({
    callId: z.string().min(1),
    toolIdentity: z.string().min(1),
    normalizedArgsHash: z.string().min(1),
    blobHash: z.string().min(1),
    truncated: z.boolean(),
    originalLength: z.number().int().min(0),
    schemaVersion: z.number().int().min(1),
    contractIdentity: ContractIdentitySchema,
    evidenceType: EvidenceTypeSchema,
    resultSeq: z.number().int().min(0),
    summary: z.string(),
    authorityScope: AuthorityScopeSchema.optional(),
    policyFacts: PolicyFactsSchema.optional()
  })
  .strict();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const CaptureFailureRecordSchema = z
  .object({
    kind: z.literal('capture-failure').optional(),
    contractIdentity: ContractIdentitySchema,
    callId: z.string().min(1),
    toolIdentity: z.string().min(1),
    normalizedArgsHash: z.string().min(1),
    evidenceType: EvidenceTypeSchema,
    resultSeq: z.number().int().min(0),
    error: z.string(),
    authorityScope: AuthorityScopeSchema.optional(),
    policyFacts: PolicyFactsSchema.optional()
  })
  .strict();
export type CaptureFailureRecord = z.infer<typeof CaptureFailureRecordSchema>;

export const ChallengeRecordSchema = z
  .object({
    kind: z.literal('challenge').optional(),
    questionId: z.string().min(1),
    challengeKind: z.enum(['contract', 'completion']),
    identity: ContractIdentitySchema,
    gateSnapshotHash: z.string().optional(),
    consumed: z.boolean(),
    authorityScope: AuthorityScopeSchema.optional()
  })
  .strict();
export type ChallengeRecord = z.infer<typeof ChallengeRecordSchema>;

export const CompletionPermitRecordSchema = z
  .object({
    kind: z.literal('permit').optional(),
    permitRef: z.string().min(1),
    goalId: z.string().min(1),
    goalRevision: z.number().int().min(1),
    contractIdentity: ContractIdentitySchema,
    gateSnapshotHash: z.string().min(1),
    configHash: z.string().min(1),
    ttlMs: z.number().int().min(1),
    authorityScope: AuthorityScopeSchema.optional()
  })
  .strict();
export type CompletionPermitRecord = z.infer<typeof CompletionPermitRecordSchema>;

/** gate 摘要（写事件用；与投影同构）。 */
export const GateSummarySchema = z.object({
  at: z.number(),
  status: z.enum(['done', 'failed', 'blocked']),
  mode: z.enum(['enforce', 'advisory']),
  reasons: z.array(z.string()),
  authorityScope: AuthorityScopeSchema.optional()
}).strict();
export type GateSummary = z.infer<typeof GateSummarySchema>;

/** Strict durable-event decoder. Never cast or silently skip malformed authority facts. */
export const VerificationRecordSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), contract: TaskContractSchema, authorityScope: AuthorityScopeSchema.optional(), frozenAt: z.object({ callId: z.string().min(1), at: z.number() }).optional() }).strict(),
  z.object({ kind: z.literal('evidence'), callId: z.string().min(1), toolIdentity: z.string().min(1), normalizedArgsHash: z.string().min(1), blobHash: z.string().min(1), originalLength: z.number().int().min(0), rawHash: z.string().min(1), truncated: z.boolean(), completeness: z.enum(['complete', 'truncated']), schemaVersion: z.number().int().min(1), contractIdentity: ContractIdentitySchema, evidenceType: EvidenceTypeSchema, resultSeq: z.number().int().min(0), summary: z.string(), authorityScope: AuthorityScopeSchema.optional(), policyFacts: PolicyFactsSchema.optional() }).strict(),
  z.object({ kind: z.literal('capture-failure'), contractIdentity: ContractIdentitySchema, callId: z.string().min(1), toolIdentity: z.string().min(1), normalizedArgsHash: z.string().min(1), evidenceType: EvidenceTypeSchema, resultSeq: z.number().int().min(0), error: z.string(), authorityScope: AuthorityScopeSchema.optional(), policyFacts: PolicyFactsSchema.optional() }).strict(),
  z.object({ kind: z.literal('challenge'), questionId: z.string().min(1), challengeKind: z.enum(['contract', 'completion']), identity: ContractIdentitySchema, gateSnapshotHash: z.string().optional(), consumed: z.boolean(), authorityScope: AuthorityScopeSchema.optional() }).strict(),
  z.object({ kind: z.literal('permit'), permitRef: z.string().min(1), goalId: z.string().min(1), goalRevision: z.number().int().min(1), contractIdentity: ContractIdentitySchema, gateSnapshotHash: z.string().min(1), configHash: z.string().min(1), ttlMs: z.number().int().min(1), authorityScope: AuthorityScopeSchema.optional() }).strict(),
  z.object({ kind: z.literal('verdicts'), verdicts: z.record(z.string(), VerdictSchema), authorityScope: AuthorityScopeSchema.optional() }).strict(),
  z.object({ kind: z.literal('gate'), entry: GateSummarySchema }).strict()
]);

/** 完整投影（v9）。epoch 由 goal log 派生；其余由记录折叠。 */
export const VerificationProjectionSchema = z.object({
  taskEpochs: z.array(TaskEpochRecordSchema),
  plan: VerificationPlanViewSchema.nullable(),
  evidenceRefs: z.array(EvidenceRefSchema),
  captureFailures: z.array(CaptureFailureRecordSchema),
  challenges: z.record(z.string(), ChallengeRecordSchema),
  completionPermits: z.array(CompletionPermitRecordSchema),
  verdicts: z.record(z.string(), VerdictSchema),
  verdictAuthorityScope: AuthorityScopeSchema.nullable(),
  gateLog: z.array(GateSummarySchema),
  updatedAt: z.number()
});
export type VerificationProjection = z.infer<typeof VerificationProjectionSchema>;

export function emptyVerificationProjection(): VerificationProjection {
  return {
    taskEpochs: [],
    plan: null,
    evidenceRefs: [],
    captureFailures: [],
    challenges: {},
    completionPermits: [],
    verdicts: {},
    verdictAuthorityScope: null,
    gateLog: [],
    updatedAt: 0
  };
}

/** 从一条 append-only 记录折叠进投影状态（纯函数）。 */
export function applyVerificationRecord(
  state: VerificationProjection,
  record: VerificationRecord,
  eventMetadata: { seq: number; time: number }
): VerificationProjection {
  switch (record.kind) {
    case 'plan':
      return { ...state, plan: { contract: record.contract, authorityScope: record.authorityScope, ...(record.frozenAt ? { frozenAt: record.frozenAt } : {}) }, updatedAt: eventMetadata.time };
    case 'evidence':
      return {
        ...state,
        evidenceRefs: [
          ...state.evidenceRefs,
          {
            callId: record.callId,
            toolIdentity: record.toolIdentity,
            normalizedArgsHash: record.normalizedArgsHash,
            blobHash: record.blobHash,
            truncated: record.truncated,
            originalLength: record.originalLength,
            schemaVersion: record.schemaVersion,
            contractIdentity: record.contractIdentity,
            evidenceType: record.evidenceType,
            resultSeq: record.resultSeq,
            summary: record.summary,
            authorityScope: record.authorityScope,
            policyFacts: record.policyFacts
          }
        ],
        updatedAt: eventMetadata.time
      };
    case 'capture-failure':
      return { ...state, captureFailures: [...state.captureFailures, { ...record }], updatedAt: eventMetadata.time };
    case 'challenge':
      return {
        ...state,
        challenges: { ...state.challenges, [record.questionId]: { ...record } },
        updatedAt: eventMetadata.time
      };
    case 'permit':
      return {
        ...state,
        completionPermits: [...state.completionPermits, { ...record }],
        updatedAt: eventMetadata.time
      };
    case 'verdicts':
      return { ...state, verdicts: { ...record.verdicts }, verdictAuthorityScope: record.authorityScope ?? null, updatedAt: eventMetadata.time };
    case 'gate':
      return { ...state, gateLog: [...state.gateLog, { ...record.entry }], updatedAt: eventMetadata.time };
  }
}

/** 从会话事件日志提取 verification/change 记录（per-session fold 用）。 */
export function extractVerificationRecords(
  events: readonly { type: string; data: unknown; seq: number; time: number }[]
): Array<{ record: VerificationRecord; seq: number; time: number }> {
  const out: Array<{ record: VerificationRecord; seq: number; time: number }> = [];
  for (const event of events) {
    if (event.type !== 'verification/change') {
      continue;
    }
    const data = z.object({ kind: z.literal('verification/change'), version: z.literal(VERIFICATION_CHANGE_VERSION), record: VerificationRecordSchema }).strict().safeParse(event.data);
    if (!data.success) {
      throw new Error(`invalid verification/change at seq ${event.seq}: ${data.error.message}`);
    }
    out.push({ record: data.data.record, seq: event.seq, time: event.time });
  }
  return out;
}

/** 折叠一批验证记录到投影（用于重建/重放）。 */
export function foldVerificationRecords(
  state: VerificationProjection,
  records: Array<{ record: VerificationRecord; seq: number; time: number }>
): VerificationProjection {
  let next = state;
  for (const { record, seq, time } of records) {
    next = applyVerificationRecord(next, record, { seq, time });
  }
  return next;
}

export function gateResultOf(entry: GateSummary): z.infer<typeof GateResultSchema> {
  return { status: entry.status, reasons: entry.reasons };
}

/**
 * rc.2 projection registration splits the legacy single `schema` into
 * `stateSchema` (internal fold state) and `wire.viewSchema` (external view).
 * This is the internal RegistryState schema used by the dsh-verification
 * session projection (projection + incremental epoch fold state).
 */
export const RegistryStateSchema = z
  .object({
    projection: VerificationProjectionSchema,
    epoch: z
      .object({
        epochs: z.array(
          z
            .object({
              epochId: z.string().min(1),
              rootSeq: z.number().int().min(0),
              rootGoalId: z.string().min(1),
              createdSeq: z.number().int().min(0),
              status: z.enum(['active', 'closed']),
              closedSeq: z.number().int().min(0).optional(),
              contentHash: z.string().optional()
            })
            .strict()
        ),
        lastUserSeqOutsideActive: z.number().int()
      })
      .strict()
  })
  .strict();
