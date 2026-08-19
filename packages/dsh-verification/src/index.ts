import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { stableHash } from '@bpc-oss/dsh-evidence';
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session';

// 注册本插件写入的事件类型：dsh-session 0.1.0-rc.6 的 KNOWN_SESSION_EVENT_TYPES
// 不含 'verification/change' 且 Session.append() 无 ignorable 选项；不注册则任何
// 含该事件的会话在加载时都会被 assertEventsSupported 拒绝
// （SessionFormatUnsupportedError: unknown event type）。
// 类型声明为 ReadonlySet，但运行时是可变 Set（dsh-session 的会话事件类型注册表）。
(KNOWN_SESSION_EVENT_TYPES as Set<string>).add('verification/change');

import './augmentations';

import { installCompleteGateHook } from './complete-gate-hook';
import { installEvidenceCapture } from './evidence-capture';
import { installGoalTransitionGuard } from './goal-guard';
import { installIntentTools } from './intent';
import { installProReviewTool } from './pro-review-tool';
import { buildVerificationGuidance } from './prompts';
import { VerificationService } from './service';
import { createFileBlobStore, createMemoryBlobStore } from './evidence-store';
import { emptyVerificationProjection, VerificationProjectionSchema, foldVerificationRecords, taskEpochViews, type VerificationProjection } from './projection';
import { applyEpochEvent, emptyIncrementalEpochState, type IncrementalEpochState } from './task-epoch';

export * from './projection';
export { VerificationService, VerificationError, type VerificationRuntimeConfig, type ServiceDeps } from './service';
export { VerificationEngine } from './engine';
export { CompletionGate } from './gate';
export type { Oracle, VerdictBody } from './oracle';
export { stampVerdict, tierRank } from './oracle';
export { enforceConstraints, DEFAULT_CHECKERS, NoForbiddenPathChecker, NoNetworkChecker, isMachineCheckableConstraintCheck, type ConstraintChecker, type ConstraintResult, type ExecContext } from './constraints';
export { ConstraintsLibrary } from './constraint-library';
export { mintContract, rebaseContract, collectBasisEntries, materializeBasis, basisPromptText, createContractChallenge, type AcProposal, type PlanProposal, type BasisRuntimeEntry } from './contract-authority';
export { foldTaskEpochs, currentActiveEpoch, applyEpochEvent, type FoldedEpoch } from './task-epoch';
export { validatePermitForCompletion, computeGateSnapshotHash, newPermitRef, type PermitLogEntry, type PermitValidation, type FrozenPermitPolicy, type CompletedGoalFacts } from './permits';
export { createMemoryBlobStore, createFileBlobStore, storePayload, type BlobStore, type StoredPayload } from './evidence-store';
export { bindSelectorForAc, findDuplicateSelectors, type BindingContext, type BoundOutcome } from './binders';
export { installCompleteGateHook, renderDefects, BOOTSTRAP_WHITELIST, type GateHookConfig } from './complete-gate-hook';
export { installEvidenceCapture } from './evidence-capture';
export { installIntentTools } from './intent';
export { installProReviewTool } from './pro-review-tool';
export { installGoalTransitionGuard, type GoalTransitionGuardRequest, type GoalTransitionGuardVerdict, type GoalTransitionGuard } from './goal-guard';
export { ProReviewOracle, buildReviewPrompt, stripSelfNarration, PROHIBITED_PAYLOAD_FIELDS, type ProReviewInput, type ProReviewRunner, type ReviewDefect, type ReviewOutput } from './oracles/pro-review';
export { createSubagentProReviewRunner, providerHasAuthorityIsolation, type ProReviewRunnerOptions } from './pro-review-runner';
export { CommandExitOracle, FileExistsOracle, FileDiffOracle } from './oracles/deterministic';
export { TestRunOracle, SchemaValidOracle, CoverageOracle } from './oracles/run-based';
export { AssistantResponseOracle } from './oracles/assistant-response';
export { INTENT_SYSTEM_PROMPT, PRO_REVIEW_SYSTEM_PROMPT, GRADER_INTENT_SYSTEM_PROMPT, buildVerificationGuidance } from './prompts';
export { runStructuredConsensus, type ConsensusGeneration, type StructuredConsensusResult } from './intent-consensus';
export { completeText, assembleStream, type CompleteTextOptions, type CompleteTextResult, type CompletionMessage } from './llm/call';

export const name = 'verification';

export const inject = ['agents', 'tools', 'systemPrompt'];

/**
 * 只读工具（评审定位修正）：DSH 真实工具名，永不拦截。
 * 2026-08-15（P0-1 review）：旧表用的是 Bobby/Codex 工具名（read_file/list_dir/search），
 * 与 DSH 实际工具面（read/grep/glob/...）对不上，enforce 下 `read` 会以 missing_contract 误拒。
 * 语义已反转（见 DEFAULT_WRITE_TOOLS 注释）：只读工具不在此表也默认放行，此表仅作显式打磨。
 */
