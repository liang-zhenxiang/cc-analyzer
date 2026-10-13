# 「一日回望」设计规格（Round V · 第二棒）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 日期：2026-10-12 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（Issue #192 已锁定）：把 V1 日历的展开区从「当天会话 Top 清单」升级为「一日回望」——
> 日摘要行（KPI 一行）+ 24h 甘特式时间线（条 = 会话当天跨度，色 = 项目，条内密度 = 逐小时
> 活动）+ Top 会话清单（**保留**，裁决见 §5.1）。悬停给会话身份与起止，点击条打开会话，
> 键盘可达，高对比度档令牌化（沿用 Round U 体系）。
> **本文件只描述设计与断言，不改任何源码。**

---

## 0. 语境与现状（写前逐字读过）

**读过的文件**：`gh issue view 192`（契约权威）、
`.trellis/workspace/liangyuxiang/design-round-v1-usage-calendar.md`（上一棒规格——本轮的直接
基础，本文件格式与颗粒度照它）、
`.trellis/workspace/liangyuxiang/design-round-u-high-contrast.md`（另一体例样板与 HC 体系权威）、
`web/src/features/usage/usageCalendar.ts`、`web/src/features/usage/UsageCalendarPanel.tsx` 与
`.module.css`、`web/src/features/usage/BillingWindowCard.tsx`、`web/src/styles/tokens.css`、
`web/src/features/usage/charts/`（`Heatmap.tsx` / `BarChart.tsx` / `HBarChart.tsx` 与
`HBarChart.module.css`）、`web/src/features/usage/UsageOverviewPage.tsx` 与 `.module.css`、
`web/src/features/usage/usageAggregations.ts`、`web/src/features/usage/quotaAttribution.ts`、
`web/src/features/sessions/metadataCache.ts`（`sessionTitle`）、`web/src/lib/format.ts`、
`web/e2e/fixtures.ts`（`calendarScenario`）、`web/e2e/usage-calendar.spec.ts`、
`web/src/features/usage/UsageCalendarPanel.test.tsx`、`scripts/gui-test.sh`（夹具段 / 常量段 /
断言段）、`src-tauri/src/lib.rs`（`calendarFacts`）。

**逐条核对过的既有事实**（后文反复引用，都是实测而不是印象）：

- V1 已落地：`usageCalendar.ts` 有 `buildUsageCalendar` / `levelOfCost` / `daySessionsOf`
  （`usageCalendar.ts:91` / `273` / `342`），`CalendarSessionRow` 带 `costUsd` / `share`
  （第 284-301 行）；组件侧展开区是 `.sessions` section（`UsageCalendarPanel.tsx:317-362`），
  内嵌底色 + 发丝边框的「卡里的仪器块」语言（`UsageCalendarPanel.module.css:172-180`），
  `data-calendar-sessions` 是门禁探针锚点（`src-tauri/src/lib.rs:1049`）。
- `daySessionsOf` 的当天过滤是 `dayStartOf(record.timestamp) !== dayStart` 跳过
  （`usageCalendar.ts:365`）——跨午夜会话按记录归属切分，**这正是 Issue 说的「与归因面板
  同口径」**（归因的窗口过滤是 `timestamp >= start && timestamp < end` 半开区间，
  `quotaAttribution.ts:112`）。本轮时间线的首末时刻沿同一条：**条 = 当天记录的首末，
  不是会话的真实起止**（凌晨跨午夜的会话在今天的条从今天首条记录开始）。
- 记录口径 `countsAsMessage`（`usageCalendar.ts:78-80`）：`kind === "user" | "assistant"` 且
  非 `compactSummary`；身份键 `sessionKeyOf`（第 87-89 行）`path:${path}` / `anonymous:${index}`。
  会话行标题 `sessionTitle(session)`，无元数据退回 `projectLabel`（第 370 行）。
- 展开区现状高度门禁：`CALENDAR_SESSIONS_MAX_HEIGHT = 400`
  （`scripts/gui-test.sh:1033`），断言「展开区高度 < 400px、行数 ≥ 1」
  （第 1613-1616 行）；点选协议是两次同名 `点选=[data-probe='calendar-today'] button`
  （`gui-test.sh:722` 的 `CAPTURE_TARGETS`），第 1 次判展开态、第 2 次判收起态
  （第 1597-1631 行）。真机夹具 `calendar-today-0001.jsonl` 两条**几乎同秒**的记录
  （`gui-test.sh:593-598`，注释明写「两次调用几乎同秒」）——即门禁里的「今天」天然是一个
  **瞬时会话**（零跨度），这正是本轮要如实处理的形态之一。
- 展开区容器几何出自 `calendarFacts.sessions.rect` + `rows`（`lib.rs:1051-1055`）；
  `calendarFacts.container` 出据滚动容器 `overflowX`（第 1048 行）。
- 全部图表先例里 **SVG 与 DOM 的分界线就是「有没有点击 / 键盘」**：`BarChart` / `HBarChart` /
  `Heatmap` 全是 SVG + `role="img"` + 原生 `<title>` 悬停、零交互（`charts/` 各文件）；
  而一旦格子要点击展开 + roving tabindex，V1 日历走的是真实 `<table>` + `<button>`
  （V1 规格 §5.4 的裁决：「`role=grid` 要手维护嵌套，而 table 的行列语义免费」）。
- 密度透明度台阶的先例：Heatmap 的 `OPACITY_STEPS = [0.3, 0.5, 0.68, 0.84]`，max 归一
  `Math.ceil((count / max) * 4)`（`Heatmap.tsx:17` / `77`）——但那是 `--chart-1` 的 opacity
  台阶；Round U 已裁决 HC 档 `-soft` 全部改实色（「叠出来的氛围不可控」，
  `tokens.css:343-346` 的块注释），V1 色带也因同一条拒绝 opacity 台阶
  （V1 规格 §3.1）。本轮密度编码必须回答 HC 档怎么办（§3.4）。
- 类别色 `--cat-wait/-direct/-delegated/-compute/-user/-workflow` 六色四主题齐全
  （`tokens.css:57-62` 浅、296-305 深、381-386 HC 浅、454-459 HC 深）。`tokens.css:64-68`
  明写图表色板「严禁借去表达项目 / 模型 / 日期」——**没有禁类别色借给项目**，且 Issue #192
  契约原文就是「条色 = 项目（复用类别色体系）」，本轮是全应用第一次建立「项目身份色」，
  类别色是契约指定的资产。「其他」折尾先例：`OTHER_LABEL = "其他"` + `DEFAULT_TOP_N = 6`
  （`usageAggregations.ts` 常量），`topSlices` 把尾巴并进「其他」喂 HBarChart。
- `HBarChart` 的条画法：soft 填充 + 1px 实色描边（`HBarChart.module.css:1-7`，「大面积填充
  只允许 soft，实色只给描边」）——本轮甘特条沿用同一句纪律（§3.2）。
- 间距 / 字号 / 行高全部令牌化（`tokens.css:142-149` / `131-140`）；行高
  `calc(var(--row-pad-y-tight) * 2 + var(--lh-xs))` 是清单行的既定账（
  `UsageCalendarPanel.module.css:240`）。占比条「非零最小 2px = `--sp-05`」是既有先例
  （`.barFill` 的 `min-width`，第 330-335 行）。
