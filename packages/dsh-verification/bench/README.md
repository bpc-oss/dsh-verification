# Verification Benchmark（开源价值证明）

对验证引擎做**可复现的缺陷拦截评测**：12 个合成任务（**8 个植入缺陷 + 4 个干净**），
用**真实确定性裁判**（T0 test-run / command-exit / file-exists / file-diff / schema-valid + T3 coverage）
逐 AC 裁决，再跑完成闸门，与期望比对，输出 **召回率**（坏场景被拦截比例）与**误报率**（好场景被误拦比例）。

## 运行

```bash
pnpm --filter @bpc-oss/dsh-verification bench
```

（vitest 执行 `bench/run-benchmark.test.ts`；无外部依赖、无 LLM、确定性。）

## 期望裁决表

| 场景 | 类型 | AC 期望裁决 | 期望闸门 |
|---|---|---|---|
| `missing-file` | 缺陷 | ac1 fail（file_exists=false） | failed |
| `no-committed-run` | 缺陷 | ac1 fail（无 bound evidence） | failed |
| `test-claim-green-but-red` | 缺陷 | ac1 fail（exitCode=1） | failed |
| `command-nonzero` | 缺陷 | ac1 fail（exitCode=2） | failed |
| `wrong-file-content` | 缺陷 | ac1 fail（内容不符 exactly） | failed |
| `schema-invalid` | 缺陷 | ac1 fail（valid=false） | failed |
| `cross-ac-evidence-reuse` | 缺陷 | ac1 fail / ac2 pass（跨 AC 复用被拒） | failed |
| `file-exists-correct` | 干净 | ac1 pass | done |
| `tests-green` | 干净 | ac1 pass | done |
| `command-zero` | 干净 | ac1 pass | done |
| `schema-valid` | 干净 | ac1 pass | done |
| `mixed-gate` | 缺陷 | ac1 pass / ac2 fail（一过一缺 → 整体拒绝） | failed |

## 目标指标

- **召回率 = 1.0**：8/8 个缺陷场景全部被完成闸门拦截
- **误报率 = 0**：4/4 个干净场景全部放行
- **AC 级裁决 100% 命中期望**

## 真实案例对应

- `no-committed-run` ← 真实会话 aae5c2d5：`AC ac-review-pass: no committed run for selector`
- `missing-file` ← 真实会话 aae5c2d5：`file evidence check failed: {"quote":"No files found"}`
- `mixed-gate` ← 真实会话 aae5c2d5：1 pass + 2 fail → 完成闸门拒绝

## 扩展

新增场景 = 在 `bench/scenarios.ts` 加一条（契约 + 证据 + 期望表）；运行器自动纳入统计与断言。
