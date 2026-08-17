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
    const result = service.assertCompletionPermit(request.agent, request.goalId, request.currentRevision);
    if (result.ok) {
      return { kind: 'allow', permitRef: result.usedPermitRef };
    }
    return { kind: 'deny', reason: result.reason };
  });
}
