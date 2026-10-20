# 「消耗日历」设计规格（Round V · 第一棒）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 日期：2026-10-12 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（Issue #187 已锁定）：用量总览「用量」档新增 Panel「消耗日历（近 12 个月）」——
> GitHub 贡献图形态的滚动 365 天网格，色深 = 当日估算成本四分位，悬停给双数，
> 点击行内展开当天会话 Top 清单，键盘可达，高对比度档提供实算达标的色带变体。
> **快照导出本轮不做**（Issue 明示留待后续棒），但快照的口径自述句要补一个词（§8.1）。
> **本文件只描述设计与断言，不改任何源码。**

---

## 0. 语境与现状（写前逐字读过）

**读过的文件**：`gh issue view 187`（契约权威）、`web/src/styles/tokens.css`、
`web/src/features/usage/UsageOverviewPage.tsx` 与 `.module.css`、
`web/src/features/usage/charts/Heatmap.tsx` / `.module.css` / `.test.tsx`、
`web/src/features/usage/charts/chartPrimitives.tsx` 与 `.module.css`、
`web/src/features/usage/BillingWindowCard.tsx` 与 `.module.css`、
`web/src/features/usage/usageAggregations.ts`、`web/src/features/usage/quotaAttribution.ts`、
`web/src/features/usage/pricingSnapshot.ts`、`web/src/features/usage/useUsageOverview.ts`、
`web/src/features/usage/ToolCensusPanel.tsx`、`web/src/features/usage/CompactionStatsPanel.tsx`、
`web/src/components/Panel.tsx` 与 `Panel.module.css`、`web/src/lib/format.ts`、
`web/src/features/sessions/metadataCache.ts`（`sessionTitle`）、
`web/e2e/fixtures.ts`、`web/e2e/usage-snapshot.spec.ts`、
`web/src/features/usage/UsageOverviewPage.test.tsx`、`scripts/gui-test.sh`（探针与动作段）、
`src-tauri/tauri.conf.json`、
`.trellis/workspace/liangyuxiang/design-round-u-high-contrast.md`（高对比度令牌体系，
本文件格式与颗粒度照它）。

**逐条核对过的既有事实**（后文反复引用，都是实测而不是印象）：

- Issue #187 说「每日 Token 趋势 Panel 之后」；页面上那个 Panel 的实际标题是
  **「每日 Token 消耗」**（`UsageOverviewPage.tsx:422`）——同一个东西，实现时不要
  因为名字对不上而新建第二张趋势图。
- `board` 是两列网格（`UsageOverviewPage.module.css:123-128`），半宽面板成对出现；
  整行面板走 `.compactionRow { grid-column: 1 / -1 }`（同文件 130-134），压缩统计与
  工具普查已是先例。53 列的日历不可能塞进半宽列——本轮必须整行。
- 既有 `Heatmap`（`charts/Heatmap.tsx`）：CELL=20 / GAP=2（第 6-7 行）、色深走
  `--chart-1` + `fillOpacity` 台阶 `[0.3, 0.5, 0.68, 0.84]`（第 17 行）、档位公式是
  **max 归一**（第 77 行 `Math.ceil((count / max) * 4)`），不是四分位；空格子
  `fill: var(--bg-inset)` 无描边（`Heatmap.module.css:47-49`）。日历不复制这套：
  为什么见 §3.1。
- 星期标签已经有一套 **Monday-first** 约定：`WEEKDAY_LABELS = ["一"…"日"]` 与
  `WEEKDAY_ROW_TO_DAY`（`chartPrimitives.tsx:13-16`，注释明写 "Monday-first display
  order"）。
- 按天数据的既有口径：**本地日历日** `dayStartOf`（`usageAggregations.ts:113-116`）、
  跨日安全加法 `addLocalDays`（118-122）；`DayBucket = UsageTotals & { messages }`
  （第 26 行）——**没有成本、没有会话数、没有 topProject**，且 `UsageAggregate.daily`
  的 token 不分模型，而成本必须按模型定价（`pricingSnapshot.ts:51-61` 的
  `estimateCost(totals, model)`，未知模型返回 `{ unknownModel: true }` 而不是 0 价）。
  所以日历不能吃 `aggregateRange` 的产物，必须自己从 `inputs` 聚合——这正是
  Issue 里「不动 `UsageAggregate`、新纯函数模块」的含义。
- 会话归因清单的既有形态（Issue 点名复用）：`AttributionSessionRow`
  （`BillingWindowCard.tsx:48-99`）四件套 = 标题 / token 读数 / 56px 占比条 / 占比；
  基线网格 `minmax(0, 1fr) auto 56px 56px`、行高 `calc(var(--row-pad-y-tight) * 2 +
  var(--lh-xs))`（`BillingWindowCard.module.css:241-258`）；折尾行「其余 N 个会话」
  用内阴影分隔线（303-307）。`quotaAttribution.ts` 的排序与折尾规则：
  tokens 降序、并列按标题再按路径（137-139），`remainder` 为 `null` 而不是空行
  （151-166），身份键 `path:${metaPath}` / 匿名按输入下标（108-118）。
- 面板范式：`Panel`（`Panel.tsx:16-41`）＝ title + actions + children + `ariaLabel`；
  近期面板的统一结构是「纯函数数据层 + Panel 组件 + 口径脚注」（`ToolCensusPanel.tsx`
  的 `FOOTNOTE` 第 17 行、`CompactionStatsPanel.tsx` 的 `zeroState`/`narrative`）。
- 全站没有自绘 tooltip 组件——悬停说明一律原生 `title`（`Heatmap` 的 SVG
  `<title>`、归因行的 `title={label}`、ToolCensus 行的 `title={row.hint}`）。
- e2e 时间相对化的既有做法：夹具写死日期 + `shiftDays` 整体平移到「最新活动日在
  昨天」（`fixtures.ts:94-128`）；以及**内存合成 JSONL** 的先例
  （`quotaAttributionScenario`，`fixtures.ts:356-414`，合成会话按 `Date.now()` 相对
  取时间戳，断言不随运行日期漂移）。
- 真机门禁的动作协议：`CAPTURE_TARGETS` 序列里有 `视图=用量`、`滚动=main`、
  `点选=[data-tool-census-row='Bash']`、`点选=[data-probe='attribution-row']`
  （`gui-test.sh:698`）；几何判定是「事实在应用、断言在脚本」：文档与 `main` 的
  `scrollWidth ≤ clientWidth`、可滚动容器不算溢出（`gui-test.sh:1034-1050`、
  1096-1114）。
- Tauri 窗口 `minWidth: 960`（`tauri.conf.json:17`）；`--sidebar-w: 300px`
  （`tokens.css:152`）。最窄情况下主内容区 ≈ 960 − 300 − 24（page padding）= 636px。
