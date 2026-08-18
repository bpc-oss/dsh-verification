# 评测数据集（vendored）

| 文件 | 来源 | 许可证 | 用途 |
|---|---|---|---|
| `HumanEval.jsonl.gz` | [openai/human-eval](https://github.com/openai/human-eval)（164 题官方数据集） | MIT | live 筛查：模型按题面生成代码，用官方隐藏测试判分（对照 62/63；HE/54 为 flash 唯一失败题） |
| `bigcodebench-subset20.jsonl` | [bigcode/bigcodebench](https://github.com/bigcode-project/bigcodebench) v0.1.4（本仓库取用的 20 题子集） | Apache-2.0 | live 筛查：难题代码生成 + unittest 判分（首批 10/10 全过） |

## 使用方式（live 筛查）

任务：模型单会话输出 N 个函数（`# TASK=...` 分隔）→ 脚本切分 → 按 `prompt + answer + test + check(entry_point)` 组装 → exec 判分。

- HumanEval 判分脚本：`scripts/grade-humaneval.py`（见仓库 scripts/）
- BigCodeBench 判分：同构（unittest TestCases），见 scripts/

## 诚实声明

- 筛查为单次运行（非多次均值），无置信区间；
- 结果是"该模型在此题子集上的表现"，不是完整基准的正式成绩；
- HE/54 的"有插件"结果 = 验证流程（create_goal → set_verification_plan → 写码 → 真实运行测试 → 修复 → complete）驱动模型修复，官方测试 7/7；对照（无插件）为模型单轮直接输出，官方测试失败。