- 格式化函数现成：`formatClock`（HH:mm，`format.ts:54-59`）、`formatDuration`（`1h20m30s`
  形，第 3-15 行）、`formatModelId`（`Sonnet 4.5` 形，第 127-137 行）、`formatProjectPath`
  （第 100-105 行）、`formatUsd` / `formatTokenCount`。**不需要新写格式函数**。
- e2e 场景 `calendarScenario`（`fixtures.ts:488-555`）：内存合成、`dayAt(offsetDays, hour)`
  锚定本地日历日；今天 3 个会话同刻错开 1 秒（`fixtures.ts:549-551`）、昨天 4 个
  （10/11/12/13 时，第 544-547 行）、档位分布确定（q1=$1.5/q2=$3/q3=$4.5）。
  现有 spec 断「今天共 3 个」「昨天 4 档」（`usage-calendar.spec.ts:125` / `94`）——
  **直接改这个场景会炸 V1 断言**，扩展方式见 §7.4。
- 页面布局：日历在 `board` 第二行整行 `.compactionRow`（`UsageOverviewPage.tsx:454-459`），
  `calendarNow` 是 `useState(() => Date.now())` 的固定实例（第 131 行）。用量页是文档流
  纵向滚动；「滚一次可达才是不变量」是门禁既定原则（`gui-test.sh:1339-1342` 的注释原文：
  「不变量是『滚一次可达』，不是『滚到底后恰在视口内』」）——展开区变高**不会**破坏可达
  判定，只会改变滚动量。
- `now` 不进展开区计算：`daySessionsOf(inputs, selected)` 的 memo 只依赖 `[inputs, selected]`
  （`UsageCalendarPanel.tsx:149-152`），本轮新函数同款。

**与在途实现的对接**：无。工作区干净（main @ `a1bdc48`），V1 全部合入；本轮在 V1 的
展开区上原地升级，`usageCalendar.ts` 只增不改（`daySessionsOf` 原样保留，见 §2.4）。

---

## 1. 实现约束

### 1.1 数据层：`usageCalendar.ts` 增 `dayTimelineOf`，不动既有导出

- 新函数 `dayTimelineOf(inputs, dayStart)` 与类型 `DayTimeline*`（§2 全部签名）加进
  `usageCalendar.ts`——与 `daySessionsOf` 同居一个模块，同一条记录口径（`countsAsMessage`）、
  同一个身份键（`sessionKeyOf`）、同一个成本折算路径（逐 `(day, session, model)` 桶 +
  `estimateCost` 求和，unknown 标 `hasUnknownCost` 不折 0）。
- `daySessionsOf` **逐字保留**：Top 清单继续吃它（§5.1 裁决），它的恒等式测试（V1 §2.3）
  一行不动。两函数同天调用的输出必然一致的部分（sessions / dayTokens / tokens）由 §7.1 的
  **一致性恒等式**钉住，不靠「实现者小心」。
- 组件 memo：`dayTimelineOf` 与 `daySessionsOf` 并排两个 `useMemo`，依赖都只有
  `[inputs, selected]`；`now` / `days` 不进依赖（窗口正交是 V1 既定事实）。

### 1.2 展开区结构：头部 → 摘要行 → 时间线 → 清单 → 脚注

展开区仍是 `.sessions` 那个 section（内嵌底 + 发丝边框语言不动），内部从上到下五段：

```
┌ .sessions（data-calendar-sessions，aria-label「{M}月{D}日一日回望」）────┐
│ .sessionsHead   {M}月{D}日 · 共 N 个会话                    × 清除        │  28px
│ .summary        摘要行（§4.1）+ 口径脚注一行                               │  ~56px
│ .timeline       小时轴标签 / 泳道区（条）/ 项目图例（§4.2–4.4）             │  ≤232px
│ .sessionList    V1 的 Top 清单原样（行四件套、折尾、行点击握手不变）        │  ≤204px
│ .footnote       合并脚注（分母口径 + 时间线口径）                          │  ~32px
└──────────────────────────────────────────────────────────────────────┘
```

- 头部文案从「{M}月{D}日消耗 Top 会话 · 共 N 个」改为 **「{M}月{D}日 · 共 N 个会话」**
  ——清单只是展开区的一段了，头部升格为整块的名字；清单自己的 `<ol>` 可访问名保持
  「{M}月{D}日消耗最多的会话」不动（V1 e2e 按它定位，`usage-calendar.spec.ts:128`）。
- `× 清除` 按钮与收起语义照 V1（再点格子收起 / Escape 收起、焦点留在格上）。
- 展开区整体高度预算与门禁断言见 §4.6。

### 1.3 位置与外部结构零改动

- 面板位置、`Panel` 外壳、ProvenanceBadge、图例（色带那条）、`FOOTNOTE` 全部不动。
- 网格交互（roving tabindex、点击展开、`data-probe="calendar-day"` 365 计数）全部不动。
- 唯一的 DOM 增量全部在 `detail ? (...)` 分支内部。

---

## 2. `usageCalendar.ts`：`dayTimelineOf` 的类型与算法

### 2.1 类型（TypeScript，实现照抄）

```ts
/** 一日回望（Issue #192）：一天的时间形状。全部时刻为本地时间毫秒。 */
export type DayTimelineSession = {
  /** 与 CalendarSessionRow 同源的身份四件套。 */
  path: string;
  title: string;
  projectLabel: string;
  projectPath?: string;
  /** 当天首条 countsAsMessage 记录的时刻（跨午夜按记录归属切，同 daySessionsOf）。 */
  startTs: number;
  /** 当天末条 countsAsMessage 记录的时刻。 */
  endTs: number;
  /** endTs − startTs < 60_000 → 瞬时会话：时间线给最小可视宽（§4.5）。 */
  instant: boolean;
  /** 泳道号（0 起，贪心分配，§2.2）。 */
  lane: number;
  /** 恒 24 桶：该会话当天每小时 token 四类和（0 = 该小时无 usage 记录）。 */
  hourlyTokens: number[];
  /** 当天该会话 token / 成本（与 CalendarSessionRow 同一折算路径）。 */
  tokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
};

export type DayTimelineSummary = {
  costUsd: number;
  hasUnknownCost: boolean;
  tokens: number;
  /** 当天有 countsAsMessage 记录的会话数（=== sessions.length）。 */
  sessions: number;
  /** 当天 countsAsMessage 记录条数。 */
  messages: number;
  /** 当天首条 / 末条记录时刻；sessions === 0 时为 null（该天本就不会展开）。 */
  firstTs: number | null;
  lastTs: number | null;
  /** 当天 token 最多的模型 id（原样存，展示层 formatModelId）；并列按 id 字典序
      最小；无 token（含全无 usage）为 null。unknown 模型的 token 计入排名，
      命中时此值为 UNKNOWN_MODEL_LABEL——如实说「当天大头是未知模型」。 */
  topModel: string | null;
  /** 当天有记录的 distinct projectLabel 数（空串 label 不计，同 topProject 口径）。 */
  projects: number;
};

/** 项目 → 类别色槽位（§3.2）：当日 token Top5 各占一个彩槽，其余进 "other"。 */
export type DayProjectSlot = {
  label: string;
  path?: string;
  slot: 0 | 1 | 2 | 3 | 4 | "other";
  tokens: number;
  sessions: number;
};

export type DayTimeline = {
  summary: DayTimelineSummary;
  /** 按 startTs 升序；并列按 title 再按 path（与归因排序同一并列规则）。 */
  sessions: DayTimelineSession[];
  laneCount: number;
  /** 槽位序 0..4，"other" 恒在末位且只在存在第 6 个项目时出现。 */
  projectSlots: DayProjectSlot[];
};

export function dayTimelineOf(
  inputs: readonly UsageSessionInput[],
  dayStart: number
): DayTimeline;
```

