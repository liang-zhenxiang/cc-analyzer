# cc-analyzer 界面评审报告（2026-10-01）

评审人角色：UI/UX 产品设计师（桌面应用 / 数据可视化方向）
素材：docs/screenshots/ 下 12 张 `-webkit` 真实渲染截图（tree/report/log/empty × light/dark、monitor、settings）逐张目验；
通读 `web/src/styles/{tokens,global,animations}.css`、`web/src/components/` 全部组件、
`web/src/app/AppShell.tsx` 与 `web/src/features/sessions/` 主要页面组件的 TSX + CSS Module。

---

## 总评

这不是一个「需要救」的界面，而是一个「差最后一步」的界面。

当前底子罕见地好：令牌体系完整且**纪律执行到位**（全仓 CSS Module 零硬编码色值、零字号字面量，
grep 验证过；`tabular-nums` 12 处；阴影只出现在脱离文档流的浮层；字号与行高严格成对）。
代码注释里写的不是「这是什么」而是「为什么这么定」，说明设计决策已经被资产化了——
这比大多数开源桌面应用强一个层级。

但「仪器面板」这个方向声明（tokens.css 首行）目前只兑现了**骨架层**：
中性、克制、发丝线、台阶层级、颜色只给数据。仪器感的另一半——**读数层**——是缺失的：
没有刻度、没有仪表读数、状态灯没有语义。界面现在像一台「还没通电的仪器」：
外壳和旋钮都对了，表盘上没有数字。

---

## 1. 视觉层级

### 现状

首屏结构（analyzer-tree 截图）：48px 顶栏 → 左 300px 会话列表 → 主区
（`SessionHeader` 文字 chip 串 → `FilterBar` 表单 → `TimelineTrack` → `TreeView`/`LogView`）→ 右 360px 详情面板。

用户最关心的三个数现在的呈现方式：

| 信息 | 位置 | 字号 | 颜色 |
| --- | --- | --- | --- |
| 总耗时 | `SessionHeader` chip | `--fs-xs` 11px | `--text-tertiary` |
| Token 总量 | 点开 `chipButton` 才展开 `TokenPanel` | 不可见 | — |
| 会话数 | 侧栏分组头计数 | `--fs-xs` 11px | `--text-tertiary` |

### 问题

- **层级倒挂**：越重要的数字字号越小、对比越弱。会话标题 15px 抢走了全部第一眼，
  而「这个会话花了多少 token、多长时间」——用户打开这个应用要回答的问题——以 11px 三级灰出现。
- **Token 总量默认���可见**：`TokenPanel` 折叠在 `chipButton`（`aria-expanded={tokenPanelOpen}`）后面，
  首屏看不到任何 token 数字。对一个 Token 分析器来说，这是最贵的点击。
- `SessionHeader` 是一条等权重的 chip 串：总耗时、Token、项目路径、相对时间四件事视觉上同级，
  没有主次。

### 建议

- 在 `SessionHeader`（或其正下方）加一条**读数行（stat strip）**：4–5 个读数并排，
  数值用 `--fs-md` 15px/600 + `tabular-nums`，单位与标签用 `--fs-xs`，
  依次为：总耗时 / 输入 / 缓存读取 / 输出 / 记录数。数据全部现成（`tokenTotalsOf`、`parsed.records.length`）。
  这同时是维度 7「仪器感」的最大单点提升。
- chips 降级为次级元信息（项目、相对时间、大小），`--text-faint` 允许给纯装饰位。
- 读数行可点击展开 `TokenPanel` 明细——把现在「chipButton 展开」的交互搬到大读数上，交互成本不变，可见性翻倍。

## 2. 色彩系统

### 现状

四级表面台阶（light 下 `-subtle`/`-elevated` 同色、层级靠台阶）；语义色 success/warning/danger 各带 `-soft`；
强调色 `--accent` 只做焦点环/选中底（「像素占比 < 3%」写进了注释）；类别色是 Okabe-Ito 子集 6 色，
dark 下只调了 3 个色的明度并注释了对比度依据。

