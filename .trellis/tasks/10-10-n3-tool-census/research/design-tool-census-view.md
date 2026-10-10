# 「工具与 skill」面板视觉规格（N3）

> 设计：UI/UX 子 agent（designer）｜2026-10-10｜Round N / N3
> 输入：`prd.md`、`design.md`（数据契约已定案）、`research/tool-census-facts.md`（382 文件 / 36,660 次实测）、
> `UsageOverviewPage.tsx` 及用量档现有 Panel、N1 视觉基线
> （`.trellis/tasks/10-10-n1-error-patterns/research/design-error-view.md`）及其落地组件
> （`ErrorOverviewSection` / `ErrorRankList` / `ErrorEventList`）、`CompactionStatsPanel`、`tokens.css`。
> 颜色零新增令牌，全部消费既有资产；本面板无新图表，只消费 N1 已验证的行语言。

---

## 0. 设计立场

**量级差异本身就是本面板最重要的读数，版式必须呈现它而不是抹平它。**
实测分布：内置工具 ≈36,257 次（Bash 一项 24,722 / 67.4%）、子 agent 260 次、
skill 77 次（25 个里 18 个各 1 次）、MCP 3 次——四桶相差三个数量级。任何把四桶
放进**同一归一化条形图**的形态，都会把 skill 画成零长度条、把 MCP 画没；任何
给四桶**等权重视觉**的形态（四张同构小图），都在谎报「它们同样重要」。面板的
分层结构就是数据的形状：**主榜给量级主体，紧凑清单给配置卫生，一行事实给极稀桶**。

第二条立场：**这是用量档的成员，不是新舞台。** 区间选择器、扫描进度、Panel
语言、caption 口径全部继承用量档；不新设控件、不新设分段（design.md 已定）。

---

## 1. 裁决表

