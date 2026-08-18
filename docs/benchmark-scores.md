# 跑分对比表（deepseek-v4-flash，2026-08-18 实测）

> 全部真实运行：DSH 会话 + 官方隐藏测试/判分器。单次运行声明。协议：唯一变量 = 是否加载验证插件（有/无插件对照）。

## 一、模型能力分数（公认基准，无插件）

| 基准 | 题目数 | 分数 | 判定方式 | 参考（同档模型） |
|---|---|---|---|---|
| **MMLU-Pro**（验证集） | 70 | **60.0%**（42/70） | 字母答案精确匹配 | flash 档 ~50-60% |
| **HumanEval** | 63（筛查） | **98.4%**（62/63） | 官方隐藏测试 | flash 档 ~60-90% |
| **BigCodeBench**（首批） | 10 | **100%**（10/10） | 官方 unittest | flash 档 ~30-40%（本模型超预期） |
| **AIME**（aimo-validation） | 90 | 部分（1/5 批 14/18） | 整数精确匹配 | flash 档 ~10-20%（格式不合规致解析受限） |

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

## 五、关键结论

1. **v4-flash 能力**：代码/知识强（HumanEval 98%、BigCodeBench 100%、MMLU-Pro 60%）；agent 行为弱（TB2 5/10 交付物误解；AIME 指令遵循不稳定）。
2. **插件价值**：在"模型声称完成但交付物错误"上有效（对照组 5/5 拦截、缺陷上线 5/5→0/5、HE/54 救回 7/7）；在"模型误解需求"上受限于 AC 权威性（v2 官方 AC 证明可破）。
3. **诚实边界**：HLE/GPQA/MATH 需逐数据集授权（bpshi 账号未获批）；TB2 Linux 任务需 docker 放行。

## 六、数据可复现

- 任务夹具：`bench/tasks/`（control-group / agent-tasks / HumanEval / BigCodeBench / TB2）
- 方法与协议：`docs/benchmarks.md`、`docs/value-report.md`
- 全部判分脚本与批次数据：本次会话 tmp（judging scripts 可提取入库）
