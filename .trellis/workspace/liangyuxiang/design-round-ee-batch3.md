# Round EE · 第三批十功能 · UI/UX 设计规格

**一句话定位**：这一批十个功能，九个是**往已有读数上加一层解释**，只有一个是真正的新页面（年报）——它们让「用量总览」从「这一窗口发生了什么」变成「我在往哪个方向去、哪一天出了事、数据有多新」。

作者：liangyuxiang。日期：2026-10-27。分支 `feat/v033-batch-ten-3`（已从 main `c400c13` 切出，工作区干净）。本文只写规格，不含实现。

**本轮顺序**：规格先行 → 主会话裁决 → 我实现 E5（CSV 导出）与 E8（速查卡）→ 其余八条由实现者按本文落地。

---

## 0 语境与现状（先把事实对齐）

### 0.1 十个功能来自 Issue #275（逐字）

| 编号 | 功能 | Issue 原文的一句话 |
| --- | --- | --- |
| E1 | 趋势通道 | 日 token 图上加 7 天移动平均线与线性外推虚线，一眼看出「我在变多还是变少」 |
| E2 | 异常日检测 | 找出 token 突增/突降的日子（相对 7 天均值的 z 分数），在日历与日图上标记 |
| E3 | 会话内时间旅行 | 会话分析新增「时间轴条」——底部一根可拖动的轴，拖到任意时刻显示当时的上下文水位与正在发生的记录 |
| E4 | 用量年报 | 一页滚动的年度报告：总 token、最活跃月、最爱模型、最长连击、最烧钱一周 |
| E5 | CSV 导出 | 用量总览任一表格可导出 CSV（零网络，写本地文件） |
| E6 | 模型迁移时间线 | 按模型显示使用起止时间条——「什么时候从 opus 换到 sonnet」 |
| E7 | 上下文健康分 | 平均上下文占压缩阈值比例、压缩频率、出血点数 → 0–100 分 + 一句人话 |
| E8 | 键盘导航地图 | `?` 呼出全应用快捷键速查卡 |
| E9 | 数据新鲜度徽章 | 所有汇总页右上角「数据截至 HH:MM（N 分钟前）」，文件变化时自动刷新 |
| E10 | 迷你走势 sparkline | KPI 卡内嵌 7 天 sparkline |

Issue 的验收标准里有三条硬约束，本文逐条兑现：**三主题 × 130% 无破版**、**零新增网络请求**、**空数据/单日/单会话不崩且诚实**。

### 0.2 一条路径纠正（先纠，免得实现者按错路径改）

Issue #275 与派工消息里把外壳写作 `web/src/features/app-shell/AppShell.tsx`。**仓库里没有这个目录**。真实路径是：

- `web/src/app/AppShell.tsx`（521 行，`⌘K` 与 `Esc` 的全局监听都在这里：`:296-310` 与 `:326-340`）
- `web/src/app/commandRegistry.ts`（141 行，命令面板的纯逻辑层）
- `web/src/app/CommandPalette.tsx`（172 行）+ `.module.css`（`z-index: 120`）

E8 按这三处改，不存在 `features/app-shell/`。

### 0.3 既有事实（逐条核对过，本文所有数字都从这些值推出来）

| 事实 | 值 | 出处 |
| --- | --- | --- |
| 卡片原语 | 表头 `min-height: 40px` + 体内距 `var(--sp-3)`=12 | `web/src/components/Panel.tsx` |
| 卡片 `actions` 槽 | 存在，渲染在表头右侧（已有 3 处用分段控件） | `Panel.tsx` 的 `actions?: ReactNode` |
| 用量档块序（14 块） | 计费卡 → 周战报 → 会话对比 → 每日 Token 消耗 → 按项目分布 → 项目卡片 → 工作习惯 → 消耗日历 → 会话甘特 → 按模型分布 → 流向图 → 活跃时段 → 工具普查 → 压缩统计 | `UsageOverviewPage.tsx:517-713` |
| 用量档四态键 | `cca-usage-range` / `cca-usage-view` / `cca-usage-activity` | 同文件 `RANGE_KEY` / `VIEW_KEY` / 活跃档键 |
| 会话分析标签 | 7 个：日志视图 / 树视图 / 上下文 / 改动 / 出血点 / 重放 / 账单 | `SessionAnalyzerPage.tsx:49-55` |
| KPI 卡高 | `12 + 16(label) + 8(gap) + 28(value) + 12 = 76px` | `UsageOverviewPage.module.css` 的 `.kpi` |
| 浮层层级 | 搜索面板 `z-index: 100`；命令面板 `z-index: 120` | 各自 `.module.css` 首行注释 |
| 焦点环 | `:focus-visible` + `var(--focus-ring-width/offset/inset)`，计数由 `focusRing.test.ts` 守卫（当前 39/21/15/43） | `web/src/styles/tokens.css` |
| 单据导出先例 | `bridges.dialog.saveText(defaultName, contents, {title, filterName, extensions})` 一次完成「选路径 + 写文件」，取消返回 `null` | `web/src/api/types.ts:76-88` |

### 0.4 零新增令牌的依据

本批十个功能要表达的东西只有四种：**趋势线**、**异常**、**健康档位**、**新旧数据**。四者全部落在既有资产上：

| 要表达的 | 用既有令牌 | 为什么不是新令牌 |
| --- | --- | --- |
| 7 天均线 | `--chart-1` | 它是「与顺序无关的数据墨」，趋势线正是数据墨 |
| 线性外推 | `--text-tertiary` + 虚线 | 外推是**推断**不是观测，用中性墨 + 虚线形状说明「这是估的」 |
| 异常日 | `--warning` | 既有语义就是「非确定/需要留意的信息」，异常日正是它 |
| 健康分四档 | `--success` / `--chart-1` / `--warning` / `--danger` | 与 Round DD 的烧钱四档同一套档位色，读者不用学第二遍 |
| 新鲜度 | `--text-secondary` | 徽章是读数不是告警 |
| 浮层 | `--bg-elevated` + `--shadow-md` + `--overlay` | 与 `ThresholdsPanel` / `CommandPalette` / `SearchPalette` 同一套浮层语言 |

