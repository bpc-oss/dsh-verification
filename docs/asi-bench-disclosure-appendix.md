# M8 披露附录（发布时填写）

## 1. 数据来源与许可证
- ASI-Bench seed31415（HF: Apexintelligence-AI/ASI-Bench-seed31415, snapshot ed1b6cbf, Apache-2.0）
- 60 任务（metadata 自述 "59 final + 1 requested test task"——详见 §5）

## 2. 环境
- 机器：homepc（Windows，Ryzen 9 9955HX3D 16核，RTX 5070 Ti）
- 模型：deepseek-v4-flash via bai API（api.b.ai），maxTokens 256000，
  streamIdleTimeoutMs 1800000，retryPolicy mode: always
- DSH host 17777；asibench v0.1.3（--sandbox none, --timeout 21600）
- 适配器 v3（多轮 steer ≤6 轮，零进展 2 轮早停）

## 3. 运行时间线
- 起始：2026-08-21 ~16:00（4 条件）；masked 条件 2026-08-22 加入
- 每任务结果 JSON 含 execution_time_seconds + 文件 mtime（可对账）
- 中断/恢复：记录任何 host 重启/SSH 断线（Tailscale 断线 1 次，homepc 未休眠）

## 4. 时间账公式
- 总墙钟 = 末任务结束 - 首任务开始
- Σ(execution_time_seconds) vs 总墙钟：|Σ - wall| / wall ≤ 20%（校验脚本强制）

## 5. 元数据杂音披露
- seed_overrides：deployment_prediction_sets、ucb_q_learning_regret 实际以 seed 2 生成
- framework_task_info.prompt_level 字段显示 b2（57 任务）——本实验统一加载 prompt_b3.md
  （B3 = Goal-only），该字段为生成器默认记录，非本实验等级来源
- 2 个任务 JSON 存在大小写重复键（解析时容错处理）

## 6. reference 泄漏声明
- visible 条件（std/enf/rsi/min）在 --sandbox none 下可读 reference/
- 格式完成度为上界估计；主指标（数值正确性）受泄漏影响的量化 = enforce vs masked 差值
- masked 条件：reference/ 移除 + instance_meta 清洗 + manifest 重生成 + 泄漏扫描零命中

## 7. 第三方 API 声明
- bai API 为第三方托管：可审计但非逐 token 可复现
- 已固定 seed/温度/版本以最大化可复现；结论级复现（3 次条件排序稳定）可选