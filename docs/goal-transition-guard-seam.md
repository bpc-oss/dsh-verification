# GoalTransitionGuard upstream seam（原型补丁稿）

> 状态：workspace 内已验证的原型补丁（`pnpm-workspace.yaml` 用 `overrides` 指向 `vendor/@deepseek-ai/dsh-goal`）。
> 用途：作为提交 deepseek-harness 上游的 PR 稿；也是本插件 enforce 完整强制边界的运行时前提。

## 补丁范围（两处改动，全部向后兼容）

`packages/goal/goal/lib/index.js`：

1. **同步 pre-commit guard 注入**（`commitSnapshot`）：
   - operation 为 `complete` 时在构建 change **之前**执行 `dispatchTransitionGuards(agent, goal)`；
   - 任一 guard 返回 `deny` → 抛 `GoalError('GOAL_TRANSITION_DENIED')`，**mutation 未提交**（zero mutation）；
   - guard 返回 `allow + permitRef` → 该 `permitRef` 写入 change 载荷（**complete 事件归因**）；
   - **无 guards → 返回 undefined，行为与原版完全一致**（向后兼容）。
2. **goal 域严格解码器**（`decodeGoalChange` 快照分支）：
   - 快照 change 的 key 集合允许可选的 `permitRef`（原为穷举 8 字段、多一个字段即拒绝）；
   - 解码结果透传 `permitRef`（供 strict replay / projection 使用）。

注册/分发采用**进程级单例注册表**（附理由）：GoalService 是 host 单例；
cordis `ctx.get(name)` 返回的服务代理会让"按实例 WeakMap key"的注册与分发失配（原型实测），
故不用实例 key。若上游担心多实例场景，可改为"按 service name 的 WeakMap + 代理穿透"或统一在
host 容器注册。

## 接口（新增，仅在补丁存在时可用）

```ts
type GoalTransitionGuardRequest = {
  agent: Agent;
  operation: string;          // 'complete'
  goalId: string;
  currentRevision: number;    // 完成前 revision（permit 绑定的是完成前 revision）
};
type GoalTransitionGuardVerdict =
  | { kind: 'allow'; permitRef?: string }
  | { kind: 'deny'; reason: string };

// 挂到 GoalService 实例（进程级），返回注销函数
goals.registerTransitionGuard(guard: (request: GoalTransitionGuardRequest) => GoalTransitionGuardVerdict | undefined): () => void
```

## 本仓库复现步骤

```bash
# 1. 从 rc.6 恢复 pristine 副本（全局安装的 @deepseek-ai/dsh-goal 复制到 vendor/）
# 2. 运行补丁脚本（幂等要求：每次 restore 后执行一次）
node scripts/patch-vendored-goal.cjs
# 3. pnpm install 使 overrides 生效（pnpm-workspace.yaml 内 link: 到 vendor）
```

## 验证

`packages/dsh-verification/test/seam-e2e.test.ts`（挂载真实 GoalService）：

| 场景 | 结果 |
|---|---|
| 无 permit 直接 `ctx.goals.complete()` | `GOAL_TRANSITION_DENIED`，goal phase/revision 不变 |
| prepare 后 complete | 成功 + complete 事件携带 `permitRef` 归因 |
| strict replay（envelope seq/time + 冻结 configHash TTL） | 通过 |
| edit 后旧 permit（stale revision） | 拒绝；重新 prepare 后可完成 |
| 注销 guard | 恢复上游默认放行（兼容性证明） |

## 客户端接入（插件侧）

`dsh-verification` 的 `installGoalTransitionGuard(ctx, service)`（`src/goal-guard.ts`）：
读取 `ctx.get('goals')`，若存在 `registerTransitionGuard`（补丁存在）→ 用
`service.assertCompletionPermit(agent, goalId, currentRevision)` 注册 guard；
否则返回 undefined。插件入口只在 **advisory** 模式接受该结果（且不安装 guard，保持
上游默认放行）；**enforce** 模式必须显式以 `enforce verification blocked` 拒绝激活，
不得注册为 enforce-ready 或退化成仅靠工具 hook 的保护。

严格重放必须从 complete 事件读取其精确 `permitRef`，并只验证该引用的 permit；不得
回退选择“同 goal/revision 的最新 permit”。顺序和 TTL 仍仅取 permit 与 complete 的
SessionEvent envelope `seq/time`，因此历史合法 completion 在当前墙钟超过 TTL 后仍可重放。

## 上游 PR 提议要点

- 类型侧：`GoalSnapshotChangeMeta` 增加 `readonly permitRef?: string`；`GoalService` 增加
  `registerTransitionGuard`；
- 语义：permit 绑定**完成前 revision**（`complete` 事件载荷 `goal.revision - 1`），提交后天然不可重放；
- TTL 权威：strict replay 只用 SessionEvent envelope 的 `seq/time`，`expiresAt = permitEvent.time +
  冻结 configHash 的 `completionPermitTtlMs`；payload 不携带 issued/expiry。
