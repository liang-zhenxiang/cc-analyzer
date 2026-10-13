# 「一日回望」设计规格（Round V · 第二棒）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 日期：2026-10-13 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（Issue #192 + 维护者认领评论已锁定）：把「消耗日历」的行内展开区从
> 「当天消耗 Top 会话清单」升级为**一日回望**——一行**日摘要**（六项）+ 一条
> **24 小时甘特式时间线**（一行一会话）+ 逐会话的**账目读数**。
> **本文件只描述设计与断言，不改任何源码。**

---

## 0. 语境与现状（写前逐字读过）

**读过的文件**：`gh issue view 192` 与 `--comments`（维护者评论是契约权威）、
`.trellis/workspace/liangyuxiang/design-round-v1-usage-calendar.md`（V1 规格，
本文件沿用它的格式与颗粒度）、`web/src/features/usage/usageCalendar.ts`
（`buildUsageCalendar` / `levelOfCost` / `daySessionsOf` 与两个私有助手）、
`web/src/features/usage/UsageCalendarPanel.tsx` 与 `.module.css`（展开区现状与
全部锚点）、`web/src/features/usage/UsageOverviewPage.tsx` 与 `.module.css`
（KPI 行、Panel、provenance 语言、模型图例的 `.swatch`）、
`web/src/features/usage/ProvenanceBadge.tsx` 与 `provenance.ts`、
`web/src/styles/tokens.css`（四块主题的 `--chart-*` / `--cat-*` / `--cal-*` /
焦点环几何）、`web/src/features/usage/charts/Heatmap.tsx` 与 `.module.css`（格子 +
色阶图例的既有密度表达）、`web/src/features/usage/ToolCensusPanel.tsx` 与
`.module.css`（同页「紧凑行 + 比例条 + 下钻」范式）、
`web/src/features/sessions/TimelineTrack.tsx` 与 `.module.css`（时间锚点轨道的既有
做法）、`web/src/lib/format.ts`（`formatClock` / `formatDuration` / `formatUsd` /
`formatTokenCount` / `formatModelId` / `formatProjectPath`）、
`web/src/features/usage/usageAggregations.ts`（`UsageSessionInput`、`dayStartOf`、
`addLocalDays`、`totalsSum`、`aggregateRange`）、
`web/src/features/sessions/metadataCache.ts`（`sessionTitle`）、
`web/src/features/sessions/types.ts`（`SessionRecord.timestamp`）、
`scripts/gui-test.sh`（门禁动作清单、`CALENDAR_*` 常量、日历判定段）、
`src-tauri/src/lib.rs`（`PROBE_JS` 的 `calendarFacts`）、
`web/e2e/fixtures.ts`（`calendarScenario` / `quotaAttributionScenario` 的合成
做法）、`web/e2e/usage-calendar.spec.ts`、`web/e2e/screenshots.spec.ts`、
`scripts/check-screenshots.sh`、`web/playwright.config.ts`。

**逐条核对过的既有事实**（后文反复引用，都是实测/读码而不是印象）：

1. **展开区今天的形态**（`UsageCalendarPanel.tsx`）：`<section
   data-calendar-sessions aria-label="{M}月{D}日会话清单">`，内含
   `.sessionsHead`（`{M}月{D}日消耗 Top 会话 · 共 {n} 个` + `× 清除`）、
   `<ol aria-label="{M}月{D}日消耗最多的会话">`、若干
   `CalendarSessionListRow`、折尾行 `其余 {n} 个会话`、`SESSIONS_FOOTNOTE`。
   `.sessions` 的容器是「卡里的仪器块」语言：`padding: var(--sp-2) var(--sp-3)`、
   `border: 1px solid var(--border)`、`--r-md`、底色 `--bg-inset`、
   `display: grid; gap: var(--sp-1)`。
2. **会话行的基线网格**（`.module.css`）：`grid-template-columns: minmax(0, 1fr)
   auto 56px 56px`、行高 `calc(var(--row-pad-y-tight) * 2 + var(--lh-xs))`（100% 字号
   = **24px**）、`gap: var(--sp-2)`、`padding: 0 var(--sp-1)`、`--fs-xs` / `--lh-xs`。
   折尾行用 `box-shadow: inset 0 1px 0 var(--border)` 画分隔线（不占布局高度）。
3. **`daySessionsOf` 已经给全了账**（`usageCalendar.ts`）：每行有 `path` /
   `title`（`sessionTitle`，无元数据回退 `projectLabel`）/ `projectLabel` /
   `projectPath` / `tokens` / `costUsd` / `hasUnknownCost` / `share`，返回值还有
   `sessions`（当天有记录的会话数）与 `dayTokens`（占比分母 = 当天全部会话
   token 之和）。排序：tokens 降序 → 标题 → 路径。
4. **两个私有助手**：`countsAsMessage(record)` = `(kind === "user" ||
   kind === "assistant") && compactSummary !== true`；`sessionKeyOf(source, index)`
   = `session ? \`path:${session.path}\` : \`anonymous:${index}\``。
   **这两个口径是 V2 必须复用的**（见 §3.2）。
5. **`addLocalDays` 走日历分量**（`usageAggregations.ts:118-122`），因此
   **本地日长不恒等于 86 400 000 ms**（DST 切换日 23 或 25 小时）。V2 的 24h 轴
   必须用「本地日长」当分母，否则切换日会把最后一小时画到轴外。
6. **`formatClock(ms)` 给 `HH:mm`**，`formatDuration` 给 `1m30s` / `9h5m3s` 一族，
   `formatUsd` 给 `$1.80`，`formatTokenCount` 给 `600,000` / `1.2M`，
   `formatModelId("claude-sonnet-4-5-…")` 给 `Sonnet 4.5`（原始 id 是 tooltip 的落点），
   `formatProjectPath(label, path)` 优先打印 `cwd` 的末段。
7. **`ProvenanceBadge` 是一枚圆点**，`aria-label` = `数据来源：{档位}{，detail}`，
   四档 `logged / estimated / snapshot / inferred`。它已从色块降级成圆点——
   同屏五六个「读自日志」不再抢注意力。
8. **类别色与图表色是两套资产**：`--cat-*` 六色**只有实色、没有 `-soft`**，
   且被「记录类别」语义占满（TreeView / TimelineTrack 消费）；`--chart-1..6`
   有实色 + `-soft` 两套，文档写明「语义无关、只论顺序」。**同页
   `UsageOverviewPage` 的「按模型分布」图例正是用 `--chart-${index % 6 + 1}`
   上色的**。Round U 的两块高对比度色板**都覆盖了 `--chart-1..6` 与 `-soft`**
   （HC 下的 `-soft` 是**不透明实色**）。
9. **`--cal-*` 是 V1 新造的 12 个令牌**（顺序色阶，0 档用 `--bg-inset`），HC 两块
   另有取值并给格子加 1px 描边；日历格子 12×12px 实色填充。
10. **既有密度表达**：`Heatmap` 的 7×24 格用 `--chart-1` + `fillOpacity` 台阶
    `[0.3, 0.5, 0.68, 0.84]`，图例「少 … 多」是组件的一部分（色块 10×10 + `--r-xs`）；
    `TimelineTrack` 用**固定 64px 的 `linear-gradient` 底纹**做时间网格、用 40px 高的
    实色 `--cat-*` 块锚在记录起始时刻（`min-width: 2px`、`max-width: 15%`）。
11. **同页「紧凑行 + 比例条」的既有范式**：`ToolCensusPanel` 的行 = 标签 + 轨道 +
    读数 + 副读数，折尾行走中性台阶、头部「× 清除」、下钻区是 `<ul>` + 逐行
    `<button>`。
12. **展开区的既有门禁判据**：`点选=[data-probe='calendar-today'] button` 两次同名
    点选按计数分流——第 1 次判「展开区在场、`li` 行数 ≥ 1、`rect.height <
    CALENDAR_SESSIONS_MAX_HEIGHT`（**400**）」，第 2 次判「展开区离场」。
    探针事实来自 `lib.rs` 的 `calendarFacts = { view, dayCount, todayCount,
    container, sessions: { rect, rows } }`。
13. **门禁的今天夹具只有 1 个会话**：`calendar-today-0001`（user + assistant，
    两条 `date -u` 同一秒的时间戳 → **零跨度**），`usage: input_tokens: 600000`，
    `cwd = /repo/calendar`。
14. **`calendarScenario` 的档位分布是刻意的**：非零成本 7 天 → Type 7 四分位
    `q1=$1.5 / q2=$3 / q3=$4.5`，昨天 $12 是窗内最大（4 档）、今天 $3（3 档）、
    `now−100` $1.8（2 档）；V1 的 e2e 断死「昨天 = 4 档」「15 天前 = 0 档」。
15. **截图套是两份独立清单**：`screenshots.spec.ts` 生成、
    `scripts/check-screenshots.sh` 的 `EXPECTED_VIEWS` 独立列一遍，两处不同步
    `lint.sh` 就报「截图套缺视图」。截图视口 1440×900，`main` 视口高 = 900 − 48。
16. **窗口 minWidth = 960、侧栏 300px、页面左右 padding 24px** → 最窄时 `main` ≈
    612px，面板内 ≈ 588px，展开区内 ≈ 564px。
17. **`aggregateRange` 只做下界过滤**（`record.timestamp >= startTs`），没有上界——
    今天晚些时候的时间戳不会被丢掉（夹具可以安全地用「今天 18:40」）。

