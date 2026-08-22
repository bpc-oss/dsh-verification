# 预注册统计声明（M7）
# 日期：2026-08-22（全量跑完成前注册，防 p-hacking）

## 主假设（预注册，1 条）
H1: enforce-standard 的完成率（数值正确性主指标）> standard 的完成率。

## 比较族（5 条件 → 预注册 6 对比较）
主：enforce-standard vs standard（H1）
次（探索性，不设显著性门槛，报告效应量+CI）：
  1. enforce-rsi-standard vs standard
  2. enforce-standard vs minimal
  3. enforce-rsi-standard vs minimal
  4. enforce-standard-masked vs enforce-standard（= reference 泄漏上界）
  5. minimal vs standard

## 统计方法
- 配对设计（同任务 id 跨条件配对）
- 主指标：数值正确性（二值计数），McNemar 检验（配对二分）
- 效应量：配对风险差 + 95% bootstrap CI（BCa, 10000 重采样）
- 多重比较：Holm 修正仅施于预注册比较族
- 失败分类盲评（评估者不知条件标签）+ Cohen's Kappa

## 判定门槛
- H1 成立：McNemar p < 0.05 且 风险差 > 0（Holm 修正后）
- 结论级复现：若 API 可重跑，重复 3 次看条件排序稳定（可选）

## 已声明限制
- 单 seed（seed31415）；--sandbox none（visible 条件受 reference 泄漏，
  masked 差值量化）；第三方 API 可审计非逐 token 可复现