所以本批**新增颜色令牌 0 个**、**新增间距/字号令牌 0 个**。§6 给逐条对比度实算。

### 0.5 三条读数口径（沿用既有，不重新发明）

1. **时间窗靠 `days` 参数，不靠「今天」**：用量页的一切按 `cca-usage-range`（7/30/90 天）切片，「近 7 天」「近 30 天」在界面上都写「所选范围」，不写「本周」——本周是周战报的口径，两者不是一回事。
2. **`now` 来自 tick 实例**：`readouts.now` 是 30 秒 tick 的那个值，同屏与导出必须逐字一致（Issue #174 的旧账）；E9 的「N 分钟前」也只能用它算。
3. **算不出来就写明为什么**：样本不足写「样本不足」、定价未知写「定价未知」、缺项写「不可用」，**不写 0、不写「—」了事**——这是前两批十功能唯一贯穿到今天的规则（CHANGELOG 里每一轮都重述了一遍）。

---

## 1 十条裁决（先落，再谈版式）

### R1 挂载表：九条零高度增量，一条 +16px

这是本批最重要的一张表。**每个功能都挂在已存在的容器里**，只有 E1 的图例是一行真正新增的文档流高度。

| 功能 | 挂到哪里 | 形态 | 1440×900 增量 | 130% 增量 |
| --- | --- | --- | --- | --- |
| E1 趋势通道 | 「每日 Token 消耗」卡内，图谱之上叠一层线 | 卡内新增 | **+16px**（图例一行 `--lh-xs`） | **+21px**（16×1.3） |
| E2 异常日 | 同一张日图 + 消耗日历格子角标 | 卡内新增（纯标记） | 0 | 0 |
| E3 时间旅行 | 会话分析第 8 个标签「时间轴」 | 新视图（不在用量页） | 0（用量页） | 0 |
| E4 年报 | 用量档第 4 档「年报」（分段控件 +1 项） | 新档（不进文档流） | 0 | 0 |
| E5 CSV | 三处 `Panel.actions` 槽各一枚按钮 | 表头内 | 0（按钮 24px，表头 40px 已容纳） | 0（表头不随字号缩放） |
| E6 迁移时间线 | 「按模型分布」卡内第 3 个标签 | 卡内 tab | 0 | 0 |
| E7 健康分 | 会话分析页头右侧一格读数 | 页头内 | 0（页头 78px 不变） | 0 |
| E8 速查卡 | 全局浮层（`?` / 命令面板） | 浮层 | 0（脱离文档流） | 0 |
| E9 新鲜度 | 用量页页头右侧徽章 + 会话分析页头 | 页头内 | 0 | 0 |
| E10 sparkline | KPI 卡数值行右侧 48×14 | 卡内叠加 | 0（卡高 76px 不变） | 0 |
| **合计** | | | **+16px** | **+21px** |

**结论写在这里，评审可以直接质疑**：十个功能合计只让用量页长 **16px**（130% 下 21px），且**没有一块新容器**——没有第 15 块卡、没有第 5 行整行。理由不是「省着用」，而是每一条都长在它解释的那个数字旁边：

- E1/E2 解释「日图上的那根柱」，所以住在日图里；
- E6 解释「模型占比」，所以是同一张卡的第 3 个 tab；
- E10 解释「KPI 的那个数」，所以住在 KPI 卡里；
- E9 解释「页面上的数是什么时候的」，所以住在页头；
- E3 解释「会话内部的时间」，所以住进会话分析，而不是用量页。

**被否方案**：把 E1/E2 做成「趋势」新档（会让人在两个档之间对照同一张图，违反「一个概念一个窗口」）；把 E4 年报做成第 15 块整行（年报是一段叙事，夹在 14 块读数之间会读成「又一块图表」，且必然 > 400px 上限）。

### R2 E1+E2 共用一张图，且不改 `BarChart` 原语

- E1 的均线与外推、E2 的异常标记，**都画在「每日 Token 消耗」那张图的坐标系上**，不另开图。
- 实施方式：在 `BarChart` **之上**叠一层同 `viewBox` 的 `<svg class="trendOverlay">`（只画两条 polyline + 异常三角），`BarChart` 一行不改。
- 理由：`BarChart` 被 4 处复用（日图、错误趋势、配额、脉搏），改它等于一次动 4 张图的截图基线；叠层只影响这一张。
- 硬要求：叠层的内边距常量必须与 `BarChart` 的 `padTop/padBottom` 同源——如果它们还是模块内私有常量，**提为 `export const` 再 import**（最小改动，不改行为）。

### R3 E4 年报 = 第 4 档，不是第 15 块

用量档现在的分段控件是 3 项（用量 / 里程碑 / 错误）。年报是**另一段叙事**（一年的形状），与「这一窗口的读数」不是同一个问题，所以：

- 新增第 4 档 `year`，与 `milestones` / `errors` 同构：自己承担空态、自己承担加载态；
- 持久化键沿用 `cca-usage-view`（`"year"` 落进同一个键，不新增 localStorage 键）；
- 档内是 6 张卡顺排（每张 ≤ 360px），**不是**一个固定高度滚动容器——年报允许长，但不允许「一屏里塞两个互相抢戏的数字」。

### R4 E3 与「重放」的区隔：三通道同时不同（专章见 §4）

两根轴放在同一个应用里，最容易出的错是「读者以为它们是同一根轴的两个皮肤」。本规格用**位置、形状、颜色、文案四个通道**同时区分，任一通道单独看都能分辨：

