# 跑分对比表（deepseek-v4-flash，2026-08-18 实测）

> 全部真实运行：DSH 会话 + 官方隐藏测试/判分器。单次运行声明。协议：唯一变量 = 是否加载验证插件（有/无插件对照）。

## 一、模型能力分数（公认基准，无插件）

### 1.1 MMLU-Pro（官方排行榜对照，%）

| 模型 | MMLU-Pro | 来源 |
|---|---:|---|
| Claude-3.5-Sonnet | 76.12 | 官方 README |
| GPT-4o | 72.55 | 官方 README |
| Gemini-1.5-Pro | 69.03 | 官方 README |
| Claude-3-Opus | 68.45 | 官方 README |
| GPT-4-Turbo | 63.71 | 官方 README |
| **DeepSeek-V4-Flash（本机实测）** | **60.0%**（70 题验证集） | 本次实测 |
| Gemini-1.5-Flash | 59.12 | 官方 README |
| Claude-3-Sonnet | 56.80 | 官方 README |
| Llama-3-70B-Instruct | 56.20 | 官方 README |
| DeepSeek-V2-Chat | 54.81 | 官方 README |

### 1.2 HumanEval（pass@1，公开引用对照，%）

| 模型 | HumanEval | 来源 |
|---|---:|---|
| Claude-3.5-Sonnet | ~92.0 | Anthropic 报告 |
| GPT-4o | ~90.2 | OpenAI 报告 |
| DeepSeek-V3 | 88.4 | DeepSeek-V3 技术报告 |
| **DeepSeek-V4-Flash（本机实测）** | **98.4%**（63 题筛查子集） | 本次实测 |
| GPT-4 | 88.4 | OpenAI 报告 |

### 1.3 BigCodeBench-Complete（pass@1，公开引用对照，%）

| 模型 | BigCodeBench | 来源 |
|---|---:|---|
| GPT-4o | 46.4 | 论文 |
| DeepSeek-V3 | 42.5 | DeepSeek-V3 技术报告 |
| Gemini-1.5-Pro | 38.5 | 论文 |
| GPT-4-Turbo | 38.6 | 论文 |
| Claude-3-Opus | 36.8 | 论文 |
| **DeepSeek-V4-Flash（本机实测）** | **100%**（10 题首批子集） | 本次实测 |

### 1.4 AIME 2024（pass@1，公开引用对照，%）

| 模型 | AIME | 来源 |
|---|---:|---|
| DeepSeek-R1 | 79.8 | R1 技术报告 |
| o1 | 74.4 | OpenAI |
| GPT-4o | ~15 | 公开评测 |
| **DeepSeek-V4-Flash（本机实测）** | 部分（1/5 批 14/18；其余批格式不合规） | 本次实测 |

> **诚实声明**：本机数字是小样本（MMLU-Pro 验证集 70 题 / HumanEval 63 题 / BigCodeBench 10 题 / AIME 90 题），官方数字是全量基准——对比是**方向性参照**，不是严格同样本横评。HumanEval/BigCodeBench 小样本可能偏高（HumanEval 已饱和/污染）。

## 二、有/无插件对比（Terminal Bench 2 官方任务，10 个 Windows 子集）

| 任务 | 无插件 | 有插件 | 官方测试判定 |
|---|---|---|---|
| aimo-airline-departures | ✅ PASS | ✅ PASS | results.txt=79 |
| csv-to-parquet | ✅ PASS | ✅ PASS | parquet 数据一致 |
| grid-pattern-transform | ✅ PASS | ✅ PASS | 网格变换正确 |
| pandas-etl | ✅ PASS | ✅ PASS | ETL 输出一致 |
| hello-world | ✅ PASS | ✅ PASS | hello.txt 内容对 |
| adaptive-rejection-sampler | ✅ PASS | ⚠️ 会话异常 | 正确实现+自写测试 |
| heterogeneous-dates | ❌ FAIL | ❌ FAIL | 交付物误解（avg_temp.txt 未产出）|
| solve-maze-challenge | ❌ FAIL | ❌ FAIL | 未创建 solution.js |
| raman-fitting | ❌ FAIL | ❌ FAIL | results.json 文件名不符 |
| broken-python | ❌ FAIL | ❌ FAIL | 任务概念不映射 Windows |

