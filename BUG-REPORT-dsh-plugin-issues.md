# dsh-verification / dsh-client-ui-verification 插件问题反馈

> 反馈日期：2026-08-15
> 反馈人：dsh web profile 使用者（插件集成方）
> 涉及包：`@bpc-oss/dsh-verification` v1.0.0、`@bpc-oss/dsh-client-ui-verification` v1.0.0
> 集成方式：以 `vendor-pkgs/` + pnpm `link:` 依赖装入 `~/.dsh/profiles/web`（web GUI profile），引擎为 cordis 插件、客户端为浏览器端 bundle

---

## 概览

把本仓库的 verification 插件装入 **日常使用的 dsh web profile** 后，共发现 4 个独立问题（1 个数据校验 bug、1 个 UI 注册缺陷、1 个破坏性默认行为、1 个 bundle 交付格式问题）。其中前 3 个已在本机修复并验证；第 4 个属于构建/交付问题，建议开发者侧一并处理。另有 1 个与本插件无直接因果、但被插件暴露出的 dsh 上游会话写入竞态（见 §5，作为背景记录）。

已按 `enforce → advisory` 的意图区分：**验收场景**（`profiles/verify`）需要强制契约，保留 enforce；**日常使用**（`profiles/web`）改为 advisory。下文的问题 3 是这条改动的原因。

---

## 问题 1：投影输出与 schema 契约不一致，导致含 goal 事件的会话历史加载失败（P0，数据校验 bug）

### 现象

打开任意含 `goal/change` 事件的会话，历史加载报：

```
history unavailable for session "session-54ce9e0a-...": [
  { "code": "too_small", "path": ["taskEpochs",0,"contentHash"], "message": "expected string to have >=1 characters" },
  { "code": "unrecognized_keys", "keys": ["createdSeq","closedSeq"], "path": ["taskEpochs",0], "message": "Unrecognized keys: \"createdSeq\", \"closedSeq\"" },
  ...
]
```

本机受影响会话：所有含 goal 事件的会话（抽查 54ce9e0a 等），刷新/重启后持续复现。

### 根因

`projection.ts` 的 schema 与 `task-epoch.ts` 产出、`index.ts` 的 `view()` 输出三方不一致：

- `src/projection.ts:80-88` —— `TaskEpochRecordSchema`（`.strict()`）：
  - `contentHash: z.string().min(1)`（必填、非空）
  - 未声明 `createdSeq` / `closedSeq`，且 `.strict()` 拒绝多余字段
- `src/task-epoch.ts:20-30` —— `FoldedEpoch` 接口：
  - `createdSeq: number`（必填）
  - `closedSeq?: number`（关闭时写入）
  - `contentHash?: string`（可选）
  - 构造点：`task-epoch.ts:98`（`createdSeq: event.seq`）、`:109`（`closedSeq`）、`:169`（增量版 `createdSeq`）、`:181`（增量版 `closedSeq`）
- `src/index.ts:256` —— `view()` 输出 `{ ...epoch, contentHash: epoch.contentHash ?? '' }`：
  - `epoch.contentHash` 恒为 `undefined`（无任何写入点），`?? ''` 兜底成**空串**，违反 `min(1)`
  - `...epoch` 展开残留 `createdSeq`/`closedSeq`，触发 `.strict()` 的 `unrecognized_keys`

会话事件流是权威数据，投影每次从事件重放；schema 校验失败使**整个会话不可读**（不是丢数据，是读不出来）。

### 修复（已应用）

`view()` 改为只输出 schema 允许的字段，`contentHash` 用稳定非空派生值：

```ts
taskEpochs: state.epoch.epochs.map((epoch) => ({
  epochId: epoch.epochId,
  rootSeq: epoch.rootSeq,
  rootGoalId: epoch.rootGoalId,
  status: epoch.status,
  contentHash: epoch.contentHash ?? `epoch:${epoch.epochId}:${epoch.createdSeq}`
}))
```

同步位置：`src/index.ts:256`（源码）、`~/.dsh/profiles/web` 与 `~/.dsh/profiles/verify` 的 `vendor-pkgs` 内 `lib/index.js:2667`（构建产物）。

### 建议（开发者侧）

