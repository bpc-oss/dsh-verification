# 真机冒烟证据（2026-08-15，两轮）

## 终验轮（final11，strict rules 最终版）—— **全链路通过**

`session-final11.jsonl`（session `ddda0609-…`）权威事件链：

| seq | 事件 | 内容 |
|---|---|---|
| 66/113 | verification/change kind=plan | 契约已 mint（origin=independent-capture；grader 在本机 vLLM 上经 `witness-id binding` + snake_case 归一化 + 有界重试成功） |
| 1504 | verification/change kind=verdicts | ac1 → **oracleTier T0、result pass**（claimId `call_00_kWjSanR7tCUQTRyclrB50610`，read 证据成功绑定） |
| 1505/1507 | verification/change kind=gate | **status=done**、mode=enforce、reasons=[] |
| 1508 | verification/change kind=permit | `permitRef=permit-mstib960-qxrngb9k`、goalId/goalRevision/contractIdentity（五元组）/hash 齐备 |
| 1509 | goal/change operation=complete | **`"permitRef":"permi…"` 已盖章**（permit seq 1508 < complete seq 1509） |

结论：enforce 严格语义下——契约权威（独立捕获）→ 冻结 selector → 证据捕获（read 的 `file_path` path 修复）→ T0 裁判 → gate done → durable CompletionPermit → GoalTransitionGuard 盖章 → complete。**模型自述"无 permitRef"为误读，权威日志为准。**

`final11.log`：agent 终验报告（自述与权威日志不一致处以上述 jsonl 为准）。

## 早期轮（final5 参考）

`situation-final5`：契约 origin、permit（`permit-mstd8ib6-o80gp2lt`）与 complete 链的证据（该轮 grader 未 pin，plan 未经权威捕获路径）。

## 背景说明

- agent 报告（final11.log）声称"未 mint 契约 / 无 permitRef"：与权威 jsonl 矛盾。实现/文档以 durable session log 为唯一权威；这正是"模型自述不作证据"的活例子（连验收者自己也要被日志证伪）。
- 复现命令：`dsh --profile verify <prompt>`（profile `~/.dsh/profiles/verify`；vendored dsh-goal 补丁已应用；grader 经插件 config 钉到本地 vLLM `dgx-spark-vllm`）。