| # | 问题 | 决定 | 理由（含弃选） |
| --- | --- | --- | --- |
| 1 | 混排一张榜 vs 分组四小节 | **都不取——分层四栏**：主榜（内置工具，条形）＋ skill 清单 ＋ 子 agent 清单 ＋ MCP 一行，同一 Panel 内按量级递减从左到右排布，栏宽也递减 | 混排榜上 skill 最高 41 次排第 9 位开外、MCP 永远进折尾桶——PRD 的两个核心问题（「哪些 skill 在用」「MCP 有没有在用」）直接没有答案，不诚实。四小节各自 Top-N＋空态则 MCP 一节撑出 1 server/3 次的整块 UI，违背研究「别为它做重 UI」。分层让每桶用适合自己量级的形态：条形只给量级断崖区（前四名占 96%，条长有区分度），清单给长尾平坦区 |
| 2 | 双口径呈现 | **行读数单列 = 含子 agent（callsWithSidechain），行 `title` 给主链对照；Panel 体首行给总量双读数**（`共 36,660 次 · 主链 21,581 · 子 agent 占 41.3%`）。不设切换控件（design.md 已定，N1 先例） | 行级主链数对绝大多数行的信息量趋近整体占比（41.3% 附近），逐行双列是 34 行 × 一个近乎恒定的比值，挤占标签列；而「子 agent 贡献了四成调用」这一真实洞察只需要**一次**总量对照。非悬停通道纪律（N1 §6）：主链总数在体首行常显，行级主链在 title——每个被呈现的数都有非悬停路径或本来就不需要常显 |
| 3 | 行尾次读数列放什么 | **会话数（`sessions`，含子链口径，契约已有）**，不是主链次数 | 「git-commit 41 次 · 3 会话」与「41 次 · 41 会话」是两种完全不同的使用形态——会话广度是配置卫生问题的关键分维度；主链数已由裁决 2 安置。dual 列结构沿 N1 `ErrorRankList` 的 value＋secondary 先例 |
| 4 | 次级区（skill / 子 agent）要不要条形 | **不要——纯数字行清单**（`modelLegend` 同族：名＋次数＋会话数，无条、无色点） | 三个理由：① skill 区第一名 41 对第二名 5 是 8:1，第 3 名起条长 <10%，条形无区分度；② 若给条形且分母独立，git-commit 的满宽条与左边 Bash 的满宽条同长而数值差 600 倍——跨栏误读风险真实存在；③ 「按模型分布」面板已有「主体图形＋无条图例清单」的同族结构（StackedBar＋modelLegend），不是新语言。绝对数字直接回答「哪些在用」 |
| 5 | 下钻形态 | **Panel 尾部内嵌展开「使用『X』最多的会话 Top-5」**：行 = ◆＋会话名＋次数（`CompactionStatsPanel.topSessions` 行语言），行点击 → `onOpenSession` 离页；再点榜行取消（N1 toggle 语义），下钻区头部有 `× 清除` | design.md 指定复用 CompactionStatsPanel top 行先例。下钻目标是会话（粗粒度、几十个），不是事件（N1 的事件面板是几百条全量列表＋过滤，形态过重）；「用得最多的前 N 个会话」恰好与压缩面板「丢最多的前三个会话」同构。第一跳留在本页（N1 异议 9 精神），第二跳才离页 |
| 6 | 极稀桶（MCP） | **server 级行：`server名 · N 次 · M 个工具`**，可点下钻，不配条形不做小节展开；无数据时一行「本区间没有 MCP 调用」 | 1 server/3 次的事实一行说得完；server 名长（`plugin_context7_context7`）用 ellipsis＋title 全名，工具明细进 title（`query-docs 2 次 · resolve-library-id 1 次`）。「有则展示」的诚实形态 = 一行事实，不是空图 |
| 7 | Top-N | **三区统一 Top-6 ＋ 折尾**（主榜 7 行、skill 7 行、子 agent 7 行） | 与用量档 `DEFAULT_TOP_N=6` 同数（同族）；主榜前六覆盖到 0.5% 量级、skill 前六覆盖 73%（56/77），折尾行 `其他 N 类` 承接长尾。折尾行的存在本身就是「你装的多、常用的少」这一配置卫生答案的一半 |
| 8 | 折尾行可否下钻 | **可点**——聚合层每桶带 `topSessions`，折尾集合的会话榜由视图层纯函数合并同会话求和再取 Top-5（可单测） | N1 先例折尾行同样可点；「其他 20 个 skill 在哪些会话里」是真问题。见异议 §8-2 |
| 9 | 四桶要不要色彩身份 | **不要。桶身份 = 栏头文字**（`内置工具` / `skill` / `子 agent` / `MCP`）；全部数据墨水单色 `--chart-1` | tokens.css 明令图表色「语义无关、只论顺序」，`--cat-*` 被「记录类别」占满严禁互借——四桶四色没有合法色源。且 N1 先例是「有图表可锚才用色块」：本面板主榜单一系列，无第二系列可分。栏头右端的类数与合计（`skill · 25 个 · 77 次`）承担量级锚定，兼防裁决 4 说的跨栏误读 |
| 10 | 落位与占宽 | **board 第三行整行**（活跃时段之后、压缩统计之前），`compactionRow` 同款 `grid-column: 1 / -1` | 内容体量（四栏＋下钻＋caption）半宽塞不下（skill 名＋双读数列在 ~350px 内会持续 ellipsis）；「量级主体 → 配置清单 → 现场（会话）」是一条横向叙事，整行是压缩面板已确立的同族形态。插在活跃时段后：零存量重排，分布类面板（项目/模型/工具）仍同处 board 上半区 |
| 11 | 逐日趋势线 | **不做。** 区间选择器（7/30/90 天）就是本视图的时间维度 | PRD F2 的「时间趋势（与用量页同区间选择器）」由区间切换满足；逐日工具趋势要么 34 条线（不可读）要么单选一条（新增控件，违背 N1 控件纪律）。design.md 也只把它列为「设计师要求才做」——不要求 |
| 12 | 虚拟化 | **不做**（总行数 7+7+7+1+5 ≈ 27，远低于 `logWindowRows`），但**行结构照虚拟化友好的形态写**：每行 `li > button`，行高由 li 承载 | N1/N2 教训：门禁量的是 li 的几何，不是内容 span；行高载体从第一天就放对位置，未来加长列表不需要改结构 |

---

## 2. 版式线框（整行 Panel，内容区 ≈1384）