| 通道 | 重放（影片） | 时间轴（任意跳） |
| --- | --- | --- |
| 位置 | 卡片 B 的胶片带，全宽、在事件卡下方 | 视图底部一根 168px 高的轴，横贯整页 |
| 形状 | 2px 竖线播放头 + 顶部圆点 + ◆ 跃点 | 3px 竖线 + 14×6 圆角手柄 + 无跃点 |
| 颜色 | 类别色（`--cat-*`）编码事件类型 | **只用** `--chart-1`（水位）与 `--text-tertiary`（刻度），不用类别色 |
| 文案 | 「播放」「片长 60 秒」「墙钟跨度」 | 「拖到任意时刻」「此前的记录」 |

**硬禁止**：时间轴不得复用 `ReplayView` 的 `.film` / `.lane` / `.playhead` 类名，也不得复用 `replayModel.ts` 的 `frameAt`（两者语义不同：一个按事件推进，一个按时刻取值）。二者若共享代码，只允许共享 `contextSeries.ts` 的水位序列。

### R5 E5 用 `dialog.saveText`，不要 `fs.writeText` + `savePath` 两步

派工消息写的是「`bridges.fs.writeText(filename, CSV_BOM + csv)`」——**这个签名在仓库里不成立**：`fs.writeText(path, contents)` 的第一个参数是**绝对路径**，不是文件名。既有先例是 `dialog.saveText`，一次调用完成「弹保存框 + 写文件 + 取消返回 null」：

```ts
const path = await bridges.dialog.saveText(filename, CSV_BOM + csv, {
  title: "导出 CSV",
  filterName: "CSV",
  extensions: ["csv"]
});
if (path === null) return; // 取消不是失败：不报错、不提示
```

三处挂载（都在既有 `Panel.actions` 或等价槽位）：**按项目分布**、**按模型分布**、**会话账单 · 最贵五次**（`CostLedgerView`，会话分析档）。E5 的按钮是**同一个组件**，三处传不同的 `headers/rows`。

### R6 E6 迁移 = 「按模型分布」第 3 tab

该卡已有 2 个 tab（占比 / 换模，`UsageOverviewPage.tsx:632-640`），加第 3 个「迁移」：一份「模型 × 日期」的矩阵画成横向起止条。**不做新卡**，因为「我什么时候换的模型」与「我现在用哪个模型」是同一个问题的两个时态。

### R7 E7 健康分 = 会话分析页头右侧一格

健康分是**单会话**的读数（平均上下文占阈值比例 + 压缩频率 + 出血点数），它的宿主是会话分析页头（会话标题那一行），不是用量页。0–100 分的大数字 + 一句人话，**数字优先，色带只是辅助**（色盲读者读数字就够）。

### R8 E9 新鲜度 = 页头徽章，不做面板

「数据截至 HH:MM（N 分钟前）」是**元信息**，不是读数。放在用量页页头右侧（与 E4 的档位控件同行），以及会话分析页头右侧。它的存在感靠 `--text-secondary` 一行小字，不靠颜色。

### R9 E10 sparkline = KPI 卡内的 48×14，`aria-hidden`

KPI 卡已经用 `--fs-lg` 给出数字；sparkline 只画形、不画刻度、不带坐标轴，`aria-hidden="true"`——数值仍由同一张卡的文本承担。**不改卡高**：48×14 塞进现有的 28px 数值行。

### R10 E8 速查卡 = 全局浮层，`z-index: 130`，复用既有焦点陷阱写法

- 层级：搜索 100 < 命令面板 120 < **速查卡 130**。理由：速查卡是「帮助」，任何浮层之上都得能读到它；同时打开时主动关掉其它浮层（与 `AppShell` 进大屏时的做法一致）。
- 遮罩：`--overlay`（与两个既有浮层同一个令牌），卡片 `--bg-elevated` + `--shadow-md` + 1px `--border`。
- 焦点陷阱：复用 `web/src/features/sessions/ExportDialog.tsx:28` 的 `focusables(root)` 写法（`document.addEventListener("keydown", onKey, true)` + 首尾回绕），**不新造第二套**。它现在是模块私有函数，允许原样复制一份到 `ShortcutSheet.tsx` 并在注释里写明「与 ExportDialog 同款，待合并」——**不允许**为了复用去改 ExportDialog（本轮不动它）。
- `?` 键的冲突核查：全仓库 `grep '"\?"'` 无命中，`?` 当前没有绑定；`⌘K` 只在 `AppShell.tsx:313`、`Esc` 只在 `AppShell.tsx:375` 与各浮层内部。**不冲突**。（行号为落地时实况，随并行改动会漂，认函数不认行号。）

### R11（附）速查卡的内容必须逐条来自代码

派工消息要求「每一条都必须从代码里 grep 核实」。我逐条核过，**本应用没有 `j/k`、没有数字键切标签、没有 `v` 之类 vim 键**（`grep -rn '"j"\|"k"\|KeyJ\|KeyK\|/^[1-9]$/'` 全部无命中，唯一的 `k` 是 `⌘K`）。速查卡**不得**出现这三类键——写一个不存在的键，比没有速查卡更糟。逐条键位表见 §7.2。

---

## 2 版式与几何：逐功能

所有数字都从 §0.3 的既有值推出。间距只用 `--sp-*` 八档，字号只用 `--fs-*/--lh-*`，圆角只用 `--r-*`。

### 2.1 E1 趋势通道（「每日 Token 消耗」卡内）

**DOM**

```html
<section class="panel" aria-label="每日 Token 消耗">
  <header class="header">
    <h2>每日 Token 消耗</h2>
    <div class="actions"><SegmentedControl .../></div>   <!-- 既有 -->
  </header>
  <div class="body">
    <div class="chartStack">            <!-- position: relative -->
      <svg class="barChart">…</svg>      <!-- 既有 BarChart，不改 -->
      <svg class="trendOverlay" aria-hidden="true">…</svg>  <!-- 新增：均线 + 外推 -->
      <div class="anomalyMarks">…</div>  <!-- 新增：异常 ▲，绝对定位 -->
    </div>
    <p class="trendLegend">…</p>         <!-- 新增：唯一新增高度 16px -->
  </div>
</section>
```

