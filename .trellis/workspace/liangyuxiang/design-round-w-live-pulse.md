# 「实时脉搏」界面规格（Round W）

> 角色：UI/UX 产品设计师（桌面工具 / 实时数据可视化）
> 日期：2026-10-15 ｜ 状态：待主会话独立评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（Issue #203 已锁定）：把「实时监控」标签重做成原生「脉搏」视图——活跃会话、
> 60 分钟 token 速率、5 小时窗口读数、上下文填充曲线；同一视图能进 420×620 置顶浮窗。
> **本文件只描述设计与断言，不改任何源码。**

---

## 0. 语境与现状（写前逐字读过）

**读过的文件**：`.trellis/tasks/10-14-live-pulse/prd.md`（R1–R11 是硬需求）、
同目录 `design.md`（技术设计，编排与调度以它为准）、
`.trellis/workspace/liangyuxiang/design-round-v3-insights.md`（本文件体例照它）、
`web/src/styles/tokens.css`（四块主题令牌全文）、
`web/src/features/usage/UsageOverviewPage.module.css`、`BillingWindowCard.module.css`、
`UsageCalendarPanel.module.css`、`CompactionStatsPanel.module.css`、
`web/src/features/usage/charts/`（`chartPrimitives.tsx` + 五个图表 + 各自 module.css）、
`web/src/features/monitor/MonitorPage.tsx` 与 `MonitorPage.module.css`、
`web/src/app/AppShell.tsx` 与 `AppShell.module.css`、
`web/src/features/monitor/pulseModel.ts`（**实现子 agent 已写出的纯函数层**，本文件与它对齐）、
`web/src/components/{Panel,Skeleton,EmptyState,ErrorState,SegmentedControl,Icon,Button}`、
`web/src/styles/global.css` 与 `animations.css`、`web/src/lib/format.ts`、
`src-tauri/src/lib.rs`（`float` 插件的 enter/exit 与 `gui_probe::PROBE_JS`）、
`src-tauri/capabilities/default.json`、`src-tauri/gen/schemas/acl-manifests.json`。

**逐条核对过的既有事实**（后文反复引用，都是实测而不是印象）：

- **纯函数层已经落地**：`pulseModel.ts` 已导出 `LIVE_MS=120_000` / `RECENT_MS=900_000` /
  `recencyOf` / `RATE_BUCKET_MINUTES=60` / `rateBuckets(records, now, minutes)`（返回
  `{ start, tokens, partial }[]`，最后一桶 `partial: true`）/ `recentRate(records, now, windowMs)` /
  `CONTEXT_PANEL_DEFAULT_COUNT=40` / `contextPanel(records, events, count)` 返回
  `{ samples, anchors }` / `COMPACTION_BAND_MIN_SAMPLES=3` / `COMPACTION_BAND_MAX_SAMPLES=5` /
  `compactionBand(events)` 返回 `{min,max,n}` 或 `{insufficient:true,n}` /
  `sessionRows(inputs, now)` 返回 `SessionRow[]`（`path / title / projectLabel / ageMs / recency / lastActivityMs`）。
  **组件层只需要取用，不得重算。**
- **`contextPanel.anchors` 只带 `beforeIndex` / `afterIndex` / `eventId`**（`CompactionAnchor` 的原形），
  **不带 `trigger`**。这决定了本文件「自动 / 手动压缩不做颜色区分」这条裁决（§5.4）。
- **图表语言**：所有图表都是「`viewBox` + `width:100%; height:auto` 的 SVG，等比缩放」
  （`chartPrimitives.module.css` 的 `.chart`）。**所以渲染高度 = 容器宽 × viewBox 高 ÷ 720**。
  这是本文件把「曲线高度账」写成一张换算表的唯一原因（§3.2 / §5.2）。
- **大面积填充只许 `-soft`，实色只给描边、点、小徽标**（`design.md §6`；`StackedBar.tsx`、
  `BarChart.module.css`、`HBarChart.module.css` 三处逐字注释）。柱 = `-soft` 填充 + 1px 实色描边。
- **`--border` 与 `--border-strong` 是 rgba 半透明发丝线**：复合到面板底之后，浅色下分别只有
  **1.23 / 1.47**、深色下 **1.20 / 1.52**（§8.3 实算，等效十六进制也写在表里）。它们只能做
  「层级提示」，**不得承载任何要读的图形**——本文件里断崖线、参考带边、「现在」线的候选色
  都被这条否掉了。
- **`--chart-1` 与 `--chart-4` 的相邻比值只有 1.13–1.46**（四个主题逐条实算，§8.3 表 D）：
  在 1px 虚线上不足以区分「自动 / 手动」。`--chart-*` 另有一条硬规则：
  **严禁借去表达项目 / 模型 / 日期**（`tokens.css` 的 `--cat-*` 注释逐字）。新近度是时间维度，
  因此 `--chart-*` 也不能拿来给新近度上色。
- **颜色资产已经被占满**：`--cat-*`（记录类别）、`--chart-*`（系列顺序）、`--cal-1..4`
  （日期成本四分位）、语义三色（确定性：`--success` 确定的读数 / `--warning` 非确定信息 /
  `--danger` 确定的错误）、`--accent`（焦点环、链接、选中底，像素占比 < 3%）。
  **留给本轮的现成色位是零**（§2.3 的裁决由此而来）。
- **`--dur-pulse: 1400ms`** 是 tokens.css 里唯一的**循环语汇**令牌（注释逐字：「这是**循环**语汇，
  与上面四档**过渡**语汇不同，所以单列一档」）。
- **`prefers-reduced-motion` 是全局兜底**：`global.css` 把所有 `animation-duration` 归零、
  迭代次数归 1。因此**任何关键帧的终帧必须是「静止可见」的形态**（`cca-breathe` 的注释与
  `Skeleton.module.css` 的注释都写了同一条）。
- **SVG 上的 `transform: scale()` 需要元素是块级**；`Skeleton` / `EmptyState` / `ErrorState`
  的三档语义（`page` / `panel` / `inline`）与 `Button` 的 `variant` 是全站唯一来源。
- **`core:window:default` 不含拖动权限**——已到 `src-tauri/gen/schemas/acl-manifests.json` 核对：
  `core:window` 的 `default_permission.permissions` 共 28 条，**没有任何一条含 `drag`**
  （`allow-start-dragging` 在 `permissions` 里存在，但不在 `default` 集合里）。
  即 design.md §6 的猜测成立，本文件把它写成已核实事实（§7.4）。
- **浮窗几何是后端常量**：`FLOAT_WIDTH=420.0`、`FLOAT_HEIGHT=620.0`
  （`src-tauri/src/lib.rs:422-423`），主窗口 `minWidth: 960`（`tauri.conf.json`）。
  两者不会重叠，所以「≤420px 紧凑档」只有浮窗会命中。
- **`--sp-*` 只有八档**：`--sp-05(2) / --sp-1(4) / --sp-15(6) / --sp-2(8) / --sp-3(12) /
  --sp-4(16) / --sp-5(24) / --sp-6(32)`。**描边宽度、图形尺寸、图表 viewBox 高属「形」**，
  不进间距档位（tokens.css 头部的形距豁免，日历那轮已立此规矩）。

---

## 1. 层级与布局

### 1.1 页面骨架（非浮窗态）

```
MonitorPage（受控分段容器，design.md §6）
└─ 分段控件：脉搏 | 外部仪表盘
   └─ PulsePage  [data-probe="pulse-page"]
      ├─ pulseHead   [data-probe="pulse-head"]
      │    ├─ SegmentedControl（脉搏 | 外部仪表盘）
      │    ├─ 刷新状态行  [data-probe="pulse-refresh-state"]
      │    └─ 「悬浮」按钮
      ├─ Panel「5 小时窗口」   [data-probe="pulse-window-card"]
      ├─ Panel「最近 60 分钟」 [data-probe="pulse-rate-curve"]
      ├─ Panel「活跃会话」     [data-probe="pulse-sessions"]
      └─ Panel「上下文填充」   [data-probe="pulse-context-curve"]
```

**单列、四个整行带，不做两列棋盘。** 三条理由，每条都可复核：

1. **SVG 是等比缩放的**：960 窗下内容区约 936px，两列后图表只剩 436px 宽，
   速率曲线（viewBox 高 140）渲染出来只有 **85px** 高，低于可读高度。
   用量页把图表放进 520px 量级的列正是同一个原因（`BillingWindowCard.module.css`
   的 `.sideStack { flex: 2 1 520px }` 逐字注释：「它的 SVG 是 width:100% + viewBox，
   独占整行会被放大到约 1.9 倍」）。
2. **整行是唯一能让两张曲线共用同一把横尺的排法**：速率曲线的 60 格与上下文曲线的
   40 个样本都靠「一个 x 像素格 = 一个桶 / 一次调用」读形状，面板宽度不同则两张图的
   横向密度语言分裂。
3. **浮窗只有一列**。若桌面用两列、浮窗用一列，同一份数据要维护两套列预算；
   单列则浮窗只是「同一条带子变窄」，布局代码零分叉。

### 1.2 顺序与权重（数字优先，与用量总览同款取舍）

| 序 | 面板 | 回答的问题 | 权重（视觉） | 顺序理由 |
| --- | --- | --- | --- | --- |
| 0 | `pulseHead` | 这是哪个视图 / 读数新不新 | 最低（`--fs-sm` 标题、`--fs-xs` 状态） | 视图身份先于内容（`UsageOverviewPage` 的 `.headerControls` 同款） |
| 1 | 5 小时窗口 | 烧得多快、还剩多久 | **最高**（读数 `--fs-md`/600/tabular，页面上唯一的五数并排） | 用量总览也把 KPI 行放在第一屏最上；「此刻」最常被看的就是这一行数 |
| 2 | 最近 60 分钟 | 此刻的节奏 | 中（一条曲线 + 一个 caption） | 它是第 1 块的时间切片，紧邻才能对上 |
| 3 | 活跃会话 | 谁在写 | 中（一张最多 4 行的表） | 解释「为什么在烧」——是第 1、2 块的原因 |
| 4 | 上下文填充 | 离被压缩还有多远 | 中（一条曲线 + 一条参考带） | 最长的单次叙事（40 次调用 + 压缩史），放最后 |