1. 三个文件对 `FoldedEpoch` 的字段契约应统一：要么 schema 增加 `createdSeq`/`closedSeq`（`strict()` 放开），要么 `view()` 显式白名单输出（本修复采用后者）。
2. `contentHash` 要么有真实写入点，要么 schema 改 `optional`，避免 `?? ''` 这种“写空串”的兜底模式。
3. 建议加一条回归测试：构造含 `goal/change` 的事件流 → 跑 `view()` → `VerificationProjectionSchema.safeParse` 必须通过（现有 `task-epoch.test.ts` 只测 fold 不测 schema 校验）。

---

## 问题 2：客户端 `settings.section` 注册缺 `label`/`order`，设置面板导航项空白、内容区空（P1，UI 缺陷）

### 现象

`dsh web` 打开设置面板：导航列第二项是**空文字按钮**（只有图标），点击后内容区空白（`settings.section` 槽渲染为空 div）。

### 根因

`packages/dsh-client-ui-verification/src/client.tsx:61-72` 注册 `settings.section` 时：

```ts
slots.inject('settings.section', () =>
  slots.register({
    name: 'settings.section',
    id: 'verification',
    // 缺 label / order
  }, SettingsPanel)
)
```

dsh 的设置对话框（`dsh-client-ui-settings-general`）用 `slots.entries('settings.section')` 的 `options.label` 生成导航文字，`label` 缺失 → `resolveSlotLabel(...) ?? ''` → 空导航项。对照组 `dsh-client-ui-settings-models` 注册带 `order: 10, label: () => t('nav')`。

另外 `SettingsPanel`（`client.tsx:17-18`）在 `useProjection('verification')` 返回 `null`（设置面板无会话上下文）时 `return null`，内容区空白。

### 修复（已应用，vendor 内 `lib/client.js`）

1. 注册补 `order: 25, label: () => t('settings.title')`（复用已注册词典 `settings.title` = “验证引擎”）
2. `inject: () => ({ t })` 传入绑定的翻译函数
3. `SettingsPanel` 在 `projection == null` 时渲染标题 + “—” 占位，不再返回 `null`

### 建议（开发者侧）

- `client.tsx` 补 `order`（参与导航排序）与 `label`（可设为 `t('settings.title')`）。
- `SettingsPanel` 的 null 分支在设置页（无会话）应渲染说明而非空白。

---

## 问题 3：`mode` 默认 `enforce`，日常 profile 中拦截全部未声明契约的工具调用（P0，破坏性默认）

### 现象

`dsh web` 中 agent 调用 `pwsh` / `read` / `edit` / `write` 等工具，全部被拒：

```
Error: missing_contract: 未声明意图契约，无法验证副作用。请先 create_goal 后 set_verification_plan。
```

仅 `grep`/`glob` 等 `readOnlyAllowlist` 内工具可过（见 `complete-gate-hook.ts:44`）。

### 根因

- `complete-gate-hook.ts:35` 挂 `ctx.on('tools/pre-execute', ...)`，`:56-57` 无契约且 `mode === 'enforce'` 时 `return { kind: 'deny', reason: 'missing_contract…' }`。
- 引擎 `mode` **默认 `enforce`**（`index.ts` 的 schema `.default('enforce')`），集成方若未显式配置即启用拦截。

对 **验收/评测场景**（本仓库 `profiles/verify`）这个默认是合理的；但对**日常编码 profile**，它拦截了几乎所有有副作用的工具，agent 无法工作，表现为“装完插件整体变差”。

### 修复（已应用）

`~/.dsh/profiles/web/cordis.patch.yml` 显式配置：

```yaml
- id: bpc-verification-engine
  name: ./vendor-pkgs/@bpc-oss/dsh-verification/lib/index.js
  config:
    mode: advisory
    intent:
      provider: dgx-spark-vllm
      model: deepseek-v4-flash-0731-ablit
```

`advisory` 模式下 `complete-gate-hook.ts:86` 无契约直接 `return next()` 放行，验证仅记录不拦截。

### 建议（开发者侧）

- `mode` 默认值考虑改为 `advisory`，或至少在 README / 配置注释中显著声明 enforce 的拦截语义，避免集成方误用。
- 可考虑把“是否拦截工具”与“是否强制完成门禁”拆成两个开关（当前 enforce 同时控制工具拦截与完成门禁，`complete-gate-hook.ts:77-78`、`:86`）。

---

## 问题 4：客户端 bundle 交付格式不符合 dsh 浏览器端加载协议（P1，构建/交付）