**几何**

| 元素 | 值 | 说明 |
| --- | --- | --- |
| `.chartStack` | `position: relative` | 三层共用同一个 `viewBox` |
| 均线 `path` | `stroke: var(--chart-1)` / `1.5px` / 无虚线 | 实心细线 = 观测 |
| 外推 `path` | `stroke: var(--text-tertiary)` / `1.5px` / `stroke-dasharray: 4 3` | 虚线 = 推断 |
| 异常 `▲` | 8px 三角，`fill: var(--warning)`，底距 x 轴 4px | 形状通道，不只靠色 |
| `.trendLegend` | `--fs-xs` / `--lh-xs` / `--text-tertiary`，上距 `--sp-2` | 一行，16px |

**图例文案（逐字）**：`实线＝7 天移动平均 · 虚线＝按最近 14 天外推 · ▲＝异常日（z ≥ 2）`

**数据不足时**：不足 7 天有效数据 → 不画均线，图例改为 `均线需要 7 天数据，当前只有 N 天`；不足 14 天 → 不画外推，图例尾部改为 `外推需要 14 天数据`。两句话可以同时出现（用 ` · ` 连接）。

### 2.2 E2 异常日（同一张图 + 日历角标）

- **日图**：异常日的柱顶上方 6px 处一枚 `▲`（8px），`title` 写 `该日 token 是 7 天均值的 N.N 倍（z=+N.N）`。
- **日历**：异常日格子右上角一枚 4px 实心圆点 `--warning`，`title` 同上；格子的 `aria-label` 追加「异常」二字（屏幕阅读器能听到）。
- **阈值**：`|z| ≥ 2` 才算异常；`z` 的分母是**该日之前**的 7 天均值与标准差（不含当日，避免当日污染基线）。少于 7 天历史 → 该日不判定，**不写 0**。

### 2.3 E4 用量年报（第 4 档）

6 张卡顺排，每张 `Panel`（表头 40 + 体内距 24），高度上限 360px：

| # | 卡 | 内容 | 高度 |
| --- | --- | --- | --- |
| 1 | 一年一句话 | `--fs-lg` 一行大字 + 三行小字（起止日、总 token、活跃天数） | 40 + 12 + 28 + 3×20 + 12 = **152** |
| 2 | 十二个月的形状 | 12 根柱（月）+ 峰值月标记 | 40 + 12 + 200 + 12 = **264** |
| 3 | 最爱模型 | 前 3 个模型 + 占比条 | 40 + 12 + 3×44 + 12 = **196** |
| 4 | 连击 | 最长连击天数（大数字）+ 一年中的分布小格 | **232** |
| 5 | 最烧钱的一周 | 一行读数 + 该周 7 天迷你条 | **176** |
| 6 | 数据从哪天开始 | 扫描起点、数据来源、口径说明（不是大字） | **148** |
| 合计 | | | **1,168px** |

**诚实口径（硬约束）**：数据不足一年时，卡 1 的标题不写「2026 年报」而写 **「数据从 2026-03-12 开始（已记录 229 天）」**，并且卡 6 出现；数据满一年时卡 6 只写口径，不写起点。

### 2.4 E3 时间轴（会话分析第 8 标签，几何见 §4）

### 2.5 E5 CSV 导出按钮

**DOM**

```html
<span class="root" data-probe="csv-export-<slug>">   <!-- ledger / projects / models / top-calls -->
  <button type="button" class="button">导出 CSV</button>
  <span class="error" role="alert">导出失败：…</span>   <!-- 仅失败时存在 -->
</span>
```

按钮文案三态：`导出 CSV` / `导出中…`（在飞时 `disabled`）/ `无可导出`（0 行时 `disabled`，`title="没有可导出的行"`）。

**几何**：按钮 24px 高（`--control-h-sm`）+ `--fs-xs` + 左内距 `--sp-2`；放进 `Panel.actions` 时垂直居中对齐既有的分段控件。**不放图标**（表头已有分段控件，再加图标会变成三件套）。

**文件名**：`cc-analyzer-<表名>-<YYYY-MM-DD>.csv`，表名用中文短名（`projects` / `models` / `top-calls` 用英文 slug 更安全：`cc-analyzer-projects-2026-10-27.csv`）。**不含项目路径、不含用户名**。

**错误**：就地 `role="alert"` 一行 `--fs-xs` / `--danger` + `notify(msg, "error")`（tone 沿用 `NotificationProvider`）。取消（`path === null`）**不算失败**。

### 2.6 E6 迁移时间线（「按模型分布」第 3 tab）

- 横轴 = 窗口内日期，纵轴 = 模型（最多 6 行）；
- 每行一条 `6px` 高的起止条，`--chart-N`（与占比图同一个索引规则，读者不用学第二套配色）；
- 换模的那一刻：相邻两条的交界处画 `1px` 竖线 `--border-strong`；
- 行高 `--row-h`(30)，6 行 = 180 + 轴 20 = **200**（卡内 tab 切换，不增加卡高）。

### 2.7 E7 健康分（会话分析页头）

```
┌ 页头（78px）────────────────────────────────────────────┐
│ 会话标题 …                         ┌──────┐            │
│ 元信息一行                          │  78  │ 健康分     │
│                                    └──────┘            │
└────────────────────────────────────────────────────────┘
```

- 数字 `--fs-lg`/600/tabular，颜色按四档（`--success` / `--chart-1` / `--warning` / `--danger`），**数字本身不带色**：色在左侧 3px 竖条上，数字用 `--text`（保证 17.79:1）；
- 一句人话（`--fs-xs`/`--text-tertiary`）：「上下文常在一半以上，压缩来得比同类会话早」。

### 2.8 E9 新鲜度徽章

- 位置：用量页页头右侧（E4 分段控件左侧 `--sp-3`）；
- 形态：`--fs-xs` / `--text-secondary` / 无底色 / 前置 6px 圆点（`--success` 新鲜 / `--warning` 超过 10 分钟 / `--danger` 超过 1 小时）；
- 文案：`数据截至 14:32（3 分钟前）`；**扫描中**时写 `刷新中…（上次 14:32）`，不显示一个假的更新时间。