**为什么不是「活跃会话」打头**：会话行是一张会随活动增删的表，高度不定；把它放第一位，
第一屏会不会装得下「烧得多快」就取决于当时开着几个会话。**数字优先**的页面里位置不能是随机的
（用量总览把 KPI 钉在第一行的同一个理由）。

### 1.3 间距档位（只写 `--sp-*` 名）

| 位置 | 值 | 说明 |
| --- | --- | --- |
| `.pulsePage` 内边距 | `var(--sp-3)` | 与 `UsageOverviewPage .page` 逐字一致 |
| `.pulsePage` 纵向 gap | `var(--sp-3)` | 同上 |
| `.pulseHead` 横向 gap | `var(--sp-2) var(--sp-3)` | 窄容器下折行（`flex-wrap: wrap`） |
| Panel 内边距 | Panel 自带（`--sp-3`） | 不覆盖 |
| 读数网格 gap | `var(--sp-2) var(--sp-4)` | 与 `BillingWindowCard .readouts` 同款 |
| 读数「标签到数值」 | `var(--sp-05)` | 与 `.readout` 同款 |
| 图表 caption 上外边距 | `var(--sp-1)` | 与 `BarChart.module.css .caption` 逐字一致 |
| 面板脚注上外边距 | `var(--sp-2)` | 与 `CompactionStatsPanel .legend` 的上边距同档 |
| 会话行内边距 | `0 var(--sp-1)` | 与 `.attributionRow` / `.dayRow` 同款 |
| 会话行网格 gap | `var(--sp-2)` | 同上 |
| 会话行之间 | `0`（内阴影发丝线） | `.dayRows li + li` 的既有做法 |
| 浮窗紧凑档内边距 / gap | `var(--sp-2)` / `var(--sp-2)` | 见 §7.2 |
| 浮窗细头内边距 / gap | `0 var(--sp-2)` / `var(--sp-2)` | 见 §7.3 |

**禁止事项**：面板体里不出现第二层 `--bg-subtle` 卡片（卡中卡）。需要分组时用 `--bg-inset`
内嵌块 + 发丝边框（`BillingWindowCard .weekly` / `.attribution` 的「卡里的仪器块」语言）。
本轮**没有**这样的内嵌块需求——四个面板的内容都是单一形态。

### 1.4 首屏预算（两档窗口逐个算）

常量（100% 字号）：Panel 表头 `40px`（`Panel.module.css .header` 的 `min-height`）、
标签行 `--lh-xs = 16`、数值行 `--lh-md = 22`、`.pulsePage` 内边距与 gap 各 `--sp-3 = 12`、
`--row-pad-y-tight = 4`、会话行高 `4×2 + 16 = 24px`。

| 段落 | 高度（100% 字号，960 宽窗） | 高度（浮窗 420 宽） |
| --- | --- | --- |
| 页内边距上 + 页头 + gap | 12 + 32 + 12 = **56** | 8 + 16 + 8 = **32** |
| 5 小时窗口面板 | 40 + (12 + 16+2+22 + 12) = **104** | 40 + (8 + 3×40 + 2×8 + 8) = **192** |
| 最近 60 分钟面板 | 40 + (12 + 177 + 20 + 12) = **261** | 40 + (8 + 123 + 20 + 8) = **199** |
| 活跃会话面板（4 行封顶） | 40 + (12 + 4×24 + 24 + 12) = **184** | 40 + (8 + 4×24 + 24 + 8) = **176** |
| 页内边距下 | 12 | 8 |

- **960×640（应用最小窗）**：主区高 `640 − 48 = 592`。`56 + 104 + 12 + 261 = 433`，
  活跃会话面板从 433 起、到 617 被折线切开——**首屏必装的是第 1、2 块，第 3 块露出表头与三行**。
- **1400×900**：主区高 852（曲线渲染高变成 263，面板 347）。
  `56 + 104 + 12 + 347 + 12 + 184 + 12 = 727`，上下文面板从 739 起，852 处露出表头加半个曲线。
- **浮窗 420×620**：主区高 `620 − 32(细头) = 588`。`32 + 192 + 8 + 199 = 431`，
  活跃会话从 439 起，588 处露出表头与约四行。**浮窗不承诺一屏装下四块**——它是常驻窗，
  纵向滚动到「上下文填充」是正常路径；承诺的是**首屏必装 5 小时读数 + 速率曲线**。

> 纵向滚动由 `AppShell .content { overflow: auto }` 承担，本轮不新增滚动容器。
> **横向一律不滚**：没有任何面板设 `min-width`，所有网格轨道都是 `minmax(0, …)` 或 `auto`，
> 长文本一律 `overflow: hidden; text-overflow: ellipsis`（§7.2 有 420px / 130% 的逐项账）。

---

## 2. 活跃会话行

### 2.1 一行装四件事：三档新近度字形 + 标题 + 项目 + 「多久前有新记录」

```html
<li class="pulseRow" data-probe="pulse-session-row" data-recency="live">
  <button type="button" class="pulseRowButton" data-probe="pulse-session-open"
          title="打开会话 · 最后写入 14:03:12" data-path="…">
    <span class="pulseRowTick" data-probe="pulse-session-tick" aria-hidden="true"></span>
    <span class="pulseRowTitle">重构导出流程</span>
    <span class="pulseRowProject">cc-analyzer</span>
    <span class="pulseRowAge">12 秒前有新记录</span>
  </button>
</li>
```

- 网格：`grid-template-columns: 14px minmax(0, 1fr) auto auto`，`gap: var(--sp-2)`，
  `align-items: center`，`padding: 0 var(--sp-1)`，
  行高 `calc(var(--row-pad-y-tight) * 2 + var(--lh-xs))`（**24px @100% / 28.8px @130%**）。
  第 1 列的 14px 与字形的 12px 是「形」，不进间距档位（同 `.attributionRow` 的 56px 列）。
- 行与行之间用 `box-shadow: inset 0 1px 0 var(--border)` 画发丝线，**不占布局高度**
  （`.dayRows li + li` 的既有做法），列表高 = 行数 × 行高，真机门禁可以拿这个等式对账。
- 整行是 `<button>`（点行打开会话，复用用量页的 `onOpenSession` 握手）。悬停底用
  `--bg-active` 而不是 `--bg-hover`——浅色主题下 `--bg-hover` 与面板底同色，悬停看不见
  （`.attributionRow` / `.dayRow` 两处都踩过并写了注释）。
- 「N 秒 / N 分钟前有新记录」按 R2 逐字出现在每一行，不缩写、不搬进 `title`：
  这是行里唯一一句完整事实，它也是新近度字形的文字等价物（§9.1）。

### 2.2 三档新近度的视觉编码：**几何为主、色阶为辅、动效只给 live 一档**

| 档 | 条件（`recencyOf` 输出） | 字形 | 高度 | 填充 | 行标题色 | 动效 |
| --- | --- | --- | --- | --- | --- | --- |
| `live` | `age ≤ 120s` | 10px 宽圆角方块（`--r-xs`） | **12px** | `--text` | `--text` | 心跳（§9.3） |
| `recent` | `120s < age ≤ 900s` | 同上 | **8px** | `--text-secondary` | `--text-secondary` | 无 |
| `idle` | `age > 900s` | 同上 | **4px** | `--text-tertiary` | `--text-secondary` | 无 |

**两个通道，缺一不可**：

- **高度阶梯是主通道**（12 / 8 / 4px）——它有仓库内先例并且已经写过理由：日历一日回望的活动块
  「**高**编码密度（4 / 8 / 12px）——密度是几何而不是颜色，四块主题共用一个值、
  不需要 opacity 台阶」（`UsageCalendarPanel.module.css` 逐字）。几何通道在灰度截图、
  色觉障碍、四个主题下**恒定不变**。
- **色阶是辅通道**（`--text` / `--text-secondary` / `--text-tertiary`）。再加一条**标题提权**：
  `live` 行的标题是 `--text`，其余行是 `--text-secondary`——这是本轮唯一的「此刻」层级信号，
  不花一个颜色。
- 字形挂 `aria-hidden="true"`：三档的完整事实已经写在行内文字里（「12 秒前有新记录」），
  读屏不必把同一个事实读两遍。
- 字形**不用圆形**：全站没有圆形点（`.projectDot` / `.swatch` / `.legendSwatch*` 都是圆角方块），
  圆点会成为第五种「形」。

### 2.3 「颜色资产已满」的裁决：**零新增令牌**

新近度字形是三块 10×12px 的填充。按项目规矩逐个排查可借的色位：

| 候选 | 语义 | 结论 |
| --- | --- | --- |
| `--cat-*` | 记录类别 | **不可借**——「不要借去表达非类别语义，那会同时毁掉『类别』和『被借用的那个维度』」 |
| `--chart-*` | 图表系列顺序 | **不可借**——「严禁互借……再借去表达项目 / 模型 / 日期，两个维度会一起失效」；新近度是时间维度 |
| `--cal-1..4` | 日期成本四分位 | **不可借**——日历那轮已占满，且它是「色即消耗」的单色相阶梯 |
| `--success` / `--warning` / `--danger` | 确定性三档 | **不可借**——新近度是时间，不是确定性；挂上去会污染三档语义 |
| `--accent` | 焦点环、链接、选中底 | **不可借**——已被三件事占满，且明确限定「像素占比 < 3%」 |
| `--border` / `--border-strong` | 半透明发丝线 | **不可借**——复合后只有 1.20–1.52（§8.3），做填充等于用低对比度硬糊 |
| 文字三级阶梯 `--text*` | 文字层级 | **借得**——它就是「中性墨阶」本身，拿它当填充不新增任何语义（本文件的裁决） |

**结论**：三档全部走中性墨阶 + 高度阶梯，**不新增 `--pulse-*` 之类的色带**。
一条反对新色带的正面理由：新近度是**每 5 秒就可能翻档**的状态，一档一个色相会让同一行
在两个主题下反复换色、把「安静、可核对」的页面变成信号灯；而高度阶梯翻档时只是长高 4px，
视觉上仍然安静。

