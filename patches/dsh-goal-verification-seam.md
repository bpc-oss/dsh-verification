# dsh-goal verification-seam 补丁（GoalTransitionGuard，同步 pre-commit）

> 归档日期：2026-08-21。防止 rc 升级丢失（rc.8 曾丢失，本次确认/恢复）。
> 应用位置：@deepseek-ai/dsh-goal/lib/index.js 文件末尾（export 行之后）。
> 检查：grep 'registerTransitionGuard|verification-seam' 应命中 >=2。

## 补丁内容

```js
export { GOAL_CHANGE_VERSION, GoalError, GoalId, GoalService, GoalService as default, applyGoalProjection, decodeGoalChange, foldGoal, goalChangeRef };

//#region verification-seam (GoalTransitionGuard, sync pre-commit) 鈥?migrated from rc.5 patch
// 杩涚▼绾у崟渚?guard 娉ㄥ唽琛紙GoalService 涓?host 鍗曚緥锛沜tx.get 浠ｇ悊涓嶇牬鍧忔敞鍐?鍒嗗彂涓€鑷存€э級銆傚悜鍚庡吋瀹癸細鏃?guards 鈫?鏀捐銆?const GOAL_TRANSITION_GUARDS = [];
function dispatchTransitionGuards(agent, nextGoal) {
  if (GOAL_TRANSITION_GUARDS.length === 0) return void 0;
  const request = {
    agent,
    operation: 'complete',
    goalId: nextGoal.id,
    currentRevision: nextGoal.revision - 1
  };
  for (const guard of GOAL_TRANSITION_GUARDS) {
    let verdict;
    try {
      verdict = guard(request);
    } catch (error) {
      throw new GoalError('goal transition guard threw: ' + (error && error.message ? error.message : String(error)), 'GOAL_TRANSITION_GUARD_ERROR');
    }
    if (verdict && verdict.kind === 'deny') {
      throw new GoalError(verdict.reason || 'goal completion rejected by transition guard', 'GOAL_TRANSITION_DENIED');
    }
    if (verdict && verdict.kind === 'allow' && typeof verdict.permitRef === 'string') {
      return verdict.permitRef;
    }
  }
  return void 0;
}
GoalService.prototype.registerTransitionGuard = function registerTransitionGuard(guard) {
  if (typeof guard !== 'function') throw new TypeError('transition guard must be a function');
  GOAL_TRANSITION_GUARDS.push(guard);
  return () => {
    const index = GOAL_TRANSITION_GUARDS.indexOf(guard);
    if (index >= 0) GOAL_TRANSITION_GUARDS.splice(index, 1);
  };
};
//#endregion
```

## 作用
- registerTransitionGuard(guard)：GoalService 同步 pre-commit guard 注册（进程级单例）。
- dispatchTransitionGuards：goals.complete() 同步分发 guards——deny → GOAL_TRANSITION_DENIED；allow+permitRef 透传。
- 引擎 installGoalTransitionGuard 注册；缺失时静默跳过（strict-replay 仍兜底）。

## 重打步骤
1. 在目标 index.js 的 export 行后追加本补丁内容。
2. 验证：node -e "const g=require('@deepseek-ai/dsh-goal'); console.log(typeof g.GoalService.prototype.registerTransitionGuard)" -> 'function'
