import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import type { AcceptanceCriterion, BoundEvidence, Constraint, ContractIdentity, EvidenceType, GateResult, TaskContract, Verdict } from '@bpc-oss/dsh-evidence';
import { TaskContractSchema, deriveCaptured } from '@bpc-oss/dsh-evidence';
import type { ToolRecord } from '@bpc-oss/dsh-evidence';
import { identitiesEqual } from '@bpc-oss/dsh-evidence';
import { z } from 'zod';

import { bindSelectorForAc, findDuplicateSelectors, type BoundOutcome } from './binders';
import { ConstraintsLibrary } from './constraint-library';
import { mintContract, rebaseContract, type BasisRuntimeEntry, type PlanProposal } from './contract-authority';
import { contractIdentityOf } from '@bpc-oss/dsh-evidence';
import { DEFAULT_CHECKERS, enforceConstraints, type ExecContext } from './constraints';
import { extractJsonCandidates, GraderParseError } from './grader-parse';
import { isNetworkLikeTool } from './evidence-capture';
import { VerificationEngine } from './engine';
import { createMemoryBlobStore, storePayload, type BlobStore } from './evidence-store';
import { CompletionGate } from './gate';
import { runStructuredConsensus } from './intent-consensus';
import { completeText } from './llm/call';
import { AssistantResponseOracle } from './oracles/assistant-response';
import { ProReviewOracle } from './oracles/pro-review';
import { CommandExitOracle, FileDiffOracle, FileExistsOracle } from './oracles/deterministic';
import { CoverageOracle, SchemaValidOracle, TestRunOracle } from './oracles/run-based';
import { GRADER_INTENT_SYSTEM_PROMPT } from './prompts';
import { createSubagentProReviewRunner } from './pro-review-runner';
import type { Oracle } from './oracle';
import { computeGateSnapshotHash, newPermitRef, validatePermitForCompletion, type PermitLogEntry, type PermitValidation } from './permits';
import {
  applyVerificationRecord,
  emptyVerificationProjection,
  extractVerificationRecords,
  foldVerificationRecords,
  type GateSummary,
  type AuthorityScope,
  type PolicyFacts,
  type VerificationProjection,
  type VerificationRecord
} from './projection';
import { currentActiveEpoch, foldTaskEpochs, type FoldedEpoch } from './task-epoch';
import { hintToEvidenceType, textSummary } from './verdicts';
import { normalizedArgsHash } from './verdicts';

/**
 * 验证服务（v9）。
 * 状态来源：session goal 日志折叠 epoch + append-only verification 记录折叠 projection。
 * 唯一持久化写路径 = commit(agent, record)：追加一条 verification/change 记录到 session。
 */
export interface VerificationRuntimeConfig {
  mode: 'enforce' | 'advisory';
  maxCapturedEvidence: number;
  maxCapturedBytes: number;
  completionPermitTtlMs: number;
  configHash: string;
  enableDeterministic: boolean;
  enableAssistantResponse: boolean;
  enableCoverage: boolean;
  enableProReview: boolean;
  proReviewProvider: string;
  globalConstraints: Constraint[];
  intent: {
    consensusCount: number;
    provider?: string;
    model?: string;
    contractOrigin: 'independent-capture' | 'human-confirmed';
    maxEntries: number;
  };
  readOnlyToolAllowlist: string[];
  /** 2026-08-17：file 族 AC 精确绑定失败时启用族内证据兜底（减少假阴性）。 */
  binderFamilyFallback: boolean;
  /** 人类确认通道（P0-1 review：apply 注入 dsh approval/service；测试可注入；agent+decision 上下文随附）。 */
  askUser?: (question: { agent: Agent; questionId: string; text: string; choices: string[] }) => Promise<string | undefined>;
}

export interface ServiceDeps {
  store?: BlobStore;
  clock?: () => number;
}

/** file 证据族（与 dsh-evidence EVIDENCE_FAMILIES 一致）；用于判定某 AC 是否可做族内兜底。 */
const FILE_FAMILY_TYPES = ['file_diff', 'file_exists', 'quote_with_location'] as const;

function isFileFamilyAc(ac: import('@bpc-oss/dsh-evidence').AcceptanceCriterion): boolean {
  if (ac.oracleHint === 'file') {
    return true;
  }
  const t = ac.selector?.evidenceType;
  return t !== undefined && (FILE_FAMILY_TYPES as readonly string[]).includes(t);
}

export class VerificationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'VerificationError';
    this.code = code;
  }
}

/** grader body 键归一化：容忍 snake_case（本地模型常直接回显工具参数命名），保守转 camelCase。 */
function normalizeGraderBody(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };
  if (out.acceptance_criteria !== undefined && out.acceptanceCriteria === undefined) {
    out.acceptanceCriteria = out.acceptance_criteria;
  }
  if (Array.isArray(out.acceptanceCriteria)) {
    out.acceptanceCriteria = out.acceptanceCriteria.map((ac) => {
      if (ac === null || typeof ac !== 'object') {
        return ac;
      }
      const acRecord = { ...(ac as Record<string, unknown>) };
      if (acRecord.oracle_hint !== undefined && acRecord.oracleHint === undefined) {
        acRecord.oracleHint = acRecord.oracle_hint;
      }
      return acRecord;
    });
  }
  return out;
}

/**
 * grader 输出解析用 lenient body schema：ref/origin 由服务端 mint（grader prompt 只输出 body 字段，
 * 强校验 ref/origin 必然 all_invalid）。额外字段（如 origin）允许。
 */
const GraderBodySchema = z
  .object({
    goal: z.string().min(1),
    acceptanceCriteria: z
      .array(
        z.object({
          id: z.string().min(1),
          desc: z.string().min(1),
          oracleHint: z.enum(['test', 'run', 'file', 'schema', 'review', 'human'])
        })
      )
      .min(1),
    constraints: z.array(z.object({ id: z.string().min(1), desc: z.string().min(1), check: z.string().min(1) })).default([]),
    inputs: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).default([])
  });

interface AgentCache {
  observedSeq: number;
  projection: VerificationProjection;
  epochSeq: number;
  epochs: FoldedEpoch[];
  /** durable `tool/call` 索引（S3-1 network 重建 + S3-4 对账的唯一数据源）：callId → {name,args,seq}。 */
  calls: Map<string, { name: string; args: Record<string, unknown>; seq: number }>;
  /** 最近一次契约 plan 的 committed seq：只对其后的 tool/call 做对账（此前的属 unbound telemetry）。 */
  contractPlanSeq: number;
  /** 最近一次已对账的 session seq（幂等保护）。 */
  reconciledSeq: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizePolicyPath(value: string): string {
  const slash = value.replace(/\\/g, '/').replace(/\/+/g, '/');
  const absolute = slash.startsWith('/') || /^[A-Za-z]:\//.test(slash);
  const prefix = /^[A-Za-z]:\//.test(slash) ? slash.slice(0, 3) : slash.startsWith('/') ? '/' : '';
  const parts: string[] = [];
  for (const part of slash.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push('..');
      else parts.push('..'); // retain impossible-to-prove escape; never turn it into a safe relative path
      continue;
    }
    parts.push(part);
  }
  return `${prefix}${parts.join('/')}` || (absolute ? prefix : '.');
}