export const DEFAULT_READ_ONLY_TOOLS = [
  'read',
  'glob',
  'grep',
  'read_page',
  'read_image',
  'web_search',
  'x_search',
  'get_goal',
  'get_verification_plan',
  'ask_user_question',
  'ask_user',
  'list_dir',
  'search'
];

/**
 * 明确写入类工具（评审定位修正）：只有这些工具在 enforce + requireContractBeforeExecution
 * 且无契约时才被 missing_contract 拒绝。其余（只读 + 未识别/未知/MCP/dsh 未来新增）默认放行——
 * 验证系统是"可观测增强层"，不是"所有工具的默认 gate"。
 */
export const DEFAULT_WRITE_TOOLS = [
  'edit',
  'write',
  'write_file',
  'unlink',
  'rename',
  'mkdir',
  'rm',
  'mv',
  'cp',
  'apply_patch',
  'patch',
  'replace',
  'shell',
  'bash',
  'pwsh',
  'powershell',
  'exec',
  'terminal',
  'send_message',
  'todo_write'
];

/** 插件配置（P0-1 review：默认 advisory——可选插件，opt-in 才 enforce）。 */
export const Config: z<VerificationConfig> = z.object({
  mode: z.union([z.const('enforce'), z.const('advisory')]).default('advisory'),
  maxCapturedEvidence: z.number().min(1).default(200),
  maxCapturedBytes: z.number().min(1).default(20 * 1024 * 1024),
  completionPermitTtlMs: z.number().min(1000).max(300_000).default(30_000),
  oracles: z.object({
    deterministic: z.boolean().default(true),
    assistantResponse: z.boolean().default(true),
    coverage: z.object({ enabled: z.boolean().default(true) }),
    proReview: z
      .object({
        // v9：authorityIsolation upstream seam 前默认关闭
        enabled: z.boolean().default(false),
        provider: z.string().default('spawn'),
        maxDefects: z.number().min(1).default(10)
      })
      .default({ enabled: false, provider: 'spawn', maxDefects: 10 })
  }),
  constraints: z.array(z.object({ id: z.string(), desc: z.string(), check: z.string() })),
  intent: z.object({
    requireContractBeforeExecution: z.boolean(),
    contractOrigin: z.union([z.const('independent-capture'), z.const('human-confirmed')]).default('independent-capture'),
    freezeOnHumanConfirm: z.boolean().default(true),
    consensusCount: z.number().min(0).max(3).default(1),
    provider: z.string(),
    model: z.string(),
    readOnlyToolAllowlist: z.array(z.string()).default(DEFAULT_READ_ONLY_TOOLS),
    sourceBasis: z.object({
      includeAttachments: z.boolean().default(true),
      includeControlDocs: z.boolean().default(true),
      maxEntries: z.number().min(1).default(200)
    })
  }),
  blobDir: z.string(),
  systemPromptSection: z.boolean().default(true),
  // 2026-08-17（完成任务能力修复）：file 族 AC 精确绑定失败时启用族内证据兜底，减少假阴性。默认开启；安全严格场景可关。
  binderFamilyFallback: z.boolean().default(true)
});

export interface VerificationConfig {
  mode: 'enforce' | 'advisory';
  maxCapturedEvidence: number;
  maxCapturedBytes: number;
  completionPermitTtlMs: number;
  oracles: {
    deterministic: boolean;
    assistantResponse: boolean;
    coverage: { enabled: boolean };
    proReview: { enabled: boolean; provider: string; maxDefects: number };
  };
  constraints: Array<{ id: string; desc: string; check: string }>;
  intent: {
    requireContractBeforeExecution?: boolean;
    contractOrigin: 'independent-capture' | 'human-confirmed';
    freezeOnHumanConfirm: boolean;
    consensusCount: number;
    provider?: string;
    model?: string;
    readOnlyToolAllowlist: string[];
    sourceBasis: { includeAttachments: boolean; includeControlDocs: boolean; maxEntries: number };
  };
  blobDir?: string;
  systemPromptSection: boolean;
  binderFamilyFallback: boolean;
}

