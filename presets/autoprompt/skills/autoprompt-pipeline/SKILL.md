---
name: autoprompt-pipeline
description: Autoprompt 七阶段交付流水线操作手册——阶段 checklist、子代理 brief 模板、硬否决清单、FROZEN_DENY.resolved 附录。coordinator 在就绪两步后必读。
---

# Autoprompt Pipeline 操作手册

## 就绪检查（进入 Phase 0 前）
- [ ] 已完成两步就绪：首请求 pwsh 只读交接 → 第二请求 skill_load 本技能
- [ ] 工具面含：subagent_routed / todo_write / get_goal / create_goal / update_goal / ask_user_question / job_output / job_kill / job_list

## Phase 0 Triage
- 直通条件（全部满足）：≤3 执行步 && ≤2 文件 && 无接口/契约变更
- 硬否决（任一命中即 complex，禁止直通）：安全/权限/认证/密钥；全局配置或构建系统；数据模型/schema/迁移；生产或对外发布；删除或不可逆外部副作用；**不确定一律 complex**
- complex ⇒ `create_goal` 登记目标 + 可机器判定验收标准

## Phase 1-2 拆解与规划
- todo_write 建任务列表；每任务标注执行者（executor）与测试证据要求
- plan artifact 记录：目标、任务分解、验收标准、风险

## Phase 3 Implement —— executor brief 模板（六字段缺一不可）
```
[目标] <一句话>
[上下文] <仓库/文件/约束>
[约束] <不可越界事项>
[交付物] <文件/命令/产物清单>
[验收标准] <可机器判定条目>
[返回格式] <改动摘要+测试命令+输出证据+遗留问题>
```
派发：`subagent_routed(preset='dev', description=..., prompt=<brief>)` → job_output 收取

## Phase 4 Test
- 返回缺命令或输出证据 ⇒ 整体退回重派

## Phase 5 Independent Review
- 派发：`subagent_routed(preset='autoprompt-reviewer', tool_filter={deny:FROZEN_DENY.resolved}, description=..., prompt=<评审 brief>)`
- 评审 brief = 目标 + diff 摘要 + 测试证据 + 「输出阻塞/建议缺陷清单」
- 结果经 job_output 收取

## Phase 6 Fix Loop
- findings 回派 executor；至多 2 轮；超限 ⇒ ask_user_question；若作为子代理运行且人类通道不可用，把未决问题写入本会话最终结果

## Phase 7 Acceptance
- 验收标准逐条核证据；reviewer 结论非绿 ⇒ 回 Phase 6
- executor 子会话 id ≠ reviewer 子会话 id（记录进 artifact）
- goal 门为 advisory：不得声称被机械拦截

## 附录 A：ALLOW_REVIEWER（reviewer 目录白名单）
read, read_image, glob, grep, skill

## 附录 B：FROZEN_DENY.resolved
<!-- 构建时由 restrictableNames 导出写入（exact-name artifact），下方列表为准 -->
FROZEN_DENY.resolved v1（A8-F1 静态解析，T1b 待部署侧程序复核）：
```json
[
  "shell",
  "terminal",
  "subagent_routed",
  "knowledge_ingest",
  "dev_tool_search",
  "reset_verification_plan",
  "set_verification_plan"
]
```
说明：pwsh 及 create/update_goal、todo_write、send_message、interrupt_agent、list_agents、job_kill 均因白名单克隆未挂载而不在 reviewer 注册层，故不列入。部署侧 T1b：用 view().restrictableNames 程序比对此清单，多/少均报警。

---
> REVIEWER-PERSIST v1 (2026-08-27): autoprompt-reviewer allowlist 已含 write/edit；评审交付物（缺陷清单 JSON）必须写入 eval/reviews/ 落盘后再在最终消息引用路径（会话压缩/句柄失效不丢评审）。评审 brief 必须包含：评审结论 JSON 写入 eval/reviews/<goal>-review.json。