### 问题

- **类别色与 categorical 色板是同一套资产，没有冗余**。`--cat-*` 六色已与「记录类别」强绑定
  （`TreeView.swatch.*`、`LogView --row-color`、`TimelineTrack` 块色）。后续图表一旦表达
  非类别维度（模型对比、项目对比、按日趋势），要么撞义（蓝色同时是「tool 执行」和「某项目」），
  要么无色可用。tokens 注释自己就警告过「借色会毁掉两个维度」。
- **类别色没有 `-soft` 变体**。图表需要大面积低饱和填充（柱底、面积图、热力图），
  目前只有 `--accent` 和语义色有 soft；到时候只能现场调 rgba，dark/light 又要各配一份。
- dark 类别色的对比度注释按旧底色 `#101418` 计算，而 `--bg-elevated` 现为 `#1a1d21`：
  `--cat-delegated`(#d55e00) 在其上约 4.4:1（图形件 3:1 达标，但作为 2px 徽标边框已经偏弱）。
- 小问题：`--r-lg`（12px）全仓无消费者；`--warning` 全应用只在 `TokenPanel.unknown` 用了一次。

### 建议

- 在 tokens.css 新增**图表专用 categorical 色板** `--chart-1 … --chart-6`（两主题各一套，light 深版 / dark 亮版），
  语义无关、只论顺序；表达记录类别时继续用 `--cat-*`。后续所有图表（维度 1 的读数行 sparkline、按日趋势、
  模型分布）一律从 `--chart-*` 取色。
- 为 6 个类别色与 6 个 chart 色各配 `*-soft`（10–14% 透明版），图表大面积填充只允许用 soft。
- 用脚本把两套主题下所有前景/背景组合的对比度跑一遍并把结果写进 tokens 注释
  （现在的注释是手算的，底色一改就过期——这次 `#101418 → #1a1d21` 就是例子）。
- `--r-lg` 要么给浮层/空态用起来，要么删。

## 3. 排版与密度

### 现状

字号五级（11/12/13/15/20）+ 成对行高令牌，body 13px，桌面密度取向正确；
数字列 `tabular-nums` 覆盖了 12 处（所有表格、chip、读数位）。

### 问题

- **三种「数据行」三种 padding**：`RecordTable` 7px 9px、`LogView` 6px 10px、`TreeView` 4px 9px 4px 8px。
  同为主数据表，密度语言不统一——用户在「树/日志」两个视图间切换时行的呼吸感会跳。
- 25 处 `2px/3px/6px` 微间距字面量（如 `TreeView` `gap: 6px`、`FilterBar` `gap: 3px`、
  分段控件 `gap: 2px; padding: 2px`）。虽是微调级，但违反了 tokens.css 自己立的规矩
  （「不得出现字面量……四者都必须是 token」只提了颜色/高度/圆角/时长，间距没立，但精神如此）。
- 侧栏 toolbar 里「刷新会话列表」六字文字按钮与搜索框同行（`SessionList.toolbar`），
  把搜索框压到约 150px 宽（截图可见）；刷新是低频动作，不配占用这块首屏宽度。
- `--fs-xs` 11px 中文成段出现（`FilterBar` legend、各处 hint）时在 WKWebView 里已到可读性边界，
  单行标签可以，句子慎用。

### 建议

- 立两个行内密度令牌：`--row-pad-x: 10px`、`--row-pad-y: 6px`，三张表统一引用
  （`TreeView` 若因双行内容需要更紧，用 `calc()` 表达差异而不是另一组字面量）。
- 「刷新会话列表」改成 `IconButton`（`refresh` 图标已在 `Icon.tsx` 里，`label="刷新会话列表"` 保底 tooltip）。
- 微间距补 `--sp-05: 2px`、`--sp-15: 6px` 两档，或把 3px 归并进 4px。

## 4. 组件一致性

### 现状

圆角四档全部走令牌；阴影纪律是亮点——文档流内零阴影，`--shadow-sm` 只给分段控件滑块，
`--shadow-md` 只给 Toast 与设置浮层；按钮四变体（primary=墨色而非强调色，理由已注释）规范。

### 问题

- **`components/Panel.tsx` 是死代码**：全仓只有它自己的测试引用。主界面五个面板
  （`TokenPanel`/`ReportPanel`/`RecordDetailPanel`/`TreeView`/`LogView`）各自手写了同一套
  `border + --r-md + --bg-subtle + padding` 开头的 `.panel` 样式——同构五份。
- **分段控件画法复制了 4 份**：`AppShell.workspaceTabs`、`SessionList` 侧栏 `[role="tablist"]`、
  `SessionAnalyzerPage.viewTabs`、`ReportPanel` 的 tabs，CSS 逐字相同（各约 25 行）。
  现在靠注释「同一套画法」维系一致性，改一处漏三处只是时间问题。
- `FilterBar` 里「记录类型」用 checkbox、「状态」用 ghost Button + `aria-pressed`：
  同一个「多选开关」概念，两种控件、两种视觉、两种点击体验。
- `ErrorBoundary` 的按钮样式在 `global.css` 里手写（`padding: 0 10px; border-radius: var(--r-sm)`），
  没走 `Button` 组件——全局 CSS 里出现了一份控件样式，是硬编码的另一个入口。

### 建议

- 抽 **`SegmentedControl`** 共享组件（一份 CSS Module），四处替换；顺手补上维度 6 的方向键导航。
- 把 `Panel` 改造成真正的 **`DataPanel`**（title + actions + body 的现有公共结构）替换五处手写，
  或删掉 `Panel` 别留死代码误导贡献者。
- `FilterBar` 类型与状态统一为一种 chip-toggle（`aria-pressed` + `--accent-soft` 按下态，画法已有先例）。
- `ErrorBoundary` 换用 `Button` 组件。

## 5. 微交互与反馈

### 现状

hover 80ms（`--dur-hover` + `--bg-hover`）覆盖全部可点元素；选中态是双信号
（`--accent-soft` 底 + `inset 2px 0 0 --accent` 竖条，灰度下仍可辨，注释明说为色弱设计）；
`cca-flash` 600ms 定位闪烁；`cca-enter` 浮层进场；`EmptyState` 三档尺寸 + page 档带 `BrandMark`；
Toast 右下角 `role="status"`。

### 问题

- **加载态没有统一语言**：`SessionList` 的「加载中…」是一行裸文本（且没有走 `EmptyState`），
  `SessionHeader` 的「总耗时 …」用省略号，`MonitorPage` 探测中另有画法。三处三个样。
- `TimelineTrack` 是全应用最有「仪器」潜质的控件（crosshair 光标、64px 网格底），但 hover 时
  **没有任何反馈**：无准线、无时间读数，块上只有原生 `title` tooltip（延迟约 1s，且不随位置移动）。
- 轨道上的块固定 8px 宽（`width: 8px`），不映射时长——一个 30s 的记录和 30ms 的记录在轨道上同宽，
  「时间概览」的长度语义断了。
- Toast 只有进场动画，离场直接消失（`StatusToast` 无退出过渡）。

### 建议

- 定义统一 loading 画法：一行 skeleton（`--bg-hover` 圆角条 + 缓慢呼吸动画，reduced-motion 下静止），
  侧栏首载、表格首载、`总耗时` 位共用。
- `TimelineTrack` 加 **hover 准线 + 时间气泡**：1px 竖线（`--border-strong`）+ `--fs-xs` tabular 时间读数，
  顺带解决「拉选不知道选到了哪」。这是把 crosshair 从光标图标升级成真探针的一步。
- 块宽按时长映射（min-width 2px 保底），超长记录封顶；让轨道读出「哪里久、哪里密」。
- Toast 离场加 140ms 淡出（`--dur-state`）。

## 6. 可访问性

### 现状

全局 `:focus-visible` 2px ring；`prefers-reduced-motion` 全量归零（保留 0.01ms 触发动画结束事件，
处理过边界）；选中/按下态全部有非颜色第二信号；`aria-current`/`aria-selected`/`role` 使用规范；
`IconButton` 强制 `label`（可访问名与 tooltip 绑定）；图标全部 `aria-hidden`。

### 问题

- **数据表行不可键盘操作**：`RecordTable`、`LogView`、`TreeView` 的行没有 `tabIndex`、没有键盘事件
  （grep 验证为空）。行选择纯鼠标；`TreeView` 的 `.label` 虽是 button 但只覆盖文本列一列。
  对「分析器」类工具，键盘流（j/k 或 ↑↓ + Enter）是高频诉求。
- `TimelineTrack` `role="application"` + `tabIndex={0}`，但键盘只能 Esc 清选区；
  「拉选一段时间」没有键盘等价操作（Shift+方向键扩展）。
- 侧栏 `标题提取失败`（`SessionList` 的 `small`）用 `--text-faint`（注释自述 2.6:1）——
  这是需要读的状态信息，不是装饰。
- 四处 `role="tablist"` 都没有 ArrowLeft/Right 导航，只靠 Tab 逐个移动。

### 建议

- 三张表加 roving tabindex（容器 `onKeyDown` 处理 ↑↓/Enter/Home/End，行 `tabIndex={-1/0}`），
  样式复用现有 `--bg-hover`/选中态即可，无需新视觉。
- `TimelineTrack` 补 Shift+←→ 的选区调整（读数刻度做了之后自然成立）。
- 失败状态行升 `--text-tertiary`，或失败时直接用 `--danger`（它本来就是异常态）。
- `SegmentedControl` 抽组件时一并实现方向键。

## 7. 「仪器面板」品牌叙事

### 现状（已经是加分项的部分）

「骨架一律中性灰，颜色只出现在数据上」被严格执行：导航、面板、按钮全部中性，
唯一大面积彩色的地方是数据（时间轨道、类别徽标、耗时条）；墨色主按钮让强调色退出动作语义；
发丝线 + 台阶层级替代阴影；`tabular-nums` 全覆盖。这套语言已经和 Linear 的「数据优先」同频。

### 差距：仪器 = 会读数、有刻度、灯有语义——现在三样各缺一半

1. **有网格无刻度**：`TimelineTrack` 的 64px 网格底纹暗示了刻度，但全轨道没有一个时间标注——
   起点几点、终点几点、选区覆盖多久，全都读不出来。
2. **灯无语义**：`SessionHeader` 的 8px 绿点（`--success`）常亮，不表示任何状态——
   今天的会话亮、上周的也亮。指示灯不指示，就是装饰。
3. **无读数层**：见维度 1。仪器的第一眼是表盘数字，不是外壳。

### 建议（克制路线：只加「信息」，不加「装饰」）

- 轨道底部加时间刻度轴：起止时间 + 2–3 个中间刻度（`--fs-xs` + `tabular-nums` + `--text-tertiary`），
  选区时显示选区时长。这是把现有网格底纹「通电」的最小改动。
- 状态灯语义化：今天有记录 → `--success`；含失败记录 → `--danger`；更早 → `--text-faint` 或移除。
  数据全部现成（`records` 里有 error 状态、`mtimeMs` 可判今天）。
- 读数行（维度 1）落地后，「仪器面板」三个字就有了可截图证明的差异点：
  打开应用第一眼是五六个大号等宽数字在浅灰台阶上排开——这个画面现在的截图里不存在，
  加上之后任何竞品截图里也不存在。
- 明确不做：渐变、玻璃拟态、彩色主题、动效装饰。Linear/Raycast 式质感的来源恰恰是
  「每一个视觉元素都承载信息」，现有纪律已经保证了一半，另一半靠上面三条补齐。

---

## Top 10 改进清单（按影���力排序）

| # | 改什么 | 为什么 | 涉及文件 | 工作量 |
| --- | --- | --- | --- | --- |
| 1 | 首屏读数行：总耗时/输入/缓存读/输出/记录数，15px tabular 大数字，可点击展开 TokenPanel | 用户最关心的数字现在以最小字号最弱对比出现，Token 默认不可见；层级倒置是全界面最大单点损失，同时是仪器感的核心 | `SessionHeader.tsx/.module.css`、`tokenTotals.ts`（数据现成） | M |
| 2 | TimelineTrack 时间刻度轴 + hover 准线读数 + 块宽按时长映射 | 全应用最有仪器潜质的控件目前「有网格无读数」；8px 定宽让时长语义断裂 | `TimelineTrack.tsx/.module.css` | M |
| 3 | 三张表的行级键盘导航（roving tabindex + ↑↓/Enter） | 数据分析工具的高频诉求；现为纯鼠标；复用现有 hover/选中态，无新视觉 | `RecordTable.tsx`、`LogView.tsx`、`TreeView.tsx` | M |
| 4 | 新增 `--chart-1..6` categorical 色板 + 全部类别/图表色的 `-soft` 变体 | 后续图表的前置依赖；类别色已被「记录类别」语义占满，直接复用必然撞义 | `tokens.css`（两主题各一套） | S |
| 5 | 抽 `SegmentedControl` 组件，替换 4 份逐字复制的分段控件 CSS | 一致性目前靠注释维系；顺手补方向键导航 | 新组件 + `AppShell`/`SessionList`/`SessionAnalyzerPage`/`ReportPanel` | S |
| 6 | 统一加载态：skeleton 画法替换三处各异的「加载中…/…/探测中」 | 加载是桌面工具最高频的状态，现在没有语言 | `SessionList`、`SessionHeader`、`EmptyState`（加 loading 变体） | S |
| 7 | 侧栏 toolbar 重排：刷新改 `IconButton`，搜索框拿回全宽；统一三表行 padding 令牌 | 搜索框被低频按钮挤压至 150px；三种数据行三种密度 | `SessionList.tsx/.module.css`、`RecordTable/LogView/TreeView.module.css`、`tokens.css` | S |
| 8 | `Panel` → `DataPanel` 落地或删除，替换五处手写同构面板样式；`ErrorBoundary` 换 `Button` | `Panel.tsx` 是死代码，五份手写 `.panel` 必然漂移；全局 CSS 里藏着一份控件样式 | `components/Panel.*`、五个 feature 面板、`global.css` | M |
| 9 | 状态灯语义化（今天=绿 / 含错误=红 / 其他=灰） | 常亮的指示灯是装饰；语义化零成本（数据现成） | `SessionHeader.tsx/.module.css` | S |
| 10 | FilterBar「记录类型/状态」统一为一种 chip-toggle 画法 | 同一「多选开关」概念两种控件两种视觉；checkbox 表单感与仪器气质相悖 | `FilterBar.tsx/.module.css` | S |

工作量口径：S ≈ 半天内（含单测）；M ≈ 1–2 天（含双主题截图重出与 e2e）；#1/#2 建议各开独立 Issue 与 PR。
所有改动都应延续现有「双主题截图验证」流程（`docs/screenshots/` 重出 `-webkit` 版本）。

---

### 给下一轮的一句话

这一轮升级不需要「加东西」，需要「通电」：把已经造好的仪器面板接上读数——
刻度、数字、状态灯，三件事做完，界面从「干净的容器」变成「一眼记住的工具」。