export function resolveConfig(config: Partial<VerificationConfig>): VerificationConfig {
  return {
    mode: config.mode ?? 'advisory',
    maxCapturedEvidence: config.maxCapturedEvidence ?? 200,
    maxCapturedBytes: config.maxCapturedBytes ?? 20 * 1024 * 1024,
    completionPermitTtlMs: config.completionPermitTtlMs ?? 30_000,
    oracles: {
      deterministic: config.oracles?.deterministic ?? true,
      assistantResponse: config.oracles?.assistantResponse ?? true,
      coverage: { enabled: config.oracles?.coverage?.enabled ?? true },
      proReview: {
        enabled: config.oracles?.proReview?.enabled ?? false,
        provider: config.oracles?.proReview?.provider ?? 'spawn',
        maxDefects: config.oracles?.proReview?.maxDefects ?? 10
      }
    },
    constraints: config.constraints ?? [],
    intent: {
      // P0-1 review：默认 advisory，requireContractBeforeExecution 只在显式 enforce 时推演为 true
      requireContractBeforeExecution: config.intent?.requireContractBeforeExecution ?? (config.mode ?? 'advisory') === 'enforce',
      contractOrigin: config.intent?.contractOrigin ?? 'independent-capture',
      freezeOnHumanConfirm: config.intent?.freezeOnHumanConfirm ?? true,
      consensusCount: config.intent?.consensusCount ?? 1,
      ...(config.intent?.provider !== undefined ? { provider: config.intent.provider } : {}),
      ...(config.intent?.model !== undefined ? { model: config.intent.model } : {}),
      readOnlyToolAllowlist: config.intent?.readOnlyToolAllowlist ?? DEFAULT_READ_ONLY_TOOLS,
      sourceBasis: {
        includeAttachments: config.intent?.sourceBasis?.includeAttachments ?? true,
        includeControlDocs: config.intent?.sourceBasis?.includeControlDocs ?? true,
        maxEntries: config.intent?.sourceBasis?.maxEntries ?? 200
      }
    },
    ...(config.blobDir !== undefined ? { blobDir: config.blobDir } : {}),
    systemPromptSection: config.systemPromptSection ?? true,
    binderFamilyFallback: config.binderFamilyFallback ?? true
  };
}

/** 冻结配置 hash：permit strict replay 的 configHash 权威（ttl + oracle 版本 + schema 版本）。 */
export function computeConfigHash(config: VerificationConfig): string {
  return stableHash({
    mode: config.mode,
    completionPermitTtlMs: config.completionPermitTtlMs,
    oracles: {
      deterministic: config.oracles.deterministic ? 1 : 0,
      assistantResponse: config.oracles.assistantResponse ? 1 : 0,
      coverage: config.oracles.coverage.enabled ? 1 : 0,
      proReview: { enabled: config.oracles.proReview.enabled ? 1 : 0, provider: config.oracles.proReview.provider }
    },
    maxCapturedEvidence: config.maxCapturedEvidence,
    maxCapturedBytes: config.maxCapturedBytes,
    binderFamilyFallback: config.binderFamilyFallback ? 1 : 0,
    schemaVersion: 1
  });
}

interface RegistryState {
  projection: VerificationProjection;
  epoch: IncrementalEpochState;
}

