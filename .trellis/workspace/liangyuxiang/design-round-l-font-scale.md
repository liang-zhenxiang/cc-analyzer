# 「界面字号缩放」设计规格（Round L）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 日期：2026-10-06 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（已锁定）：设置浮层新增「界面字号」一节，五档 90 / 100（默认）/ 110 / 120 / 130%，
> 持久化到 `cca-font-scale`，未知值回落 100%；实现走令牌层——`tokens.css` 的字号 / 行高
> 令牌变成 `calc(原值 * var(--font-scale))`，根元素设一个变量即全局缩放，**组件 CSS 不动**。
> v1 不做：高对比度档、跟随系统字号、按视图分别设置。**本文件只描述设计与断言，不改任何源码。**

## 0. 语境与现状（写前逐字读过）

tokens.css / global.css、ThresholdsPanel.tsx + .module.css、SegmentedControl.tsx + .module.css、
measuredRows.ts、virtualWindow.ts、LogView(.tsx/.module.css)、RecordTable(.tsx/.module.css)、
SessionList(.tsx/.module.css)、Gauge(.tsx/.module.css)、AppShell.module.css、ThemeProvider.tsx、
`web/index.html` 的预绘制主题脚本、tokens.test.ts、SessionList.test.tsx、updateChannel.ts（持久化范式）。
目验截图：`docs/screenshots/settings-light.png`、`docs/screenshots/analyzer-log-light.png`——
顶栏 48 / 侧栏 300 / 详情 360；日志表与记录表共用「凹槽表头 + 发丝行线」的仪表密度。

与本轮直接相关的两条**既有事实**（后文反复引用）：

- `--row-h`(30) = `--row-pad-y`(6)×2 + `--lh-sm`(18)，被 `LogView.module.css` 与
  `RecordTable.module.css` 的 `th { height: var(--row-h) }` 消费——表头与数据行**等高**是硬约束。
- `SessionList` 的行高是**字面量镜像对**：TS 常量 `GROUP_ROW_HEIGHT/SESSION_ROW_HEIGHT/…`
  与 CSS `.groupRow{height:32px}/.sessionRow{height:54px}/…` 逐字相等，由 `SessionList.test.tsx`
  的正则断言钉死；行容器 `overflow: hidden`。

## 1. 实现约束与风险

### 1.1 缩放载体：`--font-scale`（全项目唯一新增变量）

- 定义在 `:root`：`--font-scale: 1;`（无单位标量）。默认写在 `:root` 里，
  保证脚本未跑、单测环境、错误边界下 `calc()` 都能解析。
- 运行时由 JS 写在 `document.documentElement.style`（内联样式胜过 `:root{}`，无需 `!important`）。
- 它**不是**颜色 / 高度 / 圆角 / 时长，也不是间距档位，不触犯任何 tokens 纪律。
- `[data-theme="dark"]` 块不定义任何 `--fs-*` / `--lh-*`，所以设置点**只有一处**，深浅主题自动同源。

### 1.2 该缩放的令牌

| 令牌 | 改成 | 理由 |
| --- | --- | --- |
| `--fs-xs/sm/base/md/lg` | `calc(11px * var(--font-scale))` … | 字号是本轮唯一目的 |
| `--lh-xs/sm/base/md/lg` | `calc(16px * var(--font-scale))` … | 行高必须与字号**同比例**，见 §1.4 |
| `--row-h` | `calc(var(--row-pad-y) * 2 + var(--lh-sm))` | 它本来就是这条恒等式的静态结果（30 = 6×2 + 18）。改成派生式后表头随 `--lh-sm` 自动长高，**表头 = 数据行**这条硬约束不用再人肉维护。它不是「被缩放」，是「跟着行高走」 |

### 1.3 不该缩放的令牌（逐项判断 + 理由）

