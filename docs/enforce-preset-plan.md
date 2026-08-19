# Enforce Preset 方案（dsh agent preset：验证引擎 enforce 模式）

> 目标：把 `@bpc-oss/dsh-verification` 的 **enforce 模式**做成独立 agent preset——
> 会话级启用，不影响全局（全局保持 advisory）；未来验证有效后可设为默认。
> 参照：`verifier-standard` preset（已验证的"基座 + 验证器"模式，README 有基座评估）。

## 〇、双代理审查结论（2026-08-19，verifier-standard + dev preset）

**审查发现并已修复**（引擎 v9.4.3，`cef5463`，163 测试绿）：

| 审查发现 | 严重度 | 修复 |
|---|---|---|
| **GoalTransitionGuard 是进程级全局数组**（GOAL_TRANSITION_GUARDS 模块级单例）——enforce 实例的 guard 会拦截**所有 preset** 的 complete，推翻"不影响全局"承诺 | 阻塞 | ✅ guard 按 `agent.agentPreset` 作用域：非 enforce preset / 无验证活动的会话放行，只有 enforce 会话被 gate（`goal-guard.ts`）|
| **guard 从不注销**（installGoalTransitionGuard 的 dispose 被丢弃）→ 永久泄漏 | 高 | ✅ 经 ctx fiber effect 在 teardown 时注销（cordis effect 立即执行、返回 cleanup——已正确传 `() => unregister`）|
| 引擎挂载路径错误（文档写 C:/Users/Administrator/dsh-verification，实为 E:\ai-files）| 中 | ✅ 用 `E:/ai-files/dsh-verification/packages/dsh-verification/lib/index.js`（或已装快照 `C:\Users\Administrator\.dsh\profiles\web\node_modules\@bpc-oss\dsh-verification`）|
| order: 9 与 ai-tube-daily 冲突 | 低 | ✅ 改 order: 10 |
| 参照 verifier-standard 的"先例"错位：llm-verifier 是纯工具插件（无 service/hook/guard），引擎是 service+hook+guard，风险等级不同 | 中 | ✅ 文档明确：只参照其**scoped 挂载机制**，隔离性靠 v9.4.3 的 guard 作用域 + realm，不假设照搬即隔离 |

## 一、基座评估（排除 j-space）

| preset | 结构 | 性能机制 | 适合作 enforce 基座？ |
|---|---|---|---|
| **anchored-standard** | 22 行 + 7 机制 mjs | context-gate（首轮剥离注入）+ 两段 tool-bootstrap（首轮锚定 bash+str_replace_editor）+ 发现式解锁 + instruction-hint（实测 98/99 锚定）| ✅ **主基座**：机制最强、无重型框架、与"验证驱动"正交 |
| **verifier-standard** | anchored 机制 + dsh-llm-verifier | 同 anchored + 验证器工具（verifier_select/compare/track 等）| ✅ **结构参照**：已实证"基座 + 独立挂载验证器（绝对路径 scoped）"模式——enforce preset 照此挂 bpc-verification 引擎 |
| dev | 简洁 + 21 技能 | 无锚定机制 | ❌ 干净但缺性能机制 |
| j-space-standard | anchored + jspace 重型框架 | 全 | ❌ 排除（用户指定；重型框架稀释验证定位）|
| router-standard / dev-reviewer / bounty-pipeline | 专用/实验性 | — | ❌ 排除 |

**结论**：基座 = **anchored-standard**（机制最强）+ 直接参照 **verifier-standard** 的挂载模式（绝对路径 scoped 插件行 + guide mjs）。

## 二、Preset 组成（目录：`~/.dsh/.agent-presets/enforce-standard/`）

```
enforce-standard/
├── preset.yml            # 元数据（name: Enforce Standard / description / order）
├── agent.cordis.yml      # 组合：anchored-standard 机制 + 引擎行 + enforce-guide 行
├── enforce-guide.mjs     # 提升后注入验证工作流规则（对照 verifier-guide.mjs）
└── README.md             # 说明 + 启用方法 + 基座评估
```

