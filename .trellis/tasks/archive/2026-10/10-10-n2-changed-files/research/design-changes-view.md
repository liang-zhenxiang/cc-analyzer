# 「改动文件」视图设计规格（轻量级）

> 设计：UI/UX 子 agent（designer-n2）｜2026-10-10｜Round N / N2
> 输入：`prd.md`、`design.md`（FileActivity 契约定案）、`research/file-history-facts.md`
> （67 会话 1,382 个编辑文件实测）、`tokens.css`、N1 视觉语言基线
> （`.trellis/tasks/10-10-n1-error-patterns/research/design-error-view.md`）、
> 兄弟视图 `ContextView` / `DroppedList` / `CompactionPanel`、
> `SessionAnalyzerPage` 的 pane 舞台与 `locateInLog` 机制。
> 定位：会话内列表视图，复杂度低于 N1 整页仪表盘——规格聚焦信息架构与行语言，
> 视觉词汇**全部继承 N1，零新词**。

---

## 0. 设计立场

**改动视图是一张按文件归档的现场清单：回答「这次会话动了哪些文件、动了多少次、
哪一下动的」，每条线索都能一跳回到日志原文。** 它不是图表、不是仪表盘——
一张表头清楚、列稳定、可一屏扫几十行的密集清单，就是本视图的全部形态。
失败是事实注记不是警报，新建是属性不是喜讯，全视图零红色。

---

## 1. 关键裁决表

| # | 问题 | 决定 | 弃选与一句话理由 |
| --- | --- | --- | --- |
| 1 | 视图整体形态 | **单个 Panel「改动文件」填满 pane，面板体内部滚动**（LogView 舞台模式），不学 ContextView 的 stack 多面板 | stack 面板没有高度约束，数百文件会把页面撑成无限长 |
| 2 | 时间线 / 筛选条是否渲染 | **不渲染**（与 `context` 档同款：`view === "changes"` 时隐藏 TimelineTrack + FilterBar） | 记录级筛选会让「N 个文件」的口径漂移——context 档已有同构先例与同款理由 |
| 3 | 文件行读数排布 | **固定列 + 表头**：「改动」「查看」两列右对齐 mono tabular，列名由 sticky 表头承载 | 弃「改 4 · 查 12」行内文字簇——各行宽度不同，眼睛要逐行找数字落点；弃行内迷你条形——把清单变图表，且改/查双条互相竞争 |
| 4 | 改动列是否拆 Edit/Write | **合并为「改动」一列**（= edits + writes；口径脚注定义含 NotebookEdit） | 三列太碎，NotebookEdit 极罕见；拆开没有对应任何扫读问题 |
| 5 | 时间列 | **单列只显末次 `MM-DD HH:mm`**（排序键可见 = 排序可验证，provenance 纪律）；首次进 title 与展开区小结行 | 弃区间全显（140px+ 挤路径）；弃首末双行（破坏单行密度）；补零恒宽 11 字符取自 CompactionPanel `shortStamp` 先例，mono 列零抖动 |
| 6 | 展开形态 | **手风琴：点文件行 → 该行下方插入记录清单，单开**（再点收起；点别的文件自动换） | 弃右侧栏——RecordDetailPanel 的 360px 侧栏是「单记录全细节」语义，抢它会把两个选中语义搅在一起；弃下方固定清单区——CompactionPanel 模式适合「≤十几个 chip + 一张取证卡」，文件数百行时来回距离太远；弃多开——高度抖动翻倍而无额外叙事 |
| 7 | 展开区排序 | **时间正序**（与日志表同向）——跳日志的前一步看得见现场的时间形状 | 文件行是倒序（入口按最近），下钻清单是叙事序（怎么一路改过来），两者职责不同 |
| 8 | 失败记录视觉档位 | **成功行无标记；失败行在工具名后加 `失败` 注记**（`--fs-xs` `--text-tertiary`），title 补「不计入上方计数」 | 弃 `--danger`——N1 纪律：红色只给异常判定，失败调用是事实记录；弃删除线——否认存在，而它确实发生了；成功是默认期望（`statusOf` 的 na 不标），无注 = 成功 |
| 9 | 通道色块（N1 的 8px 方块） | **不引入**：记录行只有工具名文字 | 本视图没有双通道并置的辨别问题，也没有图表要锚定色块身份——色块是跨图表通道追踪的锚点，这里无锚可追 |
| 10 | 新建徽标 | **中性 chip「新建」**（N1 子 agent chip 同形制：`--bg-inset` 底 + `--border` 发丝边 + `--r-xs` + `--fs-xs`），紧跟路径之后 | 弃 `--success`——success 是「确定的读数」语义档，借去表达新建会毁掉两个档；新建是属性不是结论 |
| 11 | 子 agent 徽标位置 | **行尾时间列之后**，「子agent N」chip（N1 同款形制 + 计数） | 与「新建」分居两处各随其义：新建属于路径（这个文件是新建的），子 agent 属于调用来源；两个 chip 挤在一起会互抢扫读 |
| 12 | 聚合概览条（HBar） | **不做**；Panel actions = 一行文字聚合读数 `12 个文件 · 31 次改动 · 58 次查看 · 3 个新建` + `ProvenanceBadge logged` | 单会话内的文件计数分布没有跨实体比较意义（不像 N1 按项目/按工具）；文字读数足够且更克制 |
| 13 | 表头可点排序 | **不做**；排序固定 lastAt 降序（契约定案） | 可点表头暗示可排序、实际只有一列可排——假可供性比没有更糟 |
| 14 | 虚拟化 | 复用 `measuredRows` + `virtualWindow`（DroppedList 同款），`--row-h` 基准，`logWindowRows` 阈值 | 大重构会话文件可数百行；展开行变高由逐行实测天然覆盖 |