- 高对比度令牌体系（Round U，`tokens.css:327-453`）：四块主题（普通浅 / 深 /
  HC 浅 / HC 深）已经存在，焦点环几何走 `--focus-ring-width/-offset/-inset`
  （`tokens.css:111-113`）。日历色带在这四块里各加一组，换挡机制零新增。

**与在途实现的对接**：无。工作区干净（main @ `ee0d530`），前端没有
`usageCalendar.ts`、没有日历组件、tokens 里没有 `--cal-*`——本轮从零开始，命名以
本文件为准。

---

## 1. 实现约束

### 1.1 数据层：`usageCalendar.ts` 纯函数，不动 `UsageAggregate`

- 新模块 `web/src/features/usage/usageCalendar.ts`，从 `readonly UsageSessionInput[]`
  聚合，**不改 `usageAggregations.ts` 的任何类型与函数**（Issue 原文「不动
  `UsageAggregate`」）。`compactEvents` / `errorExtract` / `toolCalls` 照旧忽略——
  它们是别的面板的私货，日历不碰。
- 记录口径与 `aggregateSession` 逐字相同（`usageAggregations.ts:199-203`）：
  只数 `kind === "user" | "assistant"` 且 `compactSummary !== true` 的记录；
  token 从记录自带的 `usage` 读（缺失为 0），模型从 `record.model` 读
  （缺失按 `UNKNOWN_MODEL_LABEL`，`usageAggregations.ts:108` / 221）。
- **成本必须按 (day, model) 双键分桶**：`DayBucket` 没有模型维度，直接拿日合计
  乘「某均价」会破坏 `estimateCost` 的按模型定价口径（`pricingSnapshot.ts:51-61`）。
  每天维护 `Map<model, UsageTotals>`，对每个模型单独 `estimateCost` 后求和；
  任何模型命中 `unknownModel` → 该天 `hasUnknownCost = true`（token 不折为 0 价，
  与页面 KPI 的 `cost.hasUnknown` 处理同款，`UsageOverviewPage.tsx:165-179`）。
- 时间窗：`now` 由调用方注入（页面传 `readouts.now` 之外任选一个 `Date.now()` 实例
  即可，日历不参与计费对账）；窗口 = `[addLocalDays(todayStart, -364), todayStart]`
  共 **365 个本地日**（含今天）。365 天 = 整 52 周 + 1 天，起点与今天**同星期**，
  这是 §4.1 那个 53 列恒等式的来源。

### 1.2 窗口与区间选择器正交

- 日历的聚合 memo 只依赖 `[inputs]`，**不吃 `days`**（7/30/90 区间选择器不影响它）。
  Issue 原文「窗口固定滚动 12 个月，不随区间选择器变（在面板脚注写明）」。
- `view === "errors"` 时整个日历不渲染（它住在用量档的 board 里，
  `UsageOverviewPage.tsx:371-493` 的条件结构已经保证）。

### 1.3 位置与面板形态

- DOM / 视觉位置：`board` 里「每日 Token 消耗 | 按项目分布」**两枚半宽面板之后**、
  「按模型分布 | 活跃时段」之前，套 `.compactionRow` 整行。裁决理由：Issue 说
  「趋势 Panel 之后」按 DOM 顺序成立；若紧贴趋势插整行，第一行会剩半宽空洞——
  两列网格不留洞正是 `compactionRow` 的立身之本（`UsageOverviewPage.module.css:130-134`
  的注释）。日历是全应用最具传播力的一张图，占住第二行整行、进首屏，位置本身是
  产品决策。
- 面板外壳用 `Panel`（title="消耗日历（近 12 个月）"、`ariaLabel` 同文）；actions
  挂 `<ProvenanceBadge provenance="estimated" detail={`色深按估算成本折算（定价快照
  ${PRICING_AS_OF}）`} />`——色深是估算值，来源徽章说清口径（同页「估算成本」KPI
  的徽章先例，`UsageOverviewPage.tsx:404-406`）。
- 高度预算：月份标签行 16 + 7 行 × (12 + 3) − 3 + 图例与脚注 ≈ **170px**，整行面板
  不会把首屏顶穿。

---

## 2. `usageCalendar.ts`：类型签名与四分位

### 2.1 类型（TypeScript，实现照抄）

```ts
import type { UsageSessionInput } from "./usageAggregations";

/** 一天的日历事实。tokens = 四类计数器之和（totalsSum 口径）。 */
export type CalendarDayFacts = {
  dayStart: number;
  tokens: number;
  /** 已定价部分的估算成本（按 (day, model) 分桶后逐模型 estimateCost 求和）。 */
  costUsd: number;
  /** 当天存在 unknownModel 的 token（成本是部分已知，不是 0）。 */
  hasUnknownCost: boolean;
  /** user/assistant（非 compactSummary）记录条数，与 aggregateSession.messages 同口径。 */
  messages: number;
  /** 当天有上述记录的会话数（按会话去重，不是记录数）。 */
  sessions: number;
  /** 当天 token 最多的项目；并列取 label 字典序最小；当天无 token 为 null。 */
  topProject: { label: string; path?: string } | null;
};

export type CalendarCell =
  | { kind: "pad" }                       // 窗口外占位（首尾列的缺口）
  | ({ kind: "day" } & CalendarDayFacts & { level: 0 | 1 | 2 | 3 | 4 });

export type UsageCalendar = {
  /** 每列的周一 dayStart，升序；长度恒 53（§4.1 恒等式）。 */
  weekStarts: number[];
  /** cells[weekIndex][rowIndex]，rowIndex 0=周一 … 6=周日（Monday-first）。 */
  cells: CalendarCell[][];
  /** 月份标签：weekIndex 列的列头文本；同月名出现两次时两个都带年号（§4.4）。 */
  monthMarks: Array<{ weekIndex: number; label: string }>;
  /** 非零成本天的四分位（Type 7）；无非零天时为 null（全图 0 档）。 */
  quartiles: { q1: number; q2: number; q3: number } | null;
};

export function buildUsageCalendar(
  inputs: readonly UsageSessionInput[],
  now: number
): UsageCalendar;

/** 四分位档位（独立导出便于单测）：cost ≤ 0 或 q 为 null → 0。 */
export function levelOfCost(
  cost: number,
  q: { q1: number; q2: number; q3: number } | null
): 0 | 1 | 2 | 3 | 4;

/** 点击格子后的当天会话 Top 清单（按需调用，不进 buildUsageCalendar）。 */
export type CalendarSessionRow = {
  /** SessionMeta.path；无元数据输入为空串（行照列、不可点，同归因面板）。 */
  path: string;
  /** sessionTitle 的口径；无元数据退回 projectLabel（同 quotaAttribution.ts:128-129）。 */
  title: string;
  projectLabel: string;
  projectPath?: string;
  /** 当天该会话 token（四类和）。 */
  tokens: number;
  /** 当天该会话估算成本（该会话当天记录按 (day, session, model) 折算；
      §5.2 的行读数「$X · N tok」双数来自这里——主会话工程评审补，
      初稿类型里漏了这个字段而 §5.2 已要求显示）。 */
  costUsd: number;
  /** 该会话当天存在 unknownModel 的 token（行读数末尾追加「· 部分未知」）。 */
  hasUnknownCost: boolean;
  /** tokens / dayTokens（0..1）；分母为 0 时是 0，不是 NaN。 */
  share: number;
};

export function daySessionsOf(
  inputs: readonly UsageSessionInput[],
  dayStart: number,
  options?: { top?: number }   // 默认 5
): {
  rows: CalendarSessionRow[];   // tokens 降序，并列按 title 再按 path（同归因排序）
  remainder: { sessions: number; tokens: number; share: number } | null;
  sessions: number;             // 当天有记录的会话数（含被截断的）
  dayTokens: number;            // 占比分母
};
```

