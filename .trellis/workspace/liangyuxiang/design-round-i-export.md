# 「导出与分享」设计规格（Round I）

> 角色：UI/UX 产品设计师（数据可视化 / 桌面工具方向）
> 日期：2026-10-03 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（已锁定，不在本文件中重新讨论）：会话分析页新增一个「导出」入口，导出
> **单文件 HTML 报告**或 **CSV**；导出前有一个应用内浮层；导出的 HTML 是门面资产。
> 本文件只描述设计与断言，不改任何源码。

---

## 0. 语境与现状（先读后写，以下结论都来自实际文件）

写这份规格前逐字读过：`web/src/styles/tokens.css`、`web/src/app/AppShell.tsx`
及其 CSS Module、`web/src/features/sessions/` 下的 `SessionHeader`、`ReportPanel`、
`RecordDetailPanel`、`FilterBar`、`SessionAnalyzerPage`、`tokenTotals.ts`、
`costProvenance.ts`、`web/src/features/usage/BillingWindowCard.tsx` 与
`ProvenanceBadge.tsx`、`web/src/features/search/SearchPalette.*`、
`web/src/components/`（`Button`、`SegmentedControl`、`StatusToast`、`BrandMark`、
`Icon`、`Skeleton`、`EmptyState`）、`web/src/styles/{global,animations}.css`、
`web/src/api/tauri.ts` 的 `dialog.saveMarkdown`，以及
`.trellis/workspace/liangyuxiang/design-critique.md`。
并目验了 `docs/screenshots/analyzer-tree-light-webkit.png`、
`analyzer-report-light-webkit.png`、`analyzer-report-dark-webkit.png`、
`usage-light-webkit.png` 四张真实渲染图。

**可以且必须复用的既有资产**（不重新发明）：

| 需要的东西 | 现成资产 | 位置 |
| --- | --- | --- |
| 浮层骨架（遮罩 + 面板 + `--r-lg` + `--shadow-md`） | `SearchPalette.module.css` | 现成 |
| 二选一的分段控件（含 roving tabindex + 方向键） | `SegmentedControl` | 现成 |
| 按钮四变体 / 图标按钮 | `Button`、`IconButton` | 现成 |
| 成功/失败 toast（右下角、`role="status"`） | `NotificationProvider`、`StatusToast` | 现成 |
| 动作反馈语言（成功给 toast、失败给就地 `role="alert"` + toast） | `runAction(...)`，见 `RecordDetailPanel.tsx` | 现成 |
| 读数行「标签 + 大号 tabular 数字」 | `SessionHeader.module.css` 的 `.readouts/.readout` | 现成 |
| 会话级按钮行（复制 resume 命令 / 打开位置） | `SessionHeader` 的 `.actions` | 现成 |
| 成本估算 + 定价快照 | `estimateCost`、`PRICING_AS_OF` | 现成 |
| 系统保存对话框 | `bridges.dialog.saveMarkdown`（**filters 写死 Markdown，需泛化**） | 半现成 |
| 剪贴板 | `bridges.clipboard.writeText` | 现成 |
| 字标 | `BrandMark`（PNG，**导出物里不可用**，见 §3.1） | 应用内可用 |

**已确立、本设计不得违反的判断**（来自 tokens.css 首段与 design-critique）：

1. 骨架一律中性灰，颜色只出现在数据上；文档流内零阴影，阴影只给脱离文档流的浮层。
2. 主按钮用墨色（`--ink`），强调色退出「动作」语义，只做焦点环/链接/选中底。
3. 任何新特性都走既有的「浮层语言」「面板语言」「读数语言」，不新造第三套。
4. 会话内容与用户路径视同敏感数据（AGENTS.md 红线）。这条直接决定了 §3.9 的隐私规则。

---

## 1. 信息架构与交互流

### 1.1 入口

- 位置：`SessionHeader` 的 `.actions` 组内，**排在「打开位置」之后**（DOM 顺序也如此）。
  理由：这条头部已经承载「会话级动作」（复制 resume 命令、打开位置），导出是同一级的
  会话级动作；把它放进 `ReportPanel` 头部会和那里已有的「导出 .md」混在一起——
  那一个是导出 **AI 分析报告**，这一个是导出 **会话数据**，两者不是一件事。
- 文案：`导出`。不加图标（`.actions` 里三个按钮全是纯文字、同高，插一个图标会破坏这排的
  水平节奏；`IconButton` 在这里也放不下「导出」这个需要解释的动作）。
- 变体：`secondary`（与 `复制 resume 命令`、`打开位置` 一致）。**不用 primary**：
  primary 是每个视图唯一的一个主行动，会话页的主行动是「看清数据」，不是导出。
- 触发条件：`parsed` 就绪即可用。`parsed === null`（解析中）时按钮不渲染——
  没数据可导，渲染一个禁用按钮只是噪音。

### 1.2 完整路径（状态机）

```
[会话页 · 点击「导出」]
        │ 记录触发元素引用（用于关闭后归还焦点）
        ▼
[浮层打开 · open=true]  ── Esc / 点遮罩 / 点 ×  ──▶ [关闭 · 焦点回到「导出」按钮]
        │
        │  格式 = HTML 报告（默认）    范围 = 当前筛选结果（默认）
        │  计数行随「范围」实时更新
        │
        ├── 点「复制到剪贴板」
        │       │
        │       ├─ 成功 → 浮层内 role="status" 显示「已复制 N 条记录的 CSV」
        │       │         按钮短暂变为「已复制」；浮层保持打开（用户多半还要保存）
        │       └─ 失败 → 浮层内 role="alert" 显示失败原因；浮层保持打开
        │
        └── 点「保存…」
                │
                ├─ 用户在系统对话框里点「保存」→ 写入成功
                │       → 关闭浮层 → toast「已导出 HTML 报告」→ 焦点回到「导出」按钮
                ├─ 用户在系统对话框里点「取消」（save 返回 null）
                │       → 什么都不发生：浮层保持打开、无 toast、无 error
                └─ 写盘失败 → 浮层内 role="alert" + toast(error)，浮层保持打开
```

### 1.3 默认选项（必须是确定值，不随数据跳变）

| 项 | 默认 | 理由 |
| --- | --- | --- |
| 格式 | `HTML 报告` | 功能背景把 HTML 定为「门面资产 / 被转发的载体」，主路径优先。CSV 是给脚本和 Excel 的次级路径。 |
| 范围 | `当前筛选结果` | 用户在会话页刚做的事就是「筛出一段」；默认尊重他刚建立的上下文。**注意**：即使当前没有生效的筛选，默认值也**不**跳到「全部记录」——默认值随数据变化会让人无法建立肌肉记忆。此时两个范围的计数相同，用一行说明文案讲清楚（见 §2.3）。 |
| 文件名 | 见 §1.5 | |

范围两个选项的计数口径（必须与页面一致，**这是最容易数错的地方**）：

- `当前筛选结果` = `records.length`（`SessionAnalyzerPage` 里 `recordsOfRows(logRows)` 的结果）。
- `全部记录` = `parsed.records.length`。

### 1.4 键盘可达

鼠标路径之外，全程必须可用键盘走完：

| 键 | 行为 |
| --- | --- |
| `Tab` | 进入浮层；在浮层内按 DOM 顺序移动；到最后一个可聚焦元素后**环绕**回第一个（焦点陷阱） |
| `Shift+Tab` | 反向移动，到第一个后环绕到最后一个 |
| `←/→/↑/↓/Home/End` | 在「格式」「范围」两个分段控件内移动并**自动激活**（复用 `SegmentedControl` 已实现的 roving tabindex 语义，整组只占一次 Tab） |
| `Enter/Space` | 激活当前聚焦的按钮 |
| `Esc` | 关闭浮层，**焦点归还给触发按钮**；事件 `stopPropagation()`，不冒泡到 AppShell 的全局 ⌘K 监听 |