---

## 2. 版式线框

```
（会话分析器 · pane 内；时间线与筛选条不渲染——同 context 档）

┌ Panel: 改动文件 ─────────────────── 12 个文件 · 31 次改动 · 58 次查看 · 3 个新建 ●(logged) ┐
│ ┌ 表头（sticky，grid 同模板，--row-h）────────────────────────────────────────────┐ │
│ │          文件                    改动   查看   末次活动                        │ │
│ ├────────────────────────────────────────────────────────────────────────────────┤ │
│ │ ▾ src/web/foo.ts [新建]            4     12   10-08 15:11        [子agent 2]   │ │ ← 展开中的文件行（选中态）
│ │   ┌ 展开区（bg-subtle，左缘缩进）──────────────────────────────────────────┐    │ │
│ │   │ 7 条记录 · 其中 1 次失败 · 首次 14:02 · 末次 15:11（fs-xs tertiary）    │    │ │
│ │   │ 10-08 14:02  Write  [新建·成功默认无注]                          [→]  │    │ │
│ │   │ 10-08 14:11  Edit                                          [→]  │    │ │
│ │   │ 10-08 14:30  Edit   失败                                   [→]  │    │ │
│ │   │ 10-08 15:11  Edit                              [子 agent]    [→]  │    │ │
│ │   └─────────────��─────────────────────────────────────────────────────────┘    │ │
│ │ ▸ docs/bar.md                      1      —   10-08 13:40                      │ │
│ │ ▸ /etc/hosts                       —      3   10-08 13:02                      │ │ ← 项目外路径原样
│ │ ▸ src/lib/x.rs                     3      6   10-07 18:22        [子agent 1]   │ │
│ │   …（--row-h 虚拟滚动）                                                          │ │
│ ├ 口径脚注（常显，面板底）──────────────────────────────────────────────────────┤ │
│ │ 改动 = 成功的 Edit / Write / NotebookEdit；查看 = 成功的 Read；失败调用可见于   │ │
│ │ 下钻清单但不计数；不含 Bash 等间接写文件的调用；含子 agent 调用。会话内的         │ │
│ │ file-history 快照记录已登记解析，本视图暂不消费。                                │ │
│ └────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────┘
```

计数列的 `—`：该维度为 0 时显示（见 §3.1「零读数」）；`—` vs `0` 的选择见状态表。

---

## 3. 逐状态规格

### 3.1 文件行（默认态）

grid 模板：`▸记号 24px ｜ 路径 minmax(0,1fr) ｜ 新建chip auto ｜ 改动列 ｜ 查看列 ｜ 末次列 ｜ 子agent chip auto`，行内左右 `--row-pad-x`，行高 `--row-h`。**固定列宽不写 px 字面量、也不新增令牌**：数值/时间列 `max-content` + 右对齐（DroppedList `rowTime` 自然宽先例），时间恒宽由补零格式保证，130% 字号下列随内容自适应。