### 2.2 四分位的精确定义（可单测的唯一公式）

**Type 7 线性插值**（与 Excel / R 默认一致，别按「取第 n/4 个元素」那种粗糙版写）：

```
values = 当天 costUsd > 0 的天，升序（严格 > 0：0 成本天不进分布）
n = values.length；n === 0 → quartiles = null
对 p ∈ {0.25, 0.5, 0.75}：
  rank = p × (n − 1)
  lo = floor(rank)，hi = ceil(rank)
  q(p) = values[lo] + (rank − lo) × (values[hi] − values[lo])

levelOfCost(cost, q)：
  q 为 null 或 cost ≤ 0        → 0
  cost ≤ q.q1                   → 1
  cost ≤ q.q2                   → 2
  cost ≤ q.q3                   → 3
  否则                          → 4
```

三条硬性质（单测逐一钉住）：

1. **相等成本必然同档**——阈值比较（`≤`）而不是按秩分档，并列值不会一深一浅。
2. **退化自然成立**：n=1 时 q1=q2=q3=唯一值 → 唯一非零天落 1 档（分布无差异时
   全部最浅档，§3.5 第 3 条有豁免说明）；n=2 → 两档（1 与 4）；n=3 → 三档
   （1、2、4）。不需要特判分支。
3. **0 档即「无消耗」**：`costUsd === 0` 的天（无记录 / 只有无 usage 记录 / 全部
   未知价）一律 0 档——色即成本，0 成本不上色。全 unknown 天的 token 与会话数
   照进 tooltip（§5.1），不因为成本缺失而装作没有活动。

### 2.3 恒等式（`daySessionsOf` 的验收线，照 `quotaAttribution.ts:94-95` 的写法）

当 `daySessionsOf` 与格子出自同一批 `inputs` 时必然成立：

- `Σ rows.tokens + remainder.tokens === dayTokens`（当天总量）；
- `Σ rows.share + remainder.share === 1`（浮点容差 1e-9）；
- `rows.length === min(top, sessions)`；`remainder === null ⇔ sessions ≤ top`。

---

## 3. 色带：四块令牌 × 四档

### 3.1 为什么是新令牌 `--cal-1..4`，而不是复用

- **不借 `--chart-1` 的 opacity 台阶**（Heatmap 的做法）：①`tokens.css:64-68` 明写
  图表色板「严禁借去表达项目 / 模型 / **日期**」——日历色深正是日期维度，借了
  会让 chart-1 同时表示「第一个系列」和「日历热度」两个语义；②Round U 已把
  `-soft` 全部改成实色，理由是半透明叠纯白 / 纯黑「叠出来的氛围不可控」
  （`tokens.css:329-330`）——365 格的色带在 HC 底上尤其不能用 opacity 台阶。
- **不借语义色**：绿 = success（确定性读数）、琥珀 = warning、红 = danger
  （`tokens.css:45-53` 的三档「确定性」语义）；「消耗多」不是错误也不是成功，
  借了会同时毁掉两个维度。
- 取 **靛蓝单色相明度阶梯**：不在语义三色里，与最邻近的既有蓝
  （`--chart-1` #2f6b9f / `--cat-direct` #0072b2 / `--accent` #2952cc）保持整档
  明度差（同一文件注释里的既定规则），值全部新造、令牌名独立，无复用纠纷。
- 命名 `--cal-1..--cal-4`，1 最浅 4 最深（深色主题反过来：4 最亮——与类别色
  「深色下提明度」同策略，`tokens.css:286-288`）。空格不设令牌：直接
  `background: var(--bg-inset)`，与 `Heatmap.emptyCell`（`Heatmap.module.css:47-49`）
  同一个「凹槽 = 没有数据」语义，四态自动换挡，零新增。

### 3.2 四块令牌表（追加到 `tokens.css` 对应块的末尾，代码照抄）

```css
/* :root 追加（图表色板之后） */
  /* 消耗日历色带（Issue #187）：色深 = 当日估算成本四分位，靛蓝单色相明度阶梯。
     不复用 --chart-*（图表色板严禁借给日期维度）也不复用 opacity 台阶
     （高对比度下要实色，同 -soft 改实色的理由）。1 最浅、4 最深；
     空格直接用 --bg-inset，不设 --cal-0。逐条对比度与豁免见
     .trellis/workspace/liangyuxiang/design-round-v1-usage-calendar.md §3.3。 */
  --cal-1: #cfdaf5;
  --cal-2: #a9bdeb;
  --cal-3: #7c97e0;
  --cal-4: #4063c6;
```

```css
/* [data-theme="dark"] 追加：同色相提明度，4 最亮 = 消耗最多（深色下亮即多）。 */
  --cal-1: #232a4d;
  --cal-2: #33407a;
  --cal-3: #4d5fa8;
  --cal-4: #7e93e0;
```

```css
/* [data-contrast="high"] 追加：档间拉大（相邻 ≥1.7，实算见规格 §3.3），
   并给每格 1px --border 实色描边（组件侧 §5.4）——半透明阶梯在纯白上
   相邻档塌缩，描边承担「格线可辨」，填充承担档位。 */
  --cal-1: #c1d1f6;
  --cal-2: #7f9be6;
  --cal-3: #4a68cd;
  --cal-4: #142e8c;
```

```css
/* [data-theme="dark"][data-contrast="high"] 追加：同上，4 最亮。 */
  --cal-1: #31407a;
  --cal-2: #5062b0;
  --cal-3: #7a90d6;
  --cal-4: #b3c5f6;
```

### 3.3 实测对比度（WCAG 2.1 相对亮度，公式同 Round U §3.1）

