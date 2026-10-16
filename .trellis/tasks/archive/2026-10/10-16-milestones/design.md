# 设计：里程碑

> 本文件只写技术设计。视觉与交互规格由设计师 agent 另出
> （`.trellis/workspace/liangyuxiang/design-round-y-milestones.md`），主会话评审后实现。

## 1. 边界

```
UsageOverviewPage（既有）
└─ 分段控件：用量 | 里程碑 | 错误
   └─ MilestonesPanel            ← 新增
        ├─ milestones.ts         纯函数：三层清单 + 阶梯常量
        └─ 展示组件（规格见设计师文档）
```

不新增 Tauri 命令、不新增 `Bridges` 接口、不新增数据通道。`inputs` 直接来自
`useUsageOverview()`（`UsageOverviewPage` 已持有它）。

## 2. 数据流

```
useUsageOverview().inputs : UsageSessionInput[]     （全历史，既有）
        │
        ├→ milestonesOf(inputs, now)               纯函数，一次遍历
        │     ├→ firsts        首次类（原料存在才产出）
        │     ├→ tiers         累计阶梯（当前值 / 已达档 / 下一档距离）
        │     └→ records       单会话记录（值 + 哪个会话）
        └→ 展示组件
```

**一次遍历**：`milestonesOf` 只扫一遍 `inputs`，把全历史事实折成一个中间态
（累计值、极小 / 极大、首次时间戳、种类集合），再由三层各自的纯函数把它投影成
可渲染清单。不为了「分层清晰」扫三遍。

## 3. `milestones.ts` 契约（全部纯函数，`now` 显式传入）

### 3.1 中间事实

| 函数 | 输入 → 输出 | 要点 |
| --- | --- | --- |
| `historyFactsOf(inputs)` | → `HistoryFacts` | 一次遍历聚合：累计 token / 会话数 / 消息数 / 压缩次数；项目集合、模型集合、工具集合；最早的会话、首次压缩 / 子 agent / skill / MCP；单会话极值；天数集合 |

`HistoryFacts` 里**只放事实**，不放任何「达成与否」的判断——档次判定是纯函数的事。

### 3.2 三层清单

| 函数 | 输入 → 输出 | 要点 |
| --- | --- | --- |
| `tiersOf(facts)` | → `MilestoneTier[]` | 用写死的档位表判定「已达档」与「下一档距离」；距离在最高档时为 `null` |
| `firstsOf(facts)` | → `MilestoneFirst[]` | **原料不存在就不产出这枚**（不是产出成未达成） |
| `recordsOf(facts)` | → `MilestoneRecord[]` | 值 + 会话定位（path / 标题回退 / 日期） |
| `milestonesOf(inputs, now)` | → `MilestoneReport` | 组装上面三层 + 空态判定 |

### 3.3 档位表（写死，逐条可测）

档位是**常量表**，不是算出来的——「多少算里程碑」是产品决定，必须能逐条读、逐条测。

| 指标 | 档位 | 单位 |
| --- | --- | --- |
| 累计 token | 1M / 10M / 100M / 1B | token（`totalsSum` 口径） |
| 累计会话数 | 1 / 10 / 100 / 1000 | 个 |
| 累计消息数 | 100 / 1k / 10k / 100k | 条（`countsAsMessage` 口径） |
| 涉及项目数 | 1 / 5 / 10 / 25 | 个 |
| 用过模型数 | 1 / 3 / 5 | 个 |
| 累计压缩次数 | 1 / 10 / 100 | 次（`compactEvents` 计数） |
| 工具种类数 | 1 / 5 / 15 | 种（`ToolCallFact` 去重名） |

**口径必须引用既有函数**：token 走 `totalsSum`，天数走 `dayStartOf`，消息走
`countsAsMessage`，会话键走 `sessionKeyOf`。里程碑不自带第二套数学。

### 3.4 并列规则（记录类）

单会话极值并列时（两个会话同为最大值）：取**时间更早**的那个，理由与
`calendarInsightsOf` 的「并列取最近段」相反——记录类问的是「第一次达到」，
最早的达成时刻才有意义。这条写进注释并被测试固定。

### 3.5 空值与畸形输入

- `inputs` 为空 → `MilestoneReport.empty = true`，三层都是空数组。
- 非有限 token / 时间戳：**跳过该条记录**，不把它当成 0 参与累加
  （0 会把极小值算错，也会把「首次」算错）。
- 重复路径的会话：按 `sessionKeyOf` 合并（V2 那轮修过一次同键覆盖，同一规则）。

## 4. 展示层

- 组件只吃 `MilestoneReport`，**不做任何判定**（达成 / 距离都是纯函数给的）。
- 项目名走 `formatProjectPath`，数字走 `formatTokenCount`，日期走 `formatDayLabel`，
  时刻走 `formatClock`——不新写格式化。
- 入口两类：会话 → `onOpenSession(path)`（与用量页 `压缩统计 top3` 同一握手）；
  某天 → 一日回望的下钻状态（与日历 / 洞察句同款，切到「用量」档并展开那一天）。
- 成本类（若设计保留）必须带 `ProvenanceBadge provenance="inferred"` 与
  「按定价快照折算」的口径句；**定价未知的天不计入**（与日历同规矩）。

## 5. 性能

- `useMemo(() => milestonesOf(inputs, now), [inputs, now])`；`now` 用挂载时取一次的
  稳定值（同日历的既有取舍），避免每帧重算。
- 一次遍历是 O(记录数)；中间态用 `Map` / `Set` 累积。
- **验收要求**：合成 ≥300 会话的夹具上量一次重算耗时，写进 PR；目标 < 150 ms。

## 6. 兼容与回归面

| 面 | 影响 | 处理 |
| --- | --- | --- |
| `UsageOverviewPage` 分段控件 | 从 2 项变 3 项 | 既有断言若按序数取项要改成按名取；`readStoredView` 增加一个取值 |
| 截图矩阵 | 新增 `milestones` 视图 | 四处清单同改（`screenshots.spec.ts`、`check-screenshots.sh`、`check-screenshots-test.sh`、`manifest.json`）——#196 未修，这是已知代价 |
| 真机门禁 | `CAPTURE_TARGETS` 加里程碑步骤 | 探针一律 `data-probe` 锚点 |
| 用量页首屏 | 里程碑是新档，默认档不变（仍是 `用量`） | 首屏预算不受影响 |
| 扫描成本 | **零新增**（同一份 inputs） | 里程碑档挂载不触发新扫描 |

## 7. 风险与取舍

- **全历史的口径包含归档、且受限于本地日志**：Claude Code 已清理且未归档的会话不在
  统计里。页面必须写明这一点，否则「累计 token」会被读成「我一辈子的用量」。
- **成本类里程碑依赖定价快照**：老会话可能定价未知。取舍是**如实标 unknown**，
  而不是把未知当 0（后者会让「累计成本」偏低且无声）。
- **记录类只做单会话级，不做单日级**：单日已由日历 / 洞察的「最贵一天」承载，
  同一维度出两个数就会打架。
- **不做连胜**：见 PRD 的边界一节。

## 8. 回滚

全部改动集中在 `features/usage/milestones.ts`（新）、`MilestonesPanel.*`（新）与
`UsageOverviewPage` 的分段项。回滚 = 删掉新文件 + 还原分段项与截图清单。