### agent.cordis.yml 关键行（对照 verifier-standard 的 dsh-llm-verifier 挂载）

```yaml
# ── 引擎（bpc-verification，enforce 模式）─────────────────────────────
# 绝对路径挂载 → 实例 scoped 到本 preset 的 isolate realm（service 行必须在
# isolate group 内，否则发布进根 realm 与其他 preset 冲突、挂载被拒）。
# 隔离性（v9.4.3）：guard 已按 agentPreset 作用域，其他 preset 会话不受影响。
- id: bpc-verification-engine
  name: 'E:/ai-files/dsh-verification/packages/dsh-verification/lib/index.js'
  config:
    mode: enforce
    intent:
      provider: bai
      model: deepseek-v4-flash
```

### enforce-guide.mjs（提升后近距离注入，对照 verifier-guide.mjs 的"默认调用"规则）

```
默认工作流（enforce 会话）：
1. create_goal 建立目标
2. set_verification_plan 声明验收标准 —— 【权威 AC】必须来自用户/官方测试/任务文本，
   不声明可操纵的自定义 AC（v9.4 加固：冻结后不能削弱，弱声明会被 gate 卡死）
3. 真实执行（write/edit/shell 自动捕获证据）
4. update_goal complete —— 被拦（GOAL_TRANSITION_DENIED + 缺陷清单）时按缺陷修复，
   不得重声明弱化 AC
```

### preset.yml

```yaml
name: Enforce Standard
description: >-
  anchored-standard 性能机制 + bpc-verification 引擎 enforce 模式（绝对路径 scoped 本 preset）。
  验收/评测场景启用：每个完成必须有真实证据支撑，错交付物被 gate 拦截 + 缺陷清单。
  全局（其他 preset）保持 advisory 不受影响（guard 按 agentPreset 作用域，v9.4.3）。
order: 10
```

## 三、关键决策

1. **双实例隔离（v9.4.3 实证）**：全局 advisory 实例 + preset enforce 实例同包共存。
   - guard 按 `agent.agentPreset === 'enforce-standard'` 作用域（其他 preset 放行）
   - 无 preset 标记 + 无验证活动的会话也放行（测试兜底）
   - guard 在 fiber teardown 时注销（不再泄漏）
2. **intent 用 bai**：enforce 的独立捕获需要可用的 grader LLM——dgx-spark（18008）已死，bai 实测可用。
3. **默认 advisory 不变**：只有命名本 preset 的会话进 enforce；settings.yaml 的
   `agent-presets.default` 不动。未来验证好：改 `default: enforce-standard` 或 profile 默认 preset。
4. **权威 AC 是 enforce 生效前提**（v9.4 实测：官方 AC 指引 → fix-permissions 收敛；自声明 AC → 死循环）。

## 四、验证计划

1. 创建 preset 目录（复制 anchored-standard + 加引擎行 + guide）。
2. 起会话（preset: enforce-standard）跑 3 用例：
   - 错交付物 → gate 拦截（GOAL_TRANSITION_DENIED + 缺陷清单）
   - 正确交付物 → gate done + complete 放行
   - 重声明弱 AC → 被拒（cannot weaken）
3. 起普通会话（默认 preset）确认仍是 advisory（全局不受影响）。
4. 引擎行可热加载（dev_reload_package / 注入器验证）。

## 五、风险

- 同包双实例：`isolate` realm 解决（verifier-standard 先例）。
- bai provider 依赖：enforce 独立捕获必需；bai 不可用时回退 human-confirmed。
- AC 权威性：guide 强制"AC 来自官方要求"，否则死循环（已加固 + 文档化）。
- 机器负载：Docker 批跑已停；preset 本身无额外开销（引擎已全局存在）。
