/**
 * CompletionPermit + strict replay validator（v9 §4.2 / v11 §1 第 9 条）。
 * 纯函数。TTL 权威时间只信 SessionEvent envelope 的 seq/time，expiry = permitEvent.time + 冻结 config ttlMs；
 * permit payload 不含 issued/expiry。未知 configHash、ttl 不匹配、无 permit、permit 晚于 complete、
 * 提交时已过期或 identity/快照漂移 → fail closed。
 */
import type { ContractIdentity } from '@bpc-oss/dsh-evidence';
import { stableHash } from '@bpc-oss/dsh-evidence';

import type { CompletionPermitRecord } from './projection';

/** 冻结配置快照：configHash → 唯一合法 TTL。 */
export interface FrozenPermitPolicy {
  configHash: string;
  completionPermitTtlMs: number;
  schemaVersion: number;
}

export interface PermitLogEntry {
  record: CompletionPermitRecord;
  /** 承载该 permit 的 verification/change 事件的 envelope seq。 */
  seq: number;
  /** 承载该 permit 的 verification/change 事件的 envelope time。 */
  time: number;
}

export interface CompletedGoalFacts {
  goalId: string;
  goalRevision: number;
  /** Exact immutable permit reference persisted on the complete event. */
  permitRef: string;
  completeSeq: number;
  completeTime: number;
}

export type PermitValidation =
  | { ok: true; permitSeq: number; usedPermitRef: string }
  | { ok: false; reason: string };

export function newPermitRef(): string {
  return `permit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 确定性 gate 快照 hash：契约身份 + 已提交裁决 + 证据 blob/失败 + 配置 + schema 版本。 */
export function computeGateSnapshotHash(input: {
  contractIdentity: ContractIdentity;
  verdicts: Record<string, unknown>;
  evidenceBlobHashes: string[];
  captureFailures: number;
  configHash: string;
  schemaVersion: number;
}): string {
  return stableHash({
    contractIdentity: input.contractIdentity,
    verdicts: input.verdicts,
    evidenceBlobHashes: input.evidenceBlobHashes,
    captureFailures: input.captureFailures,
    configHash: input.configHash,
    schemaVersion: input.schemaVersion
  });
}

/**
 * strict replay validator：验证一次 committed complete（goal 快照已结束在 revision R）在
 * 事件顺序与提交时 TTL 下是否有 valid permit。permit→complete 绑定按
 * complete 事件持久化的 permitRef 精确匹配。不得回退至最新匹配 permit。
 */
export function validatePermitForCompletion(input: {
  completed: CompletedGoalFacts;
  /** complete 事件之前已提交的 permit 记录（seq < completeSeq）。 */
  permits: PermitLogEntry[];
  policies: Record<string, FrozenPermitPolicy>;
  contractIdentity: ContractIdentity;
  gateSnapshotHash: string;
}): PermitValidation {
  if (!input.completed.permitRef) {
    return { ok: false, reason: 'strict-replay: complete event has no permitRef' };
  }
  const latest = input.permits.find((entry) => entry.record.permitRef === input.completed.permitRef);
  if (!latest) {
    return { ok: false, reason: `strict-replay: referenced permit ${input.completed.permitRef} does not exist` };
  }
  if (latest.record.goalId !== input.completed.goalId || latest.record.goalRevision !== input.completed.goalRevision) {
    return { ok: false, reason: 'strict-replay: referenced permit goal or revision drift' };
  }

  if (latest.seq >= input.completed.completeSeq) {
    return { ok: false, reason: `strict-replay: permit (seq ${latest.seq}) must precede complete (seq ${input.completed.completeSeq})` };
  }

  const policy = input.policies[latest.record.configHash];
  if (!policy) {
    return { ok: false, reason: `strict-replay: unknown configHash ${latest.record.configHash}` };
  }
  if (latest.record.ttlMs !== policy.completionPermitTtlMs) {
    return {
      ok: false,
      reason: `strict-replay: ttlMs ${latest.record.ttlMs} does not match frozen policy ${policy.completionPermitTtlMs} for configHash ${latest.record.configHash}`
    };
  }

  const derivedExpiresAt = latest.time + policy.completionPermitTtlMs;
  if (latest.time > input.completed.completeTime || input.completed.completeTime > derivedExpiresAt) {
    return {
      ok: false,
      reason: `strict-replay: complete time ${input.completed.completeTime} outside permit window [${latest.time}, ${derivedExpiresAt}]`
    };
  }

  const identityMatches =
    latest.record.contractIdentity.contractId === input.contractIdentity.contractId &&
    latest.record.contractIdentity.revision === input.contractIdentity.revision &&
    latest.record.contractIdentity.contractContentHash === input.contractIdentity.contractContentHash &&
    latest.record.contractIdentity.basisHash === input.contractIdentity.basisHash &&
    latest.record.contractIdentity.sessionId === input.contractIdentity.sessionId;
  if (!identityMatches) {
    return { ok: false, reason: 'strict-replay: permit contract identity drift' };
  }

  if (latest.record.gateSnapshotHash !== input.gateSnapshotHash) {
    return { ok: false, reason: 'strict-replay: permit gate snapshot drift (evidence/verdicts/config changed after permit minted)' };
  }

  return { ok: true, permitSeq: latest.seq, usedPermitRef: latest.record.permitRef };
}
