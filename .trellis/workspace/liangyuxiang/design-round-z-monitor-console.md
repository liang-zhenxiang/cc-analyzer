# 「监控台」界面规格（Round Z）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 日期：2026-10-17 ｜ 状态：待主会话独立评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（Issue #225）：在「实时监控」的 `脉搏 | 监控台 | 外部仪表盘` 三段里新增自带的
> **监控台**。它回答的是「今天这一天，谁在烧、烧在哪个项目、出过什么事」，与脉搏的
> 「此刻」分开。**本文件只写视觉与交互规格，不改任何源码。**
> 体例照 `.trellis/workspace/liangyuxiang/design-round-y-milestones.md`：先给裁决，
> 再给层级、`--sp-*`、四态、色值、可复算对比度、高度账、`data-probe` 与实现清单。

---

## 0. 语境与现状（写前逐字读过）

**读过的文件**：`.trellis/tasks/10-17-monitor-console/prd.md`（R1-R12）、同目录
`design.md`（数据契约与组件边界）、`implement.md`、`task.json`；
`.trellis/workspace/liangyuxiang/design-round-y-milestones.md`（体例）；
`.trellis/workspace/liangyuxiang/design-round-w-live-pulse.md`（同一功能的上一轮）；
`web/src/styles/tokens.css`（四个主题块全文）；
`web/src/features/monitor/PulsePage.{tsx,module.css}`、
`pulseCharts.{tsx,module.css}`、`MonitorPage.{tsx,module.css}`、
`usePulseFeed.ts`、`pulseModel.ts`；
`web/src/features/usage/MilestonesPanel.module.css`、
`BillingWindowCard.module.css`、`UsageOverviewPage.module.css`；
`web/src/components/{Panel,SegmentedControl,EmptyState,ErrorState,Skeleton,Button,Icon}.tsx`
与各自的 `.module.css`；`web/src/app/AppShell.{tsx,module.css}`、
`web/src/features/usage/billingReadouts.ts`、`usageAggregations.ts`、
`web/src/features/sessions/types.ts`、`web/src/lib/format.ts`、
`web/src/lib/ansi.ts`、`web/src/styles/focusRing.test.ts`。

**逐条核对过的既有事实**：

- `MonitorPage` 现在是受控两档 `pulse | dashboard`。`dashboard` 档只在点击后才探测
  `monitor_port` / `monitor_ping`；监控台不能挂载任何外部服务调用。
- `usePulseFeed()` 已经提供 `inputs / rows / latest / now / changed / durationMs`。
  监控台与脉搏各持一个 hook 实例，但 `sharedSessionParseCache` 共享解析结果。
- `billingReadoutsOf(inputs, now, weeklyLimitTokens)` 是全站 5 小时窗口数学的唯一入口。
  监控台必须复用它，不能在页面里再写一套窗口。
- `Panel` 的既有几何是：表头 `min-height: 40px`、体 `padding: var(--sp-3)`、
  `--bg-subtle` 面 + 1px `--border`、`--r-md` 圆角。Panel 体里不得再套
  `--bg-subtle` 卡片。
- 读数语言已经定型：标签 `--fs-xs` / `--text-tertiary` -> `--sp-05` ->
  数值 `--fs-md` 或 `--fs-lg` / `font-weight: 600` / `--lh-*` /
  `font-variant-numeric: tabular-nums`。
- 脉搏的「进行中」已经用 **45 度斜纹 + 虚线轮廓** 表达，不靠透明度。监控台的当前
  小时必须复用同一套形状语言。
- `--chart-1` / `--chart-1-soft` 是 token 量的数据墨；`--cat-*` 是记录类别；
  `--cal-*` 是日历色深。三套资产不能互借。
- `--warning` 的既定语义是「非确定信息」。压缩和会话开始都是事实，不得借用它。
  `--danger` 只给确定发生的错误。
- `--text-tertiary` 在普通浅色的页底 `--bg` 上只有 4.38，所以页底状态行必须用
  `--text-secondary`。面板内的脚注仍可用 `--text-tertiary`。
- `focusRing.test.ts` 当前守卫值为：环宽 30 处、正偏移 18 处、内嵌偏移 9 处、
  焦点竖条 7 处、消费令牌规则 34 条。新增项目行与事件行两条全宽按钮焦点环后，
  这些数字要同步改为 32 / 18 / 11 / 7 / 36。
- `Icon` 只有 `sun / moon / settings / refresh / search / close` 六个名字，没有
  压缩、错误、会话开始三种语义图标。本轮不新画 SVG，也不把 `search` 冒充会话。

---

## 1. 三个必须先落的裁决

### 1.1 版式：顶部读数带 + 全宽 24h +「宽窗左榜右流 / 窄窗单列」

**裁决**：

| 容器宽 | 顶部 4 读数 | 24 小时活动带 | 项目热度榜 / 事件流 |
| --- | --- | --- | --- |
| `>= 1180px`（1400 常态） | 一条四列读数带 | 整行 | **左榜右流并排**，`44% : 56%` |
| `< 1180px`（960 常态） | 一条四列读数带 | 整行 | **单列**：先项目榜，再事件流 |
| 130% 字号 | 列数不变，行高随 `--lh-*` 增长 | 列数不变，柱高固定 | 仍按容器宽决定；1400 并排，960 单列 |

1400 下底部按可用宽 `1376 - 12 = 1364` 分配：

- 项目榜：`1364 × 44% = 600.16px`
- 事件流：`1364 × 56% = 763.84px`

960 下不并排。事件流一行有五个槽，半列约 450px 时项目名与详情会被压成几个字，
那已经不是「能读的密度」，只是把同一张表硬塞窄。项目榜需要横向速率条，事件流需要
横向文本信息，两者的最小宽度都高于半列。

**为什么不是「一堆卡片」**：

1. 顶部 4 枚读数共用**一条**有边框的读数带，不是四张小卡。
2. 页面只有 **3 个 `Panel`**：24 小时活动、项目热度、事件流。
3. 项目行与事件行都是无底色、无边框的行；选中态也只加 `--bg-active` 与 2px 竖条。
4. 页面里没有内嵌 `--bg-inset` 仪器块，也没有第二层 `--bg-subtle`。
5. 没有页面级英雄区；视图身份由 `MonitorPage` 的分段控件承担。

页面骨架：

```
MonitorPage
└─ 分段控件：脉搏 | 监控台 | 外部仪表盘
   └─ MonitorConsolePage [data-probe="monitor-console-page"]
      └─ .consoleInner
         ├─ .consoleHead
         │  ├─ 今天的事实句
         │  └─ 刷新状态 / 过期重试
         ├─ .readoutStrip（4 列，一条边界）
         │  ├─ 本窗口已用
         │  ├─ 今天
         │  ├─ 活跃会话
         │  └─ 今天压缩
         ├─ Panel「24 小时活动」
         └─ .board
            ├─ Panel「项目热度」
            └─ Panel「事件流」
```