**与在途实现的对接（已对齐，不是「无」）**：工作区里 `src-tauri/src/lib.rs`
**已有一处未提交的在途改动**（门禁探针，非本设计师所写）——它在
`calendarFacts` 上加了一个 `dayReview` 字段（`summary: { rect, text }` /
`timeline: { rect, bars, declaredSessions }` / `bars: [{ rect, sessionPath, label }]`），
并已读取 `[data-probe="day-summary"]`、`[data-probe="day-timeline"]`、
`[data-probe="day-timeline-bar"]`、`data-session-path` 与**时间线容器上的
`data-session-count`**（组件声明的会话数，供门禁与实测条数对账）。
本规格的 §1.3 / §8 / §10.4 **逐条对齐这套既成命名**：字段名用
`calendarFacts.dayReview`（**不要**另造 `calendarFacts.day`），
`data-session-count` 是必挂锚点。前端则确实从零开始——工作区没有 `dayReview.ts`、
没有时间线组件、tokens 里没有 `--day-*`。

---

## 0.1 与契约的对齐：四处改了字面，两处必须让实现者知道

| # | 契约原文 | 本规格的定稿 | 理由 |
| --- | --- | --- | --- |
| 1 | 摘要第 4 项「活跃小时跨度（首条→末条）」 | 标签写 **`活跃跨度`**，值写 `00:25–18:40` | 「小时跨度」正是歧义源（会被读成「有活动的小时数」）；去掉「小时」二字 + 脚注逐字解释（§4.3） |
| 2 | 「条色 = 项目（复用**类别色体系**）」 | 用 **`--chart-1..6`**（图表分类色板），不用 `--cat-*` | `--cat-*` 只有实色、无 `-soft`、且被「记录类别」占满（§0-事实 8）；`--chart-*` 文档写明「语义无关、只论顺序」，同页模型图例已有先例，四块主题全部覆盖 → **零新令牌** |
| 3 | 「保留 Top 会话清单…（**或融合**）」 | **融合**（裁决 B）：一行一会话，时间线行本身就是账目明细 | 见 §2.2；并置会让同一批会话在展开区出现两次、两套顺序，且最坏高度涨到 ~466px（越过既有的 400px 门禁常量） |
| 4 | 「时间线上下…」 | 时间线**在**摘要行之下、脚注之上；**没有第二条总览轨** | 融合后每行的轨道共用同一条 0–24 轴，纵向扫一眼就是形状（§2.2） |

**必须让实现者知道的两处连带**（夹具/断言层面，不是设计改动）：

- **夹具扩展会连带改 V1 e2e 两条**：给今天加一个凌晨跨午夜会话后，
  `usage-calendar.spec.ts` 里 `共 3 个` → `共 4 个`、按钮计数 3 → 4；而
  `rows.first()` 的含义从「600K 那行」变成「**起点最早**的那行」（凌晨会话）。
  这是「时间线按时间排序」的必然结果，不是回归。
- **`CALENDAR_SESSIONS_MAX_HEIGHT = 400` 不改**：本规格把展开区最坏高度算到
  ~362px（§1.4），门禁常量、两个点选步骤与既有锚点**一个字都不动**。

---

## 1. 实现约束

### 1.1 只扩展展开区，不碰 V1 已锁定的一切

- V2 只动 `[data-calendar-sessions]` 里的内容与 `.sessions*` 相关 CSS。
  365 天网格（`data-usage-calendar`、53 列恒等式、371 个 `td`）、今天格
  `data-probe="calendar-today"`（挂在 `td` 上）、365 个 `data-probe="calendar-day"`、
  图例 `[data-cal-legend]`、面板 `FOOTNOTE`、roving tabindex 与全部键盘映射、
  `aria-expanded` 语义、`onOpenSession` 握手——**一律不动**。
- 数据口径复用：**「一天」= `dayStartOf`；token 口径 = 四类和（`totalsSum`）；
  会话身份 = `sessionKeyOf`；记录口径 = `countsAsMessage`。**
- **V2 的新纯函数不许重算「当天有哪些会话」与「当天消耗多少」**——这两个数
  一律来自 `daySessionsOf`（§3.2 有可断言的守卫）。

### 1.2 数据层：新模块 `web/src/features/usage/dayReview.ts`

- 只 import `daySessionsOf`、`countsAsMessage`、`sessionKeyOf`（后两者需从
  `usageCalendar.ts` **导出**，只加 `export` 关键字，函数体与文档一字不改）、
  `dayStartOf` / `addLocalDays` / `UNKNOWN_MODEL_LABEL`、`sessionTitle`、
  `totalsSum`。**不得 import `estimateCost`**（成本只在 `daySessionsOf` 里折一次）。
- 纯函数、无时钟（`dayStart` 由调用方注入）、输入顺序无关。

### 1.3 DOM 结构（照抄；缩进表示包含关系）

```html
<section data-calendar-sessions aria-label="{M}月{D}日会话清单">   <!-- V1 锚点，不动 -->
  <div class="sessionsHead">
    <span class="sessionsTitle">{M}月{D}日 · {N} 个会话</span>
    <button class="clear">× 清除</button>
  </div>

  <div class="daySummary" data-probe="day-summary">                 <!-- 新增：日摘要 -->
    <div class="summaryItem" data-probe="day-summary-item" data-summary-key="cost">…</div>
    … sessions / messages / span / model / projects（共 6 项，键写死）
  </div>

  <!-- 新增：24h 时间线；data-session-count = 组件声明的当天会话数（门禁与实测对账） -->
  <div class="dayTimeline" data-probe="day-timeline" data-session-count="{N}">
    <div class="dayAxis" aria-hidden="true">
      <span data-probe="day-timeline-tick">00:00</span> … 共 9 个（0/3/…/21 与 24:00）
    </div>
    <ol class="dayRows" data-probe="day-timeline-list" aria-label="{M}月{D}日会话时间线">
      <li>
        <button class="dayRow" data-probe="day-timeline-bar"
                data-session-path="{path}" [data-cross-day="true"]>
          <span class="rowLabel">
            <span class="projectDot" data-probe="day-project-dot" data-project-index="2" aria-hidden="true"></span>
            <span class="rowTitle">{标题}</span>
            [<span class="crossDay" title="该会话在当天之外还有记录，这里只画落在当天的那一段">跨天</span>]
          </span>
          <span class="track" aria-hidden="true">
            <span class="rail" style="left: …%; width: …%"></span>
            <span class="block" data-probe="day-timeline-density" data-density-level="2"
                  style="left: …%; width: …%" title="09:00–10:00 · 4 条记录"></span>
            …
          </span>
          <span class="rowTime">{起}–{止}</span>
          <span class="rowRead">${formatUsd} · {tok} tok · {占比}</span>
        </button>
      </li>
      …
    </ol>
  </div>

  <ul class="projectKey" data-probe="day-project-key">               <!-- ≥2 项目才渲染 -->
    <li><span class="projectDot" data-project-index="1" aria-hidden="true"></span>cc-analyzer</li>
    …
  </ul>

  <p class="sessionsFootnote">…</p>                                  <!-- §4.3 脚注（换文） -->
</section>
```

**行外层必须有 `<li>`**：门禁 `calendar.sessions.rows` 数的是
`[data-calendar-sessions]` 里的 `li`，而「时间线条数 === 当天会话数」这条恒等
要靠它出证（`<ol>` 的 `aria-label` 是 `{M}月{D}日会话时间线`）。

### 1.4 高度预算（写实数）

100% 字号、1440 视口（展开区内宽 ≈ 1020px）：

| 块 | 高度 |
| --- | --- |
| `.sessions` 上下 padding（`--sp-2` × 2） | 16 |
| `sessionsHead`（`--control-h-sm` = 24） | 24 |
| 4 条网格 gap（`.sessions` 的 `--sp-1` × 4） | 16 |
| 日摘要（`--lh-xs` 16 + `--lh-md` 22） | 38 |
| 时间线（轴 16 + gap 4 + 行区 ≤144） | ≤164 |
| 项目色键 | 16 |
| 脚注（1 行） | 16 |
| **合计** | **≤290** |

最坏情形（960 窗口 + 130% 字号：摘要折成 2 行、脚注折成 2 行、轴行 20.8px）：
`16 + 24 + 16 + 84 + 169 + 21 + 21 ≈ 362px` **< 400（门禁常量不动）**。
约束因此是三条：**① 时间线行区 `max-height: 144px`；② 摘要行用 `auto-fit`
自动折行而不是横向滚动；③ 不需要滚动的块不得设成 `position: absolute`。**

---

## 2. 两处裁决

### 2.1 裁决 A：条内活动密度 = 「基线 + 活动块」，块**高**编码密度

**定稿**：一条会话行里同时画两个东西——

- **基线（rail）**：1px 高的实色 `--chart-N` 横线，贴在轨道下缘，宽 = 该会话
  当天段 [start, end]。它回答「这一段是同一个会话」。
- **活动块（block）**：每个**有记录的整点小时**画一块实色 `--chart-N` 的矩块，
  **底边贴在基线上**、**高按该小时的记录数分 3 档**（4 / 8 / 12px）。
  **没有记录的整点小时不画块**——基线上留出空缺，那就是「间歇」。

