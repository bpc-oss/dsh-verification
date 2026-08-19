# dsh-verification

[![CI](https://github.com/bpc-oss/dsh-verification/actions/workflows/ci.yml/badge.svg)](https://github.com/bpc-oss/dsh-verification/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> Verification engine for DeepSeek Harness (DSH) agents — a port of the
> [Bobby](https://github.com/bpc-oss/bobby) "Conscience" layer.

**"Claimed done" becomes "actually done."** Before an agent can complete a goal,
every acceptance criterion must be backed by server-stamped, real tool evidence
(tool outputs, not model self-reports). The completion gate rejects unverified
completions with a defect list; advisory mode records everything without ever
blocking.

- **plan**: freeze selectors (tool + args hash) for each AC
- **work**: tool calls auto-capture as content-addressed evidence
- **complete**: each AC needs a real-evidence `pass`, else the gate returns the
  defect list
- **audit**: evidence/verdicts/gate are append-only session events, replayable

| Package | What it does |
|---|---|
| `@bpc-oss/dsh-verification` | engine: task epochs, contracts, oracles, completion gate |
| `@bpc-oss/dsh-evidence` | pure zod schemas: contracts, evidence, verdicts, selectors |
| `@bpc-oss/dsh-client-ui-verification` | client: verification settings panel |

**Benchmarks** (reproducible): synthetic recall **100%** / false-positive **0%**
(`pnpm --filter @bpc-oss/dsh-verification bench`); real-task replay audit and
completion-capability evaluation in `docs/value-report.md` and `scripts/`.

---

# 中文文档（详细）

Bobby 验证引擎移植到 DeepSeek Harness（DSH）的 Cordis 插件套件（**契约权威：v9 / v11**）。

**核心承诺：在 DSH 里，"声称完成"与"真的完成"被结构性等同。**
模型调用 `update_goal action=complete` 之前，每条验收标准（AC）必须拿到服务端标记的真实工具证据支持的 pass 裁决，
否则调用被 `tools/pre-execute` 拦截（deny + 缺陷清单），goal 保持 active。

> 移植自 [Bobby](https://github.com/bpc-oss/bobby) 的"良心层"（Conscience）。
> 设计铁律：工具直接产出的真实记录才是证据（L1/L3）；验证失败不许静默通过（L7）；
> 契约唯一真源（服务端 mint），模型不能单方面定义验收标准。

## Why verification?

让 agent 干活的框架很多，但**"声称完成"与"真的完成"之间有一条巨大的鸿沟**：

- 模型说"我做完了"，可它引用的文件根本不存在；
- 模型说"测试全绿"，可测试进程的退出码是 1；
- 模型说"已通过独立审查"，可日志里没有任何一次审查运行。

没有验证层时，这些**虚假完成**会带着未达标的验收标准一路通过到交付。这不是罕见情况——在我们自己的真实项目里，一次"完成"被闸门当场拦截：**3 条验收标准里 2 条证据不足**（`ac-research`：声称的调研文档 `No files found`；`ac-review-pass`：无任何已提交运行记录），如果引擎不介入，这个 agent 会直接宣布任务完成。

**这个插件把"完成"从口头承诺变成可审计事实：**

1. **plan 时冻结 selector**（工具 + 参数哈希）——验收标准在动手前就绑定了"用什么真实证据来证明"；
2. **执行时自动留痕**——工具调用的真实输出成为 CapturedEvidence（模型自述不作数）；
3. **完成时绑定裁决**——每条 AC 必须拿到真实证据支持的 pass，否则完成闸门拒绝并返回缺陷清单；
4. **全程可重放**——证据/裁决/闸门以 append-only 事件落盘，谁都能复核。

**它验证的不是"模型说了什么"，而是"工具真的做了什么"。** 就像 CI 的 test gate 之于代码——agent 世界的验收也要一个 gate。

**数字说话**（`pnpm --filter @bpc-oss/dsh-verification bench` 可复现）：

| 指标 | 数值 |
|---|---|
| 召回率（植入缺陷的任务被拦截） | **100%**（8/8） |
| 误报率（干净任务被误拦） | **0%**（4/4） |
| 单测 | **140** 全绿 |
| 真实案例 | 完成闸门拦截 2/3 AC 证据不足的虚假完成（详见 `docs/value-report.md`） |

默认 `mode: advisory` 只记录、永不 deny，装上不改变任何日常行为；验收/评测场景显式开 `enforce` 才启动拦截。

## 推荐 workflow（对用户与模型）

```
① 用户发一条消息说明任务（如"实现 X，附验收标准…"）
② 模型 create_goal 建立目标（创建后自动形成任务 epoch）
③ 模型 set_verification_plan(goal_id, revision) 声明验收标准（AC + 证据 selector）
④ 模型多步执行——工具调用自动留痕为 CapturedEvidence（真实输出，非模型自述）
⑤ 模型 update_goal action=complete：
     advisory（默认）：记录评估结果，永不 deny
     enforce（验收/评测）：全部 AC 拿到真实证据支持的 pass 才放行，否则返回缺陷清单
```

**关键规则**

- **只有 `create_goal` 建立任务 epoch**——epoch 是验证作用域（authorityScope）的根；
  `set_verification_plan` 必须针对**当前活跃目标**的 id + revision 调用（先 `get_goal` 确认）。
- **v11 放宽**：目标由 agent/UI 侧创建（创建前无用户消息）时，引擎以 goal create 自身为任务起点
  建立 epoch，不再 fail-closed——任何创建方式都不会导致写工具被锁死。
- 只读工具（read/grep/glob）永不拦截；日常 profile 保持 `mode: advisory`（只记录，不改变行为）。

**常见报错与处理（troubleshooting）**

| 报错 | 含义 | 处理 |
|---|---|---|
| `missing_authority_scope: no active task epoch` | 当前无活跃任务 epoch | 先 `create_goal`（建议先发消息再让模型创建），再 `set_verification_plan` |
| `missing_root_goal: no active root goal` | 未建立根目标 | 同上；先发消息说明任务 |
| `missing_root_goal: active root goal is X, not Y` | 目标 id/revision 不匹配 | `get_goal` 确认当前活跃目标后重试 |
| `missing_contract: …写入类工具…`（enforce 下） | 未声明契约就执行副作用工具 | 先 `set_verification_plan`；日常用 advisory |
| `Verification gate rejected completion: …` | 完成闸门拒绝（缺陷清单） | 按清单补真实工具证据，修复后重试 `update_goal complete` |

## 包

| 包 | 作用 |
|---|---|
| `@bpc-oss/dsh-evidence` | 纯类型：CapturedEvidence/BoundEvidence 两态、SelectorV1（exact-only）、sourceBasis/ContractRef 五元组身份、规范化哈希 |
| `@bpc-oss/dsh-verification` | host 插件：goal-bound task epoch、契约权威（独立捕获/人类确认）、内容寻址 blob、完成闸门 + CompletionPermit + strict replay、T0–T4 裁判、冻结规则 |
| `@bpc-oss/dsh-client-ui-verification` | client 插件：契约卡片（含 frozen selector）/逐 AC 裁决/证据面板/设置节 |

## 安装

```bash
pnpm install && pnpm -r build && pnpm -r test
```

挂到 DSH profile（示例 `presets/verification.cordis.yml`）：

> ⚠️ `@bpc-oss/*` 未发布到 npm（npm 上 404），不能用包管理器直接安装。
> 从 GitHub 仓库 bpc-oss/dsh-verification 获取源码即可：本仓库已提交构建产物
> `packages/*/lib/`（index.js / index.d.ts / index.js.map），clone 后无需构建、直接可用。
> 挂载方式：用 cordis.patch.yml 的 insert 以仓库内相对路径挂载
> host 插件 `packages/dsh-verification/lib/index.js`、client 插件 `packages/dsh-client-ui-verification/lib/client.js`（headless 下 disabled），
> 并把 `presets/verification.cordis.yml` 作为 patch 层引入。

## 工作方式（v9）

```
create_goal（bootstrap 白名单，建 goal-bound epoch；rootSeq = create 前最近权威用户消息）
  → set_verification_plan(goal_id+revision)（只 attach active root；服务端收集 sourceBasis →
      独立捕获（grader 以 basis 为唯一输入）或 questionId 人类确认 → 服务端 mint ContractRef）
  → 多步执行：tools/post-execute 派生 **CapturedEvidence（无 acId）**→ 内容寻址 blob（原子写）→ evidence 记录
  → update_goal complete：tools/pre-execute
      enforce：评估（异常 → deny evaluation_error）→ 服务端 binder（exact-only selector，
               最高 committed seq，一证据一 AC）→ 裁判 → 禁令 → 闸门
               → done 才解析 goal_id/revision → mint durable CompletionPermit → 放行
      advisory：包住整个 evaluate（异常记 evaluation_error），只 next 一次，永不 deny
```

身份：`contractIdentity = {contractId, revision, contractContentHash, basisHash, sessionId}`（五元组）。
证据/裁决持久化携带；gate 逐字段全等；Blob 缺失/损坏/版本未知 → fail closed。

## 两处上游 seam（决策门落地状态）

| seam | 状态 | 影响 |
|---|---|---|
| **GoalTransitionGuard**（GoalService 同步 pre-commit 校验 + complete 事件 `permitRef` 归因 + 事件解码器接受 attribution） | **已在 workspace 落地为可复现补丁**（`vendor/@deepseek-ai/dsh-goal` + `scripts/patch-vendored-goal.cjs`，即上游 PR 稿；通过 `pnpm-workspace.yaml` 的 `overrides` 生效）。**守护仅在 enforce 安装**（v9.2：advisory 安装 guard 会把"永不 deny"打成 `GOAL_TRANSITION_DENIED`）。验证：`test/seam-e2e.test.ts` 挂载**真实 GoalService**，证明 enforce 下直接 `ctx.goals.complete()` 绕过→`GOAL_TRANSITION_DENIED` 且零 mutation；合法 prepare→complete 成功且 `permitRef` 归因；stale revision→拒绝；注销 guard 与 **advisory 模式**→向后兼容放行；strict replay（envelope 权威）通过 | 上游合入前，本 workspace 内 enforce 具备完整强制边界（含第三方直接调 goal 的路径）；advisory 完整永不放行所拒 |

**契约权威（v9.2 硬化）**：enforce 下 `set_verification_plan` 只有「独立捕获成功」或「人类确认成功（需 askUser 通道）」两条正当路径；捕获失败/无确认通道 → **显式拒绝且不 mint 契约**（origin 如实标注：`independent-capture` / `human-confirmed` / `model-self-declared`；advisory 走降级时 origin 必须为 `model-self-declared`）。selector 冻结仍从执行者提案按 AC id 回填（grader 无法预测工具参数），grader prompt 要求保留 AC id（机制非语义）。
| **authorityIsolation**（T2 reviewer 零 parent preset/零 tool 隔离） | rc.6 无 capability | `proReview.enabled` 默认 **false**；显式开启而 provider 无该能力 → 该 AC 判 `need_evidence`（fail closed，不伪造隔离） |

> 说明：GoalTransitionGuard 补丁按"进程级单例注册表"实现（GoalService 为 host 单例；cordis `ctx.get` 的服务代理会让按实例 key 的注册表失配）；补丁向后兼容（无 guard → 原放行语义），并让 goal 域严格解码器接受可选 `permitRef` 字段。

## 定位（P0-1 review：可选插件，不改变日常开发）

**价值域 = 验收/评测，不是日常开发默认门槛。** 插件既不默认拦截读（read/grep/glob 永不拦），
也不默认开启 enforce。默认 `advisory` —— 只记录，永不 deny，装上不改变任何行为；只有验收/评测
场景（CI、测试门禁）显式 `mode: enforce`。更像 CI/CD 的 test gate，而不是 IDE 的 linter。

## 配置（选录；完整见 presets 与 `src/index.ts`）

- `mode`: `advisory`（默认，记录+放行，never-deny）/ `enforce`（验收/评测显式开启；无契约时仅
  写入类工具 deny missing_contract，只读工具 read/grep/glob 永不拦）
- `binderFamilyFallback`（默认 `true`）：file 族 AC 精确 selector 无有效证据时，允许用作用域内
  同族真实文件证据（file_diff/file_exists/quote_with_location 互认）兜底裁决（裁决 detail 注明，
  可审计），避免"交付物由 write/edit 产生而 selector 冻结成 glob/read"导致的假阴性；安全严格场景可关
- `maxCapturedEvidence`（200）/ `maxCapturedBytes`（20MB）——超限写 durable capture-failure，gate fail closed
- `completionPermitTtlMs`（30s，冻结进 configHash；replay TTL 由 SessionEvent envelope 权威派生）
- `intent.contractOrigin`: `independent-capture` / `human-confirmed`（人类确认复用 dsh approval 通道）
- `intent.consensusCount`: 0..3（>1 开启 Bobby structured-consensus 多数决）
- `intent.readOnlyToolAllowlist`：只读工具显式表（DSH 真实名）；拦截已改为只作用于
  `intent.writeTools`（明确写入类：edit/write/shell/bash/pwsh/...）。只读/未知工具永不拦

## 真机冒烟验证（2026-08-15，`--profile verify` 真实会话，strict rules 终验）

以真实本地 vLLM（dgx-spark-vllm）跑通 DSH headless 全程，durable session log（`docs/smoke-evidence/session-final11.jsonl`）为**唯一权威**的事件链：

```
create_goal（goal-bound epoch）
  → set_verification_plan：grader（独立捕获，legitimate origin=independent-capture）mint 五元组契约，
    冻结 exact selector read<file_path>→file_diff（selector 按 AC id 从执行者提案回填）
  → read artifact.txt 捕获 quote_with_location（path 修复后绑定成功）
  → verdicts: ac1 T0 pass → gate status=done (enforce)
  → verification/change kind=permit（permit-mstib960-qxrngb9k, seq1508）
  → goal/change operation=complete 携带 "permitRef"（seq1509；GoalTransitionGuard 盖章，permit<complete）
```

该轮也实证了铁律的活例：**执行方模型自述"无 permitRef/未 mint 契约"是被权威日志证伪的**——模型自述不作证据，日志才是（连验收者也一样）。

## v9.2 硬化（独立复审 S1/S2/S3 修复）

- **S1-1** advisory 不再安装 GoalTransitionGuard（seam"不注册即默认放行"的向后兼容语义）——advisory 永不放行所拒；`test/seam-e2e.test.ts` 新增 mode 接线端到端测试。
- **S1-2** enforce 下契约成立只有「独立捕获成功」或「人类确认成功（需 askUser）」二选一：捕获失败/无确认通道 → 显式拒绝且不 mint；`origin` 如实标注（新增 `model-self-declared` 仅用于 advisory 降级标签）。grader 输出经 `witness-id` 绑定提示 + **lenient JSON 候选提取/keys 归一化（snake_case 容忍）** + enforce 下有界重试（3 次）——对非确定性 LLM 的正确补偿，非降级。
- **S2-1** FileDiffOracle 收紧：desc 含 "contains/include <text>" 时必须核对内容包含该子串，不再"有任何内容即 T0 pass"。
- **S2-2** 部署级 globalConstraints 与 `network:` 禁令真正接线到 gate（此前 fail-open）：global 禁令并入 gate 执行；network 型工具调用由证据采集插件记录。
- **S3** 控制面工具（update_goal/verification 工具等）不再误产证据；`read` 的 `file_path` 参数纳入 path 提取；reset 工具说明对齐实际语义。
- 全量自检：typecheck 0；测试 dsh-evidence 44 / dsh-verification 106 / dsh-client-ui-verification 11 = **161 全绿**。

## v9.3 集成方反馈修复（2026-08-15，BUG-REPORT 5 项）

- **#1 投影 schema 契约统一（P0）**：`TaskEpochRecordSchema` 与 `FoldedEpoch` 对齐（`createdSeq` 必填、`closedSeq` 可选、`contentHash` 改 optional）；`view()` 经 `taskEpochViews` 白名单输出真实字段，不再以空串/假 hash 兜底。含 goal/change 事件的会话历史从此可正常加载。回归测试：`test/projection-view.test.ts`。
- **#2 设置面板 nav 空白（P1）**：`settings.section` 注册补 `order:25` + `label` + `inject:{t}`；SettingsPanel 无会话时渲染占位而非空白。
- **#3 工具拦截拆分（P0 默认行为）**：新增独立开关 `intent.requireContractBeforeExecution`——"未声明契约是否拦截副作用工具"不再与完成门禁耦合（enforce 默认 true 保持验收语义；日常 profile 设 advisory 或显式 false 即可）。web profile 现配置 `mode: advisory`。
- **#4 客户端 bundle 协议（P1 构建）**：构建期产出 `window.__ModuleLoader__.load({id, factory(require){…}})` 单文件（`tsup splitting:false` + `scripts/wrap-loader.cjs`）；真机校验 GUI `/plugins/@bpc-oss/dsh-client-ui-verification/client.js` 200 且为协议格式。
- **#5 上游会话 seq 竞态**：非本仓库因果，按帧修补记录；根治待 dsh 上游。
- 全量自检：typecheck 0；测试 dsh-evidence 44 / dsh-verification 117 / dsh-client-ui-verification 11 = **172 全绿**；三处部署位（web/verify vendor + DSH 安装）已同步仓库构建。

真机接入要点：profile 内只装 `@deepseek-ai/cordis` + `@deepseek-ai/schemastery`（+ 本插件 link），**不得**安装任何 `@deepseek-ai/dsh-*` 运行时依赖（符号分裂 → 工具调度 `reading 'prepare'` 崩溃）；插件经 `cordis.patch.yml` 的 `insert:` 以 profile 内相对路径 `<repo>/packages/dsh-verification/lib/index.js（构建产物已提交，clone 后直接可用；旧文档里的 ./vendor-pkgs 路径在本仓库不存在）` 挂载（客户端插件指向 `lib/client.js`，headless 下 disabled；enforce 无人类通道时须在插件 `config.intent` 里 pin `provider`/`model` 使 grader 可用）。completion 事件 `permitRef` 归因依赖 GoalTransitionGuard seam 补丁副本，已应用到安装目录（原版备份于 `$DSH_HOME/backups/dsh-goal-install-20260815/`；GUI web 进程需重启后生效）。

## 测试

- dsh-evidence：两态 schema、ContractRef/basis/身份、selector 规范化、evidence 推导
- dsh-verification：task-epoch（goal 绑定/close/并发/崩溃重建）、strict replay permit（envelope 权威 TTL/漂移/过期）、binder（exact-only/最高 committed seq/缺失 blob）、契约权威、完成路径集成、hook（deny/allow/missing_contract/advisory never-throw/冻结）、**反说谎对抗回归集**（无证据硬拦、失败测试硬拦、`echo` 冒充、旧 PASS 不回退、blob 缺失、弱契约不裸奔）
- dsh-client-ui-verification：格式化 + 组件渲染

## License

Apache-2.0