### 1.2 颜色：同一套 token 数据墨；事件只用中性字形，`--danger` 只给确定错误

**裁决一：24h 带与项目速率条共用 `--chart-1` 色系。**

两者编码的是同一件事的两个切面：24h 带是「今天每个小时烧了多少 token」；项目条是
「近 15 分钟每个项目烧得多快」。同属 token 吞吐，使用同一数据墨是诚实的。区别由
**方向、轴标签和读数**承担，不由色相承担。

- 24h 普通小时：填充 `--chart-1-soft`，1px 描边 `--chart-1`。
- 24h 当前小时：斜纹线 `--chart-1`，贴底色 `--chart-1-soft`，1px 虚线描边
  `--chart-1`。**不降低透明度**。
- 24h 未来小时：不画填充，只保留空时间槽。未来不是 0。
- 24h 过去零值小时：画 2px 高的 `--chart-1` 短桩。0 是一个已经发生的读数。
- 项目速率条：4px 轨道底 `--chart-1-soft`，填充 `--chart-1`。长度 =
  `本行速率 / 榜首速率`；数值同时写在右侧，条不是唯一读数通道。

**不**给不同项目分配 `--chart-2` 到 `--chart-6`。项目名本身就是身份，按行排序已经
足够；一上类别色，项目榜与图表色板的语义会互相污染。

**裁决二：事件流三类只用一个确定语义色。**

| 类型 | 字形 | 颜色 | 理由 |
| --- | --- | --- | --- |
| 压缩 | `⇣`（文字形） | `--text-secondary` | 压缩已经发生，是事实；不是警告 |
| 错误 | `!`（文字形） | `--danger` | 只有确定失败使用错误色 |
| 会话开始 | `＋`（文字形） | `--text-secondary` | 开始不是成功，也不借 `--success` |

三个字形都挂 `aria-hidden="true"`；行按钮的可访问名里写全「压缩 / 错误 / 会话开始」。
错误行的**正文不整行变红**，只在 12px 字形上给 `--danger`，避免一屏出现红色海洋。
压缩前体量未知时写 `压缩前未知`，不写 0，也不挂 `--warning`。

**裁决三：零新增颜色令牌。**

只用 `--text*`、`--chart-1`、`--chart-1-soft`、`--danger`、`--accent`、
`--bg-*`、`--border*`。局部 CSS 变量只放「形」：读数带分隔、速率条高度、
活动带柱高、两栏比例、面板高度。

### 1.3 事件流密度：单行五槽网格，标题与详情分别省略

一行固定五槽：

```
HH:mm | 类型字形 | 项目名 | 会话标题 | 详情
```

布局规则：

- 时间：`max-content`，`font-variant-numeric: tabular-nums`，不缩。
- 字形：12px 固定宽，不缩。
- 项目：`minmax(0, 7em)`，自己的省略号落在项目名末尾。
- 会话标题：`minmax(0, 0.9fr)`，省略号落在会话标题末尾。
- 详情：`minmax(0, 1.1fr)`，省略号落在详情末尾。
- 所有槽 `min-width: 0`、`white-space: nowrap`、`overflow: hidden`、
  `text-overflow: ellipsis`。

详情正文：

- 压缩：`自动 · 压缩前 128K` 或 `手动 · 压缩前未知`。
- 错误：`{工具名} · {脱敏首行}`；工具名不缩，预览占剩余宽并省略。
- 会话：`首条记录`。

错误预览的数据上限仍是 **80 个 Unicode 码点**，但一行显示不下 80 个汉字。展示层
按容器宽继续省略；**完整脱敏预览进 `title` 与可访问名**。这不是把 80 字符丢弃，
而是把「扫读摘要」和「完整可读事实」分到两个层级。绝不换行、绝不横向溢出。

可复算的横向预算见 §9.2。

---

## 2. 层级、顺序与间距

### 2.1 顺序与权重

| 序 | 区域 | 回答的问题 | 视觉权重 | 顺序理由 |
| --- | --- | --- | --- | --- |
| 0 | 页头状态行 | 这份「今天」是什么时候读的 | 最低 | 新鲜度先于数字 |
| 1 | 4 枚读数带 | 现在和今天各是多少 | 最高 | 一屏的第一眼先给结论 |
| 2 | 24 小时活动带 | 今天什么时候在烧 | 中高 | 先看全天轮廓，再看项目归因 |
| 3 | 项目热度榜 | 烧在哪个项目 | 中 | 解释 24h 带的峰值由谁组成 |
| 4 | 事件流 | 今天出过什么事 | 中 | 从量到事件，收尾落到可打开的证据 |

项目榜与事件流在宽窗并排，顺序仍是「先榜后流」；视觉阅读方向是左到右，Tab 顺序
也按 DOM 顺序走。

### 2.2 间距档位（只写 `--sp-*` 名）

| 位置 | 值 | 说明 |
| --- | --- | --- |
| `.consoleInner` 内边距 | `var(--sp-3)` | 与脉搏页逐字一致 |
| `.consoleInner` 纵向 gap | `var(--sp-3)` | 页头、读数带、24h、board 共用 |
| `.consoleHead` 横向 gap | `var(--sp-2) var(--sp-3)` | 状态与重试可折行 |
| 读数带单元格纵向内边距 | `var(--sp-2)` | 比 12px 紧凑，保住一屏 |
| 读数带单元格横向内边距 | `var(--sp-3)` | 与 Panel 头对齐 |
| 读数单元格之间 | 1px `--border` 竖线 | 形，不是间距 |
| 读数标签到数值 | `var(--sp-05)` | 同既有 `.readout` |
| 读数数值到副读数 | `var(--sp-05)` | 同上 |
| Panel 内边距 | Panel 自带 `var(--sp-3)` | 不覆盖 |
| 24h 柱之间 | `var(--sp-1)` | 24 根仍读得开 |
| 24h 柱到小时标签 | `var(--sp-1)` | 标签只画 00 / 06 / 12 / 18 / 24 |
| 24h 图到 caption | `var(--sp-1)` | 同脉搏图注 |
| board 两列 gap | `var(--sp-3)` | 窄窗退成纵向同一档 |
| 项目行内边距 | `var(--sp-05) var(--sp-1)` | 行高紧凑 |
| 项目行上下两段 gap | `var(--sp-05)` | 名称行到速率条 |
| 项目行槽间 gap | `var(--sp-2)` | 数值列不粘在一起 |
| 事件行内边距 | `0 var(--sp-1)` | 同 `.attributionRow` |
| 事件行槽间 gap | `var(--sp-2)` | 五槽的最小呼吸 |
| 事件面板头部动作 gap | `var(--sp-1) var(--sp-2)` | 分段控件 / 项目名 / 清除按钮 |
| 骨架内部 gap | `var(--sp-3)` | 同脉搏加载态 |