**为什么不是「分小时深浅」**：深浅只能靠 `opacity`。Round U 已经证明
`[0.3, 0.5, 0.68, 0.84]` 这组在 HC 下必须重新取值，而时间线的色是
「项目色 × 密度」的乘积——要给 6 色 × 4 档 × 4 主题配 96 个值，且 HC 下
半透明叠纯黑的结果不可控。**块高没有这个问题**：它是几何，不是颜色，
四块主题下同一个 CSS 值成立。

**为什么不是「刻痕」**：一根 1px 竖刻痕在高密度小时里连成一片，反而看不出
「小时」的分段；而块宽天然等于该小时与会话段的交集，段与段之间自带空隙感。

**为什么不给整段铺底色**（`-soft` 大面积填充）：实测 `--chart-N` 实色对
`--chart-N-soft` 合成色的对比度在**普通浅色下最低只有 2.68**（chart-4），
低于图形件的 3:1 门槛——密度块会「糊」在底色里。改成「无底色 + 块/线都是实色」
之后，**四块主题下实色对轨道底（`--bg-inset`）的最小对比度是 3.49**
（§7.2），全部达标，**一条豁免都不用写**。

### 2.2 裁决 B：**融合**——一行一会话，时间线行本身就是账目明细

**定稿**：展开区里**只有一份逐会话内容**，每行 = `[项目色点 + 标题] [24h 轨道]
[起止] [成本 · token · 占比]`，行按**当天起点升序**排列；**没有第二条独立的
「Top 会话清单」**。

**理由**（三条，按权重）：

1. **不重复**：并置会让同一批会话在同一个展开区里出现两次，而且是两套顺序
   （清单按消耗降序、时间线按起点）——读者要在两处建立「哪根条对应哪一行」的
   映射，这是纯粹自找的认知成本。
2. **高度**：并置最坏 ≈ 466px（时间线 ≤168 + 清单 ≤200 + 摘要 + 头部 + 脚注），
   越过门禁既有的 400px 常量；融合后最坏 ≈ 362px，**门禁常量与两个点选步骤
   一个字都不用改**。
3. **形状与数字在同一行**：甘特图的常规读法就是「左侧标签列 + 右侧时间轨道」，
   数字放在同一行的右端；纵向扫一眼轨道就是「那天我都在干嘛」的形状，
   横向读一行就是这一段的账。所谓「时间线管形状、清单管数字」在融合后由
   **同一行的左中右三段**承担，不需要两块 UI。

**被这条裁决取代的 V1 元素**（如实记账）：

- 「Top 会话」的**成本降序**不再出现——行按时间排。代价是「谁最贵」不再一眼
  排序；补偿是**每行都带成本与占比数字**，且日摘要行给出当日消耗双数。排名的
  需求由**计费窗口卡的归因面板**（窗口口径的 Top 会话）承担，日历这一屏回答的是
  「怎么用」。
- **占比条（56px 轨道）**退场：一行里出现**两根条**（时间轨道 + 占比轨道）会让
  「哪根条是什么」变成需要解释的东西。**占比数字保留**在行读数里。
- 「其余 N 个会话」折尾行退场：时间线**列出当天全部会话**（门禁的不变量
  「条数 = 当天会话数」要求如此），没有折尾，也没有虚拟化（§11）。

---

## 3. 数据层：`dayReview.ts`

### 3.1 类型与签名（TypeScript，实现照抄）

```ts
import type { UsageSessionInput } from "./usageAggregations";

/** 一条会话的「当天段」。start/end 都落在同一天内（跨午夜按记录时间切）。 */
export type DaySessionSpan = {
  /** SessionMeta.path；无元数据为空串（照 daySessionsOf，行照列但不可点）。 */
  path: string;
  title: string;
  projectLabel: string;
  projectPath?: string;
  /** 当天首条 / 末条「计数记录」的时刻（ms，epoch）。 */
  start: number;
  end: number;
  /** end − start；零跨度（单条记录）时为 0。 */
  durationMs: number;
  /** 该会话在**当天之外**还有计数记录 —— 这一行是被切开的那一段。 */
  crossDay: boolean;
  /** 24 桶：该 clock hour 内的计数记录条数（本地时区，索引 0–23）。 */
  hourly: number[];
  /** 当天该会话的计数记录条数（= Σ hourly）。 */
  messages: number;
  /** 以下五项逐字来自 daySessionsOf 的行，不许重算。 */
  tokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
  share: number;
};

/** 当天摘要。tokens / costUsd / sessions 与 daySessionsOf 同一份账。 */
export type DaySummary = {
  dayStart: number;
  tokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
  sessions: number;
  messages: number;
  /** 首条 / 末条计数记录的时刻；当天无会话时为 null（防御态）。 */
  firstAt: number | null;
  lastAt: number | null;
  /** 活跃跨度 = lastAt − firstAt（ms）。 */
  spanMs: number;
  /** 最常用模型：token 降序，并列按 id 字典序；当天无 token 时为 null。 */
  topModel: { id: string; tokens: number } | null;
  /** 涉及项目数（按 projectLabel 去重）。 */
  projects: number;
};

/** 项目色档：1..5 = 前五名，6 = 「其他」。 */
export type DayProjectEntry = {
  label: string;
  path?: string;
  tokens: number;
  /** 1..6；6 同时表示折尾组。 */
  color: number;
  /** 折尾组：合并了几个项目（非折尾为 0）。 */
  folded: number;
};

export type DayReview = {
  summary: DaySummary;
  /** 起点升序（并列按终点、标题、路径）。 */
  rows: DaySessionSpan[];
  /** 色键（≥2 个项目时才非空；单项目日为空数组）。 */
  key: DayProjectEntry[];
  /** path → 色档；便于行渲染直接取。 */
  colorOf: Map<string, number>;
};

export const DAY_DENSITY_LEVELS = [4, 8, 12] as const; // px，三档块高
export const DAY_PROJECT_COLOR_CAP = 5;                // 前五名占 1..5，其余并入 6

export function densityLevelOf(count: number): 0 | 1 | 2 | 3;
export function clockAt(dayStart: number, hour: number): number;
export function dayFractionOf(ts: number, dayStart: number, dayEnd: number): number;
export function dayReviewOf(
  inputs: readonly UsageSessionInput[],
  dayStart: number
): DayReview;
```

### 3.2 三条口径 + 「不重算」的两道守卫

**① 时间区间**：起点 = 该会话**当天首条**计数记录的 `timestamp`，终点 =
**当天末条**；跨午夜按记录时间切——只算落在当天的那一段（与归因面板「窗口把
会话切开」同一条口径，也和 `daySessionsOf` 的 `dayStartOf(record.timestamp)
=== dayStart` 逐字同源）。

**② 逐小时分桶**：按**本地时区**的 clock hour 分 24 桶（0–23），桶值 = 该小时内
的**计数记录条数**（与 V1 日聚合的消息口径一致）。`Σ hourly === messages`。

**③ 日摘要**：当日消耗（成本 + token 双数）、会话数、消息数、活跃跨度
（首条→末条）、最常用模型、涉及项目数。成本走 `daySessionsOf` 的行读数之和；
模型与项目口径与该页一致（模型 = 记录自带 `model`，缺失按 `UNKNOWN_MODEL_LABEL`）。

**两道守卫（可断言，不是口号）**：

1. **结构守卫**：`dayReview.ts` 的源码里**必须出现** `daySessionsOf(`，
   **不得出现** `estimateCost`（读文件字符串断言，同 `usageSnapshot.test.ts`
   的 import 面守卫）。
2. **行为守卫**（恒等式，全部在单测里钉死）。设
   `base = daySessionsOf(inputs, dayStart, { top: Number.POSITIVE_INFINITY })`，
   则必然成立：

   ```
   review.rows.length  === base.sessions              （当天会话集合同一份）
   Σ rows.tokens       === base.dayTokens             （当天 token 同一份）
   Σ rows.tokens       === review.summary.tokens
   Σ rows.costUsd      ≈ review.summary.costUsd       （1e-9）
   Σ rows.share        === 1                          （1e-9；dayTokens = 0 时全 0 另测）
   Σ rows.messages     === review.summary.messages
   逐桶求和 Σ rows[i].hourly[b] === 当天该小时的总记录数
   ```

   变异方向：把 `daySessionsOf` 调用换成自己写的一趟记录扫描（哪怕结果看似
   相同）就会破坏第 1 或第 2 条——`base.sessions` 与自算口径在「无 usage 的会话
   / 匿名输入 / 同 path 出现两份输入」上必然分叉。实现者交付前自己跑一次。

**空态（防御）**：`dayStart` 当天没有任何计数记录时（正常路径不可达——色即消耗，
0 档格子不可展开），返回 `rows: []`、`summary.firstAt / lastAt === null`、
`spanMs === 0`、`topModel === null`、`key: []`，**不造任何假行**。

### 3.3 跨天判定

`crossDay = 该会话的计数记录里存在 dayStartOf(record) !== 当天` 的记录。判定按
**会话身份键**聚合（`sessionKeyOf` 同款），所以「昨天 23:40 起、今天 00:25 有
第二条」的会话在两天的行里都 `crossDay === true`。

### 3.4 项目色分配

```
distinct = rows 里出现过的 projectLabel 集合
distinct.length === 1  → 全部行色档 1，key = []          （单项目日不渲染色键）
distinct.length >= 2   → 按当天 token 降序（并列按 label localeCompare）排；
                         前 5 名依次 1..5；
                         其后全部并入色档 6，key 里合成一行「其他 N 个项目」
key 的顺序 = 色档升序（1..6）
```

