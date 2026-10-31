# 设计规格 · Round GG 第五批十功能（叙事 / 检索 / 导出）

> 分支 `feat/v035-batch-ten-5`（基于 `1a97a8f`）。本轮只写规格，不改代码。
> 体例沿用 `design-round-ee-batch3.md`：现状核对 → 裁决 → 几何与账 → 令牌 → 无障碍 → 状态矩阵 → probe → 实现清单。

---

## 0 语境与现状（逐条核过，不是转述）

### 0.1 这一批要解决的三件事

前四轮把「读数、对比、趋势、极值、实验室」补完了，剩三个维度没人碰：

1. **叙事**——单会话有重放与时间轴，跨会话只有数字没有故事；年报是年度的，季度/月份粒度是空的。
2. **检索**——全局搜索按文本搜，**按条件**检索会话做不到。
3. **导出**——CSV 只有三张表，一份给人看的会话档案导不出去。

十功能全部纯前端现算，零新增依赖、零新增权限、零新增网络。

### 0.2 核过的既有事实

| 事实 | 出处（行号为当前工作区实况） |
| --- | --- |
| 用量页已有 5 个档：`usage` / `milestones` / `errors` / `annual` / `lab` | `web/src/features/usage/UsageOverviewPage.tsx:74` |
| 档位持久化在 `cca-usage-view` | 同上 `:73` |
| KPI 行是 4 列网格、`overflow: hidden` | `UsageOverviewPage.module.css:67` |
| board 是 2 列网格、gap 12、`compactionRow` 整行跨列 | 同上 `:135`、`:144` |
| 用量档块序：KPI → 周战报 `:717` → 会话对比 `:721` → 趋势/项目/卡片/指纹/习惯/日历/甘特 → 模型 → 工具 → 压缩 | `UsageOverviewPage.tsx:660-895` |
| 错误档分区：趋势图 → **错误聚类（已有）** → 按工具/按项目 | `ErrorOverviewSection.tsx:257-300` |
| `ErrorClustersPanel` 已按「工具 + 归一化首行」聚类，含首末时间 | `ErrorClustersPanel.tsx:15`、`:26` |
| 工具普查已有两档：调用次数 / 健康 | `ToolCensusPanel.tsx:248` |
| 会话对比以 token 前两名预置 A/B | `SessionComparePanel.tsx:79-100` |
| 项目卡整张是 `<button>`（点击=后续筛选用），卡内不能放按钮 | `ProjectCardsPanel.tsx:97-104` |
| 年报档是独立视图、`data-probe="year-report"`、6 张卡 | `AnnualReportPanel.tsx:39-90` |
| 会话列表侧栏 300px；工具栏 = 12 内距 + 28 控件 + 12 内距 = 52 | `tokens.css:162`、`SessionList.module.css:18` |
| 列表空态现在写「没有匹配的会话 / 调整搜索词后重试。」 | `SessionList.tsx:388` |
| 会话页头已有三个动作：复制 resume / 打开位置 / **导出** | `SessionHeader.tsx:134-170` |
| 「导出」开的是 `ExportDialog`，格式两档 html/csv，作用域两档 | `ExportDialog.tsx:15-23` |
| 导出落盘唯一入口 `dialog.saveText(name, text, {title,filterName,extensions})`，取消返回 `null` | `web/src/api/types.ts:82` |
| 用量快照是**单文件 HTML**（不是 JSON） | `UsageOverviewPage.tsx:490-497` |
| `SessionMeta` 只有 sessionId / cwd / projectLabel / 标题 / path / mtimeMs / sizeBytes | `metadataCache.ts:1-35` |
| `UsageSessionInput` 才带 records / errorExtract / toolCalls / compactEvents | `usageAggregations.ts:51-82` |

### 0.3 由 0.2 直接推出的两个约束

- **`SessionMeta` 里没有模型、工具、错误、上下文峰值、时长。** G2 的六个条件一个都算不出来——它必须有一套新的「每会话事实」，见 §2 第 4 条。
- **现有快照是 HTML，不是 JSON。** G10 要「读入两份 JSON」，就必须先有 JSON 快照这个格式，见 §2 第 3 条。

---

## 1 十条裁决（一句话版）

| 编号 | 挂载点（最终） | 一句话 | 与派工措辞的差异 |
| --- | --- | --- | --- |
| G1 工作日志 | 用量档，KPI 行之后、周战报之前 | 自然日倒序日行，收起 24px，展开 ≤160px，默认只展开今天 | 收起行 **24px** 不是 20px（见 §2 第 5 条） |
| G2 会话筛选器 | 会话列表侧栏，视图档按钮之下 | 收起态一行 28px（「筛选 · N」+ 展开箭头），展开后 2×3 网格；条件 AND，即时生效 | 用 28px（`--control-h`）与侧栏控件同高，不是 32px |
| G3 会话档案 | `ExportDialog` 第三个格式「档案 Markdown」 | 不新增页头按钮；档案是「导出」这件事的第三种产物 | **不新增页头按钮**（见 §2 第 2 条） |
| G4 用量月报 | 年报档 6 卡之后 | 12 张 88px 迷你卡横滚，点月 → 切用量档并定位该月最活跃的一天 | 下钻走既有「选中日」，不新造区间 |
| G5 错误档案 | 错误档新增「时间线 / 档案」两档 | 档案档 = 聚类详版独占整档（会话数、代表消息、可展开） | 现状已有聚类面板，档案**替代**它在档案档的位置 |
| G6 工具月历 | 工具普查第 3 档「按月」 | 每工具 12 根迷你竖条，横轴月序 | 无 |
| G7 上下文分位数 | 用量档「压缩（上下文重置）」卡底部一行 | P50/P75/P90/P99/Max 五读数 | 出血点卡在会话页、接不到窗口数据（见 §2 第 6 条） |
| G8 项目季节 | 项目卡片内追加 6px 四段条 + 一句 11px 文字 | 常显，不做展开 | 卡是 `<button>`，**不能**再塞展开按钮 |
| G9 会话相似度 | 会话对比卡底部「相似会话」区 | 针对左侧 A，列 3 个最像的会话 + 相似度 + 推荐理由 | 无 |
| G10 快照对比 | 用量档页头「导出快照」右侧「对比快照」 | 浮层内读两份 JSON，差值表；z-index 130、Esc 归属浮层 | 需要新 JSON 快照格式（见 §2 第 3 条） |

---

## 2 需要你拍板的六条（其余按上面直接落）

### 2.1 G5 与既有「错误聚类」重叠

现状 `ErrorOverviewSection` 里已经有 `ErrorClustersPanel`：按 (工具, 归一化首行) 聚类、含首末时间、点行跳回记录。G5 若再做一个「(工具, 签名) 聚类的可展开列表」，就是同一张表的第二版。

**裁决**：错误档顶部加 `SegmentedControl`「时间线 | 档案」：

- **时间线**（默认）= 现状原样：趋势 → 聚类 → 按工具/按项目。
- **档案** = 聚类详版**独占**：一行一类，展开后给「涉及 N 个会话 / 代表消息 / 全部发生会话（可点）」。
- 两档吃同一个 `stats.events`，零重复计算；差异只在**信息密度**，不在数据。

这样「时间线回答刚才炸了什么，档案回答这一类到底怎么坏的」两句话都能成立，且不新增第三块同义面板。

### 2.2 G3 不新增页头按钮

页头 `.actions` 已有三个按钮（复制 resume / 打开位置 / 导出），再加一个「导出档案」= 两个导出并排，用户每次都要读两遍才知道点哪个。