**禁止事项**：Panel 体里不得出现第二层 `--bg-subtle` 卡片；项目行与事件行不得做成
「卡片列表」；读数带下方不得再放四张说明卡。

### 2.3 为什么本页不是脉搏的放大版

| 脉搏 | 监控台 |
| --- | --- |
| 5 小时窗口、60 分钟、活跃会话、上下文填充 | 今天、24 小时、项目热度、跨会话事件 |
| 曲线表达连续时间 | 活动带表达 24 个离散小时 |
| 单列四块，强调「此刻」 | 顶部读数 + 全天带 + 左榜右流，强调「今天」 |
| 有一处心跳动效 | 零新增动效 |
| 内容多是曲线和上下文 | 内容多是排行与事件事实 |

两页共享仪器语言（中性底、发丝边、tabular 数字、形状优先），但信息结构不同，不能
通过复制脉搏的四张 Panel 来交差。

---

## 3. 顶部 4 枚读数带

### 3.1 结构

`<dl>` 四个读数单元，横向等分；单元格之间用 1px `--border` 竖线，不是四张卡。

```css
.readoutStrip {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
}
```

### 3.2 四枚读数的逐字内容

| 读数 | 值 | 副读数 | 无数据时 |
| --- | --- | --- | --- |
| 本窗口已用 | `formatTokenCount(totalsSum(active.totals))` | `距关闭还剩 ${formatDuration(end-now)}` | `暂无活动窗口`，副读数 `最近 5 小时没有计费窗口` |
| 今天 | `formatTokenCount(todayTokens)` | `本地自然日 · 00:00 至今` | 有会话时 `0` 是合法事实 |
| 活跃会话 | `rows.length` | `最近 5 小时有新记录` | 有会话时 `0` 是合法事实 |
| 今天压缩 | `todayCompactions` | `自动 + 手动` | 有会话时 `0` 是合法事实 |

「本窗口已用」必须与脉搏、用量总览逐位相等。数值的 `title` 写原始整数，不用缩写。

### 3.3 读数带内部样式

- 标签：`--fs-xs` / `--lh-xs` / `--text-tertiary` / 单行。
- 数值：`--fs-lg` / `--lh-lg` / `font-weight: 600` / `--text` / tabular。
- 副读数：`--fs-xs` / `--lh-xs` / `--text-tertiary` / 单行。
- 缺数据占位：`--fs-base` / 400 / `--text-tertiary`，同 `.readoutValueMuted`。
- 读数带高度 100% 字号：`8 + 16 + 2 + 28 + 2 + 16 + 8 = 80px`。
- 130%：`8 + 20.8 + 2 + 36.4 + 2 + 20.8 + 8 = 98px`。

960 下仍保持 4 列：每格可用约 `936 / 4 = 234px`，内容盒约 210px；最长副读数
`最近 5 小时有新记录` 在 130% 下约 143px，不换行。

---

## 4. 项目热度榜

### 4.1 行的形态：名称 + 数值一行，速率条压在下面

项目行是按钮，不是卡片：

```
┌──────────────────────────────────────────────────────────────┐
│ cc-analyzer             12.4K/时   今日 3.1M   4 会话        │
│ ████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└──────────────────────────────────────────────────────────────┘
```

- 第一行：项目名 `1fr`，速率、今日 token、活跃会话数三个 `max-content` 槽。
- 第二行：4px 速率条，横跨可用内容宽，长度 = `本行速率 / max(所有行速率)`。
- 行高 100%：`2 + 16 + 2 + 4 + 2 = 26px`。
- 行高 130%：`2 + 20.8 + 2 + 4 + 2 = 30.8px`。

这样项目名拿到整行宽度，不会像「六列压缩表」那样在 130% 下只剩几个汉字。速率条
仍在同一行内部，不增加第二层卡片。

### 4.2 数值格式

- 项目名：`formatProjectPath(projectLabel, projectPath)`，省略号落在项目名末尾。
- 速率：`${formatTokenCount(ratePerHour)}/时`，tabular。
- 今日 token：`今日 ${formatTokenCount(todayTokens)}`。
- 活跃会话：`${activeSessions} 会话`。
- 排序：速率降序，并列按项目名升序。
- 无速率（全部为 0）时，轨道仍在，填充元素不渲染。

### 4.3 选中态与筛选

- 点击一行：设置项目筛选；再点同一行：取消。
- 选中态：`--bg-active` 底 + 行首 2px `--accent` 竖条 + `aria-pressed="true"`。
- 选中不靠颜色单独成立：`aria-pressed`、事件流头部的 `项目：{label}`、清除按钮
  三个通道同时在场。
- 项目行是全宽按钮，焦点环用 `outline-offset: var(--focus-ring-inset)`，否则会被
  列表 `overflow-y: auto` 裁掉。

### 4.4 颜色与高对比度

| 部位 | 令牌 | 画法 |
| --- | --- | --- |
| 速率条轨道 | `--chart-1-soft` | 4px，`--r-xs` |
| 速率条填充 | `--chart-1` | 4px，实色 |
| 悬停底 | `--bg-active` | 浅色下与面板底有可见台阶 |
| 选中竖条 | `--accent` | 2px |

高对比度两档给轨道壳加 1px `--border-strong` 的 `box-shadow`。不使用 `outline`，
避免 `focusRing.test.ts` 把非焦点描边误判成焦点环字面量。

---

## 5. 24 小时活动带

### 5.1 几何

24 个本地小时槽，CSS Grid 等分，不用等比缩放的 SVG。原因是 SVG 的
`width: 100%` 会让同一张图在 1400 下高 200px、在 960 下高 140px，柱高随容器变化；
监控台需要「同样一段时间在任何宽度下都占同样高度」的仪器感。

```css
.hours {
  --mc-hour-plot-h: 112px;
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  align-items: end;
  gap: var(--sp-1);
  height: var(--mc-hour-plot-h);
}
```

1400 下每个槽约 `(1350 - 23×4) / 24 = 52.42px`；960 下约
`(910 - 92) / 24 = 34.08px`；800px e2e 视口下仍有 `27.42px`，柱不会细到看不清。

### 5.2 三个小时状态，三个不同的事实

这是本规格对 `design.md` 契约的一条必要补强：`ConsoleHour` 除了 `partial`，还必须
能区分 `past / current / future`，或者直接有 `future: boolean`。组件不得自己拿
`hourStart > now` 做时间判断，因为技术设计已经规定组件不做判定。