- **色档恒定**：同一项目在同一天内的所有行、色点、色键同一档。
- **token 相等**：按 label 字典序（与 `daySessionsOf` 的并列规则同款）。
- **项目展示名**：`formatProjectPath(label, path) || "未知项目"`（`projectLabel`
  为空串是扫描层不该出现但必须不崩的情况）。
- 色档 → 令牌的映射**写死在组件里**：`1..6 → var(--chart-1) … var(--chart-6)`
  （与 `StackedBar` / 模型图例同一条既有纪律：module class 无法按索引计算，
  内联令牌引用是唯一例外）。

### 3.5 几何映射（DST 安全）

```ts
/** 当天 h 点的 epoch：走日历分量，不写 dayStart + h * 3_600_000（DST）。 */
export function clockAt(dayStart: number, hour: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour).getTime();
}

/** ts 落在 [dayStart, dayEnd) 的比例（0..1）。分母是**本地日长**，不是 86400000。 */
export function dayFractionOf(ts: number, dayStart: number, dayEnd: number): number {
  return (ts - dayStart) / (dayEnd - dayStart);
}
```

- `dayEnd = addLocalDays(dayStart, 1)`，**分母就是 `dayEnd - dayStart`**。
  DST 切换日 23 / 25 小时时坐标仍落在 `[0, 1]`。
- 轴刻度位置同样走 `dayFractionOf(clockAt(dayStart, h), dayStart, dayEnd)`，
  h = 0/3/6/9/12/15/18/21，外加 `dayEnd` 处的第 9 个标签（**写死文本 `24:00`**）。
- 会话段：`left = dayFractionOf(row.start, …)`、
  `width = dayFractionOf(row.end, …) − left`（`end` 落在当天末尾时宽度恰好补到 1）。
- 逐小时块：块 = 该 clock hour 与 [start, end] 的交集。**DST 重复小时（一年一次）
  两段合并成一块**——这是「按 clock hour 分 24 桶」这条契约口径的直接结果，
  写成已知简化 + 单测（分桶合并、总数守恒）。

**守卫**：`dayReview.ts` 源码里**不得出现** `86400000` / `86_400_000`（读源码断言）。

---

## 4. 日摘要行

### 4.1 排布与字号层级

- 容器：`data-probe="day-summary"`，`display: grid`，
  `grid-template-columns: repeat(auto-fit, minmax(132px, 1fr))`，
  `gap: var(--sp-2) var(--sp-3)`。**不套第二层卡片**（它是展开区内的一条读数带，
  不是卡中卡）。
- 每项（`.summaryItem`）两行——第 1 行是 `label`（`--fs-xs` / `--lh-xs` /
  `--text-tertiary`）加右端的 `ProvenanceBadge` 圆点；第 2 行是 `value`
  （`--fs-md` / `--lh-md` / `--text`）。
- 数值一律 `font-variant-numeric: tabular-nums`；时刻用 `--font-mono`。
- 摘要行的项数恒为 **6**（门禁断言 `items === 6`），键写死：
  `cost / sessions / messages / span / model / projects`。

### 4.2 六项（值 / 徽章 / `title`）

下表逐字给全；`title` 是悬停原文，值里的 `{PRICING_AS_OF}` 与面板脚注同一常量。

| 键 | 标签 | 值 | 徽章 | `title` |
| --- | --- | --- | --- | --- |
| cost | `当日消耗` | `$12.15` + ` · ` + `1.3M tok`（后段 `--fs-xs` / `--text-tertiary`，同行 baseline 对齐） | **estimated**（detail：`成本按定价快照 {PRICING_AS_OF}`） | `当日估算成本 $12.15（定价快照 {PRICING_AS_OF}）；token 合计 1.3M，读自本机日志` |
| sessions | `会话数` | `4`（`toLocaleString("en-US")`） | logged | `当天有记录的会话数` |
| messages | `消息数` | `137` | logged | `当天 user / assistant 记录的条数（不含压缩摘要）` |
| span | `活跃跨度` | `00:25–18:40`（mono） | logged | `活跃跨度：当天首条记录 00:25，末条 18:40，跨度 18 小时 15 分（不是有活动的小时数）` |
| model | `最常用模型` | `Sonnet 4.5`（`formatModelId`） | logged | `{原始 id} · {formatTokenCount(tokens)} tok`（当天无 token 时值为 `—`，`title` 为 `当天没有可归因的模型用量`） |
| projects | `涉及项目` | `3` | logged | `当天涉及的项目数（按项目标签去重）` |

- **一格最多一枚徽章**；双数格（cost）取两侧里**较弱的那一侧**（成本是估算，
  token 是读数）→ `estimated`。token 的 `logged` 由 §4.3 脚注兜住。
- `span` 的值只给**时刻对**，跨度（时长）进 `title`——值那一行放不下三样东西，
  而时刻对是最无歧义的那一样（这条也是「活跃跨度」不被读成「小时数」的关键）。

### 4.3 口径脚注（逐字，替换 V1 的 `SESSIONS_FOOTNOTE`）

```
活跃跨度 = 当天首条至末条记录的时刻，不是有活动的小时数；占比分母 = 当日 token 总量。成本为估算值（定价快照 {PRICING_AS_OF}），token、会话数、消息数读自本机日志；项目色按当日 token 降序取前 5 名，其余项目并入「其他」。
```

- `{PRICING_AS_OF}` 由组件已有的 import 插值（与面板脚注、KPI 脚注同一常量，
  不许出现第二个快照日期来源）。
- 面板级 `FOOTNOTE`（窗口固定滚动 12 个月 + 色深口径）**一字不改**。

---

## 5. 24 小时时间线

### 5.1 常量（照抄；「形」不随 `--font-scale` 缩放）

| 常量 | 值 | 归属 |
| --- | --- | --- |
| 轴行高 | `var(--lh-xs)`（16px @100%） | 文本行 → 跟随字号 |
| 行高 | `calc(var(--row-pad-y-tight) * 2 + var(--lh-xs))`（24px @100%） | 与 V1 会话行同一公式 |
| 轨道高 | `14px` | 形 |
| 基线高 | `1px` | 形 |
| 密度块三档高 | `4px / 8px / 12px` | 形（`DAY_DENSITY_LEVELS`） |
| 条最小宽 | `3px` | 形（零跨度会话） |
| 块最小宽 | `2px` | 形 |
| 行区最大高 | `144px`（6 行 × 24px @100%） | `overflow-y: auto` |
| 内容最小宽 | `800px` | 横向滚动阈值 |
| 标签列 | `200px` | 固定 |
| 轨道列 | `minmax(240px, 1fr)` | 弹性 |
| 起止列 | `104px` | 固定 |
| 读数列 | `216px` | 固定 |

`200 + 240 + 104 + 216 + 3 × 8 = 784` → 内容 `min-width: 800px`。1440 视口下轨道
实际约 476px（≈ 20px/小时）；960 窗口下整行横向滚动（**滚动收在容器内**，
文档与 `main` 不溢出——既有几何判定不变）。

### 5.2 轴

- **9 个刻度**：`00:00`、`03:00`、`06:00`、`09:00`、`12:00`、`15:00`、`18:00`、
  `21:00`、`24:00`。格式 = `HH:mm`（与 `formatClock` 同一语言），`--font-mono`
  + `--fs-xs` + `--text-tertiary` + `tabular-nums`。
- **末刻度写 `24:00` 而不是 `00:00`**：它是「一天的终点」；写 `00:00` 会让右边缘
  看起来像新一天的开始。
- 位置：`left: calc(dayFractionOf(tick) * 100%)`；首尾两个贴边对齐（`00:00` 左对齐、
  `24:00` 右对齐，中间 7 个 `translateX(-50%)`），任何视口都不越界。
- 轴行 `aria-hidden="true"`（刻度是视觉参考；每个条的可访问名里已经带起止时刻）。
- 每个刻度的 x 位置画一根 **1px `var(--border)` 竖线**，贯穿整个行区：
  `.dayRows { background-image: linear-gradient(to right, var(--border) 0 1px,
  transparent 1px); background-size: calc(100% / 8) 100%; }`——与 `TimelineTrack`
  的固定 64px 底纹同一手法，但按 3 小时分段，且**只在轨道列**（标签列没有竖线）。
- **不做「现在」游标**（§11）。

### 5.3 行网格与分隔

```css
.dayRow {
  display: grid;
  grid-template-columns: 200px minmax(240px, 1fr) 104px 216px;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--row-pad-y-tight) * 2 + var(--lh-xs));
  padding: 0 var(--sp-1);
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-align: left;
  cursor: pointer;
}
.dayRow:hover:not(:disabled) { background: var(--bg-active); }   /* 同 V1 会话行：浅色下 --bg-hover 与底同色 */
.dayRow:hover:not(:disabled) .rowTitle { color: var(--text); }
.dayRow + .dayRow > * { }                                        /* 见下：行间线画在 li 上 */
.dayRows li + li { box-shadow: inset 0 1px 0 var(--border); }     /* 行间发丝线，不占高度 */
.dayRow:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-inset);                        /* 整行按钮用负偏移（tokens.css 的既定分工） */
}
.dayRow:disabled { cursor: default; }
```

- **行内分隔**：四列之间 `gap: var(--sp-2)`。
- **行间分隔**：1px `--border` 发丝线（内阴影，不占布局高度）；首行没有线。
- 焦点环用 `--focus-ring-inset`（普通 -2px / HC -4px）而不是正偏移：行是全宽控件，
  正偏移的环会被行区的 `overflow` 裁掉。