DOM 内的 Tab 顺序（视觉从上到下，与阅读顺序一致）：

1. `×`（关闭，`IconButton label="关闭导出窗口"`）
2. 格式分段组（整组一次 Tab，组内用方向键）
3. 范围分段组（同上）
4. `复制到剪贴板`
5. `保存…`

初始焦点**不是** DOM 第一个元素（`×`），而是「格式」分段的当前选中项：用户进来第一件
事是确认格式，把焦点放在决策点上比放在关闭按钮上更省事。这一点需要在实现里显式
`focus()`，靠 `autoFocus` 拿不到（`autoFocus` 只会落在 DOM 首个可聚焦元素）。

### 1.5 文件命名与写盘

沿用 `ReportPanel` 现有的命名口径（`sessionId.slice(0, 8)`），但 HTML 是分享物，
文件名要带品牌：

| 格式 | 默认文件名 | 说明 |
| --- | --- | --- |
| HTML | `cc-analyzer-<sessionId 前 8 位>-<filtered\|all>.html` | 例：`cc-analyzer-3d2a5442-filtered.html` |
| CSV | `<sessionId 前 8 位>-<filtered\|all>.csv` | 例：`3d2a5442-all.csv` |

**文件名一律 ASCII**：会话标题常含中文、空格、`/`、`:`，直接进默认文件名会在
Windows（非法字符 `\/:*?"<>|`）和跨平台压缩包里炸掉，也会重演 AGENTS.md 里记的
「产物文件名不含空格」那类事故。会话标题只出现在**文件内容**里（HTML 的 `<h1>`、
CSV 无标题列）。

### 1.6 复制到剪贴板的行为与反馈

剪贴板走 `bridges.clipboard.writeText`（纯文本），行为随格式而定，且**必须写清楚**：

| 格式 | 复制内容 | 浮层内的说明文案 |
| --- | --- | --- |
| CSV | CSV 全文（**不带 BOM**，行尾仍是 CRLF） | 「粘贴到脚本或编辑器；要让 Excel 正确分列请用「保存…」」 |
| HTML | HTML 源码全文（纯文本） | 「复制的是源码；要让对方看到排版，请「保存…」后发 .html 文件」 |

- 复制**不带 BOM**：BOM 是「Excel 双击打开文件」这条路径的补丁，剪贴板是粘贴路径，
  多出来的 U+FEFF 会变成粘贴结果里的一个不可见字符（`JSON.parse` 直接报错）。
- v1 **不写富文本剪贴板**（`ClipboardItem` / `text/html`）：WKWebView 下这条路径
  需要额外权限与降级分支，风险不可控，收益只是「粘进聊天能直接渲染」。写进「不做」清单。
- 成功反馈：浮层内 `role="status"` 一行（就地），文案 `已复制 N 条记录的 CSV` /
  `已复制 HTML 源码`；按钮文案在 2 秒内变成 `已复制` 再回退。
  浮层保持打开——复制和保存是两个独立动作，复制完常常还想存一份。
- 失败反馈：就地 `role="alert"`（带原因）+ 全局 error toast，沿用 `runAction` 的语言。

> **为什么复制成功不靠 toast**（重要）：`StatusToast` 的 `z-index` 是 `30`，
> 而浮层遮罩是 `100`——浮层打开时 toast 会被压到遮罩下面，用户根本看不见。
> 因此浮层内的反馈一律**就地**呈现。保存成功后浮层已关闭，那时再用 toast 就是安全的
> （也才符合全应用「成功只弹一条 toast」的语言）。这条是设计约束，不是实现细节。

---

## 2. 导出浮层的视觉规格

### 2.1 布局简图

```
 backdrop: position fixed / inset 0 / z-index 100 / background var(--overlay)
           display flex / align-items center / justify-content center
           padding var(--sp-5)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ panel  width: min(480px, 100%)   background var(--bg-elevated)        │
 │        border 1px solid var(--border-strong)                          │
 │        border-radius var(--r-lg)   box-shadow var(--shadow-md)        │
 │        animation cca-enter var(--dur-enter) var(--ease-out)           │
 │ ┌──────────────────────────────────────────────────────────────────┐ │
 │ │ 导出会话报告            [×]            header                     │ │
 │ │ padding var(--sp-3) var(--sp-4)  border-bottom 1px var(--border)  │ │
 │ ├──────────────────────────────────────────────────────────────────┤ │
 │ │ body  padding var(--sp-4)   display flex column gap var(--sp-4)   │ │
 │ │                                                                  │ │
 │ │  格式                                       ← label --fs-xs/tert │ │
 │ │  ┌───────────────┬───────────────┐          gap var(--sp-2)      │ │
 │ │  │ HTML 报告     │ CSV           │          SegmentedControl     │ │
 │ │  └───────────────┴───────────────┘          role="tablist"       │ │
 │ │  自包含单文件，可离线打开、可直接分享。      ← hint --fs-xs/tert  │ │
 │ │                                                                  │ │
 │ │  范围                                                            │ │
 │ │  ┌───────────────┬───────────────┐                               │ │
 │ │  │ 当前筛选结果  │ 全部记录      │                               │ │
 │ │  └───────────────┴───────────────┘                               │ │
 │ │  ┌────────────────────────────────────────────────────────────┐  │ │
 │ │  │ 将导出 128 条记录          ← 数值 --fs-md/600 tabular      │  │ │
 │ │  │ 当前筛选：共 512 条中的 128 条  ← --fs-xs/tertiary         │  │ │
 │ │  └────────────────────────────────────────────────────────────┘  │ │
 │ │     background var(--bg-inset)  border-radius var(--r-sm)         │ │
 │ │     padding var(--sp-2) var(--sp-3)   role="status"              │ │
 │ ├──────────────────────────────────────────────────────────────────┤ │
 │ │ footer  padding var(--sp-3) var(--sp-4)                           │ │
 │ │         border-top 1px var(--border)                              │ │
 │ │         display flex  justify-content flex-end  gap var(--sp-2)   │ │
 │ │                            [ 复制到剪贴板 ]  [ 保存… ]             │ │
 │ └──────────────────────────────────────────────────────────────────┘ │
 └──────────────────────────────────────────────────────────────────────┘
```

### 2.2 用到的 token（逐项，全部已存在）

| 用途 | 变量 |
| --- | --- |
| 遮罩色 | `var(--overlay)`（**新增，见 §7**） |
| 面板底 | `var(--bg-elevated)` |
| 面板描边 | `var(--border-strong)` |
| 面板圆角 | `var(--r-lg)`（浮层专用档，与 `SearchPalette`/`StatusToast` 同档） |
| 面板阴影 | `var(--shadow-md)`（脱离文档流的浮层才有的东西） |
| header/footer 发丝线 | `var(--border)` |
| 计数条底 | `var(--bg-inset)` |
| 计数条圆角 | `var(--r-sm)` |
| 主文案 | `var(--text)` |
| 次级文案 | `var(--text-secondary)` |
| 标签 / 说明 | `var(--text-tertiary)` |
| 焦点环 | `var(--ring)`（`Button` 自带 `outline: 2px solid var(--ring)`） |
| 字号 / 行高 | `--fs-xs/--lh-xs`（11/16）、`--fs-sm/--lh-sm`（12/18）、`--fs-md/--lh-md`（15/22） |
| 间距 | `--sp-1`（4）、`--sp-2`（8）、`--sp-3`（12）、`--sp-4`（16）、`--sp-5`（24） |
| 时长 / 缓动 | `--dur-enter` + `--ease-out`（进场），`--dur-hover`（悬停，由 `Button`/`SegmentedControl` 自带） |