| 段 | 规格 |
| --- | --- |
| 展开记号 | `▸`/`▾`，24px 命中区（LogView 折角画法：`--control-h-sm` 方形、无边框字形），`--text-tertiary`，hover `--text` |
| 路径 | `relPath`，`--font-mono` `--fs-sm` `--text` 单行 ellipsis（`min-width:0`）；**title = 完整 path**（隐私约定：界面只出现相对路径，全路径仅悬停可见） |
| 新建 chip | `新建`，`--bg-inset` 底 + `--border` 1px 发丝边 + `--r-xs` + `--fs-xs`/`--lh-xs` `--text-secondary`；`createdNew` 才渲染；title = `会话内首次出现即由 Write 创建` |
| 改动列 | edits + writes 合计，右对齐 `--font-mono` tabular `--fs-sm` `--text-secondary`；0 → `—`（`--text-faint`；纯查看文件在「改动」视图的读数就是「没有」，破折号比 0 更快扫出「这行没改动」） |
| 查看列 | reads，同上；0 → `—` 同理 |
| 末次列 | lastAt，`MM-DD HH:mm` 补零（CompactionPanel `shortStamp` 同款），`--font-mono` tabular `--text-tertiary` |
| 子 agent chip | `子agent N`（N = sidechainCount），N1 形制（`--bg-inset` + `--border` + `--r-xs` + `--fs-xs` `--text-tertiary`）；>0 才渲染；title = `其中 N 次成功调用由子 agent 发起` |
| 行 title | 全文拼一行：`{完整路径} · 改动 {edits+writes}（Edit {edits} · Write {writes}）· 查看 {reads} · 首次 {firstAt MM-DD HH:mm} · 末次 {lastAt}{· 子 agent N}`——**每个列值在 title 里都有带定义的全称版本**（tooltip 非唯一通道的反向应用：悬停是列定义的兜底路径） |

- 行是**真 `<button>`**（整行命中，非仅记号），`aria-expanded`；内部 chip 均为 `span`（button 不可嵌 button）。
- 全失败文件（counts 全 0 但 recordIds 非空）：行照常出现（「试了没改成」也是接触过的事实），两列均 `—`，展开后小结行明说（§3.3）。

### 3.2 文件行状态

| 状态 | 规格 |
| --- | --- |
| 悬停 | `background: var(--bg-hover)` + `--dur-hover` 过渡（LogView 行同款） |
| 展开中（选中） | `background: var(--accent-soft)` + `box-shadow: inset 2px 0 0 var(--accent)`（**左缘 2px 竖条**，N1 / 日志表选中行同语言）+ `font-weight: 600` 路径列（灰度截图下底色会消失，字重是第二信号——LogView `.selected` 先例） |
| 聚焦（focus-visible） | 全局 outline 环（`--ring`）；键盘导航的活动行 = 同选中竖条（`useRowNavigation` 语言） |
| 减动效 | `prefers-reduced-motion: reduce` 时 transition none（全局惯例） |

### 3.3 展开区（手风琴）

挂在展开文件行之后、列表流内（虚拟化行的一部分），`background: var(--bg-subtle)` + 上 `--border` 发丝线，左缘与路径列文字对齐（不整行缩进——对齐路径即对齐了「这些记录属于这个文件」的视觉归属）。

**小结行**（首行，`--fs-xs` `--text-tertiary`）：

> 7 条记录 · 其中 1 次失败 · 首次 10-08 14:02 · 末次 10-08 15:11

- 这是 **firstAt 与失败数的非悬停路径**（文件行 title 之外唯一的常显位置）；
- 全失败文件：`4 条记录 · 全部失败 · 首次 … · 末次 …`；
- 仅 1 条记录时：`1 条记录 · 首次 …`（「其中 0 次失败」不出现——无注即成功的同构）。

**记录行**（`--row-h`，时间**正序**）：

```
10-08 14:30  Edit   失败                                    [→]
10-08 15:11  Edit                       [子 agent]          [→]
```