| 状态 | 画法 | hover / title | 理由 |
| --- | --- | --- | --- |
| 过去且 token > 0 | `--chart-1-soft` 填充 + 1px `--chart-1` 实线 | `HH 点 · N token` | 已发生 |
| 过去且 token = 0 | 2px `--chart-1` 短桩 | `HH 点 · 0 token` | 0 是事实 |
| 当前小时 | 45 度斜纹 + 虚线轮廓，高度为实测值 | `HH 点 · N token（进行中）` | 未走完，不外推 |
| 未来小时 | 无填充，只留空时间槽 | `HH 点 · 尚未到达` | 未发生不是 0 |

斜纹实现与脉搏同语言：

```css
background-color: var(--chart-1-soft);
background-image: repeating-linear-gradient(
  45deg,
  transparent 0 3px,
  var(--chart-1) 3px 4px
);
border: 1px dashed var(--chart-1);
```

1px 线 / 4px 周期约 25% 墨量，与普通柱的 `--chart-1-soft` 视觉重量相当。区分靠
「变成纹理」，不靠「压淡」。虚线 `stroke-dasharray` 等价写成 `1px dashed`。

### 5.3 读数与图注

- 柱高 = `max(实际高度, 状态最低高度)`。过去零值和当前零值最低 2px；未来无柱。
- 不画 y 轴刻度。24h 带是「全天形状」，精确值在每根柱的 title 与可访问摘要里。
- Panel 头部右侧给一个精确锚点：`峰值 14 点 · 3.1M`；全为 0 时写 `今天 0 token`。
- caption 逐字：`每根柱是一小时四类 token 之和；斜纹且虚线的这一小时还在进行中，高度是已记录值，不外推。`
- x 轴只画 `00 / 06 / 12 / 18 / 24` 五个标签，避免 24 个标签在 960 / 130% 下打架。

### 5.4 无障碍摘要

容器 `role="img"`，`aria-label`：

```
今天 24 小时的 token 量；峰值 {formatTokenCount(peak.tokens)} 在 {HH} 点；
当前 {HH} 点进行中，已记录 {formatTokenCount(current.tokens)}；未来小时未计入。
```

全为 0 时：`今天还没有 token 记录。`

每根实际柱带 `title`；未来槽带 `title` 但 `aria-hidden="true"`，因为完整摘要已经在
容器的可访问名里。柱本身不进 Tab 序。

---

## 6. 事件流

### 6.1 头部

Panel 标题「事件流」，`actions` 内从左到右：

1. `SegmentedControl`，`role="radiogroup"`，项：`全部 | 压缩 | 错误 | 会话开始`。
2. 仅项目筛选生效时：`项目：{formatProjectPath(...)}`，`--fs-xs` / `--text-tertiary`，
   `max-width: 12em`，末尾省略。
3. 仅项目筛选生效时：共享 `Button variant="ghost"`，文案 `清除`。

筛选在已算好的 `report.events` 上做，不重新读日志。`report.events` 仍是**全局最近
12 条**；项目筛选与类型筛选可以叠加，但不把窗口扩大到 12 条之外。

### 6.2 一行五槽

```css
.eventRow {
  display: grid;
  min-width: 0;
  height: calc(var(--row-pad-y-tight) * 2 + var(--lh-xs));
  grid-template-columns:
    max-content
    12px
    minmax(0, 7em)
    minmax(0, 0.9fr)
    minmax(0, 1.1fr);
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-1);
}
```

五个槽全部单行。省略号落点：

- 时间与字形：不缩，不省略。
- 项目名：在 `7em` 槽内省略。
- 会话标题：在 `0.9fr` 槽内省略。
- 详情：在 `1.1fr` 槽内省略；错误预览里的工具名保持完整，预览部分先被省略。

每个事件行是 `<button>`，`aria-label` 逐字包含：

```
{HH:mm} · {项目名} · {会话标题} · {压缩|错误|会话开始} · {详情}
```

`title` 使用同一份脱敏后的完整详情。不得把未脱敏原文放进 title。

### 6.3 三类事件

| 类型 | 字形 | 详情 | 可访问文案 |
| --- | --- | --- | --- |
| 压缩 | `⇣`，`--text-secondary` | `自动 · 压缩前 128K` / `手动 · 压缩前未知` | `压缩，自动，压缩前 128K` |
| 错误 | `!`，`--danger` | `Bash · ENOENT: ...` | `错误，工具 Bash，...` |
| 会话开始 | `＋`，`--text-secondary` | `首条记录` | `会话开始，首条记录` |

错误预览的生成规则：

1. 先走 `stripAnsi(record.text)`。
2. 取首行，`\s+` 折叠成一个空格。
3. 把 `/Users/...`、`/home/...`、`/private/...`、`C:\Users\...` 这类绝对路径段
   整体替换为 `…`；宁可少显示，也不把用户名或本机目录带进 UI。
4. 按 Unicode 码点截到 80 个字符；不要用 UTF-16 `slice` 切断代理对。
5. 结果若为空，写 `无错误文本`。

### 6.4 事件列表密度、滚动与状态

- 列表高度 = `board 352 - Panel 头 40 - 体上下 padding 24 = 288px`。
- 100% 字号：行高 24，恰好 12 行，不出现内部滚动。
- 130%：行高 28.8，约 10 行可见，列表内部竖滚到第 12 条；不得裁掉第 12 行。
- 列表 `overflow-y: auto`；行焦点环用 `--focus-ring-inset`。
- 无匹配事件：`EmptyState size="inline"`，文案 `这个筛选条件下没有今天的事件`。

---

## 7. 四态

### 7.1 状态映射

| 状态 | 条件 | 画面 |
| --- | --- | --- |
| `loading` | `snapshot === null && !error` | 内容形状的骨架，不出现假 0 |
| `empty` | `snapshot.inputs.length === 0` | 一条事实行，不渲染读数带 / 三张 Panel |
| `error` | 首拍失败且没有旧快照 | `ErrorState size="page"` + 重试 |
| `stale` | 有旧快照且有 `stale` | 保留全部旧读数，只把状态行标红 + 重试 |
| `fresh` | 有快照且没有 stale | 正常内容 |

### 7.2 加载

```text
[4 个读数条]
[24h 画布形状]
[项目榜形状] [事件流形状]   ← 宽窗并排；窄窗上下
```

- 四读数用 `SkeletonBar width="value"`。
- 24h 用固定 112px 高的 `--bg-hover` 块，不用随机柱高。
- 两个 board 块用 `--bg-hover`，高度 352，带 `data-probe-pending`。
- 只有一个 `role="status"`；其余骨架 `aria-hidden`。
- 禁止在加载态渲染 `0`、`暂无活动窗口` 或空项目行。

### 7.3 空

- 标题：`本机还没有会话日志`
- 描述：`有记录后这里会按今天汇总项目热度、小时活动与事件。`
- 居中舞台与 `PulsePage` 的空态同款，不画空 Panels。

### 7.4 错误

