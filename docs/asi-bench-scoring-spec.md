# M2 评分规范冻结（数值正确性主指标判定标准）
# 日期：2026-08-22（全量跑完成前冻结，防 researcher degrees of freedom）

## 主指标：数值正确性（每任务二值）
- 判定：对照 reference 金标准，对任务的 expected_outputs 中的**确定性数值产物**（npy/json）做容差对比
- 容差来源：**优先用任务自带 tolerance 字段**（58/60 任务在 framework_task_info/data 元数据中有分级 tolerance，如 2e-05/4e-04）
- 缺 tolerance 的 2 个任务：人工冻结容差表（附录，发布前定稿）
- 聚合规则：**all-or-nothing**（每任务一个 bit：全部容差内 = 正确，任一超差 = 不正确）
- 条件得分 = 正确数 / 总任务数（整数计数，可核验）

## 辅助指标（分开报告，禁止合并）
- A 格式完成度：file_match（存在+形状+无 NaN/Inf）
- B 值合理性：仅任务无关自洽（非空/类型/单位/无全零）

## mismatch 三分类审计（对判失败的任务强制分类）
1. wrong-value：文件存在、形状对，但数值超差
2. schema-missing：文件缺失或形状/类型错
3. parameter-divergent：agent 自选参数导致输出网格/维度与金标准不同
- 分类报告数量 + 每类明细

## 判定流程
1. 评分器（score_numeric.py）输入：结果 JSON + outputs 目录 + reference（held-out 副本）
2. 输出：每任务判定 + 三分类 + 条件汇总
3. 由不了解条件标签的评估者复核抽样（盲评 + Kappa）