**裁决**：`ExportDialog` 的格式档从 `HTML 报告 | CSV` 扩成 `HTML 报告 | CSV | 档案 Markdown`；选「档案」时**作用域控件隐藏**（档案是整会话产物，没有「当前筛选结果」的含义），并在原位置显示一行口径：

> 档案只含元信息、统计与时间线摘要，**不含会话内容**

`data-probe` 仍挂 `export-format`（既有），新增 `export-archive-note`。

若你坚持页头按钮，代价是：`.actions` 从 3 键变 4 键，960px 窄窗下这排按钮会换行（见 §3.3 横向账）。

### 2.3 G10 需要一个新的文件格式

现有「导出快照」产出**单文件 HTML**（自包含 CSS，给人看的）。G10 要读两份「导出的 JSON 快照」——这个 JSON 现在不存在。

**裁决**：新增 `usageSnapshotJson`（纯前端序列化，无新依赖），与 HTML 快照并列在同一个按钮里出两种？**不**——按钮只出一份，格式由用户选：

- 「导出快照」按钮保持现状（HTML），**下拉**增加一项「导出快照数据（JSON）」；
- JSON 形状：`{ schema: "cca.usage.snapshot", version: 1, exportedAt, days, range: {start,end}, kpi, totals, topProjects, topModels, daily }`；
- **绝不包含**：会话 id、路径、项目绝对路径、任何消息文本。项目只到 `projectLabel`（编码目录名）。

对比浮层只认 `schema + version`，不认识的版本显式拒收（不猜）。

### 2.4 G2 需要一份新的「每会话事实」

`SessionMeta` 没有模型/工具/错误/上下文峰值/时长。要实时过滤，只有三条路：

| 方案 | 代价 | 结论 |
| --- | --- | --- |
| A. 每次筛选全量重读 jsonl | 数百会话 × 全量解析，秒级卡顿 | 否 |
| B. 只对已解析过的会话可筛，未解析的置灰 | 「为什么这个会话筛不出来」——用户无法理解 | 否 |
| C. metadata 缓存 `version: 2 → 3`，扫描时顺手累计六个事实 | 一次全量扫描（现成流程）后永久命中 | **选 C** |

**C 的形状**：`SessionFacts = { models: string[]; tools: string[]; ctxPeak: number; errors: number; durationMs: number; messages: number }`，与 `MetadataCacheEntry` 同级存；命中率与现在的标题补全共用同一条进度条（`正在补全标题 N/M` 扩成 `正在建立索引 N/M`）。

**降级**：缓存条目缺 `facts` 的会话在筛选时**不参与**，并且条件栏下方常显一行 `已索引 213/240 个会话`——不把「还没索引」伪装成「不匹配」。

### 2.5 G1 的收起行 20px 太低

`--control-h-sm` 是 24px，全站最小可点击高度就是它（正文 `--fs-xs` 16px 行高 + 上下各 4）。20px 会让这一行成为全站唯一低于 24 的可点目标，键盘与触摸都吃亏。

**裁决**：收起行 **24px**，与 `--control-h-sm` 对齐；成本比派工多 4px/行。

### 2.6 G7 的挂载点

「上下文出血点」在**会话页**（`BleedView`），吃的是单会话 `parsed`；G7 要的是**窗口内所有会话**的 `contextTokens` 峰值分位数。会话页拿不到跨会话数据。

**裁决**：落在用量档 **「压缩（上下文重置）」卡底部**一行（那一条横向叙事本来就是讲上下文水位的），20px + 上方一条发丝线，不进 panel header、不新增卡片、不新增整行。

替代方案（若你要保留「出血点」字面）：在会话页 `BleedView` 底部加**本会话**的分位数（事件级 contextTokens 分布）。语义也成立，但就不是 issue 写的「窗口内所有会话」了。

---

## 3 全局几何与预算

### 3.1 宽度账（三档）

| 档 | 主区宽 | 页面内距 | 可用宽 | board 单列 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1440 | 1440 − 300 = 1140 | 24 | 1116 | (1116 − 12) / 2 = 552 | 基准 |
| 1280 | 1280 − 300 = 980 | 24 | 956 | 472 | 无换档 |
| 960（应用最窄） | 960 − 300 = 660 | 24 | 636 | 312 | G4 的 12 张 88px 卡必然横滚（12×88 + 11×8 = 1144 > 636） |

### 3.2 高度账（1440×900，100% 字号）

只算本轮**净增**：

| 功能 | 净增 | 备注 |
| --- | --- | --- |
| G1 工作日志 | **+24 × 有记录天数**（7 天档最多 168，典型 5 天 = 120） | 全部收起；展开某天时再加 ≤160 |
| G7 分位数行 | **+20** | 卡底一行 |
| G8 季节条 | **+22 / 卡行** | 6px 条 + 4 + 11px 文字 + 上距 1 |
| G2 筛选栏 | 侧栏 **+28**（收起） | 与工具栏同高系列 |
| G4 月报 | 年报档 **+130**（16 标题 + 8 上距 + 106 卡） | 年报档本来就在滚，不进首屏账 |
| G5 / G6 | **±0** | 档位切换，不叠加 |
| G9 | 对比卡 **+96**（16 标题 + 8 上距 + 3 × 24 行） | 半宽卡 |
| G10 | **0**（浮层） | 不占文档流 |
| G3 | **0**（浮层） | 同上 |

用量档首屏净增 = G1（典型 120）+ G7（20）= **140px**，低于既有「单个正文块 ≤400px」的惯例上限；最坏 168 + 20 = 188，仍在限内。

### 3.3 横向账（960 窄窗风险点）

- G3 若改页头按钮：`.actions` 现有 3 键 ≈ 108 + 96 + 72 = 276，加「导出档案」≈ +96 → 372；960 下标题区可用 ≈ 636 − 项目 chip(≈180) − 时间 chip(≈80) = 376。**刚好溢出**，这就是 §2.2 选对话框的理由。
- G4 迷你卡横滚：滚动容器 `overflow-x: auto`，卡片 `flex: 0 0 88px`，**不换行**。
- G2 六条件网格：侧栏 300 − 24 内距 = 276，2 列 × 132 + 12 间距 = 276。每个控件 132px 宽，够放下「上下文峰值 ≥ 150000」这种值。

### 3.4 间距 / 字号 / 圆角 / 描边（全部既有令牌）

| 用途 | 令牌 | 值 |
| --- | --- | --- |
| 面板体距 | `--sp-3` | 12 |
| 行内元素间距 | `--sp-1` / `--sp-2` | 4 / 8 |
| 区块之间 | `--sp-3` | 12 |
| 正文 / 标签 / 脚注 | `--fs-sm` / `--fs-xs` / `--fs-xs` | 12·18 / 11·16 / 11·16 |
| 数值 | `--fs-md` + `tabular-nums` | 15·22 |
| 卡片圆角 | `--r-md` | 8 |
| 小控件圆角 | `--r-sm` | 4 |
| 描边 | `--border` / `--border-strong` | 1px |
| 控件高 | `--control-h-sm` / `--control-h` | 24 / 28 |

**零新增令牌**：本轮所有颜色都来自既有 `--cat-*`、`--chart-*-soft`、`--text-*`、`--bg-*`、`--border*`；十功能没有一个是新语义，因此没有新颜色。

---

## 4 逐功能规格

### G1 工作日志（StoryLog）