门槛沿用项目既定三档：正文 ≥7、次要 ≥4.5、**边框与图形 ≥3**；色带另有两条
日历自设门槛：**相邻档 ≥1.3（普通）/ ≥1.7（HC）**、**cal-1 vs 空格 ≥1.2**——
「色即消耗」的前提是最浅非空档与空格分得开。

**普通浅色（面板底 `--bg-subtle` #ffffff，空格 `--bg-inset` #f1f3f5）**

| 组合 | 前景 | 底色 | 比值 | 门槛 |
| --- | --- | --- | --- | --- |
| cal-1 vs 面板底 | `#cfdaf5` | `#ffffff` | **1.40** | 面积底（§3.5-1） |
| cal-2 vs 面板底 | `#a9bdeb` | `#ffffff` | **1.88** | 面积底 |
| cal-3 vs 面板底 | `#7c97e0` | `#ffffff` | **2.85** | 面积底 |
| cal-4 vs 面板底 | `#4063c6` | `#ffffff` | **5.50** | 面积底 |
| cal-1 vs 空格 | `#cfdaf5` | `#f1f3f5` | **1.26** | ≥1.2 |
| 相邻 cal-1→2 / 2→3 / 3→4 | — | — | **1.34 / 1.52 / 1.93** | ≥1.3 |
| 空格 vs 面板底 | `#f1f3f5` | `#ffffff` | **1.11** | 同 Heatmap 空格（豁免） |

**普通深色（面板底 #14161a，空格 #0a0b0d）**

| 组合 | 前景 | 底色 | 比值 | 门槛 |
| --- | --- | --- | --- | --- |
| cal-1..4 vs 面板底 | 逐条 | `#14161a` | **1.30 / 1.86 / 3.03 / 6.16** | 面积底 |
| cal-1 vs 空格 | `#232a4d` | `#0a0b0d` | **1.42** | ≥1.2 |
| 相邻 cal-1→2 / 2→3 / 3→4 | — | — | **1.43 / 1.63 / 2.03** | ≥1.3 |

**高对比度浅色（面板底 #ffffff，空格 #eef1f5，格描边 `--border` #6b7280）**

| 组合 | 前景 | 底色 | 比值 | 门槛 |
| --- | --- | --- | --- | --- |
| cal-1..4 vs 面板底 | 逐条 | `#ffffff` | **1.53 / 2.72 / 5.06 / 11.67** | 面积底 + 描边 |
| cal-1 vs 空格 | `#c1d1f6` | `#eef1f5` | **1.35** | ≥1.3（HC 加严） |
| 相邻 cal-1→2 / 2→3 / 3→4 | — | — | **1.77 / 1.86 / 2.31** | ≥1.7 |
| 格描边 vs 面板底 | `#6b7280` | `#ffffff` | **4.83** | ≥3 ✓ |
| 格描边 vs cal-1 / cal-4 | `#6b7280` | 逐条 | **3.16 / 2.41** | 记录（外缘是主信号） |

**高对比度深色（面板底 #121212，空格 #000000，格描边 `--border` #767676）**

| 组合 | 前景 | 底色 | 比值 | 门槛 |
| --- | --- | --- | --- | --- |
| cal-1..4 vs 面板底 | 逐条 | `#121212` | **1.91 / 3.31 / 6.06 / 10.91** | 面积底 + 描边 |
| cal-1 vs 空格 | `#31407a` | `#000000` | **2.14** | ≥1.3 |
| 相邻 cal-1→2 / 2→3 / 3→4 | — | — | **1.73 / 1.83 / 1.80** | ≥1.7 |
| 格描边 vs 面板底 | `#767676` | `#121212` | **4.12** | ≥3 ✓ |

**状态描边（四态通用，画在 3px 缝隙的面板底上、与格子填充无关）**

| 组合 | 前景 | 底色 | 比值 | 门槛 |
| --- | --- | --- | --- | --- |
| 今天标记 `--text-secondary` 外描边 vs 面板底 | `#4a5260` | `#ffffff` | **7.87** | ≥3 ✓ |
| 同上（深） | `#b4bcc6` | `#14161a` | **9.44** | ✓ |
| 同上（HC 浅） | `#000000` | `#ffffff` | **21.00** | ✓ |
| 同上（HC 深） | `#ffffff` | `#121212` | **18.73** | ✓ |
| 选中格 / 焦点环 `--accent` vs 面板底 | 四态 | 逐条 | **6.62 / 7.72 / 9.52 / 8.97** | ≥3 ✓ |

今天标记因此定为 **`box-shadow: 0 0 0 1px var(--text-secondary)`（外扩，压在缝隙上）**
而不是内描边——内描边要与格子填充比对比度（普通浅 cal-4 上只有 1.43，弱）；
外扩描边永远与面板底相邻，四个主题全部 ≥7.8，数值与档位解耦。

### 3.4 复现脚本（可直接 `node` 跑，上表每个数字由它产出）