| 令牌 | 判断 | 理由 |
| --- | --- | --- |
| `--sp-05/1/15/2/3/4/5/6` | **不缩放** | 间距是「距」不是「字」。本轮目标是**可读性**，不是等比放大整屏；缩放间距会让面板在 130% 时无谓变高（设置浮层立刻要滚更多），也把「密」这个仪表语言抹平。代价是 130% 下「字 / 距」比变紧——这是刻意的：**字变大，帧不变** |
| `--row-pad-x/y/y-tight` | **不缩放** | 同上，行内边距是「距」。行高只随行高令牌长大（`--row-h` 已派生），padding 恒定 ⇒ 每一档增加的高度全部给文字，不浪费在留白上 |
| `--control-h / -sm / -lg`(24/28/32) | **不缩放** | 按钮 / 输入框是**最小值**（`min-height`），内容变大时自己会长。若也乘 1.3，小控件会从 24 涨到 31.2，顶栏分段控件不再与 48 的顶栏配平 |
| `--topbar-h`(48) | **不缩放** | 跨文件隐式契约（`ThresholdsPanel` 的 `top: calc(var(--topbar-h) + var(--sp-2))` 依赖它）。它由图标与分段控件撑起，不是由正文撑起；放大它会让设置浮层的贴顶距离每档变一次 |
| `--sidebar-w`(300) / `--detail-w`(360) | **不缩放** | 定宽是「一次看多少列」的密度决策，是布局属性。缩它等于同时改断流点与列宽，把「缩放字号」变成「缩放整页」，超出范围 |
| `--scrollbar-size`(10) | **不缩放** | 「还能滚」的静止信号，是控件件不是文字；且粗细由操作系统 / WKWebView 覆盖，乘系数的效果不可预测 |
| `--r-xs/sm/md/lg` | **不缩放** | 半径与控件高度绑定（「超过高度 1/6 就成胶囊」）。高度不放大而半径放大，会让小徽标从方形变成药丸 |
| `--shadow-*` / `--overlay` | **不缩放** | 层级语言与字号无因果 |
| `--dur-*` / `--ease-*` | **不缩放** | 时长按语义分档，与字号无关；放大只会让交互变钝 |
| `--gauge-size`(140) | **不缩放** | 它是正方形图表的**几何**，`Gauge.module.css` 用 `flex: 0 0 auto` 防拉伸。缩它会把环推离 `--detail-w` 一行的可用宽；环心读数靠 `--fs-md` 自己变大即可，见 §5.4 的溢出断言 |
| 全部颜色（含 `--cat-*` / `--chart-*` / `--ansi-*`） | **不缩放** | 与字号无因果，且 `tokens.test.ts` 对 ansi 对比度有硬断言 |
| `Icon` 的 `size={16}`（JS 属性，非 token） | **不缩放** | 图标按控件尺寸而定，不按文字尺寸；跟着正文放到 20.8 会与定高的图标按钮、`--control-h-sm` 的分段控件失去基线对齐，且要改 11 处 TSX。**已知偏差**：130% 下图标相对文字略小，接受；留档见 §6.2 |

### 1.4 字号与行高必须成对缩放（否则第一眼就崩）

tokens.css 的规矩是「任何 `font-size` 必须与同级 `line-height` 成对」。只乘字号：130% 下
`--lh-xs` 仍是 16 而 `--fs-base` 已是 16.9 ⇒ **行高小于字号**，密集行里的降部被裁、行与行粘连。
因此 `--fs-*` 与 `--lh-*` 必须写同一条 `calc(… * var(--font-scale))`，并断言 `lh ≥ fs`（§5.1）。

### 1.5 固定行高的两处「岛屿」——本轮真正的破绽

令牌只改字号 / 行高，凡是**内容驱动**的高度（`min-height` 的按钮、`padding + line-height`
的表格行、`padding + line-height` 的卡片）都会自己长高——**除了两处把行高写死的地方**：

1. `--row-h`：`LogView` / `RecordTable` 的 `th` 用 `height`（非 `min-height`）钉在 30。
   130% 下 th 内容是 6 + 6 + 20.8 = 32.8 > 30 ⇒ 表头裁字，且表头 30 与数据行 35.4 不再等高。
   **处置：按 §1.2 把 `--row-h` 改成派生式**（改的是 token 定义，不是组件 CSS）。