**挂载**：`UsageOverviewPage.tsx` 用量档，KPI 行（`:711` 之后）与 `WeeklyDigestPanel`（`:717`）之间。整行块，与 board 同级，**不进 board 的 2 列网格**（它是时间叙事，半宽会折行）。

**形态**：日行序列，不是表格、不是卡片网格。理由：这一块的读法是「顺着日子往下看」，纵向序列才是它的形状。

```html
<section class="story" data-probe="story-log" aria-label="工作日志">
  <header class="storyHead">
    <h2 class="storyTitle">工作日志</h2>
    <span class="storyScope">最近 7 天 · 每天一行，点开看当天会话</span>
    <span class="storyCount">7 天里有 5 天在干活</span>
  </header>
  <ul class="days">
    <li class="day" data-probe="story-day" data-open="true">
      <button class="dayRow" aria-expanded="true" aria-controls="story-body-0"
              data-probe="story-day-row">
        <span class="date">10-31 周五</span>
        <span class="stat"><b>4</b> 会话</span>
        <span class="stat"><b>3</b> 项目</span>
        <span class="stat"><b>1.2M</b> tok</span>
        <span class="stat">最忙 <b>14:00</b></span>
        <span class="chev" aria-hidden="true"></span>
      </button>
      <div class="dayBody" id="story-body-0">
        <button class="sessionLine" data-probe="story-session">…</button>
      </div>
    </li>
  </ul>
</section>
```

**几何**

| 部位 | 值 |
| --- | --- |
| 块外距 | 与 board 同 12（页面 `gap: --sp-3` 已给） |
| 头部行 | 22 = `--lh-md`（标题 `--fs-base`/600） |
| 日行高 | **24**（`--control-h-sm`），内距 `0 var(--sp-2)` |
| 日行分栏 | 日期 88 固定（`tabular-nums`）→ 四个 stat `flex: 1 1 auto` gap 12 → 箭头 10 |
| 展开区 | `max-height: 160px; overflow-y: auto`，内部每行 24 |
| 行间分隔 | `border-top: 1px var(--border)`，首行无 |
| 默认展开 | **全部收起**：首屏只多「有记录天数 × 24」（7 天档最多 168）；今天那行左侧加 2px `--accent` 竖条标记，靠标记而不靠自动展开吸引注意 |

**文案（原文）**

| 场景 | 文案 |
| --- | --- |
| 头部副标 | `最近 7 天 · 每天一行，点开看当天会话` |
| 头部右标 | `7 天里有 5 天在干活`（有记录天数 / 总天数） |
| 当天无 token 读数 | stat 位印 `— tok`，`title="当天记录没有 usage 字段"` |
| 无最忙时刻（不足 1 事件） | `最忙 —` |
| 全天无会话 | 该日**不出一行**（不是印 0 行），头部右标里计入「没干活」 |
| 整窗无记录 | 整块换 `EmptyState`：`最近 7 天没有会话记录` / `工作日志按本机日志现算，扫描过后才有内容。` |

**probe**：`story-log`（块）、`story-day`（日行容器）、`story-day-row`（可点行）、`story-session`（展开区里的会话行）。

**无障碍**：日行是真 `<button aria-expanded aria-controls>`；展开区 `role="region"`（隐式）+ `aria-label="<日期> 的会话"`；`<ul>/<li>` 保留列表语义，读屏能报「第 3 项，共 7 项」。

---

### G2 会话筛选器（Session Query）

**挂载**：`SessionList.tsx`，`SegmentedControl`（`:369`）之后、错误/骨架之前。

**形状**：条件栏是侧栏里的**第二层过滤器**——上面那层是文字搜索（已有），这一层是结构化条件。两层 AND。

```html
<div class="query" data-probe="session-query">
  <button class="queryHead" aria-expanded="false" aria-controls="query-body"
          data-probe="session-query-toggle">
    <span class="queryLabel">筛选会话</span>
    <span class="queryCount" hidden>3</span>        <!-- 生效条件数 -->
    <span class="chev" aria-hidden="true"></span>
  </button>
  <div class="queryBody" id="query-body" data-probe="session-query-body">
    <label class="field"><span>项目</span><select>…</select></label>
    <label class="field"><span>模型</span><select>…</select></label>
    <label class="field"><span>上下文峰值</span><select>…</select></label>
    <label class="field"><span>工具</span><select>…</select></label>
    <label class="field"><span>错误</span><select>…</select></label>
    <label class="field"><span>时长</span><select>…</select></label>
    <div class="queryFoot">
      <span class="indexNote">已索引 213/240 个会话</span>
      <button class="clear">清空</button>
    </div>
  </div>
</div>
```

**六条件的控件形态与取值**（全部下拉，不用自由输入——条件要可枚举，输入框只会制造拼写不匹配）

| # | 条件 | 控件 | 选项（原文） |
| --- | --- | --- | --- |
| 1 | 项目 | `<select>` | `全部项目` + 各 `projectLabel` 的去重项（按会话数降序，最多 40 项，超出末尾 `更多项目…` 展开） |
| 2 | 模型 | `<select>` | `全部模型` + 窗口内出现过的模型（`formatModelId`） |
| 3 | 上下文峰值 | `<select>` | `不限` / `≥ 50k` / `≥ 100k` / `≥ 150k` / `≥ 200k` |
| 4 | 工具 | `<select>` | `不限` + 工具名（按调用次数降序，前 40） |
| 5 | 错误 | `<select>` | `不限` / `有失败` / `无失败` |
| 6 | 时长 | `<select>` | `不限` / `≥ 10 分钟` / `≥ 30 分钟` / `≥ 1 小时` |

**几何**

| 部位 | 值 |
| --- | --- |
| 收起行 | **28**（`--control-h`），内距 `0 var(--sp-3)`，下边框 `--border` |
| 展开体 | 上距 8 + 3 行 × 28 + 2 × 8 行距 + 脚行 24 + 下距 8 = **140** |
| 网格 | 2 列 × 132（276 宽 − 12 间距） |
| 控件 | 原生 `select`，`height: var(--control-h-sm)`，`font-size: var(--fs-xs)` |
| 脚行 | 左「已索引」11px `--text-tertiary`，右「清空」`<Button>` |

**行为**

- 任一条件变更 → 立即过滤（不做「应用」按钮：多一个按钮就多一次「我改了你没反应」）。
- 条件之间 **AND**；同一条件内部单选。
- 生效条件数 > 0 时，收起行右侧出现数字徽标（`--accent-soft` 底 + `--accent` 字，11px，圆角 2）。
- 「清空」只在有条件时可用，一次清六个。

**空态（这一条必须写死，否则用户会以为列表坏了）**

列表区在有条件时不再用既有那句「没有匹配的会话 / 调整搜索词后重试。」——那句话只说搜索，会让用户去改搜索词。改为：

```
没有符合全部条件的会话
试试去掉一个条件，或清空全部筛选。
[清空 3 个条件]
```

- 标题 `--fs-base`/600 `--text`；说明 `--fs-xs` `--text-tertiary`；按钮 `<Button variant="secondary">`。
- 若同时有搜索词，说明改成：`搜索词「abc」与 3 个筛选条件同时生效。`——**先告诉用户是两层一起卡住的**，这是这类空态最常见的误判。

**索引未完成（降级）**：`已索引 213/240 个会话` 常显；未索引的会话**不参与匹配**，且不显示成「不匹配」。全部未索引时条件栏整体禁用，收起行文案变 `筛选需要先建立索引…`。

**probe**：`session-query`、`session-query-toggle`、`session-query-body`、`session-query-clear`、`session-query-index-note`。