```
board 第三行（compactionRow 同款整行）：
┌ Panel: 工具与 skill ───────────────────────────────────────────── ●(logged) ─┐
│ 共 36,660 次调用 · 主链 21,581 · 子 agent 占 41.3%        ← 体首行，data-tool-census-total
│                                                                              │
│ ┌ 内置工具 · 26 类 ─────┐ ┌ skill · 25 个 · 77 次 ┐ ┌ 子 agent · 8 类 · 260 次 ┐ ┌ MCP · 1 个服务器 · 3 次 ┐ │
│ │ Bash   ██████████ 24,722 210会话│ │ git-commit        41  3 会话│ │ general-purpose  89  …│ │ plugin_context7_…  3 次│ │
│ │ Edit   ██▁         4,454 190会话│ │ maintain-loop      5  2 会话│ │ trellis-implement 88  …│ │   · 2 个工具           │ │
│ │ Read   ██▁         4,344 187会话│ │ trellis-update-…   4  3 会话│ │ trellis-check     36  …│ │ （title 列工具明细）    │ │
│ │ Write  █▁          1,689 170会话│ │ trellis-brainst…   2  1 会话│ │ Explore           33  …│ │                        │ │
│ │ SendMessage ▏        242  40会话│ │ git-smart-update   2  1 会话│ │ trellis-research  10  …│ │  可点 → 下钻会话        │ │
│ │ TaskUpdate  ▏        176  35会话│ │ 其他 19 个         23  —    │ │ 其他 2 类          2  —│ │                        │ │
│ │ 其他 19 类 ▏         862  —    │ └────────────────────┘ └──────────────────────┘ └────────────────────────┘ │
│ └──────────────────────┘          ↑ 无条形、无色点（modelLegend 同族清单）                        ↑ 无条形，一行事实 │
│   ↑ 唯一有条形的区（ErrorRankList 行语言）                                                        │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄ 选中任一行后出现（data-tool-census-sessions）┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ 使用「Bash」最多的会话 · 共 210 个                                       [× 清除] │
│  ◆ 修复构建脚本……          1,204 次   ← 行点击 onOpenSession 离页                │
│  ◆ Round J 上下文取证……      987 次                                                │
│  …（Top-5，CompactionStatsPanel.topSessions 行语言）                            │
│ caption：调用次数含子 agent 记录（本区间 41.3% 来自子 agent），主链单独计数见各行悬停；│
│ 点击任一行下钻使用最多的会话。                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- 四栏 grid：`1.6fr 1fr 1fr 0.75fr`，`gap: var(--sp-4)`，`align-items: start`。
  栏头（`--fs-xs` `--text-secondary`，右端类数与合计 `--text-tertiary`）是桶身份的
  唯一载体（裁决 9），兼作跨栏量级锚。
- 主榜行：`标签 150px 右对齐（ellipsis＋title）｜条区 flex｜次数 56px｜会话 60px`，
  行高 26（HBarChart / ErrorRankList 惯例）。
- 次级清单行：`名 flex-1（ellipsis＋title）｜次数 48px｜会话 56px`，行高 26，与主榜等高。
- MCP 行：`server 名（ellipsis＋title 全名与工具明细）｜ 3 次 · 2 个工具`，单行 button。
- 下钻区与四栏间距 `var(--sp-3)`，顶部 1px `--border` 发丝线（与 kpiFootnote 的
  `border-top` 同语言），在场/离场无布局动画。

**垂直预算**（100% 字号）：Panel 头 ≈40 ＋ 体首行 22 ＋ 栏头 20 ＋ 7 行 ×26=182
＋ 下钻（头 24 ＋ 5 行 ×30=150，仅选中时）＋ caption ≈32 → 未选中 ≈300px、
选中 ≈470px。介于「按模型分布」（≈250）与错误趋势面板（≈385+）之间，整行合法。

---

## 3. 逐组件规格

### 3.1 体首行（总量双读数，`data-tool-census-total`）

- 文案模板：`共 {callsWithSidechain} 次调用 · 主链 {callsMain} · 子 agent 占 {pct}%`
  （`pct = (with-main)/with*100`，一位小数；`with === 0` 时整行不渲染，见 §6 全空态）。
- 样式：`--fs-xs` `--text-secondary`，数字 `--font-mono` tabular。
- 这是「41.3% 的调用来自子 agent」这一研究核心发现在界面上的**常显**落点（裁决 2）。

### 3.2 主榜（内置工具，条形，唯一条形区）

- 行结构沿 `ErrorRankList` dual 形态：`标签｜track（chart-1-soft 填充＋chart-1 1px
  描边）｜valueLabel（次数）｜secondaryLabel（会话数）`。
- 条长 = 该行次数 / 榜内最大次数（区内归一）；排序 = `callsWithSidechain` 降序。
- 次数格式 `toLocaleString("en-US")`；会话 `210 会话`（数字＋「 会话」，单数也用
  「1 会话」——中文无复数屈折，不特判）。
- 折尾行：条与标签走中性台阶（`--bg-active` 填充＋`--border-strong` 描边，N1 同款），
  会话列 `—`（混合桶的会话数不可加总——同会话跨工具重复，宁缺毋假），可点下钻。
- 行 `title` 模板：`Bash：24,722 次（主链 14,306 · 子 agent 10,416）· 210 个会话`
  ——主链对照的行级落点（裁决 2）；折尾行 title：`其余 19 类工具合计 862 次（主链 … · 子 agent …）`。

### 3.3 skill / 子 agent 清单（无条形）

- 行：`名（flex-1，ellipsis，title=全名＋双口径＋会话数）｜次数｜会话数`。
- 名字保持原样（含 `trellis:finish-work` 的命名空间形态——整串就是身份，不拆）。
- 折尾行同 §3.2 折尾规则（无条可涂，标签 `其他 N 个`，会话列 `—`，可点）。
- 行 `title`：`git-commit：41 次（主链 41 · 子 agent 0）· 3 个会话`。

### 3.4 MCP 区

- 有数据：每 server 一行 button——左 `server 名（ellipsis）`，右 `3 次 · 2 个工具`；
  `title`：`plugin_context7_context7：3 次 · 2 个工具（query-docs 2 次 · resolve-library-id 1 次）· 2 个会话`。
  server 数 >7 时同规则折尾（本机 1 行，规格仍写全）。
- 无数据：一行非交互文字 `本区间没有 MCP 调用`（`--fs-xs` `--text-tertiary`）。
  「没有」也是配置卫生的答案（装的 server 没被用 / 没装），如实陈述不省略。

### 3.5 下钻区（选中后在场）

- 头行：`使用「{label}」最多的会话 · 共 {sessions} 个` ＋ 右侧 `× 清除`
  （`--control-h-sm` 文字按钮，N1 `ErrorEventList` 同款），容器 `data-tool-census-filter`
  属性值 = 选中行 label（门禁锚点）。
- 会话行：`◆（--text-faint，aria-hidden）｜会话名（ellipsis＋title）｜N 次`，
  行高 30（`--row-h`），真 button，点击 → `onOpenSession(session)`；回调缺省
  （单测直挂）时行静态渲染（CompactionStatsPanel 先例）。
- 数据：桶的 `topSessions` Top-5（按次数降序）；折尾行点击 = 合并集合的 Top-5
  （同会话跨桶求和后排序，视图层纯函数，可单测——异议 §8-2）。
- 选中态切换：点另一行 = 换选中；点同一行或 × = 取消，下钻区离场。

### 3.6 caption（常显）

> 调用次数含子 agent 记录，主链单独计数见各行悬停；点击任一行可下钻使用最多的会话。

分桶口径（内置按工具名 / skill 按 skill 名 / MCP 按服务器 / 子 agent 按
subagent_type）**不进 caption**——四栏栏头已经逐栏写明，caption 不复述第二遍
（同一口径只在一个权威位置）。

---

## 4. 颜色裁决表（零新增令牌）

| 用色点 | 令牌 | 为什么 |
| --- | --- | --- |
| 主榜条（唯一数据墨水） | `--chart-1-soft` 填充＋`--chart-1` 描边 | 面板第一系列槽位；与「按项目分布」HBar、错误档工具柱同色是同语言；N1 已实测两主题对面板底 ≥3:1 |
| 折尾行 | `--bg-active`＋`--border-strong` | 折尾容器不是类别（N1 §1-8 裁决原文适用）；清单区无条，只有主榜折尾行消费 |
| 选中态（榜行 / 清单行 / MCP 行） | `--accent-soft` 底＋`inset 2px 0 0 var(--accent)` | 选中是 accent 的本职；与 ErrorRankList / 日志表逐字一致，底色＋左条双信号 |
| 下钻会话行 ◆ / 引导性文字 | `--text-faint` | 装饰性记号（CompactionStatsPanel.topDiamond 同款） |
| 全部正文 / 读数 | `--text` / `--text-secondary` / `--text-tertiary` | 读数中性墨；数字列 `--font-mono` tabular |
| 空态事实行 | `--text-secondary`（`--fs-sm`） | 压缩面板 zeroState 同款 |

**弃选记录**：四桶四色（无合法色源，裁决 9）；`--warning`/`--success` 表达「常用 /
闲置」（它们是确定性语义，使用频率不是确定事件）；给 MCP 稀疏涂 `--warning`
（极稀不是警告，是事实）。本面板**不消费** `--danger`——这里没有任何异常判定。

---

## 5. 交互与键盘

- **可点行**：主榜行、两清单行、折尾行、MCP server 行（toggle 选中，`aria-pressed`）；
  下钻会话行（click 离页，不 toggle）。
- hover：行 `--bg-hover`（`--dur-hover`）；下钻会话行尾箭头同 ErrorEventList 显隐。
- 键盘：全部是原生 `<button>`，Tab 顺序 = DOM 顺序（主榜 → skill → 子 agent → MCP →
  下钻）；`focus-visible` 全局 outline。行总数 ≤27，**不设 roving tabindex**（N1
  先例：少量行不做键盘域）。Esc 不绑定（清除走 × 按钮与再点，与 N1 列表一致——
  N1 的 Esc 只在趋势图上）。
- 屏幕阅读器：Panel `aria-label="工具与 skill"`；四个列表各自 `aria-label`
  （「内置工具调用排行」「skill 调用排行」「子 agent 调用排行」「MCP 服务器」）；
  下钻列表 `aria-label` 动态带选中名（「使用 Bash 最多的会话」）。
- 动效：hover 过渡 `--dur-hover`；选中切换内容直换无布局动画；`prefers-reduced-motion:
  reduce` 全部 none（BarChart 先例）。
- 字号缩放 90–130%：文字全部 `--fs-*`/`--lh-*` 成对；行高 26/30 是**行盒含
  `--lh-sm`/`--lh-base` 的设计值**——实现时行高写 `calc` 或由内容撑出，不写死
  裸 26px（130% 档行盒要能长高，N1/N2 教训：li 承载行高，值随字号档缩放）。

---

## 6. 逐状态规格

| 状态 | 呈现 |
| --- | --- |
| 正常（有调用） | §2 全形态 |
| 扫描中 | 与用量档同款渐进更新：数字随已读会话增长，无专属骨架（N1 §1-11 同裁决） |
| 某桶空（如无 skill 调用） | 栏保留＋栏内一行 `本区间没有 skill 调用`（`--fs-xs` `--text-tertiary`，非交互）。四栏常驻，版式不跳——「这一桶为空」与「这一桶有 77 次」同权重呈现（配置卫生答案） |
| 全空（区间 0 次工具调用） | 四栏与下钻不渲染，体首行不渲染，代之一行事实：`近 {days} 天检查了 {sessions} 个会话，没有工具调用记录`（zeroState 句式；纯对话会话合法存在，0 是检查结果） |
| 下钻选中但桶只涉及 1 个会话 | 列表 1 行，照常；头行 `共 1 个` |
| 页面级（读取失败 / 无会话 / 首帧扫描） | 沿用 `UsageOverviewPage` 现有 stage 三态，本面板不另造（它渲染在 inputs 就绪之后） |

---

## 7. 明确不做什么（防实现者跑偏）

1. **不做主链 / 含子 agent 切换控件**；不做逐行双口径双列（主链数只在 title 与体首行）。
2. **不给四桶色彩身份、不给清单行加色点**——桶身份只由栏头文字承载。
3. **不做逐日工具趋势线 / 工具×时间热图**（design.md 已列不做；裁决 11）。
4. **不做「展开全部 N 个」长尾清单**——折尾行 title 给合计，v1 不做行内展开。
5. **不做「建议卸载哪些 skill / server」**（PRD 不做：要判断就得猜）。
6. **不做 MCP server 管理 / 编辑**（写操作越出只读边界）。
7. **不做 roving tabindex、不做虚拟滚动**（27 行；但行结构保持 li 承载行高，
   见裁决 12）。
8. **不做独立下钻面板 / 路由页**——下钻是本面板尾部内嵌区。
9. **折尾行不给会话数读数**（同会话跨桶重复，加总即撒谎）。
10. **不新增任何令牌、不引入图表库、不动 `HBarChart`/`ErrorRankList` 既有调用方**
    （新组件新文件，design.md 回滚边界）。

---

## 8. 实现注意点（含异议节——契约缺口回 `design.md` 定案）

### 组件与落点

- 新组件 `ToolCensusPanel`（含主榜 / 清单 / MCP 行 / 下钻区子结构），新
  `ToolCensusPanel.module.css`；行 CSS 与 `ErrorRankList.module.css` 同语言但**独立
  文件**（泛化共用可由实现者裁量，前提是 ErrorRankList 既有调用方零改动）。
- `UsageOverviewPage` 用量档 board 内、活跃时段 Panel 之后、`compactionRow` 之前
  插入，外层同款 `grid-column: 1 / -1` 容器。
- 数字格式：次数 `toLocaleString("en-US")`；占比 `toFixed(1)+"%"`；会话 `N 会话`。

### 异议（契约补字段）

1. **`CensusBucket` 需补 `topSessions`**：`readonly { label: string; session?:
   SessionMeta | null; calls: number }[]`（Top-5，含子链口径）。下钻是聚合口径
   （「哪些会话用得最多」），落聚合层才能被单元测试锁住（N1 异议 1 同款原则）；
   `session` 引用拿不到时给 path，视图层查 `metadataCache`。会话 label 与
   CompactionStatsPanel 的 topSessions 同源同款（握手两处不说两种话）。
2. **MCP 展示按 server、契约按 server·tool**：契约桶是
   `{kind:"mcp"; server; toolName}` 两级，视图需要 server 级行＋工具明细。建议二选一：
   a) 契约 MCP 桶直接按 server 聚合、桶内附 `tools: {name, calls}[]` 明细（推荐——
   可单测）；b) 保持两级桶，视图层聚合（MCP 桶数极少，可接受）。视觉只消费
   「server 行＋title 工具明细」，两种契约形态都不阻碍视觉。
3. **折尾集合的会话榜**：视图层纯函数 `mergeTopSessions(buckets)`（同会话跨桶
   求和 → 取 Top-5）补单测；聚合层不必为折尾单独出口径。
4. **会话数（`sessions`）与下钻列表同口径**（均含子链，契约已写明）——caption
   不再复述，栏头数字与下钻头行数字天然一致。

### e2e / 门禁锚点

- 探针：Panel 根 `data-tool-census`；体首行 `data-tool-census-total`；下钻列表容器
  `data-tool-census-sessions`；下钻头 `data-tool-census-filter`（值 = 选中 label，
  未选中不在场）。沿 `data-probe-pending` / N1 `data-error-*` 先例。
- e2e（双引擎，`tool-census-session.jsonl` 与单测共用）：榜行数字与夹具一致 →
  dual 读数（次数＋会话数）→ 点桶行下钻区在场且会话行正确 → 折尾行可下钻 →
  MCP 行 title 含工具明细 → 点会话行跳转 → 桶空态与全空态文案 → 主链数在
  行 title（断言 `title` 属性）。
- GUI 门禁：新面板可达步骤＋几何事实——**榜行与清单行都是真 `ul > li > button`，
  行高测 li**（N1/N2 教训）；下钻区在场时四栏不位移。
- 截图：用量档整页（亮暗 × 双引擎，含新面板与一次下钻选中态）；主清单与自测
  清单同步（N1 教训）。
- 变异呼应 design.md §3：删 sidechain 遍历 → 体首行主链数＝总数用例红；删 mcp
  前缀判定 → MCP 行用例红。

---

## 附：与用量档同族语言核对清单

Panel＋ProvenanceBadge(logged) ／ 整行 `grid-column: 1/-1` ／ 折尾「其他 N 类」＋
中性台阶 ／ 选中 accent-soft＋左缘竖条 ／ caption `--fs-xs` tertiary 常显 ／
空态事实行（不画 0 条）／ 千分位 `en-US` ／ 行 26px 惯例 ／ li 承载行高 ／
渐进更新无骨架——十项全部继承，无一项新造。