2. `SessionList` 的 32 / 54 / 72：TS 常量 + CSS 字面量 + `overflow: hidden`。
   逐档复算 `.sessionRow`（`padding 8×2 + gap --sp-05 + 标题 --lh-base + 元信息 --lh-xs`）：

   | 档位 | 内容高 | 行高 54 | 结果 |
   | --- | --- | --- | --- |
   | 100% | 8+20+2+16+8 = **54** | 54 | 精确相等 |
   | 110% | 8+22+2+17.6+8 = **57.6** | 54 | 裁掉 3.6px |
   | 130% | 8+26+2+20.8+8 = **64.8** | 54 | 元信息行被切掉约 11px |

   带状态行的 72 同理会更糟；只有 32 的分组行（8 + 20.8 = 28.8 < 32）侥幸不裁。
   而这条镜像对**被测试钉死**：`SessionList.test.tsx` 要求 CSS 里是字面量 `height: Npx`。

   **处置（本轮唯一被批准的「组件 CSS 例外」，约 6 行）**：把
   `.groupRow / .sessionRow / .sessionRowWithStatus` 的 `height` 改成
   `calc(32px * var(--font-scale))` 等三式，TS 三个常量同步改成 `Math.round(n * scale)`，
   并把那条镜像测试改成「断言 CSS `calc(Npx …)` 里的 N 与常量里的 N 相等」。
   **不这么做就必须把会话列表排除在缩放之外——那等于给最常用的列表留一个 110% 就裁字的洞。**
   这是范围里唯一「组件 CSS 不动」无法成立的地方，请主会话在开工前确认。

### 1.6 实测行高的重算坑（虚拟列表）

`useMeasuredRowHeights` 靠 **ref 回调**取 `getBoundingClientRect().height`，且只在
「高度变化 ≥ 2px」时 bump `version`。它**没有 ResizeObserver**，也没有对「只换 CSS 变量、
DOM 不动」的监听。因此切档时：

- 已在屏的行不会重测（ref 未重新触发）⇒ `heights` 里的旧值继续给 `buildRowOffsets`
  喂 `padTop / padBottom` ⇒ 垫片按旧行高算、滚到底出现空白或跳动，
  `computeSizedWindow` 的 scrollTop→index 映射偏移，`highlightId` 的
  `offsets[index] - 160` 会落到错误位置。
- `Math.abs(previous - height) < 2` 这道防抖会**吞掉小增量**：30 → 30.9 四舍五入 31，
  差 1 < 2，永远不记；两档之间恰好落在 1px 增量的行会永久停在旧高度。
- `ROW_HEIGHT = 30`（LogView）、`ESTIMATED_ROW_HEIGHT = 38`（RecordTable）是**未缩放**的
  回退估计；130% 下真实行约 35，估计 30，首屏垫片偏小。

**处置（强制，不是可选）**：给 `useMeasuredRowHeights` 增加一个 `resetKey`（传当前档位），
`resetKey` 变化时清空 `heights` / `extras` 两个 Map 并 bump `version`；回退估计改成
`Math.round(基准 * scale)`。不修则「切档后必须滚动一下才对」——那是把 bug 当交互。

### 1.7 独立文档不跟随缩放（写进 PR 的已知边界）

- 实时监控是 `MonitorPage` 的 **iframe**（独立文档，主题靠 `postMessage`）：`--font-scale`
  不跨文档，监控页停在 100%。本轮不转发（要转发就得再扩一条 postMessage 协议）。
- 导出 HTML（`exportHtml.ts`）是自带 CSS 的独立文档，同样不缩放。
- 展开面板 `EXPANDED_PANEL_HEIGHT = 320`、`RecordTable` 的 `max-height: 360px`、
  `.expanded pre { max-height: 220px }` 是固定钳制：130% 下不裁字，只是滚动更多。接受。

## 2. 控件与交互

### 2.1 位置：设置浮层的**第一节**

放在 `.note` 之后、「Prompt 上限」之前。理由：需要 130% 的人**必须先能读到这一节**——
把它排在「软件更新」「本地归档」之后，低视力用户要先滚过一段读不清的文字才能找到救自己的开关，
这是自相矛盾的。代价：面板 `h2` 仍是「阈值设置」，第一节叫「界面字号」略有出入；
本轮**不改 h2**（改它会牵动 `aria-label="阈值设置"` 与既有 e2e 断言，属范围外）。
若日后把面板重命名为「设置」，这个位置就自然了——把这条写进 PR 备注。

### 2.2 控件：复用 `SegmentedControl`（`variant="equal"`）

五档是「一条轴上的五个点」，是可比较的相邻值——正是分段控件的语义；`<select>` 会把选项藏起来、
多一次点击，且看不见「现在是第几档 / 还有没有更大的」。档位文字短，面板宽 `min(420px, …)`
下五个等分项各约 78px、高 `--control-h-sm`(24)，放得下。