---

### G3 会话档案（Markdown）

**挂载**：`ExportDialog` 格式档第三项 `档案 Markdown`（见 §2.2）。`exportPayload.ts` 里新增 `buildArchive(input): { fileName, contents }`。

**模板（原文，占位符用 `{}`）**

```markdown
# 会话档案 · {标题}

- 会话 ID：{sessionId}
- 项目：{projectLabel}          <!-- 绝不出现绝对路径 -->
- 分支：{gitBranch}             <!-- 缺失写「未记录」 -->
- 开始：{yyyy-MM-dd HH:mm} · 结束：{…} · 墙钟跨度：{Xh Ym}
- 记录数：{n}（用户 {a} / 模型 {b} / 工具 {c} / 子 agent {d} / 压缩 {e}）
- 模型：{model1}（{pct}%）、{model2}（{pct}%）
- token：输入 {in} · 输出 {out} · 缓存写 {cw} · 缓存读 {cr} · 合计 {total}
- 成本：{usd 或「定价未知」}   <!-- 未知时附「{n} 条调用未定价，未计入」 -->
- 失败：{n} 次（涉及工具：{t1}×{k}、{t2}×{k}）

## 工具清单
| 工具 | 调用 | 失败 | 平均耗时 |
| --- | --- | --- | --- |

## 时间线摘要
| 时刻 | 类型 | 摘要 | 耗时 |
| --- | --- | --- | --- |

（末行）本档案由 CC Analyzer 于 {yyyy-MM-dd HH:mm} 生成；不含会话内容，仅统计与摘要。
```

**内容边界（隐私红线，写进实现注释与测试）**

| 进档案 | 不进档案 |
| --- | --- |
| 会话 ID、projectLabel、gitBranch | 任何消息正文 / thinking / 工具入参与返回 |
| 计数、token 四类、成本、失败数 | 绝对路径（`cwd`、`/Users/…`） |
| 工具名与调用次数 | 用户提示词原文 |
| 时间线**摘要**（既有 `LogRow.summary`，已截断 72 字且剥离 ANSI） | 会话标题里的自定义文本？**进**（标题是用户自己起的，属元信息） |

时间线摘要最多 200 行，超出写 `…共 {n} 行，仅列前 200 行`。

**文件名**：`cca-session-{sessionId 前 8 位}-{yyyy-MM-dd}.md`。sessionId 缺失时用 `{projectLabel}-{日期}.md`。

**空态**：解析中不渲染「导出」按钮（既有行为），因此档案选项也不可达；会话为空（0 记录）时选项可见但禁用，`title="这个会话没有记录，档案会是空的"`。

**probe**：`export-format`（既有容器）、`export-archive-note`。

---

### G4 用量月报（年报档内「逐月」）

**挂载**：`AnnualReportPanel` 的 `data-probe="year-report"` 内、6 张卡之后、面板脚注之前。

**形态**：12 张 88px 迷你卡横滚。为什么不做 12 列网格：960 下 12 列每列只有 48px，日期标签放不下；横滚保住每卡可读。

```html
<section class="months" aria-label="逐月用量" data-probe="year-months">
  <h3 class="monthsTitle">逐月</h3>
  <ol class="monthStrip">
    <li><button class="monthCard" data-probe="month-card" data-month="1">
      <span class="mLabel">1 月</span>
      <span class="mTokens">1.2M</span>
      <span class="mBar" aria-hidden="true"><i style="height:64%"></i></span>
      <span class="mMeta">活跃 12 天</span>
    </button></li>
    …
  </ol>
</section>
```

**几何**

| 部位 | 值 |
| --- | --- |
| 区块上距 | 12（与 6 卡间隔） |
| 标题 | 11px / `--text-tertiary` / 600，行高 16 |
| 卡片 | `flex: 0 0 88px`，内距 8，圆角 `--r-sm`，边框 `--border` |
| 卡内行 | 标签 11/16 → 数值 12/18（`tabular`）→ 竖条 32 高 → 脚 11/16 |
| 条 | 宽 6，`--chart-1-soft` 底 + `--chart-1` 实色；高度 = 该月 token / 全年最大月 token |
| 横滚 | `overflow-x: auto`，`gap: 8`，滚动条 10（`--scrollbar-size`） |
| 整块高 | **130** = 16 标题 + 8 上距 + 106 卡（卡 = 8 上距 + 16 标签 + 18 数值 + 4 + 32 条 + 4 + 16 脚 + 8 下距） |

**空态**：全年 0 记录时整块不渲染（年报本身已有「这一年没有记录」的整卡空态，再叠一个空横滚条是噪音）。某月 0 记录时该月卡仍在，数值印 `0`、条高 0、`mMeta` 印 `无记录`——12 个月连续是「一年」的形状，缺月会让人以为数据丢了。

**下钻**：点月 → `onDrillMonth(monthStart)` → 切到 `usage` 档并把「按日趋势」的选中日设为**该月 token 最高的那一天**；同时 `notify` 一句 `已跳到 {yyyy-MM-dd}（{N} 月最活跃的一天）`。

> 为什么不是「切到整月区间」：区间控件只有 7/30/90/年 四档（`--` 见 `UsageOverviewPage` 的 range 控件），硬造一个「自定义区间」会牵动聚合层与所有面板的空态口径，超出本轮。

**probe**：`year-months`、`month-card`（带 `data-month`）。

---

### G5 错误档案（错误档第二档）

**挂载**：`ErrorOverviewSection` 顶部加 `SegmentedControl`（`ariaLabel="错误视图"`，两项 `时间线` / `档案`），值存组件内 state（不进 localStorage——档位是看当下，不是偏好）。

```html
<div class="errorTabs"><SegmentedControl items={[时间线, 档案]} /></div>
{mode === "timeline" ? <现状原样/> : <ErrorArchive events={stats.events} />}
```

**档案档形态**：一行一类，可展开。

```html
<div data-probe="error-archive">
  <table>
    <caption class="srOnly">错误档案：按工具与错误签名聚类</caption>
    <thead><tr><th>工具</th><th>签名</th><th>次数</th><th>会话</th><th>首末</th><th>展开</th></tr></thead>
    <tbody>
      <tr data-probe="archive-row" aria-expanded="false">
        <td>Bash</td><td>exit code 127</td><td>9</td><td>4</td>
        <td>10-29 09:12 – 10-31 15:40</td>
        <td><button aria-label="展开 Bash exit code 127 的档案">…</button></td>
      </tr>
      <tr class="detail"><td colspan="6">   <!-- 展开后 -->
        <p class="rep">代表消息：<code>bash: foo: command not found</code></p>
        <ul class="sessions">…（最多 5 个会话，可点跳转）…</ul>
      </td></tr>
    </tbody>
  </table>
</div>
```

**几何**：表格行 30（既有 `--row-h` 系列口径：`2×6 + 18`）；展开区最大 160，超出内部滚动；「信号」列宽 1fr，其余 88/56/56/140/44。

**排序**：次数降序 → 首末时间升序（并列时更早的在前，与既有「并列取更早」口径一致）。

**空态**：窗口内 0 错误时，档案档不出表格，印与时间线一致的整卡事实文字（复用 `:257` 那句），**不印空表头**。

**与时间线的关系**：两档吃同一份 `stats.events`；时间线档保留现有聚类面板不动（用户已经学会它在哪），档案档是它的「展开版」。

**probe**：`error-view-tabs`、`error-archive`、`archive-row`、`archive-detail`。

---

### G6 工具月历（工具普查第 3 档）

