/**
 * GoalTransitionGuard seam 安装器（v9 §4.2 / v11 §1 第 9 条）。
 * 依赖 vendored dsh-goal 提供的 `registerTransitionGuard`（同步 pre-commit 校验，向后兼容）。
 * seam 未合入（上游原包）时返回 undefined——模型路径仍由 tools/pre-execute 护栏承载，
 * 且 strict replay（validatePermitForCompletion）不依赖该 seam 即可在重放时强制执行。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';

import type { VerificationService } from './service';

export interface GoalTransitionGuardRequest {
  agent: Agent;
  operation: string;
  goalId: string;
  /** 完成前的 goal revision（permit 绑定的是完成前 revision）。 */
  currentRevision: number;
}

export type GoalTransitionGuardVerdict =
  | { kind: 'allow'; permitRef?: string }
  | { kind: 'deny'; reason: string };

export type GoalTransitionGuard = (request: GoalTransitionGuardRequest) => GoalTransitionGuardVerdict | undefined;

declare module '@deepseek-ai/dsh-goal' {
  interface GoalService {
    registerTransitionGuard?(guard: GoalTransitionGuard): () => void;
  }
}

type VendoredGoalService = {
  registerTransitionGuard?: (guard: GoalTransitionGuard) => () => void;
};

/**
 * 把 verification 的完成许可校验注册为 GoalService 的同步 pre-commit guard。
 * 直接调用 `ctx.goals.complete()`（绕过工具 hook）也会被兜住。
 */
export function installGoalTransitionGuard(ctx: Context, service: VerificationService): (() => void) | undefined {
  const goals = ctx.get('goals') as VendoredGoalService | undefined;
  if (!goals?.registerTransitionGuard) {
    return undefined; // upstream seam 未合入
  }
  return goals.registerTransitionGuard((request) => {
    // 2026-08-19（enforce preset 审查）：GOAL_TRANSITION_GUARDS 是进程级全局数组——
    // enforce 实例的 guard 会拦截所有会话的 complete。作用域规则：
    // 1) agent 明确挂了其他 preset（agentPreset 存在且不是 enforce-standard）→ 放行；
    // 2) 无 preset 标记且从未参与验证系统（无 verification 事件）→ 放行；
    // 3) 其余（enforce preset 会话 / 有验证活动的会话）→ 按 permit 强制。
    // 这保证 enforce 只拦自己 preset 的会话，advisory/其他 preset 会话的 complete 不受影响。
    // agentPreset 位于 Agent.meta（会话创建元数据），非顶层字段（2026-08-20 修正）。
    const meta = (request.agent as { meta?: { agentPreset?: string } }).meta;
    const preset = meta?.agentPreset;
    if (preset && preset !== 'enforce-standard') {
      return { kind: 'allow', permitRef: undefined };
    }
    if (!preset && !service.hasVerificationActivity(request.agent)) {
      return { kind: 'allow', permitRef: undefined };
    }
    const result = service.assertCompletionPermit(request.agent, request.goalId, request.currentRevision);
    if (result.ok) {
      return { kind: 'allow', permitRef: result.usedPermitRef };
    }
    return { kind: 'deny', reason: result.reason };
  });
}