```js
// 用法：node cal-contrast.mjs（公式与 tokens.test.ts 的 luminance/contrast 同源）
const chan = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => chan(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const themes = [
  ["普通浅", { panel: "#ffffff", inset: "#f1f3f5", cal: ["#cfdaf5", "#a9bdeb", "#7c97e0", "#4063c6"], today: "#4a5260" }],
  ["普通深", { panel: "#14161a", inset: "#0a0b0d", cal: ["#232a4d", "#33407a", "#4d5fa8", "#7e93e0"], today: "#b4bcc6" }],
  ["HC浅",   { panel: "#ffffff", inset: "#eef1f5", cal: ["#c1d1f6", "#7f9be6", "#4a68cd", "#142e8c"], today: "#000000" }],
  ["HC深",   { panel: "#121212", inset: "#000000", cal: ["#31407a", "#5062b0", "#7a90d6", "#b3c5f6"], today: "#ffffff" }]
];
for (const [name, P] of themes) {
  console.log(`\n### ${name}`);
  P.cal.forEach((c, i) => console.log(`cal-${i + 1}: vs底 ${cr(c, P.panel).toFixed(2)} vs空格 ${cr(c, P.inset).toFixed(2)}`));
  for (let i = 1; i < 4; i++) console.log(`相邻 ${i}→${i + 1}: ${cr(P.cal[i - 1], P.cal[i]).toFixed(2)}`);
  console.log(`今天外描边 vs底: ${cr(P.today, P.panel).toFixed(2)}`);
}
```

### 3.5 豁免与边界（每条有数字与理由）

1. **色带格子是面积填充，不适用 3:1**——与 `-soft` 同款豁免（Round U §3.5-1 的
   先例：浅 1.37–1.38 / 深 1.95–1.96）。日历格子的「边界与读数」由三条冗余通道给：
   tooltip 的精确数字、HC 档的 1px 描边（4.83 / 4.12）、色带自身的档间台阶
   （相邻 ≥1.3 / ≥1.7）。普通档不加描边——365 格 × 1px 描边会把色块阵列变成
   表格，GitHub 式的「形状感」就没了；这是取舍，不是遗漏。
2. **cal-1 vs 底不足 3 不修**（普通浅 1.40 / HC 浅 1.53）：最浅档要「有但轻」，
   拉到 3:1 会吞掉档间预算。判定「这格有没有数据」看的是 cal-1 vs **空格**
   （1.26 / 1.35 / 1.42 / 2.14）加上色相差（蓝 vs 中性灰），这是唯一编码，
   所以这条门槛写进了 tokens 守卫（§7.2）。
3. **全部非零天同成本 → 全 1 档**：分布无差异时四分位塌缩，整图最浅档。这是
   诚实的（数据真没分化），不是 bug；tooltip 有精确数字兜底。
4. **悬停描边允许弱**：`--border-strong` 叠白底约 1.47（半透明合成）。悬停是
   瞬态冗余通道（tooltip 同时弹出），与 Heatmap `.cell:hover` 同款语言，不设门槛。

---

## 4. 网格几何

### 4.1 53 列恒等式（本轮最重要的几何不变量）

窗口 = 365 天 = 52 整周 + 1 天，**起点与今天同星期**（`addLocalDays(todayStart, -364)`
保持 weekday）。对齐到周一后：

```
列数 = 52 + 1 = 53（恒成立，与今天星期几无关）
总格数 = 53 × 7 = 371
窗口内天格 = 365；pad 格 = 371 − 365 = 6（首列 offsetStart 格 + 尾列 6 − offsetStart 格）
```

这条不变量让单测、e2e、真机探针都能断死数字：**`[data-probe="calendar-day"]`
计数恒 365，pad 不挂 probe**。写测试时不要用「约 52~53 列」这种松断言。

### 4.2 尺寸与横向滚动

- 格子 **12 × 12px**、缝 **3px**、圆角 `--r-xs`(2px)。12px 是「形」不进 `--sp-*`
  档位（`tokens.css:9-11` 的形距豁免），且**不随 `--font-scale` 缩放**（间距、图形
  不缩放是字号那轮的既定红线）；GitHub 桌面同量级（11px）。字号放大只影响标签
  文本，格子阵形状稳定——这是「一眼可读的形状」的前提。
- 网格固有宽 = 53×12 + 52×3 + 星期标签列（约 16px 文本 + 8 缝）≈ **816px**。
- 滚动判据（写实数，不写「视情况」）：视口宽 ≥ 约 1160px（1160 − 300 sidebar −
  24 padding = 836 ≥ 816）一屏放下；**窗口 minWidth 960 时内容区 636px < 816px，
  必然横向滚动**。做法：网格容器 `min-width: 816px` + 父容器 `overflow-x: auto`，
  竖向不滚。既有几何判定（文档与 main 的 `scrollWidth ≤ clientWidth`，
  `gui-test.sh:1034-1050`）不会被破坏——滚动收在日历容器内部。
- 焦点格子移动时 `scrollIntoView({ block: "nearest", inline: "nearest" })`，横向
  跟随不跳动。

### 4.3 周起始：周一，写死，不读 Intl

- 依据：①全站唯一的星期序列已是 Monday-first（`chartPrimitives.tsx:13-16`，
  `Heatmap` 渲染同款）；②目标用户（中文）的日历习惯是周一开头；③读 `Intl`
  会让列对齐与标签随运行环境 locale 漂移，e2e / 真机的「53 列 + 首行是周一」
  断言就不可断。GitHub 也是客户端写死。**结论：写死周一，直接 import
  `WEEKDAY_LABELS` / `WEEKDAY_ROW_TO_DAY`，不新造第二份。**
- 星期标签 7 行全标（一、二、三、四、五、六、日，单字符等宽），样式复用
  `--fs-xs` + `--text-tertiary`（同 Heatmap 的 `tickText` 语言，但这里是 DOM 不是
  SVG，走 `.weekdayLabel` 类）。

### 4.4 月份标签：重复月带年号

- 标签放在该月**第一个出现日**所在列的列头，`colspan` 跨到下一标签列之前，
  文本左对齐。默认格式 `10月`。
- 365 天窗口必然跨 12 或 13 个日历月；**同一月名出现两次时（只能是窗口首月与
  末月，如 2025-10 与 2026-10），两个标签都带年号，格式 `2025/10`、`2026/10`**。
  裁决理由：只给一个带年号，用户要自己推另一个的年份；两个都带，一眼分清，
  且规则对称（「重复 ⇔ 都带」）没有例外分支。带年号只多占 3 字符，列头有
  colspan 撑着。
- 标签数断言：`monthMarks.length ∈ {12, 13}`（今天恰为月末时是 12 且无重复）；
  重复时恰有两个含 `/` 的标签。

---

## 5. 交互

### 5.1 悬停 tooltip：原生 `title`，不新建组件

- **复用原生 `title` 属性**（全站既有模式：`Heatmap` 的 `<title>`、归因行
  `title={label}`、ToolCensus 行 `title={row.hint}`——项目里没有也不需要自绘
  tooltip 基建）。365 格 × 自绘浮层 = 新造一套定位 / 边界翻转 / 层叠管理，收益
  只有样式；原生 title 零成本且行为可预期。
- `title` 与 `aria-label` **同文**（一份格式函数两处用，不许分叉）：

```
有消耗：  {Y}年{M}月{D}日 · 估算成本 {formatUsd(cost)} · {formatTokenCount(tokens)} tok · {n} 个会话 · {formatProjectPath(topProject)}
有记录无成本（含全 unknown）：{Y}年{M}月{D}日 · {tokens} tok · {n} 个会话 · 定价未知
无记录：  {Y}年{M}月{D}日 · 无消耗
```

  日期永远带年（title 是跨年窗口里唯一可靠的年号来源）。`hasUnknownCost` 且
  cost > 0 的天在末尾追加 ` · 部分会话未知价`。
- **行序固定**：日期 → 成本 → token → 会话数 → 项目（Issue 契约的顺序，成本是
  色深口径所以先于 token）。聚焦时读屏念 `aria-label` 同文，键盘用户不依赖
  title 的显示行为。

### 5.2 点击展开：`daySessionsOf` + 归因面板形态

- 点击 / Enter 一个 `sessions > 0` 的格子：网格**下方**（面板体内、脚注之上）
  展开「当天会话 Top 清单」，形态复用归因面板的既有样式——行四件套
  标题 / 读数 / 占比条 / 占比，基线网格、行高、占比条（56px 轨道 + `--chart-1`
  实色填充、非零最小 2px）从 `BillingWindowCard.module.css:241-358` 抄，居所是
  面板内的展开区（同 `ToolCensusPanel` 的 drilldown 范式：头部一行 + 列表，
  `ToolCensusPanel.tsx:315-361`）。
- 头部：`{M}月{D}日消耗 Top 会话 · 共 {n} 个` + `× 清除`按钮（同 ToolCensus 的
  `.clear`）。
- 行读数列显示 **`{formatUsd(cost)} · {formatTokenCount(tokens)} tok` 双数**
  （色深是成本口径，行给双数呼应；归因面板单 token 读数是窗口口径，两处不同
  是有意的）。行的成本按该会话当天记录的 (model, usage) 折算，unknown 记入
  `hasUnknown` 不折 0。
- **占比分母 = 当日 token 总量**（token 完备无缺失，成本有 unknown 破洞），
  展开区脚注写明：`占比分母 = 当日 token 总量；成本为估算值。`——与归因面板
  「占比分母 = 本窗口总消耗」同构（`BillingWindowCard.tsx:30`）。
- 折尾：Top 5 之后 `其余 {n} 个会话` 行（内阴影分隔线 + 降档填充色 + `—` 语义），
  会话数 ≤ 5 时**不造空行**（`remainder === null`，同 `quotaAttribution.ts:151-166`）。
- 行点击 → `onOpenSession(session)`，与归因 / 压缩 top3 / 工具普查同一条握手；
  无 `SessionMeta` 的行照列但 `disabled`（`BillingWindowCard.tsx:57-74` 的
  `canOpen` 逻辑照抄）。
- **空态与无效点击**：`sessions === 0` 的格子（色必为 0 档——色即消耗）不挂
  `aria-expanded`，点击 / Enter 无展开、无报错、无 toast：格子 `aria-label` 已经
  说了「无消耗」，再弹反馈是重复播报。再次点击已展开的格子 = 收起；点击另一格
  = 切换目标。
- 展开后**焦点留在格子上**（网格操作连续性优先；展开区自带
  `aria-label="{M}月{D}日会话清单"` 的具名 region 供读屏探索）。取舍记录在案：
  焦点跳入清单会让方向键导航断在展开瞬间，Round V 后续棒若做「清单内键盘环」
  再议。

### 5.3 键盘映射（roving tabindex，整个网格一个 Tab stop）

| 键 | 行为 |
| --- | --- |
| Tab / Shift+Tab | 进入 / 离开网格（只有当前焦点格 `tabindex=0`，其余 `-1`） |
| ← / → | 同星期行内移动一周（±7 天；目标是 pad 或越界则不动，**不环绕**） |
| ↑ / ↓ | 同列移动一天（±1 天；周一上移 / 周日下移越界不动） |
| Home / End | 当前行第一个 / 最后一个天格 |
| Enter / Space | 展开或收起该天清单（button 原生行为） |
| Escape | 焦点格处于展开态时收起，焦点留在格上 |

- 初始焦点 = **今天**那格（网格获得焦点时落到 `data-probe="calendar-today"`），
  这是用户最关心的位置，也省一次「找到今天」的导航。
- 焦点环：`outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset)`——Round U 的令牌体系自动给普通 2px /
  HC 3px，零额外规则（Issue 契约「焦点环宽度随对比度档」由令牌兑现，不是组件
  特判）。
- 选中格（展开中）持续标记：`outline: 2px solid var(--accent)`（与焦点环同款，
  画在缝隙上，四态 ≥6.6，§3.3 末表）；与焦点环重合时视觉同一圈，可接受。

### 5.4 aria 结构（真实 `<table>`，不手搓 `role=grid`）

```html
<table class="…" aria-label="消耗日历（近 12 个月）">
  <tr>  <!-- 列头行 -->
    <th scope="row" aria-hidden="true"></th>          <!-- 左上角空 -->
    <th scope="col" colspan="…">10月 / 2025/10</th>   <!-- 12~13 个，跨列 -->
  </tr>
  <tr>  <!-- × 7，Monday-first -->
    <th scope="row">一</th>
    <td class="pad" />                                <!-- 窗口外，无内容无焦点 -->
    <td><button type="button" tabindex="-1"
        data-probe="calendar-day" data-cal-level="2"
        aria-label="2026年10月12日 · 估算成本 $3.42 · 1.2M tok · 3 个会话 · cc-analyzer"
        [aria-expanded="true"]>（视觉色块，无文本）</button></td>
    …
  </tr>