### 2.4 面板与脚注

- Panel 标题：「活跃会话」。行数上限 **4 行**（`--pulse-rows-max: calc(var(--pulse-row-h) * 4)`，
  超过则面板体内部竖滚——`.dayRows` 的 `max-height` + 内部滚动是既有先例）。
  4 而不是 5：§1.4 的首屏账靠这 24px 才把速率曲线留在第一屏。
- 面板脚注（`--text-tertiary` / `--fs-xs`）逐字：
  `只陈述「多久前有新记录」，不代表会话正在运行。`——这是 R2 与 design.md §8 的口径，
  写在面板上一次，不写进每一行。
- 行内 `title`：`打开会话 · 最后写入 {HH:MM:SS}`。**不设禁用态**：读不到活动时间的会话
  已经被 `sessionRows` 剔掉，所以本列表里没有「装了但点不动」的行。

---

## 3. token 速率曲线（最近 60 分钟）

### 3.1 复用哪些原语、为什么不复用 `BarChart`

- **复用**（`web/src/features/usage/charts/chartPrimitives.tsx` 与 `.module.css`）：
  `niceAxisMax` / `axisTicks` / `formatAxisValue` / `GridLine`，以及 `.chart` / `.tickText` /
  `.numeric` / `.gridLine` / `.axisLine` 五个类。取值口径与用量页逐字相同
  （1/2/2.5/5×10ⁿ 轴、tabular-nums 刻度）。
- **不复用 `BarChart`**：它没有「某一桶是未完成的」这条表达，为它加 `partialIndex` 会把一个
  脉搏专属概念塞进用量页的共享图表，并且会波及用量页已入库的截图基线。新增
  `web/src/features/monitor/pulseCharts.tsx` 里的 `RateCurve`，在共享原语上手绘
  （`StackedBar` / `Heatmap` / `HBarChart` 三个都是这个做法）。
- 组件 props：`{ buckets: RateBucket[]; compact?: boolean }`，数据一律来自
  `pulseModel.rateBuckets(records, now)`，组件内**不做任何分桶或求和**。

### 3.2 几何与高度账

- `viewBox = "0 0 720 H"`，`H = compact ? 230 : 140`。
  `padLeft = 56 / padRight = 10 / padTop = 8 / padBottom = 22`（与 `BarChart` 逐字相同）。
- 60 个等宽槽位：`slot = plotWidth / 60`；柱宽 `min(slot * 0.72, 44)`；
  柱**底边贴基线、向上生长**（不折尾、不做面积填充）。
- 空桶（该分钟 0 token）**保留一条 1.5px 的短痕**（`BarChart` 的 `minimumBarHeight = 1.5` 先例）：
  「这一分钟没有记录」是一个事实，不是渲染失败。
- y 轴 `niceAxisMax(max(buckets.tokens))`、3 格刻度；x 轴每 10 分钟一个 `HH:mm` 刻度
  （60 桶取 10 个标签），首尾贴边对齐（`.axisTickStart/End` 同款，任何视口都不越界）。

| 场景 | 容器宽（SVG 宽） | `H` | 渲染高 |
| --- | --- | --- | --- |
| 1400 窗 · 整行 | 1376 − 2(边框) − 24(内边距) = 1350 | 140 | **263** |
| 960 窗 · 整行 | 936 − 2 − 24 = 910 | 140 | **177** |
| 浮窗 420 · 紧凑 | 420 − 16(页内边距) − 2 − 16(面板内边距) = 386 | 230 | **123** |
| 960 窗 · 若放进半列 | 436 | — | 85（**已否决**，§1.1-1） |

### 3.3 最后一个未走完的分钟：三个几何通道，一个都不是「压淡」

`rateBuckets` 的最后一桶 `partial: true`（桶 = `[本分钟起点, now)`）。它**不做任何外推**，
高度就是**此刻已记录的 token 数**。为了让读者不把它当成「一个很低的整分钟」，用三个
**形状**通道同时声明：

1. **填充换成 45° 斜纹**：`<pattern patternUnits="userSpaceOnUse" width="4" height="4">` 里
   一条从 `(0,4)` 到 `(4,0)` 的 1px 线，`stroke: var(--chart-1)`。1px 线 / 4px 周期的墨量
   约为 25%，与其它柱的 `--chart-1-soft`（alpha 0.24）**视觉重量相当**——也就是说它不是靠
   「变淡」被区分，而是靠「变成纹理」被区分。
2. **轮廓换成虚线**：`stroke: var(--chart-1); stroke-width: 1; stroke-dasharray: 3 2`，
   其余柱是实线 1px。
3. **右边界画一条「现在」参考线**：`x = 最后一槽的右边界`，从 `padTop` 到基线，
   `stroke: var(--text-tertiary); stroke-width: 1; stroke-dasharray: 2 3`，`aria-hidden="true"`。
   它同时承担「x 轴右端 = 现在」这一个刻度事实。

> `<pattern>` 的 `id` 必须按实例唯一（`useId()`）。单测会同时挂两个图表实例，
> 复用同一个 `id` 会让后一个图案取到先定义的那一份（WebKit 尤其明显）。

### 3.4 色值：全部既有令牌（四个主题逐条见 §8.3 表 B）

| 部位 | 令牌 | 备注 |
| --- | --- | --- |
| 柱填充（正常桶） | `--chart-1-soft` | 大面积填充只许 `-soft` |
| 柱描边（正常桶） | `--chart-1` | 1px 实色，收轮廓 |
| 柱填充（未完成桶） | 斜纹，线色 `--chart-1` | 见 §3.3-1 |
| 柱描边（未完成桶） | `--chart-1`，虚线 | 见 §3.3-2 |
| 「现在」参考线 | `--text-tertiary` | 不用 `--border-strong`（浅色下只有 1.47） |
| 轴 / 网格 / 刻度 | 来自 `chartPrimitives`（`--border` / `--border-strong` / `--text-tertiary`） | 不覆盖 |

### 3.5 caption 与无障碍摘要

- **caption**（`--text-tertiary` / `--fs-xs`，`margin-top: var(--sp-1)`）逐字：
  `每分钟四类 token 之和；最后一根是进行中的这一分钟。`——它回答「一根柱是什么」，
  与 `BarChart.caption` 的既有用途同款。
- **`role="img"` 的 `aria-label` 模板**逐字（`{HH:mm}` 用 `formatClock`）：

```
近 60 分钟每分钟的 token 量；峰值 {formatTokenCount(max)} 在 {HH:mm}；
当前分钟进行中，已记录 {formatTokenCount(last.tokens)}。
```

  当 60 桶全为 0 时用：`近 60 分钟没有新的 token 记录。`
  （`formatTokenCount` / `formatClock` 来自 `web/src/lib/format.ts`，不另写格式化。）
- 每根柱一个 `<title>`：`{HH:mm}：{formatTokenCount(tokens)} token`；未完成那根追加
  `（进行中）`。

---

## 4. 5 小时窗口读数块

### 4.1 形态：Panel + 一排五读数，**没有表盘**

- Panel 标题：「5 小时窗口」。面板体只有一排读数（5 格），**不画环、不画进度条**。
  理由：表盘是**用量总览**的既有语言（`Gauge` + `BillingWindowCard`），脉搏回答的是「多快」，
  不是「多满」；同一份数字换一种画法画第二遍，等于教用户第二套刻度。
- 网格：`grid-template-columns: repeat(5, minmax(0, 1fr))`，`gap: var(--sp-2) var(--sp-4)`；
  `@media (max-width: 900px)` 与浮窗紧凑档改成 `repeat(2, minmax(0, 1fr))`，
  此时**第 5 格（预测触顶）`grid-column: 1 / -1`**——否则 5 项 2 列会留一个空格子。
- 每格结构 = 标签（`--fs-xs` / `--lh-xs` / `--text-tertiary`）→ `var(--sp-05)` →
  数值（`--fs-md` / `font-weight: 600` / `--lh-md` / `--text` / `font-variant-numeric: tabular-nums`）
  → 可选 sub 行（`--fs-xs` / `--lh-xs` / `--text-tertiary` / tabular）。
  这套「标签小字 + 数值 600 + tabular」与 `CompactionStatsPanel .reading` /
  `BillingWindowCard .readout` 逐字同构，是仓库里的「读数语言」。
- 五个标签全用 `--text-tertiary`，**不做标签强调**：层级靠数值。页面上唯一会「喊」的数值是
  §4.5 的预测触顶（且只在特定条件下），以及 §3.3 的未完成柱。

### 4.2 五个读数（值 / sub / 来源，逐个写死）

| # | 标签（逐字） | 数值 | sub | 来源（不新写数学） |
| --- | --- | --- | --- | --- |
| 1 | `已用` | `formatTokenCount(totalsSum(block.totals))` | 无 | `billingReadoutsOf` 的当前块；**与用量总览表盘同一个函数、同一份输入**（R4 的「逐位相等」） |
| 2 | `窗口关闭` | `formatClock(block.end)` | 未关闭：`还剩 {formatDuration(block.end - now)}`；已关闭：`已关闭` | `BillingBlock.end` |
| 3 | `窗口平均` | `formatTokenCount(rate.tokensPerHour) + "/时"` | 已过时长：`{formatDuration(rate.elapsedMs)} 均值` | `burnRateOf(block, now)` |
| 4 | `近 15 分钟` | `formatTokenCount(recent) + "/时"` | 无 | `pulseModel.recentRate(records, now, 15 * 60_000)`（**实测，不外推**） |
| 5 | `预测触顶` | `formatClock(reachAt)` | `距现在 {formatDuration(reachAt - now)}` | `predictLimitReach(block, limitTokens, now)` |

- 数值的 `title` 带全精度原值（`String(totalsSum(...))` / `String(tokensPerHour)`）——
  「格式化为扫描服务，原值进 title」是 `formatTokenCount` 的既有立场。
- 第 1 格在无预算时**不显示百分比**（R4）。整个面板**不出现任何百分比读数**。

### 4.3 退化形态一：「样本不足」

触发：`burnRateOf` / `predictLimitReach` 返回 `{ insufficientSample: true }`
（窗口已过时长小于 `MIN_SAMPLE_MS = 30 分钟`）。

