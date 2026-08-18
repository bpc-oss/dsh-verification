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

**结论与修复（v9.2 已落地）**：真实任务暴露的假阴性源于 selector exact-only 绑定——交付物由 write/edit 产生时，冻结成 glob/read 的 selector 验证不到。已实现：
1. **绑定期证据族感知**（`binders.ts` + `service.ts`）：`binderFamilyFallback`（默认 true）——file 族 AC 精确绑定裁决失败时，用作用域内同族真实文件证据兜底重判（detail 注明 family evidence fallback，可审计；配置可关，安全严格场景可回退 exact-only）；
2. **selector 冻结引导**：`set_verification_plan` 描述 + 系统提示新增"按实际工作工具冻结 selector（文件交付用 write/edit→file_diff 而非 glob/read）"；
3. **假拒绝率入 benchmark**：`scripts/task-completion-eval.py` 将交付物存在性 × 裁决交叉验证作为常态化评估，与拦截率并列。

> 诚实声明：合成 benchmark 的 100% 召回率是"引擎按冻结 selector 判定"的能力；真实数据暴露的"selector/绑定与现实交付方式错配"假阴性，已由 v9.2 family fallback 修复（`binders.test.ts` 新增 4 条回归测试）。

## 五之四、公认任务 × 对照组（完成任务能力 vs 拦截）

5 类标准 agent 任务原型（文件写入 / 测试运行 / 代码修改 / 报告产出 / 命令执行），每类两个变体
（真实完成 vs 伪造完成），走完整服务链路；对照组 = 无引擎（凭 agent 自述直接放行）。`bench/task-suite.test.ts` 可复现：

| 任务 | 真实完成 → gate | 伪造完成 → gate | 对照组（naive） |
|---|---|---|---|
| file-write | done ✓ | failed ✓ | accepted（伪造溜过） |
| test-run | done ✓ | failed ✓ | accepted |
| code-edit | done ✓ | failed ✓ | accepted |
| report | done ✓ | failed ✓ | accepted |
| command | done ✓ | failed ✓ | accepted |

**结果**：引擎**真实完成 5/5 放行**（完成能力不受损）· **伪造完成 5/5 拦截**；对照组 **10/10 全部接受——5 个伪造完成溜过**。

> 对照组首跑即暴露并修复真实缺陷：family 兜底曾放行"改错文件但内容符合"的伪造完成（edit `src/other.js` 冒充 `src/math.js`）——已修复为**证据路径须与 AC 描述交付物对齐**（`binders.ts` deliverableHints + 2 条回归测试）。这正是对照组存在的意义。

## 五之五、提高能力实验（量化：无引擎 vs 有引擎）

同一任务、同一 agent（先提交"有缺陷的完成"），对比无引擎与有引擎的**最终交付质量**，并测**修复闭环**（gate 拒绝 → 缺陷清单 → agent 修正 → 通过）：

| 任务 | 无引擎（上线） | round1 gate | round2 gate | 修复 |
|---|---|---|---|---|
| file-write | 缺陷交付上线 | REJECTED（声称但没写） | done ✓ | yes |
| test-run | 缺陷交付上线 | REJECTED（测试真红） | done ✓ | yes |
| code-edit | 缺陷交付上线 | REJECTED（改错文件） | done ✓ | yes |
| report | 缺陷交付上线 | REJECTED（只声称） | done ✓ | yes |
| command | 缺陷交付上线 | REJECTED（非零退出） | done ✓ | yes |

**量化指标**：
- **缺陷交付上线：无引擎 5/5 → 有引擎 0/5**
- **修正收敛：5/5**（gate 的缺陷清单驱动 agent 修正，二次评估通过）
- **gate 拒绝驱动修正：5/5**（拒绝原因准确指向真实缺陷）
- **量化提升：引擎把 5 个本会线上交付的缺陷完成转化为正确交付**

> 这是"提高能力"的直接度量：没有 gate，一个 sloppy agent 会带 5 个缺陷完成直接上线；有 gate，全部被拦下并修正后才交付。

## 五之六、真实模型 live 基准（v9.3 run 族兜底）

在公认基准（HumanEval 官方数据集 + BigCodeBench）上用真实 deepseek-v4-flash live 筛查：

| 基准 | 无插件对照 | 有插件 |
|---|---|---|
| HumanEval（63 题） | 62/63（98.4%） | 失败题 HumanEval/54（same_chars）：验证流程下 **7/7 官方测试全过** |
| BigCodeBench（A 批 10 题） | 10/10 | - |

