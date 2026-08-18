# 测评任务清单

本目录是验证引擎的**固化测评任务**（对标 dsh-anchored-standard 的 Project2 / J-Space 报告的公认 agent benchmark 做法：冻结题面 + 客观判分器入库，可复现）。

## 任务类型

| 夹具 | 类型 | 任务数 | 判分方式 | 对标公认基准 |
|---|---|---|---|---|
| `control-group.json` | 对照组原型（文件写入/测试运行/代码修改/报告/命令） | 5 | 引擎 gate 裁决（genuine 放行 / fake 拦截） | 通用 agent 任务原型 |
| `agent-tasks.json` | agent 任务（终端命令执行 + 工具编排） | 4 | 客观 grader（python 断言） | Terminal Bench / Toolathlon |
| `datasets/HumanEval.jsonl.gz` | 代码生成（官方 164 题） | 63 筛查 | 官方隐藏测试 | HumanEval |
| `datasets/bigcodebench-subset20.jsonl` | 难题代码生成（官方 v0.1.4 子集） | 20 筛查 | unittest TestCases | BigCodeBench |
| `scenarios.ts`（bench/ 下） | 合成缺陷场景（8 缺陷 + 4 干净） | 12 | CompletionGate 裁决 | 合成基准 |

## 评测协议（对标 J-Space 报告 4.1）

1. **唯一实验变量**：对照 = 无插件（模型直接完成任务）；处理 = 有插件（验证流程：create_goal → set_verification_plan → 真实执行 → gate 裁决 → 按缺陷修复 → complete）。任务输入、判分器、环境完全一致。
2. **客观判分**：交付物用隐藏测试/grader 断言（不看模型自述）。
3. **诚实声明**：单次运行，非多次均值，无置信区间；分数为该任务集上的表现，不是正式基准成绩。
4. **引擎审计**：处理组额外记录 verdicts + gate（审计事实，可复核）。

## 已知结果（2026-08-18，deepseek-v4-flash live）

- HumanEval 筛查（无插件）：**62/63**；唯一失败 HumanEval/54（same_chars）
- HE/54 处理组（有插件）：验证流程驱动修复 → 官方测试 **7/7**（对照 0 分）
- BigCodeBench 首批（无插件）：**10/10**
- 对照组基准：真实完成 5/5 放行 · 伪造 5/5 拦截 · naive 对照 10/10 全接受
- 提高能力实验：缺陷上线 5/5 → 0/5，修正收敛 5/5

## 复现

```bash
# 对照组 + 提高能力（引擎级，无模型）
pnpm --filter @bpc-oss/dsh-verification bench

# live 筛查（真实模型，需 DSH host + 模型服务）
# 1) 用 datasets/HumanEval.jsonl.gz 构造筛查提示（# TASK 分隔）
# 2) 单会话让模型输出全部函数
# 3) scripts/grade-humaneval.py 切分 + 隐藏测试判分
```