export function apply(ctx: Context, config: Partial<VerificationConfig>): void {
  const resolved = resolveConfig(config);
  const configHash = computeConfigHash(resolved);

  const store = resolved.blobDir ? createFileBlobStore(resolved.blobDir) : createMemoryBlobStore();

  const service = new VerificationService(
    ctx,
    {
      mode: resolved.mode,
      maxCapturedEvidence: resolved.maxCapturedEvidence,
      maxCapturedBytes: resolved.maxCapturedBytes,
      completionPermitTtlMs: resolved.completionPermitTtlMs,
      configHash,
      enableDeterministic: resolved.oracles.deterministic,
      enableAssistantResponse: resolved.oracles.assistantResponse,
      enableCoverage: resolved.oracles.coverage.enabled,
      enableProReview: resolved.oracles.proReview.enabled,
      proReviewProvider: resolved.oracles.proReview.provider,
      globalConstraints: resolved.constraints,
      intent: {
        consensusCount: resolved.intent.consensusCount,
        ...(resolved.intent.provider !== undefined ? { provider: resolved.intent.provider } : {}),
        ...(resolved.intent.model !== undefined ? { model: resolved.intent.model } : {}),
        contractOrigin: resolved.intent.contractOrigin,
        maxEntries: resolved.intent.sourceBasis.maxEntries
      },
      readOnlyToolAllowlist: resolved.intent.readOnlyToolAllowlist,
      binderFamilyFallback: resolved.binderFamilyFallback,
      askUser: resolveAskUser(ctx)
    },
    { store }
  );

  installEvidenceCapture(ctx, service);
  installCompleteGateHook(ctx, service, {
    mode: resolved.mode,
    readOnlyAllowlist: resolved.intent.readOnlyToolAllowlist,
    writeTools: DEFAULT_WRITE_TOOLS,
    // P0-1 review：工具拦截与完成门禁拆分——只拦明确写入类工具，且默认（advisory）不拦
    requireContractBeforeExecution: resolved.intent.requireContractBeforeExecution
  });
  installIntentTools(ctx, service);
  installProReviewTool(ctx, service, resolved.oracles.proReview.provider);

  // S1-1 修复：GoalTransitionGuard seam（同步 pre-commit 强制）只在 enforce 安装。
  // advisory 本就"永不 deny"，安装 guard 会把它打成 GOAL_TRANSITION_DENIED（guard 拒绝时
  // complete 抛错无 permit 放行）。"不安装 guard → 上游默认放行"正是 seam 的向后兼容语义。
  // 2026-08-19（enforce preset 审查）：guard 安装后必须在 fiber 生命周期结束时注销，
  // 否则进程级全局数组 GOAL_TRANSITION_GUARDS 永久滞留（泄漏到其他 preset 会话）。
  if (resolved.mode === 'enforce') {
    const disposeGuard = installGoalTransitionGuard(ctx, service);
    if (!disposeGuard) {
      throw new Error('enforce verification blocked: GoalTransitionGuard seam unavailable');
    }
    const unregister = (): void => {
      try {
        disposeGuard();
      } catch {
        // 生命周期收尾不抛
      }
    };
    // cordis Context 无类型化 dispose 事件——用 fiber effect（fn 立即执行、返回 cleanup 在 dispose 时跑）
    const anyCtx = ctx as unknown as { effect?: (fn: () => unknown) => unknown; dispose?: () => void };
    if (typeof anyCtx.effect === 'function') {
      anyCtx.effect(() => unregister);
    } else if (typeof anyCtx.dispose === 'function') {
      const originalDispose = anyCtx.dispose;
      anyCtx.dispose = function (this: unknown) {
        unregister();
        return (originalDispose as () => void).apply(this, arguments as never);
      };
    }
  }

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'verification', RegistryState>({
      key: 'verification',
      schema: VerificationProjectionSchema.nullable(),
      init: (): RegistryState => ({ projection: emptyVerificationProjection(), epoch: emptyIncrementalEpochState() }),
      apply: (state: RegistryState, event: { type: string; data: unknown; seq: number; time: number; sessionId?: string }) => {
        if (event.type === 'verification/change') {
          const data = event.data as { record?: import('./projection').VerificationRecord };
          if (data?.record) {
            return {
              projection: foldVerificationRecords(state.projection, [{ record: data.record, seq: event.seq, time: event.time }]),
              epoch: state.epoch
            };
          }
        }
        const epoch = applyEpochEvent(state.epoch, { type: event.type, data: event.data, seq: event.seq, time: event.time }, event.sessionId ?? 'session');
        if (epoch === state.epoch) {
          return state;
        }
        return { ...state, epoch };
      },
      view: (state): VerificationProjection => ({
        ...state.projection,
        taskEpochs: taskEpochViews(state.epoch.epochs)
      }),
      stateVersion: 1
    });
  });

  if (resolved.systemPromptSection) {
    ctx.systemPrompt.section({
      name: 'verification',
      order: 115,
      text: buildVerificationGuidance({ mode: resolved.mode, requireContract: resolved.intent.requireContractBeforeExecution ?? false })
    });
  }
}

/**
 * P0-1 review：人类确认复用 DSH 官方 approval/permission 通道（`ctx.approval.request`）——
 * 带 `approval/asked` + `approval/decided` 审计、session policy（ask/never）、fail-closed 语义，
 * 不再自建 askUser 通道。approval 未挂载时兜底回退 dsh userQuestions.ask（向后兼容）。
 * `allowed-once` → `approve`；其余（rejected/cancelled/unavailable）→ `decline`。
 */
export function resolveAskUser(ctx: Context): VerificationService['config']['askUser'] {
  const approval = ctx.get('approval') as
    | {
        request: (req: {
          agent: unknown;
          toolName: string;
          reason?: string;
          callId?: unknown;
        }) => Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>;
      }
    | undefined;
  if (approval?.request) {
    return async (question) => {
      const outcome = await approval.request({
        agent: question.agent,
        toolName: 'set_verification_plan',
        reason: question.text,
        callId: question.questionId
      });
      return outcome === 'allowed-once' ? 'approve' : 'decline';
    };
  }
  const userQuestions = ctx.get('userQuestions') as
    | {
        ask?: (request: {
          questionId?: string;
          question?: string;
          content?: string;
          text?: string;
          choices?: string[];
          options?: string[];
        }) => Promise<{ selected?: string; answer?: string } | undefined>;
      }
    | undefined;
  if (!userQuestions?.ask) {
    return undefined;
  }
  return async (question) => {
    const answer = await userQuestions.ask!({
      questionId: question.questionId,
      content: question.text,
      options: question.choices
    });
    return answer?.selected ?? answer?.answer;
  };
}