- 标题：`读取本地日志失败`
- hint：`没能读到会话目录（文件可能正在被写入或被移动）。确认目录可读后重试。`
- `detail` 只放原始失败串，默认不挂 DOM。
- 重试通过重挂载 feed view 实现，与脉搏一致。

### 7.5 过期

- 状态行逐字：`上次更新 HH:mm:ss · 本次读取失败`
- 状态行走 `--danger`，右侧出现 `Button` 重试。
- 所有旧读数、项目行、24h 柱、事件流保留原值，不降透明度、不画遮罩。
- 过滤与滚动仍可操作；用户读到的是「上次成功的事实」，不是被清空的页面。

---

## 8. 主题与 WCAG 对比度

### 8.1 零新增令牌

`tokens.css` 一行不改。所有新元素消费既有令牌。局部变量只有：

- `--mc-hour-plot-h: 112px`
- `--mc-project-bar-h: 4px`
- `--mc-board-h: 352px`
- `--mc-time-col`, `--mc-kind-col` 等局部几何

### 8.2 公式与门槛

```
通道归一化 c = 分量 / 255
通道线性化 = c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4
L = 0.2126*R + 0.7152*G + 0.0722*B
对比度 = (L_亮 + 0.05) / (L_暗 + 0.05)

半透明令牌写成复合等效色：c = fg * a + bg * (1 - a)，逐通道
```

门槛：正文文字 `>= 4.5`，大字 / 图形 `>= 3`；项目另有更严约定：
正文 `>= 7`、次要文字 `>= 4.5`、三级文字 `>= 4.5`。

### 8.3 四块主题的底色与数据墨

| 项 | 普通浅 | 普通深 | HC 浅 | HC 深 |
| --- | --- | --- | --- | --- |
| 页底 `--bg` | `#f4f5f7` | `#0d0f12` | `#ffffff` | `#000000` |
| 面板底 `--bg-subtle` | `#ffffff` | `#14161a` | `#ffffff` | `#121212` |
| `--text` | `#16181b` | `#f0f2f5` | `#000000` | `#ffffff` |
| `--text-secondary` | `#4a5260` | `#b4bcc6` | `#1f2b3a` | `#dcdcdc` |
| `--text-tertiary` | `#6b7381` | `#8b939e` | `#33414f` | `#c4c4c4` |
| `--chart-1` | `#2f6b9f` | `#82b5e8` | `#1c567f` | `#7cb8f0` |
| `--chart-1-soft` 复合 | `#cddbe8` | `#354658` | `#d2dde5` | `#394c5d` |
| `--danger` | `#b3261e` | `#f0776c` | `#a11208` | `#ff9d94` |
| `--accent` | `#2952cc` | `#7fa8ff` | `#0b3f9c` | `#8ab4ff` |

### 8.4 文字对比度（叠面板底）

| 用途 | 令牌 | 普通浅 | 普通深 | HC 浅 | HC 深 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 读数、值、选中项目名 | `--text` | **17.79** | **16.15** | **21.00** | **18.73** | 全部 >=7 |
| 项目名、事件标题 | `--text-secondary` | **7.87** | **9.44** | **14.34** | **13.66** | 全部 >=7 |
| 标签、脚注、图注、详情 | `--text-tertiary` | **4.78** | **5.83** | **10.45** | **10.74** | 全部 >=4.5 |
| 确定错误字形 | `--danger` | **6.54** | **6.52** | **8.06** | **9.37** | 图形 / 文字均达标 |
| 选中竖条、焦点环 | `--accent` | **6.62** | **7.72** | **9.52** | **8.97** | 图形 >=3 |

页底状态行例外：

| 用途 | 令牌 | 普通浅 | 普通深 | HC 浅 | HC 深 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 状态行候选（不用） | `--text-tertiary` | **4.38** | 6.18 | 10.45 | 12.04 | 普通浅低于 4.5 |
| 状态行采用 | `--text-secondary` | **7.22** | **10.01** | **14.34** | **15.31** | 全部 >=7 |

因此页头状态行与「今天」事实句一律 `--text-secondary`。面板内的小字才用
`--text-tertiary`。

### 8.5 图形对比度

| 元素 | 前景 / 背景 | 普通浅 | 普通深 | HC 浅 | HC 深 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 24h 普通柱描边 | `--chart-1` / 面板 | **5.64** | **8.39** | **7.82** | **8.90** | >=3 |
| 24h 面积底 | `--chart-1-soft` / 面板 | **1.41** | **1.87** | **1.38** | **2.11** | 面积底豁免 |
| 斜纹线 vs 面积底 | `--chart-1` / `-soft` | **4.00** | **4.48** | **5.66** | **4.21** | >=3 |
| 未来空槽 | 无前景 | 不适用 | 不适用 | 不适用 | 不适用 | 不把未来画成 0 |
| 过去零值短桩 | `--chart-1` / 面板 | **5.64** | **8.39** | **7.82** | **8.90** | >=3 |
| 项目条填充 vs 轨道 | `--chart-1` / `-soft` | **4.00** | **4.48** | **5.66** | **4.21** | >=3 |
| HC 项目条轨道描边 | `--border-strong` / `-soft` | 不启用 | 不启用 | **6.71** | **3.31** | >=3 |
| 悬停底 | `--bg-active` / 面板 | 1.20 | 1.33 | 1.33 | 1.50 | 状态底豁免 |

### 8.6 被否掉的候选

| 候选 | 实测 | 否决理由 |
| --- | --- | --- |
| 项目条轨道用 `--border-strong` | HC 填充 vs 轨道 **1.19 / 1.27** | 已知高对比度塌缩，Issue #215 的同类缺陷 |
| 项目条轨道用 `--bg-inset` | HC 轨道 vs 面板 **1.13 / 1.12** | 轨道本身看不见 |
| 当前小时用 opacity 压淡 | 无几何差异 | 与「这一小时真的很少」撞车，违反形状语言 |
| 压缩用 `--warning` | 语义冲突 | 压缩是事实，不是非确定信息 |
| 会话开始用 `--success` | 语义冲突 | 开始不等于成功 |
| 项目逐项分配 `--chart-2..6` | 语义冲突 | 项目身份与图表系列是两套资产 |
| 事件整行 `--danger` | 视觉噪声 | 一条错误不该染红一整行，12px 字形足够 |

### 8.7 复现脚本

