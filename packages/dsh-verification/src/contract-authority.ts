/**
 * 契约权威（v6/v9）：服务端 mint ContractRef + sourceBasis 服务端收集 + 独立捕获 / human-confirmed。
 * 来源：`dsh-plugin-port-plan.md` §1.2 / P0-1 文档 §4.5。
 * 要点：
 *  - 模型参数只是"建议"；enforce 下契约成立必须二选一（independent-capture / human-confirmed challenge）；
 *  - sourceBasis 服务端按 goal-bound task boundary 收集（起点 = active epoch rootSeq → 终点 captureSeq；
 *    v1 只收集权威用户消息，附件/控制文档为可配后置），超 maxEntries 拒绝不截断；
 *  - 用户修正 → re-basis：新 contractId + revision 0 + 新 contentHash，旧证据/确认失效。
 */
import { randomUUID } from 'node:crypto';
import type { SelectorV1, Constraint, OracleHint, AcceptanceCriterion } from '@bpc-oss/dsh-evidence';
import { stableHash, textHash } from '@bpc-oss/dsh-evidence';
import { computeBasisHash, computeContractContentHash } from '@bpc-oss/dsh-evidence';
import type { TaskContract } from '@bpc-oss/dsh-evidence';

/** 用户提交的 AC 建议（服务端据此 + 工具 schema 冻结 exact selector；无 tool → AC 走 T2/T4）。 */
export interface AcProposal {
  id: string;
  desc: string;
  oracleHint: OracleHint;
  tool?: string;
  args?: Record<string, unknown>;
}

export interface PlanProposal {
  goal_value: string;
  acceptance_criteria: AcProposal[];
  constraints: Constraint[];
  inputs: string[];
  outOfScope: string[];
}

export interface BasisRuntimeEntry {
  kind: 'user-message' | 'attachment' | 'control-doc' | 'user-correction';
  eventRef: string;
  seq: number;
  text: string;
}

export const MAX_SOURCE_BASIS_ENTRIES = 200;

export class BasisTooLargeError extends Error {
  constructor(count: number) {
    super(`sourceBasis exceeds maxEntries ${MAX_SOURCE_BASIS_ENTRIES} (got ${count}); split the task`);
    this.name = 'BasisTooLargeError';
  }
}

/** 从权威用户消息收集 sourceBasis 运行时条目（按 seq 升序；调用方保证起点/终点）。 */
export function collectBasisEntries(messages: Array<{ eventRef: string; seq: number; text: string }>): BasisRuntimeEntry[] {
  if (messages.length > MAX_SOURCE_BASIS_ENTRIES) {
    throw new BasisTooLargeError(messages.length);
  }
  return messages
    .map((message) => ({
      kind: 'user-message' as const,
      eventRef: message.eventRef,
      seq: message.seq,
      text: message.text
    }))
    .sort((a, b) => a.seq - b.seq);
}

/** 把运行时条目物化为持久化 schema（contentHash 存文本 hash）。 */
export function materializeBasis(sessionId: string, entries: BasisRuntimeEntry[]) {
  return {
    sessionId,
    entries: entries.map((entry) => ({
      kind: entry.kind,
      eventRef: entry.eventRef,
      seq: entry.seq,
      contentHash: textHash(entry.text)
    })),
    basisHash: computeBasisHash(
      sessionId,
      entries.map((entry) => ({
        kind: entry.kind,
        eventRef: entry.eventRef,
        seq: entry.seq,
        contentHash: textHash(entry.text)
      }))
    )
  };
}

/** sourceBasis 全文（独立捕获的 grader 唯一输入）。 */
export function basisPromptText(entries: BasisRuntimeEntry[]): string {
  return entries
    .map((entry) => `[${entry.kind} @seq${entry.seq}] ${entry.text}`)
    .join('\n\n');
}

export interface MintOptions {
  sessionId: string;
  origin: 'independent-capture' | 'human-confirmed' | 'model-self-declared' | string;
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  constraints: Constraint[];
  inputs: string[];
  outOfScope: string[];
  basis: BasisRuntimeEntry[];
  /** 契约内容 hash 手工覆盖（re-basis 校验旧内容用；正常走 compute） */
  contentHashOverride?: string;
}

/** 校验契约内容体的 schema 契约（供 consumer 复用；避免 z 依赖外泄）。 */
export interface ContractBodyShape {
  goal: string;
  acceptanceCriteria: AcceptanceCriterion[];
  constraints: Constraint[];
  inputs: string[];
  outOfScope: string[];
}

/** 服务端 mint：确定性 contractId + 服务端 revision + 内容/basis hash（模型提交值一律忽略）。 */
export function mintContract(options: MintOptions): TaskContract {
  const contentBody = {
    goal: options.goal,
    acceptanceCriteria: options.acceptanceCriteria,
    constraints: options.constraints,
    inputs: options.inputs,
    outOfScope: options.outOfScope
  };
  const contractContentHash = options.contentHashOverride ?? computeContractContentHash(contentBody);
  const sourceBasis = materializeBasis(options.sessionId, options.basis);
  // 确定性 contractId（重建/重放安全；同内容同 basis 同 session → 同 id）
  const contractId = stableHash({
    kind: 'verification-contract',
    sessionId: options.sessionId,
    contractContentHash,
    basisHash: sourceBasis.basisHash,
    revision: 0
  });
  return {
    ref: {
      contractId,
      revision: 0,
      contractContentHash,
      sourceBasis
    },
    origin: options.origin,
    ...contentBody
  } as TaskContract;
}

/** re-basis：新 revision 0 + 新 contractId（新 contentHash），同 session。 */
export function rebaseContract(previous: TaskContract): TaskContract {
  const contentBody = {
    goal: previous.goal,
    acceptanceCriteria: previous.acceptanceCriteria,
    constraints: previous.constraints,
    inputs: previous.inputs,
    outOfScope: previous.outOfScope
  };
  const contractContentHash = computeContractContentHash(contentBody);
  const contractId = stableHash({
    kind: 'verification-contract',
    sessionId: previous.ref.sourceBasis.sessionId,
    contractContentHash,
    basisHash: previous.ref.sourceBasis.basisHash,
    revision: 0,
    rebased: randomUUID()
  });
  return {
    ref: {
      contractId,
      revision: 0,
      contractContentHash,
      sourceBasis: previous.ref.sourceBasis
    },
    origin: previous.origin,
    ...contentBody
  };
}

/** 服务端生成的一次性 contract approval challenge 状态（questionId 为稳定引用）。 */
export interface ContractChallengeState {
  questionId: string;
  contract: TaskContract;
}

export function createContractChallenge(contract: TaskContract, questionId: string): ContractChallengeState {
  return { questionId, contract };
}