| 段 | 规格 |
| --- | --- |
| 时间 | `MM-DD HH:mm` 补零，`--font-mono` tabular `--text-tertiary` |
| 工具名 | `Edit` / `Write` / `Read` / `NotebookEdit`，`--fs-sm` `--text-secondary` 600（N1 事件行身份段同款） |
| 失败注记 | `失败`，`--fs-xs` `--text-tertiary`，工具名后 `--sp-15`；title = `该调用失败，不计入上方计数`。**无 danger 色**（裁决 #8） |
| 子 agent chip | `子 agent`（无计数，记录级就是 1 次），N1 形制；title = `子 agent 记录暂不能定位到日志行——点击跳回日志视图的会话现场`（N1 同款限制说明，见 §7-2） |
| 行尾箭头 | `→`，`--text-faint`，hover 显（`--dur-hover`）——N1 事件行同款 |
| 行为 | 真 `<button>`：hover `--bg-hover`；click → `locateInLog(record.fullId)`（切 log 档 + highlightId 1.6s 闪烁，现有机制零改动） |
| 行 title | `{MM-DD HH:mm} · {工具名}{· 失败，不计入计数}{· 子 agent} · 点击跳回日志视图定位` |

**新建标记在记录行也出现吗？**——不。`createdNew` 是文件级聚合属性（哪一次 Write 创建的在下钻里可由 `Write` + 时间序自读，title 全文已给分项数字）。克制优先。

### 3.4 表头

sticky 于面板体顶部（`position: sticky; top: 0`，底 `--border` 发丝线——LogView 表头地板），grid 与文件行同模板，高 `--row-h`，文字 `--fs-xs` `--text-tertiary`：`文件`（左对齐，与路径列对齐）/ `改动` / `查看` / `末次活动`（三者右对齐）。纯视觉 div（不参与行语义），文字真实可读不 `aria-hidden`。

### 3.5 空态（纯问答会话）

Panel 骨架保留（同 ContextView 空态先例），actions 省略，面板体 = `EmptyState size="panel"`：

- title：`本会话没有接触任何文件`
- description：`没有成功的 Edit / Write / NotebookEdit，也没有 Read。`

口径脚注照常在场（空态的口径同样成立——「0 是检查后的结果」由脚注的口径定义背书，N1 空态同构）。

### 3.6 解析中 / 出错 / 未选会话

页面级舞台态（`parsing` / `ErrorState` / 空态）与兄弟视图共用，不另造。

---

## 4. 颜色裁决表（零新增令牌，双主题逐令牌）

| 用色点 | 令牌 | 浅色值 | 深色值 | 为什么 |
| --- | --- | --- | --- | --- |
| 路径文字 | `--text` | `#16181b` | `#f0f2f5` | 行主体、扫读对象 |
| 计数 / 工具名 / 「失败」注记 / 小结行 | `--text-secondary` / `--text-tertiary` | `#4a5260` / `#6b7381` | `#b4bcc6` / `#8b939e` | 读数与注记穿文字令牌；失败是注记不是警报（裁决 #8），tertiary 在两主题 ≈7:1 / ≈6:1，可读 |
| 新建 chip / 子 agent chip | `--bg-inset` + `--border` + `--text-secondary`（新建）/ `--text-tertiary`（子agent） | `#f1f3f5` / rgba(16,24,40,.1) | `#0a0b0d` / rgba(255,255,255,.07) | 归属与属性信息走中性台阶（N1 徽标裁决逐字继承）；两个 chip 同形制不同文字色制造半档层级：新建是文件属性（更近主体），子 agent 是来源（更外围） |
| 展开区底 | `--bg-subtle` | `#ffffff` | `#14161a` | LogView `.expanded` 同款——同台阶升半级，不用边框造层 |
| 选中行 | `--accent-soft` + `--accent` | rgba(41,82,204,.1) / `#2952cc` | rgba(127,168,255,.16) / `#7fa8ff` | 选中是 accent 的本职；左缘竖条 + 字重双信号（灰度可辨） |
| 行尾箭头 / 零读数 `—` | `--text-faint` | `#9aa1ac` | `#5c636d` | faint 只放不需要读的装饰（箭头 hover 才需要、`—` 的信息在位置不在字形） |
| 零值档 | `—`（`--text-faint`）vs 数字（`--text-secondary`） | — | — | 「没有」与「有但为 0」在本视图无区别（0 就是没改），`—` 让非零数字更快跳出来 |