| 位置 | 长什么样 |
| --- | --- |
| 数值槽 | **不是读数**：`样本不足`，`--fs-base` / `font-weight: 400` / `--text-tertiary`，**不带 tabular-nums**（不是数字就不该占数字位） |
| sub 槽 | `窗口开启不足 30 分钟` |

这与 `BillingWindowCard .valueMuted`（「未选计划」是缺数据的占位，不是读数，不该和真值同权重）
是同一条既有裁决，只是换了词。

**第 4 格「近 15 分钟」永远不进退化态。** 它是窗口内实测，窗口里没记录就是 `0/时`——
「读了是零」与「没有数据」必须分开（`quotaReadout.ts:33-36` 的既有立场）。

### 4.4 退化形态二：「无预算」

触发：`predictLimitReach` 返回 `{ noLimit: true }`（`limitTokens === null` 或非正）。

| 位置 | 长什么样 |
| --- | --- |
| 第 5 格数值槽 | `未设预算`，与 §4.3 同一套 muted 画法 |
| 第 5 格 sub 槽 | `在「设置 → 阈值设置」填入 5 小时预算后可预测` |
| 其余四格 | **完全不变**（消耗、关闭时刻、两个速率都不依赖预算） |

`noLimit` 与 `insufficientSample` **必须长得一样**（同一套 muted 版式）、**文案必须不同**
——一个是「没有分母」，一个是「样本不够」，用户要做的下一步不同（去设置 vs 等 30 分钟）。

### 4.5 预测触顶的 `--warning`：本轮唯一一处语义色的正当用法

- 规则：**当 `reachAt < block.end`（按当前速率会在窗口关闭之前触顶）时，第 5 格数值用
  `--warning`；否则用 `--text`。**
- 理由：`--warning` 的既定语义是「**非确定信息**——估算的成本、未知的定价、先行版、
  未被定价的模型」。预测触顶是页面上唯一一个**外推出来的时刻**，它天然属于「非确定」；
  而 `--success`（确定的读数，本例是第 1–4 格）与 `--danger`（确定的错误）在这里都不成立。
- 「早于窗口关闭」这个条件是**从已有事实读出来的**（`reachAt` 与 `block.end` 都已算出），
  没有新增预测逻辑（R4 的「预测只来自 `predictLimitReach`」仍然成立）。
- 这是**本轮最需要主会话独立复核的判断之一**（§12 有复核清单）：它引入了一个条件着色，
  实现要补一个「触顶早于关闭 / 晚于关闭」两侧的组件测试。

### 4.6 面板脚注

`--text-tertiary` / `--fs-xs` 一行，逐字：

```
速率单位 tokens/小时。窗口平均 = 已用 ÷ 已过时长；近 15 分钟为窗口内实测，两者都不外推。
```

---

## 5. 上下文填充曲线

### 5.1 画什么、不画什么

- **x**：最近至多 40 次调用的序号（左旧右新），来自 `contextPanel(records, events).samples`。
- **y**：`ContextSample.contextTokens`（input + cacheRead + cacheCreation，`contextSeriesOf` 的既有口径）。
- **断崖**：`contextPanel.anchors` 的每个锚点一条竖虚线（已平移到 samples 坐标系，
  窗口外的锚点已由纯函数丢掉）。
- **参考带**：`compactionBand(events)` 的 `[min, max]`——最近至多 5 次**自动**压缩的
  `preTokens` 区间，`n ≥ 3` 才画。
- **不画**：官方上下文上限、任何「还能撑几分钟」的外推、手动压缩的参考带（R5）。

### 5.2 几何与高度账

- `viewBox = "0 0 720 H"`，`H = compact ? 200 : 120`；`padLeft = 56 / padRight = 10 /
  padTop = 8 / padBottom = 22`（与速率曲线同一把尺）。
- `n = samples.length`；`x(i) = padLeft + (plotWidth * i) / max(1, n - 1)`。

| 场景 | 容器宽 | `H` | 渲染高 |
| --- | --- | --- | --- |
| 1400 窗 · 整行 | 1350 | 120 | **225** |
| 960 窗 · 整行 | 910 | 120 | **152** |
| 浮窗 420 · 紧凑 | 386 | 200 | **107** |

### 5.3 四个图层的画法

| 图层 | 画法 | 颜色 |
| --- | --- | --- |
| 参考带 | `y` 从 `max` 到 `min` 的矩形，加上下两条 1px **虚线**边 | 填充 `--chart-1-soft`；边 `--chart-1`，`stroke-dasharray: 4 4` |
| 数据线 | `polyline`，`stroke-width: 2`，`fill: none`，`stroke-linejoin: round` | `--chart-1` |
| 采样点 | **只在断崖两侧**（`beforeIndex` 与 `afterIndex` 两个 x 位置）各画一个 3px 实心方块；其余 38 个点不画（全画会变成噪点） | `--text` |
| 断崖 | 1px 竖直虚线，`x = (x(beforeIndex) + x(afterIndex)) / 2`，从 `padTop` 到基线——它穿过折线的那一段垂直下坠 | 线 `--text-tertiary`，`stroke-dasharray: 2 3` |

**不做面积填充**：数据线是折线，参考带才是「带」。若数据也填成 `--chart-1-soft`，
两种 `-soft` 会撞在同一片颜色上——「同一个颜色必须只表示一件事」。

**断崖线为什么不用 `--border-strong`**：它在浅色下复合只有 **1.47**、深色下 1.52（§8.3 表 B）。
断崖是一条要读的线，不是发丝分层。改用 `--text-tertiary`
（浅 4.78 / 深 5.83 / HC 浅 10.45 / HC 深 10.74，全部过图形门槛 3）。

### 5.4 自动 / 手动压缩**不做颜色区分**（明确裁决）

三条理由，前两条是实测：

1. `contextPanel` 返回的 `CompactionAnchor` **不带 `trigger`**——要区分就得改纯函数契约，
   或让组件另拿一份 `events` 做 `eventId → trigger` 的映射。为一个装饰性差别改契约不划算。
2. 压缩面板既有的「自动 = `--chart-1` / 手动 = `--chart-4`」在**相邻比值上只有 1.13–1.46**
   （§8.3 表 D 实算），挂在 1px 虚线上读不出来。
3. 参考带（自动）已经把「自动」这个语义承载住了；断崖只负责回答「**在哪里掉下去了**」。
   每个断崖的 `<title>` 写清位置，信息没有丢。

### 5.5 参考带的两条退化，加曲线自身的样本不足

| 条件 | 画什么 | 文字（逐字） |
| --- | --- | --- |
| `compactionBand` = `{ min, max, n }` | 画参考带 | caption：`自动压缩前体量 {formatTokenCount(min)}–{formatTokenCount(max)}（最近 {n} 次）` |
| `{ insufficient: true, n }`（n = 0 / 1 / 2） | **不画参考带**，只留文字 | 脚注：`参考带样本不足（n={n}，至少需要 3 次自动压缩）` |
| `samples.length === 0` | 面板体只画一行事实，**不画空轴、不画 0 行** | `这个会话还没有可画上下文体量的调用。`（`.zeroState` / `.dayEmpty` 的既有做法） |
| `samples.length === 1` | 画一个 3px 点，**不画 polyline**（一个点连不成线） | 脚注追加 `样本不足（n=1）` |
| `samples.length === 2` | 画两点之间的直线 | 脚注追加 `样本不足（n=2）` |

> **「n」有两个**：参考带的 n（自动压缩次数，0–5）与曲线的 n（调用样本数，≤40）。
> 正文里一律带单位词（`自动压缩` / `调用`），不留裸 `n=`；aria-label 里两个数分别写全。

### 5.6 无障碍摘要（`role="img"` 的 `aria-label`）

```
最近 {samples.length} 次调用的上下文体量，当前 {formatTokenCount(last)}，最高 {formatTokenCount(max)}；
期间 {anchors.length} 次压缩；自动压缩前体量区间 {formatTokenCount(min)}–{formatTokenCount(max)}（最近 {n} 次）。
```

退化分支把最后一行换成 `参考带样本不足（自动压缩 {n} 次）`；无样本时整体换成
`这个会话还没有可画上下文体量的调用。`。每个断崖线的 `<title>`：
`第 {beforeIndex + 1} 次调用后发生压缩`。

### 5.7 面板

- Panel 标题：「上下文填充」；标题行右侧显示**观察对象的会话标题**（`--text-secondary`，
  `text-overflow: ellipsis`）——否则用户不知道这条曲线是谁的。
- 脚注（`--text-tertiary` / `--fs-xs`）逐字：`样本为每次调用喂给模型的上下文（输入 + 缓存读 + 缓存写）。
  虚线标出压缩发生的位置。`——**只有口径，不写「还能撑多久」**（R5 明令不预测）。

---

## 6. 四态

四态共用一个**状态属性**：`PulsePage` 根节点带 `data-state="loading|empty|error|fresh|stale"`
（一个属性就能让真机门禁与 e2e 判态，不必数 DOM 结构）。面板体按状态整块替换，
页头（分段控件 + 状态行 + 「悬浮」）在四态下**始终在场**，用户随时能切到「外部仪表盘」。

| 态 | 触发 | 页面长相 | 文案（逐字） |
| --- | --- | --- | --- |
| **加载** | 首拍尚未回来 | 面板体位置画骨架（§6.1） | 状态行 `正在读取本地日志…` |
| **空** | 首拍成功但没有会话 | 面板体收成一块整页空态 | `EmptyState size="page"`：标题 `本机还没有会话日志`，描述 `Claude Code 每次运行都会在本机留下日志；有记录后这里会显示实时的消耗脉搏。` |
| **错误** | 首拍即失败 | 面板体收成整页错误态 | `ErrorState size="page"`：标题 `读取本地日志失败`，hint `没能读到会话目录（文件可能正在被写入或被移动）。确认目录可读后重试。`，`onRetry` 接重启一拍；原始异常串只进 `detail`（默认不进 DOM，绝对路径视同敏感数据） |
| **过期** | 已有一份成功读数，本拍失败 | **继续渲染旧读数**，一个字段都不清空；状态行变红并给「重试」 | 状态行 `上次更新 {HH:MM:SS} · 本次读取失败`（`--danger`） |