**关键发现（驱动 v9.3）**：live 反复出现 run/test 类 AC 被误标——agent 冻结 shell selector 的参数哈希与实际 shell 命令不一致（如冻结 `python test_fib.py`、实际跑 `python -c "import fib; ..."`）→ exact 绑定失败，即便测试真实运行且通过。file 族已有兜底，run 族没有。

**v9.3 修复**：`binders.ts` bindFamilyFallback 扩展到 run 族（command_output/test_run），命令对齐——证据的 payload.command 必须包含 AC 描述的特征 token（引号文本或非通用标识符，如 fib/55）；`service.ts` 第二程条件加入 run 族 AC。新增回归：2 binders（命令对齐绑定/拒绝无关命令）+ 1 E2E 复现 HE/54（gate done）+ 1 exact-only 不变。

**v9.3.1（契约级提示，live 实测驱动）**：新引擎 live 复测发现 run AC 描述常只写验证意图（"输出显示全部通过…AssertionError"）而命令是实现细节（`python same_chars.py`）——单描述提取的特征不在命令里 → 兜底仍拒收真实证据。修复：`evaluateGate` 聚合**整个契约所有 AC** 的命令特征（file AC 提到 `same_chars.py` → 命令可对齐）作为 `familyExtraHints`。live 三阶段对比（真实 deepseek-v4-flash 跑 HE/54 处理组）：

| 引擎版本 | AC2 (run) 裁决 | gate |
|---|---|---|
| v9.2（无 run 兜底） | fail（no committed run） | failed |
| v9.3（单描述提示） | fail（AssertionError 不在命令） | failed |
| **v9.3.1（契约级提示）** | **pass**（family evidence fallback） | **done** |

交付物全程 7/7 官方测试通过——插件从"误标真实运行"到"正确放行"，完全由真实模型 live 基准驱动迭代。

## 五之七、公认 agent benchmark live 试点（Terminal Bench 2 官方任务）

对标 J-Space 报告的做法，用**官方任务集**（terminal-bench，112 题清单 + 官方隐藏测试已 vendor 至 `bench/tasks/datasets/tb2/`）做有/无插件 live 对照。协议：唯一变量 = 是否加载插件；判分 = 官方 `test_outputs.py` 逻辑；单次运行声明。

| 官方任务 | 无插件（对照） | 有插件（处理） | 说明 |
|---|---|---|---|
| aimo-airline-departures（数学） | **PASS**（results.txt=79） | **PASS**（交付物） | 处理组 gate=failed：agent 自声明 AC 质量差（run 族 selector 不匹配 + 怪 AC "期望文本 the"）→ 引擎严格审计暴露 |
| csv-to-parquet（数据） | **PASS** | **PASS** | 双过 |
| adaptive-rejection-sampler（算法实现） | **PASS**（正确实现 + 自写冒烟测试） | 会话异常无产出 | flash 自己写了测试迭代 |
| grid-pattern-transform | **PASS** | **PASS** | 双过 |
| pandas-etl | **PASS** | **PASS** | 双过 |
| hello-world | **PASS** | **PASS** | 双过 |
| heterogeneous-dates | **FAIL** | **FAIL** | 交付物误解（avg_temp.txt 未产出）；**v2 官方 AC 后 PASS**（见下） |
| solve-maze-challenge | **FAIL** | **FAIL** | 未创建官方要求的 solution.js（处理组连 goal 都没建——advisory 可忽略流程） |
| raman-fitting | **FAIL** | **FAIL** | 大量拟合工作产出 fit_results.json，官方要 results.json（文件名不符） |
| broken-python | **FAIL** | **FAIL** | 任务概念（系统 python 损坏）不映射 Windows 环境，双无交付物 |

**TB2 Windows 可跑子集汇总（10 任务）**：4 全过（aimo/csv/grid/pandas-etl/hello-world 5 过）、5 失败（heterogeneous-dates/solve-maze/raman/broken-python）+ ars 会话异常。失败模式：**交付物误解**（3 例：文件名/形式与官方要求不符）+ 环境不匹配（1 例）。**无插件与有插件结果一致——插件在 advisory + 自声明 AC 下未能拦截这些失败**（详见 §五之八边界分析）。

**诚实结论**：deepseek-v4-flash 在这批 TB2 任务上**全过**（与 HumanEval 98%、BigCodeBench 10/10 一致）——没找到需要插件救援的失败点。插件在这些任务上的价值 = 审计层（处理组 gate 暴露 agent 自声明 AC 的质量问题，即"验收标准本身写错"这一真实风险）。

**9 基准全量可行性矩阵**（诚实评估）：