**语义留痕**：`SegmentedControl` 硬编码 `role="tablist"` / `role="tab"` / `aria-selected`——
对视窗（tabs）正确，对「选一个值」是**近似**（APG 的 radiogroup 才是本义，但键盘模型
——roving tabindex + 方向键 + 自动激活——两者一致）。两种处置，**二选一必须落到 PR**：

- A（零改动）：直接用，接受 `tab` 语义。
- B（推荐，约 3 行、向后兼容）：给 `SegmentedControl` 加可选 `role?: "tablist" | "radiogroup"`
  （默认 `"tablist"`，六处旧调用点零影响），本处传 `"radiogroup"`，项 `role="radio"` +
  `aria-checked`。这是正确的 ARIA，且不改任何 CSS。

### 2.3 即时生效，不要确认

可逆、非破坏、单点；确认框对「已经看不清屏幕才来放大字号」的人是又一次阅读成本。
与「本地归档」一节同一条立场：**可逆偏好不做二次确认**。「恢复默认」只管阈值，不重置字号
（字号自带 `100%` 档，等于自带复位）。

### 2.4 不做「部分视图需重绘」提示

正确的做法是 §1.6 的强制重算，而不是在界面上留一句「若表格错位请滚动一下」——
提示一旦存在，就等于承认默认状态下是错的。**验收要求切档后零用户动作即正确**（§5.5）。
同理，切档时**不移动焦点**、不关闭面板、不重置滚动位置。

### 2.5 存储契约

- 键 `cca-font-scale`，值 = **百分位整数字符串**：`"90" | "100" | "110" | "120" | "130"`。
  与可见文案同形（用户看到 `120%`，存 `"120"`），不引入浮点字符串化的歧义。
- 读取：白名单 `Set(["90","100","110","120","130"])`，未命中 / 非字符串 / 抛异常 ⇒ `100`
  （照抄 `updateChannel.parseChannel` 的「不可信值回落到安全默认」写法：`parseFontScale(raw)`）。
- 应用：`document.documentElement.style.setProperty("--font-scale", String(pct / 100))`。
- **预绘制**：`web/index.html` 里照抄现有主题脚本，追加同款 try/catch 内联脚本，
  在模块脚本之前把 `--font-scale` 写好，避免「先按 100% 画一帧再跳」的闪动
  （`ThemeProvider.test.tsx` 已确立这条范式）。

## 3. 视觉与文案

### 3.1 布局简图

```
设置浮层（既有骨架：--bg-elevated / --r-md / --shadow-md）
┌──────────────────────────────────────────────────────┐
│ 阈值设置                                          [×] │ .header h2  --fs-base/600
│ 控制报告与日志表的规模，改动立即生效并保存在本机。    │ .note      --fs-xs/tertiary
│ 界面字号                                ← .sectionTitle │ --fs-base/600，margin-top --sp-3
│ [ 90% ][ 100% ][ 110% ][ 120% ][ 130% ] ← SegmentedControl equal │
│ 12:04:08 · LLM · claude-sonnet-4 · 3.00s             │ .preview    --fs-sm/--lh-sm/--text
│ 提示词 17 / 输出 34 · 2.7% · 正常                     │ .previewSub --fs-xs/--lh-xs/--text-tertiary
└──────────────────────────────────────────────────────┘
```

### 3.2 用到的 token（逐项，除 `--font-scale` 外全部已存在）

| 用途 | 变量 |
| --- | --- |
| 分区标题 / 说明 | `.sectionTitle`（`--fs-base` + `--lh-base` + `--text`，`margin-top: var(--sp-3)`）；`.note`（`--fs-xs` + `--text-tertiary`） |
| 档位控件 | 复用 `SegmentedControl` 自身样式（`--bg-inset` 槽、`--bg-subtle` 滑块、`--r-sm`/`--r-xs`、`--control-h-sm`、`--fs-sm`/`--lh-sm`、`--shadow-sm`）——**本节不得覆写控件内部样式** |
| 预览行 / 预览副行 | `--fs-sm` + `--lh-sm` + `--text`；`--fs-xs` + `--lh-xs` + `--text-tertiary`；数字加 `font-variant-numeric: tabular-nums` |
| 预览行上边线 | `1px var(--border)`（沿用 `.archiveRow` 的画法） |
| 间距 | 仅 `--sp-05 / --sp-1 / --sp-15 / --sp-2 / --sp-3`（本节不需要 `--sp-4/5/6`） |
| 时长 | 不新增；控件自己的 `--dur-hover` + `--ease-in-out` 已在组件里 |