function policyFactsFor(record: ToolRecord): PolicyFacts {
  const path = ['path', 'file_path', 'filepath', 'file', 'target']
    .map((key) => record.arguments[key])
    .find((value): value is string => typeof value === 'string' && value.length > 0);
  const endpoint = ['url', 'host']
    .map((key) => record.arguments[key])
    .find((value): value is string => typeof value === 'string' && value.length > 0);
  return { paths: path ? [normalizePolicyPath(path)] : [], networkCalls: isNetworkLikeTool(record.name) ? [endpoint ?? record.name] : [] };
}

/** 递归剥离 undefined（session 事件要求 lossless JSON）。 */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) {
        out[key] = stripUndefined(entry);
      }
    }
    return out;
  }
  return value;
}

function authoritativeUserMessages(session: Session): Array<{ eventRef: string; seq: number; text: string }> {
  const out: Array<{ eventRef: string; seq: number; text: string }> = [];
  for (const event of session.events) {
    if (event.type !== 'user/message') {
      continue;
    }
    const data = event.data as { source?: { kind?: string }; content?: Array<{ type?: string; text?: string }> } | undefined;
    if (data?.source?.kind !== 'user') {
      continue;
    }
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('')
      .trim();
    if (text.length > 0) {
      out.push({ eventRef: String(event.seq), seq: event.seq, text });
    }
  }
  return out;
}

function currentGoalSnapshot(events: Session['events'], goalId: string): { id: string; revision: number; phase: string } | undefined {
  let snapshot: { id: string; revision: number; phase: string } | undefined;
  for (const event of events) {
    if (event.type !== 'goal/change') {
      continue;
    }
    const data = event.data as { operation?: string; goal?: { id: string; revision: number; phase: string }; cleared?: { id: string } };
    if (data?.goal?.id === goalId) {
      snapshot = { id: data.goal.id, revision: data.goal.revision, phase: data.goal.phase };
    }
    if (data?.operation === 'clear' && data.cleared?.id === goalId) {
      snapshot = undefined;
    }
  }
  return snapshot;
}

/** 从 durable `tool/call` 事件解析出对账/network 所需的最小 ToolRecord；解析失败返回 null。 */
function parseDurableToolCall(event: { type: string; data: unknown; seq: number }): { callId: string; name: string; args: Record<string, unknown>; seq: number } | null {
  if (event.type !== 'tool/call') {
    return null;
  }
  const data = event.data as { callId?: unknown; name?: unknown; arguments?: unknown };
  if (typeof data.callId !== 'string' || data.callId.length === 0 || typeof data.name !== 'string') {
    return null;
  }
  let args: Record<string, unknown> = {};
  if (typeof data.arguments === 'string') {
    try {
      const parsed = JSON.parse(data.arguments) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      /* 参数解析失败不阻断对账 */
    }
  } else if (data.arguments !== null && typeof data.arguments === 'object') {
    args = data.arguments as Record<string, unknown>;
  }
  return { callId: data.callId, name: data.name, args, seq: event.seq };
}

export class VerificationService extends Service {
  static inject = ['agents'];

  private readonly caches = new WeakMap<Session, AgentCache>();
  private readonly store: BlobStore;
  private readonly clock: () => number;
  /** 最近一次独立捕获失败的根因（供 enforce 拒绝信息 — S1-2：origin 标签诚实 + 失败显式化）。 */
  private captureUnavailableReason?: string;
  /** S3-4：会话内"已处理（在途/成功/失败）"的可采集 callId —— 对账对它们免于误报。 */
  private readonly handledCallsBySession = new WeakMap<Session, Set<string>>();

  constructor(
    ctx: Context,
    private readonly config: VerificationRuntimeConfig,
    deps: ServiceDeps = {}
  ) {
    super(ctx, 'verification');
    this.store = deps.store ?? createMemoryBlobStore();
    this.clock = deps.clock ?? Date.now;
  }

  // ── 状态访问 ────────────────────────────────────────────────

  /** S3-4 对账重入保护：commit → cache() → sync 的递归有界（每次只落一条缺口）。 */
  private reconciling = false;

  private cache(agent: Agent): AgentCache {
    let cache = this.caches.get(agent.session);
    if (!cache) {
      cache = { observedSeq: 0, projection: emptyVerificationProjection(), epochSeq: 0, epochs: [], calls: new Map(), contractPlanSeq: -1, reconciledSeq: 0 };
      this.caches.set(agent.session, cache);
    }
    this.sync(agent, cache);
    return cache;
  }

  private sync(agent: Agent, cache: AgentCache): void {
    if (cache.observedSeq < agent.session.seq) {
      const slice = agent.session.events.slice(cache.observedSeq).map((e) => ({ type: e.type, data: e.data, seq: e.seq, time: e.time }));
      cache.projection = foldVerificationRecords(cache.projection, extractVerificationRecords(slice));
      for (const event of slice) {
        // 本服务自己的写路径由 commit() 直接推进 observedSeq 并设置权威 planSeq 基线；
        // 这里兜底"从原始日志/测试回放"路径（不经 commit）的事件折叠。
        if (event.type === 'verification/change') {
          const record = (event.data as { record?: { kind?: string; contract?: TaskContract } }).record;
          if (record?.kind === 'plan' && record.contract) {
            cache.contractPlanSeq = event.seq;
          }
        }
        if (event.type === 'tool/call') {
          const parsed = parseDurableToolCall(event);
          if (parsed) {
            cache.calls.set(parsed.callId, parsed);
          }
        }
      }
      cache.observedSeq = agent.session.seq;
    }
    // S3-4 对账：契约存在后，durable tool/call 必须对应 evidenceRef 或 captureFailure（fail closed，写 durable 记录）。
    this.reconcileDurableCalls(agent, cache);
    if (cache.epochSeq < agent.session.seq || cache.epochs.length === 0) {
      cache.epochs = foldTaskEpochs(
        agent.session.events.map((e) => ({ type: e.type, data: e.data, seq: e.seq, time: e.time })),
        agent.session.id
      );
      cache.epochSeq = agent.session.seq;
    }
  }