```js
// 用法：node monitor-console-contrast.mjs
const chan = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const parse = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const [r, g, b] = parse(h).map((v) => chan(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, a, bg) => {
  const F = parse(fg);
  const B = parse(bg);
  return "#" + F.map((v, i) =>
    Math.round(v * a + B[i] * (1 - a)).toString(16).padStart(2, "0")
  ).join("");
};

const themes = [
  ["普通浅", {
    page: "#f4f5f7", panel: "#ffffff", text: "#16181b", sec: "#4a5260",
    ter: "#6b7381", chart1: "#2f6b9f", soft: ["#2f6b9f", 0.24],
    danger: "#b3261e", accent: "#2952cc",
    borderStrong: ["#101828", 0.18], active: "#e8ebef"
  }],
  ["普通深", {
    page: "#0d0f12", panel: "#14161a", text: "#f0f2f5", sec: "#b4bcc6",
    ter: "#8b939e", chart1: "#82b5e8", soft: ["#82b5e8", 0.30],
    danger: "#f0776c", accent: "#7fa8ff",
    borderStrong: ["#ffffff", 0.14], active: "#2a2e34"
  }],
  ["HC 浅", {
    page: "#ffffff", panel: "#ffffff", text: "#000000", sec: "#1f2b3a",
    ter: "#33414f", chart1: "#1c567f", soft: ["#d2dde5", 1],
    danger: "#a11208", accent: "#0b3f9c",
    borderStrong: ["#3f4854", 1], active: "#d8e0ea"
  }],
  ["HC 深", {
    page: "#000000", panel: "#121212", text: "#ffffff", sec: "#dcdcdc",
    ter: "#c4c4c4", chart1: "#7cb8f0", soft: ["#394c5d", 1],
    danger: "#ff9d94", accent: "#8ab4ff",
    borderStrong: ["#9e9e9e", 1], active: "#343434"
  }]
];

for (const [name, P] of themes) {
  const soft = over(P.soft[0], P.soft[1], P.panel);
  const borderStrong = over(P.borderStrong[0], P.borderStrong[1], P.panel);
  const row = (label, fg, bg) =>
    console.log(`${name}\t${label}\t${cr(fg, bg).toFixed(2)}`);
  row("text/panel", P.text, P.panel);
  row("sec/panel", P.sec, P.panel);
  row("ter/panel", P.ter, P.panel);
  row("ter/page", P.ter, P.page);
  row("sec/page", P.sec, P.page);
  row("danger/panel", P.danger, P.panel);
  row("accent/panel", P.accent, P.panel);
  row("chart1/panel", P.chart1, P.panel);
  row("soft/panel", soft, P.panel);
  row("chart1/soft", P.chart1, soft);
  row("borderStrong/soft", borderStrong, soft);
  row("active/panel", P.active, P.panel);
}
```

---

## 9. 960 窄窗、130% 字号与不溢出

### 9.1 高度账

常量：顶栏 `48px`；MonitorPage 分段栏 `12 + 28 = 40px`；Panel 头 `40px`；
`--lh-xs = 16px`、`--lh-lg = 28px`；读数带上下 `8 + 8`；24h 画布 `112px`；
board 固定高 `352px`。

**1400×900（主区 852，减去分段栏 40 = 812）**：

| 段 | 100% | 130% |
| --- | --- | --- |
| 上内边距 + 状态行 + gap | `12 + 16 + 12 = 40` | `12 + 20.8 + 12 = 44.8` |
| 读数带 + gap | `80 + 12 = 92` | `98 + 12 = 110` |
| 24h Panel + gap | `40 + 12 + 112 + 4 + 16 + 4 + 16 + 12 + 12 = 228` | `40 + 12 + 112 + 4 + 20.8 + 4 + 20.8 + 12 + 12 = 237.6` |
| board | **352** | **352** |
| 下内边距 | `12` | `12` |
| **合计** | **724** | **756.4** |

1400×872 时主区 824，减去分段栏后 784：100% 余 60，130% 余 27.6。两档都一屏装下。

**960×640（主区 592，减去分段栏 40 = 552）**：

| 位置 | 100% | 130% |
| --- | --- | --- |
| 状态行起止 | `12-28` | `12-32.8` |
| 读数带起止 | `40-120` | `44.8-142.8` |
| 24h 起止 | `132-348` | `154.8-380.4` |
| board 起 | `360` | `392.4` |
| 首屏在 board 内可见 | `192` | `159.6` |
| 项目行可见 | 表头 40 + 体内 12 + **5 行** | 表头 40 + 体内 12 + **3 行** |

960 下 board 单列：项目榜 352，gap 12，事件流 352。首屏先给读数和完整 24h，
然后露出项目榜前几行；事件流纵向滚动到达。1400 下两栏并排，整页一屏。

### 9.2 横向预算（100% / 130%）

**事件流**

1400 并排时事件 Panel 外宽约 `763.84`；Panel 边框减 2、体内边距减 24：
可用宽 `737.84`。

| 字号 | 时间 | 字形 | 项目 | 槽间 4×8 | 标题 + 详情剩余 | 标题约 | 详情约 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100% | 约 34 | 12 | 77 | 32 | 583 | 262 | 321 |
| 130% | 约 44 | 12 | 100 | 32 | 550 | 248 | 302 |

960 单列时事件 Panel 外宽 936，可用宽 910：

| 字号 | 标题 + 详情剩余 | 标题约 | 详情约 |
| --- | --- | --- | --- |
| 100% | 755 | 340 | 415 |
| 130% | 722 | 325 | 397 |

正文估算口径：CJK 约 1em，数字约 0.55em，空格约 0.25em。`--fs-xs` 在 100% 是
11px、130% 是 14.3px。

- 100% 并排：详情约 29 个汉字宽。
- 130% 并排：详情约 21 个汉字宽。
- 960 全宽 130%：详情约 28 个汉字宽。

因此 80 字符预览在窄列必然展示不全；按 §1.3 的裁决，展示层省略，完整脱敏预览进
`title` 与可访问名。

**项目榜**

1400 时项目 Panel 外宽 600.16，可用 574.16。第一行是
`名称 1fr + 速率 max-content + 今日 max-content + 会话 max-content + 3×8 gap`；
第二行速率条横跨 574.16。130% 下四段数值约占
`78 + 74 + 48 + 24 = 224px`，名称仍余约 `350px`。

960 单列时项目 Panel 可用 910，名称余量更大。

### 9.3 130% 不裁行

- 所有行高由 `--lh-*` 与 `--sp-*` 派生，不写裸 px 行高。
- 所有文本槽 `min-width: 0`、单行、省略号。
- 事件列表在 130% 下内部滚动，第 12 条仍可到达；Panel 高度固定不等于裁内容。
- 项目条、24h 柱高、时间槽宽、面板圆角是「形」，不随字号缩放。
- `.consoleInner`、`.board`、所有网格轨道都用 `minmax(0, ...)`。
- 真机门禁在 `monitor-console-page` 上量 `scrollWidth <= clientWidth`。

---

## 10. 无障碍与键盘

### 10.1 语义