### 2.9 E10 KPI sparkline

- `48×14`，`stroke: var(--chart-1)` / `1.5px` / 无填充 / `aria-hidden="true"`；
- 位置：KPI 数值行右侧，`margin-left: auto`，与数字基线居中对齐；
- 数据不足 2 天 → 不渲染（不画一条水平直线冒充趋势）。

---

### 2.10 四个「零增量」挂载的 DOM 片段（给实现者直接抄）

**E6 迁移（按模型分布第 3 tab）**

```jsx
<SegmentedControl items={[{value:"share",label:"占比"},{value:"swap",label:"换模"},{value:"migration",label:"迁移"}]} … />
{modelView === "migration" ? <ModelMigrationBars rows={migrationRows} /> : …}
```

**E7 健康分（会话分析页头）**

```jsx
<div className={styles.healthScore} data-probe="health-score">
  <span className={styles.healthBar} data-tier={tier} aria-hidden="true" />
  <span className={styles.healthValue}>{score ?? "—"}</span>
  <span className={styles.healthNote}>{note}</span>
</div>
```

**E9 新鲜度（用量页页头右侧）**

```jsx
<span className={styles.freshness} data-probe="data-freshness">
  <i className={styles.dot} data-state={state} aria-hidden="true" />
  数据截至 {hhmm}（{relative}）
</span>
```

**E10 KPI sparkline**

```jsx
<span className={styles.kpiValue}>
  {formatTokenCount(value)}
  {daily.length >= 2 ? <Sparkline values={daily} width={48} height={14} aria-hidden="true" /> : null}
</span>
```

四段的共同点：**都是往已存在的容器里塞一个孩子**，没有一个引入新的 `display: grid` 层级，所以 §1 R1 的「0px 增量」不是估算而是结构事实。

---

## 3 E3 与「重放」的区隔（专章，评审重点）

这一章单独成章，因为**两根时间轴同时存在于「会话分析」标签里**，读者最容易问「这两个不是一个东西吗」。

### 3.1 它们回答的问题不同

| | 重放 | 时间轴 |
| --- | --- | --- |
| 问题 | 「这次会话**怎么发生的**」 | 「**某一刻**上下文里有什么」 |
| 隐喻 | 影片（有时间、有节奏、可播放） | 地图（有坐标、可任意跳） |
| 数据 | 事件的**顺序与间隔** | 每个时刻的**状态快照** |
| 交互 | 播放/暂停/逐事件 | 拖动/点击任意位置 |

一句话分工：**重放是「看一遍」，时间轴是「跳到那儿看」**。时间轴没有播放按钮，因为它不需要——拖到哪就是哪。

### 3.2 几何与位置（168px）

```
┌ 视图主体（记录列表 / 水位图）──────────────────────────┐
│                                                        │
├ 轴（168px，固定贴底）──────────────────────────────────┤
│  水位条  240px 高→不，这里是 96px 高的水位折线          │
│  ────────────────────────────────────────────  96px    │
│  刻度行：起点 · 中点 · 终点（--fs-xs/--text-tertiary）   │
│  手柄：14×6 圆角，骑在 3px 竖线上                      │
└────────────────────────────────────────────────────────┘
168 = 12(上距) + 96(水位) + 8 + 16(刻度) + 12(下距) + 24(底部读数行)
```

### 3.3 视觉区隔的三条硬规则

1. **不用类别色**：时间轴只用 `--chart-1`（水位折线）与 `--text-tertiary`（刻度/读数）。事件类型在时间轴上**不编码颜色**——类型留给重放，两者不抢同一个编码通道。
2. **手柄必须是矩形不是圆点**：重放播放头顶部是 4px 圆点，时间轴是 14×6 的圆角矩形（`--r-xs`）。形状不同，键盘用户之外的读者也能一眼分辨。
3. **底部读数行只在时间轴存在**：`14:32:07 · 第 37 条记录 · 上下文 78,412 / 100,000`，`--fs-base`/tabular。重放的对应位置是「片长 60 秒 · 约 63×」——**两个读数行不共用 class**。

### 3.4 键盘（与重放的键位刻意错开）

| 键 | 重放 | 时间轴 |
| --- | --- | --- |
| `Space` | 播放/暂停 | **无绑定**（时间轴没有播放概念） |
| `←` / `→` | 上一/下一**事件** | 后退/前进 **1% 跨度**（10 秒级） |
| `Home` / `End` | 首个/末个事件 | 会话起点/终点 |
| 拖动 | 无 | 鼠标/触摸拖手柄 |

`Space` 不绑定的理由：如果两个视图都接受 `Space`，用户在两者间切换时会形成「按空格没用」的错误记忆。

---

## 4 颜色与令牌：零新增，逐条实算

### 4.1 用到的令牌与对比度（四主题，实测）

数值与 Round DD §4.2 同一张表（同一套 `tokens.css`，未改），门槛：正文 ≥ 4.5:1、图形 ≥ 3:1。

| 前景 | 底 | 浅色 | 深色 | 高对比浅 | 高对比深 | 门槛 | 用途 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `--chart-1` | `--bg-subtle` | 5.64 | 8.39 | 7.82 | 8.90 | 3:1 | E1 均线、E6 迁移条、E10 spark、E3 水位 |
| `--text-tertiary` | `--bg-subtle` | 4.78 | 5.83 | 10.45 | 10.74 | 4.5:1 | E1 外推虚线 / 图例 / 刻度 / E7 人话 |
| `--warning` | `--bg-subtle` | 5.24 | 8.17 | 7.13 | 12.12 | 3:1 | E2 异常标记、E7 偏热档、E9 陈旧 |
| `--danger` | `--bg-subtle` | 6.54 | 6.52 | 8.06 | 9.37 | 4.5:1 | E5 导出失败、E7 低分档 |
| `--success` | `--bg-subtle` | 5.32 | 8.18 | 8.32 | 12.13 | 3:1 | E7 高分档、E9 新鲜 |
| `--text` | `--bg-subtle` | 17.79 | 16.15 | 21.00 | 18.73 | 4.5:1 | E4 大字、E7 分数数字 |
| `--text-secondary` | `--bg-subtle` | 7.87 | 9.44 | 14.34 | 13.66 | 4.5:1 | E9 徽章文字 |
| `--border-strong` | `--bg-subtle` | 1.47 | 1.52 | 9.27 | 6.99 | 3:1 | **不用于信息图形**（见 4.3） |