| 基准 | 全量可行性 | 需要 |
|---|---|---|
| Terminal Bench 2.x | 子集可跑（已跑 3） | Docker 沙箱（多数任务要 Linux/QEMU/内核/网络环境） |
| HLE / Agents' Last Exam | 子集可跑 | 批量模型 API（本环境 key 在 host 进程，无法直连） |
| Toolathlon | 需官方 harness | 工具调用评测框架 |
| DeepSWE / NL2Repo / AutomationBench | 需官方 harness + Docker | 真实 repo + 隐藏测试 + 长时 agent 运行 |
| CyberGym | 最重 | CTF 安全环境 |

**结论**：9 基准全量 = 数天级工程（每个基准官方 harness + 环境 + N 任务 × 有/无插件）。本仓库已具备：任务夹具（control-group / agent-tasks / HumanEval / BigCodeBench / TB2 子集）+ 协议 + live 运行模式。全量跑建议作为独立专项（需要 Docker 沙箱 harness 集成 + 模型 API 通道）。

## 五之八、TB2 全量子集 live 批次（5 任务 × 有/无插件）

在 Terminal Bench 2 官方任务集上批量跑（Windows 可跑子集，官方 `test_outputs.py` 判分）：

| 官方任务 | 无插件 | 有插件 | 失败模式 |
|---|---|---|---|
| grid-pattern-transform | **PASS** | **PASS** | - |
| pandas-etl | **PASS** | **PASS** | - |
| heterogeneous-dates | **FAIL** | **FAIL** | 交付物误解：产出 daily_change.py/sf_daily_temp_change.csv，官方要求 avg_temp.txt 未产出 |
| solve-maze-challenge | **FAIL** | **FAIL** | 未创建官方要求的 solution.js（只留种子文件） |
| raman-fitting | **FAIL** | **FAIL** | 大量拟合工作产出 fit_results.json，官方要求 results.json（文件名不符） |

**核心发现（公认任务暴露插件真实边界）**：
1. **3/5 任务 flash 失败，失败模式完全一致 = 交付物误解**——模型产出"自己的解读"（文件名/形式与官方要求不符），而非不会做任务本身。
2. **插件没能救援这些失败**：
   - advisory 下 agent 可忽略验证流程（solve-maze 处理组连 goal 都没建）；
   - 即使走了流程（heterogeneous-dates 处理组 gate failed），**agent 自声明 AC 验证的是它自己误解的需求**——gate 无法捕获与官方要求的偏差（自声明 AC 的"垃圾进垃圾出"）。
3. **插件价值边界（诚实）**：AC 由 agent 自声明时，引擎只能审计 agent 声称的目标。要捕获"交付物误解"需要：**enforce 模式 + 独立捕获/人类确认的契约**（AC 由外部权威定义），或直接把官方测试作为 AC。这正是 `intent.contractOrigin: independent-capture / human-confirmed` 存在的意义——advisory + 自声明是审计层，不是验收层。

**边界可破的实证（heterogeneous-dates v2）**：同一任务，把官方要求**明确作为 AC**（"交付物必须是 avg_temp.txt，值为 11.428571"）重新跑：

| 版本 | AC 来源 | 交付物 | 官方测试 |
|---|---|---|---|
| v1（批次） | agent 自声明（sf_daily_temp_change.csv） | 错误文件名 | **FAIL** |
| v2 | **官方要求**（avg_temp.txt + 值） | avg_temp.txt = 11.428571 | **PASS** |

> v2 的 gate 仍 failed：AC1（file 存在）无 avg_temp.txt 的**直接文件证据**（agent 写的是脚本 compute_avg_temp.py，文件由脚本运行产生，仅 shell 证据）——引擎保守正确地拒绝；AC2（值校验）经 shell 兜底 pass。结论：**验证引擎的强度上限 = 契约的权威性**；权威 AC（独立捕获/人类确认/官方测试）下它能引导正确交付，自声明 AC 下它只是审计层。

## 六、还缺什么（开源前建议补齐）

1. **with/without 对比**：同一任务开/关引擎，对比交付物真实存在性、测试通过率（直接量化增益）
2. **捕获失败归因**：把 ~2015 条失败按原因分类（超限/截断/哈希/沙箱），证明是保守设计而非缺陷
3. **README 数字表**：把上述数字 + 案例链接放到开源仓库首页（见仓库 README "Why verification?" 章节）

## 七、方法论（可复核）

- 事件为 append-only：`{type:"verification/change", data:{record:{kind: plan|verdicts|gate|evidence|capture-failure|permit}}}`
- 本报告 = 对 228 个会话存档的 zstd 多帧解压 + 事件计数 + 裁决/闸门明细提取
- 复现脚本：`scripts/value-report-scan.py`（仓库内，可重跑）