**本视图彩色只有 accent 一系**（选中/焦点）。无 chart-*、无 danger、无 cat-*——它是清单不是图表，是事实不是判定。这是与 N1 最大的用色差异，也是更克制的一档。

---

## 5. 交互与键盘

**指针**

- 文件行：hover `--bg-hover`；click = toggle 展开（单开：展开 B 时 A 自动收起）；再点收起。
- 记录行：hover `--bg-hover` + 箭头显；click = `locateInLog` 跳日志（不 toggle）。
- 表头不可点（裁决 #13）。

**键盘**（`useRowNavigation` 语言，DroppedList 同款）

- 文件列表：容器 `tabindex=0`，`↑/↓` 行移动（焦点行 = 左缘竖条），`Enter/Space` toggle 展开，`Esc` 收起当前展开。
- 展开区记录行：真 button（Tab 可达）+ 容器 `↑/↓` 移动，`Enter/Space` 跳日志定位；焦点行 = `inset 2px var(--accent)`。
- 展开的文件行滚出视口再滚回：展开态保留（`expandedPath` 状态）。
- 焦点可见性永不依赖颜色单信号（竖条 + 底色 + outline 三通道）。

**动效**：仅 hover `--dur-hover` 与定位闪烁（日志表 `cca-flash` 现有）；展开/收起**内容直换、无布局动画**（虚拟化高度变化 + 动画 = 布局抖动放大器）。

**字号缩放 90–130%**：文字全走 `--fs-*`/`--lh-*` 成对；`--row-h` 由 `--lh-sm` 派生自动跟随；固定列 `max-content` 随字号自适应；路径 ellipsis + title 兜底。

---

## 6. 与 N1 视觉语言的继承对照

| 词汇 | N1（错误视图） | 本视图 | 关系 |
| --- | --- | --- | --- |
| 子 agent 徽标 | chip「子 agent」+ title 定位限制 | 文件行「子agent N」带计数 + 记录行「子 agent」+ 同款 title | **形制逐字复用**；文件级多一个计数（聚合层级不同，词汇同源） |
| 行选中语言 | `--accent-soft` + `inset 2px accent` 左缘竖条 + aria-pressed | 展开中的文件行同款 + 路径 600 字重 | **逐字复用**（字重补自 LogView `.selected`，同语言族） |
| 事件行骨架 | 时间 mono · 记号 · 身份 600 · 预览 · chip · 行尾箭头 | 时间 mono · 工具名 600 · 失败注记 · chip · 行尾箭头 | **同族**；去色块记号（裁决 #9）、以注记替预览（本视图无需摘录文本，跳日志即全文） |
| 折尾/徽标中性台阶 | `--bg-active`+`--border-strong` 容器、chip 中性色 | chip 中性色 | **复用**（本视图无折尾容器——文件不折尾，虚拟滚动承担长尾） |
| 口径脚注常显 | KPI 脚注两行常显 | Panel 底 caption 四句常显 | **复用**（藏起来的口径等于没有口径） |
| tooltip 非唯一通道 | 原始数有非悬停路径 | firstAt / 失败数有展开区小结行这个非悬停路径 | **复用原则** |
| 红色纪律 | danger 只给异常判定 | 本视图**零 danger**——没有判定只有事实，红色完全不出场 | N1 纪律的推论：更少判定 → 更少红色 |
| 通道色 | chart-1/chart-4 双通道贯穿 | 无通道色（无图表） | 本视图特有之「无」——不搬不造 |
| 新建 chip | —（无对应） | 中性 chip，形制承自 N1 徽标语言 | **本视图唯一新词汇**，且是形制复用语义新增 |

---

## 7. 异议节（实现前回 `design.md` 定案）

1. **`firstAt` / `lastAt` 是否含失败调用**：契约注释只说「含 Read」。建议**含失败**（失败也是接触该文件的事实，且全失败文件需要 lastAt 才有落位）。若定案不含，全失败文件（counts 全 0）的 firstAt/lastAt 将为 undefined——契约需改为可空并在行上降级显示 `—`。
2. **sidechain 记录点击后的定位降级**：sidechain 记录不在 `parsed.records`（日志表行）里，`locateInLog(fullId)` 会切档但不亮行。与 N1 同构，建议**照调不拦**（跳回日志现场仍是有效落点）+ chip title 预先说明；若实现时发现 `highlightId` 落空有副作用（如 1.6s 计时器空转），在 `locateInLog` 内对不可命中 id 早退即可，不动本视图。
3. **`recordIds` 的取回性**：展开区需要按 fullId 从 `parsed.records + parsed.sidechainMessages` 查回记录（读 isError / toolName / isSidechain / timestamp）。建议视图内建 `Map<string, SessionRecord>`（ContextView `recordByFullId` 同款）；契约不补字段。