</table>
```

- 用真实 `<table>`：`role=grid` 要手维护 row/gridcell 嵌套与 CSS 布局的兼容
  （`display: contents` 在 WKWebView 的映射历史上不可靠），而 table 的行列语义、
  `scope` 全部免费；交互格子是 `<td>` 里的 `<button>`，GitHub 式日历的通用做法。
- table 上不另设 `role`（table 语义即所需）；`aria-label` 与 Panel 标题同文
  「消耗日历（近 12 个月）」。
- 每格按钮的可访问名 = §5.1 的 `aria-label` 全文（日期永远带年，这是跨年窗口
  里年号的第二落点）；按钮无可见文本（色块是 `aria-hidden` 的填充）。
- pad 格是空 `<td>`：无按钮、无 aria、不可聚焦，读屏自然跳过。
- `data-cal-level="0..4"` 是档位探针（e2e / 真机断色用）；今天格加
  `data-probe="calendar-today"`（唯一，真机「点选=」动作的稳定锚点，同
  `data-probe='attribution-row'` 的先例）。
- 图例（网格下方、展开区之上）：`无 [0档格] ／ 少 [1][2][3][4] 多`——5 格与
  格子同一套令牌，0 档格带「无消耗」标注（Heatmap 图例的「刻度是组件的一部分」
  原则，`Heatmap.tsx:26-29` 的注释）。

---

## 6. 状态表

| 场景 | 网格 | 展开区 | 备注 |
| --- | --- | --- | --- |
| 正常（12 个月有数据） | 53 列 × 7 行，365 天格 + 6 pad | 无 | 初始焦点 = 今天格 |
| 12 个月无任何记录 | 照画（全 0 档 + pad） | 无 | **不整块消失**：形状本身就是「这一年没用」，与 Heatmap 空态不同（那是密度图，这是身份图）；quartiles = null |
| 跨年窗口（常态） | 12~13 个月标签，重复月带年号 | — | 今天非月末时 13 个标签 |
| 闰年（窗口含 2/29） | 365 天格不变 | — | 53 列恒等式与闰年无关（365 恒定） |
| 区间选择器切 7/30/90 | **不变** | 不变 | memo 不吃 `days`；脚注声明 |
| 切「错误」档 | 整面板不渲染 | — | 住在 board（usage 档条件块）里 |
| 扫描进行中（渐进批次） | 随批次更新（色阶随新数据重算） | 若目标天数据已到则照常 | 同 `aggregateRange` 的渐进语义；已展开的天在新批次后内容刷新 |
| 130% 字号 | 格子 12px 不变，标签放大 | — | 网格固有宽不变，滚动判据不变 |
| 高对比度（浅 / 深） | 色带换实色阶梯 + 1px `--border` 描边；焦点环 3px | 占比条描边语言不变 | 全部走令牌，组件零分支 |
| 全部非零天同成本 | 全 1 档 | — | §3.5-3 豁免 |
| 某天只有 unknown 模型 | 0 档 + label「定价未知」 | 照常展开（sessions > 0） | 色即成本，成本未知不上色 |

---

## 7. 验收矩阵（每条都能被断言）

### 7.1 纯函数（`usageCalendar.test.ts`，照 `quotaAttribution.test.ts` 的形状）

- [ ] **53 列恒等式**：任意 `now`（扫过一周 7 个 weekday 锚点）→ `weekStarts.length
      === 53`、天格计数 365、pad 计数 6、`cells[0][0]` 是周一且首列在窗口起点前
      恰有 `offsetStart` 个 pad。
- [ ] 周一先行：`weekStarts` 每项的 `getDay() === 1`；第一行 rowheader 是「一」。
- [ ] **跨年**：`now = 2026-10-12`（本地）→ monthMarks 含 `2025/10` 与 `2026/10`
      两个带年标签、其余不带；`now = 2026-01-01` → 标签 12 或 13 个、重复规则
      保持「重复 ⇔ 都带年」。
- [ ] **闰年**：`now = 2024-03-10`（窗口含 2024-02-29）→ 天格仍 365、2/29 落在
      正确列。
- [ ] **四分位档**：手造 8 天成本 `[1,2,3,4,5,6,7,100]` → 断言每档成员（q1=3.25、
      q2=4.5、q3=6.75 → 档 1:≤3.25、档 2:≤4.5、档 3:≤6.75、档 4:>6.75）；
      **并列同档**：`[5,5,5,9]` 三个 5 同档；**n=1** → 1 档；**n=0** →
      `quartiles === null`、全 0 档；**全同值** → 全 1 档。
- [ ] 0 成本天（只有 user 记录 / 全 unknown）：level 0、`sessions` 照计、
      `hasUnknownCost` 只在真有 unknown token 时为 true。
- [ ] 成本按 (day, model) 分桶：同一天 sonnet + haiku 各若干 → `costUsd` 等于
      两笔 `estimateCost` 之和（拿 `MODEL_PRICING` 手算期望值，不近似）。
- [ ] 跨午夜会话：记录分落两天 → 各天只拿自己的记录（`quotaAttribution.ts:109-112`
      的半开区间同款语义，这里按 `dayStartOf`）。
- [ ] `topProject`：多项目同天 → token 最大者；并列 → label 字典序最小；
      无 token 天 → null。
- [ ] `daySessionsOf` 恒等式（§2.3 三条）+ 排序（tokens 降序、并列按 title 再按
      path）+ `top=5` 折尾「其余 N 个」+ 无元数据行 `path === ""`。
- [ ] 输入顺序无关：打乱 `inputs` 与记录顺序，输出逐字段相等。

### 7.2 令牌守卫（`web/src/styles/tokens.test.ts` 新增，算术真算不是文本匹配）

- [ ] 四块（`:root` / dark / HC 浅 / HC 深）各自声明 `--cal-1..--cal-4`，值必须是
      6 位十六进制 `#rrggbb`（复用既有颜色形状守卫的写法）。