### 6.1 加载态的骨架：三块拼成内容形状

1. **读数带**：5 个 `SkeletonBar`（`width="value"`，3em，与真值同位，读数到达时宽度不跳）。
2. **曲线位**：一个 `.chartSkeleton`，用 `aspect-ratio: 720 / 140`（**形状等于真图**，
   与 `Skeleton.module.css` 的「把『正在取数』画成内容的形状」同款）；基色 `--bg-hover`，
   跑 `cca-breathe`。**基色本身就是静止可见的形态**（归零动画后留下的是稳定实心块）。
3. **会话行**：`<Skeleton variant="list" rows={3} label="正在读取活跃会话" />`。

**只保留一个 live region**：`Skeleton` 自带 `role="status"`，另外两块骨架的根元素带
`aria-hidden="true"`；页头状态行不再加 `role="status"`（三份重复播报是噪声）。
**三块骨架的容器都必须带 `data-probe-pending`**——`gui-test.sh` 靠它等「还没算完」的那一帧
消失（`Skeleton` 自带，曲线块要手动加）。

### 6.2 过期态的三条红线

- **绝不清空旧读数**：过期态不是第五种版式，只是在**新鲜态**上加了一行红字 + 一个重试按钮。
  这与「失败保留上一份快照」的技术设计（design.md §3）是同一条承诺的两个面。
- 状态行里的时间是**上一次成功那一拍的时刻**（`formatClock(at, true)`），不是当前时刻。
- 过期态**不改变**任何面板的内容与颜色（不整页变灰——那会让「保留的旧读数」看起来不可信，
  而它恰恰是可信的，只是不新鲜）。「重试」按钮用 `Button` 默认 variant，高度 `--control-h-sm`。

---

## 7. 浮窗版（≤420px 宽）

### 7.1 结构

```
AppShell（floating && tab === "monitor" && 子视图 === 脉搏）
├─ PulseFloatHeader   [data-probe="pulse-float-head"]   ← 顶栏被整条替换掉
│    ├─ 拖动把手（形）
│    ├─ 标题「实时脉搏」
│    └─ 「退出浮窗」按钮  [data-probe="pulse-float-exit"]
└─ PulsePage（紧凑档：布局走容器查询，图表高度走 compact 属性）
```

- **顶栏收起**：`floating && tab === "monitor" && 子视图 === 脉搏` 时不渲染 `AppShell .topbar`，
  改渲染 `PulseFloatHeader`。其余标签、以及 iframe 触发的浮窗**保持现状**（R7）。
  子视图状态必须上提到 `AppShell`（design.md §6 已裁决），否则判断不了该不该收顶栏。
- **页头降级**：浮窗态下 `pulseHead` 只留刷新状态行（`--fs-xs`），**去掉分段控件与「悬浮」按钮**
  ——浮窗里没有第二个子视图可切，也没有「再悬浮一次」这回事。

### 7.2 紧凑布局（`@container (max-width: 420px)`）

| 项 | 桌面 | 紧凑（≤420px） |
| --- | --- | --- |
| 页内边距 / gap | `--sp-3` / `--sp-3` | `--sp-2` / `--sp-2` |
| 面板体 | Panel 自带 `--sp-3` | 不覆盖 Panel |
| 5 小时读数 | 5 列 | **2 列**，第 5 格 `grid-column: 1 / -1` |
| 速率曲线 `H` | 140 | **230**（宽度小了，viewBox 要更高才不压成一条线） |
| 上下文曲线 `H` | 120 | **200** |
| 会话行 | 4 行封顶 | 4 行封顶（行高在 130% 下自动变 28.8） |

- **布局走容器查询**（`container-type: inline-size` 挂在 `.pulsePage`），
  **图表高度走 `compact` 属性**（`AppShell` 已知 `floating`）。两者不冲突：主窗
  `minWidth: 960`、浮窗 420，两个容器宽度不会重叠（§0 已核实这两个常量）。
- **横向不溢出的账（420px，含 130% 字号）**：

```
420 − 16（page padding，--sp-2 两侧）
    − 2（Panel 边框 1px 两侧）
    − 16（Panel body padding，--sp-2 两侧）
    = 386  ← 会话行可用宽
386 − 12（tick 形）
    − 24（3 × gap --sp-2）
    − 114（「12 秒前有新记录」8 字，--fs-xs 11px × 130%）
    − 52（项目名最坏两字加内边距）
    = 184px  ← 标题 1fr 的最小兑现宽度（省略号兜底）
```

  两个 SVG 都是 `width: 100%`（无 `min-width`），读数网格轨道全是 `minmax(0, 1fr)`，
  `auto` 列都是短文本——**横向溢出在结构上不可达**。

### 7.3 细头（`PulseFloatHeader`）规格

| 项 | 值 |
| --- | --- |
| 高 | **`--control-h-lg`（32px）**——比顶栏 `--topbar-h`(48) 细一档，不新造高度令牌 |
| 内边距 / gap | `0 var(--sp-2)` / `var(--sp-2)` |
| 底色 | `--bg-subtle` |
| 下边框 | `1px solid var(--border)`（发丝分层，不承载信息） |
| 拖动手柄 | 两条 8px × 1px 短横（`--sp-05` 行距），色 `--text-tertiary`，`aria-hidden` |
| 标题 | `实时脉搏`，`--fs-sm` / 600 / `--text` / `--lh-sm` |
| 退出按钮 | `Button` + `Icon name="close" size={14}` + 文案 `退出浮窗`（`MonitorPage` 的「关闭监控」同款 icon+文字） |
| 拖动区 | **整条细头都是拖动区，只有「退出浮窗」按钮不是** |

```html
<header class="floatHead" data-probe="pulse-float-head" data-tauri-drag-region>
  <span class="floatGrip" aria-hidden="true"></span>
  <span class="floatTitle">实时脉搏</span>
  <button type="button" class="floatExit" data-probe="pulse-float-exit">退出浮窗</button>
</header>
```

- `data-tauri-drag-region` 挂在 `<header>` 上；**子元素（把手、标题）不加该属性**，
  否则 WebKit 下点击子元素不会冒泡成拖动；按钮不加该属性，才点得动。
- 细头是**唯一一条**拖动通道：它是无边框窗口（`set_decorations(false)`）里用户能拖窗口的地方。
  这条实现在真机必须**手动拖一次留证**（R7 的验收条款）。

### 7.4 权限（已核实，只加一条）

- 事实：`core:window:default` 的 28 条权限里**没有任何一条含 `drag`**
  （`src-tauri/gen/schemas/acl-manifests.json`，本文件写作时实测）。
- 落地：`src-tauri/capabilities/default.json` 的 `permissions` 数组追加
  **`core:window:allow-start-dragging`**，一条，不多。PR 描述里写明理由
  （AGENTS.md 对放宽权限的要求），并同步 `.trellis/spec/backend/security-and-permissions.md`
  的「当前已授予」清单。
- 本轮**不新增**任何 Tauri 命令、不新增网络请求（R9）。

### 7.5 浮窗的可见范围

- 浮窗里**不隐藏任何一块面板**：四块都在，纵向滚动到达。理由：浮窗是「常驻副屏小组件」，
  用户看的是同一个仪表；少一块就会让人怀疑「窗口小的时候数据少」——而数据一分不少。
- 浮窗里**不出现**：分段控件、「悬浮」按钮、任何提示「窗口太小」的话。

---

## 8. 三档主题与实测对比度

### 8.1 结论先写：**零新增令牌**

本轮所有新视觉元素都落在既有令牌上（§2.3 / §3.4 / §5.3 逐处给了令牌名）。
四个主题块（普通浅 / 普通深 / 高对比度浅 / 高对比度深）**一行都不用改 tokens.css**。
唯一新增的 CSS 是 `--pulse-rows-max`、`--pulse-row-h` 这类**局部**变量（定义在
`PulsePage.module.css` 的 `.pulsePage` 上，与 `.calendar { --cal-cell: 12px }` 同款）：
它们不是颜色、不参与主题换挡、也不进 `--sp-*` 间距档位（它们是「形」）。

### 8.2 公式与门槛（可复算）

```
通道归一化 c = 分量 / 255
通道线性化 = c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4
L = 0.2126*R + 0.7152*G + 0.0722*B
对比度 = (L_亮 + 0.05) / (L_暗 + 0.05)
```

与 `tokens.test.ts` 里既有的 `luminance` / `contrast` 两个辅助函数同源（Round U §3.1 立的规矩，
本轮复用，不写第二份）。**门槛**：**正文文字 ≥ 4.5**、**大字 / 图形 ≥ 3**
（项目自身另有一条更严的约定：正文 ≥ 7 / 次要 ≥ 4.5 / 三级 ≥ 4.5 / 图形 ≥ 3。
下表把每一行的**档位**写出来，两套门槛不冲突）。

**半透明令牌在表里写成「复合等效色」**：`--chart-1-soft` 与 `--border*` 是 rgba，
表中给出它们**叠在面板底上**的等效十六进制，比值按该等效色计算。复合公式：
`c = fg * a + bg * (1 - a)`，逐通道。

### 8.3 实测结果（四个主题块，逐条）

读表约定：**底 = 该面板的 `--bg-subtle`**。

| 主题 | 面板底 `--bg-subtle` | 内嵌底 `--bg-inset` |
| --- | --- | --- |
| 普通浅 | `#ffffff` | `#f1f3f5` |
| 普通深 | `#14161a` | `#0a0b0d` |
| 高对比度浅 | `#ffffff` | `#eef1f5` |
| 高对比度深 | `#121212` | `#000000` |

**表 A｜文字（前景叠面板底）**