- 页面根：`data-state` 五态，`data-probe="monitor-console-page"`。
- 读数带：`<dl>`；每格 `dt` 是标签，`dd` 是值 + 副读数。
- 24h：`role="img"` + 有数字的 `aria-label`；柱子元素 `aria-hidden`。
- 项目榜：每个项目是 `<button aria-pressed>`，速率条 `aria-hidden`，完整信息在
  可访问名里。
- 事件流：每行是 `<button>`；字形 `aria-hidden`；可访问名包含类型与详情。
- 类型筛选：`SegmentedControl role="radiogroup"`。

### 10.2 Tab 序

```text
Monitor 分段控件
→ 过期态「重试」（若在场）
→ 项目行（按榜单顺序）
→ 事件类型分段控件
→ 项目筛选「清除」（若在场）
→ 事件行（按时间倒序）
```

24h 带与读数带不进 Tab 序。

### 10.3 焦点与状态

- 全宽项目行、事件行：`outline: var(--focus-ring-width) solid var(--accent);`
  `outline-offset: var(--focus-ring-inset);`
- 清除按钮与类型筛选沿用共享组件焦点环。
- 项目选中不只靠 `--accent`：同时有 `aria-pressed`、`--bg-active` 与头部项目名。
- 错误不只靠 `--danger`：字形 `!` + 可访问名「错误」+ 详情。
- 当前小时不只靠斜纹：`title` 与 `aria-label` 都写「进行中」。
- 未来小时不只靠空白：`title` 写「尚未到达」。

### 10.4 动效

本轮**零新增动效**。

- 当前小时不呼吸、不闪烁；状态已经由斜纹与虚线表达。
- 项目条不从 0 长出，不做 width 过渡。
- 数字不滚动。
- 允许保留的只有既有骨架 `cca-breathe` 与行悬停 `--dur-hover`。
- 若实现期新增任何动画，必须有 `prefers-reduced-motion: reduce` 降级，并让终帧
  等于静止可读态；本规格不批准新的循环动效。

---

## 11. `data-probe` 锚点清单

原则：锚点挂稳定属性，不挂可见文案；禁止裸标签选择器。

| 锚点 | 挂在哪 | 事实 |
| --- | --- | --- |
| `monitor-console-page` | 页面根 | 视图在场；根上同时有 `data-state`；量 `scrollWidth <= clientWidth` |
| `monitor-console-refresh` | 状态行 | 文本含 `上次更新`；过期时有 `data-stale="true"` |
| `monitor-console-readout` | 4 个读数容器 | 计数恒为 4；`data-readout="window\|today\|active-sessions\|today-compactions"` |
| `monitor-console-projects` | 项目 Panel 容器 | 项目榜在场 |
| `monitor-console-project-row` | 每个项目按钮 | 行数；`data-project`；`data-selected="true\|false"` |
| `monitor-console-project-fill` | 速率条填充 | 选中行与非零速率行应存在；全零时不渲染 |
| `monitor-console-hours` | 24h 容器 | `role="img"`；`data-bucket-count="24"` |
| `monitor-console-hour-slot` | 24 个小时槽 | 计数恒 24；`data-state="past\|current\|future"` |
| `monitor-console-hour-fill` | 过去 / 当前小时的柱 | 计数 = 过去非零 + 过去零值短桩 + 当前；`data-partial` 仅当前为 true |
| `monitor-console-event-filter` | 事件类型分段控件 | 四项在场 |
| `monitor-console-event-row` | 每条事件按钮 | 计数 `<=12`；`data-kind="compaction\|error\|session"` |
| `monitor-console-event-detail` | 事件详情槽 | 文本非空；错误预览已脱敏 |
| `monitor-console-skeleton` | 加载态容器 | 带 `data-probe-pending` |
| `monitor-console-empty` | 空态容器 | 没有读数带 / 三张 Panel |
| `monitor-console-error` | 错误态容器 | `ErrorState` 在场 |

真机几何事实：

1. `monitor-console-hour-slot` 恰 24 个。
2. `data-state="current"` 恰 1 个；其 `data-partial="true"` 恰 1 个。
3. `data-state="future"` 的槽内没有 `monitor-console-hour-fill`。
4. 项目行与事件行 `scrollHeight <= clientHeight + 1`。
5. 根节点与 board 都无横向溢出。
6. 130% 下事件列表可滚到第 12 行，最后一行 `getBoundingClientRect().bottom > 0`。

Rust `PROBE_JS.contains(...)` 守卫增断四个字符串：
`monitor-console-page` / `monitor-console-readout` /
`monitor-console-hour-slot` / `monitor-console-event-row`。

截图基线：`docs/screenshots/views.json` 新增 `monitor-console`，浅 / 深各一张，
Chromium + WebKit 共四张。HC 与 130% 不进基线，由几何断言覆盖。截图前
`emulateMedia({ reducedMotion: "reduce" })`，与脉搏保持一致。

---

## 12. 明确不做

1. 不新增颜色令牌，不改 `tokens.css`。
2. 不把监控台做成脉搏的四张 Panel 复制版。
3. 不做 7 / 30 / 90 天切换；监控台只做今天。
4. 不画外部仪表盘、不启动本地 HTTP 服务、不新增网络请求或 Tauri 命令。
5. 不用项目类别色。项目身份靠文字，token 量靠同一数据墨。
6. 不给压缩、会话开始借 `--warning` / `--success` / `--cat-*`。
7. 不用透明度表达当前小时或未来小时。
8. 不把未来小时画成 0 token。
9. 不做页面级英雄区、KPI 四张卡、卡中卡、拖拽布局。
10. 不做通知、声音、自动弹出。
11. 不新增循环动效。
12. 不在正文、title 或 aria-label 里输出未脱敏绝对路径。
13. 不把事件筛选扩展到全局 12 条之外；筛选只作用于已算好的最近 12 条。
14. 不在加载态显示假 0 或假「无活动」。

---

## 13. 实现者清单与复核清单

### 13.1 按改动顺序

1. `web/src/features/monitor/consoleModel.ts` + `.test.ts`
   - 实现 `hourBucketsOf / projectStatsOf / eventsOf / consoleModelOf`。
   - `ConsoleHour` 补 `past | current | future` 状态，组件不自己比较时间。
   - 复用 `recentRate` / `totalsSum` / `dayStartOf` / `fallbackSessionTitle` /
     `sessionKeyOf` / `stripAnsi`。
   - 错误脱敏与 80 码点上限在这里完成。

2. `web/src/features/monitor/MonitorConsolePage.tsx` + `.module.css` + `.test.tsx`
   - 顶部读数带、24h、项目榜、事件流。
   - 事件类型筛选不新增角色；用 `SegmentedControl role="radiogroup"`。
   - 项目筛选状态与清除按钮。
   - 四态与过期保留旧读数。
   - 事件行与项目行的焦点环。