**新增令牌 / 变量：1 个（`--font-scale`）。** 新 CSS 规则全部落在
`web/src/features/settings/ThresholdsPanel.module.css`（CSS Modules）；不新建组件、
不新造颜色 / 高度 / 圆角 / 时长字面量、不新造间距数值。

### 3.3 档位文案：用百分比，不用「标准 / 大 / 特大」

`90% / 100% / 110% / 120% / 130%`。理由：① 百分比是**可验证的事实**，用户报 bug 时能逐字复述，
「大」不能；② 与全局数字读数语言一致（`tabular-nums`、`2.7%`、`3.00s`），不必新学一套形容词；
③ 「标准 / 大 / 特大」隐含「100% 才正常」，对低视力用户是贬义暗示，且五档用形容词会造出
「较小 / 标准 / 较大 / 大 / 特大」这种没人记得住的序；④ 这是缩放系数，本来就有客观刻度。
唯一需要的补充信息是**默认档**，写进 `.note`：`默认 100%，随时可改回。`

### 3.4 预览：**要一行示例**（一行，不是第二份界面）

面板自身会随档位变大，但那是「界面外壳」，用户真正关心的是**数据行的密度**。
给一行固定的示例读数（上图 `.preview`）让五档之间有稳定的可比参照，也证明「仪表密度」没被破坏。
内容用真实字段形状（时间 · 类型 · 模型 · 耗时 / 提示词 · 占比 · 状态），**不含真实用户数据**；
它用同一批 token，自动跟随缩放，无需第二套样式。不外加按钮、不加滑杆（五档不需要连续调节）。

### 3.5 状态（全部交给组件，本节零覆写）

| 状态 | 视觉 / 断言 |
| --- | --- |
| 默认 | `100%` 项 `aria-selected="true"`（或 `aria-checked`），槽底 `--bg-inset` |
| 悬停 | 交给 `.item:hover`（`--text-tertiary` → `--text`）——本节的 CSS 里**不出现 `:hover`** |
| 选中 | 抬起滑块 `--bg-subtle` + `--shadow-sm` + `font-weight: 600`（灰度截图下仍可辨） |
| 键盘焦点 | 全局 `:focus-visible`（`--ring` 2px 环），本节不重写 |

## 4. 无障碍

### 4.1 可访问名与状态

| 项 | 规定 |
| --- | --- |
| 分组名 | `aria-label="界面字号"`（传给 `SegmentedControl` 的 `ariaLabel`）——与可见分区标题逐字相同 |
| 项状态 | A 方案走 `aria-selected`；B 方案（推荐）走 `role="radio"` + `aria-checked`。**只用一套**，不得两者并存 |
| 默认档标注 | `100%` 项的 label 里附一个视觉隐藏的 `（默认）`（照 `SessionList.module.css` 的 `.srOnly` 写法），让屏幕阅读器也听见默认位；可见文字仍是 `100%` |
| 单位 | 可见文字自带 `%`，不再写 `aria-label` 覆盖（避免视觉名与朗读名分叉，同「本地归档」开关的约定） |

### 4.2 是否需要 `aria-live`：**不需要独立播报**

切档是**用户直接操作 + 立即在屏幕上生效**：焦点仍在被选项上，AT 会随
`aria-selected` / `aria-checked` 的变化朗读新档位，再加一个 live region 就是**重复播报**。
若将来改成异步 / 延迟生效，或加「跟随系统字号」这种非本机动作，才需要 `role="status"`——
届时照抄归档读数行的写法。分区 `.note` 静态给出默认值，不依赖播报。

### 4.3 焦点保持

切档走 `SegmentedControl` 的方向键自动激活（`focusAt`），焦点应停在**新档位的按钮**上。
前提是缩放状态的变化**不得重挂载控件**：`AppShell` 里是 `settingsOpen ? <ThresholdsPanel/> : null`，
若字号 store 的更新导致面板重建（换 `key`、条件渲染分支切换）焦点会掉到 `<body>`。
硬要求：控件在整轮交互中保持同一 DOM 节点（断言见 §5.3）。

### 4.4 键盘