- [ ] 相邻档对比度：普通两块 ≥1.3、HC 两块 ≥1.7；`cal-1` vs 对应块的
      `--bg-inset` ≥1.2（普通）/ ≥1.3（HC）。
- [ ] HC 两块的 `--border` vs `--bg-subtle` ≥3（既有断言顺带覆盖，若已存在则
      不重复）。

### 7.3 组件（`UsageCalendarPanel.test.tsx` 新文件，或并入页面测试）

- [ ] 渲染 365 个 `[data-probe="calendar-day"]`、7 个星期行、12~13 个月份标签、
      图例 5 格（含 0 档）。
- [ ] aria-label 内容与 §5.1 格式逐字一致（三种分支：有消耗 / 定价未知 / 无消耗）。
- [ ] 点击有会话的格子：展开区出现、行数 = min(5, n)、`其余 N 个` 只在 n > 5 时
      存在；行读数含 `$` 与 `tok` 双数；再点同格收起；点空格子无展开。
- [ ] 键盘：聚焦今天格 → `ArrowDown` 焦点 +1 天、`ArrowRight` +7 天、边界不动、
      `Home/End` 行首尾、`Enter` 展开、`Escape` 收起；整个网格恰一个
      `tabindex="0"`。
- [ ] 今天格有 `data-probe="calendar-today"` 且唯一；月标签重复时恰两个含 `/`。
- [ ] 焦点环走令牌：`.dayButton:focus-visible` 规则里是
      `var(--focus-ring-width)` / `var(--focus-ring-offset)`，不是字面量
      （读 CSS 文件断言，`Heatmap.test.tsx:92-98` 的先例）。
- [ ] 视觉纪律：module CSS 里无颜色字面量（`--cal-*` 与语义令牌引用除外，即
      零个）、无 `--sp-*` 之外的间距字面量（12px 格与 3px 缝是「形」，以局部
      变量 `--cal-cell` / `--cal-gap` 定义并注释豁免理由）。

### 7.4 端到端（`web/e2e/usage-calendar.spec.ts` 新文件，Chromium + WebKit）

- [ ] 新场景 `calendarScenario`（加进 `fixtures.ts`）：**内存合成**（照
      `quotaAttributionScenario` 的做法，`fixtures.ts:356-414`），在
      `now−300 / −200 / −100 / −30 / −8 / −1 天` 各造 1~3 个会话、token 阶梯
      拉开四分位；时间戳相对 `Date.now()`，断言不随运行日漂移。
- [ ] 格子计数 365、列 53（`table` 的 `tr` 第一个子行有 54 列含 rowheader——
      断言 `th[scope="col"]` 数 12~13 即可，列数由 7.3 单测钉死）。
- [ ] **档位着色真算**：取夹具已知成本的某天（如 `now−1 天`，最大成本）→
      `data-cal-level="4"` 且 `background-color` 计算值 === `getComputedStyle`
      的 `--cal-4` 解析值；0 记录天 `data-cal-level="0"` 且等于 `--bg-inset`。
- [ ] 点击 `data-probe="calendar-today"` → 展开区出现且头部含「共 N 个」；
      行点击触发 `onOpenSession`（页面级：切到会话分析）。
