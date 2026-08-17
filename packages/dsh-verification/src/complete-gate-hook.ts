import type { Context } from '@deepseek-ai/cordis';
import type { PreToolDecision } from '@deepseek-ai/dsh-tools';
import type { GateResult } from '@bpc-oss/dsh-evidence';

import type { VerificationService } from './service';

export interface GateHookConfig {
  mode: 'enforce' | 'advisory';
  readOnlyAllowlist: string[];
  /**
   * P0-1 review（定位修正）：明确写入类工具集——只有这些工具在
   * enforce + requireContractBeforeExecution + 无契约时才被 missing_contract 拒绝。
   * 缺省使用内置 DEFAULT_WRITE_TOOLS；显式传入可覆盖。
   */
  writeTools?: string[];
  /**
   * 2026-08-15（P0 修复 #3）：把"是否在未声明契约时拦截副作用工具"从 mode 中拆出。
   * P0-1 review：默认按 mode 推演（仅 enforce → true）。read/grep 等只读工具**永不拦**，
   * 拦截只作用于 writeTools 内名单。
   */
  requireContractBeforeExecution?: boolean;
}

/** 固定 bootstrap 白名单（v10：内置枚举，不可扩展；create 建 goal-bound epoch，plan 只 attach）。 */
export const BOOTSTRAP_WHITELIST = ['create_goal', 'set_verification_plan', 'get_verification_plan', 'reset_verification_plan'];

export function renderDefects(gate: GateResult): string {
  return [
    'Verification gate rejected completion:',
    ...gate.reasons.map((reason) => `- ${reason}`),
    'The goal remains active. Fix the listed items, produce real tool evidence, and retry update_goal with action=complete.'
  ].join('\n');
}

/**
 * 完成闸门 + 冻结（v9）。
 * `tools/pre-execute`：
 *  - bootstrap 白名单 → 放行；
 *  - 只读 allowlist → 放行（不触发冻结）；
 *  - 其余工具（含未知/MCP/Code Mode 嵌套）：
 *      enforce 无契约 → deny missing_contract；有契约未冻结 → 先冻结再放行；
 *      advisory 无契约 → 放行。
 *  - update_goal complete：enforce = evaluate（异常 deny evaluation_error）→ done 才解析 goal_id/revision → mint permit → 放行；
 *      advisory = 包住整个 evaluate（异常记 evaluation_error），无论成败只 next 一次。
 */
export function installCompleteGateHook(ctx: Context, service: VerificationService, config: GateHookConfig): void {
  // P0 #3：工具拦截独立于完成门禁；P0-1 review：只拦 writeTools 内名单
  const requireContractBeforeExecution = config.requireContractBeforeExecution ?? config.mode === 'enforce';
  const writeTools = config.writeTools ?? ['edit', 'write', 'write_file', 'unlink', 'rename', 'mkdir', 'rm', 'mv', 'cp', 'apply_patch', 'patch', 'replace', 'shell', 'bash', 'pwsh', 'powershell', 'exec', 'terminal', 'send_message', 'todo_write'];
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const agent = exec.agent;
    if (!agent) {
      return next();
    }
    const name = exec.name;
    if (BOOTSTRAP_WHITELIST.includes(name)) {
      return next();
    }
    const args = exec.arguments as { action?: string } | undefined;

    if (name === 'update_goal' && args?.action === 'complete') {
      return handleComplete(service, config, exec, next);
    }

    const isWriteTool = writeTools.includes(name);

    // P0-1 review：只读/未知工具永不拦（不在 writeTools 内 → 默认放行，也不触发冻结）。
    if (!isWriteTool) {
      return next();
    }

    // 写入类工具：契约要求 + 冻结先于副作用（拦截仅在 enforce 且 requireContractBeforeExecution 时生效）
    const contract = service.getContract(agent);
    if (!contract) {
      if (config.mode === 'enforce' && requireContractBeforeExecution) {
        return { kind: 'deny', reason: 'missing_contract: 写入类工具（write/edit/shell 等）已调用，但未声明意图契约，无法验证副作用。请先 create_goal 后 set_verification_plan，或声明 tools/pre-execute 不要求契约（advisory）。' };
      }
      return next();
    }
    if (!service.isFrozen(agent)) {
      service.freezePlan(agent, String(exec.callId));
    }
    return next();
  });
}

async function handleComplete(
  service: VerificationService,
  config: GateHookConfig,
  exec: { agent?: unknown; callId?: unknown; arguments?: unknown; name: string },
  next: () => Promise<PreToolDecision>
): Promise<PreToolDecision> {
  const agent = exec.agent as Parameters<VerificationService['getContract']>[0];
  const contract = service.getContract(agent);
  if (!contract) {
    if (config.mode === 'enforce') {
      return { kind: 'deny', reason: 'missing_contract: 未声明意图契约，无法验证完成。请先 set_verification_plan。' };
    }
    return next();
  }
  if (!service.isFrozen(agent)) {
    service.freezePlan(agent, String(exec.callId));
  }

  if (config.mode === 'advisory') {
    // v8：advisory 包住整个 evaluate——无论成败只执行一次 next()
    try {
      await service.evaluateGate(agent);
    } catch (error) {
      service.commitGateError(agent, error);
    }
    return next();
  }

  let outcome;
  try {
    outcome = await service.evaluateGate(agent);
  } catch (error) {
    return { kind: 'deny', reason: `evaluation_error: ${String(error)}` };
  }
  if (outcome.gate.status !== 'done') {
    return { kind: 'deny', reason: renderDefects(outcome.gate) };
  }
  // rc.6 update_goal 参数是 goal_id + revision；stale/伪造不落 permit
  const goalArgs = exec.arguments as { goal_id?: string; revision?: number } | undefined;
  if (goalArgs && typeof goalArgs.goal_id === 'string' && typeof goalArgs.revision === 'number' && Number.isSafeInteger(goalArgs.revision)) {
    await service.prepareGoalCompletion(agent, goalArgs.goal_id, goalArgs.revision);
  }
  return next();
}