**挂载**：`ToolCensusPanel.tsx:248` 的 `SegmentedControl` 加第三项 `{ value: "months", label: "按月" }`（顺序：调用次数 | 健康 | 按月）。

**形态**：每工具一行，右侧 12 根迷你竖条（1–12 月）。回答的问题是「这个工具是这季度新用的，还是上季度就弃了」。

```html
<div data-probe="tool-months">
  <table class="months">
    <caption class="srOnly">工具月历：每个工具 1–12 月的调用次数</caption>
    <thead><tr><th>工具</th><th aria-hidden="true">1…12 月</th><th>合计</th><th>趋势</th></tr></thead>
    <tbody>
      <tr data-probe="tool-month-row">
        <th scope="row">Bash</th>
        <td><span class="bar" style="height:18px" title="3 月 124 次"></span>…</td>
        <td class="num">1,284</td>
        <td class="trend">近 3 月 ↑</td>
      </tr>
    </tbody>
  </table>
</div>
```

**几何**：行 34（条区 24 + 上下 5）；每根条宽 6、间距 4 → 12 根占 116；条高 = 该月次数 / 该工具 12 月最大值 × 24（最小 2，0 次留空槽不画条）；表头月份数字 9px（`--fs-xs` 的 0.8 倍？**不允许**——用 `--fs-xs` 11px，标题行高 16）。

> 说明：9px 不是档位内的字号。月份标签用 `--fs-xs`，宽度靠「1 2 3 …」单字符 + 6px 条居中即可。

**趋势列**：`近 3 月 ↑` / `近 3 月 ↓` / `持平` / `—`（不足 6 个月数据）。判据写死在文档里：前 6 月均值 vs 后 3 月均值，相对变化 > 30% 才算 ↑/↓。

**空态**：空窗口复用既有 `本窗口没有工具调用记录`；某工具某月为 0 时**留空槽**（画 1px `--border` 底槽），不画 0 高条——0 与「没有这一格」必须看得出区别。

**probe**：`tool-months`、`tool-month-row`。

---

### G7 上下文分位数（压缩卡底部一行）

**挂载**：`CompactionStatsPanel` 的 `Panel` 体末尾，一条 20px 读数行 + 上方 `1px var(--border)`。

```html
<div class="quantiles" data-probe="ctx-quantiles" aria-label="会话上下文峰值分位数">
  <span class="qLabel">会话上下文峰值</span>
  <span class="qItem"><span class="qKey">P50</span><span class="qVal">42.1k</span></span>
  <span class="qItem"><span class="qKey">P75</span><span class="qVal">88.4k</span></span>
  <span class="qItem"><span class="qKey">P90</span><span class="qVal">131k</span></span>
  <span class="qItem"><span class="qKey">P99</span><span class="qVal">178k</span></span>
  <span class="qItem"><span class="qKey">最大</span><span class="qVal">196k</span></span>
</div>
```

**几何**：行高 20，标签 11px `--text-tertiary`，键 11px `--text-tertiary`，值 12px `--text-secondary` `tabular-nums`；五项 `gap: 12`；整行 `flex-wrap: wrap`（960 下可换第二行，不计入高度账的常态值）。

**分位数算法**：对窗口内每个会话取 `max(records[i].usage 的 contextTokens 递增序列)`——既有 `contextSeries` 已经算过，直接复用；再对「每会话峰值」数组做**线性插值分位数**（`idx = (n-1) * p`），n=1 时五个读数全等于该值并在行尾加 `title="窗口内只有 1 个会话"`。

**空态**：窗口内没有任何带 usage 的会话时，整行换成一句 11px `--text-tertiary`：`本窗口的会话没有上下文读数`（不印五个 0）。

**probe**：`ctx-quantiles`（行）、`ctx-q`（带 `data-q="p50|p75|p90|p99|max"`）。

---

### G8 项目季节（项目卡内追加）

**挂载**：`ProjectCardsPanel` 每张 `.card` 内部，`meta` 两行之后追加。

> ⚠️ 卡本体是 `<button>`（`:97`），**不能**在内部再加可聚焦控件。因此季节条是**纯展示**：图形 `aria-hidden`，文字进 `aria-label`（卡的可访问名末尾追加「，季节性：Q1 32%、Q2 41%、Q3 19%、Q4 8%」）。

```html
<span class="season" aria-hidden="true">
  <span class="seg" data-q="1" style="flex:32"></span>
  <span class="seg" data-q="2" style="flex:41"></span>
  <span class="seg" data-q="3" style="flex:19"></span>
  <span class="seg" data-q="4" style="flex:8"></span>
</span>
<span class="seasonText">Q2 最重（41%）</span>
```

**几何**：条高 **6**、圆角 1、段间 1px 缝（用 `gap: 1px` 与底色缝，不描边）；文字 11px `--text-tertiary`，行高 16；整块上距 4 → 卡净增高 **22**。

**配色**：四段用 `--chart-1..4` 的 **-soft** 填充 + 1px 实色描边（Round Z 已实测：`-soft` 单独填充在深色与高对比度下低于 3:1，必须叠实色描边）。四段**不用类别色**——季度是时间序号，不是记录类别。

**空态**：某季 0 token 时该段宽 0（不出缝、不出字），文字改 `Q2 最重（41%）· Q1 无记录`。四季全 0 时整块不渲染（该卡本来就没有 token）。

**probe**：`card-season`（条容器，`data-quarters="4"`）、`card-season-text`。

---

### G9 会话相似度（会话对比卡底部）

**挂载**：`SessionComparePanel` 的 `Panel` 体末尾（`pairs` 之后）。

```html
<section class="similar" data-probe="similar-sessions" aria-label="相似会话">
  <h3 class="similarTitle">与 A 最像的会话</h3>
  <ul>
    <li><button class="similarRow" data-probe="similar-row">
      <span class="pct">82%</span>
      <span class="name">cc-analyzer · 10-29 14:02</span>
      <span class="why">同项目 · 工具集重叠 7/9 · 同为 sonnet</span>
    </button></li>
    …
  </ul>
</section>
```

**四维 Jaccard**

| 维度 | 集合 | 权重 |
| --- | --- | --- |
| 项目 | `{projectLabel}` | 0.35（同项目几乎决定「像」） |
| 工具集 | 该会话用过的工具名集合 | 0.30 |
| 模型集 | 该会话出现过的模型 | 0.20 |
| 时长 | 量化到 15 分钟桶后的单元素集合（同桶 = 1） | 0.15 |

`相似度 = Σ wᵢ · Jᵢ`，取前三；`< 0.3` 的不推荐（宁缺勿滥，且要写原因）。

**推荐理由**：只写真正贡献了分的维度，最多三条，按权重降序。上面例子里「同为 sonnet」属于模型维。

**几何**：标题 16 + 上距 8 + 3 行 × 24 = **96**；行内三列 `56 / 1fr / 自动`，`pct` 用 `--fs-sm` 600 + `tabular`。

**空态**（三种，必须分开写）：

| 触发 | 文案 |
| --- | --- |
| 窗口内只有 1 个会话 | 整块不渲染（对比卡本身已有「只有 1 个会话」空态） |
| 有 ≥2 个但都 < 0.3 | `没有足够相似的会话（最高 28%）。` |
| 索引未完成 | `相似度需要完整的工具与模型清单，正在索引…` |

**probe**：`similar-sessions`、`similar-row`（带 `data-pct`）。

---

### G10 快照对比（浮层）