**0 个新间距、0 个新圆角、0 个新时长、0 个新颜色**（除 §7 的 `--overlay`）。

关于面板宽度 `min(480px, 100%)`：宽度不在「颜色/高度/圆角/时长」四类硬规则里，且
`SearchPalette` 已经用了同样的字面量写法（`min(640px, 100%)`）。两个浮层宽度不同
（640 / 480），没有可共享的值，此时提 `--dialog-w` 是过早抽象。留给「出现第三个同类
浮层且宽度收敛到同一个值」的那一天。

### 2.3 分区规则

- **标题**：`导出会话报告`。`--fs-base`(13px)/600，`--text`。与 `ReportPanel h2`
  同级——面板标题 13px、页面标题 15px，浮层标题属于面板级。
- **格式标签 + 说明**：标签 `格式`（`--fs-xs`/`--text-tertiary`），说明随所选格式变化：
  - HTML：`自包含单文件，可离线打开、可直接分享。`
  - CSV：`逐条记录，供 Excel 或脚本进一步分析。`
  说明文字用 `--fs-xs` 是项目既有边界（tokens.css 注释：11px 中文成句已到可读性边界），
  这里控制在**一句、不超过 24 字**。
- **范围标签 + 计数条**：计数条是浮层里唯一一块「读数」——
  - 第一行：`将导出 <b>128</b> 条记录`，数字 `--fs-md`(15px)/600 + `tabular-nums`。
    与 `SessionHeader` 的读数同一个字号档（15px/600），让用户在浮层里看到的数字和
    页面头部是同一套「仪器读数」语言。
  - 第二行：来源说明，`--fs-xs`/`--text-tertiary`。
    - 有生效筛选：`当前筛选：共 512 条中的 128 条`
    - 无生效筛选（两数相等）：`当前没有生效的筛选，两个范围内容相同`
  - 这一块是 `role="status"`：切换范围时屏幕阅读器能读到新计数。
- **footer**：动作右对齐，`保存…` 在最后（阅读终点即主行动终点），两按钮间距 `--sp-2`。
  `保存…` 用 `Button variant="primary"`（墨色），`复制到剪贴板` 用 `secondary`。
  省略号是 Windows/macOS 的通用约定：会弹出后续对话框。

### 2.4 状态

| 状态 | 视觉 | 断言点 |
| --- | --- | --- |
| 默认 | 如上表 | 面板 `box-shadow !== none`、`border-radius = 12px`、`background = --bg-elevated` computed 值 |
| 悬停 | 交给组件：`Button:hover` 走 `--bg-hover`；`SegmentedControl` 悬停走自己的既有样式。**不在浮层 CSS 里覆盖任何 hover** | 浮层 `.module.css` 中不出现 `:hover` 规则 |
| 禁用 | `Button:disabled` 既有 `opacity: .5` + `cursor: not-allowed` | 保存/复制在保存进行中时 `disabled` 为真 |
| 保存进行中 | 按钮文案 `正在保存…`，`disabled`，`aria-busy="true"`。系统对话框通常是模态的，这个态主要覆盖「对话框已返回、写盘还在进行」的窗口 | 该状态下 `复制到剪贴板` 也 `disabled`（避免两个写动作并发） |
| 复制成功 | 按钮文案 `已复制`（2 秒），计数条下方出现 `role="status"` 一行 | 2 秒后按钮文案回到 `复制到剪贴板` |
| 复制/保存失败 | 计数条下方出现 `role="alert"`，文案 `导出失败: <原因>`，沿用 `ReportPanel` 的 `[role="alert"]` 画法 | 失败后浮层仍在 DOM 中 |
| 保存成功 | 浮层从 DOM 移除 + toast | `queryByRole("dialog") === null` 且出现 toast 文本 |

### 2.5 为什么这样设计（取舍说明）

1. **它长得像 `SearchPalette`，因为它就是同一类东西**：脱离文档流、遮罩压暗、
   最大圆角档、唯一使用 `--shadow-md` 的地方。用户已经学过「这样的东西浮在上面」，
   不需要再学一遍。
2. **浮层里不放表格预览**：内容预览会诱使人把浮层做成第二个列表视图，而浮层要回答的
   只有一个问题——「我导出的到底是什么」。这个问题的答案是**一个数字 + 两行来源说明**，
   不是一张表。少即是准。
3. **不按格式改变范围选项**：CSV 与 HTML 的范围口径完全一样（同一批记录），
   让选项随格式变会让「我刚选的范围去哪了」变成一个新问题。
4. **计数条用 `--bg-inset` 而不是强调色底**：颜色预算留给数据，这里的数字是唯一要读的
   数据，`--bg-inset` 的台阶 + 15px/600 已足够把它顶出来。借 `--accent-soft` 会把
   「选中」的语义偷到「读数」上。
5. **不用 tooltip 承载说明**：说明文案一律是可见的一行小字——这条在
   `SessionHeader` 的 `resumeHint` 里已经定过（「不把『这条命令会失败』藏在 tooltip 里」）。

---

## 3. 导出 HTML 报告的视觉规格

### 3.1 硬约束（先说清楚，因为它们决定了后面每一个选择）

1. **零外部依赖**：不引 CDN、不引 Google Fonts、不引应用 CSS、不引图片文件。
   一个字都不能从网络上取——收件人常常在断网/离线的聊天窗口里打开它。
2. **字标自绘**：应用内的 `BrandMark` 是打包后的 PNG 路径，导出物里不可用。
   报告用「内联 SVG 方点标记 + 文字字标 `CC Analyzer`」重建同一个识别点。
   内联 SVG 不是外部资源，不受 CSP `default-src 'none'` 影响。
3. **所有会话数据必须 HTML 转义**：`& < > " '`。会话摘要里出现 `<script>`、
   `<img onerror=` 是真实可能（用户在终端里贴过任何东西），这是注入面。
4. **不引入任何运行时数据**：见 §3.9 隐私规则。
5. 体量：记录表默认上限 **2000 行**（超出时给一行说明，不静默截断）；
   表格只放**摘要**，不放记录原文（`raw`）与完整工具输出。

### 3.2 文档骨架

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'">
  <title>CC Analyzer 会话报告 · {{会话标题}}</title>
  <style>/* §3.3 的内联样式全文 */</style>
</head>
<body>
  <main class="sheet">
    <header class="head">…</header>      <!-- §3.4 -->
    <section class="summary">…</section> <!-- §3.5 -->
    <section class="records">…</section> <!-- §3.6 -->
    <footer class="foot">…</footer>      <!-- §3.7 -->
  </main>
</body>
</html>
```

`<meta name="color-scheme">` 与 CSS 里的 `color-scheme` **必须同时写**：只写 CSS
的话，浏览器在深色系统下仍可能用浅色默认样式渲染滚动条，出现「白底黑滚动条」。

### 3.3 内联样式（可读、可直接用）

取值刻意与应用 tokens.css **逐一对应**（浅色段与应用的浅色主题同值），
这样「报告是应用的一个切片」在像素上有依据；深色段取 tokens.css 的深色值。
报告不允许 `var(--sp-*)` 这类应用变量——它是独立资产，必须自带常量。

```css
:root {
  color-scheme: light dark;

  /* 表面：与 web/src/styles/tokens.css 浅色段同值 */
  --bg: #f4f5f7;
  --surface: #ffffff;
  --inset: #f1f3f5;
  --text: #16181b;
  --text-secondary: #4a5260;
  --text-tertiary: #6b7381;
  --text-faint: #9aa1ac;
  --border: rgba(16, 24, 40, 0.1);
  --border-strong: rgba(16, 24, 40, 0.18);
  --accent: #2952cc;
  --danger: #b3261e;

  /* 类别色（Okabe-Ito 子集），只用于「记录类型」这一个数据维度 */
  --cat-user: #cc79a7;
  --cat-llm: #009e73;
  --cat-tool: #0072b2;
  --cat-agent: #d55e00;
  --cat-workflow: #6d3bd4;
  --cat-wait: #6b7280;

  /* 系统字体栈：必须完整写出，报告要能在 macOS / Windows / Linux 上都落到合适的中文字体 */
  --font-sans: system-ui, -apple-system, "Segoe UI", "PingFang SC",
               "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 32px 16px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 20px;
  -webkit-font-smoothing: antialiased;
}

