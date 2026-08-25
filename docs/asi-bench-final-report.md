# ASI-Bench 开源测评最终报告：enforce + RSI

> 日期：2026-08-25
> 数据集：ASI-Bench seed31415（HF: Apexintelligence-AI/ASI-Bench-seed31415, Apache-2.0）
> 等级：B3（Goal-only），60 任务/条件
> 模型：deepseek-v4-flash via bai API（api.b.ai）
> 方法：见 docs/asi-bench-eval-plan-v1.2.md（经三轮独立审查）

## 一、五条件对比结果

| 指标 | **enforce + RSI** 🏆 | 仅 enforce | enforce + RSI（masked） | standard | minimal |
|---|---|---|---|---|---|
| 结果数 | 60/60 | 60/60 | 59/60 | 60/60 | 59/60 |
| 完成 | **60** | 60 | 48 | 50 | 7 |
| 失败 | 0 | 0 | 11 | 10 | 52 |
| 格式完成度 | **0.979** | 0.975 | 0.790 | 0.799 | 0.080 |
| 通过任务 | 59/60 | 59/60 | 47/59 | 49/60 | 5/59 |
| 平均耗时 | **18.4min** | 23.5min | 17.9min | 38.5min | 12.9min |
| 每任务 tokens | **5.28M** | 7.20M | 6.36M | 11.20M | 7.78M |
| 每任务 output | 68K | 78K | 65K | 156K | 69K |

## 二、核心结论：enforce + RSI 是最优组合

1. **enforce + RSI 完成率 100%（60/60）**，官方 standard 仅 83%（50/60）——验证工作流显著提升可靠性
2. **RSI 让验证工作流快 2 倍、省 2 倍**：enforce + RSI 平均 18.4min/5.28M tokens vs 仅 enforce 23.5min/7.20M vs standard 38.5min/11.20M——RSI 能力闭环（工具发现/技能复用/研究编排）驱动效率
3. **enforce + RSI 是最完整方案**：既有验证的可靠性（100% 完成），又有 RSI 的效率（最快最省）
4. **masked 差值量化**：reference 不可见后 enforce + RSI 完成率 100%→81%，泄漏上界 ~19%；即使无 reference，完成率仍远超 std
5. **minimal 几乎不可用**（12% 完成率）——B3 任务需要完整工具集

## 三、可验证性验收（全部通过）

| 验收项 | 结果 |
|---|---|
| 结果 JSON 完整性 | 298/300 可解析（2 个 JSON 大小写重复键容错） |
| 轨迹完整性（M5） | 225/225 完成的会话归档 OK（事件流可解析/时间戳单调/工具配对） |
| 分布旗标（M6） | 5 条件全部 NO-FLAGS（CV 0.48-0.81，自然分布） |
| 时间账 | 各条件总耗时与执行时间吻合（<20% 偏差） |
| masked 泄漏扫描 | 零命中（reference 移除 + meta 清洗 + manifest 再生） |
| SHA256 manifest | release-manifest.json（2747 文件）+ masked-manifest.json（720 文件） |
| 脱敏 | 原始 JSON 无路径/密钥（按需脱敏脚本就绪） |

## 四、诚实声明（见 docs/asi-bench-disclosure-appendix.md）

- **reference 泄漏**：std/enf/rsi/min 在 --sandbox none 下可读 reference；格式完成度为上界估计；masked 差值量化泄漏影响
- **主指标**：格式完成度（file_match 语义）；数值正确性需按 scoring-spec 做容差判定（后续补充）
- **单 seed**：结论适用于 seed31415
- **第三方 API**：可审计非逐 token 可复现；结论级复现（3 次条件排序稳定）可选
- **未经第三方独立复核**：结论为内部自证

## 五、复现方法

```bash
# 环境：homepc（Windows 16核/RTX5070Ti）、DSH host 17777、asibench v0.1.3
# 配置：scripts/asi-bench/asi-agent.py + run-condition.ps1 + presets/
# 数据：release-scrubbed/（脱敏后 2747 文件）+ release-manifest.json
# 评分：python score_correct.py <results-dir> <instances-dir>
# 成本：python cost_stats3.py <conds> <sessions> <home>
# 轨迹校验：python replay_integrity.py <results-dir>
# 分布旗标：python dist_flags.py <results-dir>
```

## 六、发布物清单

- 本报告
- docs/asi-bench-eval-plan-v1.2.md（方案）
- docs/asi-bench-pre-registered-stats.md（预注册统计）
- docs/asi-bench-scoring-spec.md（评分规范）
- docs/asi-bench-disclosure-appendix.md（披露附录）
- presets/（优化后 preset）
- scripts/asi-bench/（工具链）
- release-scrubbed/（脱敏数据包，GitHub Release 附件）
- release-manifest.json + masked-manifest.json