**挂载**：用量档页头，「导出快照」右侧新增 `<Button>对比快照</Button>`（`data-probe="snapshot-compare-open"`）。

**浮层**：沿用 `SearchPalette` / `ShortcutSheet` 的浮层语言（遮罩 `--overlay`、卡片 `--r-lg`、`--shadow-md`、`cca-enter`）。

- **z-index 130**（与速查卡同层，高于命令面板 120）。
- **Esc 归属**：浮层开着时 Esc 只关浮层，不退大屏、不关别的（沿用速查卡先例，`AppShell` 的 Esc 守卫要加这一层）。
- 焦点陷阱：`document` 捕获阶段监听 Tab，首尾回绕（同一份 `focusables` 写法）。

```html
<div class="backdrop">
  <div role="dialog" aria-modal="true" aria-labelledby="cmp-title" data-probe="snapshot-compare">
    <header><h2 id="cmp-title">对比两份用量快照</h2><IconButton label="关闭"/></header>
    <div class="pickers">
      <label class="pick"><span>快照 A（较早）</span>
        <input type="file" accept="application/json,.json" data-probe="snapshot-file-a"/>
      </label>
      <label class="pick"><span>快照 B（较晚）</span>
        <input type="file" accept="application/json,.json" data-probe="snapshot-file-b"/>
      </label>
    </div>
    <table class="diff">
      <thead><tr><th>指标</th><th>A</th><th>B</th><th>差值</th></tr></thead>
      <tbody>
        <tr data-probe="snapshot-diff-row" data-metric="tokens">
          <th scope="row">token</th><td>1.2M</td><td>1.5M</td><td class="delta up">+25.0%</td>
        </tr>
        …
      </tbody>
    </table>
    <p class="note">两份快照的区间不同不影响对比——表里比的是各自区间的合计，差值只说明「这两个区间差多少」。</p>
  </div>
</div>
```

**读入与校验（诚实优先级最高）**

1. 只接受 `schema === "cca.usage.snapshot"` 且 `version === 1`；否则该行就地红字 `这不是 CC Analyzer 的用量快照`（不猜、不尽力解析）。
2. 文件 > 4MB 拒绝：`快照文件超过 4MB，可能不是快照`。
3. JSON 解析失败：`文件不是合法 JSON（{错误首行}）`。
4. 两份都读到之后才出表；只有 A 时表里 B 列印 `—` 并提示 `再选一份快照 B`。

**指标行（固定 6 行，顺序固定）**：token 合计 / 消息数 / 会话数 / 活跃日 / 成本（未知时不参与，见下）/ 缓存读取占比。

**成本未知**：任一快照 `costUnknown > 0` 时，成本行的差值格印 `不可比（A 有 12 条未定价）`，**不印 $0.00 差值**。

**差值格式**：`+25.0%` / `−8.3%`（真减号 U+2212）/ `持平`（|Δ| < 0.05%）。涨用 `--danger`？**不**——涨不一定是坏事，用 `--text` 常规色 + 箭头符号 `▲▼` 表方向，颜色只跟前值对比度走。

**尺寸**：卡片 `min(640px, 100%)`，`max-height: min(720px, 84vh)`，内部滚动；表格行 28。

**空态**：未选文件时表格区是一句 12px `--text-tertiary`：`选两份快照文件开始对比。快照由「导出快照（JSON）」生成。`

**probe**：`snapshot-compare-open`、`snapshot-compare`、`snapshot-file-a`、`snapshot-file-b`、`snapshot-diff-row`、`snapshot-compare-close`。

---

## 5 隐私红线（G3 / G10 共同遵守）

| 允许 | 禁止 |
| --- | --- |
| 会话 ID（G3 文件名用前 8 位） | 会话正文、thinking、工具入参与返回 |
| `projectLabel`（编码目录名） | 绝对路径（`cwd`）与用户名 |
| 计数、token 四类、成本、失败数 | 用户提示词原文（G3 已排除） |
| 工具名、模型名 | 任何形式的会话 id 全量列表（G10 快照不含会话粒度） |

两条硬测试：G3 的 `buildArchive` 输出里 `expect(md).not.toContain("/Users/")`；G10 的 `toSnapshotJson` 输出里 `expect(json).not.toMatch(/Users\//)`。

---

## 6 令牌与对比度

**新增令牌：0。** 十功能没有引入任何新语义，全部落在既有词汇：

| 用途 | 令牌 |
| --- | --- |
| 面板/卡片底 | `--bg-subtle`、`--bg-elevated` |
| 分隔线 | `--border`；强调分隔 `--border-strong` |
| 正文 / 次要 / 标签 | `--text`、`--text-secondary`、`--text-tertiary` |
| 图形编码（季度/月份条） | `--chart-1..4` + `-soft` |
| 生效条件徽标 | `--accent-soft` 底 + `--accent` 字 |
| 错误态 | `--danger`（只给确定失败） |
| 「未索引/不可比」 | `--warning`（非确定信息，不冒充 0） |

**对比度（沿用 Round Z/EE 实测，不重算）**

| 组合 | 浅 | 深 | HC 浅 | HC 深 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `--text` / `--bg-subtle` | 17.79 | 16.15 | 21.00 | 18.73 | 正文主路径 |
| `--text-secondary` / `--bg-subtle` | 7.87 | 9.44 | 14.34 | 13.66 | 读数与说明 |
| `--text-tertiary` / `--bg-subtle` | **4.78** | 5.83 | 10.45 | 10.74 | 标签最低值，仍 > 4.5 |
| `--chart-N` / `--bg-subtle` | 5.64 起 | 8.39 起 | 7.82 起 | 8.90 起 | 条描边 |
| `--chart-1-soft` 复合 vs `--bg-subtle` | 4.16 | **2.68** | 3.18 | **2.60** | **低于 3:1** → 必须叠 1px 实色描边 |

> 因此 G4/G6/G8 的条一律「`-soft` 填充 + 1px `--chart-N` 描边」，与 Round Z 监控台轨道同一处理。
> 另：`--border-strong` 做轨道在普通浅色下只有 **1.59**，**不得**用于任何承载信息的图形边线；分隔线用它只是装饰，不承载信息。

---

## 7 无障碍

### 7.1 Tab 序（每块只进一个 Tab 位，除非它本身是列表）

| 位置 | 顺序 |
| --- | --- |
| G1 | 头部（无焦点）→ 每个日行按钮（7 个）→ 展开区里的会话行 |
| G2 | 收起/展开按钮 → 六个 `<select>` → 清空 → 列表 |
| G3 | 沿用 ExportDialog 既有环 |
| G4 | 12 张月卡按钮（左右方向键在卡间移动，见 7.2） |
| G5 | 档位切换（SegmentedControl 一个 Tab）→ 每行的展开按钮 |
| G6 | 沿用 SegmentedControl |
| G7 | 不可聚焦（纯读数） |
| G8 | 不可聚焦（卡是按钮，季节是装饰） |
| G9 | 3 个相似会话行 |
| G10 | 打开按钮 → 浮层内：文件 A → 文件 B → 关闭 |

### 7.2 键盘

| 键 | 在哪 | 行为 |
| --- | --- | --- |
| `Enter` / `Space` | G1 日行、G5 展开、G9 行 | 展开/跳转 |
| `←` / `→` | G4 月卡组 | 焦点在卡间移动（`role="list"` + roving tabindex） |
| `Esc` | G10 浮层 | 关浮层，焦点回「对比快照」按钮 |
| `Tab` | G10 浮层 | 卡内回绕 |