**最低值**：文字类 4.78:1（`--text-tertiary` / 卡片底，浅色）——刚好过 4.5；图形类 5.24:1（`--warning` / 卡片底，浅色）。

### 4.2 颜色永远不是唯一编码（逐条）

| 功能 | 颜色通道 | 第二通道（形状/文字） |
| --- | --- | --- |
| E1 均线 vs 外推 | 蓝 vs 灰 | **实线 vs 虚线** + 图例文字 |
| E2 异常日 | `--warning` | **▲ 三角** + `title` 里的倍数与 z 值 |
| E6 模型 | `--chart-N` | 行首模型名 + 起止日期文字 |
| E7 健康分 | 四档色（3px 竖条） | **数字本身**（78/100）+ 一句人话 |
| E9 新鲜度 | 绿/黄/红圆点 | 圆点 + 括号里的相对时间文字 |

### 4.3 被否掉的候选

- **`--border-strong` 画外推线**：浅色只有 1.47:1，图形门槛 3:1 不过。改用 `--text-tertiary`（4.78）虚线。
- **新增 `--trend` 令牌**：趋势线就是数据墨，`--chart-1` 已经是它的语义；新增令牌只会让「哪种线该用什么色」变成第二个需要记的规则。
- **E2 用箭头颜色区分突增/突降**：颜色分不出方向（红绿在四种主题下的对比度也不一致），改用 **▲/▼ 形状**——突增 ▲、突降 ▼。

### 4.4 复现脚本

```js
// node ee-contrast.mjs（仓库根目录运行）：与本轮数值逐位一致
import { readFileSync } from "node:fs";
const css = readFileSync("web/src/styles/tokens.css", "utf8");
const blocks = [["light", /:root \{([\s\S]*?)\n\}/], ["dark", /\[data-theme="dark"\] \{([\s\S]*?)\n\}/],
  ["hc-light", /\[data-contrast="high"\] \{([\s\S]*?)\n\}/],
  ["hc-dark", /\[data-theme="dark"\]\[data-contrast="high"\] \{([\s\S]*?)\n\}/]];
const parse = (b) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const base = parse(css.match(blocks[0][1])[1]);
const themes = Object.fromEntries(blocks.map(([n, re]) => [n, { ...base, ...parse(css.match(re)[1]) }]));
const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const over = (fg, bg) => { const m = fg.match(/rgba?\(([^)]+)\)/); if (!m) return hex(fg);
  const p = m[1].split(",").map(Number); const a = p[3] ?? 1;
  return p.slice(0, 3).map((c, i) => Math.round(c * a + bg[i] * (1 - a))); };
const lum = (rgb) => rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
  .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const L1 = Math.max(lum(a), lum(b)), L2 = Math.min(lum(a), lum(b)); return (L1 + 0.05) / (L2 + 0.05); };
const pair = (t, fg, bg) => { const v = themes[t]; const b = over(v[bg], [255, 255, 255]); return ratio(over(v[fg], b), b); };
for (const t of Object.keys(themes)) console.log(t, "chart-1", pair(t, "chart-1", "bg-subtle").toFixed(2),
  "text-tertiary", pair(t, "text-tertiary", "bg-subtle").toFixed(2), "warning", pair(t, "warning", "bg-subtle").toFixed(2));
```

---

## 5 动效

原则沿用 Round DD：**数据层零补间**（模型算出来的每个数都是离散事实，不做视觉追赶），动效只允许出现在「状态切换」而不是「数值变化」上。

| 位置 | 允许 | 时长/缓动 | reduced-motion |
| --- | --- | --- | --- |
| E1 均线/外推出现 | 淡入 opacity 0→1 | `--dur-enter` 220ms `--ease-out` | 直接显示 |
| E2 异常标记 | 无（静态） | — | — |
| E4 年报卡 | 无（滚动即可） | — | — |
| E3 拖动 | 无补间（跟手） | — | 同（拖动本身不是动画） |
| E5 按钮 | hover 由既有按钮规则管 | `--dur-hover` 80ms | 同 |
| E7 分数 | 无（分数跳变即事实） | — | — |
| E8 卡片 | 无进入动画（与 `CommandPalette` 一致：它也没有） | — | — |
| E9 圆点 | 颜色切换 `--dur-state` 140ms | 140ms | 直接切换 |
| E10 spark | 无 | — | — |

**「动效不能影响读数正确性」的具体落实**：E1 的均线在做完 `useMemo` 计算后才绘制；外推的截距只在数据变化时重算，**不随 rAF 逐帧重算**。任何 `requestAnimationFrame` 都只允许出现在 E3 的拖动跟手里，且只读最近的指针位置，不改模型输出。

---

## 6 状态矩阵（逐功能，文案原文）

