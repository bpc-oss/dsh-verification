/**
 * 服务端 exact-only selector 绑定（v9 §4.5 / v11 §1）。
 * 输入：冻结的 SelectorV1 + 已提交的 evidence refs / capture failures + blob 读取。
 * 规则：
 *  - 一证据一 AC（每条未绑定证据只绑定一个 AC；重复 exact selector 在契约生成期拒绝）；
 *  - 每个 selector 只裁决当前 contract identity 内最高 committed result seq；
 *    最高 seq 对应 capture-failure / 失败证据 / blob 缺失 → AC fail，不得回退更早 PASS；
 *  - BoundEvidence 只能由服务端 binder 产生（模型自报 acId 一律拒绝）。
 */
import type { AcceptanceCriterion } from '@bpc-oss/dsh-evidence';
import type { BoundEvidence, CapturedEvidence, ContractIdentity, EvidenceType, SelectorV1 } from '@bpc-oss/dsh-evidence';
import { CapturedEvidenceSchema, evidenceTypesCompatible, selectorKey, selectorRefOf } from '@bpc-oss/dsh-evidence';

import type { CaptureFailureRecord, EvidenceRef } from './projection';

export interface BindingContext {
  contractIdentity: ContractIdentity;
  refs: EvidenceRef[];
  captureFailures: CaptureFailureRecord[];
  loadBlob: (key: string) => Promise<Uint8Array | null>;
}

export type BoundOutcome =
  | { kind: 'not-harnessed'; reason: string }
  | { kind: 'bound'; evidence: BoundEvidence; resultSeq: number }
  | { kind: 'no-evidence'; reason: string }
  | { kind: 'missing-blob'; reason: string }
  | { kind: 'capture-failure'; reason: string };

function identityMatches(ref: { contractIdentity: ContractIdentity }, identity: ContractIdentity): boolean {
  return (
    ref.contractIdentity.contractId === identity.contractId &&
    ref.contractIdentity.revision === identity.revision &&
    ref.contractIdentity.contractContentHash === identity.contractContentHash &&
    ref.contractIdentity.basisHash === identity.basisHash &&
    ref.contractIdentity.sessionId === identity.sessionId
  );
}

function refMatchesSelector(ref: EvidenceRef, selector: SelectorV1, identity: ContractIdentity): boolean {
  return (
    identityMatches(ref, identity) &&
    evidenceTypesCompatible(ref.evidenceType, selector.evidenceType) &&
    ref.toolIdentity === selector.toolIdentity &&
    ref.normalizedArgsHash === selector.normalizedArgsHash
  );
}

function failureMatchesSelector(failure: CaptureFailureRecord, selector: SelectorV1, identity: ContractIdentity): boolean {
  return (
    identityMatches(failure, identity) &&
    evidenceTypesCompatible(failure.evidenceType, selector.evidenceType) &&
    failure.toolIdentity === selector.toolIdentity &&
    failure.normalizedArgsHash === selector.normalizedArgsHash
  );
}

async function parseCaptured(bytes: Uint8Array): Promise<CapturedEvidence | null> {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const valid = CapturedEvidenceSchema.safeParse(parsed);
    return valid.success ? valid.data : null;
  } catch {
    return null;
  }
}

/** 绑定一个 AC 的 selector（产出 BoundEvidence 或明确的失败原因）。 */
export async function bindSelectorForAc(
  ac: AcceptanceCriterion,
  ctx: BindingContext,
  evidenceTypeFor: (ac: AcceptanceCriterion) => EvidenceType
): Promise<BoundOutcome> {
  const selector = ac.selector;
  if (!selector) {
    return { kind: 'not-harnessed', reason: `AC ${ac.id} has no frozen exact selector; route to T2/T4` };
  }

  // 当前 contract identity 内与该 selector 精确匹配的已提交执行（证据 refs ∪ capture failures）
  const matchingRefs = ctx.refs.filter((ref) => refMatchesSelector(ref, selector, ctx.contractIdentity));
  const matchingFailures = ctx.captureFailures.filter((failure) => failureMatchesSelector(failure, selector, ctx.contractIdentity));

  let topSeq = -1;
  let topKind: 'ref' | 'failure' | undefined;
  for (const ref of matchingRefs) {
    if (ref.resultSeq > topSeq) {
      topSeq = ref.resultSeq;
      topKind = 'ref';
    }
  }
  for (const failure of matchingFailures) {
    if (failure.resultSeq > topSeq) {
      topSeq = failure.resultSeq;
      topKind = 'failure';
    }
  }

  if (topKind === undefined) {
    return { kind: 'no-evidence', reason: `AC ${ac.id}: no committed run for selector (${selector.toolIdentity}, ${selector.normalizedArgsHash.slice(0, 8)}, ${selector.evidenceType})` };
  }
  if (topKind === 'failure') {
    return { kind: 'capture-failure', reason: `AC ${ac.id}: latest committed run failed to capture (seq ${topSeq})` };
  }

  const chosen = matchingRefs.find((ref) => ref.resultSeq === topSeq)!;
  const bytes = await ctx.loadBlob(chosen.blobHash);
  if (!bytes) {
    return { kind: 'missing-blob', reason: `AC ${ac.id}: blob ${chosen.blobHash.slice(0, 8)} missing/corrupt (seq ${topSeq})` };
  }
  const captured = await parseCaptured(bytes);
  if (!captured || captured.toolIdentity !== selector.toolIdentity || captured.normalizedArgsHash !== selector.normalizedArgsHash) {
    return { kind: 'missing-blob', reason: `AC ${ac.id}: blob content does not match selector (seq ${topSeq})` };
  }

  // ref 是持久化的权威 callId（blob 可能被内容寻址重建）；以 ref 为准
  const bound: BoundEvidence = {
    ...captured,
    callId: chosen.callId,
    acId: ac.id,
    selectorRef: selectorRefOf(ctx.contractIdentity, ac.id)
  };
  return { kind: 'bound', evidence: bound, resultSeq: topSeq };
}

/** 契约生成期校验：两个 AC 使用同一 exact selector → 拒绝契约。 */
export function findDuplicateSelectors(acs: ReadonlyArray<AcceptanceCriterion>): Array<{ acId: string; selectorKey: string }> {
  const seen = new Map<string, string>();
  const duplicates: Array<{ acId: string; selectorKey: string }> = [];
  for (const ac of acs) {
    if (!ac.selector) {
      continue;
    }
    const key = selectorKey(ac.selector);
    const existing = seen.get(key);
    if (existing !== undefined) {
      duplicates.push({ acId: ac.id, selectorKey: key });
    } else {
      seen.set(key, ac.id);
    }
  }
  return duplicates;
}