- [ ] **无文档横向溢出**：日历容器自身 `scrollWidth > clientWidth` 是预期
      （960 视口下），但 `document.documentElement.scrollWidth ≤ clientWidth`
      且 main 同款——滚动收在容器内。
- [ ] 130% 字号（`page.emulateMedia` 不适用，走 `cca-font-scale` localStorage
      种子 `1.3`）下文档仍无横向溢出、标签不裁。
- [ ] HC 档：种 `cca-contrast=high` → `--cal-1` 计算值为 `#c1d1f6`、格子拿得到
      `border` 描边（computed `box-shadow` 非空或 border 宽 ≥1——按实现定稿的
      描边通道断言）；深色 HC 同款抽一格。
- [ ] 顺手回归：`usage-snapshot.spec.ts` 全绿（SCOPE_NOTE 改词后同步该文件的
      契约常量，§8.1）。

### 7.5 真机门禁（`scripts/gui-test.sh` + `src-tauri/src/lib.rs`）

- [ ] `CAPTURE_TARGETS` 在「用量总览 / 视图=用量 / 滚动=main」之后追加
      `点选=[data-probe="calendar-today"]`（展开态截图 + 几何事实落在这一步），
      再补一步 `点选=[data-probe="calendar-today"]`（收起）避免污染后续步骤的
      截图——同「对比度=普通」清理动作的先例逻辑（`gui-test.sh:698` 末尾的
      清理段）。
- [ ] 几何事实（进 `PROBE_JS`，断言在脚本）：`calendar-day` 计数 === 365、
      日历容器 `overflowX === "auto"` 且文档 / main 无横向溢出（既有判定
      自动覆盖，`gui-test.sh:1034-1050`）、展开区高度有界（< 400px）。
- [ ] 截图进归档：用量总览那张图自然带上日历（既有 CAPTURE 目标不变）；
      `docs/screenshots/` 若按面板拆图则新增 `usage-calendar-*.png` × 两主题，
      重出后人工看图（档位分明、月份标签不叠、今天描边可见）。
- [ ] 高对比度下复验一遍（既有 `对比度=高` 步骤之后的目标天然覆盖）：几何
      判定与普通档逐字相同（色带换色不动几何——「只动颜色」在日历上的可验证
      形式：同一格 `getBoundingClientRect` 切档前后 ±0.5px 内）。

---

## 8. 明确不做（各自动机）

1. **快照导出不跟（Issue 明示留待后续棒）**，但有一处**必须顺手改**：
   `usageSnapshot.ts:78-80` 的 `SNAPSHOT_SCOPE_NOTE` 说「本快照包含用量总览的读数
   与图表；不含工具与 skill 普查、压缩统计、错误档」——日历上线后这句会变成
   漏报（读者会以为快照是全量）。本轮把「不含」清单补上「消耗日历」（同步
   `usage-snapshot.spec.ts:27` 的契约常量 `SCOPE_NOTE`，两处只能有一个原文）。
   这是文案诚实性修正，不是「快照支持日历」。真把日历画进快照（SVG 化 /
   打印矩阵）是后续棒的事。
2. **不做成本 / token 口径切换分段控件**。Issue 只锁「默认成本口径」，悬停双数
   已补偿 token 视角；多一个分段控件就多一组「档位跟着口径变不变」的状态要
   解释，v1 砍掉。
3. **不做自绘 tooltip**（§5.1 的三条理由）；**不做虚拟化**（Issue 原文
   「365 格 DOM 直出，无需虚拟化」）；**不做 `forced-colors` 映射**（Round U
   §9-2 已裁决另立 Issue）；**不做月视图 / 周视图缩放**（形状图的价值就在
   12 个月一眼读完，缩放是把仪表盘做回表格）。
4. **不按 `Intl` 动态周起始**（§4.3）；**格子尺寸不做响应式缩放**（§4.2：
   恒定 12px 保形状稳定，窄窗口横向滚）。

---

## 9. 实现者清单

按改动顺序，逐文件：

1. `web/src/features/usage/usageCalendar.ts`（新）：§2 全部类型与函数
   （`buildUsageCalendar` / `levelOfCost` / `daySessionsOf`）+ (day, model) 成本
   分桶 + Type 7 四分位。
2. `web/src/features/usage/usageCalendar.test.ts`（新）：§7.1 全部条目。
3. `web/src/styles/tokens.css`：四块各追加 `--cal-1..4`（§3.2 代码逐字照抄，
   注释带上「为什么不用 --chart-*/opacity」与实算文档指针）。
4. `web/src/styles/tokens.test.ts`：§7.2 守卫。
5. `web/src/features/usage/UsageCalendarPanel.tsx` + `.module.css`（新）：
   `<table>` 网格、roving tabindex、原生 title/aria-label、展开区（复用归因行
   形态）、图例、脚注（窗口固定声明 + 占比分母声明）、`data-probe` 锚点。
6. `web/src/features/usage/UsageOverviewPage.tsx`：board 里「按项目分布」之后
   插 `<div className={styles.compactionRow}><UsageCalendarPanel … /></div>`；
   memo 依赖 `[inputs]`（不吃 `days`）；传 `onOpenSession`。
7. `web/src/features/usage/UsageCalendarPanel.test.tsx`（新）：§7.3。
8. `web/e2e/fixtures.ts`：`calendarScenario`（内存合成，§7.4）。
9. `web/e2e/usage-calendar.spec.ts`（新）：§7.4。
10. `web/src/features/usage/usageSnapshot.ts` + `web/e2e/usage-snapshot.spec.ts`：
    `SNAPSHOT_SCOPE_NOTE` / `SCOPE_NOTE` 的「不含」清单补「消耗日历」（两处
    同步，§8.1）。
11. `scripts/gui-test.sh` + `src-tauri/src/lib.rs`：`点选=[data-probe="calendar-today"]`
    动作（收尾补收起步）、几何事实与断言（§7.5）。
12. 文档：`CHANGELOG.md`（`[Unreleased] → Added`，中文条目）、`README.md` /
    `README.zh-CN.md` 功能条目（双语）、`docs/USAGE.md` 用量页一节补「消耗日历」
    一段（写清「滚动 12 个月，不随区间选择器」「色深 = 估算成本四分位」两条事实）。

**一句话**：这一轮的重量压在三个地方——**数据层必须绕开 `UsageAggregate` 自己
按 (day, model) 分桶折成本**（DayBucket 没有模型维度，偷懒拼不了对的价格）、
**色带是四块新令牌且每个值带实算**（相邻档、空格区分度、HC 描边三条门槛都有
数字，不是「深浅适中」）、**53 列恒等式是全链条的几何锚**（365 天 + 6 pad 恒等，
单测、e2e、真机探针都断死数字）。三件事做齐，「消耗日历」才是一张能当门面的
形状图，而不是一块放大版热力图。