**不绑定全局键**：本轮不新增任何 window 级快捷键（`?`、`⌘K`、`/` 都已被占用或语义冲突），避免第五批再抢键。

### 7.3 aria

- G1：`<ul>` 列表 + 每行 `<button aria-expanded aria-controls>`；展开区 `aria-label="<日期> 的会话"`。
- G2：条件栏 `<button aria-expanded aria-controls>`；六个 `<label>` 各自包住 `<select>`，`<span>` 即标签文字（不另加 `aria-label`，避免两套名字打架）；生效数徽标 `aria-label="已生效 3 个条件"`。
- G5：`<table><caption class="srOnly">`，展开按钮 `aria-expanded`；`th scope="col"` / `th scope="row"`。
- G7：容器 `role="group" aria-label="会话上下文峰值分位数"`，每项读作「P50 42.1k」。
- G8：图形 `aria-hidden="true"`，卡的可访问名里追加季节文字——**颜色与形状都不是唯一编码**，读屏拿得到同一句话。
- G10：`role="dialog" aria-modal="true"`；错误行 `role="alert"`。

### 7.4 颜色不是唯一编码（逐条证据）

| 功能 | 第二通道 |
| --- | --- |
| G4/G6/G8 条 | 高度（长度）本身就是量；`title`/`aria-label` 给数字 |
| G5 档案 | 次数与首末时间是文字 |
| G2 生效条件 | 数字徽标 + 展开后 `<select>` 的当前值 |
| G10 差值 | 方向靠 `▲▼` 与正负号，不靠红绿 |
| G1 展开态 | `aria-expanded` + 箭头旋转 + 行底 `--bg-hover` |

---

## 8 状态矩阵（逐格给文案）

| 功能 | 空 | 加载 | 失败 | 极值 / 特殊 |
| --- | --- | --- | --- | --- |
| G1 | `最近 7 天没有会话记录` / `工作日志按本机日志现算，扫描过后才有内容。` | 头部右标 `正在整理…` | 不单列错误（随用量页整页 `ErrorState`） | 单日 0 token → `— tok`；单事件日 → `最忙 —` |
| G2 | `没有符合全部条件的会话` / `试试去掉一个条件，或清空全部筛选。` + `清空 N 个条件` | 收起行 `筛选需要先建立索引…`（全未索引） | 索引中断 → 脚行 `索引中断，{n} 个会话未参与筛选` | 全部条件是「不限」→ 徽标不显示 |
| G3 | 0 记录时选项禁用 + `title="这个会话没有记录，档案会是空的"` | 解析中按钮不渲染（既有） | `导出失败：{原因}` 就地 `role="alert"` | 成本未知 → `定价未知（{n} 条未计入）` |
| G4 | 全年 0 记录 → 整块不渲染 | 年报本身有加载态 | 同上 | 某月 0 → 卡仍在、`无记录`；单月独占全年 → 条 100% |
| G5 | 0 错误 → 复用既有整卡事实文字，不出空表 | 随错误档 | 同上 | 某类只发生 1 次 → 首末同一时刻印一个时刻 |
| G6 | `本窗口没有工具调用记录` | 随工具普查 | 同上 | 某月 0 → 留 1px 底槽；只有 1 个月 → 其余 11 格留槽 |
| G7 | `本窗口的会话没有上下文读数` | — | — | n=1 → 五个读数相同 + `title` 说明 |
| G8 | 四季全 0 → 整块不渲染 | — | — | 某季 0 → 段宽 0 + 文字说明；单季 100% → 整条一段 |
| G9 | `< 0.3` → `没有足够相似的会话（最高 28%）。` | `相似度需要完整的工具与模型清单，正在索引…` | — | 只有 1 会话 → 整块不渲染 |
| G10 | `选两份快照文件开始对比。快照由「导出快照（JSON）」生成。` | 读文件中 | `这不是 CC Analyzer 的用量快照` / `文件不是合法 JSON（…）` / `快照文件超过 4MB，可能不是快照` | 成本未知 → `不可比（A 有 12 条未定价）` |

---

## 9 data-probe 锚点清单

| 功能 | 锚点 | 断言什么 |
| --- | --- | --- |
| G1 | `story-log` / `story-day` / `story-day-row` / `story-session` | 日行数 = 有记录天数；点行后 `aria-expanded` 翻转 |
| G2 | `session-query` / `session-query-toggle` / `session-query-body` / `session-query-clear` / `session-query-index-note` | 选一个条件后列表行数下降；清空后恢复 |
| G3 | `export-format` / `export-archive-note` | 选「档案」后作用域控件消失、note 出现 |
| G4 | `year-months` / `month-card[data-month]` | 12 张卡；点 3 月后 `cca-usage-view` = `usage` |
| G5 | `error-view-tabs` / `error-archive` / `archive-row` / `archive-detail` | 档案档表格行数 = 聚类数；展开后 detail 出现 |
| G6 | `tool-months` / `tool-month-row` | 每行 12 根条 |
| G7 | `ctx-quantiles` / `ctx-q[data-q]` | 五个读数、P50 ≤ P75 ≤ P90 ≤ P99 ≤ 最大 |
| G8 | `card-season[data-quarters="4"]` / `card-season-text` | 每卡四段；文字含季节名 |
| G9 | `similar-sessions` / `similar-row[data-pct]` | ≤3 行；`data-pct` 降序 |
| G10 | `snapshot-compare-open` / `snapshot-compare` / `snapshot-file-a` / `snapshot-file-b` / `snapshot-diff-row` / `snapshot-compare-close` | 两份文件选完后 6 行差值表；Esc 关闭 |

---

## 10 focusRing 预估增量

| 新增焦点环 | 数量 | 偏移 |
| --- | --- | --- |
| G1 日行按钮（全宽行，`overflow-y` 容器内 → 负偏移） | +1 | `--focus-ring-inset` |
| G2 收起/展开按钮（全宽行） | +1 | `--focus-ring-inset` |
| G4 月卡按钮（88px 小目标，正偏移不会被裁） | +1 | `--focus-ring-offset` |
| G5 档案行展开按钮（44px 格） | +1 | `--focus-ring-offset` |
| G9 相似会话行（半宽卡内全宽行） | +1 | `--focus-ring-inset` |
| G10 打开按钮 + 浮层关闭按钮 | +2 | 复用 `<Button>` / `<IconButton>` 的既有环，**不计新增** |
| G2 六个 `<select>` | +1（一条 `select:focus-visible` 规则覆盖六个） | `--focus-ring-offset` |

合计：**新增 6 条 `outline` 规则，其中 3 条用 `--focus-ring-inset`**。落地后必须重新 grep 定数（`focusRing.test.ts` 的计数是工作区快照，别照抄本表）。

---

## 11 明确不做

1. 不做自定义时间区间（G4 下钻只到「该月最活跃的一天」）。
2. 不做筛选条件的保存/命名预设。
3. 不做跨窗口（多天 vs 多天）对比，G10 只比两份快照的区间合计。
4. 不做档案的 HTML/PDF 版本（Markdown 是给人看的最小充分格式）。
5. 不做 G2 的正则/文本条件（文本搜索已有独立入口）。
6. 不做相似度的可调权重面板（四维权重写死，写进文档与注释）。
7. 不新增任何全局快捷键。
8. 不做季节条的数据导出（G3 档案不含季节明细，避免档案再长一节）。

---

## 12 实现者清单