- 三个固定列写成**组件局部的 CSS 变量**（`--day-label-col` 等）并注明「这是列预算，
  属视图级契约」——与 `--col-*` 的既有注释同款理由。

### 5.4 排序（写死）

```
start 升序 → end 升序 → title.localeCompare → path.localeCompare
```

时间线的定义就是时间序；并列（同一秒起的两条会话）用终点、标题、路径兜底，
保证**任何输入顺序下渲染结果逐字段相同**。

### 5.5 条：基线 + 最小可视宽

```css
.rail {
  position: absolute;
  bottom: 0;
  height: 1px;
  min-width: 3px;
  background: var(--chart-1);        /* 真实色档由内联 var(--chart-N) 给 */
}
.block {
  position: absolute;
  bottom: 1px;
  min-width: 2px;
  height: 4px;                       /* 档 1；档 2 / 3 = 8px / 12px */
  border-radius: var(--r-xs) var(--r-xs) 0 0;
  background: var(--chart-1);
}
```

- **极短会话（零跨度）**：`start === end` → 基线宽 0 → `min-width: 3px` 兜底成一个
  3px 的刻痕；块最小宽 2px 同理。两者都是「形」，不随 `--font-scale` 变
  （同日历 12px 格子的既定红线）。
- **跨午夜**：只画当天那一段；视觉信号 = 基线顶到轴的左/右边缘（该端没有留白、
  直接顶到 00:00 / 24:00 的刻度线）+ §5.6 的文字标记。
- 端点不加箭头、不加圆点：一条 1px 线加两端截断已经足够，「真实起止」还是
  「被切开」由 §5.6 的文字标记说清。

### 5.6 跨天标记

- 位置：标签列里、标题**之后**一枚 `跨天` 文本（`--fs-xs` / `--text-tertiary`，
  `flex: 0 0 auto`；标题 `min-width: 0` + 省略号，标记永不被压掉）。
- `title="该会话在当天之外还有记录，这里只画落在当天的那一段"`。
- 行按钮的 `aria-label` / `title` 末尾追加 ` · 跨天`（§6.4 模板）。
- 行按钮同时带 `data-cross-day="true"`（e2e 锚点）。
- 用**文字**而不是形状：1px 基线上的圆角/直角差异在这个尺寸下不可辨，而
  「跨天」是**语义事实**；文字是唯一不会误读的通道，也不依赖颜色。

### 5.7 密度块

```
densityLevelOf(count) = count <= 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : 3
高度                   = [—, 4, 8, 12][level]      （level 0 不渲染块）
```

- **固定阈值**（1–2 / 3–5 / ≥6），不按当天最大值归一：块高在**所有日子**里同一个
  含义，跨天可比；归一化会让「同样 8px 的块」在两天里表示不同的东西。
- 阈值的粗粒度由**每块的原生 `title`** 兜住：
  `title = \`${HH}:00–${HH+1}:00 · ${n} 条记录\``（如 `09:00–10:00 · 4 条记录`），
  块同时 `aria-hidden="true"`（行的可访问名已经承担朗读，避免读屏把 24 个小时块
  逐个念出来）。
- 块的 `left / width` = 该 clock hour 与 [start, end] 的交集（§3.5）。
- `data-density-level="1|2|3"` 是 e2e 断档高的锚点。

### 5.8 项目色键

- 只在 `key.length > 0`（≥2 个项目）时渲染；内容是 `[色点] {项目名}`，
  `--fs-xs` / `--text-secondary`，`gap: var(--sp-3)`，`flex-wrap: wrap`。
- 折尾项文案：`其他 {N} 个项目`（色点 = 色档 6）。
- 色点几何**沿用模型图例的 `.swatch`**：`10 × 10px` + `border-radius: var(--r-xs)`
  + 实色 `var(--chart-N)`。条与线也是实色同档，所以色点与条天生同色。
- 单项目日**不渲染色键**，并且全部条用色档 1——不给「唯一的项目」一个随机色，
  因为此时颜色不承载任何信息。

---

## 6. 交互与可访问性

### 6.1 悬停（逐行给出）

全站没有自绘 tooltip，悬停一律走**原生 `title`**（`Heatmap` / 归因行 /
ToolCensus 行的既有做法）。本轮有四个悬停面：

| 目标 | `title` 原文 |
| --- | --- |
| 行按钮（`day-timeline-bar`） | 同 §6.4 的 `aria-label`（一份格式函数两处用，不许分叉） |
| 密度块 | `{HH}:00–{HH+1}:00 · {n} 条记录`（例：`09:00–10:00 · 4 条记录`） |
| 跨天标记 | `该会话在当天之外还有记录，这里只画落在当天的那一段` |
| 日摘要六项 | §4.2 表的 `title` 列，逐字 |

日期刻度**不挂** `title`（轴行 `aria-hidden`，刻度线本身就是它的说明）。

### 6.2 点击与收起

- 点行 = `onOpenSession(session)`，与归因面板 / 压缩 top3 / 工具普查**同一条握手**；
  `row.path === ""`（无 `SessionMeta`）时行照列但 `disabled`、不进 Tab 顺序、
  不出现悬停底与焦点环（V1 的 `canOpen` 逻辑照抄）。
- 收起仍然只有两条路径：格子上再点一次（`aria-expanded` → false），或
  「× 清除」。V2 **不加**「点空白处关闭」。
- 切换目标：点另一天 = 展开那一天（`selected` 语义来自 V1，不动）。

### 6.3 键盘映射

| 键 | 行为 |
| --- | --- |
| Tab / Shift+Tab | 时间线是**一个** Tab stop（roving tabindex；只有当前行 `tabindex="0"`）。顺序：日历网格 → `× 清除` → 时间线首行 → 面板脚注 |
| ↑ / ↓ | 相邻行（时间序）移动焦点，到首 / 末行**不环绕** |
| Home / End | 首行 / 末行 |
| Enter / Space | 打开该会话（`<button>` 原生行为） |
| Escape | 收起展开区，**焦点回到日历上被选中的那个天格**（`buttonByDay.get(selected).focus()`） |

- 初始焦点 = **起点最早的那一行**。
- 展开时**不移动焦点**（V1 既有裁决：网格操作连续性优先；键盘用户按一次 Tab 就
  从「× 清除」走到时间线）。
- Escape 的回焦是 V2 必须做的：焦点现在能进展开区，得有条路回到网格——这也是
  `aria-expanded` 的格子与展开区之间的闭环。

### 6.4 可访问名（逐字模板）

```
spoken = `${title}（项目：${formatProjectPath(projectLabel, projectPath) || "未知项目"}）`
       + ` · ${formatClock(start)}–${formatClock(end)}`
       + ` · 时长 ${formatDuration(durationMs)}`
       + ` · 当日消耗 ${formatUsd(costUsd)}`
       + ` · ${formatTokenCount(tokens)} tok`
       + ` · 占当日 ${shareText}`          // 与 V1 同口径：<0.1% / 0.0%
       + (crossDay ? " · 跨天" : "");
aria-label / title = canOpen ? `打开会话：${spoken}` : `${spoken} · 当前不可打开`;
```

渲染样例（夹具今天的第 1 行，逐字）：

```
打开会话：消耗日历夹具会话 10（项目：calendar-10）· 09:20–09:22 · 时长 1m30s · 当日消耗 $1.80 · 600,000 tok · 占当日 52.2%
```

- **相对时间不进可访问名**（V1 同款纪律）：绝对时刻才是可核对的。
- 行的 `<ol>` 具名 `aria-label="{M}月{D}日会话时间线"`；`section` 的 `aria-label`
  **沿用 V1 原文** `{M}月{D}日会话清单`（不制造第二个人话名字）。
- 日摘要的每一项是「标签 + 值」的纯文本（无 `role`），数值不额外挂 live
  region：展开是一次显式动作，读屏会自然读到新内容。

### 6.5 空 / 单会话 / 极短 / 焦点

| 情形 | 形态 |
| --- | --- |
| 当天无会话（防御，正常不可达） | 不渲染摘要与时间线，只留一行 `这一天没有会话记录`（`--fs-xs` / `--text-tertiary`）；**不造空轴、不造 0 行** |
| 单会话 | 时间线 1 行；摘要 6 项照常（`会话数 1`、`涉及项目 1`）；**不渲染色键**，条用色档 1 |
| 极短会话（零跨度） | 基线 3px 刻痕 + 一个块；起止列显示两个相同时刻（`09:20–09:20`）；时长 `0ms` |
| 跨午夜的凌晨会话 | 当天段照画，标签列带 `跨天`，可访问名末尾 ` · 跨天`；两天各出现一行 |
| 会话数 > 6 | 行区内部竖滚（`max-height: 144px`）；**不折尾、不虚拟化**；条数恒等于会话数 |
| 键盘焦点进入时间线 | 单个 Tab stop；`Escape` 回焦到日历格 |

---

## 7. 高对比度

### 7.1 令牌清单：**零新令牌**

| 用途 | 令牌 | Round U 是否已覆盖 |
| --- | --- | --- |
| 条、基线、密度块、色点 | `--chart-1` … `--chart-6` | 是：四块主题全覆盖（HC 两块是实色高对比取值） |
| 行区底纹（竖线）与行间发丝线 | `--border` | 是 |
| 行底色 / 悬停 / 文字 | `--bg-active` / `--text-secondary` / `--text-tertiary` / `--text` | 是 |
| 焦点环 | `--focus-ring-width` / `--focus-ring-inset` / `--accent` | 是（HC 自动 3px） |
| 摘要数值与标签 | `--fs-*` / `--lh-*` / `--text` | 是 |