### 2.2 泳道分配（贪心，区间图着色的经典最优）

```
按 §2.1 的排序（startTs 升序）遍历：
  effectiveEnd = instant ? startTs + 60_000 : endTs   // 瞬时条占 1 分钟名义跨度
  lane = 最小号 l 使 laneEnd[l] <= startTs
  没有 → lane = laneCount++（新开泳道）
  laneEnd[lane] = effectiveEnd
```

- `effectiveEnd` 是唯一需要解释的决策：不加它，两个同刻的瞬时会话满足
  `end <= start` 会落**同一泳道同一位置**，视觉完全叠死。加 1 分钟（与 instant 判定阈值
  同一个数，不引入第二个常数）后同刻瞬时会话必然分泳道。副作用：背靠背的真会话
  （A 恰在 B 开始的同一毫秒结束）也分泳道——如实（视觉上背靠背贴住，分泳道更可读），
  不是 bug。
- 泳道**不设数据层上限**：折叠是布局层的事（§4.4），数据层给全量真形。

### 2.3 逐小时分桶与密度档

- `hourlyTokens[h] += usageTokens(record.usage)`，`h = new Date(record.timestamp).getHours()`；
  无 usage 的记录只计 messages、不进桶。于是恒等式 `Σ hourlyTokens === tokens` 成立
  （单测钉住）。
- 密度档在**数据层给、展示层算**都可以，为让单测可断，`dayTimelineOf` 只给原始
  `hourlyTokens`；档位换算放组件旁的纯helper（或直接内联）：
  `level = max小时 === 0 ? 0 : clamp(ceil(v / max小时 * 4), 1, 4)`（max 归一，与 Heatmap
  `Heatmap.tsx:77` 同公式、同 4 档）。**分母是该会话当天自己的最大小时**——密度回答
  「这个会话的高峰在它自己的哪个时刻」，跨会话不比（跨会话的量级由条 title 与清单数字给）。

### 2.4 与既有函数的一致性恒等式（验收线，照 V1 §2.3 的写法）

同一天、同一批 `inputs` 下必然成立（单测逐一断）：

- `timeline.sessions.length === timeline.summary.sessions === daySessionsOf(...).sessions`；
- `Σ timeline.sessions[i].tokens === timeline.summary.tokens === daySessionsOf(...).dayTokens`；
- `timeline.summary` 的 `costUsd / hasUnknownCost / tokens / messages / sessions` 与
  `buildUsageCalendar(inputs, now)` 里该天 `CalendarDayFacts` **逐字段相等**（成本分桶与
  归并路径必须同构，这条断言防止两套实现悄悄分叉）；
- `summary.firstTs === min(sessions.startTs)`、`lastTs === max(sessions.endTs)`；
- 每条 `Σ hourlyTokens === tokens`；`instant === (endTs - startTs < 60_000)`；
- 同泳道任意两条按 `effectiveEnd` 判不重叠；`max(lane) === laneCount - 1`；
- `projectSlots` 的 `Σ tokens === summary.tokens`（other 桽尾合并所有第 6+ 项目）；
- 输入顺序无关：打乱 `inputs` 与记录顺序，输出逐字段相等。

---

## 3. 色彩：项目槽位、密度编码与实算

### 3.1 时间线的用色清单（零新增令牌）

| 元素 | 颜色 | 来源 |
| --- | --- | --- |
| 条描边（跨度边界） | 项目槽位色，1px 实色 | `--cat-*` 四主题既有值 |
| 条底 | 透明（描边框住空白） | — |
| 密度段（活动小时） | 项目槽位色 × alpha 台阶（普通）/ 实色（HC） | 同上 |
| 小时刻度线 / 轴文字 | `--border` / `--text-tertiary` | 既有 |
| 「其他」槽 | `--cat-wait`（灰） | 既有 |
| 悬停条 | 描边加粗到 2px + `--bg-active` 底 | 既有语义台阶 |

**不新增任何颜色令牌**：本轮的色全部来自 `--cat-*` 与语义台阶。`tokens.css` 的
`--cal-*`、`--chart-*` 一概不碰——图表色板严禁借给项目维度（`tokens.css:64-68`），
日历色带语义是「日期成本」也不能挪用。

### 3.2 项目槽位分配（「类别色只有 6 个，项目超了怎么折叠」的答案）

- **当日 token 降序 Top5 项目**依次拿槽位 `0..4`，映射固定为
  `0→--cat-direct / 1→--cat-delegated / 2→--cat-compute / 3→--cat-user / 4→--cat-workflow`；
  并列按 label 字典序（同 `topProject` 的并列规则，`usageCalendar.ts:169-175`）。
- **第 6 个及以后的项目全部折叠为 `slot: "other"`（`--cat-wait` 灰）**——与
  `topSlices` 的「其他」折尾（`OTHER_LABEL`）同一思想：形状与读数保留（条照画、title
  照报项目名），只有「专属颜色」这个通道折叠。6 个项目以内零折叠。
- 分配**按天重算**、不是全局稳定映射：色带回答「这一天谁是大头」，第二天重新排。
  跨天色不稳的代价由图例当场声明（图例就在条下方，所见即所得），换全局稳定映射需要
  持久化色分配表，那是一个状态库，v2 不做（§8）。
- CSS 侧：`data-slot="0"…"4"` / `"other"` 五+一枚属性选择器完成映射，组件零颜色分支。

### 3.3 密度段形态：alpha 台阶（普通）/ 实色两态（HC），段对齐小时网格

- 段是条内 `position: absolute` 的 span，`left / width` 按**整天 24h 坐标系**的百分比计算
  （`left = h / 24 × 100%`，`width = 1 / 24 × 100%`），条自身 `overflow: hidden` 当裁剪窗。
  这让段边界**天然与小时刻度线对齐**（同一坐标系、无二次换算），e2e 断「段位置与时钟
  对齐」变成一次除法（§7.4）。
- 普通档：`opacity ∈ {0.3, 0.5, 0.68, 0.84}`（按 §2.3 档位）——与 Heatmap 的
  `OPACITY_STEPS` 同值。组件里定义为本地常量并注释「与 `Heatmap.tsx` 的
  OPACITY_STEPS 同值同源，改一处必须同步另一处」（它未导出，复制 + 注释是既有容忍的
  做法；导出共享是更好的解，但 Heatmap 不在本轮改动范围，不为省一个常量扩 diff）。