沿用组件契约：Tab 一次进、一次出整组；`←/→/↑/↓` 环绕移动并即时生效；`Home/End` 到首 / 末档；命中方向键一律 `preventDefault` 阻止页面滚动。五档全部可选，无 `disabled`（因此不需要 `title`）。

## 5. 验收清单（每条都能被断言）

### 5.1 令牌层

- [ ] `:root` 定义 `--font-scale: 1`；未设样式时 `getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim() === "1"`
- [ ] 选 130% 后同一读取 === `"1.3"`
- [ ] `--fs-xs/sm/base/md/lg` 与 `--lh-xs/sm/base/md/lg` 共 10 条，声明文本匹配 `calc(<原值>px * var(--font-scale))`（用 tokens.test.ts 同款「读文件 + 正则」单测钉住，漏一条就失败）
- [ ] `getComputedStyle(document.body).fontSize` 在 100% 为 `"13px"`、130% 为 `"16.9px"`；`lineHeight` 对应 `"20px"` / `"26px"`
- [ ] 每一对 `--fs-*` / `--lh-*` 在五个档位下都满足 `parseFloat(lh) >= parseFloat(fs)`
- [ ] 不缩放的令牌在 130% 下仍等于原值：`--sp-2` = `8px`、`--control-h` = `28px`、`--topbar-h` = `48px`、`--gauge-size` = `140px`、`--scrollbar-size` = `10px`
- [ ] `--row-h` 解析值：100% 为 `30px`，130% 满足 `Math.abs(parseFloat(v) - (2*6 + 18*1.3)) < 0.5`

### 5.2 持久化与回落

- [ ] 点 `120%` 后 `localStorage.getItem("cca-font-scale") === "120"`
- [ ] 预置 `"115"`（未知值）后加载：可访问名 `界面字号` 的组里被选中项是 `100%`，且计算 `--font-scale === "1"`
- [ ] 预置 `"abc"` / `""` / `localStorage` getter 抛异常 三种情况同上，且不抛错
- [ ] 预置 `"130"` 后渲染：被选中项是 `130%`，`body` 计算字号 `16.9px`
- [ ] `index.html` 的内联脚本（jsdom 中执行）在模块脚本前写入 `--font-scale`，值来自 `cca-font-scale`（照 `ThemeProvider.test.tsx` 的既有断言形状）

### 5.3 控件结构 / 交互

- [ ] `getByRole("tablist"|"radiogroup", { name: "界面字号" })` 存在，恰有 5 项，`textContent` 依序为 `90%/100%/110%/120%/130%`
- [ ] 默认恰有 1 项选中，且是 `100%`；点击 `130%` 后它选中、`100%` 取消
- [ ] `100%` 项的可访问名含 `（默认）`（视觉隐藏文本），可见文本仍为 `100%`
- [ ] 焦点在 `100%` 上按 `ArrowRight`：被选项变 `110%`，且 `document.activeElement.textContent === "110%"`
- [ ] 点 `130%` 前后 `getByRole(…, {name:"界面字号"})` 是**同一个 DOM 节点**（`node.isSameNode(prev)`），焦点未被丢弃
- [ ] 存在标题 `界面字号` 的 `.sectionTitle`，且它是面板（`aria-label="阈值设置"`）内的**第一个**分区标题、位于「Prompt 上限」之前
- [ ] 全节 `[role="status"]` / `[role="alert"]` 计数为 0（本控件不新增 live region）
- [ ] 交互后不出现新的 `role="dialog"`（无确认框）

### 5.4 几何（切到 130% 后测量）

- [ ] 会话行不裁字：无状态行 `row.scrollHeight <= row.clientHeight + 1`，带状态行同
- [ ] 会话行高 = `Math.round(54 * 1.3)` = `70`（带状态行 `94`、分组行 `42`），与 TS 常量相等
- [ ] 表头与数据行等高：`LogView`（与 `RecordTable`）的 `th` 高度与同表首个数据行实测高度之差 ≤ 1px
- [ ] 表头不裁字：`th.scrollHeight <= th.clientHeight + 1`
- [ ] `Gauge` 渲染盒仍是 `140×140`；`centerValue` 文本不溢出环内：文本 `getBBox().width < 2 * (120/2 - 10)`（SVG 用户单位）
- [ ] 图标仍为 16px：任一 `Icon` 的 `svg.getBoundingClientRect().width === 16`（记录「图标不缩放」是刻意）
- [ ] 间距未被缩放：设置浮层的 `padding` 计算值在 100% 与 130% 下逐字相等