| 用途 | 令牌 | 普通浅 | 普通深 | HC 浅 | HC 深 | 档位 / 门槛 |
| --- | --- | --- | --- | --- | --- | --- |
| 读数、面板标题 | `--text` | `#16181b` **17.79** | `#f0f2f5` **16.15** | `#000000` **21.00** | `#ffffff` **18.73** | 正文 ≥4.5（项目约定 ≥7）达标 |
| 行标题、次要文字 | `--text-secondary` | `#4a5260` **7.87** | `#b4bcc6` **9.44** | `#1f2b3a` **14.34** | `#dcdcdc` **13.66** | 次要 ≥4.5 达标 |
| 标签、脚注、caption | `--text-tertiary` | `#6b7381` **4.78** | `#8b939e` **5.83** | `#33414f` **10.45** | `#c4c4c4` **10.74** | 三级 ≥4.5 达标 |
| 读取失败（过期态状态行） | `--danger` | `#b3261e` **6.54** | `#f0776c` **6.52** | `#a11208` **8.06** | `#ff9d94` **9.37** | 次要 ≥4.5 达标 |
| 预测触顶（早于窗口关闭） | `--warning` | `#946200` **5.24** | `#e0a33e` **8.17** | `#7a4f00` **7.13** | `#ffc75e` **12.12** | 次要 ≥4.5 达标 |
| 链接 / 焦点环 | `--accent` | `#2952cc` **6.62** | `#7fa8ff` **7.72** | `#0b3f9c` **9.52** | `#8ab4ff` **8.97** | 次要 ≥4.5 达标 |

**由表 A 直接推出一条实现规则**：`--text-tertiary` 在**普通浅色的内嵌底**上只有 **4.30**
（`#6b7381` 叠 `#f1f3f5`，低于 4.5）。因此**任何内嵌块（`--bg-inset`）里的文字都改用
`--text-secondary`**（该组合四主题分别是 7.08 / 10.27 / 12.65 / 15.31，全部 ≥7）。
本轮的四个面板里没有内嵌块，这条是写给实现期的防呆。

**表 B｜图形与新元素（前景叠面板底）**

| 元素 | 令牌 | 普通浅 | 普通深 | HC 浅 | HC 深 | 门槛 |
| --- | --- | --- | --- | --- | --- | --- |
| 新近度字形 `live`（12px 高） | `--text` | `#16181b` **17.79** | `#f0f2f5` **16.15** | `#000000` **21.00** | `#ffffff` **18.73** | 图形 ≥3 达标 |
| 新近度字形 `recent`（8px 高） | `--text-secondary` | `#4a5260` **7.87** | `#b4bcc6` **9.44** | `#1f2b3a` **14.34** | `#dcdcdc` **13.66** | 图形 ≥3 达标 |
| 新近度字形 `idle`（4px 高） | `--text-tertiary` | `#6b7381` **4.78** | `#8b939e` **5.83** | `#33414f` **10.45** | `#c4c4c4` **10.74** | 图形 ≥3 达标 |
| 速率柱与上下文折线的**描边**、斜纹线、参考带虚线边 | `--chart-1` | `#2f6b9f` **5.64** | `#82b5e8` **8.39** | `#1c567f` **7.82** | `#7cb8f0` **8.90** | 图形 ≥3 达标 |
| 柱填充、参考带填充（`-soft`，表中为复合等效色） | `--chart-1-soft` | `#cddbe8` **1.41** | `#354658` **1.87** | `#d2dde5` **1.38** | `#394c5d` **2.11** | 面积底（既有豁免） |
| 断崖竖虚线、「现在」参考线 | `--text-tertiary` | `#6b7381` **4.78** | `#8b939e` **5.83** | `#33414f` **10.45** | `#c4c4c4` **10.74** | 图形 ≥3 达标 |
| 断崖两侧的 3px 采样方块 | `--text` | **17.79** | **16.15** | **21.00** | **18.73** | 图形 ≥3 达标 |
| 骨架条（加载态） | `--bg-hover` | `#f1f3f5` **1.11** | `#212429` **1.16** | `#e7ecf2` **1.19** | `#262626` **1.24** | 状态底（豁免，同日历的 0 档空格） |
| **被否掉的候选**：断崖线若用 `--border-strong` | — | `#d4d5d8` **1.47** | `#35373a` **1.52** | `#3f4854` **9.27** | `#9e9e9e` **6.99** | 浅 / 深**不达标**，不用 |
| **被否掉的候选**：断崖线若用 `--border` | — | `#e7e8ea` **1.23** | `#24262a` **1.20** | `#6b7280` **4.83** | `#767676` **4.12** | 浅 / 深**不达标**，不用 |

**表 C｜新近度三档之间的相邻比值**（只在「颜色是唯一通道」时才是门槛，此处为记录）

| 相邻档 | 普通浅 | 普通深 | HC 浅 | HC 深 |
| --- | --- | --- | --- | --- |
| `live` → `recent` | 2.26 | 1.71 | 1.46 | 1.37 |
| `recent` → `idle` | 1.65 | 1.62 | 1.37 | 1.27 |

HC 两档只有 1.27–1.46，低于日历色带自设的「相邻 ≥1.3 / HC ≥1.7」——**那条门槛是给
「只有颜色一个通道」的色带设的**。新近度字形另有高度通道（12 / 8 / 4）与行内文字
（「12 秒前有新记录」），不依赖相邻色差，所以本条只是**记录**，不是缺陷。

**表 D｜自动 / 手动压缩若着色会遇到的相邻比值（实测）**

| 组合 | 普通浅 | 普通深 | HC 浅 | HC 深 |
| --- | --- | --- | --- | --- |
| `--chart-1` vs `--chart-4` | `#2f6b9f` vs `#a67a08` **1.45** | `#82b5e8` vs `#edc14e` **1.27** | `#1c567f` vs `#7a5200` **1.13** | `#7cb8f0` vs `#ffd166` **1.46** |

1px 虚线上 1.13–1.46 的差别读不出来，这就是 §5.4 那条裁决的实测依据。

### 8.4 复现脚本（可直接 `node` 跑，上表每个数字都由它产出）

```js
// 用法：node pulse-contrast.mjs
const chan = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => chan(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// rgba 令牌叠在底上的复合等效色：逐通道 fg*a + bg*(1-a)
const over = (fg, a, bg) => {
  const p = (s) => [1, 3, 5].map((i) => Number.parseInt(s.slice(i, i + 2), 16));
  const [r, g, b] = p(fg);
  const [R, G, B] = p(bg);
  return "#" + [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)]
    .map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
};

const themes = [
  ["普通浅", { panel: "#ffffff", inset: "#f1f3f5", hover: "#f1f3f5",
    text: "#16181b", sec: "#4a5260", ter: "#6b7381",
    chart1: "#2f6b9f", chart1soft: ["#2f6b9f", 0.24], chart4: "#a67a08",
    warning: "#946200", danger: "#b3261e", accent: "#2952cc",
    border: ["#101828", 0.10], borderStrong: ["#101828", 0.18] }],
  ["普通深", { panel: "#14161a", inset: "#0a0b0d", hover: "#212429",
    text: "#f0f2f5", sec: "#b4bcc6", ter: "#8b939e",
    chart1: "#82b5e8", chart1soft: ["#82b5e8", 0.30], chart4: "#edc14e",
    warning: "#e0a33e", danger: "#f0776c", accent: "#7fa8ff",
    border: ["#ffffff", 0.07], borderStrong: ["#ffffff", 0.14] }],
  ["HC 浅", { panel: "#ffffff", inset: "#eef1f5", hover: "#e7ecf2",
    text: "#000000", sec: "#1f2b3a", ter: "#33414f",
    chart1: "#1c567f", chart1soft: ["#d2dde5", 1], chart4: "#7a5200",
    warning: "#7a4f00", danger: "#a11208", accent: "#0b3f9c",
    border: ["#6b7280", 1], borderStrong: ["#3f4854", 1] }],
  ["HC 深", { panel: "#121212", inset: "#000000", hover: "#262626",
    text: "#ffffff", sec: "#dcdcdc", ter: "#c4c4c4",
    chart1: "#7cb8f0", chart1soft: ["#394c5d", 1], chart4: "#ffd166",
    warning: "#ffc75e", danger: "#ff9d94", accent: "#8ab4ff",
    border: ["#767676", 1], borderStrong: ["#9e9e9e", 1] }]
];

for (const [name, P] of themes) {
  console.log("\n### " + name);
  const soft = over(P.chart1soft[0], P.chart1soft[1], P.panel);
  const bs = over(P.borderStrong[0], P.borderStrong[1], P.panel);
  const bd = over(P.border[0], P.border[1], P.panel);
  const row = (label, fg, bg) => console.log(label + "\t" + fg + "\t" + cr(fg, bg).toFixed(2));
  row("text/panel", P.text, P.panel);
  row("sec/panel", P.sec, P.panel);
  row("ter/panel", P.ter, P.panel);
  row("ter/inset", P.ter, P.inset);
  row("danger/panel", P.danger, P.panel);
  row("warning/panel", P.warning, P.panel);
  row("accent/panel", P.accent, P.panel);
  row("chart1/panel", P.chart1, P.panel);
  row("chart4/panel", P.chart4, P.panel);
  row("chart1soft(composited)/panel", soft, P.panel);
  row("borderStrong(composited)/panel", bs, P.panel);
  row("border(composited)/panel", bd, P.panel);
  row("hover/panel", P.hover, P.panel);
  console.log("chart1 vs chart4\t" + cr(P.chart1, P.chart4).toFixed(2));
  console.log("live->recent\t" + (cr(P.text, P.panel) / cr(P.sec, P.panel)).toFixed(2));
  console.log("recent->idle\t" + (cr(P.sec, P.panel) / cr(P.ter, P.panel)).toFixed(2));
}
```

### 8.5 高对比度两块**零改动**的理由

- 新元素里唯一带半透明的是 `--chart-1-soft`（柱填充、参考带填充），它早就有 HC 实色版
  （`#d2dde5` / `#394c5d`，tokens.css 已定义）；**斜纹线的颜色是 `--chart-1`，不是 alpha**
  ——所以未完成柱在 HC 下也是实色，不存在「半透明在纯白上塌缩」的老问题。
- 新近度三档走的是文字阶梯：HC 下 `--text` / `--text-secondary` / `--text-tertiary`
  分别是 21.00 / 14.34 / 10.45（浅）与 18.73 / 13.66 / 10.74（深），
  高度通道不变，三档仍然分开。