- **HC 档**：段一律实色（`opacity: 1`），即密度从 4 档降为「有 / 无」两态。这是 Round U
  「HC 要实色、不要叠出来的氛围」（`tokens.css:343-346`）的直接后果；如实记账：HC 档
  丢「小时内量级的深浅」，保「何时有活动」，量级由条 title 的精确数字兜底。为让相邻
  实色段不连成一片，HC 下段加 `box-shadow: inset -1px 0 0 var(--bg-inset)` 右缘分隔线
  （不占布局，几何不变）——普通档透明度已分层，不加。

### 3.4 实测对比度（WCAG 2.1 相对亮度，公式同 V1 规格 §3.3 / Round U §3.1）

底色说明：时间线画在展开区 `.sessions` 的 `--bg-inset` 上（V1 既定「卡里的仪器块」），
因此下表全部对 `--bg-inset` 实算（不是面板底）。门槛沿用三档：正文 ≥7、次要 ≥4.5、
**边框与图形 ≥3**；面积填充沿用 V1 §3.5-1 的豁免先例（`-soft` 浅 1.37–1.38）。

**普通浅色（inset `#f1f3f5`）**

| 组合 | 前景 | 比值 | 门槛 |
| --- | --- | --- | --- |
| 槽 0 direct 实色（描边/段） | `#0072b2` | **4.66** | ≥3 ✓ |
| 槽 1 delegated | `#d55e00` | **3.48** | ≥3 ✓ |
| 槽 2 compute | `#009e73` | **3.08** | ≥3 ✓（贴线） |
| 槽 3 user | `#cc79a7` | **2.75** | 面积豁免（§3.5-1） |
| 槽 4 workflow | `#6d3bd4` | **5.85** | ≥3 ✓ |
| other wait | `#6b7280` | **4.35** | ≥3 ✓ |
| 密度段 @0.3（最浅档，逐槽） | 合成色 | **1.33–1.59** | 面积底豁免 |
| 密度段 @0.84（最深档，逐槽） | 合成色 | **2.30–4.34** | 面积底豁免 |
| 小时刻度线 `--border` 叠 inset | `#dbdde1` | **1.22** | 豁免（同 Heatmap 空格档） |

**普通深色（inset `#0a0b0d`）**：六槽实色 **5.09–7.36**（最低 delegated 5.09）；段 @0.3
**1.43–1.65**、@0.84 **3.88–5.42**（面积豁免档）；刻度线 `--border` 叠 inset **1.15**（豁免）。

**HC 浅色（inset `#eef1f5`）**：六槽实色 **5.35–8.90**（最低 compute 5.35）——HC 段是实色，
这就是 HC 密度段的有效对比，全部过 3。

**HC 深色（inset `#000000`）**：六槽实色 **8.76–11.54**，全部远超 3。

**状态与焦点**

| 组合 | 前景 | 底色 | 比值 | 门槛 |
| --- | --- | --- | --- | --- |
| 悬停条底 `--bg-active` vs inset | 逐主题 | inset | 浅 **1.08** / 深 **1.44** / HC浅 **1.18** / HC深 **1.69** | 状态底（豁免，见 §3.5-4） |
| 焦点环 `--accent` vs inset | 四主题 | inset | **5.95 / 8.39 / 8.41 / 10.05** | ≥3 ✓ |
| 条描边（= 槽位色实色） | 见上四表 | — | 实色即焦点环外的边界通道 | — |

**复现脚本**（上表每个数字由它产出，公式与 `tokens.test.ts` 同源）：