**不消费 `--chart-*-soft`**、**不消费 `opacity`**、**不消费 `--cal-*`**（日历色阶是
日期维度，时间线的色是项目维度，两者不互借）、**不消费 `--cat-*`**（记录类别语义）。

### 7.2 实算对比度（WCAG 2.1 相对亮度，公式同 Round U §3.1）

实色标记对**轨道底 `--bg-inset`**（`.sessions` 的底色就是它）：

| 主题 | `--bg-inset` | chart-1..6 逐条 | 最低 |
| --- | --- | --- | --- |
| 普通浅色 | `#f1f3f5` | 5.07 / 4.24 / 3.90 / 3.49 / 3.56 / 4.23 | **3.49** |
| 普通深色 | `#0a0b0d` | 9.12 / 9.12 / 9.56 / 11.57 / 8.46 / 8.40 | **8.40** |
| HC 浅色 | `#eef1f5` | 6.90 / 6.40 / 6.07 / 6.11 / 6.84 / 6.85 | **6.07** |
| HC 深色 | `#000000` | 9.97 / 11.55 / 12.76 / 14.56 / 10.28 / 10.87 | **9.97** |

门槛取项目既定的**图形件 ≥3**；**四块主题全部达标，零豁免**。这正是「不铺
`-soft` 底色」换来的结果（对比：若用 `-soft` 铺底，普通浅色下实色块 vs 铺底
合成色的最低值是 **2.68**，不达标）。

**相邻项目色的亮度比接近 1.0 不是缺陷**（普通浅色 1.02–1.20）：`--chart-*` 是
**等明度分色**的类别色板，区分靠色相而不是明度，用对比度衡量它本身就是错的
尺子。可辨认性由三条冗余通道承担：① 每行的**色点 + 标题**；② 展开区的
**项目色键**（色点 + 项目名，含折尾项）；③ 同一行内只有**一个**项目色
（基线、块、色点同色），跨色只在**不同行**之间发生，而行有标签。色觉障碍用户
读的是色键的文字，不是色差。

### 7.3 复现脚本（可直接 `node` 跑，上表每个数字由它产出）

```js
// 用法：node day-contrast.mjs
const chan = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const lumRGB = ([r, g, b]) => 0.2126 * chan(r / 255) + 0.7152 * chan(g / 255) + 0.0722 * chan(b / 255);
const cr = (a, b) => {
  const [hi, lo] = [lumRGB(rgb(a)), lumRGB(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const themes = [
  ["普通浅色", "#f1f3f5", ["#2f6b9f", "#0f7f8f", "#618428", "#a67a08", "#8a6fd4", "#bf4a78"]],
  ["普通深色", "#0a0b0d", ["#82b5e8", "#55bfce", "#8ec45c", "#edc14e", "#c398ec", "#ef8ab3"]],
  ["HC 浅色", "#eef1f5", ["#1c567f", "#00606e", "#45631a", "#7a5200", "#5a3fa8", "#932a56"]],
  ["HC 深色", "#000000", ["#7cb8f0", "#5fd0dd", "#a3d97a", "#ffd166", "#c9a6f7", "#ff9dc4"]]
];
for (const [name, bg, solid] of themes) {
  const values = solid.map((c) => cr(c, bg));
  console.log(`${name}: ${values.map((v) => v.toFixed(2)).join(" / ")} → 最低 ${Math.min(...values).toFixed(2)}`);
}
```

### 7.4 高对比度下**零特判**

时间线不写任何 `[data-contrast="high"]` 规则：没有半透明铺底（不会在纯白 / 纯黑上
塌缩）、没有 `opacity` 台阶（不需要重新取值）、块与线本身已经是实色（对底最低
6.07，不需要像日历格子那样补 1px 描边）。**「只动颜色」在这条时间线上的可验证
形式 = 切档前后同一行的 `getBoundingClientRect()` 逐像素不变**（§10.3 有断言）。

组件侧只需确认一件事：时间线的条色**只从 `--chart-*` 取**（`rg` 断言
`.module.css` 里时间线相关规则不出现颜色字面量、不出现 `[data-contrast`）。

---

## 8. 稳定锚点（门禁与 e2e 要用，写死）

| 锚点 | 挂在哪儿 | 值 / 数量 |
| --- | --- | --- |
| `data-calendar-sessions` | 展开区 `<section>` | V1 既有，**不动**；门禁 `sessions.rows` 数的是它内部的 `li` |
| `data-probe="day-summary"` | 日摘要容器 | 恰 1 个 |
| `data-probe="day-summary-item"` + `data-summary-key` | 每个读数项 | 恰 6 个；键 `cost / sessions / messages / span / model / projects` |
| `data-probe="day-timeline"` | 时间线容器（轴 + 行区） | 恰 1 个 |
| `data-session-count` | **时间线容器上** | 组件声明的当天会话数；门禁拿它与**实测条数**、`li` 计数三方对账 |
| `data-probe="day-timeline-tick"` | 轴刻度 | 恰 9 个，文本 `00:00` … `24:00` |
| `data-probe="day-timeline-list"` | 行区（`overflow-y: auto`） | 恰 1 个 |
| `data-probe="day-timeline-bar"` + `data-session-path` | 每条会话行 | **数量 === 当天会话数**；`path` 为空串时锚点仍在（行不可点） |
| `data-cross-day="true"` | 跨天行 | 仅跨天行有 |
| `data-probe="day-timeline-density"` + `data-density-level="1\|2\|3"` | 每个有记录的整点块 | 每行 0…24 个 |
| `data-probe="day-project-dot"` + `data-project-index="1..6"` | 行内色点与色键色点 | 色档 1…6 |
| `data-probe="day-project-key"` | 项目色键 | 仅 ≥2 项目时在场 |

**aria 标签原文**（逐字，三处）：

1. 时间线列表：`aria-label="{M}月{D}日会话时间线"`（挂在 `<ol>` 上）
2. 展开区 `<section>`：**沿用 V1** `aria-label="{M}月{D}日会话清单"`
3. 每条会话行：§6.4 的 `aria-label` / `title`（`打开会话：…`，不可打开时
   `… · 当前不可打开`）

---

## 9. 状态表

| 场景 | 日摘要 | 时间线 | 行读数 / 备注 |
| --- | --- | --- | --- |
| **0 会话**（防御，正常不可达） | 不渲染 | 不渲染 | 一行 `这一天没有会话记录`；不造空轴 |
| **1 会话** | 6 项照常；`会话数 1`、`涉及项目 1` | 1 行 | 不渲染色键；条用色档 1 |
| **多会话** | 6 项照常 | N 行（时间序） | ≥2 项目时渲染色键；>6 行时行区内部竖滚 |
| **零跨度**（单条记录） | 跨度 `09:20–09:20`，`title` 里跨度为 0 | 基线 3px + 一个块 | 起止列两个相同时刻；可访问名 `时长 0ms` |
| **跨午夜** | 只统计当天那一段（首条→末条都在当天） | 只画当天段 | 标签列 `跨天`；可访问名末尾 ` · 跨天`；两天各出现一行 |
| **项目数超限（6+）** | `涉及项目 N` 照实 | 全部行都在 | 前 5 名占色档 1…5，其余并成色档 6；色键末项 `其他 N 个项目` |
| **输入乱序** | 逐字段相同 | 行序由起点决定 | 单测断「输入顺序无关」 |
| **130% 字号** | 值行随 `--lh-md` 长高，可能折成 2 行 | 轨道与块尺寸**不变**（形不缩放） | 行高随 `--lh-xs` 长高；文档 / main 不横向溢出 |
| **高对比度（浅 / 深）** | 全部走既有令牌 | 条 / 线 / 块换实色取值 | **零特判**；几何逐像素不变 |
| **扫描进行中（渐进批次）** | 随批次刷新 | 若目标天数据已到则照常 | 同 V1：已展开的天在新批次后内容刷新 |
| **切「错误」档** | 整块不渲染 | — | V1 既有（面板住在 usage 档的条件块里） |

---

## 10. 验收矩阵（每条都能被断言）

### 10.1 纯函数（`web/src/features/usage/dayReview.test.ts`，新文件）

- [ ] **不重算**：结构守卫（源码含 `daySessionsOf(`、不含 `estimateCost`）；
      行为守卫（§3.2 的七条恒等式）。
- [ ] **首末时刻**：3 条记录（09:12 / 09:40 / 11:05）→ `start = 09:12`、
      `end = 11:05`、`durationMs = 1h53m`；`summary.firstAt / lastAt` 是当天全部
      会话里的极小 / 极大值。
- [ ] **逐小时分桶**：记录落在 09 / 09 / 10 / 23 四点 → `hourly[9] === 2`、
      `hourly[10] === 1`、`hourly[23] === 1`、其余 0、`Σ hourly === messages === 4`。
- [ ] **跨午夜切分**：同一会话在昨天 23:40、今天 00:25 / 01:10 各一条 →
      两天的行 `start / end` **都落在各自当天内**（`dayStartOf(start) === dayStart`）、
      两行 `crossDay === true`；只有当天记录的会话 `crossDay === false`；
      当天的 token 只算当天的记录（跨天那半段不进今天的行）。