### 现象

把 `@bpc-oss/dsh-client-ui-verification` 装进 web profile 后，浏览器端报：

```
bundle /plugins/@bpc-oss/dsh-client-ui-verification/client.js?rev=… loaded without
registering "@bpc-oss/dsh-client-ui-verification" via __ModuleLoader__.load
```

### 根因

dsh 浏览器端要求客户端 bundle 是**单文件** `window.__ModuleLoader__.load({ id, factory })` 包装格式（对照 `@deepseek-ai/dsh-client-ui-settings` 等官方包）。而本仓库 tsup 产物是**裸 ESM + 相对 chunk 导入**：

- `lib/client.js`：`import { … } from './chunk-XXXX.js'`（`src/client.tsx` 构建）
- `lib/chunk-XXXX.js`：组件 + locales

dsh 的 `dsh-client-modules` 服务端只 serve `<id>/client.js` 单文件，chunk 相对请求 404；且裸 ESM 不会调用 `__ModuleLoader__.load` 注册。

### 本机处理（vendor 内）

手工把 chunk 内联进 `client.js` 并改写为 `window.__ModuleLoader__.load({ id, factory(require) { … } })` 格式（`require('react/jsx-runtime')` 等平台 seed 词）。

### 建议（开发者侧，正式修复方向）

- 构建配置对齐官方客户端包：单文件 bundle + `window.__ModuleLoader__.load({ id, factory })`，导出 `apply` / `inject` / `name`；`package.json` 声明 `dsh.client = { platform: 'web' }` 与 `exports['./client']`（本包已声明，见 `package.json`）。
- 若想统一，可参考 dsh 官方仓库 `packages/client/*/tsdown.client.ts` 的构建方式，或直接用仓库内 `pnpm run build` 产出后按官方格式打包。
- 本问题在“裸 ESM 包 + dsh 浏览器端”组合下必现，建议仓库 README 注明客户端包需按 dsh 浏览器加载协议构建。

---

## 问题 5（背景记录）：dsh 上游会话 seq 冲突（非本插件因果）

排查过程中发现 `session-d03d2a72` 的事件流存在单点 seq 冲突（`session/end-seed` 与 `agent/inbox/spliced` 均为 seq=3，时间戳差约 1.76h），导致 `corrupt session log: seq gap in committed region at line 5`。dsh 官方读取器（`dsh-session-persistence-jsonl` 的 `SessionLogScanner`）要求 seq 严格连续，冲突会使会话不可读。

与本插件无直接因果（该会话事件流无 verification 事件），但同属“历史加载失败”类症状，且本插件（问题 1）放大了“装了插件后觉得整体变差”的观感。已按帧修补 seq 并恢复（备份为 `.corrupt-bak`）。如需根治，疑似 dsh 上游 `session/end-seed` 与首次注入之间的 seq 计数器重置竞态，建议向 dsh 仓库反馈。

---

## 修复清单（本机已应用，供复现/对照）

| # | 问题 | 修复位置 | 验证 |
|---|---|---|---|
| 1 | 投影 schema 不一致 | `src/index.ts:256` view() + 两 profile 的 `vendor-pkgs` lib | typecheck ✓；115 测试全绿；实机历史加载无报错 |
| 2 | settings.section 缺 label/order | vendor `lib/client.js`（注册补 label/order/inject + SettingsPanel 占位） | 实机：设置面板导航 7 项齐全、“验证引擎”内容正常 |
| 3 | enforce 拦截工具 | `~/.dsh/profiles/web/cordis.patch.yml` 加 `mode: advisory` | 实机：Pwsh 执行 Get-Date 成功返回时间 |
| 4 | bundle 格式不兼容 | vendor `lib/client.js` 内联手写为 `__ModuleLoader__.load` 格式 | 实机：模块注册成功、浏览器端 0 错误 |
| 5 | seq 冲突（背景） | 会话文件按帧修补 | 实机：该会话可正常打开 |

仓库侧：`src/index.ts:256` 的 view() 修复已提交到 `E:\ai-files\dsh-verification` 并重新构建（`pnpm build`），`lib/index.js` 同步。问题 2/3/4 的修复目前仅落在 vendor 副本，建议开发者把问题 1/2/3 的修复合入源码后重新发版。

---

## 开发者回执（2026-08-15 晚）