```js
// 用法：node dayview-contrast.mjs
const chan = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => chan(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (fg, bg, a) =>
  "#" + [1, 3, 5].map((i) =>
    Math.round(a * Number.parseInt(fg.slice(i, i + 2), 16) + (1 - a) * Number.parseInt(bg.slice(i, i + 2), 16))
      .toString(16).padStart(2, "0")).join("");
const themes = [
  ["普通浅", "#f1f3f5", ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#6d3bd4", "#6b7280"], "#e8ebef", "#2952cc"],
  ["普通深", "#0a0b0d", ["#4da6e0", "#d55e00", "#009e73", "#cc79a7", "#9b7bf0", "#8a93a0"], "#2a2e34", "#7fa8ff"],
  ["HC浅",   "#eef1f5", ["#005b8f", "#a33d00", "#00705a", "#9c2f6f", "#4b21a8", "#4b5563"], "#d8e0ea", "#0b3f9c"],
  ["HC深",   "#000000", ["#6cb6ff", "#ff9a4d", "#3fd39a", "#ff9ecb", "#b795ff", "#c0c0c0"], "#343434", "#8ab4ff"]
];
for (const [name, inset, slots, active, accent] of themes) {
  console.log(`\n### ${name}`);
  slots.forEach((c, i) => {
    console.log(`槽${i}: 实色 ${cr(c, inset).toFixed(2)} | @0.3 ${cr(mix(c, inset, 0.3), inset).toFixed(2)} | @0.84 ${cr(mix(c, inset, 0.84), inset).toFixed(2)}`);
  });
  console.log(`悬停底 ${cr(active, inset).toFixed(2)} | 焦点环 ${cr(accent, inset).toFixed(2)}`);
}
```

### 3.5 豁免与边界（每条有数字与理由）

1. **槽 3（user 粉）在普通浅 2.75 < 3**：如实记录，不修。三条理由：①甘特条是面积元素，
   同 V1 §3.5-1 的豁免先例（色带 cal-1 vs 底 1.40 也未修）；②条的**位置与长度由几何
   承载**（left / width），不依赖色对比——色只编码项目归属，而项目归属有三条冗余通道：
   图例文本、条 title、清单行；③把 `--cat-user` 调深会动记录类别色（时间线视图、树视图
   都在用），为一个豁免档改六处牵连不成比例。HC 两块最低 5.35，无此问题。
2. **密度段 alpha 台阶（浅 1.33–1.59）**：面积底豁免，与 `-soft`（浅 1.37–1.38）、
   Heatmap `OPACITY_STEPS` 同档。段的「边界与读数」由条描边、小时刻度线、title 精确数给。
3. **小时刻度线 1.22 / 1.15**：与 Heatmap 空格 vs 面板底（1.11）同档的装饰性网格线，
   不承载必需信息（条位置自己有 title 的 HH:mm）。
4. **悬停底（浅 1.08 / HC 浅 1.18）**：`--bg-active` 与 `--bg-inset` 本就是相邻台阶
   （浅色下几乎同色，换 `--bg-hover` 更是严格同色）。悬停的可见性**主要由描边加粗到
   2px 承担**（槽位色实色，普通浅最低 2.75、深色 ≥5.09），底色只是深色主题下的次要
   台阶——瞬态冗余通道 + title 同时弹出，不设 3:1（同 Round U §3.5-2 的状态底豁免）。
   取舍已计入实现要求：`.bar:hover` 的描边加粗是必写规则，不是可选装饰。

---

## 4. 时间线几何

### 4.1 摘要行（一行 KPI，口径脚注随行）

- 内容与行序固定（Issue 契约顺序，成本先行与 V1 tooltip 同理）：

```
消耗 {formatUsd(cost)} · {formatTokenCount(tokens)} tok · {sessions} 个会话 ·
{messages} 条消息 · 活跃 {HH:mm}–{HH:mm} · 主力 {formatModelId(topModel) 或 —} · {projects} 个项目
```

  起止用 `formatClock`（`format.ts:54`）；首末同刻（全天一个瞬时会话）显示单时刻
  `{HH:mm}`；`topModel === null` 显示 `—`；`hasUnknownCost` 时末尾追加 ` · 部分未知价`
  （与 V1 格子 label 的追加段同文）。数值 `tabular-nums`、标签与数值同色阶
  （`--text-secondary`，数值 600 字重）——「读数行」语言，不做六张 KPI 卡（展开区高度
  有界，卡片会把一行信息撑成三行高）。
- 摘要行**可聚焦吗**？不可——它是文本不是控件；但读屏要能念到：普通文档流文本即可
  （section 的具名 region 内），不设 `aria-live`（展开瞬间整块内容变化，live 会把清单
  一起播一遍）。
- 口径脚注一行（摘要行正下方，`--fs-xs` + `--text-tertiary`）：
  `时刻为本地时间；跨午夜会话按当天记录切分（条 = 当天首末记录，不是会话真实起止）；成本为估算值。`

### 4.2 小时轴：0–24 本地时，4 小时一刻度

- 刻度与标签**照抄 Heatmap 的 `HOUR_STRIDE = 4`**（`Heatmap.tsx:10`）：标签 `0 4 8 12 16 20`
  顶排（`24` 与 `0` 重合不标），每 4h 一条竖刻度线贯穿泳道区（`--border`，1px）。
  理由：同一应用里两张「小时 × 活动」的图用同一刻度节奏，用户只需要学一次；2h 一格
  在最窄 726px 内容区（e2e 800px 视口）挤 13 个标签，收益只有密度感。
- 轴标签行 `aria-hidden="true"`（装饰性 tick；条的可访问名里已有精确 HH:mm），
  样式复用 `.legendText` 的 `--fs-xs` + `--text-tertiary` 语言。
- **本地时区事实的声明位置**就是 §4.1 的口径脚注（「时刻为本地时间」），面板大脚注
  不再重复。
- 坐标系：`x% = (ts − dayStart) / daySpan × 100`，`daySpan = addLocalDays(dayStart, 1) −
  dayStart`（**真实天长**，不是常数 86400000——DST 天 23/25 小时时条仍铺满全天、与
  「次日 0 点」刻度对齐；无 DST 时区两者相等，行为不变）。

### 4.3 条：absolute 定位 + 百分比，无横向滚动

- 泳道区 `.lanes` 是 `position: relative` 容器，宽 100%；每条是 `position: absolute` 的
  `<button>`，`left / width` 按 §4.2 坐标系百分比、`top = lane × 行高`。**连续轴 + 百分比
  天然自适应**，最窄视口下小时宽 ≈ 726/24 ≈ 30px，无固有最小宽——与 V1 网格（816px
  固有宽必须横滚）的关键差异，时间线**不设横向滚动**，文档 / main 无溢出判定天然成立。
- 条可视高 16px、圆角 `--r-xs`、1px 实色槽位色描边、底透明（§3.1）；行高
  `--control-h-sm`（24px）——button 的可点区撑满行高（上下各 4px 呼吸），**击中目标
  24px** 对齐 WCAG 2.5.8 的最小目标尺寸，也是既有控件高度档（不造新高度字面量）。
- 悬停：描边加粗到 2px + `--bg-active` 底（同刻度线的瞬态冗余通道，§3.4 状态表）。
- 选中 / 焦点：焦点环走令牌（`outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset)`）——HC 自动 3px + 2px 间隙，组件零分支
  （`.clear` / `.sessionRow` 同款写法，`UsageCalendarPanel.module.css:214-217` / `269-272`）。

### 4.4 泳道折叠：可视上限 7 行，超出竖滚

- `.lanes { max-height: calc(7 × var(--control-h-sm)); overflow-y: auto; }`。
  理由与账：7 × 24 = 168px 是高度预算（§4.6）里给得起的数；8+ 泳道意味着 8 个会话
  真并行，那是「并行 agent 跑批」的罕见日——**形状不删（滚动可达全部条），布局有界
  （展开区总高不随泳道数发散）**。竖滚容器嵌在文档流滚动页里是标准行为，门禁的
  「滚一次可达」判的是 main，不受影响。
- 折叠发生在布局层、数据层给全量（§2.2），单测断 `laneCount` 真值、组件 / e2e 断
  `clientHeight ≤ 168`。

### 4.5 瞬时会话（零跨度）：判定 60s，最小可视宽 2px

- 判定精确式：`instant = endTs − startTs < 60_000`（毫秒）。数据层给布尔（§2.1），
  几何由 CSS 兜底：`.bar { min-width: var(--sp-05) }`（2px，**复用 V1 占比条非零最小宽
  的同一令牌与先例**，`UsageCalendarPanel.module.css:332`）。零宽条（width 计算值为 0）
  被 `min-width` 抬到 2px，起点即 startTs 时刻——一条竖线短杠，如实表达「这里有一个
  瞬时会话」。
- `left` 不因 instant 特判（start 时刻就是位置）；title 的时长照 `formatDuration` 实际值
  （`0ms` / `1.5s`），不粉饰成「<1 分钟」。
- 单记录会话（start === end，真实最常见的瞬时会话）与「两条记录落在同一分钟」都命中
  同一判定——阈值 60s 与 §2.2 的 `effectiveEnd` 是同一个常数，全文件只出现这一个跨度
  阈值。

### 4.6 展开区高度预算与门禁断言（<400 放宽到 <640）

@130% 字号的最坏账（文本行 ×1.3，条高与泳道行高不缩放——「形不缩放」是字号那轮红线）：

| 段 | 构成 | @100% | @130% |
| --- | --- | --- | --- |
| `.sessions` padding | `--sp-2` × 2 | 16 | 16 |
| 头部 | `--control-h-sm` | 24 | 24 |
| 摘要行 + 口径脚注 | `--lh-base` + `--lh-xs` | 36 | 52 |
| 时间线 | 轴 `--lh-xs` + 泳道 7×24 + 图例 `--lh-xs` + 内距 | 198 | 212 |
| 清单 | 头 0 + 5 行 × (`--row-pad-y-tight`×2+`--lh-xs`) + 折尾 1 行 | 174 | 202 |
| 脚注 | 2 × `--lh-xs` | 32 | 42 |
| 区间 gap | `--sp-1` × 5 | 20 | 20 |
| **合计** | | **≈500** | **≈568** |

- **门禁断言建议值：`CALENDAR_SESSIONS_MAX_HEIGHT = 640`**（`gui-test.sh:1033` 现值
  400 同名常量改值）。640 = 568 × 1.13 余量；断言语义不变（「展开区高度有界」），
  它防的仍然是无约束膨胀——清单恒 Top5 + 折尾、泳道可视 7 行内滚，两条折叠机制在，
  640 就是够不着的天花板。
- 400 → 640 的动机记录：V1 断言写在展开区只有清单时；本轮摘要 + 时间线是**契约要求的
  新增内容**（Issue #192 范围），不是清单膨胀。保持 400 会逼实现砍契约内容或压条高到
  不可点——那条断言就成了反功能约束。
- 页面可达性：展开区变高约 +240px，用量页是文档流滚动，门禁「滚一次可达」判据
  （`gui-test.sh:1339-1342`）不受影响（它明确不要求「滚到底后恰在视口内」）；
  「面板滚一次可达」的既有判定照旧跑。

### 4.7 项目图例

- 时间线正下方一行：每个非 other 槽一枚「色块 10×10（`.swatch` 语言，
  `UsageOverviewPage.module.css:154-159`）+ `formatProjectPath(label, path)`」，
  `other` 槽存在时末尾「灰块 + 其他 {n} 个项目」。色块 `aria-hidden`，文本是真实信息。
- 图例是「条色 ↔ 项目」的唯一静态对照（条上无文字），槽位不足 5 时只列在场的槽——
  不造空槽位占位。

---

## 5. 交互与清单裁决

### 5.1 Top 会话清单：保留（结论与理由）

**结论：保留，形态与 V1 逐字相同（行四件套 / Top5 + 折尾 / 行点击握手），位置在时间线
之下。** 理由：

1. **信息分工真实存在**：时间线给「形状」（起止、并行、节奏、项目色），清单给「数字」
   （精确 $ / tok / 占比、token 排名、折尾合并账）。折尾会话（第 6+ 名）在时间线上有形
   无数，在清单里有合并读数；两者不是重复是互补。
2. **点击通道的稳定性**：密集日（多泳道、瞬时速杠）瞄准一条 16px 高的条去点，不如
   清单行 30px 高的可点区可靠；键盘用户从格子弹出展开后，清单是熟悉的连续 Tab 目标。
3. **回退安全**：V1 用户已建立「点格子看当天谁在烧」的心智，砍清单是把已交付功能
   换成新功能，不是升级。
4. 高度预算撑得住（§4.6 的账把清单算在内），没有「二选一」的压力。

融合方案（条上直接长文字 / 清单行内嵌迷你条）被否：条内文字在 30px/小时的比例尺下
放不下会话标题，行内嵌条把「数字行」污染成「第二张图」——两种融合都同时削弱两个
通道的纯度。

### 5.2 悬停：原生 `title`，格式与清单行同源

条的可访问名 / title 一份函数两处用（V1 §5.1 的纪律），行序：标题 → 项目 → 起止 →
时长 → 当日消耗：

```
{title}（项目：{project}）· {HH:mm}–{HH:mm} · 时长 {formatDuration(endTs − startTs)} · 当日消耗 {formatUsd(costUsd)} · {formatTokenCount(tokens)} tok[ · 部分未知]
```

清单行 `spoken`（`UsageCalendarPanel.tsx:93-95`）保持不动——两处格式**有意不同**
（清单有占比、条有起止），但共享「标题（项目）· …」的前缀语序，同一家族。

### 5.3 点击：条与清单行同一条握手

- 条点击 → `onOpenSession(sessionsByPath.get(row.path))`，`sessionsByPath` 复用组件既
  有 memo（`UsageCalendarPanel.tsx:155-162`）；无元数据（`path === ""`）的条 `disabled`、
  照画（描边 + 段都在）但不进 Tab、无手型——与清单行 `canOpen` 逻辑（第 87 行）逐字
  同款，「不可打开的会话不装成可打开」。
- 点击后跳会话分析页，展开区随页面切换离场——与 V1 清单行点击同行为，无新增状态。

### 5.4 键盘映射（时间线一个 Tab stop，roving tabindex）

| 键 | 行为 |
| --- | --- |
| Tab / Shift+Tab | 进入 / 离开时间线（当前焦点条 `tabindex=0`，其余 `-1`） |
| ← / → | 按 startTs 序移动到相邻条（首尾越界不动，**不环绕**——与 V1 网格同纪律） |
| Home / End | 第一条 / 最后一条（时间序） |
| Enter / Space | 打开该会话（button 原生行为） |

- 初始焦点 = 第一条（时间最早）；`scrollIntoView({ block: "nearest", inline: "nearest" })`
  跟随（泳道内滚 + 窄条横向都在视口内，同 V1 网格的做法）。
- **不做 ↑/↓ 泳道间移动**：泳道是防重叠的布局产物，不是用户的导航语义（用户想的是
  「下一个会话」不是「上一泳道」）；←/→ 的时间序才是清单 / 归因行共享的心智。
- 展开瞬间焦点仍在日历格子上（V1 §5.2 的取舍原样保留）；时间线自带具名 region
  （§5.5），读屏用户从格子继续探索。
- Tab 序全貌：…网格当前格（1 stop）→ 摘要（无）→ 时间线（1 stop）→ 清单行
  （≤6 stop，V1 原样）→ 清除按钮 → …。一天 20 会话也只 8 个 stop。

### 5.5 aria 结构

```html
<section class="sessions" aria-label="{M}月{D}日一日回望" data-calendar-sessions>
  <div class="sessionsHead">… × 清除（button）</div>
  <p class="summary" data-calendar-summary>…摘要文本…</p>
  <div class="timeline" role="group" aria-label="{M}月{D}日会话时间线">
    <div class="axis" aria-hidden="true">0 4 8 12 16 20 + 刻度线</div>
    <div class="lanes" data-calendar-lanes>
      <button type="button" class="bar" tabindex="-1"
        data-probe="calendar-bar" data-lane="0" data-slot="0" data-instant="false"
        style="left: 39.6%; width: 8.3%; top: 0"
        title="…" aria-label="…">
        <span class="seg" data-seg-hour="10" data-seg-level="2" aria-hidden="true" />
        …
      </button>
      …
    </div>
    <div class="projLegend">…</div>
  </div>
  <ol class="sessionList" aria-label="{M}月{D}日消耗最多的会话">…（V1 原样）</ol>
  <p class="footnote">…</p>
