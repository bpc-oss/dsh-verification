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

## 五之二、真实任务 benchmark（真实会话回放审计）

对**真实会话**（4 个声明契约的会话，16 个契约、839 条真实证据）做权威日志回放审计：
逐 AC 提取记录在案的裁决，并**用日志证据交叉验证每条 fail 裁决是否成立**（`scripts/real-task-benchmark.py` 可复现）。

| 指标 | 数值 |
|---|---|
| 真实完成闸门评估 | 1 次 → **FAILED**（真实"假完成"被拒） |
| 真实 AC 级裁决 | 6 条（pass=2 / **fail=4**，fail 率 67%） |
| 一致性 FLAG（fail 但日志存在匹配证据） | **0** |
| 证据 / 捕获失败 | 839 / ~2015 |

**结论**：真实任务上，引擎判定的 4 条失败中，`ac-review-pass`（no committed run）**经日志证实成立**（确实无匹配 selector 的调用）；但 `ac-research`（No files found）经交付物存在性交叉验证为**假阴性**（见 §五之三）——即真实拦截 1 次成立、1 次为误拒，并拦截了 1 次真实完成闸门。

> 局限：payload 不落盘（引擎用内存 blob store），本基准做"日志权威裁决 + 一致性验证"，不做 oracle 全量重放——这恰是真实数据上可复核的部分。

## 五之三、完成任务能力评估（诚实结论：发现真实误拒）

只测"拦截"不够——核心是**能否让真实完成的任务通过**。对真实契约逐条 fail 裁决做"交付物存在性"交叉验证（`scripts/task-completion-eval.py`）：

| 分类 | 数量 | 说明 |
|---|---|---|
| **FALSE_REJECTION（真实完成被误拒）** | **2**（ac-research × 2 plan） | 57 条 write→file_diff 证据已产出 docs（`02-external-research-summary.md` 等，磁盘文件真实存在），但 gate 判 `No files found` |
| pass（正确放行） | 2（ac-design） | ✅ |
| 一致 fail（真负候选） | 2（ac-review-pass） | 无匹配证据（当时审查证据未落账） |

**关键发现（ac-research 误拒证据链）**：
- 冻结 selector = `glob(5111cf8b)`；会话中唯一匹配的 glob 调用（seq 45307）参数为 `{"pattern":"E:/ai-files/dsh-continuous-worker/docs/*.md"}`——**路径正确**，运行时文档已写完（write 证据 seq 12043+，早于 glob），磁盘文件存在；
- 但该 glob 返回 "No files found"（疑似 Windows 正斜杠路径/工具行为），且 **write→file_diff 证据（57 条，路径精确匹配交付物）因不匹配冻结 selector 从未被绑定**；
- 结果：真实完成的任务被 gate 判 fail → **假阴性**。

**结论与改进方向**：真实任务上引擎的"拦截"包含假拒绝——selector 冻结是 exact-only，交付物若由其他工具（write/edit）产生则永远验证不到。开源前必须改进：
1. **绑定期证据族感知**（binder 复用已有 `EVIDENCE_FAMILIES`：file_diff/file_exists/quote_with_location 互认）——file 类 AC 在 exact selector 证据缺失时，允许用作用域内真实文件证据裁决（带注明），减少误拒；
2. **selector 冻结引导**：set_verification_plan 的提示让 agent 按实际工作工具冻结 selector；
3. 把"完成任务能力"（假拒绝率）纳入 benchmark 指标，与"拦截率"并列。

> 诚实声明：合成 benchmark 的 100% 召回率是"引擎按冻结 selector 判定"的能力；真实数据暴露的是"selector/绑定与现实交付方式错配"导致的假阴性——这是开源前必须解决的可靠性议题。

## 六、还缺什么（开源前建议补齐）

1. **with/without 对比**：同一任务开/关引擎，对比交付物真实存在性、测试通过率（直接量化增益）
2. **捕获失败归因**：把 ~2015 条失败按原因分类（超限/截断/哈希/沙箱），证明是保守设计而非缺陷
3. **README 数字表**：把上述数字 + 案例链接放到开源仓库首页（见仓库 README "Why verification?" 章节）

## 七、方法论（可复核）

- 事件为 append-only：`{type:"verification/change", data:{record:{kind: plan|verdicts|gate|evidence|capture-failure|permit}}}`
- 本报告 = 对 228 个会话存档的 zstd 多帧解压 + 事件计数 + 裁决/闸门明细提取
- 复现脚本：`scripts/value-report-scan.py`（仓库内，可重跑）