/* 「一张纸」：与应用内的面板同一种台阶语言（底 + 发丝线 + 8px 圆角），
   文档流内不加阴影。 */
.sheet {
  max-width: 960px;
  margin: 0 auto;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

/* ---------- 页头 ---------- */
.head { display: flex; flex-direction: column; gap: 12px; }

.wordmark {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  letter-spacing: -0.01em;
}
.wordmark svg { display: block; }

h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;      /* 会话标题可能是一条长命令，不许撑破版面 */
}

.meta {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
}
.meta code {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}

/* ---------- 页头读数行：报告的「表盘」 ---------- */
.readouts {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin-top: 4px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--inset);
}
.readout { display: flex; flex-direction: column; gap: 2px; padding: 0 12px; }
.readout + .readout { border-left: 1px solid var(--border); }
.readout dt { color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.readout dd {
  margin: 0;
  color: var(--text);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  font-variant-numeric: tabular-nums;   /* 数字列不跳动 */
}

/* ---------- 摘要区 ---------- */
.summary { margin-top: 32px; }

h2 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr);
  column-gap: 16px;
  margin: 0;
  padding: 0;
}
.facts dt,
.facts dd {
  margin: 0;
  padding: 6px 0;
  border-top: 1px solid var(--border);
  font-size: 13px;
  line-height: 20px;
}
.facts dt { color: var(--text-tertiary); padding-right: 8px; }
.facts dd { color: var(--text); font-variant-numeric: tabular-nums; }
.facts dd.unknown { color: var(--text-tertiary); font-variant-numeric: normal; }

/* 估算值必须自带来源说明——它是推断，不是读数 */
.estimate-note {
  margin: 8px 0 0;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
}

/* ---------- 记录表 ---------- */
.records { margin-top: 32px; }
.table-wrap { overflow-x: auto; }

table { width: 100%; border-collapse: collapse; }

thead th {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-strong);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0.04em;
  text-align: left;
  white-space: nowrap;
}

tbody td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  line-height: 20px;
  vertical-align: top;
}

/* 数字列右对齐 + 等宽数字：与 CSV 一列一值的原则同源 */
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.summary-cell { overflow-wrap: anywhere; }
.failed { color: var(--danger); }
.muted { color: var(--text-tertiary); }

/* 类型：8px 色块 + 文字。颜色不是唯一信号（文字始终在场）。 */
.swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 2px;
  vertical-align: baseline;
}

.truncated-row td {
  padding: 12px 10px;
  border-bottom: 0;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}

/* ---------- 页脚 ---------- */
.foot {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
}
.foot p { margin: 0; }
.foot p + p { margin-top: 4px; }
.foot a { color: var(--accent); }

/* ---------- 深色（见 §3.8 的取舍） ---------- */
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0f12;
    --surface: #1a1d21;
    --inset: #0a0b0d;
    --text: #f0f2f5;
    --text-secondary: #b4bcc6;
    --text-tertiary: #8b939e;
    --text-faint: #5c636d;
    --border: rgba(255, 255, 255, 0.07);
    --border-strong: rgba(255, 255, 255, 0.14);
    --accent: #7fa8ff;
    --danger: #f0776c;
    /* 只提明度、不动色相，保住 Okabe-Ito 的色盲可区分性（与应用 tokens.css 同一策略） */
    --cat-tool: #4da6e0;
    --cat-workflow: #9b7bf0;
    --cat-wait: #8a93a0;
  }
}