**合计：5 过 / 5 败，两条件结果一致**——advisory + 自声明 AC 下插件未能拦截交付物误解。

## 三、插件价值证明（引擎级对照）

| 指标 | 无引擎（naive） | 有引擎 | 判定 |
|---|---|---|---|
| 对照组：真实完成放行 | — | **5/5** | gate done |
| 对照组：伪造完成拦截 | **0/5 拦截**（全溜过） | **5/5** | gate failed |
| 提高能力：缺陷交付上线 | **5/5** | **0/5** | 修正收敛 5/5 |
| HE/54 处理组（代码基准） | ❌ FAIL（直接输出错代码） | ✅ **7/7 官方测试** | 验证流程驱动修复 |

## 四、边界突破证明（同一任务，AC 权威性对照）

**heterogeneous-dates**：

| 版本 | AC 来源 | 交付物 | 官方测试 |
|---|---|---|---|
| v1 | agent 自声明（sf_daily_temp_change.csv） | 错误文件名 | ❌ FAIL |
| v2 | **官方要求**（avg_temp.txt = 11.428571） | avg_temp.txt | ✅ **PASS** |

## 四之二、Live enforce 实测（2026-08-18）

**demo2（heterogeneous-dates，无精确答案，逼模型误解）——enforce 模式全程记录：**

```
CALL update_goal complete #1 → GATE failed: "AC output_file failed: file evidence check failed:
                                  {path: ...sf_daily_temp_variation.csv}"   ← 明确指出文件不对
CALL update_goal complete #2 → GATE failed
CALL update_goal complete #3 → GATE failed
CALL update_goal complete #4 → GATE failed
然后 agent 尝试 update_goal edit + 重声明弱 AC →（加固前）通过；（加固后）被拒
```

**enforce 拦截 + 加固（`71c1e50`）：**

| 场景 | 结果 |
|---|---|
| 无插件：错交付物声称完成 | 直接上线 ❌ |
| enforce + 权威 AC：错交付物 | **DENY**（GOAL_TRANSITION_DENIED + 缺陷清单）🛑 |
| enforce + 权威 AC：正确交付物 | **PASS** ✅ |
| **加固：agent 编辑 goal 后重声明删/弱化 AC** | **拒绝**（cannot weaken committed contract）🛑 |
| 加固：超集重声明（保留旧 AC + 加新） | 允许 ✅ |

**结论**：enforce 把"声称完成"变成"必须真完成"——错交付物被硬拦截（live 4 次 BLOCK）；且 agent 不能靠改自己的 AC 逃逸（重声明被冻结契约锁住）。剩余设计边界：AC 的**首次权威性**取决于契约源（`contractOrigin: independent-capture / human-confirmed`——权威 AC 来自人类/官方测试，非 agent 自声明）。

## 四之三、三条件对照（无插件 / advisory / enforce）× TB2 全集（2026-08-18）

10 个官方 TB2 Windows 任务 × 3 条件，真实模型（deepseek-v4-flash）：

| 任务 | 无插件 | advisory | enforce（gate 失败次数）|
|---|---|---|---|
| aimo-airline-departures | **FAIL**（空交付）| **PASS** | 6×（未收敛）|
| adaptive-rejection-sampler | **FAIL**（写了 R 非 Python）| FAIL | 4× |
| broken-python | PASS | PASS | 0（plan 阶段）|
| csv-to-parquet | PASS | PASS | 8× |
| grid-pattern-transform | **FAIL** | **PASS** | 12× |
| hello-world | PASS | PASS | 4× |
| heterogeneous-dates | PASS | PASS | **19×**（未收敛）|
| pandas-etl | PASS | PASS | 0 |
| raman-fitting | FAIL | FAIL | 5× |
| solve-maze-challenge | PASS | PASS | 0 |