- 焦点环、按钮、分段控件全部走既有令牌，HC 自动 3px 环、2px 间隙。

---

## 9. 无障碍与动效

### 9.1 曲线与图形

- 两个 SVG 都是 `role="img"` + `aria-label`（逐字模板见 §3.5 / §5.6）。
  **aria-label 必须含数字**：它替代的是一张图，只说「一张 token 曲线图」等于没替代。
- 图表自身**不可聚焦、不进 Tab 序**（本视图里它们没有交互）；每根柱、每个断崖有一个 `<title>`。
- 装饰性几何挂 `aria-hidden="true"`：新近度字形、「现在」参考线、拖动把手、骨架块。
- 新近度三档的事实**不由颜色独承**：行内文字「12 秒前有新记录」是它的文字等价物。

### 9.2 键盘与焦点

- Tab 序（非浮窗）：分段控件 → 「悬浮」→ 会话行（每行一个按钮）→（过期态时）「重试」。
  图表与面板标题不进 Tab 序。
- 四个 Panel 各自是一个具名 landmark（`Panel` 的 `ariaLabel` 用法），读屏可以按区域跳。
- 焦点环全部走 `--focus-ring-width` / `--focus-ring-offset`（HC 自动 3px / 2px 间隙）。
  会话行是全宽控件，用 `--focus-ring-inset` 负偏移（`.dayRow` 的既有做法：正偏移会被
  列表的 `overflow` 裁掉）。
- 不需要新的 Escape 行为：本视图没有展开 / 收起的面板。

### 9.3 心跳动效：一处、一个理由、两条降级

**触发条件（三条全真才动）**：

1. 列表里存在 `recency === "live"` 的会话行；
2. 页面可见（`document.visibilityState === "visible"`，由 `usePulseFeed` 的可见性状态给出，
   只在可见时挂动画类）；
3. 用户未开启 `prefers-reduced-motion: reduce`。

**动的东西**：那一行的 12px 新近度字形（`aria-hidden`）。**全页面只有这一处**循环动效。

```css
/* web/src/styles/animations.css 追加（与 cca-breathe 同处，理由见该文件头部注释） */
@keyframes cca-heartbeat {
  0%   { opacity: 1;    transform: scale(1); }
  10%  { opacity: 0.62; transform: scale(1.22); }
  22%  { opacity: 1;    transform: scale(1); }
  34%  { opacity: 0.62; transform: scale(1.16); }
  46%  { opacity: 1;    transform: scale(1); }
  100% { opacity: 1;    transform: scale(1); }   /* 终帧必须是静止可见态 */
}
```

```css
.pulseRowTick {
  display: block;               /* transform 需要块级元素 */
  width: 10px;
  border-radius: var(--r-xs);
  background: var(--text);      /* 基色本身就是静止可见的形态 */
}
.pulseRowTick[data-beat="true"] {
  animation: cca-heartbeat var(--dur-pulse) var(--ease-in-out) infinite;
}
```

- **时长复用 `--dur-pulse`（1400ms）**，不新增令牌：tokens.css 把它定义为唯一的**循环**语汇
  （「慢到不抢注意力，快到能看出在动」）。1400ms 一个周期内做一次双跳，折算 43 次/分——
  比真实静息心率慢，这正是「常驻浮窗里的仪器」该有的强度；真实的 75 次/分会把浮窗变成
  一个闪烁的指示灯。**这条请主会话复核**（§12.2 之一）。
- **降级 1（`prefers-reduced-motion: reduce`）**：`global.css` 已全局把 `animation-duration`
  归零、迭代次数归 1；因为终帧等于静止态，归零后留下的是一个**实心 12px 字形**，
  与 `cca-breathe` / `Skeleton` 完全同款立场——不需要在组件里写 JS 分支。
- **降级 2（页面不可见）**：动画类只由条件 1、2 决定挂不挂；轮询本身也已经停
  （design.md §3）。窗口不可见时不保留动画。

### 9.4 字号 130%

- 字号与行高成对乘 `--font-scale`（tokens.css 的既有机制），本文件只**消费**
  `--fs-*` / `--lh-*`，不写裸 px 字号。
- **「形」不随字号缩放**：新近度字形 12 / 8 / 4px、图表 viewBox 高、网格列预算、
  浮窗细头 32px 都是「形」。130% 下会话行高从 24 变 28.8px、字形仍 12px：
  行不会被裁（`--lh-xs` 乘了同一个系数），密度语言不变。
- 130% 下不新增换行：会话行四个槽都在一行内（标题吃省略号）；读数带 5 列在 960 窗下
  每格仍有约 170px，`1.2M/时` 在 `--fs-md × 1.3` 下约 70px。
- 真机门禁按 R8 的条款：HC 与 130% **不进截图基线**，改由几何断言覆盖
  （`scrollWidth <= clientWidth`、曲线与会话行不被裁切）。

---

## 10. `data-probe` 锚点清单

原则沿用既有的「事实在应用、断言在脚本」（`gui_probe::PROBE_JS` + `gui-test.sh`）：
**锚点挂在稳定属性上，不挂可见文案**（文案随数据变，锚点不会）。

| 锚点 | 挂在哪 | 它对应的几何 / 事实 |
| --- | --- | --- |
| `pulse-page` | PulsePage 根节点 | 该视图在场；真机在它上量 `scrollWidth <= clientWidth`（横向不溢出） |
| `pulse-state` | 根节点上的 `data-state` | `loading / empty / error / fresh / stale`，一个属性判四态 |
| `pulse-head` | 非浮窗页头 | 非浮窗态在场、浮窗态**缺席**（顶栏已收起） |
| `pulse-refresh-state` | 刷新状态行 | 文本含 `上次更新 HH:MM:SS`；过期态带 `data-stale="true"` |
| `pulse-float-head` | 浮窗细头 | 浮窗态在场，且自带 `data-tauri-drag-region`（声明层事实，可断言属性存在） |
| `pulse-float-exit` | 「退出浮窗」按钮 | 可点；点后细头消失、`pulse-head` 回来 |
| `pulse-window-card` | 「5 小时窗口」面板 | 面板在场 |
| `pulse-window-readout` | 5 个读数各自的容器，`data-readout="used\|closes\|avg-rate\|recent-rate\|prediction"` | 读数个数恒为 **5**，键序列可逐字断言 |
| `pulse-rate-curve` | 速率曲线 `<svg>`（`role="img"`） | 曲线在场；带 `data-bucket-count="60"` |
| `pulse-rate-bar` | 每根柱，`data-partial="true\|false"` | 计数 = **60**；`data-partial="true"` 恰好 **1** 根（R3） |
| `pulse-rate-now` | 「现在」竖线 | 在最后一槽的右边界：`x ≈ padLeft + (plotWidth/60)*60` |
| `pulse-sessions` | 「活跃会话」面板 | 面板在场 |
| `pulse-session-row` | 每个会话行 `<li>`，`data-recency="live\|recent\|idle"` | 行数 ≥ 0；三档分布可断言（R2 的边界例） |
| `pulse-session-tick` | 行首字形 | 高度 = live 12 / recent 8 / idle 4（**形**，真机可量 `getBoundingClientRect().height`） |
| `pulse-session-open` | 行内 `<button>` | 可点，切到会话分析并打开该会话 |
| `pulse-context-curve` | 上下文曲线 `<svg>`（`role="img"`） | 曲线在场；`data-sample-count` = 实际样本数（≤40） |
| `pulse-context-band` | 参考带矩形 | `n ≥ 3` 时在场，否则**缺席**（R5 的 0 / 2 / 3 / 6 四档断言靠这个） |
| `pulse-context-cliff` | 断崖竖线 | 计数 = 窗口内压缩次数 |
| `pulse-context-note` | 参考带脚注 | 文本含 `自动压缩前体量` 或 `参考带样本不足` |
| `pulse-skeleton` | 加载态容器 | 带 `data-probe-pending`（门禁等它消失再截图） |
| `pulse-empty` / `pulse-error` | 空 / 错态的根元素 | 由 `EmptyState` / `ErrorState` 渲染，锚点由外层包一层 |

- **计数式锚点优先**：`pulse-rate-bar` 计数 60、`pulse-window-readout` 计数 5、
  `pulse-rate-bar[data-partial="true"]` 计数 1——这三条是「曲线画对了」的几何事实，
  比断言某根柱的高度稳得多。
- **禁止裸标签选择器**（`gui-test.sh` 的既有硬规则）：一律 `[data-probe='…']`。
- Rust 侧守卫测试（`lib.rs` 里 `PROBE_JS.contains(...)` 那一族）同步增断
  `pulse-page` / `pulse-rate-bar` / `pulse-window-readout` 三个字符串，
  防实现期把探针段整体改掉而无人察觉。

---

## 11. 明确不做（各自带理由）

1. **不加新颜色令牌、不动 tokens.css**（§2.3 / §8.1）。可借的六个色位逐个排查过，
   全部有既定语义；新近度改用「高度阶梯 + 中性墨阶 + 心跳」三通道表达。
2. **不做两列棋盘**（§1.1）。SVG 等比缩放下半列会让曲线掉到 85px 高。
3. **不画表盘、不画进度环**（§4.1）。那是用量总览的刻度语言，画第二遍等于教第二套刻度。
4. **不给「自动 / 手动压缩」上色**（§5.4）。契约里没有 `trigger`，且相邻比值只有 1.13–1.46。
5. **不给曲线做面积填充**（§5.3）。数据线与参考带都填成 `--chart-1-soft` 会让同一个颜色
   表示两件事。
6. **不在正文里写「已经自动放慢刷新」之类的内部机制说明**。状态行只说事实：
   `上次更新 HH:MM:SS`。间隔自适应的结果用户从时间戳自己看得出来。
7. **不给新近度做「正在运行」的断言**（R2）。新近度只是 mtime 的推论，长时间工具执行期间
   不写日志会被判成「更早」，所以文案固定为「多久前有新记录」。
8. **不预测「还能撑几分钟」、不画官方上限**（R5）。参考带是「最近几次实际压缩前的体量」，
   不是阈值。