| 功能 | 空 | 数据不足 | 正常 | 失败 |
| --- | --- | --- | --- | --- |
| E1 趋势 | 图不渲染；图例「所选范围内没有消耗，趋势线无可画」 | 「均线需要 7 天数据，当前只有 3 天」/「外推需要 14 天数据」 | 图例完整一行 | — |
| E2 异常 | 「所选范围内没有异常日（|z| ≥ 2）」 | 「历史不足 7 天，暂不判定异常」 | ▲ 标记 + title | — |
| E3 时间轴 | 「这条会话只有 1 条记录，没有时间跨度可拖动」 | 「本段没有可核对的上下文读数」（沿用重放的口径） | 水位 + 手柄 | 解析失败由外层承担 |
| E4 年报 | 「还没有可统计的会话」 | 「数据从 2026-03-12 开始（已记录 229 天）」 | 6 张卡 | 「年报生成失败：…」 |
| E5 CSV | 按钮 `disabled` + `title="没有可导出的行"` | — | 保存框 → 成功 toast「已导出 CSV」 | 就地 `role="alert"`「导出失败：…」 |
| E6 迁移 | 「所选范围内只有一个模型，没有迁移可画」 | — | 起止条 + 换模竖线 | — |
| E7 健康 | 「这条会话没有上下文读数，算不出健康分」 | 「样本太少（N 条记录），健康分不可靠」 | 分数 + 人话 | — |
| E8 速查卡 | — | — | 分组表 | — |
| E9 新鲜度 | 「数据尚未加载」 | 「数据截至 14:32（12 分钟前）」 | 同左 | 「数据截至 14:32（读取失败）」 |
| E10 spark | 不渲染 | 不足 2 天不渲染 | 折线 | — |

**诚实三条（本轮新增的坑）**：

1. **E7 的分数不能来自「猜」**：三个分项中任意一项算不出（例如没有压缩事件），就不出总分，写「缺少压缩记录，健康分不可用」——不拿两项凑一个 0–100。
2. **E9 的「N 分钟前」不能来自 `Date.now() - now` 之外的东西**：`readouts.now` 是 30 秒 tick 的实例，相对时间必须用它算，否则「3 分钟前」会随渲染漂移。
3. **E4 的「最烧钱一周」必须写清是估算**：脚注 `按定价快照估算，不是账单`（沿用计费卡的措辞）。

---

## 7 无障碍

### 7.1 E8 速查卡（本轮唯一的新浮层）

- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` 指向标题（**文案**：`键盘快捷键`）；
- 打开时焦点落到卡片容器（`tabIndex={-1}`），`Esc` 关闭并把焦点还给触发者（`?` 从页面开的话还给 `document.body`，从命令面板开的话面板已关）；
- 焦点陷阱：`Tab` / `Shift+Tab` 在卡内回绕（复用 `focusables` 写法）；
- 遮罩点击关闭；遮罩本身 `aria-hidden="true"`；
- 分组用 `<h3>` + `<dl>`：`<dt>` 键位、`<dd>` 说明——屏幕阅读器读作「⌘K，命令面板」，比一串 `kbd` 更好听；
- 键帽 `<kbd>` 只做视觉，**键位文字必须同时是 `<dt>` 的文本内容**（不能把键位画在背景图里）。

### 7.2 速查卡内容（逐条代码核实，附出处）

| 分组 | 键 | 作用 | 出处 |
| --- | --- | --- | --- |
| 全局 | `⌘K` / `Ctrl+K` | 命令面板 | `app/AppShell.tsx:313` |
| 全局 | `?` | 本速查卡 | 本轮新增 |
| 全局 | `Esc` | 关闭浮层；无浮层时退出大屏 | `app/AppShell.tsx:375` |
| 命令面板 | `Esc` | 关闭面板 | `app/CommandPalette.tsx:65` |
| 命令面板 | `↑` `↓` | 移动高亮 | `app/CommandPalette.tsx:86` |
| 命令面板 | `Enter` | 执行选中命令 | `app/CommandPalette.tsx:91` |
| 列表与表格 | `↑` `↓` | 上/下一行 | `sessions/useRowNavigation.ts` |
| 列表与表格 | `Home` `End` | 首行/末行 | 同上 |
| 列表与表格 | `Enter` / `Space` | 打开/选中当前行 | 同上 |
| 重放 | `Space` | 播放 / 暂停 | `sessions/ReplayView.tsx:717` |
| 重放 | `←` / `→` | 上一 / 下一事件 | `ReplayView.tsx:726-732` |
| 重放 | `Home` / `End` | 片头 / 片尾 | `ReplayView.tsx:735-739` |
| 上下文 | `←` / `→` | 移动事件焦点 | `sessions/ContextView.tsx:222-238` |
| 上下文 | `Enter` / `Space` | 选中事件；`Esc` 取消 | 同上 `:218-228` |
| 消耗日历 | `←` `→` | 跨一周 | `usage/UsageCalendarPanel.tsx:418-423` |
| 消耗日历 | `↑` `↓` | 跨一天 | 同上 `:425-431` |
| 消耗日历 | `Home` `End` | 本周首/末 | 同上 `:432-439` |
| 错误趋势 | `←` `→` | 选日；`Enter`/`Space` 筛选；`Esc` 清除 | `usage/ErrorTrendChart.tsx:130-149` |
| 时间线（一日回望） | `←` `→` | 微调选区（跨度的 2%） | `sessions/TimelineTrack.tsx` |
| 时间轴（E3） | `←` `→` / `Home` `End` | 1% 步进 / 两端 | 本文 §3.4（E3 落地时核对） |

**明确不写进行**（因为不存在）：`j`/`k` 行导航、数字键切标签、`v`/`g` 类 vim 键、`/` 聚焦搜索（搜索的入口是 `⌘K` 里的「全局搜索」）。

### 7.3 其他

- E1/E2/E6/E10 的图形都是 `role="img"` + `aria-label`（E10 是 `aria-hidden`，因为同卡有文字数值）；
- E3 的手柄是 `<input type="range">` 的既有替代？**不是**——它用 `role="slider"` + `aria-valuemin/max/now` + `aria-valuetext`（`14:32:07`），因为时刻是连续量而记录是离散点；
- E5 的错误行 `role="alert"`（不用 `aria-live="polite"`：失败要立刻被听到）；
- 焦点环一律 `:focus-visible` + `var(--focus-ring-*)`，与全站一致（`focusRing.test.ts` 会红，按实数改）。

### 7.4 Tab 序与焦点归还

| 场景 | Tab 序 | 关闭后焦点回到 |
| --- | --- | --- |
| E8 速查卡打开 | 滚动区（`tabIndex=0`，键盘滚动要有落点）→ 右上角「关闭」→ 回绕到滚动区 | 触发者（页面上打开时是 `body`，成本由浏览器决定） |
| E5 CSV 点击后 | 保存框是原生对话框，不参与页内 Tab | 「导出 CSV」按钮本身（不抢走焦点） |
| E3 手柄 | 只占一个 Tab 位（`role="slider"`） | —— |

**关闭即归还**是硬要求：`Esc` 关掉速查卡后，用户再按 `Tab` 不能从页面顶部重新开始找焦点。

---

## 8 130% 与 960

### 8.1 130% 高度账

| 项 | 100% | 130% | 说明 |
| --- | --- | --- | --- |
| E1 图例 | 16 | 21 | `--lh-xs 16 × 1.3 = 20.8` |
| E4 卡 1 | 152 | 40 + 12 + 28 + 3×26 + 12 = **170** | 只有正文行缩放，表头 40 不变 |
| E4 卡 2 图 | 200 | 200 | 图高是 props 常量，不随字号缩放 |
| E8 卡 | 自适应 | 自适应 | `max-height: 70vh` + 内部滚动 |
| 合计（用量页） | +16 | **+21** | 10 个功能里只有 E1 增加文档流 |

**单块 400px 上限**：本批没有一块新文档流容器，唯一的 +16 是卡内一行；E4 的六张卡最大 264（100%）/ 276（130%），全部远低于 400。

### 8.2 960 窄窗

| 元素 | 1440（内容宽 1116） | 960（内容宽 636） |
| --- | --- | --- |
| E1 图例 | 一行放得下（约 42 字符 × 6.5px ≈ 273px） | 一行仍放得下；**不换行**，超宽时 `text-overflow: ellipsis` + `title` 全文 |
| E5 按钮 | `Panel.actions` 右侧 | 同在 actions，分段控件收窄后仍 ≥ 96px |
| E4 卡 2 的 12 根柱 | 每根 80px | 每根 44px（仍 > 12px 最小可点宽度） |
| E6 6 行迁移条 | 起止位置按日算 | 同（几何按比例，不按像素） |
| E8 卡 | `min(560px, 92vw)` | `min(560px, 92vw)` → 517px |
| E3 轴 | 全宽 1116 | 全宽 636（刻度只留起/中/末三个） |

**无横向溢出**的判据：所有新增容器的宽度都是 `100%` 或 `min(...)`，没有一个写死 `width: >636px`。

---

## 9 data-probe 锚点清单

| 功能 | 锚点 | 断言什么 |
| --- | --- | --- |
| E1 | `trend-overlay` | 有均线时 `polyline` 段数 ≥ 2；不足 7 天时该元素不存在 |
| E2 | `anomaly-marks` | 标记数 = 模型算出的异常日数；`title` 含 `z=` |
| E3 | `timeline-track` / `timeline-handle` | 拖动后 `aria-valuetext` 变化 |
| E4 | `year-report` | 6 张卡；数据不足一年时卡 1 标题含「数据从」 |
| E5 | `csv-export-<slug>`（`ledger` / `projects` / `models` / `top-calls`） | 点击后 `dialog.saveText` 被调用一次，内容以 `\uFEFF` 开头；取消（返回 `null`）不弹 toast、不出红字 |
| E6 | `model-migration` | 单模型时整块消失 |
| E7 | `health-score` | 分数 0–100；缺项时文案为「不可用」 |
| E8 | `shortcut-sheet` | `?` 后存在，`Esc` 后不存在 |
| E9 | `data-freshness` | 文案含「数据截至」 |
| E10 | `kpi-sparkline` | `aria-hidden="true"`，< 2 天时不存在 |

---

## 10 实现清单（E5 / E8 由我落，其余八条按本文）

### 10.1 我的两份（本轮）

| 文件 | 动作 |
| --- | --- |
| `web/src/features/usage/csvExport.ts` | 新建：`toCsv` + `CSV_BOM` |
| `web/src/features/usage/csvExport.test.ts` | 新建：转义矩阵 + BOM |
| `web/src/components/CsvExportButton.tsx` + `.module.css` + `.test.tsx` | 新建：三处挂载共用 |
| `web/src/app/ShortcutSheet.tsx` + `.module.css` + `.test.tsx` | 新建：速查卡 |
| `web/src/app/commandRegistry.ts` | 加一条「快捷键速查」动作 |
| `web/src/app/AppShell.tsx` | `?` 监听 + 渲染 `<ShortcutSheet>` |
| 三处挂载点 | `ProjectArenaPanel` / 按模型分布 Panel / `CostLedgerView` 各加一枚按钮 |

### 10.2 其余八条的落点（给实现者）

E1/E2 → 日图 Panel 叠层；E3 → `sessions/TimelineView.tsx`（新）+ 第 8 标签；E4 → `usage/YearReportView.tsx`（新）+ 第 4 档；E6 → 按模型分布第 3 tab；E7 → `SessionAnalyzerPage` 页头；E9 → 两个页头；E10 → KPI 卡。

### 10.3 明确不做

1. 不做 `j/k`、不做数字键切标签（应用里没有，不为速查卡造键）；
2. 不新增颜色令牌；
3. 不做 E3 的播放（那是重放）；
4. 不做年报的导出（E5 只导出表格，不导年报——年报是 HTML 快照的活儿，已有先例但不属本轮）；
5. 不给 KPI 卡做第二种 sparkline 画法。

### 10.4 自测命令

```bash
cd web && npx tsc -b --force && npm test -- --run
node -e 'const t=require("fs").readFileSync(".trellis/workspace/liangyuxiang/design-round-ee-batch3.md","utf8");console.log("fffd", [...t].filter((c)=>c==="\uFFFD").length)'
```
