# ASI-Bench 测评归档

本目录归档 ASI-Bench 开源测评的**完整可复现资产**（v1.2 方案实施后）。

## presets/（优化后的 agent presets）
- `enforce-standard/`：官方 standard + bpc-verification 验证工作流
  - `enforce-guide.mjs`：**空操作版**（pre-step 瀑布注入会损坏会话投影导致 session.list 500；
    引导改由适配器 steer 文本承载——见 scripts/asi-agent.py）
- `enforce-rsi-standard/`：验证工作流 + RSI 能力引导
  - `rsi-guide.mjs`：**空操作版**（同上）

## scripts/asi-bench/（测评工具链）
| 脚本 | 用途 |
|---|---|
| `asi-agent.py` | 适配器 v3：多轮 steer（≤6 轮、零进展 2 轮早停、增量缺失清单、finally 关会话）|
| `make_masked.py` | masked 实例构建（reference 移除 + meta 嵌套清洗 + manifest 重生成 + 泄漏扫描 gate）|
| `score_correct.py` | 格式完成度评分（file_match 官方语义）|
| `cost_stats3.py` | 耗时 + token 分类（input/output/cache）成本统计 |
| `scrub_release.py` | 发布脱敏（sk-/hf- key、路径、IP）|
| `replay_integrity.py` | 轨迹日志完整性校验（hash 链 + 时间戳单调 + call/result 配对）|
| `dist_flags.py` | 分布旗标（时长 CV/直方图异常检测）|

## docs/（方案与规范）
- `asi-bench-eval-plan-v1.2.md`：测评方案（经三轮独立审查）
- `asi-bench-pre-registered-stats.md`：预注册统计（H1 + 6 比较族）
- `asi-bench-scoring-spec.md`：评分规范冻结（tolerance + all-or-nothing + 三分类）
- `asi-bench-disclosure-appendix.md`：披露附录模板

## 测评状态
- 5 条件全量跑（standard/minimal/enforce-standard/enforce-rsi-standard/enforce-standard-masked）
  × 60 任务（ASI-Bench seed31415, B3 级）
- 运行中，数据自动积累于 homepc（host 17777）
- 发布前运行：M5/M6 校验 → M2 数值评分 → M4 脱敏 → 签名