  private allEvents(agent: Agent): Array<{ type: string; data: unknown; seq: number; time: number }> {
    return agent.session.events.map((e) => ({ type: e.type, data: e.data, seq: e.seq, time: e.time }));
  }

  getProjection(agent: Agent): VerificationProjection {
    return this.cache(agent).projection;
  }

  getActiveEpoch(agent: Agent): FoldedEpoch | undefined {
    return currentActiveEpoch(this.cache(agent).epochs);
  }

  private requireCurrentAuthorityScope(agent: Agent): AuthorityScope {
    const epoch = this.getActiveEpoch(agent);
    if (!epoch) {
      throw new VerificationError(
        'missing_authority_scope: no active task epoch。引导：请先调用 create_goal 建立目标（建议在一条用户消息之后让模型创建），再 set_verification_plan 声明契约；advisory 模式可跳过声明直接执行。',
        'VERIFICATION_MISSING_ROOT_GOAL'
      );
    }
    return { epochId: epoch.epochId, rootGoalId: epoch.rootGoalId, ownerAgentId: String(agent.id) };
  }

  getPlanView(agent: Agent): import('./projection').VerificationPlanView | null {
    const plan = this.cache(agent).projection.plan;
    if (!plan) return null;
    let scope: AuthorityScope;
    try {
      scope = this.requireCurrentAuthorityScope(agent);
    } catch (error) {
      // 仅当"无活跃任务 epoch"（root goal 创建前缺少权威用户消息等）时降级为"无 plan"，
      // 避免 getContract 在 tools/pre-execute 里抛出不透明的 missing_authority_scope 把写工具锁死。
      // 其他真实错误（如非法记录重放、durable 提交失败）必须继续抛出，不得吞掉。
      if (error instanceof VerificationError && error.code === 'VERIFICATION_MISSING_ROOT_GOAL') {
        return null;
      }
      throw error;
    }
    return plan.authorityScope !== undefined && plan.authorityScope.epochId === scope.epochId && plan.authorityScope.rootGoalId === scope.rootGoalId && plan.authorityScope.ownerAgentId === scope.ownerAgentId ? plan : null;
  }

  /** 公开 blob 读取（pro_review / 工具用）。 */
  async readBlob(key: string): Promise<Uint8Array | null> {
    return this.store.read(key);
  }

  getContract(agent: Agent): TaskContract | null {
    return this.getPlanView(agent)?.contract ?? null;
  }

  isFrozen(agent: Agent): boolean {
    return this.getPlanView(agent)?.frozenAt !== undefined;
  }

  // ── epoch / contract ────────────────────────────────────────

  requireGoalBoundEpoch(agent: Agent, goalId: string, goalRevision: number): FoldedEpoch {
    const active = this.getActiveEpoch(agent);
    if (!active) {
      throw new VerificationError(
        'missing_root_goal: no active root goal; create_goal must establish the task epoch。引导：先发一条消息说明任务，再让模型调用 create_goal，然后 set_verification_plan 绑定验收标准。',
        'VERIFICATION_MISSING_ROOT_GOAL'
      );
    }
    if (active.rootGoalId !== goalId) {
      throw new VerificationError(
        `missing_root_goal: active root goal is ${active.rootGoalId}, not ${goalId}。引导：set_verification_plan 必须针对当前活跃目标调用，请先 get_goal 确认当前目标 id 与 revision。`,
        'VERIFICATION_MISSING_ROOT_GOAL'
      );
    }
    const snapshot = currentGoalSnapshot(agent.session.events, goalId);
    if (!snapshot || snapshot.revision !== goalRevision || snapshot.phase === 'complete') {
      throw new VerificationError(
        `stale_revision: goal ${goalId} current revision ${snapshot?.revision ?? 'none'} != ${goalRevision}`,
        'VERIFICATION_STALE_REVISION'
      );
    }
    return active;
  }

  collectSourceBasis(agent: Agent): BasisRuntimeEntry[] {
    const active = this.getActiveEpoch(agent);
    if (!active) {
      return [];
    }
    // 起点 = active epoch 的 rootSeq（含该条用户消息本身）；区间内全部权威用户消息全收
    const messages = authoritativeUserMessages(agent.session).filter((message) => message.seq >= active.rootSeq);
    const entries: BasisRuntimeEntry[] = messages.map((message) => ({
      kind: 'user-message',
      eventRef: message.eventRef,
      seq: message.seq,
      text: message.text
    }));
    if (entries.length > this.config.intent.maxEntries) {
      throw new VerificationError(`sourceBasis exceeds maxEntries ${this.config.intent.maxEntries}`, 'VERIFICATION_BASIS_TOO_LARGE');
    }
    return entries;
  }