3. `web/src/features/monitor/MonitorPage.tsx`
   - `MonitorView = "pulse" | "console" | "dashboard"`。
   - 分段项顺序 `脉搏 | 监控台 | 外部仪表盘`。
   - `readStoredMonitorView` 只在 `AppShell.tsx` 内扩展，未知值仍回落 `pulse`。
   - 外部仪表盘分支原样保留，不把它的探测状态机搬到监控台。

4. 测试
   - 单元：24h 桶的边界 / future / current；15 分钟窗口；项目排序与并列；
     12 条事件上限；三类事件；错误首行 / 绝对路径脱敏 / 80 码点；空输入。
   - 组件：四读数；无活动窗口；未来槽无填充；当前槽恰一个 partial；
     项目筛选与类型筛选叠加；清除；点事件打开会话；四态；130% 行不裁。
   - e2e：切到监控台看到确定值；与脉搏的 5 小时数字逐位一致；点事件打开会话；
     点项目筛选；未来小时不是 0；截图 `monitor-console`。
   - 真机：`gui-test.sh` 的探针与几何事实。

5. `focusRing.test.ts`
   - 环宽 `30 -> 32`。
   - `--focus-ring-inset` 消费 `9 -> 11`。
   - 消费令牌规则 `34 -> 36`。
   - 正偏移 `18` 与焦点竖条 `7` 不变。

6. 文档：README 中英、`docs/USAGE.md`、`docs/ARCHITECTURE.md`、
   `CHANGELOG.md` 的 `[Unreleased]`（中文 Added）。

7. 截图与截图清单：`docs/screenshots/views.json` 的 `monitor-console` 一处。

### 13.2 请主会话独立复核的三处

1. **24h 未来小时是否要在数据契约里加状态。**
   本规格拒绝把未来 14 个小时画成 0，但 `design.md` 目前只有 `partial`。请定夺是接受
   `ConsoleHour.status` / `future` 的契约补强，还是接受未来小时与过去 0 值共用同一条
   2px 短桩。我的立场：必须补，否则「今天还没发生」会被画成「今天没有发生」。

2. **1400 宽窗事件流只有约 21 个汉字宽的详情。**
   本规格选择单行五槽 + 省略号，完整预览进 title / aria-label。请复核是否接受「详情
   继续省略」，还是把底部改成上下两行，让 80 字符有完整展开区。我的立场：单行是
   仪表盘的密度承诺，完整事实由 title 与可访问名保底；若主会话要求完整可见，应改成
   事件流整行而非左榜右流。

3. **项目行把速率条压在第二行，而不是单独一列。**
   这样项目名在 130% 下仍有约 350px，代价是每行高 26 / 30.8px：100% 下可见 11 行，
   列表内部滚到第 12 行；130% 下可见 9 行。请复核这是否比
   「项目 | 条 | 速率 | 今日 | 会话」五列更像仪表、更易扫读。我的立场：长度关系不丢，
   名称可读性显著更好；代价是项目榜不再是 12 行全裸出。

---

## 14. 主会话评审结论（2026-10-17，独立复算后落笔）

### 14.1 复算结果

- **§8.7 的对比度脚本抽出来 `node` 跑过一遍**，四个主题逐行一致。关键几条：
  `--text` 17.79 / 16.15 / 21.00 / 18.73；`--text-secondary` 7.87 / 9.44 / 14.34 / 13.66；
  `--text-tertiary` 4.78 / 5.83 / 10.45 / 10.74；**页底 `--text-tertiary` 只有 4.38**
  （所以状态行改走 `--text-secondary` 7.22）；`--chart-1` 对面板 5.64 / 8.39 / 7.82 / 8.90；
  **`--chart-1` vs `--chart-1-soft` 4.00 / 4.48 / 5.66 / 4.21**（速率条与活动带的分界依据）；
  `--danger` 对面板 6.54 / 6.52 / 8.06 / 9.37。
- **高度账复算通过**：1400 下 100% `40 + 92 + 228 + 352 + 12 = 724`，
  130% `44.8 + 110 + 237.6 + 352 + 12 = 756.4`（1400×872 的可用 784 装得下）。
  960×640 下「表头 40 + 体内 12 + 5 行」的结论与每行 26px 一致。
- **横向账复算通过**：`1376 − 12 = 1364`，`44% = 600.16` / `56% = 763.84`；
  事件 Panel 可用 `763.84 − 2 − 24 = 737.84`。

### 14.2 三处待复核判断的裁决

1. **24h 未来小时必须进数据契约：通过，且已经实现。** 你的立场（「未来不是 0」）是对的，
   这正是这一页最容易撒的一次谎。我在评审前已经改了 `ConsoleHour`：
   加 `phase: "past" | "current" | "future"`（`partial` 保持原意，只标记当前小时），
   并补了「过去 12 / 当前 1 / 未来 11」的测试。展示层按三态画：
   **过去零值 = 2px 短桩（0 是发生了的读数）**、当前 = 斜纹 + 虚线、
   **未来 = 不画填充，只留空时间槽**。
2. **1400 下详情单行省略：接受。** 理由与你一致——单行五槽是仪表盘的密度承诺。
   但加一条硬要求：**完整脱敏预览必须真的进 `title` 与 `aria-label`**，
   组件测试要断言 `title` 含完整预览（否则「保底」只是说法）。
   不做「上下两行展开区」——那会把这页变成长文，和「一屏看完今天」冲突。
3. **项目行速率条压第二行：接受。** 130% 下项目名 350px 的可读性比多露出一行更重要；
   长度关系没有丢（条 + 右栏数值双通道）。

### 14.3 评审期发现并已修的一处缺陷

**工具错误的预览原本会恒为空。** 设计稿 §6.3 只说「错误：工具名 · 脱敏首行」，
而纯逻辑层按 `record.text` 取正文——但解析器把 `tool_result` 的正文放进
`toolResult`（`parseJsonl.ts` 的 `pending.toolResult`），只有 API 错误才落在 `text`。
结果是**最常见的 Bash 报错在卡片上只剩一个工具名**。已改成
`text?.trim() ? text : toolResult`，并补测试（`text` 为空、`toolResult` 带绝对路径 →
预览含 `Exit code 2`、不含 `/Users/`）。这条写进 §6.3 的实现要求：
**错误预览必须同时读 `text` 与 `toolResult`**。

### 14.4 对实现者清单的修正

- §13.1 第 5 条的 focusRing 计数：本轮**新增两处**整行按钮（项目行、事件行），
  若都复用同一条 `:focus-visible` 规则则计数不变；**写完后用 `rg` 数一遍再改**，
  不要照抄规格里的数字（上一轮就是这样发现规格写的数字与实测一致但需要复核）。
- §11 的锚点：`monitor-console-page` 上要同时暴露 `data-state`
  （与脉搏 `data-state` 同形），供真机门禁判四态。