| 顺序 | 文件 | 动作 |
| --- | --- | --- |
| 1 | `web/src/features/usage/storyLog.ts` + `.test.ts` | 新建：按自然日聚合（会话/项目/token/最忙小时） |
| 2 | `web/src/features/usage/StoryLogPanel.tsx` + `.module.css` + `.test.tsx` | 新建：G1 |
| 3 | `UsageOverviewPage.tsx` | G1 挂载（KPI 与周战报之间） |
| 4 | `web/src/features/sessions/sessionQuery.ts` + `.test.ts` | 新建：六条件 + 事实索引 |
| 5 | `metadataCache.ts` | `version: 2 → 3`，条目加 `facts` |
| 6 | `web/src/features/sessions/SessionQueryBar.tsx` + `.module.css` + `.test.tsx` | 新建：G2 |
| 7 | `SessionList.tsx` | 挂条件栏 + 空态分支 |
| 8 | `web/src/features/sessions/sessionArchive.ts` + `.test.ts` | 新建：G3 的 Markdown |
| 9 | `ExportDialog.tsx` / `exportPayload.ts` | 第三格式 |
| 10 | `web/src/features/usage/monthReport.ts` + `.test.ts` | 新建：G4 逐月聚合 |
| 11 | `AnnualReportPanel.tsx` | 追加逐月区 + `onDrillMonth` |
| 12 | `UsageOverviewPage.tsx` | `onDrillMonth` 接线（切档 + 选中日） |
| 13 | `errorArchive.ts` + `ErrorArchivePanel.tsx` + `.module.css` + `.test.tsx` | 新建：G5 |
| 14 | `ErrorOverviewSection.tsx` | 档位切换 |
| 15 | `toolMonths.ts` + `ToolCensusPanel.tsx` | G6 |
| 16 | `contextQuantiles.ts` + `CompactionStatsPanel.tsx` | G7 |
| 17 | `projectSeason.ts` + `ProjectCardsPanel.tsx` | G8 |
| 18 | `sessionSimilarity.ts` + `SessionComparePanel.tsx` | G9 |
| 19 | `usageSnapshotJson.ts` + `SnapshotCompareDialog.tsx` + `.module.css` + `.test.tsx` | 新建：G10 |
| 20 | `UsageOverviewPage.tsx` | 导出 JSON 选项 + 对比按钮 + 浮层 |
| 21 | `AppShell.tsx` | Esc 守卫认出第三层浮层（若浮层渲染在用量页内则不需要） |

### 请主会话独立复核的三处

1. **G2 的缓存版本升级**：`metadataCache` 从 v2 升 v3 会让所有用户首次打开重建一次索引——确认这条成本可接受、且 `version` 不匹配时是「重建」而不是「报错」。
2. **G7 的挂载点**（§2.6）：我把「窗口内分位数」放在用量档压缩卡底部，会话页 `BleedView` 未改。若你要的是「出血点页里的本会话分位数」，这是另一套数据，需要改这一条。
3. **G10 的 JSON 快照格式**：这是本批唯一新增的文件格式，且要长期兼容（`schema + version`）。确认字段清单足够（6 个指标 + 区间 + 导出时间）后，我再让实现者补 `version: 1` 的写入测试。

---

## 13 裁决落档（Lead 已批准，2026-10-31）

§2 的六条全部批准，逐条落定如下。本节是**实现契约**，与本文件前面的「待拍板」措辞冲突时以本节为准。

| # | 最终裁决 | 落地要点 |
| --- | --- | --- |
| 1 | G5 两档 | 错误档「时间线 / 档案」；档案 = 聚类详版独占整档，吃同一份 `stats.events`；**旧的内嵌聚类块不保留**（同一档里不出现两张同义表） |
| 2 | G3 走 ExportDialog 第三格式 | 格式档第三项「档案」；选中时**隐藏范围控件**，原位显示「只含统计与时间线摘要，不含消息内容与文件路径」；页头不加第 4 个按钮 |
| 3 | G10 JSON v1 | `schema: "cca.usage.snapshot"`、`version: 1`；字段 = token 四类 + 消息数 + 会话数 + 区间 + 导出时间；**估算成本不进 v1**（跨快照价目对不上，宁缺毋滥）；只认 schema + version，不认识就拒收「不是本应用导出的快照数据」 |
| 4 | G2 缓存 v2 → v3 | 版本不匹配走**重建**而不是报错；重建走后台增量、复用标题补全的进度通道，不阻塞首屏；未索引会话不参与筛选且常显「已索引 N/M」，不许伪装成「不匹配」 |
| 5 | G1 收起行 24px | 按 `--control-h-sm` |
| 6 | G7 落用量档压缩卡底 | `BleedView` 不改；一行 20px + 发丝线；面板标题维持「压缩（上下文重置）」；读数字样写**「会话上下文峰值分位」**，避免语义漂移 |

### 13.1 第三层浮层的 Esc 归属（结论）

`SnapshotCompareDialog` 渲染在**用量页根部**（`position: fixed`，页面链路上没有 transform/filter），Esc 由它自己在**捕获阶段** `stopPropagation + preventDefault` 消化，与 `ExportDialog` / `ShortcutSheet` 同一套写法。

**结论：`AppShell` 的 Esc 守卫不需要改。** 既有守卫只认识「命令面板 / 搜索 / 设置」三类自持开关的浮层，而本浮层在被 Esc 关掉时不会向上冒泡，守卫收到的下一个 Esc 已经属于「关掉浮层之后」的语义。

### 13.2 模型层归属（避免重复实现）

本批的八个纯逻辑模块（`storyLog` / `sessionQuery` / `monthlyReport` / `errorArchive` / `toolCalendar` / `contextQuantiles` / `sessionSimilarity` / `sessionArchive`）与 `snapshotCompare.ts` 由队友先行落地。因此 **G3 / G10 只做 UI 接线与写入器**，不重写任何模型层：

- G3 复用 `sessionArchive.buildSessionArchive(parsed)`；
- G10 复用 `snapshotCompare` 的 `USAGE_SNAPSHOT_SCHEMA` / `USAGE_SNAPSHOT_SCHEMA_VERSION` / `SNAPSHOT_METRICS` / `parseUsageSnapshot` / `compareUsageSnapshots`，新增的 `usageSnapshotJson.ts` 只负责**写入**与**严格版本闸门**（读方对版本是宽容的，闸门补上 v1 之外的拒收）。

> 一条留给评审的提醒：读方的 `parseUsageSnapshot` 接受任意正整数版本，而契约要求 `version !== 1` 即拒收。这条差异由闸门补上，**不要**反过来放宽闸门去迁就读方。

### 13.2b JSON 导出的入口位置（Lead 批准）

JSON 快照的**唯一入口在对比浮层内部**（脚注按钮「导出当前区间为 JSON」，`data-probe="snapshot-export-json"`），页头的「导出快照」保持单文件 HTML，不做下拉。

理由：需要 JSON 的人一定正站在对比浮层里（「我要比两份」→「可我没有 JSON」），那里给出口是零步；做成页头下拉反而先要用户知道菜单里有它。副作用是页头右簇不增加控件，960 窄窗的横向账不变。

### 13.3 交付与验证

| 项 | 结果 |
| --- | --- |
| `npx tsc -b --force` | 0 |
| `vitest run src/features/sessions src/features/usage` | 163 文件 / 1830 用例，全绿 |
| 新增焦点环 | 1 条（浮层里的原生 file input 换成本应用那一套），用 `--focus-ring-offset` |
| 新增令牌 | 0 |
| U+FFFD | 0 |
| 提交 | **未 commit**（按惯例留给主会话） |