- [ ] **极短会话**：单条记录 → `durationMs === 0`、`hourly` 只有一个 1。
- [ ] **密度档**：`densityLevelOf(0 / 1 / 2 / 3 / 5 / 6)` → `0 / 1 / 1 / 2 / 2 / 3`。
- [ ] **排序**：起点升序；起点并列按终点；再并列按标题、再按路径。
- [ ] **项目色**：6 个项目 → 前 5 名色档 1…5、第 6 并入色档 6（`folded === 1`）；
      7 个项目 → 折尾 `folded === 2`；单项目 → 全部色档 1 且 `key === []`；
      token 并列按 label 字典序。
- [ ] **DST 安全**：结构守卫（源码含 `addLocalDays(`、不含 `86400000` /
      `86_400_000`）；`clockAt(dayStart, 24)` 与 `addLocalDays(dayStart, 1)` 同值；
      24 桶的 `dayFractionOf` 落在 `[0, 1]` 且单调不减。
- [ ] **空态**：`sessions === 0` → `rows === []`、`firstAt / lastAt === null`、
      `spanMs === 0`、`topModel === null`、`dayTokens === 0` 时 `share` 全 0
      （不是 NaN）。
- [ ] **输入顺序无关**：打乱 `inputs` 与 `records` 顺序，逐字段（含数组顺序）相等。
- [ ] **最常用模型**：多模型按 token 降序；并列按 id 字典序；无 usage → `null`。

### 10.2 组件（`UsageCalendarPanel.test.tsx` 追加 describe）

- [ ] 点今天格 → `[data-probe="day-summary"]` 在场，`day-summary-item` 恰 6 个，
      `data-summary-key` 与文案逐项对照（夹具确定值）。
- [ ] 徽章：`cost` 项的 `aria-label` 以 `数据来源：按定价快照估算` 开头，其余 5 项
      以 `数据来源：读自日志` 开头（四档只用到两档）。
- [ ] `[data-probe="day-timeline"]` 在场；`day-timeline-bar` **数量 === 会话数**；
      每条的 `data-session-path` 与夹具 path 集合逐字相等；行序 = 起点升序。
- [ ] 几何：某条的 `aria-label` 里的 `09:20–09:22` 与 `style.left / width` 的百分比
      一致（按 `dayFractionOf` 手算期望值，容差 0.01%）。
- [ ] 密度：小时桶值为 4 的那一行有 `data-density-level="2"` 的块、桶值为 1 的块是
      `1`、桶值为 0 的小时**没有块**；块的 `title` 逐字 `09:00–10:00 · 4 条记录`。
- [ ] 轴：`day-timeline-tick` 恰 9 个，文本 `["00:00","03:00",…,"21:00","24:00"]`。
- [ ] 跨天：跨天行的文本含 `跨天`、属性 `data-cross-day="true"`、可访问名以
      ` · 跨天` 结尾；非跨天行没有这三样。
- [ ] 色键：≥2 项目时 `day-project-key` 在场且项数 = 色档数（含折尾）；单项目时
      **不在场**；色点的 `data-project-index` 与行的色点一致。
- [ ] 点击行 → `onOpenSession` 收到该行的 `SessionMeta`（path 逐字）；无 `SessionMeta`
      的行 `disabled` 且 `tabIndex` 不参与。
- [ ] 键盘：时间线内恰一个 `tabindex="0"`；↓ 后焦点移到第 2 行；Home / End 到首 / 末；
      Enter 打开会话；Escape 收起展开区且 `document.activeElement` 是被选中的天格
      的 `button`。
- [ ] 有界：`.dayRows` 的 CSS 规则含 `max-height: 144px` 与 `overflow-y: auto`
      （读 `.module.css` 源码断言——jsdom 量不了滚动）。
- [ ] 视觉纪律（读源码）：时间线相关规则里**无颜色字面量**、**无 `opacity` 声明**、
      **无 `direction: rtl`**、**无 `[data-contrast` 特判**、圆角只用 `var(--r-*)`。
- [ ] 面板其余部分零回归：365 天格、今天格唯一、roving tabindex 与既有键盘映射、
      `aria-expanded`、面板脚注原文——原有用例全部保留。

### 10.3 端到端（`web/e2e/usage-calendar.spec.ts` 扩展；Chromium + WebKit）

- [ ] **夹具扩展**（`fixtures.ts` 的 `calendarScenario`）：
      今天 3 个会话改用**今天 00:00 起的固定本地时刻** `09:20 / 13:05 / 18:40`
      （token 600K / 300K / 100K 不变 → 昨天仍 4 档、今天仍 3 档、15 天前仍 0 档，
      V1 的档位断言不受影响）。
- [ ] 新增**凌晨跨午夜**会话：昨天 23:40（user，50K）、今天 00:25（assistant，90K）、
      今天 00:52（user）、今天 01:10（assistant，60K）→ 今天段 `00:25–01:10`、
      `crossDay`、`hourly[0] === 3`；昨天成本 $12.15 仍是全窗最大（4 档）。
- [ ] 新增 `now − 2` **密集日**：1 个会话 09:00–17:00 每小时 1 条（9 条）+
      1 个会话 13:30–13:45 + 6 条短会话 → **共 8 个会话**（覆盖「逐小时都有块」与
      「会话数 > 6 → 行区竖滚」）。
- [ ] 新增 `now − 3` **稀疏日**：只有 08:xx 与 14:xx 两个有活动的小时。
- [ ] 所有时间戳按**本地日历日的固定时刻**构造（不用 `now − Nh` 偏移，否则清晨 /
      深夜运行会漂到相邻日历日）。
- [ ] 展开今天 → 结构：`day-summary-item` = 6、`day-timeline-bar` = 4、
      `day-timeline-tick` = 9、行序起点升序。
- [ ] **条位置真算**：`09:20` 那条的 `boundingBox().x` 相对轨道列的比值
      ≈ `(09:20 − 00:00) / 24h`（容差 0.5%），宽度比值 ≈ `duration / 24h`。
- [ ] **极短会话可视**：`09:20` 那条（两条记录相隔 90s）的真实宽度 ≥ 3px。
- [ ] **悬停内容**：`title` 与 §6.4 样例逐字相等（含 `占当日 52.2%`）。
- [ ] **点击开会话**：点该行 → 切到会话分析、「会话图已加载」、会话标题逐字一致。
- [ ] **跨午夜**：凌晨行的 `data-cross-day="true"`、文本含 `跨天`，且它的条贴左边缘
      （`x` 比值 ≈ 0.017，即 00:25）。
- [ ] **密集日**：展开 `now − 2` → `day-timeline-bar` = 8，且
      `[data-probe="day-timeline-list"]` 的 `scrollHeight > clientHeight`
      （内部竖滚）、`overflow-y === "auto"`。
- [ ] **稀疏日**：展开 `now − 3` → 有块的整点恰好 2 个小时（按块的 `title` 解析）。
- [ ] **滚动收容**：960 视口下 `.dayTimeline` 的 `scrollWidth > clientWidth` 且
      `overflow-x === "auto"`，同时文档与 `main` 的 `scrollWidth ≤ clientWidth + 1`。
- [ ] **130% + 高对比度**：`--font-scale === "1.3"`、根属性 `data-contrast="high"`；
      文档 / main 无横向溢出；抽一个色档 1 的行断言计算 `background-color`
      === `--chart-1` 的解析值；同一行的 `getBoundingClientRect()` 在切回普通档
      前后**逐像素不变**（±0.5px）。
- [ ] **V1 连带更新**：`共 3 个` → `共 4 个`、行数 3 → 4；`rows.first()` 改为
      「起点最早的那行」（凌晨会话）并相应改断言。

### 10.4 真机门禁（`scripts/gui-test.sh` + `src-tauri/src/lib.rs`）

**既有部分一个字不改**：`CAPTURE_TARGETS` 里的两次
`点选=[data-probe='calendar-today'] button`、`CALENDAR_SESSIONS_MAX_HEIGHT = 400`、
`calendarFacts` 的 `view / dayCount / todayCount / container / sessions` 全部原样。

**新增探针事实**：**在途的 `lib.rs` 改动已经把它写好并落成 `facts.calendar.dayReview`**
（字段名以此为准，不要另造 `facts.calendar.day`，也不要在前端另起第二套锚点）。
在途形状实录如下，实现者按它写脚本侧断言：

```
calendarFacts.dayReview = {
  summary:  { rect: {…}, text: "当日消耗 … 会话数 … 活跃跨度 …" } | null,
      // 无 view 字段：null 就是「摘要行不在场」；text 是空白折叠后的整段文本
  timeline: { rect: {…}, bars: n, declaredSessions: n | null } | null,
      // declaredSessions 来自时间线容器上的 data-session-count
  bars:     [ { rect: {…}, sessionPath: "…", label: "打开会话：…" } ]   // 每条横条
}
```

**新增断言**（加在既有第 1 次点选那一支里，与「展开区在场 / 行数 ≥1 / 高度 <400」
并列；常量加在脚本顶部，与既有 `CALENDAR_*` 常量同一段）：

- [ ] `summary` 非 null，且它的 `text` **同时含六个标签逐字**：
      `当日消耗`、`会话数`、`消息数`、`活跃跨度`、`最常用模型`、`涉及项目`
      （常量 `DAY_SUMMARY_LABELS` 一份，脚本里逐项 `in`）。