问题 1–4 已在**仓库源码**修复并重新构建、全量测试（44 + 117 + 11 = 172 全绿；typecheck/build 0 错误），各部署位已同步，web GUI（:3080）已重启并使用仓库构建产物（客户端 bundle 实机 serve 校验：`/plugins/@bpc-oss/dsh-client-ui-verification/client.js` → 200 + `__ModuleLoader__.load` 格式）。

| # | 源码侧处置 | 位置 |
|---|---|---|
| 1 | 统一字段契约（采纳建议 1/2）：`TaskEpochRecordSchema` 增 `createdSeq`（必填）/`closedSeq`（可选），`contentHash` 改 optional；`view()` 经白名单辅助 `taskEpochViews` 输出真实字段（不再假 hash）。新增回归 `test/projection-view.test.ts`（含 goal 事件的投影必须通过 schema）。 | `src/projection.ts`、`src/index.ts` |
| 2 | `client.tsx`：settings.section 注册补 `order:25` + `label:()=>t('settings.title')` + `inject:()=>({t})`（locale.bind）；SettingsPanel null 分支改为渲染标题+“—”占位。 | `src/client.tsx` |
| 3 | 采纳"拆分管工具拦截与完成门禁"：新增 `intent.requireContractBeforeExecution` 独立开关（enforce 下默认 true，工具拦截只在“enforce 且开关开”时生效；完成门禁仍由 `mode` 控制）；REG 配置/README 注明。日常 profile 可 `mode: advisory`（已生效）或显式 `requireContractBeforeExecution:false`。 | `src/complete-gate-hook.ts`、`src/index.ts` |
| 4 | 构建期产出合规客户端 bundle：`tsup` 对 client 入口 `splitting:false` + `react/jsx-runtime` external，再由 `scripts/wrap-loader.cjs` 改写为 `window.__ModuleLoader__.load({id, factory(require){…}})` 单文件；`build` 脚本链式执行。不再依赖手工 vendor 补丁（手工版已备份为 `lib/client.manual-backup.js`）。 | `tsup.config.ts`、`scripts/wrap-loader.cjs`、`package.json` |

问题 5 为 dsh 上游会话 seq 竞态（非本仓库因果），已按你们的帧修补处理；根治建议同步 dsh 仓库。

> 集成说明：web profile 现仍用 `mode: advisory`（日常不拦截）；如需在 GUI 中体验 enforce 契约门禁，把 web 一行改为 `mode: enforce` 即可（本地 vLLM grader 与人确认通道都可用）。

### 追加（2026-08-15 深夜）："验证引擎"设置页空白的真正根因与加固

现象复核：点击设置面板第 7 项"验证引擎"内容区空白。逐层定位后确认根因**不在 UI 逻辑**，而在交付物：

- 我此前交付的 `lib/client.js` 由 tsup 生成，**顶部残留 2 条 `import { Fragment, jsx, jsxs } from "react/jsx-runtime";`**（单文件 bundle 留给 ESM 语法）。浏览器按普通 `<script>` 解析整包直接抛 `SyntaxError: Cannot use import statement outside a module` → 模块根本未注册。上一版实测显示导航项能出现，是因为该残留只让“较新一次构建”失效而更早会话缓存仍可用——两版混载造成“有导航项、面板空白”。
- 修复：在 `scripts/wrap-loader.cjs` 中把全部顶层 `import` 改写为 `require(...)`，并新增**构建期守卫**：改写后若仍存在行首 `import`/`export` 即构建失败（从机制上杜绝再发错包）。
- 证据：Node 侧 stub 复现——修复后 bundle `apply()` 正常注册 settings.section/dock；`renderToStaticMarkup(SettingsPanel({close,t}))` 输出占位 HTML（`verification-section-title`/`verification-evidence-empty`）无异常；GUI 实际 serve 校验 `import` 残留 = 0、`__ModuleLoader__`/占位均在。
- 已把修复产物同步至 web/verify vendor 与 DSH 安装目录并重启 web（新实例 PID 于重启后自动拉起，:3080 正常）；请在浏览器**硬刷新（Ctrl+F5）**后复查设置页。
- 诊断/复现脚本保留在仓库：`packages/dsh-client-ui-verification/scripts/probe-client.cjs`（stub 浏览器 + react-dom/server 渲染）。

全部自检：typecheck/build 0 错误；测试 **44 + 117 + 11 = 172 全绿**。
