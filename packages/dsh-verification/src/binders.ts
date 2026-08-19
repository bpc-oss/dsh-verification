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

/** file 证据族（与 dsh-evidence EVIDENCE_FAMILIES 一致）；族兜底支持判定用。 */
const FILE_FAMILY_TYPES = ['file_diff', 'file_exists', 'quote_with_location'] as const;

export interface BindingContext {
  contractIdentity: ContractIdentity;
  refs: EvidenceRef[];
  captureFailures: CaptureFailureRecord[];
  loadBlob: (key: string) => Promise<Uint8Array | null>;
}

export type BoundOutcome =
  | { kind: 'not-harnessed'; reason: string }
  | { kind: 'bound'; evidence: BoundEvidence; resultSeq: number; familyFallback?: boolean }
  | { kind: 'no-evidence'; reason: string }
  | { kind: 'missing-blob'; reason: string }
  | { kind: 'capture-failure'; reason: string };

export interface BindOptions {
  /**
   * 2026-08-17（完成任务能力修复）：file 族兜底。
   * exact selector 无匹配时，允许用作用域内同族真实证据（file_diff/file_exists/quote_with_location 互认，
   * 任意工具产生均可）绑定——避免"交付物由 write/edit 产生而冻结 selector 是 glob/read"导致的假阴性。
   * 安全语义：仅当 exact 无匹配时启用；绑定结果带 familyFallback 标记，裁决 detail 注明，可审计。
   */
  familyFallback?: boolean;
  /**
   * 2026-08-18（v9.3 修）：run 族命令对齐的额外提示（来自整个契约的其他 AC 描述）。
   * 原因：run AC 描述常只写"验证意图"（如"输出显示全部通过"），命令是实现细节，
   * 单条描述提取的特征 token 可能不在命令里（如 AssertionError）；而文件类 AC 的描述
   * 会提到交付物（same_chars.py），命令 python same_chars.py 含其文件名 → 契约级提示可对齐。
   */
  familyExtraHints?: string[];
}

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
  // 2026-08-18（v9.4）：精确匹配只看 tool + argsHash，不看证据类型——
  // selector 的 evidenceType 是声明时的猜测，真实证据类型由 deriveCaptured 权威决定
  // （如 agent 声明 file_diff 的 pwsh AC，实际 pwsh 产出 command_output——同工具同参数，应绑定后交 oracle 判分）。
  return (
    identityMatches(ref, identity) &&
    ref.toolIdentity === selector.toolIdentity &&
    ref.normalizedArgsHash === selector.normalizedArgsHash
  );
}

