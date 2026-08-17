# dsh-verification 价值报告（真实数据回放）

> 生成日期：2026-08-17 · 数据来源：本地 `.dsh/sessions` 全部会话存档（228 个）中回放 append-only `verification/change` 事件
> 说明：排除 smoke/verify/测试工作区后的**真实使用数据**。所有数字可直接复核（事件落盘，可重跑 `scripts/value-report-scan.py`）。
> ⚠️ 时点快照：会话数据持续增长，本报告数字为生成时刻值（如捕获失败数会随使用上升），复核时以脚本实时输出为准。

## 一、核心数字

| 指标 | 数值 | 备注 |
|---|---|---|
| 产生验证活动的真实会话 | 11 个 | 其中 4 个声明了意图契约 |
| 声明的契约（plan 记录） | 16 个 | 跨 4 个会话 |
| 证据引用（evidence refs） | 839 条 | 工具调用的真实输出绑定 |
| 裁决（verdicts） | 3 条 | 1 pass / 2 fail |
| 完成闸门评估 | 1 次 | **1 次 FAILED** |
| 证据捕获失败记录 | ~1786 条 | 见 §三（诚实性指标；时点值，随使用增长） |

**一句话结论：唯一一次完整"完成闸门"评估发生在真实项目上，agent 声称完成、闸门判定失败并返回缺陷清单。**

## 二、旗舰案例：`session-aae5c2d5`（"电子打工人"插件设计方案任务）

- **目标**：调研并撰写一个 dsh-插件（7×24 常驻"电子打工人"自主执行体）的详细设计方案，并派独立审查返修直至全体通过
- **3 条验收标准**：ac-research（调研证据落盘）/ ac-design（设计文档完整）/ ac-review-pass（独立审查通过）
- **裁决结果**：

| AC | 结果 | 引擎判定理由 |
|---|---|---|
| ac-design | ✅ pass | 设计文档存在且有证据绑定 |
| ac-research | ❌ fail | `file evidence check failed: {"quote":"No files found"}` —— 声称的调研文档证据不存在 |
| ac-review-pass | ❌ fail | `no committed run for selector (glob, 3ac71ab8, assistant_response)` —— 审查 AC 无任何真实运行证据 |

- **完成闸门**：**拒绝（gate failed）**，返回缺陷清单 `['AC ac-research failed…', 'AC ac-review-pass failed…']`
- **价值点**：如果引擎不介入，这个 agent 会带着 **2/3 证据不足的验收标准**直接宣布"完成"。引擎通过**冻结 selector + 绑定真实工具证据**拦截了这次虚假完成。

## 三、诚实性指标：证据捕获失败（~1511 条）

- 捕获失败的次数**高于**成功证据（839），分布：aae5c2d5=252、8bdfce78=780、5afe18e6=241、802691f6=238
- 性质：引擎对**无法完整捕获的证据记录失败事件**（fail-safe，绝不伪造证据），这是"不撒谎"的设计
- 但 64% 的失败率也提示**捕获管线需要调优**（blob 大小上限 / 截断策略 / 沙箱路径），是开源前应攻克的可靠性议题

## 四、可靠性证据（自动化测试 + benchmark）

- `dsh-verification`：**140 个单测全绿**（含 enforce 模式、证据绑定、闸门、epoch 折叠、契约权威、fail-closed 放宽回归）
- `dsh-evidence`：schema 校验测试全绿
- `dsh-client-ui-verification`：13 个组件/设置测试全绿
- 类型检查全绿；真实会话回放无崩溃
- **可复现 benchmark**（`pnpm --filter @bpc-oss/dsh-verification bench`）：见 §五

## 五、可复现 benchmark：缺陷拦截评测

12 个合成场景（**8 个植入缺陷 + 4 个干净**）走真实确定性裁判（T0 test-run / command-exit / file-exists / file-diff / schema-valid + T3 coverage）与完成闸门，结果：

| 指标 | 数值 |
|---|---|
| **召回率**（缺陷场景被闸门拦截比例） | **100%**（8/8） |
| **误报率**（干净场景被误拦比例） | **0%**（4/4） |
| AC 级裁决命中 | 12/12 |

场景即"谎报完成"攻击面：文件不存在（`file_exists=false`）、无任何已提交运行（`no-committed-run`）、测试红却说绿（`exitCode=1`）、命令非零退出、文件内容与验收不符、schema 无效、跨 AC 复用证据冒充、一过一缺的整体闸门拒绝。运行方式与期望表见 `packages/dsh-verification/bench/README.md`。

> 基准自身也曾抓到场景数据 bug（干净场景内容不含验收字面量被误判 fail）——证明该评测对"期望表本身"也有防呆作用。

## 六、还缺什么（开源前建议补齐）

1. **with/without 对比**：同一任务开/关引擎，对比交付物真实存在性、测试通过率（直接量化增益）
2. **捕获失败归因**：把 ~1511 条失败按原因分类（超限/截断/哈希/沙箱），证明是保守设计而非缺陷
3. **README 数字表**：把上述数字 + 案例链接放到开源仓库首页（见仓库 README "Why verification?" 章节）

## 七、方法论（可复核）

- 事件为 append-only：`{type:"verification/change", data:{record:{kind: plan|verdicts|gate|evidence|capture-failure|permit}}}`
- 本报告 = 对 228 个会话存档的 zstd 多帧解压 + 事件计数 + 裁决/闸门明细提取
- 复现脚本：`scripts/value-report-scan.py`（仓库内，可重跑）