- [ ] `timeline` 非 null，且 **`timeline.bars === 1`**（夹具今天恰 1 个会话）。
- [ ] **三方对账（「条数 = 当天会话数」的完整形式）**：
      `timeline.bars === calendar.sessions.rows`（DOM `<li>` 计数）
      **且** `timeline.bars === timeline.declaredSessions`（组件声明）。
      两条一起，才能同时抓住「漏画一行」与「画了不该画的行」。
- [ ] `bars.length === timeline.bars`，且每条 `bars[i].sessionPath` 非空、
      `bars[i].label` 以 `打开会话：` 开头（夹具的今天会话有 `SessionMeta`，
      必然可点）。
- [ ] **时间线含于展开区**：`timeline.rect` 在 `sessions.rect` 内（四边比较，容差 1px）；
      且每条 `bars[i].rect` 也在 `timeline.rect` 内（行不会被挤出容器）。
- [ ] **有界**：`timeline.rect.height <= DAY_TIMELINE_MAX_HEIGHT`
      （常量 = **180**：轴 ≤20.8 + gap 4 + 行区 144，130% 字号下仍成立）。
- [ ] 既有断言不变：展开区 `rect.height < 400`、`rows >= 1`；第 2 次点选仍判
      「展开区离场」。

`day-timeline-tick === 9` 与「行区 `overflow-y: auto` / `scrollHeight > clientHeight`」
**不进真机门禁**（契约只要求时间线 rect / 条数 / 摘要在场三件事）：前者的
「9 个刻度」由组件单测与 e2e 断（§10.2 / §10.3），后者的滚动是
`max-height` 的直接结果、由 e2e 在 8 会话的密集日上断。若实现者愿意顺手把这两项
也塞进探针，**必须扩展同一份 `dayReview` 对象**（不许新开顶层键），并且不得
改动已有的 `view / dayCount / todayCount / container / sessions` 五个字段。

**两条口径（实现者照此写常量与断言）**：

- **展开区最大高度**：沿用 `CALENDAR_SESSIONS_MAX_HEIGHT = 400`，**不新增第二个
  展开区上限**；V2 的最坏高度 ≈362px（§1.4），并且时间线行区自己另有 `144px` 的
  内部上限——「有界」由这两层共同保证。
- **时间线条数 = 当天会话数**：`day-timeline-bar` 的计数必须等于
  `daySessionsOf(...).sessions`，且**不得折尾、不得虚拟化**；门禁在夹具上断
  `bars === 1`，同时断 `bars === calendar.sessions.rows`（`<li>` 计数）——两条一起，
  才能同时抓住「漏画一行」与「画了不该画的行」。

### 10.5 截图（归档进 `docs/screenshots/`）

- [ ] `screenshots.spec.ts` 新增 describe `截图归档 · 一日回望`：
      `test.use({ scenario: calendarScenario() })`；步骤 = 进「用量总览」→ 等
      `纳入统计` → 点今天格 → `page.locator('[data-probe="day-summary"]')
      .scrollIntoViewIfNeeded()` → 把 `main.scrollTop` 设成「日历面板的 offsetTop − 8」
      再等两帧（让整个日历面板 + 展开区落在一屏内）→ `settleImages` → 截图。
- [ ] **浅 / 深 × 两引擎 = 4 张**：`usage-day-light.png`、`usage-day-dark.png`、
      `usage-day-light-webkit.png`、`usage-day-dark-webkit.png`。
- [ ] `scripts/check-screenshots.sh` 的 `EXPECTED_VIEWS` 追加 `"usage-day"`
      （**独立清单，必须与 spec 两处同步**，否则 `lint.sh` 会报「截图套缺视图」）。
- [ ] 重出后人工看图（我这一侧会亲自看并复现）：项目色档分明、色键在场、块高可辨、
      轴 9 个刻度不重叠、跨天标记可见、摘要 6 项不折行错位。
- [ ] 若 `README` / `README.zh-CN.md` 引用新图，必须同时进 `manifest.json`
      （`check-screenshots.sh` 的第 2 条会把断图打红）。
- [ ] 真机门禁的既有截图步骤（第 1 次点选今天格）自然带上展开态的一日回望，
      作为「真实 .app 里长这样」的旁证，**不改任何步骤**。

---

## 11. 明确不做

1. **不动 365 天网格与 53 列恒等式**（365 天格 + 6 pad + 371 个 `td`），不动今天格
   与全部 V1 锚点、键位、`aria-expanded` 语义。
2. **不做月 / 周 / 日缩放**（形状图的价值在「一眼读完一段」，V1 的理由照旧）。
3. **不做虚拟化**（一天最多几十个会话；行区 `max-height` + 原生滚动即可，
   窗口化只会引入「假列表」的判据债）。
4. **不引图表库**（沿用自绘 DOM/CSS/SVG 路线；本轮的图形只有 1px 线 + 小矩块）。
5. **不改快照导出**：`SNAPSHOT_SCOPE_NOTE` 已经在 V1 里写明「不含消耗日历」，
   本轮**不把一日回望画进快照**，那两句文案也不动。
6. **不新增令牌**；**不消费 `-soft` / `opacity` / `--cal-*` / `--cat-*`**
   （前者不达标、后两者语义被占）。
7. **不做自绘 tooltip**（四个悬停面都用原生 `title`）；**不做 forced-colors 映射**
   （Round U §9-2 已裁决另立 Issue）。
8. **不做「现在」游标**：展开区是历史快照，游标会随挂机漂移、污染截图比对。
9. **不做摘要项的下钻**（不点「最常用模型」去筛模型、不点「项目数」去筛项目）：
   那需要第二套筛选状态，而本屏的容量已经用在时间线上。
10. **不按 `Intl` 动态周起始 / 不按 locale 改时间格式**（`HH:mm` 与 Monday-first
    都是写死的，V1 同款）。

---

## 12. 实现者清单（按改动顺序，逐文件）

1. `web/src/features/usage/usageCalendar.ts`：给 `countsAsMessage` 与 `sessionKeyOf`
   加 `export`（**函数体与文档一字不改**）。
2. `web/src/features/usage/dayReview.ts`（新）：§3 的全部类型与函数
   （`dayReviewOf` / `densityLevelOf` / `clockAt` / `dayFractionOf` /
   `DAY_DENSITY_LEVELS` / `DAY_PROJECT_COLOR_CAP`）。
3. `web/src/features/usage/dayReview.test.ts`（新）：§10.1 全部条目。
4. `web/src/features/usage/UsageCalendarPanel.tsx`：展开区改为「头部（新文案）+
   日摘要 + 时间线 + 项目色键 + 新脚注」；删除 `CalendarSessionListRow`、折尾行与
   `SESSIONS_FOOTNOTE` 的旧文案；时间线 roving tabindex + `Escape` 回焦；
   `data-probe` 锚点按 §8 铺。
5. `web/src/features/usage/UsageCalendarPanel.module.css`：删掉只服务旧清单的规则
   （`.sessionRow` / `.barTrack` / `.barFill` / `.barRestFill` / `.sessionRest` 等），
   新增 `.daySummary*` / `.dayTimeline*` / `.dayRow*` / `.projectKey*`（§4–§5）。
   动手前先 `rg` 一遍这些类名只有本组件用（CSS Module 作用域内也应确认没有
   复用者）。
6. `web/src/features/usage/UsageCalendarPanel.test.tsx`：§10.2 全部条目；
   保留全部既有用例。
7. `web/e2e/fixtures.ts`：扩展 `calendarScenario`（§10.3 的布景；既有 5 个日期的
   token 阶梯与昨天 / 今天 / `now−100` 的档位关系**保持不变**）。
8. `web/e2e/usage-calendar.spec.ts`：§10.3 的新用例 + 两条 V1 连带更新；
   若文件越过 400 行，把 V2 的用例拆到新的 `web/e2e/day-review.spec.ts`。
9. `web/e2e/screenshots.spec.ts` + `scripts/check-screenshots.sh`：`usage-day`
   视图（两处同步，§10.5）。
10. `scripts/gui-test.sh`（+ 已存在于工作区的 `src-tauri/src/lib.rs` 探针改动）：
    按 §10.4 的**在途字段名** `facts.calendar.dayReview` 写断言，脚本侧新增两个常量
    （`DAY_SUMMARY_LABELS` 六项一串 / `DAY_TIMELINE_MAX_HEIGHT = 180`）；
    前端只需挂 `data-session-count`，**不要**再改探针字段名。
    既有步骤、`CALENDAR_*` 常量与五个既有 `calendarFacts` 字段一个字不动。
11. 文档：`CHANGELOG.md`（`[Unreleased] → Added`，中文条目：消耗日历点开某天后
    新增「一日回望」——日摘要 + 24 小时时间线）、`README.md` / `README.zh-CN.md`
    功能条目（双语）、`docs/USAGE.md` 的「消耗日历」一段补三句事实（点某天展开
    一日回望；时间线一行一会话、按起点升序、条色 = 项目；色深是成本四分位、
    时间线条色是项目——两个维度别混）。

**一句话**：这一轮的重量压在三个地方——**融合**（一行一会话，形状与账目同处一行，
并置的高度账根本算不平）、**「基线 + 块高」的密度形态**（把密度从颜色里拿出来放进
几何，于是四块主题共用一个 CSS 值、零新令牌、零豁免）、以及**「条数 === 会话数」
这条全链条恒等**（单测、e2e、真机探针三处断同一个数）。