function failureMatchesSelector(failure: CaptureFailureRecord, selector: SelectorV1, identity: ContractIdentity): boolean {
  return (
    identityMatches(failure, identity) &&
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
  evidenceTypeFor: (ac: AcceptanceCriterion) => EvidenceType,
  opts: BindOptions = {}
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
    if (opts.familyFallback) {
      const family = await bindFamilyFallback(ac, ctx, selector, opts.familyExtraHints);
      if (family !== undefined) {
        return family;
      }
    }
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

/**
 * 从 AC 描述中提取"交付物路径提示"（file 族兜底用，防止拿无关文件的内容冒充交付物）。
 * 例：`docs/02-external-research-summary.md`、`src/math.js`、`docs/`（目录级）。
 */
function deliverableHints(desc: string): string[] {
  const out = new Set<string>();
  const tokens = desc.match(
    /[A-Za-z0-9_\-./\\]+\.(?:md|js|ts|json|py|txt|yml|yaml|toml|cfg|sh|ps1|css|html)\b|(?:docs|src|lib|config|test|scripts|build|dist|report)(?:[/\\][A-Za-z0-9_\-./\\]*)?/g
  ) ?? [];
  for (const t of tokens) {
    const norm = t.replace(/\\/g, '/');
    if (norm.length >= 3) {
      out.add(norm);
    }
  }
  return [...out];
}

/** 证据 payload 路径（无则空串）。 */
function payloadPath(captured: CapturedEvidence): string {
  const p = (captured.payload as { path?: unknown } | undefined)?.path;
  return typeof p === 'string' ? p.replace(/\\/g, '/') : '';
}

/** 证据 payload command（无则空串）。 */
function payloadCommand(captured: CapturedEvidence): string {
  const p = (captured.payload as { command?: unknown } | undefined)?.command;
  return typeof p === 'string' ? p : '';
}

/** run/test 证据族（command_output / test_run）。 */
const RUN_FAMILY_TYPES = ['command_output', 'test_run'] as const;

function isRunFamilyType(t: string): boolean {
  return (RUN_FAMILY_TYPES as readonly string[]).includes(t);
}

/** run 族命令提示提取时排除的通用词（太宽泛，不能作为对齐依据）。 */
const RUN_STOPWORDS = new Set([
  'python', 'shell', 'bash', 'pwsh', 'powershell', 'cmd', 'command', 'run', 'output', 'stdout', 'stderr',
  '运行', '输出', '测试', '命令', '执行', '验证', '检查', '返回', '结果',
  'test', 'tests', 'suite', 'all', 'pass', 'passes', 'exit', 'code', 'the', 'and', 'that', 'with', 'using', 'should', 'must'
]);

/**
 * 从 AC 描述提取 run 族"命令特征 token"（兜底对齐用）。
 * 优先级：引号内的精确文本 > 非通用标识符（如 fib / same_chars / deploy）。
 */
export function commandHints(desc: string): string[] {
  const out = new Set<string>();
  for (const m of desc.matchAll(/"([^"]{2,})"/g)) out.add(m[1]!.toLowerCase());
  for (const m of desc.matchAll(/'([^']{2,})'/g)) out.add(m[1]!.toLowerCase());
  for (const m of desc.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
    const w = m[0]!.toLowerCase();
    if (!RUN_STOPWORDS.has(w)) out.add(w);
  }
  return [...out];
}

/**
 * 族内候选证据（对齐过滤后，最高 seq 优先）——service 第二程逐条判分用。
 * 2026-08-18 修复：family 兜底此前只取最高 seq 单条，若该条判不过（即使其他真实证据能满足 AC）
 * 也会误拦正确交付。现在返回全部候选，service 判到任一 pass 即通过。
 */
export async function familyCandidates(ac: AcceptanceCriterion, ctx: BindingContext, selector: SelectorV1): Promise<Array<{ evidence: BoundEvidence; resultSeq: number }>> {
  const isFile = FILE_FAMILY_TYPES.includes(selector.evidenceType as (typeof FILE_FAMILY_TYPES)[number]);
  const isRun = isRunFamilyType(selector.evidenceType);
  if (!isFile && !isRun) {
    return [];
  }
  const hints = isFile ? deliverableHints(ac.desc) : commandHints(ac.desc);
  const candidates = ctx.refs
    .filter(
      (ref) =>
        identityMatches(ref, ctx.contractIdentity) &&
        evidenceTypesCompatible(ref.evidenceType, selector.evidenceType) &&
        !(ref.toolIdentity === selector.toolIdentity && ref.normalizedArgsHash === selector.normalizedArgsHash)
    )
    .sort((a, b) => b.resultSeq - a.resultSeq);

  const out: Array<{ evidence: BoundEvidence; resultSeq: number }> = [];
  for (const chosen of candidates) {
    const bytes = await ctx.loadBlob(chosen.blobHash);
    if (!bytes) {
      continue;
    }
    const captured = await parseCaptured(bytes);
    if (!captured || !evidenceTypesCompatible(captured.evidenceType, selector.evidenceType)) {
      continue;
    }
    if (hints.length > 0) {
      if (isFile) {
        const p = payloadPath(captured);
        if (p === '' || !hints.some((h) => p.includes(h))) {
          continue; // 交付物路径未对齐 → 不接受（防无关文件冒充）
        }
      } else {
        const c = payloadCommand(captured).toLowerCase();
        if (c === '' || !hints.some((h) => c.includes(h))) {
          continue; // 命令特征未对齐 → 不接受（防无关命令冒充）
        }
      }
    }
    const bound: BoundEvidence = {
      ...captured,
      callId: chosen.callId,
      acId: ac.id,
      selectorRef: selectorRefOf(ctx.contractIdentity, ac.id)
    };
    out.push({ evidence: bound, resultSeq: chosen.resultSeq });
  }
  return out;
}

/**
 * 族兜底（v9.3）：exact selector 无匹配时，选作用域内同族（evidenceTypesCompatible）真实证据中
 * 最高 committed seq 的一条（排除与 exact selector 同 tool+argsHash 的 ref，避免回绑失败证据）。
 * 支持 file 族（file_diff/file_exists/quote_with_location，路径对齐）与 run 族
 * （command_output/test_run，命令特征对齐——证据 command 须含 AC 描述 + 契约级 extraHints 的特征 token）。
 * blob 缺失/损坏/类型不兼容 → 跳过该候选。
 */
async function bindFamilyFallback(ac: AcceptanceCriterion, ctx: BindingContext, selector: SelectorV1, extraHints?: string[]): Promise<BoundOutcome | undefined> {
  const isFile = FILE_FAMILY_TYPES.includes(selector.evidenceType as (typeof FILE_FAMILY_TYPES)[number]);
  const isRun = isRunFamilyType(selector.evidenceType);
  if (!isFile && !isRun) {
    return undefined; // 仅 file / run 族支持兜底
  }
  const hints = isFile
    ? deliverableHints(ac.desc)
    : [...new Set([...commandHints(ac.desc), ...(extraHints ?? [])])];
  const candidates = ctx.refs
    .filter(
      (ref) =>
        identityMatches(ref, ctx.contractIdentity) &&
        evidenceTypesCompatible(ref.evidenceType, selector.evidenceType) &&
        !(ref.toolIdentity === selector.toolIdentity && ref.normalizedArgsHash === selector.normalizedArgsHash)
    )
    .sort((a, b) => b.resultSeq - a.resultSeq);

  for (const chosen of candidates) {
    const bytes = await ctx.loadBlob(chosen.blobHash);
    if (!bytes) {
      continue;
    }
    const captured = await parseCaptured(bytes);
    if (!captured || !evidenceTypesCompatible(captured.evidenceType, selector.evidenceType)) {
      continue;
    }
    if (hints.length > 0) {
      if (isFile) {
        const p = payloadPath(captured);
        if (p === '' || !hints.some((h) => p.includes(h))) {
          continue; // 交付物路径未对齐 → 不接受（防无关文件冒充）
        }
      } else {
        const c = payloadCommand(captured).toLowerCase();
        if (c === '' || !hints.some((h) => c.includes(h))) {
          continue; // 命令特征未对齐 → 不接受（防无关命令冒充）
        }
      }
    }
    const bound: BoundEvidence = {
      ...captured,
      callId: chosen.callId,
      acId: ac.id,
      selectorRef: selectorRefOf(ctx.contractIdentity, ac.id)
    };
    return { kind: 'bound', evidence: bound, resultSeq: chosen.resultSeq, familyFallback: true };
  }
  return undefined;
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