9. **不在浮窗里隐藏面板、不新增横向滚动容器**（§7.5 / §1.4）。
10. **不做卡中卡**（§1.3）。四个面板体里各只有一种形态，不需要内嵌块。
11. **不加 `--pulse-*` 色带**（§2.3 的正反两面理由都写在那里）。
12. **不引入新的循环动效**（§9.3）。全页面只有新近度字形这一处。

---

## 12. 实现者清单与复核清单

### 12.1 按改动顺序，逐文件

1. `web/src/features/monitor/PulsePage.tsx`（新）：页头（分段控件 + 状态行 + 「悬浮」）、
   四个 Panel、活跃会话行、四态分支、浮窗细头（或单独拆 `PulseFloatHeader.tsx`）。
   数据只从 `usePulseFeed` 与 `pulseModel.*` 取，**组件里不做任何分桶 / 求和 / 区间计算**。
2. `web/src/features/monitor/PulsePage.module.css`（新）：§1.3 的间距档位、§2.2 的三个字形高度、
   §6 的骨架块、§7.2 的容器查询、`--pulse-row-h` / `--pulse-rows-max` 两个局部变量。
3. `web/src/features/monitor/pulseCharts.tsx` + `pulseCharts.module.css`（新）：
   `RateCurve` 与 `ContextCurve`，复用 `../usage/charts/chartPrimitives`。
4. `web/src/styles/animations.css`：追加 `cca-heartbeat`（§9.3）。
5. `web/src/app/AppShell.tsx`：子视图状态上提 + 浮窗分支收顶栏 + `compact` 传参；
   `MonitorPage` 变成受控分段容器；`onOpenSession` 握手接到脉搏的会话行。
6. `src-tauri/capabilities/default.json`：加 `core:window:allow-start-dragging`（§7.4），
   并同步 `security-and-permissions.md` 的已授予清单。
7. 测试：组件（三档边界 120s / 900s 两侧、未完成柱只有一个、参考带 0/2/3/6 四档、
   两种退化的版式不同文案不同、`--warning` 的两侧）、e2e（浅 / 深 × Chromium / WebKit、
   跨标签数字一致、浮窗 420 无横向溢出）、真机门禁（§10 的探针）。

### 12.2 请主会话**独立复核**的三处判断

这三处是本人（设计师 agent）在取舍上承担了风险、且工程侧最可能不同意的地方，
请主会话读代码、跑断言后各自给一个结论：

1. **§4.5 预测触顶的条件着色**：`reachAt < block.end` 时数值用 `--warning`。
   它把语义色「非确定信息」用在了一个**计算出来的时刻**上，并且引入了一个条件分支。
   复核点：① 这条着色是否会与用量页对「非确定」的既有用法打架；
   ② 两个分支的组件测试是否都写到了。
2. **§9.3 心跳复用 `--dur-pulse`（1400ms）**：一个周期 1400ms 折算 43 次/分，
   比真实静息心率慢。复核点：① 浮窗常驻场景下这个节奏是否仍然「看得出在动」；
   ② 若判定太慢，是新增一个 `--dur-heartbeat` 令牌，还是接受 1400ms——
   本文件的立场是**先用既有令牌**，把「慢」当作「安静的仪器」的一部分。
3. **§2.2 / §2.3 新近度零新色、三档全靠「高度 12 / 8 / 4 + 中性墨阶 + 心跳」**。
   复核点：① 10px 宽、4px 高的 `idle` 字形在真机截图里是否仍然看得见
   （浅色下 4.78、深色 5.83，数值上过了 3:1，但**小尺寸下的可感知性**是设计判断不是算术）；
   ② 若判定需要更强的信号，我建议的下一步是**只加一个** `--live` 令牌给 `live` 一档，
   而不是加三档色带。

**一句话**：这一轮的重量压在三个地方——**零新增颜色令牌**
（新近度用几何 + 中性墨阶 + 一处心跳，把「此刻」的张力放在动效而不是色相上）、
**未完成分钟用形状声明而不是压淡**（斜纹 + 虚线轮廓 + 「现在」参考线，高度仍是实测值、不外推）、
**浮窗与主窗共用同一份布局**（容器查询 + 一个 `compact` 属性，只有页头与图表高度分叉）。
三件事做齐，「实时脉搏」才既安静又可核对，同时真的在「跳动」。

---

## 13. 主会话评审结论（2026-10-15，独立复算后落笔）

### 13.1 复算结果：数字全部对得上

- **§8.4 的脚本抽出来 `node` 跑过一遍**，表 A / B / C / D 的每一个比值逐条一致
  （`text` 17.79/16.15/21.00/18.73、`--text-tertiary` 4.78/5.83/10.45/10.74、
  `--chart-1` 5.64/8.39/7.82/8.90、`--chart-1-soft` 复合 1.41/1.87/1.38/2.11、
  `--border-strong` 1.47/1.52、`--border` 1.23/1.20、`--chart-1` vs `--chart-4`
  1.45/1.27/1.13/1.46、新近度相邻 2.26/1.71/1.46/1.37 与 1.65/1.62/1.37/1.27）。
- **脚本里的每个十六进制色值都与 `tokens.css` 逐个字符相同**（含四个主题块的
  `--chart-1-soft` alpha 0.24 / 0.30 与 HC 两块的实色版本）。
  「`--text-tertiary` 在普通浅色 `--bg-inset` 上 4.30」与
  「`--text-secondary` 四主题 7.08 / 10.27 / 12.65 / 15.31」两条都复现了。
- **间距与高度账全部复算**：`420 − 16 − 2 − 16 = 386`，再减 `12 + 24 + 114 + 52`
  得 184 ✓；`1350×140/720 = 263`、`910×140/720 = 177`、`386×230/720 = 123`、
  `386×200/720 = 107`、`436×140/720 = 85` ✓；首屏 `12+32+12=56`、
  `40+(12+16+2+22+12)=104`、`40+(12+177+20+12)=261`、`56+104+12+261=433` ✓。
  `Panel` 表头 40px、`--lh-xs` 16、`--lh-md` 22、`--row-pad-y-tight` 4、
  `--control-h-lg` 32、`--topbar-h` 48、`--dur-pulse` 1400ms 均与 `tokens.css` 一致。
- **权限事实复核通过**：`src-tauri/gen/schemas/acl-manifests.json` 里
  `core:window.default_permission.permissions` 共 **28** 条，**没有一条含 `drag`**；
  `allow-start-dragging` 在 `permissions` 里存在但不在 default 集合里 ✓。

### 13.2 三处待复核判断的裁决

1. **§4.5 预测触顶用 `--warning`：通过。** `--warning` 在本仓库的既定用法就是
   「非确定信息」，`ProvenanceBadge` 给外推读数挂的正是它；`predictLimitReach`
   是页面上唯一的外推时刻，归它管是自洽的。两条附加要求：① 标签逐字 `预测触顶`
   在两个分支里都不变——语义由文字承载，颜色只是加强，不让没着色那一支读起来像确定值；
   ② 组件测试必须覆盖 `reachAt < block.end` 与 `reachAt ≥ block.end` 两侧。
2. **§9.3 心跳复用 `--dur-pulse`（1400ms）：通过。** 它是 tokens.css 里唯一的循环语汇，
   「慢」正是常驻浮窗需要的强度，且终帧等于静止可见态、`prefers-reduced-motion`
   全局兜底成立。**接受，不新增令牌。** 两条附加要求：① 动画只挂在
   `[data-beat="true"]` 上，减动画时靠全局归零得静止实心块；
   ② 截图脚本在拍脉搏视图前 `page.emulateMedia({ reducedMotion: "reduce" })`，
   否则归档 PNG 会随机停在某一帧（`screenshots.spec.ts` 用的是 `page.screenshot()`，
   没有 Playwright 的动画冻结）。
3. **§2.2 / §2.3 零新增色、三档靠「高度 + 中性墨阶 + 心跳」：暂定通过，留真机复核。**
   算术上三档都过图形门槛 3:1，通道也不止颜色一个。但「4px 高的 `idle` 字形在真机
   截图上是否还看得见」是感知问题，**由主会话在真机门禁截图里亲眼确认**；
   若判不可见，按 §2.3 的备选只加一个 `--live` 令牌给 `live` 一档，不加三档色带。

### 13.3 评审修正（实现必须按修正后的写法做）

**修正一：拖动区用 `data-tauri-drag-region="deep"`，不是裸属性。**
§7.3 写的是「整条细头都是拖动区」，但裸属性在 Tauri 2.12.1 里是 **self-only** 语义。
依据是随包安装的 `tauri-2.12.1/src/window/scripts/drag.js`（`Cargo.lock` 钉的是 2.12.1）：

```js
//   (bare / no value / "true") -> self: only direct clicks on this element trigger drag
//   "deep"                   -> deep: clicks anywhere in the subtree trigger drag
//   "false"                  -> disabled: drag is blocked here (and for ancestors)
if (attr === '') ...
if (attr === 'deep') return true
if (attr === '' || attr === 'true') return el === composedPath[0]
```

同一段脚本里 `CLICKABLE_TAGS`（`BUTTON` / `A` / `INPUT` …）**没有显式拖动属性时会
中断向上查找**——所以「退出浮窗」按钮天然不拖动，不需要额外处理。
落地写法：`<header data-tauri-drag-region="deep">`，把手与标题**不加**该属性，
退出按钮**不加**该属性。真机手动拖动时必须把光标落在把手与标题上都各试一次。

**修正二：字号 130% 的会话行高不是「不被裁」就够。** §9.4 说行高从 24 变 28.8px、
字形仍 12px——这条要求实现用 `calc` 写行高（`calc(var(--row-pad-y-tight) * 2 +
var(--lh-xs))`），而不是写死 24px；否则 130% 下 `--lh-xs` 涨到 20.8px、行反而被裁。
真机几何断言里加一条：130% 下每一行 `scrollHeight <= clientHeight`。

**修正三：面板脚注也受「内嵌底文字」规则约束。** §8.3 推出的防呆
（`--bg-inset` 里的文字一律 `--text-secondary`）本轮没有内嵌块，
但**骨架块**（§6.1 的 `.chartSkeleton`，基色 `--bg-hover`）里的说明文字若日后补上，
同样按内嵌底处理。