---

## 8. 实现注意点（给实现者）

- **新组件清单**：`ChangedFilesView.tsx` + `.module.css` + `changedFiles.ts`（纯函数，design.md §1.1）；`AnalyzerView` 加 `"changes"`，`ANALYZER_VIEW_ITEMS` 追加 `{ value: "changes", label: "改动" }`（排在「上下文」后），`readStoredView` 白名单同步加（未识别回退 log 的防呆已覆盖）。
- **`view === "changes"` 与 `"context"` 同款**：不渲染 TimelineTrack + FilterBar（SessionAnalyzerPage 的条件收窄为 `view === "log" || view === "tree"`）。
- **虚拟化**：DroppedList 同款（`useMeasuredRowHeights(ROW_HEIGHT * fontScale)` + `buildRowOffsets` + `computeSizedWindow`）；ROW_HEIGHT 基准 30（`--row-h` 的 100% 值）；**展开行是变高行**，逐行实测天然支持，展开/收起后无需手动重置（measureRow ref 回调覆盖）；切换文件展开时**不需要**滚回顶部（单开手风琴的换向是局部变化）。
- **时间格式**：`MM-DD HH:mm` 补零——抽一个 `shortStamp` 等价函数（CompactionPanel 已有私有实现，建议上提到 `lib/format.ts` 共用，两处口径同一来源）。
- **数字格式**：计数直接显示（个位数量级无千分位需求；>999 显示原样，tabular 对齐不破）。
- **探针（data-changes-\*）**：容器 `data-changes-view`、文件列表 `data-changes-files`、文件行 `data-changes-file="{relPath}"`（**用 relPath 不用索引**——索引随排序变，路径稳定）、展开区 `data-changes-records`、记录行 `data-changes-record`、空态 `data-changes-empty`。
- **e2e 锚点**（双引擎）：改动档可见且聚合行数字与夹具一致 → 点文件行出现展开区且记录数一致 → 点记录行跳回日志档且高亮行在视口 → 纯问答夹具走空态断言。
- **GUI 门禁**：默认清单在「上下文」后插「改动」步骤；**沿用「视图=改动」动作模式自愈**（N1 教训：视图状态持久化在 `cca-analyzer-view`，门禁步骤显式设档）；几何事实 = 文件列表是真列表（滚动高度 > 视口）+ 展开区可达。
- **归档截图**：改动视图亮暗 × 双引擎四张进 EXPECTED_VIEWS，**主清单与自测清单同一 PR 同步**（N1 的 CI 教训）。
- **测试夹具对齐**：`changed-files-session.jsonl` 的数字与本文档示例无关，断言从夹具计算 expectation。

---

## 9. 明确不做什么（防实现者跑偏）

1. **不做聚合概览条 / 任何图表**——单会话文件分布无跨实体比较意义（裁决 #12）。
2. **不做表头排序、不做改动/查看过滤切换**——排序契约定死 lastAt 降序；两列都常显无需过滤。
3. **不引入通道色块、不借 chart-\* / cat-\* / danger / success 任何一个**——本视图彩色只有 accent 选中系。
4. **不给失败涂红、不给新建涂绿**——中性注记 / 中性 chip（裁决 #8/#10）。
5. **不做多文件同时展开**——单开手风琴。
6. **不做路径树 / 目录分组 / 路径截断中间省略**——平铺 relPath + ellipsis + title 全路径；树是 TreeView 的语言。
7. **不做记录行内容摘要（oldString/newString 预览）**——跳日志即全文，窄空间摘录是重复职责。
8. **不读 file-history 快照正文、不做回滚、不做 diff 重放**——PRD「不做」清单逐条继承。
9. **不做跨会话文件聚合**——后续轮次。
10. **不新增令牌、不写字面量颜色/高度/圆角/时长**——四禁纪律。
