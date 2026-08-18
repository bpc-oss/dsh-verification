# 公认 agent benchmark 评测记录

本文件记录验证插件在 9 个公认 agent benchmark 上的评测现状（对标 J-Space 报告 / dsh-anchored-standard 的做法：冻结题面 + 客观判分 + 有/无插件对照 + 诚实声明）。

## 评测协议（统一）

1. **唯一实验变量** = 是否加载验证插件（对照/处理）。
2. 判分 = 各基准官方隐藏测试 / grader（不看模型自述）。
3. 单次运行声明，无多次均值、无置信区间。
4. 处理组额外记录引擎审计（verdicts + gate，可复核）。

## 9 基准逐一现状

| # | 基准 | 官方源 | 类型 | 现状（2026-08-18） |
|---|---|---|---|---|
| 1 | **Terminal Bench 2.x** | tbench（112 题数据集已 vendor 至 `bench/tasks/datasets/tb2/`） | 终端命令执行 | ✅ **Windows 子集 10 任务已跑**（5 过 5 败 + 1 异常；败因=交付物误解）|
| 2 | **HLE**（Humanity's Last Exam） | huggingface.co/datasets/cais/hle | 知识+推理 | ⚠️ **数据集受限**（需 HF 认证）；已转跑公开同类基准 |
| 3 | **Agents' Last Exam** | scale 发布 | 异构 agent 任务 | ⚠️ 数据集受限（同上）|
| 3b | **MMLU-Pro**（替代 HLE 的公开知识基准） | TIGER-Lab/MMLU-Pro | 知识+推理 | ✅ **已跑 70 题验证集：60.0%**（42/70，真实分数）|
| 3c | **AIME**（公开数学竞赛基准） | AI-MO/aimo-validation-aime | 数学竞赛 | ⚠️ 90 题已跑；仅 1 批格式合规（14/18），其余 4 批模型陷入暴力推理未按答案格式输出（解析不可靠）→ 诚实记录为"部分" |
| 4 | **Toolathlon** | hkust-nlp/Toolathlon | 工具编排+可验证 | ❌ 需官方 harness（ICLR 2026）|
| 5 | **DeepSWE** | Whamp/deep-swe-bench（pi harness） | 软件工程 | ❌ 需 pi harness + 真实 repo + 隐藏测试 |
| 6 | **NL2Repo** | 论文仓库 | 自然语言→仓库 | ❌ 需 harness + Docker |
| 7 | **AutomationBench** | zapier/AutomationBench | 业务工作流 | ❌ 需官方 harness（Zapier 场景）|
| 8 | **CyberGym** | CyberGym 套件 | 网络安全 agent | ❌ 最重（CTF 安全环境）|
| 9 | **NL2Repo/CyberGym** | — | — | — |

## 本环境能力边界（诚实）

- **模型访问**：deepseek-v4-flash 经 DSH host（bai provider）的 agent 会话可用；**批量直连 API 不可用**（BAI_API_KEY 在 host 进程，本 shell 无）→ HLE/ALE 批量跑受限。
- **Docker**：build 可用；**run 被供应链策略拒绝**（T3 需审批，本会话审批关闭）→ TB2 Linux 任务（QEMU/内核/网络等）无法在容器内跑。
- **Windows 环境**：TB2 只有纯 Python/数据类任务可忠实跑（已尽数执行）。

## 已得的真实数据（可复现）

- **TB2 Windows 子集（10 任务 × 有/无插件）**：见 `docs/value-report.md` §五之七/八。
  - 5 过：aimo-airline / csv-to-parquet / grid-pattern-transform / pandas-etl / hello-world
  - 5 败：heterogeneous-dates / solve-maze / raman-fitting / broken-python（+ ars 会话异常）
  - **核心结论**：失败模式 = 交付物误解；advisory + 自声明 AC 下插件未能拦截；**权威 AC（官方要求）可破**（heterogeneous-dates v2: FAIL → PASS，value-report §五之八）。
- **代码基准筛查**：HumanEval 62/63、BigCodeBench 首批 10/10（HE/54 处理组 7/7 救回）。
- **对照组/提高能力基准**：见 `bench/task-suite.test.ts`（缺陷上线 5/5→0/5、修正收敛 5/5）。

## 全量 9 基准的推进路径（独立专项）

1. **模型 API 通道**：配置一个可从脚本直连的模型端点（或导出 BAI_API_KEY 给评测进程）→ 解锁 HLE / Agents' Last Exam 子集批量跑。
2. **Docker 沙箱**：将 TB2 官方 runner（tbench）接入，在容器内跑 Linux 任务（需解除供应链策略对 docker run 的限制，或走白名单）。
3. **官方 harness 集成**：Toolathlon / DeepSWE / AutomationBench / NL2Repo / CyberGym 各装官方评测框架，把 AC 定义为官方隐藏测试（independent-capture 契约源），验证插件在验收层的价值。