### 5.5 虚拟列表重算（`useMeasuredRowHeights` 单测 + 组件测试）

- [ ] 单测：`record("a", 30px 元素)` 后 `heights.size === 1`；改变 `resetKey` 后 `heights.size === 0` 且 `version` 递增
- [ ] 组件测试：挂载 `LogView`（行数 > 窗口、已渲染一屏）→ 切到 130% → 首屏可见行**无需滚动**即重新测量（首行 `padTop === 0`，且 `container.scrollHeight` 与「渲染行几何之和」一致，误差 ≤ 2px）
- [ ] 切档后 `padTop` 使用新行高：`Math.abs(after.padTop - before.padTop * 1.3) / (before.padTop || 1) < 0.05`
- [ ] `highlightId` 定位在切档后仍落回同一行（定位用的是新 offsets）
- [ ] 回退估计随档位走：未测过任何行时 `estimate === Math.round(30 * scale)`（LogView）/ `Math.round(38 * scale)`（RecordTable）

### 5.6 纪律与边界

- [ ] 新增 / 修改的 `.module.css` 里不出现颜色字面量（`#`、`rgb(`、`hsl(`）、`border-radius` 的 `px` 字面量、`transition-duration` 的 `ms` 字面量
- [ ] 新增规则的 `padding/gap/margin` 全部形如 `var(--sp-*)`、`0` 或 `auto`
- [ ] 内联写入的是 `String(pct/100)`，不是带 `%` 的字符串（否则 `calc` 无效）
- [ ] 切档**不**改变 `MonitorPage` iframe 的 `src`；iframe 内文档的 `--font-scale` 保持未定义（独立文档不缩放是已知边界）
- [ ] 切换主题（light↔dark）不改变计算出的字号（`--fs-*` 只在一处定义）

## 6. 工程依赖与「不做」清单

### 6.1 需要新增 / 改动

1. `web/src/features/settings/fontScale.ts`（新）：`FontScale` 类型、`FONT_SCALE_OPTIONS`
   （五档 + 文案）、`parseFontScale / loadFontScale / storeFontScale / applyFontScale`、
   `useFontScale`（`useSyncExternalStore`，形如 `thresholds.ts`）。
2. `tokens.css`：`:root` 加 `--font-scale: 1`；10 条 `--fs-*` / `--lh-*` 改 `calc`；
   `--row-h` 改派生式；并在该处补注释写清「哪些缩放、哪些不缩放、为什么」。
3. `web/index.html`：追加预绘制脚本（同主题脚本形状）。
4. `ThresholdsPanel.tsx` + `.module.css`：新增「界面字号」一节（第一节）+ 预览行。
5. `measuredRows.ts`：`resetKey` + 清缓存；`LogView.tsx` / `RecordTable.tsx` 传当前档位、
   回退估计乘系数。
6. `SessionList.module.css` + `SessionList.tsx` + `SessionList.test.tsx`：§1.5 的三行缩放
   （本轮唯一组件 CSS 例外）。
7. `SegmentedControl.tsx`：可选 `role` 属性（方案 B；不改 CSS，六处旧调用点零影响）。

### 6.2 明确不做（写进 PR 描述）

- 不做高对比度 / 色觉档、不跟随系统字号（`prefers-*`）、不按视图分别设置（范围锁定）。
- 不缩放间距 / 控件高 / 顶栏 / 侧栏 / 详情宽 / 圆角 / 时长 / 阴影 / `--gauge-size` / 图标（§1.3）。
- 不改设置浮层的 `h2`「阈值设置」与 `aria-label`；不动「恢复默认」按钮的语义边界。
- 不把 `--font-scale` 转发给监控 iframe 与导出 HTML。
- 不给控件加 live region、不加确认框、不加滑杆 / 自由输入（五档固定）。

### 6.3 给实现者的一句话

这一轮的全部重量压在三个地方：**字号与行高成对缩放**（漏一个，密集行立刻粘连）、
**两处被写死的行高必须跟上**（`--row-h` 靠派生式；`SessionList` 的 32/54/72 靠那三行
`calc`，否则 110% 就开始裁字）、**切档后实测行高必须重算**（否则表面看对了，滚一下才露馅）。
三件事做完，「放大字号」才是一个真能用的功能，而不是一张只在 100% 下正确的截图。