</section>
```

- 时间线容器 `role="group"`（不是 list：条是绝对定位的按钮组，group 的「相关控件组」
  语义贴合且零嵌套成本）；条本身是 button，可访问名 = §5.2 全文。
- `data-calendar-lanes` 是门禁 / e2e 的泳道区锚点（clientHeight 有界断言）；条上
  `data-probe="calendar-bar"` 供计数（=== 当天会话数）；`data-lane / data-slot /
  data-instant / data-seg-hour / data-seg-level` 是断言用的几何 / 编码探针（同 V1
  `data-cal-level` 的先例）。
- 键盘处理挂在 `.lanes` 容器的 `onKeyDown`（事件冒泡自条），roving 状态是组件里的
  `focusIndex` state（V1 `focusDay` 的同构物）。

---

## 6. 状态表

| 场景 | 时间线 | 摘要行 | 清单 | 备注 |
| --- | --- | --- | --- | --- |
| 单会话普通日 | 1 条、1 泳道 | 全字段照算 | 1 行、无折尾 | 最简形态 |
| 瞬时会话（单记录 / 60s 内） | 2px 竖杠、`data-instant="true"` | 跨度显示单时刻 | 照常 | §4.5 |
| 凌晨跨午夜（昨天开的会话） | 今天��条从今天首条记录起 | 口径脚注声明切分 | 照常 | 条 ≠ 会话真实起止，如实 |
| 全天单会话极长（00:01–23:59） | 1 条近满宽、24 个密度段 | 跨度 00:01–23:59 | 1 行 | 段的 alpha 分层可见 |
| 多项目同天（≤6） | 每项目一色，图例全列 | `projects` 计数 | 照常 | 槽位按当日 token 排 |
| 多项目同天（>6） | 第 6+ 项目全灰（other） | 计数含全部 | 照常 | 图例「其他 N 个项目」 |
| 并行 8+ 会话 | 泳道区竖滚（可视 7 行） | 照常 | 照常 | §4.4，形状不删 |
| 密集小时（1 小时 3 会话） | 3 条分 3 泳道同列 | 照常 | 照常 | 泳道即为此而生 |
| 当天全 unknown 模型 | 照画（段按 token 画） | 主力「未知模型」、追加「部分未知价」 | 追加「部分未知」 | 与 V1 格子同诚实度 |
| 无 usage 记录（只有 user 行） | 条只有描边、零密度段 | 消耗 $0.00 · 0 tok、跨度照算 | 行读数 $0.00 · 0 tok | 形状在场、数字如实 |
| 130% 字号 | 条高 / 泳道行高不缩放 | 文本行 ×1.3 | 行高 ×1.3 | §4.6 账按此算 |
| 高对比度（浅 / 深） | 段实色两态 + 段间 1px 分隔线；描边 / 焦点环自动换挡 | 照常 | 照常 | 零新令牌（§3.3） |
| 扫描进行中 | 随批次更新（memo 依赖 `[inputs, selected]`） | 同左 | 同左 | V1 同款渐进语义 |

---

## 7. 验收矩阵（每条都能被断言）

### 7.1 纯函数（`usageCalendar.test.ts` 新增 describe）

- [ ] **首末时刻**：单会话多记录 → `startTs / endTs` = min / max；跨午夜会话（昨天
      23:30 与今天 00:30 各一条）→ 今天调 `dayTimelineOf` 只见 00:30 一条
      （`instant === true`）、昨天调只见 23:30。
- [ ] **逐小时分桶**：记录落 9:30 / 10:15 → `hourlyTokens[9] / [10]` 各得其所；
      `Σ hourlyTokens === tokens`（多条混合 usage）；无 usage 记录不进桶但计 messages。
- [ ] **instant 判定**：`endTs − startTs` = 59_999 → true；= 60_000 → false；
      单记录（start === end）→ true。
- [ ] **泳道**：不重叠两条（A 结束 ≤ B 开始）同泳道；重叠两条分泳道；包含
      （A 包住 B）分泳道；同刻两条 instant 分泳道（effectiveEnd 生效）；
      `max(lane) === laneCount − 1`；同泳道两两不重叠（effectiveEnd 口径）。
- [ ] **项目槽位**：3 项目 → 槽 0/1/2 按当日 token 降序；6 项目 → 恰 5 彩槽 + other；
      7 项目 → other 合并第 6+ 两项（`Σ slots.tokens === summary.tokens`）；
      并列按 label 字典序。
- [ ] **summary**：`topModel` = token 最大者（手算期望）；并列按 id 字典序；全无
      usage → null；unknown 命中 → `UNKNOWN_MODEL_LABEL`；`projects` = distinct 非空
      label 数；`firstTs / lastTs` 与 sessions 的 min / max 相等；sessions === 0 时
      `firstTs === null`（空对象仍可构造，组件不会用它）。
- [ ] **一致性恒等式**（§2.4 全部八条，尤其 `summary` 与 `buildUsageCalendar` 的天
      facts 逐字段相等——同一天同 inputs 两函数对账）。
- [ ] 输入顺序无关：打乱 inputs 与记录顺序，输出逐字段相等。

### 7.2 组件（`UsageCalendarPanel.test.tsx` 新增 describe）

- [ ] 点击昨天格（夹具 `ladderInputs` 风格 + 多记录扩展）：摘要行文本含 `$` / `tok` /
      会话数 / `–`（跨度）/ 模型 / 项目数；口径脚注「时刻为本地时间」在场。
- [ ] 时间线：`[data-probe="calendar-bar"]` 计数 === 会话数；条的 `style.left / width`
      与期望百分比差 < 0.01（jsdom 读内联样式）；instant 条 `data-instant="true"`；
      密度段计数 === 非零小时数、`data-seg-level` 与手算档位一致。
- [ ] 条 title / aria-label 逐字等于 §5.2 格式（三个分支：普通 / instant / 无 usage）。
- [ ] 条点击 → `onOpenSession` 以正确 `SessionMeta` 调用；无元数据条 `disabled`。
- [ ] 键盘：Tab 进时间线落在第一条；←/→ 移动、首尾不动；Home/End；整个 `.lanes`
      内恰一个 `tabindex="0"`。
- [ ] 清单与 V1 断言全部保持绿（头部文案改了「消耗 Top 会话」→ 按新文案同步那一条
      既有断言）；`data-calendar-sessions` / `.sessionList` 结构原样。
- [ ] 泳道折叠：9 会话全重叠 → `.lanes` 的 `style.maxHeight` 在场（jsdom 断
      className + CSS 文件断规则，几何断言留给 e2e / 门禁）。
- [ ] 视觉纪律：module CSS 新规则里零颜色字面量（`--cat-*` / 语义令牌引用除外）、
      零 `--sp-*` 之外的间距字面量（条高 16px、段分隔 1px 是「形」，局部变量
      `--bar-h` 定义并注释豁免，同 V1 `--cal-cell` 的先例）；
      `.bar:focus-visible` 用 `var(--focus-ring-width)`（读 CSS 断言）。

### 7.3 tokens 守卫（`tokens.test.ts`）

- [ ] **无新增**——本轮零新令牌。顺手补一条只读守卫（可选）：`--cat-*` 在四块里
      各自 6 条齐全（若已有则不重复）。

### 7.4 端到端（`web/e2e/usage-calendar.spec.ts` 扩展 + `fixtures.ts` 新场景）

- [ ] **新场景 `dayViewScenario()`**（fixtures.ts 新导出）：内部先调
      `calendarScenario()` 再**追加**文件（sessionId 序号 13 起，不撞既有 1–12）——
      V1 布景与其断言一字不动。追加布景（全部相对 `todayStart` 锚定本地日历日）：
      ① 跨午夜会话：昨天 23:30 user + 今天 00:30 assistant 同 sessionId（cwd
      `/repo/dayview-cross`）；② 凌晨会话：今天 05:00–05:05 两条；③ 密度会话：今天
      09:00/10:00/11:00/12:00 四条、token 100K/400K/200K/800K（input 单类，档位
      1/3/2/4 手算可断）；④ 并行三会话：今天 14:00–15:00 互相重叠（三泳道）。
      注意追加会话会改变「今天 / 昨天」的档位分布——**档位着色断言仍用原
      `calendarScenario` 的 test.describe，dayView 断言单独 `test.use`**，两组互不污染。
- [ ] 展开区结构：点今天格 → `[data-calendar-sessions]` 内摘要行 / 时间线 / 清单
      三段都在；摘要行含今天会话总数（原 3 + 追加 = 手算定值）。
- [ ] **时间线几何真算**：`data-calendar-lanes` 的 `getBoundingClientRect().width`
      记为 W；条 `left_px / W` 与期望 `(ts − dayStart) / daySpan` 差 < 0.5%；条数 ===
      当天会话数；跨午夜条（00:30 单记录）`data-instant="true"` 且 `width ≥ 2`；
      密度会话的段 `data-seg-level` 逐段等于手算（1/3/2/4）；并行三会话
      `data-lane` = 0/1/2 且 `top` 递增 24px。
- [ ] 悬停与点击：条的 `title` 含起止 HH:mm 与 `$`；点击密度会话的条 → 会话分析
      tab 选中、当前会话标题与夹具一致（V1 第 136-143 行断言的同款写法）。
- [ ] 泳道有界：dayView 场景下 `.lanes` 的 `clientHeight ≤ 7 × 24 + 2`；文档 / main
      无横向溢出（既有 `overflowOf` 复用）。
- [ ] HC 档：种 `cca-contrast=high` → 段 `opacity` 计算值为 1、条描边 ≥1px
      （`getComputedStyle` 断，同 V1 HC 断言的写法）；深色 HC 同款抽一。
- [ ] 键盘：聚焦今天格 → Enter 展开 → Tab 落到时间线第一条 → → 移到第二条 →
      Enter 打开会话（真实引擎跑 roving）。

### 7.5 真机门禁（`scripts/gui-test.sh` + `src-tauri/src/lib.rs`）

- [ ] `CALENDAR_SESSIONS_MAX_HEIGHT` 400 → **640**（§4.6 的构成账写进常量旁注释）。
- [ ] `calendarFacts`（`lib.rs:1040-1057`）扩展 `timeline` 事实：
      `{ bars: querySelectorAll('[data-probe="calendar-bar"]').length,
      lanesH: lanesEl.clientHeight, lanesScrollH: lanesEl.scrollHeight }`；
      `sessions` 事实原样（rect / rows）。`the_probe_reports_the_usage_calendar_facts`
      测试（`lib.rs:1835-1843`）同步补三条 `PROBE_JS.contains` 断言。
- [ ] 点选断言（`gui-test.sh:1597-1631`）扩展：展开态加「`timeline.bars` ≥ 1 且
      === 夹具今天会话数（1）」「`lanesH ≤ 170`」两条；收起态断言不变；两次点选
      的 `CAPTURE_TARGETS` 顺序不变（`gui-test.sh:722`）。
- [ ] 门禁夹具不动的理由记录：`calendar-today-0001.jsonl` 两条同秒记录 = 瞬时会话，
      恰好覆盖 instant 路径（`data-instant="true"` + 2px 最小宽可在探针里断
      `getBoundingClientRect().width ≥ 2`，加进 timeline 事实即可，不必改夹具时间）。
- [ ] 截图归档：展开态那张自然带上时间线，人工看图确认（条分明、段档位可辨、
      图例与条色一致、HC 段不粘连）；`docs/screenshots/` 若拆图则补
      `usage-calendar-expanded-*.png` × 两主题。

---

## 8. 明确不做（各自动机）

1. **不做时间轴缩放 / 日内小时直方图切换**：0–24 线性比例尺是「那天我怎么用」的
   诚实形状；缩放把仪表盘做回表格（V1 §8-4 同款裁决）。逐小时聚合图「活跃时段」
   Heatmap 已有（周 × 小时），日粒度再做一张是重复。
2. **不做跨天项目色稳定映射**（§3.2）：需要持久化色分配状态库，v2 砍掉；图例当场
   声明已消除歧义。
3. **不做自绘 tooltip**（V1 §5.1 三条理由原样成立）；**不做段的悬停单独 title**
   （段的时刻与量在条的 title 里按小时精度可换算，段级 title 在 30px 宽的目标上
   反而难命中）。
4. **不做 ↑/↓ 泳道导航**（§5.4）；**不做时间线拖拽 / 平移**（24h 全景本就一屏）。
5. **不动 `daySessionsOf` / `buildUsageCalendar` 的任何签名**（§1.1）：升级是增量的，
   V1 的全部断言（53 列恒等式、档位、清单恒等式）必须原样保持绿。
6. **`now` 不进展开区数据层**（§1.1）：时间线是纯历史事实，没有「现在进行时」的
   推算；今天进行中的会话条到「当前末条记录」为止，不画虚线延伸——那是外推，
   得挂「推算」徽章，v2 不背这个口径。

---

## 9. 实现者清单

按改动顺序，逐文件：

1. `web/src/features/usage/usageCalendar.ts`：§2 全部类型与 `dayTimelineOf`
   （首末时刻 / hourlyTokens / instant / 泳道贪心 / 项目槽位 / summary）；
   `daySessionsOf` 不动。
2. `web/src/features/usage/usageCalendar.test.ts`：§7.1 新 describe（含与
   `buildUsageCalendar` 的一致性对账）。
3. `web/src/features/usage/UsageCalendarPanel.tsx`：展开区五段结构（§1.2）、摘要行、
   时间线（轴 / 泳道 / 条 / 密度段 / 图例）、条 roving tabindex、`data-*` 探针；
   头部文案改「{M}月{D}日 · 共 N 个会话」。
4. `web/src/features/usage/UsageCalendarPanel.module.css`：`.summary / .timeline /
   .axis / .lanes / .bar / .seg / .projLegend` 与 HC 覆盖（段实色 + 分隔线 +
   `:global([data-contrast="high"])` 前缀，同 V1 `.dayButton` 的 HC 写法）；
   局部变量 `--bar-h: 16px` 注释豁免。
5. `web/src/features/usage/UsageCalendarPanel.test.tsx`：§7.2 新 describe + 头部文案
   那条既有断言同步。
6. `web/e2e/fixtures.ts`：`dayViewScenario()`（§7.4 布景）。
7. `web/e2e/usage-calendar.spec.ts`：§7.4 新 describe（原 describe 不动）。
8. `src-tauri/src/lib.rs`：`calendarFacts.timeline` + `the_probe_reports...` 测试补断言。
9. `scripts/gui-test.sh`：`CALENDAR_SESSIONS_MAX_HEIGHT = 640`（+ 构成账注释）、
   点选断言扩展 bars / lanesH。
10. 文档：`CHANGELOG.md`（`[Unreleased] → Added`，中文条目「日历展开区升级为一日
    回望：日摘要 + 24h 会话时间线」）、`docs/USAGE.md` 日历一节补一段（写清
    「条 = 当天首末记录，跨午夜按记录切分」「时刻为本地时间」两条事实）、README
    双语功能条目更新一句。

**一句话**：这一轮的重量压在三个地方——**`dayTimelineOf` 与既有两函数的一致性要靠
恒等式钉死而不是靠小心**（同一天三函数对账，summary 与天 facts 逐字段相等）、
**密度编码要在 HC 档给出诚实的降级**（alpha 台阶换实色两态，量级交给 title，
零新令牌）、**高度预算要从 400 放宽到 640 且把账摆出来**（摘要 + 时间线是契约新增，
两条折叠机制——清单 Top5、泳道可视 7 行——保证 640 是够不着的天花板而不是松掉的
缰绳）。三件事做齐，「一日回望」才是那天真的一眼回得下去。