  /** set_verification_plan：提案 → 服务端冻结 selector → 独立捕获/人类确认 → mint + attach。 */
  async setPlanFromProposal(
    agent: Agent,
    goalId: string,
    goalRevision: number,
    proposal: PlanProposal
  ): Promise<{ ok: true; contract: TaskContract } | { ok: false; reason: string }> {
    try {
      this.requireGoalBoundEpoch(agent, goalId, goalRevision);
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
    let basis: BasisRuntimeEntry[];
    try {
      basis = this.collectSourceBasis(agent);
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }

    const acs: AcceptanceCriterion[] = proposal.acceptance_criteria.map((ac) => {
      const frozen: AcceptanceCriterion = { id: ac.id, desc: ac.desc, oracleHint: ac.oracleHint };
      if (ac.tool && ac.args) {
        frozen.selector = {
          schemaVersion: 1,
          toolIdentity: ac.tool,
          normalizedArgsHash: normalizedArgsHash(ac.args),
          evidenceType: hintToEvidenceType(ac.oracleHint)
        };
      }
      return frozen;
    });
    const duplicates = findDuplicateSelectors(acs);
    if (duplicates.length > 0) {
      return { ok: false, reason: `duplicate exact selector on ${duplicates.map((d) => d.acId).join(', ')}` };
    }

    let body = {
      goal: proposal.goal_value,
      acceptanceCriteria: acs,
      constraints: proposal.constraints,
      inputs: proposal.inputs,
      outOfScope: proposal.outOfScope
    };
    // S1-2 修复：origin 反映真实路径；enforce 下捕获失败/无 askUser 显式拒绝，不静默降级。
    let origin: TaskContract['origin'] | string = this.config.intent.contractOrigin;
    if (this.config.intent.contractOrigin === 'independent-capture') {
      // S1-2（真机）修复：grader 是**非确定性 LLM**，单次生成可能产出纯散文/无 JSON
      // （本地 vLLM + reasoning 场景已实测）。enforce 严格拒绝语义保留，但对捕获失败做
      // **有界重试**（幂等、无副作用）——这是对"严格权威"的正确补偿，不是静默降级：重试耗尽
      // 仍失败才 reject。
      let captured: Awaited<ReturnType<VerificationService['tryIndependentCapture']>> = null;
      const captureAttempts = this.config.mode === 'enforce' ? 3 : 1;
      for (let attempt = 0; attempt < captureAttempts && captured === null; attempt += 1) {
        captured = await this.tryIndependentCapture(
          agent,
          basis,
          proposal.acceptance_criteria.map((ac) => ({ id: ac.id, tool: ac.tool, args: ac.args }))
        );
        if (captured === null && attempt + 1 < captureAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (captured) {
        body = captured;
        origin = 'independent-capture';
        // 权威内容来自 grader，但冻结 selector 只能来自"执行者"提案（grader 无法预测工具调用参数，
        // 其 prompt 也不产出 tool/args）。按 acId 把提案带 tool+args 的 selector 回填到捕获 AC 上；
        // id 对不上的捕获 AC 不误挂 selector → 自然走 T2/T4/human（不裸奔不伪造绑定）。
        const byId = new Map(acs.map((ac) => [ac.id, ac]));
        body = {
          ...body,
          acceptanceCriteria: body.acceptanceCriteria.map((ac) => {
            const proposed = byId.get(ac.id);
            if (proposed?.selector) {
              return { ...ac, selector: proposed.selector };
            }
            return ac;
          })
        };
      } else if (this.config.mode === 'enforce') {
        return {
          ok: false,
          reason: `independent-capture unavailable after ${captureAttempts} attempt(s) (${this.captureUnavailableReason ?? 'grader returned no consensus'}); enforce mode requires an authoritative contract (independent-capture) or a human-confirmed one — fix intent.provider/model or route to human-confirmed`
        };
      } else {
        // advisory：允许模型自报，但 origin 必须如实标注
        origin = 'model-self-declared';
      }
    } else if (this.config.intent.contractOrigin === 'human-confirmed') {
      if (this.config.askUser) {
        origin = 'human-confirmed';
      } else if (this.config.mode === 'enforce') {
        return {
          ok: false,
          reason:
            'contract origin human-confirmed requires an askUser confirmation channel, but none is mounted; enforce mode cannot mint an authoritative contract — mount a confirmation channel or switch to independent-capture'
        };
      } else {
        origin = 'model-self-declared';
      }
    } else {
      origin = 'model-self-declared';
    }

    const contract = mintContract({
      sessionId: agent.session.id,
      origin,
      ...body,
      basis
    });
    const valid = TaskContractSchema.safeParse(contract);
    if (!valid.success) {
      return { ok: false, reason: `invalid contract: ${errorMessage(valid.error)}` };
    }

    // human-confirmed 路径：questionId 一次性 challenge；approve 回执后立即冻结
    if (this.config.intent.contractOrigin === 'human-confirmed' && this.config.askUser) {
      const questionId = `verification-contract-${Math.random().toString(36).slice(2, 10)}`;
      this.commit(agent, { kind: 'challenge', questionId, challengeKind: 'contract', identity: contractIdentityOf(valid.data), consumed: false, authorityScope: this.requireCurrentAuthorityScope(agent) });
      const answer = await this.config.askUser?.({
        agent,
        questionId,
        text: renderContractForHuman(valid.data),
        choices: ['approve', 'decline']
      });
      if (answer !== 'approve') {
        this.commit(agent, { kind: 'challenge', questionId, challengeKind: 'contract', identity: contractIdentityOf(valid.data), consumed: true, authorityScope: this.requireCurrentAuthorityScope(agent) });
        return { ok: false, reason: 'contract declined by user; retry after adjusting the plan' };
      }
      this.commit(agent, { kind: 'challenge', questionId, challengeKind: 'contract', identity: contractIdentityOf(valid.data), consumed: true, authorityScope: this.requireCurrentAuthorityScope(agent) });
      this.commit(agent, { kind: 'plan', contract: valid.data, authorityScope: this.requireCurrentAuthorityScope(agent), frozenAt: { callId: 'human-confirmed', at: this.clock() } });
      return { ok: true, contract: valid.data };
    }

    this.commit(agent, { kind: 'plan', contract: valid.data, authorityScope: this.requireCurrentAuthorityScope(agent) });
    return { ok: true, contract: valid.data };
  }

  private async tryIndependentCapture(
    agent: Agent,
    basis: BasisRuntimeEntry[],
    intentSpec?: Array<{ id: string; tool?: string; args?: Record<string, unknown> }>
  ): Promise<{ goal: string; acceptanceCriteria: AcceptanceCriterion[]; constraints: Constraint[]; inputs: string[]; outOfScope: string[] } | null> {
    const llm = this.ctx.get('llm');
    if (!llm) {
      this.captureUnavailableReason = 'llm service not mounted';
      return null;
    }
    const provider = this.config.intent.provider ?? llm.listProviders()[0]?.id;
    if (!provider) {
      this.captureUnavailableReason = 'no llm provider configured';
      return null;
    }
    const model = this.config.intent.model ?? (await llm.listModels(provider))[0]?.id;
    if (!model) {
      this.captureUnavailableReason = `no configured model for provider ${provider}`;
      return null;
    }
    if (basis.length === 0) {
      this.captureUnavailableReason = 'sourceBasis empty (no authoritative user message yet)';
      return null;
    }
    // solver 提案的 AC 表（id + 建议 witness 工具）：只要求 grader 保留 id 以保持证据绑定稳定；
    // 内容（goal/desc/intent）仍完全来自 sourceBasis —— id 是机制，不是语义。
    const specHint =
      intentSpec && intentSpec.length > 0
        ? [
            '',
            '[witness-id binding only, not semantics] Executing agent intends these AC ids (KEEP each id EXACTLY; you may reword desc / adjust oracleHint / add constraints):',
            ...intentSpec.map((s) => `- ${s.id}${s.tool !== undefined ? ` (proposed witness tool: ${s.tool})` : ''}`)
          ].join('\n')
        : '';
    const prompt = basis.map((entry) => `[${entry.kind} @seq${entry.seq}] ${entry.text}`).join('\n\n') + specHint;
    const generate = async () => {
      const result = await completeText(this.ctx, {
        provider,
        model,
        system: GRADER_INTENT_SYSTEM_PROMPT,
        messages: [
          { role: 'user', text: prompt },
          { role: 'user', text: 'Return ONLY the final contract JSON object, starting with { and ending with }. No prose before or after it.' }
        ],
        temperature: 0,
        maxTokens: 8192
      });
      // S1-2 真机修复：本地模型（responses + reasoning=max）常把"思考"喷进 text 流，
      // JSON 反而在 reasoning 流。候选 = text+reasoning 合并，交给 lenient 提取器。
      const candidate = [result.text, result.reasoning].filter(Boolean).join('\n');
      return { content: candidate, reasoningContent: result.reasoning, rawSample: `${result.text} ${result.reasoning ?? ''}`.trim() };
    };
    const count = Math.max(1, this.config.intent.consensusCount);
    const candidates: Array<{ content: string; reasoningContent?: string; rawSample?: string }> = [];
    try {
      for (let i = 0; i < count; i += 1) {
        candidates.push(await generate());
      }
    } catch (error) {
      this.captureUnavailableReason = `grader generation failed: ${errorMessage(error)}`;
      return null;
    }
    let consensus;
    const firstRawSample = candidates[0]?.rawSample;
    try {
      consensus = await runStructuredConsensus({
        consensusCount: candidates.length,
        generate: async () => candidates.shift()!,
        parse: (content) => {
          // 抽取所有完整 JSON 对象，逐个按契约 body schema 验证（本地模型常输出多份草稿）。
          const parsedList = extractJsonCandidates(content);
          if (parsedList.length === 0) {
            throw new GraderParseError('no complete JSON object found in grader output', content.slice(0, 400));
          }
          for (const parsed of parsedList) {
            const normalized = normalizeGraderBody(parsed);
            const valid = GraderBodySchema.safeParse(normalized);
            if (valid.success) {
              return valid.data;
            }
          }
          throw new Error(`no grader JSON candidate matched the contract schema (checked ${parsedList.length} candidate(s))`);
        }
      });
    } catch (error) {
      this.captureUnavailableReason = `grader consensus threw: ${errorMessage(error)}`;
      return null;
    }
    if (consensus.kind !== 'success') {
      // 失败消息里带上初次原始样本，便于真机诊断/agent 自我恢复
      const sample = firstRawSample?.trim().slice(0, 600) ?? '';
      this.captureUnavailableReason = `grader consensus failed: ${consensus.kind}${sample ? ` (raw sample: ${JSON.stringify(sample)})` : ''}`;
      return null;
    }
    return {
      goal: consensus.value.goal,
      acceptanceCriteria: consensus.value.acceptanceCriteria,
      constraints: consensus.value.constraints,
      inputs: consensus.value.inputs,
      outOfScope: consensus.value.outOfScope
    };
  }

  freezePlan(agent: Agent, callId: string): void {
    const view = this.getPlanView(agent);
    if (!view || view.frozenAt) {
      return;
    }
    this.commit(agent, { kind: 'plan', contract: view.contract, authorityScope: this.requireCurrentAuthorityScope(agent), frozenAt: { callId, at: this.clock() } });
  }

  /** reset_verification_plan：同一 epoch 内 re-basis（新 contractId + revision 0），不关闭任务。 */
  resetPlan(agent: Agent): TaskContract | null {
    const current = this.getContract(agent);
    if (!current) {
      return null;
    }
    const rebased = rebaseContract(current);
    this.commit(agent, { kind: 'plan', contract: rebased, authorityScope: this.requireCurrentAuthorityScope(agent) });
    return rebased;
  }

  /** advisory 观测：evaluation_error 也落 gate 摘要（never-throw 语义在调用方）。 */
  commitGateError(agent: Agent, error: unknown): void {
    this.commit(agent, {
      kind: 'gate',
      entry: {
        at: this.clock(),
        status: 'failed',
        mode: this.config.mode,
        reasons: [`evaluation_error: ${errorMessage(error)}`],
        authorityScope: this.requireCurrentAuthorityScope(agent)
      }
    });
  }

  // ── capture ────────────────────────────────────────────────

  async captureEvidence(agent: Agent, record: ToolRecord, resultSeq: number): Promise<void> {
    // S3-4 双保险：入口幂等标记（生产由 post-execute 钩子先行标记；这里兜底防 commit 前 sync/reconcile 误报）。
    this.markToolCallHandled(agent, record.callId);
    const contract = this.getContract(agent);
    if (!contract) {
      return; // 无契约 identity → unbound telemetry，不触发 capture failure
    }
    const identity = contractIdentityOf(contract);
    const policyFacts = policyFactsFor(record);
    const captured = deriveCaptured(record, { contractIdentity: identity });
    if (!captured) {
      // 无证据形态但携带网络/路径事实的调用（如本地模型渲染的 web_* 工具）：
      // 落一条 policy-facts-only capture-failure，禁止网络/路径禁令因"没有证据"而 fail-open。
      if (policyFacts.networkCalls.length > 0 || policyFacts.paths.length > 0) {
        this.recordCaptureFailure(agent, {
          contractIdentity: identity,
          callId: record.callId,
          toolIdentity: record.name,
          normalizedArgsHash: record.arguments ? normalizedArgsHash(record.arguments) : '',
          evidenceType: isNetworkLikeTool(record.name) ? 'quote_with_location' : 'command_output',
          resultSeq,
          error: 'policy-facts-only: tool produced no capturable evidence shape; recording durable policy facts',
          authorityScope: this.requireCurrentAuthorityScope(agent),
          policyFacts
        });
      }
      return;
    }
    const projection = this.getProjection(agent);
    const sameContract = projection.evidenceRefs.filter((ref) =>
      ref.contractIdentity.contractId === identity.contractId &&
      ref.contractIdentity.revision === identity.revision &&
      ref.contractIdentity.contractContentHash === identity.contractContentHash &&
      ref.contractIdentity.basisHash === identity.basisHash &&
      ref.contractIdentity.sessionId === identity.sessionId
    );
    if (sameContract.length >= this.config.maxCapturedEvidence) {
      this.recordCaptureFailure(agent, {
        contractIdentity: identity,
        callId: record.callId,
        toolIdentity: record.name,
        normalizedArgsHash: captured.normalizedArgsHash,
        evidenceType: captured.evidenceType,
        resultSeq,
        error: `maxCapturedEvidence ${this.config.maxCapturedEvidence} exceeded`
        ,authorityScope: this.requireCurrentAuthorityScope(agent), policyFacts
      });
      return;
    }
    const estimated = new TextEncoder().encode(JSON.stringify(captured)).byteLength;
    const capturedBytes = sameContract.reduce((total, ref) => total + ref.originalLength, 0);
    if (capturedBytes + estimated > this.config.maxCapturedBytes) {
      this.recordCaptureFailure(agent, {
        contractIdentity: identity,
        callId: record.callId,
        toolIdentity: record.name,
        normalizedArgsHash: captured.normalizedArgsHash,
        evidenceType: captured.evidenceType,
        resultSeq,
        error: `maxCapturedBytes ${this.config.maxCapturedBytes} exceeded (captured ${capturedBytes} + next ${estimated})`
        ,authorityScope: this.requireCurrentAuthorityScope(agent), policyFacts
      });
      return;
    }

    try {
      const stored = await storePayload(this.store, captured);
      this.commit(agent, {
        kind: 'evidence',
        callId: record.callId,
        toolIdentity: record.name,
        normalizedArgsHash: captured.normalizedArgsHash,
        blobHash: stored.blobKey,
        originalLength: stored.originalLength,
        rawHash: stored.rawHash,
        truncated: stored.truncated,
        completeness: stored.completeness,
        schemaVersion: 1,
        contractIdentity: identity,
        evidenceType: captured.evidenceType,
        resultSeq,
        summary: textSummary(captured),
        authorityScope: this.requireCurrentAuthorityScope(agent),
        policyFacts
      });
    } catch (error) {
      this.recordCaptureFailure(agent, {
        contractIdentity: identity,
        callId: record.callId,
        toolIdentity: record.name,
        normalizedArgsHash: captured.normalizedArgsHash,
        evidenceType: captured.evidenceType,
        resultSeq,
        error: errorMessage(error),
        authorityScope: this.requireCurrentAuthorityScope(agent),
        policyFacts
      });
    }
  }

  recordCaptureFailure(agent: Agent, failure: {
    contractIdentity: ContractIdentity;
    callId: string;
    toolIdentity: string;
    normalizedArgsHash: string;
    evidenceType: EvidenceType;
    resultSeq: number;
    error: string;
    authorityScope: AuthorityScope;
    policyFacts: PolicyFacts;
  }): void {
    this.commit(agent, { kind: 'capture-failure', ...failure });
  }

  // ── gate / permit ──────────────────────────────────────────

  async evaluateGate(agent: Agent): Promise<{ gate: GateResult; snapshotHash: string; bindings: Map<string, BoundOutcome> }> {
    const contract = this.getContract(agent);
    if (!contract) {
      throw new VerificationError('missing_contract', 'VERIFICATION_MISSING_CONTRACT');
    }
    const identity = contractIdentityOf(contract);
    const scope = this.requireCurrentAuthorityScope(agent);
    const projection = this.getProjection(agent);
    const sameScope = (candidate: AuthorityScope | undefined) => candidate !== undefined && candidate.epochId === scope.epochId && candidate.rootGoalId === scope.rootGoalId && candidate.ownerAgentId === scope.ownerAgentId;
    const sameIdentity = (candidate: ContractIdentity) => identitiesEqual(candidate, identity);
    const scopedProjection: VerificationProjection = {
      ...projection,
      evidenceRefs: projection.evidenceRefs.filter((ref) => sameScope(ref.authorityScope) && sameIdentity(ref.contractIdentity)),
      captureFailures: projection.captureFailures.filter((failure) => sameScope(failure.authorityScope) && sameIdentity(failure.contractIdentity)),
      verdicts: projection.verdictAuthorityScope && sameScope(projection.verdictAuthorityScope) ? projection.verdicts : {}
    };

    const bindings = new Map<string, BoundOutcome>();
    const boundMap = new Map<string, BoundEvidence>();
    for (const ac of contract.acceptanceCriteria) {
      const outcome = await bindSelectorForAc(ac, {
        contractIdentity: identity,
        refs: scopedProjection.evidenceRefs,
        captureFailures: scopedProjection.captureFailures,
        loadBlob: async (key) => this.store.read(key)
      }, (ac2) => hintToEvidenceType(ac2.oracleHint));
      bindings.set(ac.id, outcome);
      if (outcome.kind === 'bound') {
        boundMap.set(ac.id, outcome.evidence);
      }
    }

    const verdicts = new Map<string, Verdict>();
    for (const ac of contract.acceptanceCriteria) {
      verdicts.set(ac.id, await this.judgeAc(agent, contract, ac, boundMap.get(ac.id), bindings.get(ac.id)));
    }

    // 2026-08-17（完成任务能力修复）：file 族 AC 精确绑定裁决失败 → 族内兜底重判。
    // 真实案例：ac-research 冻结 glob selector 的匹配调用返回空（"No files found"），
    // 而 write→file_diff 真实交付证据存在却不被 exact 绑定考虑 → 假阴性。
    // 兜底：exact 裁决 fail 时，用 bindSelectorForAc(familyFallback) 重绑族内真实文件证据重判；
    // 重判 pass → 采用（detail 注明 family evidence fallback，可审计）；仍 fail → 保留原裁决。
    if (this.config.binderFamilyFallback !== false) {
      for (const ac of contract.acceptanceCriteria) {
        const v0 = verdicts.get(ac.id);
        if (!v0 || v0.result !== 'fail' || !isFileFamilyAc(ac)) {
          continue;
        }
        const fb = await bindSelectorForAc(
          ac,
          {
            contractIdentity: identity,
            refs: scopedProjection.evidenceRefs,
            captureFailures: scopedProjection.captureFailures,
            loadBlob: async (key) => this.store.read(key)
          },
          (ac2) => hintToEvidenceType(ac2.oracleHint),
          { familyFallback: true }
        );
        if (fb.kind === 'bound' && fb.familyFallback) {
          const v1 = await this.judgeAc(agent, contract, ac, fb.evidence, fb);
          if (v1.result === 'pass') {
            v1.detail = `${v1.detail ?? ''}（family evidence fallback: exact selector ${ac.selector?.toolIdentity ?? ''} 无有效证据，改用族内真实文件证据 ${fb.evidence.toolIdentity}→${fb.evidence.evidenceType} seq${fb.resultSeq}）`.trim();
            verdicts.set(ac.id, v1);
          }
        }
      }
    }

    // 约束执行上下文 = 实时派生的路径/网络事实 ∪ 持久化 policyFacts（blob 写入失败等场景也 fail closed）。
    const policyPaths: string[] = [];
    const policyNetwork: string[] = [];
    for (const failure of scopedProjection.captureFailures) {
      policyPaths.push(...(failure.policyFacts?.paths ?? []));
      policyNetwork.push(...(failure.policyFacts?.networkCalls ?? []));
    }
    for (const ref of scopedProjection.evidenceRefs) {
      policyPaths.push(...(ref.policyFacts?.paths ?? []));
      policyNetwork.push(...(ref.policyFacts?.networkCalls ?? []));
    }
    const execCtx: ExecContext = {
      touchedPaths: [...this.inferredPaths(scopedProjection), ...policyPaths],
      networkCalls: [...this.networkCallsOf(agent), ...policyNetwork]
    };
    // S2-2 修复：部署级 globalConstraints 与契约 constraints 一并执行（此前 global 永不生效，fail-open）
    const constraintResults = enforceConstraints([...this.config.globalConstraints, ...contract.constraints], execCtx, DEFAULT_CHECKERS);
    const gate = new CompletionGate().evaluate(contract, verdicts, constraintResults);

    this.commit(agent, { kind: 'verdicts', verdicts: Object.fromEntries(verdicts), authorityScope: this.requireCurrentAuthorityScope(agent) });
    this.commit(agent, {
      kind: 'gate',
      entry: { at: this.clock(), status: gate.status, mode: this.config.mode, reasons: gate.reasons, authorityScope: this.requireCurrentAuthorityScope(agent) }
    });

    return { gate, snapshotHash: this.currentSnapshotHash(agent), bindings };
  }

  private async judgeAc(agent: Agent, contract: TaskContract, ac: AcceptanceCriterion, bound: BoundEvidence | undefined, outcome: BoundOutcome | undefined): Promise<Verdict> {
    const identity = contractIdentityOf(contract);
    if (!bound) {
      const reason =
        outcome && outcome.kind !== 'not-harnessed'
          ? (outcome as Extract<BoundOutcome, { kind: 'capture-failure' | 'missing-blob' | 'no-evidence' }>).reason
          : `AC ${ac.id} has no bound evidence (no exact selector match)`;
      return { claimId: ac.id, acId: ac.id, result: 'fail', oracleTier: 'T3', contractIdentity: identity, detail: reason };
    }
    if (ac.oracleHint === 'human') {
      return { claimId: bound.callId, acId: ac.id, result: 'need_human', oracleTier: 'T4', contractIdentity: identity, detail: 'AC requires human confirmation' };
    }
    const engine = new VerificationEngine(this.oracleList(agent));
    try {
      return await engine.verify(ac, [bound], identity);
    } catch (error) {
      return { claimId: bound.callId, acId: ac.id, result: 'fail', oracleTier: 'T3', contractIdentity: identity, detail: `no oracle can judge AC ${ac.id}: ${errorMessage(error)}` };
    }
  }

  private oracleList(agent: Agent): Oracle[] {
    const oracles: Oracle[] = [];
    if (this.config.enableDeterministic) {
      oracles.push(new TestRunOracle(), new CommandExitOracle(), new FileExistsOracle(), new FileDiffOracle(), new SchemaValidOracle());
    }
    if (this.config.enableCoverage) {
      oracles.push(new CoverageOracle());
    }
    if (this.config.enableProReview) {
      oracles.push(
        new ProReviewOracle(
          createSubagentProReviewRunner(this.ctx, { provider: this.config.proReviewProvider, agent })
        )
      );
    }
    if (this.config.enableAssistantResponse) {
      oracles.push(new AssistantResponseOracle());
    }
    return oracles;
  }

  private inferredPaths(projection: VerificationProjection): string[] {
    return [...new Set([
      ...projection.evidenceRefs.flatMap((ref) => ref.policyFacts?.paths ?? []),
      ...projection.captureFailures.flatMap((failure) => failure.policyFacts?.paths ?? [])
    ])];
  }

  /**
   * S2-2/S3-1：network 型工具调用，**从 durable `tool/call` 事件重建**（非内存瞬态）——
   * 服务重启/插件缺席期后从会话日志重放得到，`network:` 禁令不回退 fail-open。
   */
  private networkCallsOf(agent: Agent): string[] {
    const contract = this.getContract(agent);
    if (!contract) return [];
    const identity = contractIdentityOf(contract);
    const scope = this.requireCurrentAuthorityScope(agent);
    const same = (candidate: AuthorityScope | undefined, candidateIdentity: ContractIdentity) =>
      candidate !== undefined && candidate.epochId === scope.epochId && candidate.rootGoalId === scope.rootGoalId && candidate.ownerAgentId === scope.ownerAgentId && identitiesEqual(candidateIdentity, identity);
    const projection = this.getProjection(agent);
    return [...new Set([
      ...projection.evidenceRefs.filter((ref) => same(ref.authorityScope, ref.contractIdentity)).flatMap((ref) => ref.policyFacts?.networkCalls ?? []),
      ...projection.captureFailures.filter((failure) => same(failure.authorityScope, failure.contractIdentity)).flatMap((failure) => failure.policyFacts?.networkCalls ?? [])
    ])];
  }

  /**
   * S3-4 对账（§4.4）：契约存在后，每个"可采集"durable `tool/call` 必须对应
   * 一条 evidenceRef 或 captureFailure（当前 identity）；缺口落 **durable capture-failure**
   *（不在内存里静默）：这是崩溃/插件缺席/重放场景的 fail-closed 底座。幂等 + 重入有界。
   */
  private reconcileDurableCalls(agent: Agent, cache: AgentCache): void {
    if (this.reconciling || cache.reconciledSeq >= agent.session.seq) {
      return;
    }
    const contract = cache.projection.plan?.contract;
    if (!contract) {
      cache.reconciledSeq = agent.session.seq;
      return;
    }
    const identity = contractIdentityOf(contract);
    this.reconciling = true;
    try {
      for (const [callId, call] of cache.calls) {
        if (call.seq <= cache.contractPlanSeq) {
          continue; // 契约 mint 之前的调用属 unbound telemetry，不对账
        }
        if (cache.projection.evidenceRefs.some((ref) => ref.contractIdentity.contractId === identity.contractId && ref.callId === callId)) {
          continue;
        }
        if (cache.projection.captureFailures.some((f) => f.contractIdentity.contractId === identity.contractId && f.callId === callId)) {
          continue;
        }
        // "可采集"判定：deriveCaptured 非 null（控制面/未知工具不算缺口）；本进程已处理的不误报。
        if (this.handledCallsBySession.get(agent.session)?.has(callId)) {
          continue;
        }
        const record: ToolRecord = { callId, name: call.name, arguments: call.args, isError: false };
        const captured = deriveCaptured(record, { contractIdentity: identity });
        if (!captured) {
          continue;
        }
        this.recordCaptureFailure(agent, {
          contractIdentity: identity,
          callId,
          toolIdentity: call.name,
          normalizedArgsHash: captured.normalizedArgsHash,
          evidenceType: captured.evidenceType,
          resultSeq: call.seq,
          error: `reconcile: durable tool/call ${callId} has no captured evidence or capture-failure`,
          authorityScope: this.requireCurrentAuthorityScope(agent),
          policyFacts: policyFactsFor({ callId, name: call.name, arguments: call.args, isError: false })
        });
        // commit 已递归刷新 cache.projection（reconciling 防重入；下一轮检查即看到新 failure）
      }
    } finally {
      this.reconciling = false;
      cache.reconciledSeq = agent.session.seq;
    }
  }

  private currentSnapshotHash(agent: Agent): string {
    const contract = this.getContract(agent);
    const projection = this.getProjection(agent);
    const scope = this.requireCurrentAuthorityScope(agent);
    const identity = contract ? contractIdentityOf(contract) : null;
    const refs = projection.evidenceRefs.filter((ref) => identity && identitiesEqual(ref.contractIdentity, identity) && ref.authorityScope !== undefined && ref.authorityScope.epochId === scope.epochId && ref.authorityScope.rootGoalId === scope.rootGoalId && ref.authorityScope.ownerAgentId === scope.ownerAgentId);
    const failures = projection.captureFailures.filter((failure) => identity && identitiesEqual(failure.contractIdentity, identity) && failure.authorityScope !== undefined && failure.authorityScope.epochId === scope.epochId && failure.authorityScope.rootGoalId === scope.rootGoalId && failure.authorityScope.ownerAgentId === scope.ownerAgentId);
    return computeGateSnapshotHash({
      contractIdentity: identity ?? { contractId: '', revision: 0, contractContentHash: '', basisHash: '', sessionId: agent.session.id },
      verdicts: projection.verdictAuthorityScope && projection.verdictAuthorityScope.epochId === scope.epochId && projection.verdictAuthorityScope.rootGoalId === scope.rootGoalId && projection.verdictAuthorityScope.ownerAgentId === scope.ownerAgentId ? projection.verdicts : {},
      evidenceBlobHashes: refs.map((ref) => ref.blobHash),
      captureFailures: failures.length,
      configHash: this.config.configHash,
      schemaVersion: 1
    });
  }

  /** 异步 prepare：gate done + goal ref 有效才落 durable permit。 */
  async prepareGoalCompletion(agent: Agent, goalId: string, goalRevision: number): Promise<void> {
    const scope = this.requireCurrentAuthorityScope(agent);
    if (scope.rootGoalId !== goalId) {
      throw new VerificationError('missing_root_goal: completion target is not the active root goal', 'VERIFICATION_MISSING_ROOT_GOAL');
    }
    this.requireGoalBoundEpoch(agent, goalId, goalRevision);
    const { gate } = await this.evaluateGate(agent);
    if (gate.status !== 'done') {
      return;
    }
    const snapshot = currentGoalSnapshot(agent.session.events, goalId);
    const contract = this.getContract(agent);
    if (!snapshot || snapshot.revision !== goalRevision || !contract) {
      return;
    }
    this.commit(agent, {
      kind: 'permit',
      permitRef: newPermitRef(),
      goalId,
      goalRevision,
      contractIdentity: contractIdentityOf(contract),
      gateSnapshotHash: this.currentSnapshotHash(agent),
      configHash: this.config.configHash,
      ttlMs: this.config.completionPermitTtlMs,
      authorityScope: this.requireCurrentAuthorityScope(agent)
    });
  }

  /** 同步 guard（GoalTransitionGuard seam 调用点）：零 mutation，先校验后放行。 */
  assertCompletionPermit(agent: Agent, goalId: string, goalRevision: number): PermitValidation {
    let scope: AuthorityScope;
    try {
      scope = this.requireCurrentAuthorityScope(agent);
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
    if (scope.rootGoalId !== goalId) {
      return { ok: false, reason: 'permit authority scope root goal mismatch' };
    }
    const contract = this.getContract(agent);
    if (!contract) {
      return { ok: false, reason: 'no contract committed' };
    }
    const identity = contractIdentityOf(contract);
    const permits: PermitLogEntry[] = [];
    for (const event of this.allEvents(agent)) {
      if (event.type === 'verification/change') {
        const data = event.data as { record?: { kind?: string; permitRef?: string; goalId?: string; goalRevision?: number } };
        if (data?.record?.kind === 'permit') {
          permits.push({
            record: data.record as import('./projection').CompletionPermitRecord,
            seq: event.seq,
            time: event.time
          });
        }
      }
    }
    // This is the live pre-commit path, not replay: choose a permit for the
    // current uncommitted transition, then persist that exact ref in dsh-goal.
    // Replay later validates the persisted ref without consulting wall clock.
    const matching = permits
      .filter((entry) => entry.record.goalId === goalId && entry.record.goalRevision === goalRevision && entry.record.authorityScope !== undefined && entry.record.authorityScope.epochId === scope.epochId && entry.record.authorityScope.rootGoalId === scope.rootGoalId && entry.record.authorityScope.ownerAgentId === scope.ownerAgentId)
      .sort((a, b) => b.seq - a.seq);
    const selected = matching[0];
    return validatePermitForCompletion({
      completed: { goalId, goalRevision, permitRef: selected?.record.permitRef ?? '', completeSeq: agent.session.seq, completeTime: Date.now() },
      permits,
      policies: {
        [this.config.configHash]: { configHash: this.config.configHash, completionPermitTtlMs: this.config.completionPermitTtlMs, schemaVersion: 1 }
      },
      contractIdentity: identity,
      gateSnapshotHash: this.currentSnapshotHash(agent)
    });
  }

  // ── commit ─────────────────────────────────────────────────

  /** S3-4：标记一次工具调用已被本进程（post-execute）处理——对账对其免于"缺口"误报。 */
  markToolCallHandled(agent: Agent, callId: string): void {
    let set = this.handledCallsBySession.get(agent.session);
    if (!set) {
      set = new Set();
      this.handledCallsBySession.set(agent.session, set);
    }
    set.add(callId);
  }

  private commit(agent: Agent, record: VerificationRecord): void {
    const cache = this.cache(agent);
    // session.seq 是"下一个事件的 seq"（append 后增长），因此计划自身的事件 seq = append 前快照。
    const beforeSeq = agent.session.seq;
    const meta = { kind: 'verification/change', version: 1, record: stripUndefined(record) } as unknown as import('./projection').VerificationChangeEventData;
    agent.session.append('verification/change', meta);
    cache.projection = applyVerificationRecord(cache.projection, meta.record, { seq: beforeSeq, time: this.clock() });
    cache.observedSeq = agent.session.seq;
    // S3-4 权威基线：计划一落 durable，以其事件 seq 为对账起点（只对之后的可采集调用对账）。
    if (record.kind === 'plan') {
      cache.contractPlanSeq = beforeSeq;
    }
    // 无 @deepseek-ai/dsh-agent 运行时依赖：经 cordis 事件直接发布（agent 域事件由 dsh-scope 载体转发）
    try {
      this.ctx.emit?.('verification/changed', { agent, change: { operation: 'change', projection: cache.projection } });
    } catch {
      /* 观测失败不阻断提交 */
    }
  }
}

function renderContractForHuman(contract: TaskContract): string {
  return JSON.stringify(
    {
      goal: contract.goal,
      acceptanceCriteria: contract.acceptanceCriteria,
      constraints: contract.constraints,
      outOfScope: contract.outOfScope
    },
    null,
    2
  );
}

export default VerificationService;