/* ---------- 打印：报告最常见的第二种归宿就是「打印成 PDF」 ---------- */
@media print {
  :root { --bg: #ffffff; --surface: #ffffff; }
  body { padding: 0; }
  .sheet { max-width: none; padding: 0; border: 0; border-radius: 0; }
  thead { display: table-header-group; }   /* 跨页时重复表头 */
  tr { break-inside: avoid; }
  .foot a { color: inherit; }
}
```

### 3.4 页头（结构 + 内容）

```html
<header class="head">
  <span class="wordmark">
    <!-- 内联 SVG 方点标记：不依赖任何图片文件 -->
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="18" height="18" rx="4" fill="#16181b"/>
      <rect x="4" y="4" width="4" height="10" fill="#ffffff"/>
      <rect x="10" y="7" width="4" height="7" fill="#ffffff"/>
    </svg>
    CC Analyzer
  </span>

  <h1>{{会话标题}}</h1>

  <p class="meta">
    项目 <code>{{目录名}}</code> ·
    会话 <code>{{sessionId 前 8 位}}</code> ·
    生成于 {{YYYY-MM-DD HH:mm}}
  </p>

  <dl class="readouts">
    <div class="readout"><dt>总耗时</dt><dd>56.0s</dd></div>
    <div class="readout"><dt>输入</dt><dd>50</dd></div>
    <div class="readout"><dt>缓存读取</dt><dd>3</dd></div>
    <div class="readout"><dt>输出</dt><dd>87</dd></div>
    <div class="readout"><dt>记录数</dt><dd>7</dd></div>
  </dl>
</header>
```

- 五项与 `SessionHeader` 的读数行**同序同名**（总耗时/输入/缓存读取/输出/记录数）。
  同序是有理由的：截图被转发的概率远高于被逐字阅读的概率，两张图长得一样，
  识别成本才是零。
- 数值用 `formatDuration` / `formatTokenCount` 的既有口径（`tokenTotalsOf` 的四个
  计数器**不合并成 total**——tokens.css 与 `tokenTotals.ts` 都立过这条规矩）。
- 页头读数行的格子用「标签在上、数值在下」而不是应用内的「同一基线并排」：
  报告是静态的，且会在窄窗口、邮件预览里被压窄；上下堆叠时每一格自成一块表盘，
  互不挤字。这是本报告唯一一处**有意不照搬**应用的排版。

### 3.5 摘要区

```html
<section class="summary">
  <h2>会话概览</h2>
  <dl class="facts">
    <dt>开始时间</dt><dd>2026-01-02 11:04:08</dd>
    <dt>结束时间</dt><dd>2026-01-02 11:05:04</dd>
    <dt>总耗时</dt><dd>56.0s</dd>
    <dt>输入</dt><dd>50</dd>
    <dt>缓存写入</dt><dd>12,480</dd>
    <dt>缓存读取</dt><dd>3</dd>
    <dt>输出</dt><dd>87</dd>
    <dt>记录数</dt><dd>7</dd>
    <dt>失败记录</dt><dd>0</dd>
    <dt>工具调用</dt><dd>2 次</dd>
    <dt>成本估算</dt><dd>$0.0123</dd>
    <dt>导出范围</dt><dd>当前筛选结果（共 7 条中的 7 条）</dd>
  </dl>
  <p class="estimate-note">
    成本估算按 2026-10-01 的离线定价快照计算，非账单；该模型未收录定价时显示「未知」。
  </p>
</section>
```

- 十二项恰好铺满 6 行 × 2 对，`grid-template-columns` 的两对结构保证不出现半行。
- 成本项的三态必须直说（沿用 `costProvenance.ts` 的立场）：
  - 有价且模型已知 → `$0.0123`（`formatUsd` 口径）
  - 未知模型 → `未知`（`<dd class="unknown">未知</dd>`），说明行里追加
    `另有 N 条记录的模型未收录定价`。
  - 无 token → `未知`，说明行里写 `本次会话没有 token 记录`。
  **绝不打印 `$0.0000`**：它会读成一个事实，而它是错的。
- 估算值永远是「读数旁边带一枚来源标注」的形态——这就是 `ProvenanceBadge`
  「读自日志 / 推算」那套诚实性在报告里的等价物，只是报告没有 hover，
  所以标注改成固定的文字说明行。

### 3.6 记录表

列（8 列，顺序固定，与 CSV 的字段一一对应，但表头用中文给读者）：

| # | 表头 | 数据 | 对齐 |
| --- | --- | --- | --- |
| 1 | 时间 | `HH:mm:ss`（同日）；跨天时 `MM-DD HH:mm:ss` | 左 |
| 2 | 类型 | 色块 + 中文类型名（用户 / LLM / 工具 / Agent / workflow / 等用户） | 左 |
| 3 | 操作 / 摘要 | `recordSummary(record)` 的结果，`overflow-wrap: anywhere`，**不截断** | 左 |
| 4 | 提示词 | 该记录的输入 token 数（无则 `—`） | 右 |
| 5 | 输出 | 输出 token 数（无则 `—`） | 右 |
| 6 | 耗时 | `formatDuration` | 右 |
| 7 | 占比 | `xx.x%`（相对总耗时；总耗时为 0 时 `—`） | 右 |
| 8 | 状态 | `正常` / `失败`（失败用 `--danger`） | 左 |

```html
<section class="records">
  <h2>记录（128 条）</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>时间</th><th>类型</th><th>操作 / 摘要</th><th class="num">提示词</th>
          <th class="num">输出</th><th class="num">耗时</th><th class="num">占比</th><th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="mono">11:04:08</td>
          <td><span class="swatch" style="background:#0072b2" aria-hidden="true"></span>工具</td>
          <td class="summary-cell">Read · src/features/sessions/filters.ts</td>
          <td class="num muted">—</td>
          <td class="num muted">—</td>
          <td class="num">1.50s</td>
          <td class="num">2.7%</td>
          <td>正常</td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="truncated-row">
          <td colspan="8">另有 1,240 条记录未列出（本报告最多列出 2000 条）。</td>
        </tr>
      </tfoot>
    </table>
  </div>
</section>
```

- 颜色**只出现在类型色块**这一个地方（8px 方块，面积 < 0.1%），其余全是中性灰与
  发丝线——这正是「颜色只出现在数据上」在报告里的落地。
- 色块旁永远有文字（`工具`），颜色不是唯一信号；对比度：在 `#ffffff` 上，
  `#0072b2` 5.1:1、`#009e73` 3.4:1、`#d55e00` 3.9:1、`#cc79a7` 3.1:1、
  `#6d3bd4` 6.5:1、`#6b7280` 4.8:1——全部高于图形件 3:1 门槛。
- 截断说明放在 `<tfoot>` 里而不是「悄悄少几行」：少给的数据必须说出来，
  这和应用内 `ReportPanel` 的「只分析最慢的 N 条」是同一条纪律。
- 表体**不需要** JS 排序/筛选：报告是快照，交互不属于它。

### 3.7 页脚落款

```html
<footer class="foot">
  <p>本报告由 CC Analyzer 在本地生成，数据未上传至任何服务器。</p>
  <p>CC Analyzer v0.10.0-beta.2 ·
     <a href="https://github.com/liang-zhenxiang/cc-analyzer">
       github.com/liang-zhenxiang/cc-analyzer
     </a>
  </p>
  <p>报告生成于 2026-10-03 14:22</p>
</footer>
```

- 三行固定顺序：**数据在哪**（本地，未上传）→ **它从哪来**（字标 + 仓库链接）→
  **什么时候生成的**。第二行是这份资产被转发的实际价值所在：看到它的人要能一步找到项目。
- 仓库链接是整份 HTML 里**唯一的外链**，其余 `href`/`src` 一律为零。

### 3.8 深色模式的取舍

**结论：保留 `@media (prefers-color-scheme: dark)`，但深色不是设计目标。**

- 保留的理由：报告会被真人在深色系统的浏览器里打开，白纸在深夜是一记闪光；
  媒体查询是零成本（无 JS、无开关、无状态）。
- 「不是设计目标」的含义：深色段只保证**不崩**——所有前景/背景都直接沿用
  `tokens.css` 深色段已经验过对比度的值，不在这里新调色。浅色仍是唯一的
  「正确长相」，也是截图、文档、发布说明里出现的那一张。
- **不做主题切换按钮**：切换需要 JS + 持久化 + 无障碍标签，而报告必须能在
  「脚本被禁用 / 被邮件客户端净化」的环境里正常显示。跟随媒体查询已经是上限。
- **不做深色下的阴影/玻璃**：报告是文档，不是浮层；层级继续靠台阶 + 发丝线。
- 已知残留风险（写进 PR 描述即可）：某些邮件客户端会剥掉 `<style>`，
  此时报告退化为无样式的语义 HTML——因为骨架是 `<h1>/<dl>/<table>/<footer>`
  而不是一堆 `<div>`，退化后依然可读。这就是 §5 坚持语义化标签的第二个理由。

### 3.9 隐私规则（判定用，可被测试）

导出物（HTML 与 CSV 共用同一套规则）**只允许**包含：

1. 该会话自身的记录数据（类型、工具名、模型名、时间、耗时、token 计数、摘要）；
2. 由 1 聚合出来的读数；
3. 应用字标、仓库链接、应用版本号；
4. 生成时间戳。

**禁止**包含：绝对路径（`/Users/<用户名>/...`、`C:\Users\...`）、用户名、hostname、
其它会话的内容、任何运行时/遥测信息、环境变量、`raw` 原文。

- 项目一律以**目录名**呈现（`parentDirectory(path)` 的最后一段），
  HTML 的 `.meta code` 与 CSV 里都不出现完整路径。
- 版本号是白名单里唯一「来自运行时」的字段，且它是公开信息。
- 这条规则的验证方式见 §6 的对 `parsed.path` 与 `homeDir` 做子串断言。

---

## 4. CSV 规格

### 4.1 列清单（13 列，顺序固定，脚本可依赖）

表头**英文、小写、snake_case**；值与表头一一对应，不多不少。

| # | 列名 | 类型 | 值 / 口径 |
| --- | --- | --- | --- |
| 1 | `record_id` | string | `record.fullId`（会话内唯一） |
| 2 | `timestamp` | string | ISO 8601 带时区偏移，如 `2026-01-02T11:04:08+08:00` |
| 3 | `timestamp_ms` | integer | 毫秒时间戳（给脚本用，避免时区解析歧义） |
| 4 | `kind` | string | 英文枚举：`user` / `llm` / `tool` / `agent` / `workflow` / `wait` |
| 5 | `tool` | string | 工具名；无则空 |
| 6 | `model` | string | 模型名；无则空 |
| 7 | `duration_ms` | integer | 毫秒整数，无千分位、无单位 |
| 8 | `is_error` | boolean | 字面量 `true` / `false`（不写 `1/0`、不写中文） |
| 9 | `input_tokens` | integer | 提示词 token；无则空 |
| 10 | `output_tokens` | integer | 输出 token；无则空 |
| 11 | `cache_read_tokens` | integer | 缓存读取 token；无则空 |
| 12 | `cache_write_tokens` | integer | 缓存写入 token；无则空 |
| 13 | `summary` | string | `recordSummary(record)`；最长的自由文本列，**必须放最后** |

完整表头（这一行是权威，实现与测试都以它为准）：

```csv
record_id,timestamp,timestamp_ms,kind,tool,model,duration_ms,is_error,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,summary
```

`summary` 放最后是有理由的：它是最可能被引号包裹的列，放最后让「按列号取数」的脚本
不会因为它的转义而整体错位。

不放的列与理由：

- **不放任何路径列**：隐私红线（§3.9）。需要项目维度时，脚本用 `record_id` 回查，
  或从文件名取会话标识。
- **不放 `raw` 原文与完整工具输出**：体量不可控（单条可达数 MB），且常含密钥/路径。
- 不放「占比」「累计」等派生列：它们能由别的列算出，重复一列就多一个会不一致的地方。

### 4.2 编码

- **UTF-8 with BOM**：文件前 3 字节必须是 `EF BB BF`。
  理由：Windows 版 Excel 打开无 BOM 的 UTF-8 CSV 时按系统 ANSI（简中为 GBK）解码，
  中文摘要直接变乱码——这是这个格式唯一真正致命的坑，而 BOM 是零成本的修复。
- BOM 只在文件最开头出现一次；**表头字符串本身不含 BOM**（解析时要先剥掉 3 字节
  再做列名断言）。
- 剪贴板路径**不带 BOM**（见 §1.6）。

### 4.3 换行与转义

按 RFC 4180 取最保守的一套：

| 规则 | 取值 |
| --- | --- |
| 行分隔符 | `\r\n`（CRLF） |
| 文件结尾 | 最后一行之后以一个 `\r\n` 结束，不再追加空行 |
| 字段分隔符 | `,` |
| 引号 | 字段含 `,`、`"`、`\r`、`\n`，或首尾有空白时，用 `"` 整体包裹 |
| 引号转义 | 字段内的 `"` 写成 `""` |
| 最小引号 | **只对需要的字段加引号**：给数值统一加引号会让 Excel 把它们当文本，脚本拿到的是字符串 |
| 空值 | 空字符串（两个分隔符之间什么都没有）。不写 `null`、不写 `N/A`、不写 `-` |
| 布尔 | `true` / `false` |
| 数值 | 纯数字，无千分位、无单位、无尾随空格 |
| 表头 | 第 1 行，13 列，与 §4.1 逐字一致 |

转义示例。摘要的原始值是：

```
Read · src/a.ts, 含 "引号" 的摘要
```

这一行的实际写入形态（`summary` 被整体包裹，内部引号翻倍）：

```csv
A1,2026-01-02T11:04:08+08:00,1767323048000,tool,Read,,1500,false,,,,,"Read · src/a.ts, 含 ""引号"" 的摘要"
```

往返规则（验收要断言的）：`parse(csvOf(records))` 的每个字段严格等于原值——
这是唯一能证明转义正确的办法，靠肉眼看引号数量不算。

### 4.4 记录的选取与顺序

- 行顺序 = 会话内记录的时间顺序（与页面表格一致），**导出时不二次排序**：
  报告是快照，用户看到的顺序就是他导出的顺序。
- 「当前筛选结果」导出的是 `recordsOfRows(filterLogRows(...))` 的结果——即**行级合并后**
  的视图（一条 user+LLM 合并行导出一行），与页面上那 128 行的口径一致。
  口径不一致会让「导出的条数」和「页面上看到的条数」对不上，这是最伤信任的一类 bug。
- 上限：与 HTML 一致，最多 2000 条。CSV 没有表尾说明行的位置（多写一行会破坏
  「每行一条记录」的约定），因此改为在浮层的计数条下方追加一行 `--fs-xs` 提示：
  `记录较多，本次仅导出前 2000 条（共 N 条）`。

---

## 5. 无障碍

### 5.1 浮层

| 项 | 规定 |
| --- | --- |
| 角色 | `<section role="dialog" aria-modal="true">`，与 `SearchPalette` 同一形态 |
| 命名 | `aria-labelledby` 指向标题 `<h2 id="export-dialog-title">导出会话报告</h2>`。**不用 `aria-label`**：标题已在视觉上存在，把它接进可访问名，屏幕阅读器读到的是同一句话 |
| 描述 | `aria-describedby` 指向计数条，打开时先读「将导出 N 条记录」 |
| 初始焦点 | 格式分段的当前选中项（`role="tab"` 且 `aria-selected="true"`）。要有实现侧的显式 `focus()`，因为 `autoFocus` 只会落到 DOM 首个可聚焦元素（即 `×`） |
| 焦点陷阱 | 容器 `onKeyDown` 处理 `Tab`/`Shift+Tab`，在首个/末个可聚焦元素处 `preventDefault()` 并环绕。选择器要排除 `[disabled]` 与 `[tabindex="-1"]`（`SegmentedControl` 的未选项正是 `-1`） |
| 关闭后归还焦点 | 打开时记下触发元素（`document.activeElement` 或 ref），关闭/保存成功后 `focus()` 回去。**这是最常被漏掉的一条**：不归还焦点，键盘用户会被丢回文档开头 |
| Esc | 关闭并 `stopPropagation()`（不要冒泡到 AppShell 的全局 keydown） |
| 背景 | 打开期间给 shell 挂 `inert`（WebKit 已支持），比 `aria-hidden` 更彻底：既挡住 AT，也挡住鼠标与 Tab。不支持时退化为 `aria-hidden="true"` |
| 遮罩点击 | 点击遮罩本身关闭（`event.target === event.currentTarget`），与 `SearchPalette` 一致 |
| 动效 | 进场走 `cca-enter`（`--dur-enter` + `--ease-out`）；项目全局已有 `prefers-reduced-motion: reduce` 归零，**不要**在浮层里重写媒体查询 |
| 对比度 | 全部沿用 tokens 既有值：`--text` on `--bg-elevated` ≈ 18:1；`--text-secondary` ≈ 7.8:1；`--text-tertiary` ≈ 4.8:1（合格，用于 11px 标签）；`--text-faint` ≈ 2.6:1 只用于纯装饰，**不得**用在浮层里任何需要读的文字上 |

焦点陷阱实现（可直接抄）：

```ts
function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key === "Escape") {
    event.stopPropagation();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables || focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
```

分段控件本身**不要**再手写键盘逻辑：`SegmentedControl` 已经实现了 roving tabindex
与方向键自动激活，浮层里直接用 `<SegmentedControl>`。

### 5.2 导出的 HTML 报告

| 项 | 规定 |
| --- | --- |
| 语言 | `<html lang="zh-CN">` |
| 语义化 | `<main>` / `<header>` / `<section>` / `<h1>` / `<h2>` / `<dl><dt><dd>` / `<table><thead><tbody><tfoot>`。**不允许**用 `div` 搭出视觉上的表格或标题层级——邮件客户端剥掉 `<style>` 后，语义就是唯一剩下的结构 |
| 标题层级 | 每份报告恰好 1 个 `<h1>`（会话标题），`<h2>` 只用于「会话概览」「记录」 |
| 表格 | `<thead>` 有 `<th>`（列头语义）；截断说明行用 `colspan="8"` |
| 颜色 | 类型色块旁永远有文字；失败状态除 `--danger` 外还有「失败」二字 |
| 对比度 | 正文 `--text` on `--surface` ≈ 18:1；`--text-tertiary` on `--surface` ≈ 4.8:1（用于 11px 表头/说明，达标）；类别色 on `#ffffff` 3.1–6.5:1，全部 ≥ 图形件 3:1 |
| 等宽数字 | 所有数值列 `font-variant-numeric: tabular-nums`（不只为好看：列对齐让「一眼看出哪个数大了」成立） |
| 缩放 | `viewport` 带 `initial-scale=1`；`max-width: 960px` + `overflow-x: auto` 包裹表格，窄屏不横向撑破 |
| 无 JS | 零 `<script>`；无动画（与 `prefers-reduced-motion` 无关）；主题只跟随系统 |
| 打印 | `thead { display: table-header-group }` 让长表跨页时重复表头 |

---

## 6. 验收清单（每条都可被测试断言）

### 6.1 入口与浮层生命周期

- [ ] `SessionHeader` 的 `.actions` 内出现文案为 `导出` 的 `button`，且它在 DOM 中位于 `打开位置` 之后
- [ ] `parsed === null` 时不渲染「导出」按钮（`queryByRole("button", { name: "导出" }) === null`）
- [ ] 点击「导出」后 `getByRole("dialog")` 存在，且 `aria-modal="true"`
- [ ] 该 dialog 的 `aria-labelledby` 指向的元素的 `textContent === "导出会话报告"`
- [ ] 浮层打开后 `document.activeElement` 是格式分段中 `aria-selected="true"` 的 `[role="tab"]`
- [ ] 按 `Esc` 后 dialog 从 DOM 移除，且 `document.activeElement` 是那个「导出」按钮
- [ ] 点击遮罩（`event.target === backdrop`）后 dialog 移除；点击面板内部不移除
- [ ] 浮层打开时 shell 上存在 `inert` 属性（或其退化形态 `aria-hidden="true"`）

### 6.2 浮层几何与令牌纪律

- [ ] dialog 根节点 computed `border-radius === "12px"`（`--r-lg`）
- [ ] dialog 根节点 computed `box-shadow !== "none"`（`--shadow-md`）
- [ ] dialog 根节点 computed `background-color` 等于 `--bg-elevated` 的解析值
- [ ] 浮层 CSS Module 中不出现颜色/圆角/时长字面量：对 `#`, `rgb(`, `hsl(`、`px` 形式的 `border-radius`、`ms`/`s` 形式的 `duration` 做正则断言为空（遮罩必须写 `var(--overlay)`）
- [ ] 浮层 CSS Module 中所有 `padding` / `gap` / `margin` 值都形如 `var(--sp-*)` 或 `0` / `auto`（正则断言）
- [ ] `window.innerWidth >= 480` 时 dialog 宽度 computed 值 `=== "480px"`

### 6.3 选项、计数与默认值

- [ ] 首次打开时格式默认选中「HTML 报告」（该 tab 的 `aria-selected === "true"`）
- [ ] 首次打开时范围默认选中「当前筛选结果」
- [ ] 即使无生效筛选，重新打开浮层范围仍默认「当前筛选结果」（默认值不随数据变化）
- [ ] 计数行文本匹配 `/将导出 \d[\d,]* 条记录/`
- [ ] 选「当前筛选结果」时计数数字 === `records.length`；选「全部记录」时 === `parsed.records.length`
- [ ] 计数条具有 `role="status"`
- [ ] 当 `records.length === parsed.records.length` 时，来源说明行文本 === `当前没有生效的筛选，两个范围内容相同`
- [ ] 当存在生效筛选时，来源说明行文本匹配 `/共 \d[\d,]* 条中的 \d[\d,]* 条/`
- [ ] 切换格式时，范围选择保持用户当前选择（不被重置）
- [ ] 说明文案随格式切换：HTML → `自包含单文件，可离线打开、可直接分享。`；CSV → `逐条记录，供 Excel 或脚本进一步分析。`

### 6.4 保存与复制

- [ ] 点击「保存…」会调用一次 dialog bridge 的保存方法，HTML 时 `defaultName` 匹配 `/^cc-analyzer-[0-9a-f]{8}-(filtered|all)\.html$/`
- [ ] CSV 时 `defaultName` 匹配 `/^[0-9a-f]{8}-(filtered|all)\.csv$/`
- [ ] 默认文件名只含 `[A-Za-z0-9._-]`（断言不含中文、空格与 `/`、`:`、`*`、`?`、`"`、`<`、`>`、`|`）
- [ ] 保存成功（mock 返回路径）后 dialog 从 DOM 移除，且存在 toast 文本匹配 `/已导出/`
- [ ] 保存取消（mock 返回 `null`）后 dialog 仍在 DOM 中，且不存在 `[role="alert"]`，且本次未新增 toast
- [ ] 保存抛错后 dialog 仍在 DOM 中，且存在 `[role="alert"]` 文本以 `导出失败` 开头
- [ ] 保存进行中时「保存…」与「复制到剪贴板」均 `disabled`，且保存按钮 `aria-busy="true"`、文案含 `正在保存`
- [ ] 点击「复制到剪贴板」（HTML）后 `clipboard.writeText` 收到的字符串以 `<!doctype html>` 开头
- [ ] 点击「复制到剪贴板」（CSV）后 `clipboard.writeText` 收到的字符串**不以** `\uFEFF` 开头，并以 `\r\n` 结尾
- [ ] 复制成功后 dialog 仍在 DOM 中，且 dialog 内存在 `[role="status"]` 文本匹配 `/已复制/`
- [ ] 复制成功 2 秒后按钮文案回到 `复制到剪贴板`
- [ ] 复制失败（mock 抛错）后 dialog 内存在 `[role="alert"]`
- [ ] 浮层打开期间未调用 `notify`（复制路径的反馈一律就地，避免被遮罩层压住）

### 6.5 键盘

- [ ] `Tab` 从最后一个可聚焦元素前进后，`document.activeElement` 回到 dialog 内第一个可聚焦元素
- [ ] `Shift+Tab` 从第一个可聚焦元素后退后，`document.activeElement` 是 dialog 内最后一个可聚焦元素
- [ ] 在格式分组内按 `ArrowRight` 后焦点与选中项移动到下一个 tab（组内自动激活）
- [ ] 两个 SegmentedControl 组各自只占一次 `Tab`（组内未选中项 `tabIndex === -1`）
- [ ] 在浮层内按 `Esc` 时事件未冒泡到 `window`（AppShell 的 ⌘K 监听未被触发）

### 6.6 HTML 报告产物

用固定 fixture 调纯函数 `htmlReportOf(...)`，对返回字符串断言：

- [ ] 以 `<!doctype html>` 开头（忽略前导空白）
- [ ] 含 `<meta charset="utf-8">` 与 `<meta name="color-scheme" content="light dark">`
- [ ] 含 `Content-Security-Policy`，其 `content` 同时含 `default-src 'none'` 与 `style-src 'unsafe-inline'`
- [ ] 不含 `<script`、不含 `<link`、不含任何 `src=` 属性
- [ ] 全部 `href=` 出现次数 === 1，且值为 `https://github.com/liang-zhenxiang/cc-analyzer`
- [ ] 含文本 `由 CC Analyzer 生成` 与 `数据未上传`
- [ ] `<h1>` 数量 === 1，其文本 === fixture 的会话标题
- [ ] `.readout` 数量 === 5，且标签序列严格等于 `["总耗时","输入","缓存读取","输出","记录数"]`
- [ ] 摘要区 `<dt>` 文本集合包含 `总耗时 / 输入 / 缓存读取 / 输出 / 记录数 / 成本估算` 六项
- [ ] 成本项在 fixture 模型未收录时渲染为 `未知`，且产物中**不含** `$0.0000`
- [ ] `<thead>` 的 `<th>` 数量 === 8，文本顺序 === `["时间","类型","操作 / 摘要","提示词","输出","耗时","占比","状态"]`
- [ ] `tbody tr` 数量 === `min(记录数, 2000)`
- [ ] 记录数 > 2000 时存在 `tfoot` 行，文本匹配 `/另有 [\d,]+ 条记录未列出/`
- [ ] 产物中不出现 fixture 的 `parsed.path` 全串，也不出现 `homeDir` 全串
- [ ] 产物中不出现 fixture 的 `raw` 原文（取一条记录原文的独有子串做断言）
- [ ] 注入用例：标题设为 `<img src=x onerror=alert(1)>` 时，产物中不含 `<img`，且含 `&lt;img`
- [ ] 含 `@media (prefers-color-scheme: dark)` 与 `@media print` 两个块
- [ ] 含 `font-family` 声明，其值含 `system-ui`、`"PingFang SC"`、`"Microsoft YaHei"` 三个键

### 6.7 CSV 产物

用 `csvOf(...)` 的返回值断言：

- [ ] 字节前 3 位 === `0xEF 0xBB 0xBF`
- [ ] 剥掉 BOM 后第一行 === §4.1 的固定 13 列表头，逐字相等且顺序一致
- [ ] 表头首字符的码位不等于 `0xFEFF`
- [ ] 文件中所有 `\n` 均属于 `\r\n`（不存在裸 `\n`）
- [ ] 文件以 `\r\n` 结尾，且结尾之后无空行
- [ ] 行数 === 1（表头）+ 记录数
- [ ] fixture 中含逗号/双引号/换行的 `summary` 往返解析后严格等于原值
- [ ] 数值列（`duration_ms`、`*_tokens`）每格可被 `Number()` 解析，且不含 `,` 与单位后缀
- [ ] 空值列输出为空字符串（不是 `null` / `N/A` / `-`）
- [ ] `is_error` 列取值只出现在 `{true, false}`
- [ ] 产物中不出现 fixture 的 `parsed.path` 全串与用户名子串
- [ ] 同一批 fixture 连续调用两次，产物完全相同（导出是纯函数，时间由调用方注入）

### 6.8 CSV 与页面口径一致

- [ ] 在页面筛选到 N 行后导出 CSV，`行数 - 1 === N`（与 `logRows`/`records` 的计数一致，不是 `parsed.records.length`）

---

## 7. 令牌变更申请（唯一一项）

**新增 `--overlay`。** 除它之外，本设计 0 个新令牌。

```css
:root {
  --overlay: rgb(0 0 0 / 0.32);
}

[data-theme="dark"] {
  --overlay: rgb(0 0 0 / 0.52);
}
```

| 主题 | 值 | 依据 |
| --- | --- | --- |
| 浅色 | `rgb(0 0 0 / 0.32)` | 与 `SearchPalette.module.css` 现有字面量**逐字相同**——`SearchPalette` 因此零视觉回归 |
| 深色 | `rgb(0 0 0 / 0.52)` | 深色页面本身已经很暗（`--bg: #0d0f12`），`0.32` 的黑罩几乎不产生分离；加深到 `0.52` 让「后面不可交互」这层遮罩在深色下也读得出来。真正的层级分离仍由面板自己的 `--border-strong` + `--shadow-md` 承担，遮罩只负责「压暗 + 挡住背后」 |

**为什么这是必要的，而不是「顺手多提一个 token」**：

1. `SearchPalette.module.css` 现在写死 `rgb(0 0 0 / 0.32)`——这是全仓组件 CSS 里
   **唯一一处颜色字面量**，它违反 tokens.css 自己立的规矩，只是因为「只有一个消费者」
   而没被抓到。
2. 导出浮层会成为第二个消费者。两个浮层必须共用同一个遮罩浓度，否则「浮层」的层级
   信号会分裂——这正是 tokens.css 开头那句「同一个概念不学两遍」要消灭的东西。
3. 落地时把 `SearchPalette.module.css` 的 `rgb(0 0 0 / 0.32)` 一并换成
   `var(--overlay)`，全仓组件 CSS 的颜色字面量归零。

> 若评审认为本轮不该动 `SearchPalette`：退而求其次的方案是导出浮层直接写
> `var(--overlay)` 并把 token 加进 tokens.css，`SearchPalette` 的替换单独开一个
> `chore` 小 PR。**但不建议**在新增浮层里再写一次字面量——那会让这个坑变成两个。

---

## 8. 工程依赖与「不做」清单

### 8.1 需要新增/泛化的接口

1. **保存桥要泛化**：`DialogBridge.saveMarkdown` 的 `filters` 写死了
   `[{ name: "Markdown", extensions: ["md"] }]` 与标题「导出会话分析报告」，
   不能复用。建议新增一个通用方法（最终命名以工程实现为准）：
   `saveText(defaultName: string, contents: string, options: { title: string; filterName: string; extensions: string[] }): Promise<string | null>`
   底层仍是 `plugin:dialog|save` + `write_text`；`saveMarkdown` 改为调用它，
   避免出现第三份复制。
2. **两个纯函数模块**（放 `web/src/features/sessions/`，便于单测，不依赖 React）：
   - `exportHtml.ts` → `htmlReportOf(input: ExportInput): string`
   - `exportCsv.ts` → `csvOf(input: ExportInput): string`
   `ExportInput` 应包含：标题、目录名、sessionId、起止时间、`TokenTotals`、
   过滤后的 `records`、全部记录数、生成时间、应用版本。
   **生成时间由调用方注入**（不要在函数内部调 `Date.now()`），CSV 的确定性验收才成立。
3. **组件**：`web/src/features/sessions/ExportDialog.tsx` + `.module.css`，
   在 `SessionAnalyzerPage` 的 JSX 末尾渲染（与 `RecordDetailPanel` 同级之后）。
   `position: fixed` 使其脱离文档流，**前提是 `.page → .body → .workspace` 链路上
   没有 `transform` / `filter` / `will-change`**（有的话 fixed 会相对该祖先定位，
   必须把浮层提到 AppShell 顶层）。当前三个类都没有。
4. **可选的配套小改**：`StatusToast` 的 `z-index: 30` 低于浮层遮罩的 `100`。
   本设计把浮层内反馈全部改为就地呈现，因此**不强制**改；但把 toast 的层级提到
   `100` 之上（如 `110`）是一个正确的独立小改动——toast 按定义就该在最上层。
   若做了，界面在其它浮层（设置面板）打开时的 toast 可见性也一并修好。

### 8.2 明确不做（写进 PR 描述，避免评审反复）

- 不做富文本剪贴板（`ClipboardItem` / `text/html`）。
- 不做导出格式的 PDF / Markdown / JSON。
- 不做浮层内的记录预览表格。
- 不做用户可配置的 HTML 主题 / 配色。
- 不做「按当前视图自定义 CSV 列」；列清单固定。
- 不在导出物里放记录原文、完整工具输出、任何路径。
- 不改 `ReportPanel` 现有的「导出 .md」（它导出的是 AI 分析报告，与本次不同）。
- 不给报告加任何 JS（排序、折叠、主题切换）。

---

## 9. 给实现者的一句话

这份设计的全部重量压在三个地方：**浮层要长得像已有的浮层**（`SearchPalette` 的骨架、
`SegmentedControl` 的键盘语义、15px/600 的读数），**HTML 报告要能脱离本应用独立成立**
（零外链、零 JS、语义化骨架、系统字体栈、转义到底），**CSV 要能被 Excel 和脚本同时信任**
（BOM + CRLF + 最小引号 + 固定 13 列）。其余细节都可以在实现里微调；
这三条让步一条，这份资产就不再是资产。