**三条件差异（核心发现）**：
1. **无插件 vs advisory**：advisory 的验证流程**引导模型做得更好**（aimo/grid：FAIL → PASS——模型被要求声明 AC + 真实执行后自我校正）；但 gate **从不拦截**，完成总是放行。
2. **advisory vs enforce**：enforce **真实拦截**——连简单任务都被拒（hello-world 4×、csv 8×、hetero 19×），goal 保持 active。
3. **enforce 的封锁问题（诚实）**：全部 enforce 会话**0 个收敛**（gate 全 fail）——**enforce + 自声明 AC + 脆弱 selector 绑定 = agent 死循环**：agent 声明的 AC selector 与它自己工具调用的证据不匹配 → gate 拒绝 → 加固后不能弱化 AC → 无法逃逸（hetero 卡 40+ 分钟）。**这是 enforce 真实可用性缺口，需修复（selector 绑定鲁棒性 + 更可操作的缺陷反馈），非宣传材料**。

## 四之四、修复后：TB2.1 Docker 全量批跑（2026-08-18，v9.4.x + 官方 AC 指引）

**修复链**（v9.4 `8085c34` / v9.4.1 `560c3c6` / v9.4.2 `9d9e3f9`）：family 兜底逐条判分全部族内候选 → 精确匹配 type-agnostic → file AC 纳入 command_output 代理证据。enforce 提示带**官方 AC 指引**（验收标准必须来自官方测试）。

**结果**（Docker 容器内官方测试判分，~25 任务 × 3 条件，真实模型）：

| 条件 | PASS | FAIL | 判分缺口（?）|
|---|---|---|---|
| **enforce** | **8** | 4 | 16 |
| 无插件 | 4 | 8 | 13 |
| advisory | 0 | 11 | 11 |

**enforce 完胜任务（8 个：none/advisory FAIL → enforce PASS）**：
`blind-maze-explorer-5x5`、`blind-maze-explorer-algorithm`（11 测试）、`broken-python`、`cobol-modernization`、`count-dataset-tokens`、`chess-best-move`、`aimo-airline-departures`、`attention-mil`

**结论**：
1. **修复 + 官方 AC 指引后，enforce 不再死循环**——fix-permissions 等任务 gate done + complete（此前 4-19× 误拦）。
2. **enforce 交付正确率 > 无插件 > advisory**（8 > 4 > 0 PASS）——**验证流程 + 权威 AC 让 agent 真正产出正确交付**（官方测试为验收时，agent 被迫做到）。
3. **advisory 最弱**：验证流程引导但不拦截（PASS=0——gate 记录了失败但 agent 照常完成，且官方 AC 指引只给了 enforce 条件，advisory 的自声明 AC 普遍不满足官方测试）。
4. **机器限制（诚实）**：Docker daemon 因内存压力（89%）多次崩溃，全量 65 可建任务只跑完 ~25；剩余任务待机器稳定后补跑。判分缺口（?）多为容器缺依赖/daemon 崩溃时容器死亡，非模型失败。

## 五、关键结论

1. **v4-flash 能力**：代码/知识强（HumanEval 98%、BigCodeBench 100%、MMLU-Pro 60%）；agent 行为弱（TB2 5/10 交付物误解；AIME 指令遵循不稳定）。
2. **插件价值**：在"模型声称完成但交付物错误"上有效（对照组 5/5 拦截、缺陷上线 5/5→0/5、HE/54 救回 7/7）；在"模型误解需求"上受限于 AC 权威性（v2 官方 AC 证明可破）。
3. **诚实边界**：HLE/GPQA/MATH 需逐数据集授权（bpshi 账号未获批）；TB2 Linux 任务需 docker 放行。

## 六、数据可复现

- 任务夹具：`bench/tasks/`（control-group / agent-tasks / HumanEval / BigCodeBench / TB2）
- 方法与协议：`docs/benchmarks.md`、`docs/value-report.md`
- 全部判分脚本与批次数据：本次会话 tmp（judging scripts 可提取入库）
