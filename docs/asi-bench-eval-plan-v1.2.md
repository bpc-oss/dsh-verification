# ASI-Bench 测评方案 v1.2（复审修订版）

> 状态：待确认
> 复审（verifier-standard）结论：CONCERN——必修 3 项（masked 对照、主指标、值合理性边界）。
> 本版全部吸收：masked 对照入组、主结论指标定义、值合理性弱校验边界 + 次要项。

## 1. 测评目标与条件设计

### 1.1 条件组（5 组，masked 对照入组）
| 组 | Preset | reference 可见性 | 角色 |
|---|---|---|---|
| standard | 官方标准 | 可见（--sandbox none） | 基线 A（同官方默认） |
| minimal | 官方极简 | 可见 | 基线 B（最小工具集） |
| enforce-standard | 验证工作流 | 可见 | 实验组 1 |
| enforce-rsi-standard | 验证+RSI | 可见 | 实验组 2 |
| **enforce-standard-masked** | 验证工作流 | **不可见（reference 移出实例副本）** | **实验组 3（对照泄漏上界）** |

- masked 实现：独立 instances 副本（instances-enf-masked），运行前移除 reference/ 目录；
  不依赖 asibench sandbox（Windows 不可用），由实例目录准备脚本保证。
- **配对结构**：同一任务 id 跨 5 条件配对（配对设计，非独立样本——统计层明示）。

### 1.2 核心问题
1. 引导（enforce/RSI）是否提升完成率与效率？（vs standard 可见基线）
2. **reference 泄漏影响多大**？（enforce vs enforce-masked——masked 差值 = 泄漏上界）
3. 泄漏上界下结论是否仍成立？（若 masked 完成率≈visible，结论稳健；否则坦陈）

## 2. 环境固定（发布时全公开）

- homepc（Windows 16 核 / RTX 5070 Ti）；deepseek-v4-flash via bai API
- DSH host 固定端口 17777；asibench v0.1.3（--sandbox none, --timeout 21600）
- 适配器 v3（多轮 steer ≤6 轮，零进展 2 轮早停，**结束逻辑见 4.4**）
- 版本锁：asibench/adapter/DSH/python + requirements.lock + **GPU 驱动/CUDA/cuDNN/基准频率声明**
- 运行前版本断言（不符拒绝产出）；API 快照（model/temperature/seed/max_tokens）
- 配置全部归档（settings 脱敏、run-condition.ps1、asi-agent.py、preset、task.yaml、**instances 准备脚本**）

## 3. 数据固定

- 每任务独立目录：asi-all-<cond>/<task_id>/（结果 JSON + outputs/ + 日志）
- DSH 会话归档 + 关联键（sessionId ↔ 归档自动校验）
- 时间线统一：ISO-8601 UTC 单时钟；**运行批次记录（日期/时长/机器状态）**

## 4. 评分标准

### 4.1 指标体系（主指标 + 辅助，禁止合并）
- **主指标 = 数值正确性**（每题判定，全量或抽样）：
  - 判定方式：对照 reference 的**确定性数值产物**（npy/json 数值）做容差对比
  - 容差：显式定义（绝对/相对，标注与官方评分差异）
  - 抽样：若抽样须给 N（≥20）、抽样方法（分层随机按领域）、误差（95% CI）
  - 每题判定二值（正确/不正确），条件得分 = 正确数/总题数（整数计数）
- **辅助指标 A = 格式完成度**（file_match 官方语义：存在+形状+无 NaN/Inf）——标注"仅格式未验证正确性"
- **辅助指标 B = 值合理性**（**仅任务无关自洽**：非空、类型匹配、单位/长度、无全零）——明示弱校验，不做需要 reference 域定义的值域判断
- 三指标分开报告；主指标用于组间比较，辅助指标用于诊断

### 4.2 效率指标
- 耗时/任务；token 分类（input/output/cache，注明计量口径）；成本估算（定价来源快照 + 货币/时刻 + **实际计费记录**）

### 4.3 报告口径
- reference 泄漏声明：visible 条件的"格式完成度"为上界；主指标（数值正确性）受泄漏影响需 masked 差值量化
- 只报可验证指标；明确样本量、时间线、环境、限制

### 4.4 结束/失败语义（复审 Q5 补）
- 适配器每任务判定结束：交付物全齐 → complete；超时（21600s）→ timeout；会话异常 → session-error；steer 失败 → steer-fail；零进展 2 轮 → stalled
- **一次运行，失败也归档**；重跑须新增运行 id 保留原记录

## 5. 验收要求

### 5.1 数据完整性
- [ ] 300 结果 JSON（5 条件 × 60）全存在可解析
- [ ] completed 任务有 outputs/；时间戳脚本自动校验（**口径：任务起始=适配器首 API 调用，结束=结果写入**）
- [ ] 关联键自动校验

### 5.2 可复现性
- [ ] 配置+版本锁+GPU/CUDA 归档；冒烟测试；评分确定性（固定 python+lock+diff 基准）

### 5.3 防造假
- [ ] 时间账强制校验（≤20% 偏差阻断发布）
- [ ] 整数域校验（主指标计数为整数）
- [ ] 轨迹可查（3 任务还原行为链，机制=归档 replay 脚本）
- [ ] 不可变锚定（SHA256+签名 tag/Zenodo，验签流程写入）
- [ ] 失败语义（一次运行失败也归档）
- [ ] 分布审计（时长/token 直方图；**旗标触发动作：重跑该任务 1 次比对，仍异常则记录不隐瞒**）
- [ ] **独立复核**：明示"本次未经第三方独立复核，结论为内部自证"（诚实声明，不假装有）

### 5.4 统计严谨性
- [ ] 配对设计明示；配对 bootstrap + McNemar + 配对 Cohen's d + Holm
- [ ] 失败分类盲评（执行者不知条件标签的隔离流程）+ Kappa
- [ ] n=60 配对可检测效应量（power 期望值计算）

## 6. 发布规范
- 仓库结构 + SHA256 + 签名 tag；结果只读；定价/计费记录入 evidence

## 7. 已知限制
- visible 条件受 reference 泄漏（masked 差值量化）；单 seed；第三方 API 可审计非逐 token 可复现（**结论级复现：重复 3 次看条件排序稳定，纳入可选**）；定价会变

## 8. 执行清单
1. 全量跑完成（300 任务，含 masked 条件）
2. 数据完整性验收
3. 可复现性验收
4. 防造假验收
5. 统计汇总（主指标 + 辅助 + masked 差值）
6. 数据包构建 + 哈希 + 签名
7. 发布
