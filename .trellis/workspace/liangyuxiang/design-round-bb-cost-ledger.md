# 会话账单（Round BB）设计规格

> **角色**：UI/UX 设计（design-bb）　**日期**：2026-10-23　**状态**：待实现
> **面向读者**：实现 `CostLedgerView` 的工程师、写 e2e/gui-test 门禁的人、验收的主会话。
> **范围**：只写视觉与交互规格，**不写实现代码**。本文里的 tsx / CSS 是**规格片段**（结构、类名、令牌取值），
> 实现可以改名，但几何、令牌、逐字文案、判据不得偏离。
> **体例出处**：`.trellis/workspace/liangyuxiang/design-round-aa-replay.md`（Round AA「会话重放」）。
> 沿用它的章节骨架、对比度记账法与「事实在应用、断言在脚本」的门禁范式。**结论一句不照抄**——
> 本轮的形状是收据，不是影片。

---

## §0 语境与现状

### 0.1 写之前逐字读过的文件

| 文件 | 行数 | 从它拿到的、本文会引用的事实 |
| --- | --- | --- |
| `.trellis/tasks/10-23-session-cost-ledger/prd.md` | 206 | R1–R9、`CostLedger` 类型、口径 10 条、四块内容、诚实性红线 |
| `.trellis/workspace/liangyuxiang/design-round-aa-replay.md` | 1336 | 体例、pane 526 的高度账、对比度记账法、门禁范式 |
| `web/src/styles/tokens.css` | 483 | 全部颜色/间距/字号/焦点环；`--font-scale` 是唯一缩放旋钮 |
| `web/src/features/sessions/SessionAnalyzerPage.module.css` | 106 | `.pane{flex:1 1 0;min-height:180px}`、`.viewBar{flex-wrap:wrap;justify-content:space-between}`、`@media(max-width:1100px)` 侧栏 260 |
| `web/src/components/Panel.module.css` | 47 | 卡头 40、`.body{padding:12;min-height:0}`（**没有 flex-grow**） |
| `web/src/components/SegmentedControl.module.css` | — | item `min-height:24 / padding:0 12 / 12px`，root 高 28 |
| `web/src/features/sessions/ChangedFilesView.{tsx,module.css}` | 470 / 410 | **Panel 体内滚动的三段链**与滚动条策略、脚注几何、`tabIndex=0` 的滚动容器 |
| `web/src/features/sessions/BleedView.{tsx,module.css}` | 190 / 139 | 邻居的语言（清单 + 右端一枚金额）、`usd === null` 的诚实分支 |
| `web/src/features/sessions/logRows.ts`、`RecordTable.tsx` | 190 / — | `ROW_KIND_LABELS`、`RecordKind` → 中文（assistant = 模型） |
| `web/src/features/sessions/LogView.tsx` | 1305+ | 跳转落点：`highlightId` → 行加 `.highlight` 并滚到可视区 |
| `web/src/features/usage/BillingWindowCard.{tsx,module.css}` | 399 / 376 | 占比条的既有几何（56×6 轨道、`--chart-1` 填充、HC 覆写）、`formatShareText` 的 `<0.1%` 规则 |
| `web/src/features/usage/pricingSnapshot.ts` | — | `PRICING_AS_OF = "2026-10-01"`、三档 family 单价、`pricingFamilyFor` |
| `web/src/lib/format.ts` | — | `formatUsd` 的 `value <= 0 → "$0.00"`（**假零的源头**）、`formatTokenCount` 的紧凑形 |
| `scripts/gui-test.sh` | 3046 | `CAPTURE_TARGETS` 的动作语汇、`CCA_GUI_PROBE` 的事实清单、阈值住脚本 |
| `src-tauri/src/lib.rs` | — | `PROBE_JS` 是几何事实的唯一采集处（iOS/WKWebView 求值） |

### 0.2 逐条核对过的既有事实（本文的地基，改这些之前先回来改本文）

1. **pane 高度 526**（1440×900 / 100%）：`900 − 48 topbar − 24 padding − 78 SessionHeader − 12 page gap = 738`（body），
   workspace 列 `viewBar 28 + 12 + pane + 12 + reportPane 160 = 738`。130% 字号下 SessionHeader 78→85，pane = **519**。
2. **pane 宽度与卡内宽**：1440 无详情 workspace = `1440 − 24 − 300 − 16 = 1100`，卡内 **1074**（−2 边框 −24 内边距）；
   详情面板打开 724 → 698；960 窄窗（侧栏降 260）`960 − 24 − 260 − 16 = 660` → **634**；1100px 断点处 800 → 774。
3. **Panel 的 `.body` 没有 `flex-grow`**。`ChangedFilesView` 用三段链接管：
   `.root{display:flex;flex:1 1 auto;min-height:0;flex-direction:column}` →
   `.root > section{flex:1 1 auto;min-height:0}` → `.root > section > div{display:flex;flex:1 1 auto;min-height:0;flex-direction:column}`。
   **不接这条链，长内容会被 `.panel{overflow:hidden}` 直接裁掉，且不出现滚动条**（这是本轮最容易踩的坑，见 §15）。
4. **滚动条**：全仓没有全局 `::-webkit-scrollbar` 规则（只有 `--scrollbar-size: 10px` 令牌）。
   `ChangedFilesView.scroller` 是唯一的纵向滚动先例：`scrollbar-width: thin; scrollbar-color: var(--text-faint) transparent`，
   再补 `::-webkit-scrollbar{width:var(--scrollbar-size)}` / `-thumb{background:var(--text-faint);border-radius:var(--r-xs)}` / `-track{background:transparent}`。
5. **占比条的既有画法**：轨道 56×6、`background:var(--border-strong)`、填充 `--chart-1`、`--r-xs`；
   高对比度下轨道改 `--bg-inset` 并加 `box-shadow:0 0 0 1px var(--border-strong)`。
6. **`formatUsd` 会把 `0 < x < 0.01` 印成 `$0.00`**（`value <= 0` 分支 + `toFixed(2)`）。BleedView 的注释把「null 也要分出去」写成红线的先例。
7. **`RecordKind` 中文**：`user 用户 / assistant 模型 / tool 工具 / wait 等待 / system 系统`（`RecordTable.tsx:18`）。
   而 R2 ② 规定**只有带 `usage` 的 assistant 记录**进账——所以「最贵五次」的类型恒为「模型」（见 §2.6）。
8. **跳转机制现成**：`SessionAnalyzerPage.locateInLog(recordId)` = `setView("log"); setHighlightId(recordId)`，
   `LogView` 按 `highlightId` 给行加 `.highlight` 并 `scrollTop = offset − 160`。账单只需一个 `onLocateInLog` 回调。
9. **7 个标签的实测宽度**（Playwright + 真实 CSS，Chromium 1.64 / WebKit 1.64，macOS）：
   100% 时 6 项 root **362 / 360.67**，7 项 **412 / 410.52**（「账单」一项 48 / 47.84）；
   130% 时 7 项 **480.45 / 478.14**。viewBar 右侧 `graphStatus` 171.3 / 220.1，`ParseCoverageChip` 65.9 / 81.5。
10. **三主题四档**：`tokens.css` 有 `:root` / `[data-theme="dark"]` / `[data-contrast="high"]` /
    `[data-theme="dark"][data-contrast="high"]` 四套。本文的对比度表逐列给出这四个值。

---

## §1 概念与一句话定位

**账单回答「钱花在哪四类 token 上」；出血点回答「上下文被谁吃掉」。**

收据（receipt）这个隐喻之所以成立：一次会话的模型用量本来就是**四行科目 × 单价 × 用量 = 小计**，
再加一行合计与一句「估算，不是账单」。收据天然是**右对齐金额 + 点线引导 + 等宽数字**，
这套语言在应用里没有第二页在用——`BillingWindowCard` 是卡片式归因、`BleedView` 是清单，
两者都不是「一张竖着读的凭证」。

### 1.1 与邻居的分工（写进代码注释，免得下一个人再想一遍）

| 页 | 问句 | 语言 |
| --- | --- | --- |
| 日志视图 | 发生了什么？ | 时间序列的行 |
| 树视图 / 上下文 | 谁调了谁 / 上下文怎么涨的 | 树 / 曲线 |
| 改动 | 动了哪些文件 | 文件清单 |
| 出血点 | 上下文被谁吃掉 | **条目 + 右端一枚金额**的清单，四类 token 作并列读数 |
| 重放 | 这一次会话有多长、停在哪 | 影片（舞台 + 胶片带 + 走带） |
| **账单（本轮）** | **钱花在哪四类 token 上** | **收据：科目行 + 点线 + 右对齐金额 + 占比条 + 合计行** |

**四条边界**（越界即视为实现错误）：

1. 账单里**不出现图表**（没有柱状图、没有饼图、没有面积图）。从哪来的钱由「占比条」一行一条说清。
2. 账单里**四类 token 永远分开成行**，不合并成一个「总 token」再乘均价（PRD R4）。
3. 账单**不比较**其他会话、不给建议、不预测（§14）。
4. 账单的金额**永远带「估算」**，且 `PRICING_AS_OF` 必须在屏幕上（脚注）。

### 1.2 术语表（本文件与实现里只用这六个词）

| 词 | 含义 | 代码 |
| --- | --- | --- |
| 科目 | 四类 token 之一，固定四行 | `LedgerClassKey` |
| 单价 | 每百万 token 的价格 | `classRate(family, key)` |
| 小计 | 科目金额 | `LedgerClassLine.usd` |
| 合计 | 四行小计之和 | `CostLedger.totalUsd` |
| 未计入 | 有调用但没法定价，不进合计 | `unpricedCalls` / `unpricedTokens` |
| 加权均价 | 跨档汇总行的 `usd / tokens`，**不是价目** | §2.4 的 `weighted` |

---

## §2 六条必须先落的裁决

### 2.1 一张卡、四个区、**一个**纵向滚动、常驻脚注

**裁决**：整个标签页只有 **一张卡**（`Panel`，标题「会话账单」）；卡体内**四个区**（收据 / 按模型 / 缓存经济学 / 最贵五次）
用 1px 发丝线 + 16px 外边距分段，**不再套第二层卡**（「卡套卡」在 tokens.css 与 AA §4 都被否过）。

**高度账（1440×900，100%）**——数字全部来自真实 CSS 的原型实测（Chromium 与 WebKit 逐项一致）：

```
pane 526 = 2 边框 + 40 卡头 + 12 上内边距 + [滚动视口 436] + 8 脚注外边距 + 16 脚注 + 12 下内边距
内容高 695（四项：收据 168 + 未计入提示 22 + 按模型 162 + 缓存 103 + 最贵五次 192 + 两处 16px 分区外边距）
→ 滚动量 259，约为一个视口的 0.6 屏
```

静止时可见：**收据全量（168+22）+ 按模型全量（162）**，再露出缓存经济学的标题。这是正确的一屏——
先看「四行怎么算出来的」，再看「哪个模型花的」，后两块是解释性内容，允许滚。

**为什么不是分栏**：卡内宽 1074 时分两栏（收据 620 + 右栏 430）会让收据的点线引导缩短到 200px 以下、
金额列挤成两段，收据立刻不像收据；而 960 窄窗（卡内 634）根本分不了栏。
「单列 + 卡内滚动」在两种宽度下是同一套语言，只差滚动量。

**滚动容器（逐字，实现照抄）**：

- 容器：`.scroll`，卡体里唯一可滚动元素。`flex: 1 1 auto; min-height: 120px; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;`
- `tabIndex={0}` + `aria-label="账单内容"`（键盘用户要能用方向键/PageDown 滚，Chrome 与 WKWebView 都只在可聚焦容器上给这个能力）。
- 滚动条：**沿用 `ChangedFilesView.scroller` 的策略**（`scrollbar-width: thin` + 三条 `::-webkit-scrollbar`），
  不自造第二条滚动条语言，也不新增全局规则。
- `overscroll-behavior: contain` 是硬要求：滚到底不得把滚动链传给页面（否则在 960×640 触发整页滚动，出现第二条竖轴）。
- **禁止**：`.scroll` 内再出现任何 `overflow: auto/scroll` 的纵向容器（最贵五次表不设 max-height）。

**常驻脚注（不在滚动区内）**：`估算，不是账单 · 定价快照 2026-10-01`。
放在卡体最后一行、`--fs-xs` / `--text-tertiary`、`margin-top: var(--sp-2)`。
理由：PRD R3① 要求脚注含快照日期与「估算，不是账单」；而这两句**必须在滚到最贵五次时仍然可见**，
否则一屏金额就失去了限定语。它同时是 `data-probe="cost-footnote"` 的锚点。

> 与 PRD 的一处措辞偏离：R3① 写的标题行「会话账单 · 估算」，本文拆成 **卡头「会话账单」+ 常驻脚注**。
> 卡头是导航级标题（与会话页其他卡一致，13px/600），脚注是可滚动的金额的限定语。两句话都在屏幕上，一行没少。

### 2.2 收据的视觉语言：点线引导 + 右对齐等宽金额 + 「数字 + 细条」

逐项定死，不留「稍大一点」：

| 元素 | 规格 |
| --- | --- |
| 表 | **真 `<table>`**，`border-collapse: separate; border-spacing: 0`（**不用 collapse**，见 §15 坑 2） |
| 列 | `科目 ｜ Token ｜ 单价 / 百万 ｜ 占比 ｜ 小计`（金额在最右，读据的结尾是钱） |
| 列头 | `--fs-xs`/`--lh-xs`、400、`--text-tertiary`、`white-space: nowrap`、`padding-bottom: var(--sp-1)`、`border-bottom: 1px solid var(--border)` |
| 科目格 | `<th scope="row">`，`width: 100%`（吸收余量，**这是点线能填满的唯一办法**）、`--fs-base`/`--lh-base`、400、`--text` |
| 点线引导 | 科目格里一个 `<span aria-hidden="true">`：`display:flex; align-items:baseline; gap:var(--sp-1); width:100%`，点线本体 `flex:1 1 auto; height:0; border-bottom:1px dotted var(--text-faint); transform:translateY(-.28em)` |
| 数字 | `--font-mono` + `font-variant-numeric: tabular-nums` + `white-space: nowrap` + `text-align: right` + `--text-secondary`；小计列 `--text` |
| 行距 | 每行 `padding: var(--sp-1) 0 var(--sp-1) var(--sp-3)`（数字列左侧 12px，防止两列最大宽度时贴死） |
| 行高 | **28**（= 4 + 4 + 20）；130% 时 **34**（= 4 + 4 + 26） |
| 占比 | **数字 + 细条**（两者都要）。细条 56×6（既有几何，不随字号缩放），数字 `<0.1%` / `53.3%` 作 `--fs-sm` 右对齐 |
| 占比单元 | `<span class="shareFlex">`：`display:flex; align-items:center; justify-content:flex-end; gap:var(--sp-2); height:var(--lh-base)`（**必须有这层 span**，见 §15 坑 2） |
| 合计行 | `<tfoot>`；`th` 文字「合计」600；上方 `border-top: 1px solid var(--border-strong)` + `padding-top: var(--sp-2)`；金额 `--fs-md`/`--lh-md` + 600 + `--text`；**合计行的 Token 与 单价两格写 `—`** |
| 未计入提示 | 合计行下方 `margin-top: var(--sp-15)`、`--fs-xs`、`--warning`：`另有 2 次调用未计入（定价未知）` |

**为什么合计行的 Token 写 `—` 而不是四类之和**：四类 token 相加没有单价含义，写上一个总数会诱导读者拿它乘某个价——
那正是 R4 红线禁止的「混成总 token 再乘均价」。合计行只对**金额**求和。

**为什么金额在最右而不是占比在最右**：收据的阅读终点是钱；并且金额列右沿 = 卡内容右沿，
让「金额列右沿对齐误差 ≤ 1px」这条门禁有一个唯一的、与行无关的参照物。

**点线的实测宽度**（Chromium / WebKit）：

| 卡内宽 | 100% | 130% |
| --- | --- | --- |
| 1074（1440 无详情） | 705.6 / 701.2 | 643.7 / 636.8 |
| 698（1440 详情开） | 329.6 / 325.2 | 267.7 / 260.8 |
| 634（960 窄窗） | 265.6 / 261.2 | 203.7 / 196.8 |

最窄工况仍有 ~197px 的点线——足够读出「标签 ↔ 数字」的绑定，不会退化成两条并排的字。

### 2.3 账单专用金额格式（**假零**必须在这里断掉）

`formatUsd` 不能用于账单：它把 `0 < x < 0.01` 印成 `$0.00`。而缓存读取单价是 $0.3/百万，
一次读 5,000 token 的调用只花 $0.0015——在账单上会被印成「免费」。在 `costLedger.ts` 里**另立一个**：

```ts
/** 账单专用金额。null 是「不知道」，0 是「真零」，两者绝不共用一种写法。 */
export function formatLedgerUsd(usd: number | null): string;
/** 单价格：单档 = 价目，多档 = 加权均价（带 ≈ 前缀），无量 = —。 */
export function formatLedgerRate(rate: number | null, weighted: boolean): string;
/** 占比格：把「很小」与「没有」分开。 */
export function formatSharePercent(share: number, tokens: number): string;
```

`formatLedgerUsd` 的分支**按顺序**判（顺序本身就是规格）：

| # | 条件 | 输出 | 例子 | 理由 |
| --- | --- | --- | --- | --- |
| 1 | `usd === null` 或非有限数 | `—`（U+2014） | — | 未知 ≠ 免费 |
| 2 | `usd === 0` | `$0.00` | 0 token 的科目 | 真零，允许出现 |
| 3 | `Number(x.toFixed(3)) === 0`（且 x > 0） | `<$0.001` | $0.00009 | 三位小数会印成 `$0.000`，**又是一次假零** |
| 4 | `rounded3 = Number(x.toFixed(3))` 且 `0 < rounded3 < 0.01` | `$` + `x.toFixed(3)` | `$0.004`、`$0.002` | 收据的小计要能被手算相加；`<$0.01` 相加对不上账 |
| 5 | `x < 1000` | `$` + `toFixed(2)` | `$1.08` | 与全站金额同形 |
| 6 | `x >= 1000` | `$` + `Math.round(x).toLocaleString("en-US")` | `$1,234` | 与 `formatUsd` 的千分位一致 |

> 关于第 3/4 条的顺序：`x = 0.00999` 先算 `toFixed(3) = 0.010`，不落第 4 条，落第 5 条印 `$0.01`——
> 单调、不出现 `$0.010`，也不出现 `$0.000`。这个顺序有单测（`costLedger.test.ts` 的格式表）。
>
> 判据因此是**四舍五入之后的三位小数**（`rounded3`），不是 `x` 本身；按字面写 `x < 0.01` 会让
> `0.00999` 落进第 4 条印出 `$0.010`。同一原则贯穿到千分位：`999.995 → $1,000`（两位小数是 `1000.00`），
> `999.994 → $999.99`。

`formatLedgerRate`：

| 情况 | 输出 |
| --- | --- |
| `rate === null`（该科目 0 token，或一件可定价调用都没有） | `—` |
| `weighted === false` | `$` + `rate.toFixed(2)`（如 `$3.00`、`$0.30`） |
| `weighted === true` | `≈$` + `rate.toFixed(2)`（如 `≈$3.79`） |

价目表里最低单价是 $0.10/百万，任何加权均价都落在 [0.10, 75]，两位小数**永远不可能**得到 `$0.00`。

`formatSharePercent`：`tokens > 0 && share * 100 < 0.05 → "<0.1%"`，否则 `` `${(share * 100).toFixed(1)}%` ``。
`tokens > 0` 这个守卫必须有：没有它，`0 token / share 0` 会被印成 `<0.1%`，把「没有」说成「很小」。

**e2e 判据**：夹具里必须有一行科目的小计落在 `(0, 0.01)`，断言它的文本既不是 `$0.00` 也不是 `—`
（例如 `$0.002`），并且整个视图里**不存在**「token > 0 且金额为 0」的行（见 §13 G4）。

### 2.4 单价列的跨档消歧：单档给价目，多档给 `≈` 加权均价

**先回答 lead 的问题**：会。读者看到一个干净的 `$15.00 / 百万` 时，没有任何线索告诉他是
「Opus 的价目」还是「一堆模型混出来的平均数」，而这两个意思完全不同。

**裁决（采用 lead 的方案 (a)，并补一条「单档才敢给符号」的硬规则）**：

设某科目 `key` 的可定价模型里 `tokens[key] > 0` 的 family 集合为 `F`（由 `ledger.models` 算得，纯逻辑）：

| 数据形态 | `单价` 格 | 视觉 | 读屏 |
| --- | --- | --- | --- |
| `tokens === 0` | `—` | `--text-tertiary` | `单价 无用量` |
| `\|F\| = 1`（单档，含「只有一个模型」） | `$3.00` | 无 `≈`，`--text-secondary` | `输入单价 3.00 美元每百万 token（Sonnet 档）` |
| `\|F\| ≥ 2`（跨档） | `≈$3.79`（= 该行 `usd / tokens`） | `≈` 是**唯一**的视觉区分，不换颜色、不换字重 | `输入加权均价 3.79 美元每百万 token，按各模型实际用量加权` |
| `pricedCalls === 0` | 收据整块不渲染（§9 状态 2） | — | — |

**为什么 `≈` 而不是「加权」两个字**：列宽只有 ~64px（130% 下 `≈$8.42` 实测 62.7px），
前缀两个字会把单价列推到 ~110px，而 `≈` 是数学符号、跨语言可读、且在等宽数字列里只占一格。
「按各模型实际用量加权」这句话由**按模型区的一行脚注**承担：

> `分项为紧凑读数；逐位合计见上方收据。≈ 为按各模型实际用量加权的均价，各模型自己的确定单价见本表。`

**为什么 `|F| = 1` 时敢给不带 `≈` 的价目**：那时 `usd / tokens` **精确等于**价目表里那一档的单价
（`usd = Σ tokens_i × rate / 1e6` 且所有 `rate` 相同），所以它不是近似值，而是价目本身。

**把两种数据形态各画一遍**（逐字，实现可以直接对着写）：

```
跨档（本会话 = Sonnet 4.5 + Opus 4.1，单价列全部带 ≈）
  科目        Token      单价 / 百万    占比              小计
  输入 ......  1,284,930    ≈$3.79    ████████ 53.3% ....  $4.87
  输出 ......     62,418   ≈$17.33    ██ 11.8% .........  $1.08
  缓存写入 ...    89,000    ≈$5.27    █ 5.1% ...........  $0.47
  缓存读取 ... 8,214,770    ≈$0.33    ████▌ 29.8% ......  $2.72
  ─────────────────────────────────────────────────────────────
  合计 ......       —           —          100.0%          $9.15
  另有 2 次调用未计入（定价未知）

单档（本会话只有 Haiku 4.5）
  科目        Token      单价 / 百万    占比              小计
  输入 ......     42,100     $1.00    █████████ 71.2% ...  $0.04
  输出 ......      3,200     $5.00    █ 5.4% ...........  $0.02
  缓存写入 ...          0        —     0.0% .............  $0.00
  缓存读取 ...    108,000     $0.10    ███ 23.4% ........  $0.01
```

**130% 字号下这一列怎么排**：单价列是 `auto` 轨（内容定宽），`≈$8.42` 实测 62.7px（WebKit 1.3），
加左侧 `var(--sp-3)` 的 12px 内边距 = 74.7px；634 宽工况下由科目列吸收（科目列还有 ~190px 余量），
**不换行、不缩写、不降字号**（`white-space: nowrap` 是这一列的硬规则）。

### 2.5 七个标签：不压缩、允许既有折行，并在门禁里把它记成一条

| 工况 | 7 标签 root | 右侧两件 | 合计 | viewBar 高 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1440 无详情（1100）100% | 412 | 171.3 + 12 + 65.9 + 12 | 673 | **28** | 一行 |
| 1440 无详情 130% | 480.45 | 220.1 + 12 + 81.5 + 12 | 806 | **28** | 一行 |
| 1440 详情开（724）100% | 412 | 同上 | 673 < 724 | **28** | 一行 |
| 1440 详情开 130% | 480.45 | 同上 | 806 > 724 | **60.8** | 折行（**既有行为**） |
| 960×640（660）100% | 412 | 171.3 + 12 + 65.9 + 12 | 673 > 660 | **56** | 第 7 标签**首次**让 chip 下沉一行 |
| 960×640 130% | 480.45 | 220.1 + 81.5 | > 660 | **60.8** | 与 6 标签同高（root 本来独占一行） |

**裁决**：

1. **不缩 gap、不缩 padding、不加横向滚动**。`.viewBar` 本来就是 `flex-wrap: wrap`，整个
   `SegmentedControl` 是一个 flex item，放不下时**整块**掉到下一行——这是 6 标签时代就存在的行为
   （960/130% 已经折过一次）。加横向滚动会与「960 无横向溢出」门禁直接冲突，且 7 个中文标签被裁掉一半
   比折行糟得多。
2. 960×640 / 100% 下第 7 标签**真的花掉 28px**：`pane 266 → 238`。这条要写进 §11 的高度账、写进 CHANGELOG 的
   「界面布局」之外，还要写进门禁（G1）——否则下一个人会以为「只是多了一颗标签」。
3. 130% 下 7 个标签仍全在屏内（`root 480.45 < 660`），不裁、不缩、不换图标。

### 2.6 「最贵五次」不放独立的「类型」列（与 PRD R3④ 的唯一偏离）

R2 ② 规定只有带 `usage` 的 assistant 记录进账，类型因此**恒为「模型」**——一列五行同一个词是装饰，不是数据。
它的位置被两件事替代：

- 表的下方不写类型，**写在 caption 里**：`最贵的五次调用（均为模型调用，按小计降序）`；
- 跳转按钮的可访问名里写全：`跳到日志：03:12:45 的模型调用（Sonnet 4.5，小计 0.42 美元）`。

省下的一列在 960/130% 下正好给「时刻」与「模型」留出呼吸（见 §7）。若验收方坚持保留该列，
只在 ≥1101px 宽档渲染（`@media (min-width: 1101px)`），960 档隐藏——但那就变成 **两套列**，
两套列就有两套对齐门禁，我不推荐。

---

## §3 层级、DOM 骨架与间距

### 3.1 DOM 骨架（规格片段，类名可换）

```tsx
<div className={styles.root} data-probe="cost-root">
  <Panel title="会话账单" ariaLabel="会话账单"
         actions={<ProvenanceBadge provenance="estimated"
                                   detail={`快照日期 ${ledger.pricingAsOf}`} />}>
    <div className={styles.bodyWrap}>            {/* 接管 Panel .body 的 flex 链 */}
      <div className={styles.scroll} tabIndex={0} aria-label="账单内容"
           data-probe="cost-scroll">

        {/* ① 收据：没有自己的标题——它就是这一页 */}
        <section className={styles.receipt} aria-label="费用收据">
          <table className={styles.receiptTable} data-probe="cost-receipt">
            <caption className={styles.srOnly}>会话账单：四类 token 的用量、单价、占比与小计，最后一行是合计</caption>
            <thead>
              <tr>
                <th scope="col">科目</th><th scope="col">Token</th><th scope="col">单价 / 百万</th>
                <th scope="col">占比</th><th scope="col">小计</th>
              </tr>
            </thead>
            <tbody>
              {ledger.classes.map((line) => (
                <tr key={line.key} data-probe="cost-receipt-row" data-class={line.key}>
                  <th scope="row">
                    <span className={styles.subjectFlex}>
                      <span>{CLASS_LABELS[line.key]}</span>
                      <span className={styles.leader} aria-hidden="true" />
                    </span>
                  </th>
                  <td aria-label={`${CLASS_LABELS[line.key]} ${line.tokens.toLocaleString("en-US")} token`}>
                    {line.tokens.toLocaleString("en-US")}
                  </td>
                  <td aria-label={rateAria(line)}>{formatLedgerRate(unitPrice(line), weighted(line))}</td>
                  <td>
                    <span className={styles.shareFlex}>
                      <span className={styles.bar} aria-hidden="true" data-probe="cost-bar">
                        <span className={styles.fill} style={{ width: `${line.share * 100}%` }} />
                      </span>
                      <span className={styles.shareText}>{formatSharePercent(line.share, line.tokens)}</span>
                    </span>
                  </td>
                  <td className={styles.sum} data-col="sum" aria-label={`小计 ${moneyAria(line.usd)}`}>
                    {formatLedgerUsd(line.usd)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-probe="cost-receipt-total">
                <th scope="row">合计</th><td aria-label="合计 无用量">—</td><td aria-label="合计 无单价">—</td>
                <td><span className={styles.shareFlex}><span className={styles.shareText}>100.0%</span></span></td>
                <td className={styles.totalAmount} data-col="sum" aria-label={`合计 ${moneyAria(ledger.totalUsd)}`}>
                  {formatLedgerUsd(ledger.totalUsd)}
                </td>
              </tr>
            </tfoot>
          </table>
          {ledger.unpricedCalls > 0 ? (
            <p className={styles.unpriced} data-probe="cost-unpriced">
              {`另有 ${ledger.unpricedCalls} 次调用未计入（定价未知）`}
            </p>
          ) : null}
        </section>

        {/* ②③④ 三个区共用 .section：发丝线 + 16 外边距 + 12 上内边距 */}
        <section className={styles.section} aria-labelledby="cost-models">
          <div className={styles.sectionHead}>
            <h3 id="cost-models">按模型</h3>
            <span className={styles.sectionMeta}>{`${ledger.models.length} 个模型 · ${unpricedModelCount} 个定价未知`}</span>
          </div>
          <table className={styles.grid} data-probe="cost-models">…（§5）</table>
          <p className={styles.note}>{MODEL_FOOTNOTE}</p>
        </section>

        <section className={styles.section} aria-labelledby="cost-cache">
          <div className={styles.sectionHead}>
            <h3 id="cost-cache">缓存经济学</h3>
            <span className={styles.sectionMeta}>按 token 计，与定价无关</span>
          </div>
          <dl className={styles.stats} data-probe="cost-cache">…（§6）</dl>
          <p className={styles.note}>{CACHE_FOOTNOTE}</p>
        </section>

        <section className={styles.section} aria-labelledby="cost-top">
          <div className={styles.sectionHead}>
            <h3 id="cost-top">最贵的五次调用</h3>
            <span className={styles.sectionMeta}>{`${topCalls.length} 笔 · 按小计降序`}</span>
          </div>
          <table className={styles.grid} data-probe="cost-top">…（§7）</table>
        </section>
      </div>

      <p className={styles.footnote} data-probe="cost-footnote">
        {`估算，不是账单 · 定价快照 ${ledger.pricingAsOf}`}
      </p>
    </div>
  </Panel>
</div>
```

### 3.2 接管 Panel 的三段链（照 `ChangedFilesView` 抄，别自创）

```css
.root { display: flex; min-height: 0; flex: 1 1 auto; flex-direction: column; }
.root > section { flex: 1 1 auto; min-height: 0; }              /* Panel 的 <section> */
.root > section > div { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; } /* Panel 的 .body */
.bodyWrap { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; }
```

### 3.3 纵向权重表（实测，可逐项相加）

| 块 | 100% | 130% | 组成 |
| --- | --- | --- | --- |
| 卡头 | 40 | 40 | Panel 既有（`min-height:40`） |
| 滚动视口 | **436** | **424.2** | pane − 2 边框 − 40 − 12 − 12 − 8（脚注外边距） − 16/20.8（脚注）；130% 的 pane 是 519 不是 526 |
| 收据 | **168** | **203.39** | 21 列头 + 4×28 + 35 合计（130%：25.8 + 4×34 + 41.59） |
| 未计入提示 | 22 | 26.8 | 6 外边距 + 16/20.8 |
| 按模型 | **162** | **193.81** | 1 边框 + 12 上内边距 + 20 标题 + 8 + 21 列头 + 3×26 + 22 脚注 |
| 缓存经济学 | **103** | **125.19** | 1 + 12 + 20 + 8 + 40（三格读数）+ 6 + 16 说明 |
| 最贵五次 | **192** | **229.83** | 1 + 12 + 20 + 8 + 21 + 5×26 |
| 内容合计 | **695** | **827** | 上表相加，另加两处分区 `margin-top: 16` |
| 常驻脚注 | 16 | 20.8 | 不在滚动区内 |

### 3.4 间距表（只有这些档位，不许插值）

| 位置 | 值 |
| --- | --- |
| 收据列头下内边距 | `var(--sp-1)` = 4 |
| 收据行上下内边距 | `var(--sp-1)` = 4 |
| 数字列左内边距 | `var(--sp-3)` = 12（收据）、`var(--sp-2)` = 8（两张紧凑表） |
| 合计行上内边距 | `var(--sp-2)` = 8 |
| 未计入提示上外边距 | `var(--sp-15)` = 6 |
| 分区上外边距 / 上内边距 | `var(--sp-4)` 16 / `var(--sp-3)` 12 |
| 分区标题下外边距 | `var(--sp-2)` = 8 |
| 说明行上外边距 | `var(--sp-15)` = 6 |
| 三格读数之间 | `var(--sp-5)` = 24（列向 gap） |
| 占比条与百分比 | `var(--sp-2)` = 8 |
| 点线两端 | `var(--sp-1)` = 4 |
| 脚注上外边距 | `var(--sp-2)` = 8 |

### 3.5 禁止项

- 禁止在 `.scroll` 里再放卡（`.panel` / `.card` 类）。
- 禁止给收据任何**背景**：科目区、按模型区、合计行都只有发丝线，没有底纹条。
- 禁止给合计行加 `--accent` 或 `--warning` 的底色（合计是事实，不是告警）。
- 禁止引入第二套金额字号（除 `--fs-md` 合计与 `--fs-base` 科目，没有 `--fs-lg`）。
- 禁止 `letter-spacing`、禁止 `text-transform`、禁止给数字加粗到 700。

---

## §4 收据区（逐区几何）

结构见 §3.1，CSS 逐字：

```css
.receipt { margin: 0; }

.receiptTable {
  width: 100%;
  border-collapse: separate;   /* 不是 collapse：collapsed 边界吃 0.5px，行高会一排 28.5 一排 28 */
  border-spacing: 0;
  font-size: var(--fs-base);
  line-height: var(--lh-base);
}
.receiptTable thead th {
  padding: 0 0 var(--sp-1);
  border-bottom: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 400;
  text-align: right;
  white-space: nowrap;
}
.receiptTable thead th:first-child { text-align: left; }

.receiptTable th[scope="row"] {
  width: 100%;                 /* 吸收余量 → 点线才有东西可填 */
  padding: var(--sp-1) var(--sp-3) var(--sp-1) 0;
  color: var(--text);
  font-weight: 400;
  text-align: left;
  white-space: nowrap;
}
.receiptTable td {
  padding: var(--sp-1) 0 var(--sp-1) var(--sp-3);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.receiptTable td.sum { color: var(--text); }

.receiptTable tfoot th,
.receiptTable tfoot td {
  padding-top: var(--sp-2);
  border-top: 1px solid var(--border-strong);
}
.receiptTable tfoot th { font-weight: 600; }
.totalAmount {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--text);
}

.subjectFlex { display: flex; align-items: baseline; gap: var(--sp-1); width: 100%; }
.leader {
  flex: 1 1 auto;
  height: 0;
  border-bottom: 1px dotted var(--text-faint);
  transform: translateY(-.28em);   /* 把点线压到基线略下，与中文下沿齐平 */
}

.shareFlex {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-2);
  height: var(--lh-base);   /* 行高由这层定死，6px 条的 inline 行盒不再撑高行 */
}
.bar {
  flex: 0 0 auto;
  width: 56px;
  height: 6px;
  overflow: hidden;
  border-radius: var(--r-xs);
  background: var(--border-strong);
}
.fill { display: block; height: 100%; border-radius: var(--r-xs); background: var(--chart-1); }
.shareText {
  flex: 0 0 auto;
  min-width: 44px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-sm);
  text-align: right;
}

/* 高对比度：与 BillingWindowCard 的 HC 覆写同款——轨道退到卡面、边界交给 1px 环 */
:global([data-contrast="high"]) .bar {
  background: var(--bg-inset);
  box-shadow: 0 0 0 1px var(--border-strong);
}

.unpriced {
  margin: var(--sp-15) 0 0;
  color: var(--warning);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
```

**逐字内容表**

| 位置 | 文案 | 备注 |
| --- | --- | --- |
| 列头 1 | `科目` | 左对齐 |
| 列头 2 | `Token` | 右对齐 |
| 列头 3 | `单价 / 百万` | 单位只写一次，格子里只放数字 |
| 列头 4 | `占比` | |
| 列头 5 | `小计` | |
| 科目名 | `输入` / `输出` / `缓存写入` / `缓存读取` | 顺序固定（`LedgerClassKey` 的声明序），**永远四行，含 0 行** |
| 合计 | `合计` | 600 |
| 未计入 | `另有 {N} 次调用未计入（定价未知）` | 仅 `N > 0` 时渲染 |

**字号 / 字重 / 颜色表**

| 元素 | 字号 | 字重 | 颜色 | 族 |
| --- | --- | --- | --- | --- |
| 列头 | `--fs-xs`/`--lh-xs` | 400 | `--text-tertiary` | sans |
| 科目名 | `--fs-base`/`--lh-base` | 400 | `--text` | sans |
| Token / 单价 / 占比数字 | `--fs-base`/`--lh-base` | 400 | `--text-secondary` | mono + tabular |
| 占比百分比 | `--fs-sm`/`--lh-sm` | 400 | `--text-tertiary` | mono + tabular |
| 小计 | `--fs-base`/`--lh-base` | 400 | `--text` | mono + tabular |
| 合计金额 | `--fs-md`/`--lh-md` | 600 | `--text` | mono + tabular |
| 未计入 | `--fs-xs`/`--lh-xs` | 400 | `--warning` | sans |

**为什么合计金额只敢到 `--fs-md`**：会话标题（SessionHeader）是 20px，卡头 13px。
合计是这一页最重的数字，但它是**读数**不是 KPI，落在 15px/600 正好比会话标题低一级——
与 AA §5.2「读数不是 KPI 大数字」的裁决同源。

---

## §5 按模型（小票）

```css
.section { margin-top: var(--sp-4); padding-top: var(--sp-3); border-top: 1px solid var(--border); }
.sectionHead {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: var(--sp-3); margin-bottom: var(--sp-2);
}
.sectionHead h3 { margin: 0; font-size: var(--fs-base); font-weight: 600; line-height: var(--lh-base); }
.sectionMeta {
  color: var(--text-tertiary); font-size: var(--fs-xs); line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

.grid { width: 100%; border-collapse: separate; border-spacing: 0;
        font-size: var(--fs-sm); line-height: var(--lh-sm); }
.grid thead th {
  padding: 0 0 var(--sp-1); border-bottom: 1px solid var(--border);
  color: var(--text-tertiary); font-size: var(--fs-xs); line-height: var(--lh-xs);
  font-weight: 400; text-align: right; white-space: nowrap;
}
.grid thead th:first-child { text-align: left; }
.grid tbody th {
  width: 100%;
  padding: var(--sp-1) var(--sp-2) var(--sp-1) 0;
  color: var(--text); font-weight: 400; text-align: left; white-space: nowrap;
}
.grid td {
  padding: var(--sp-1) 0 var(--sp-1) var(--sp-2);
  color: var(--text-secondary);
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  text-align: right; white-space: nowrap;
}
.grid td.sum { color: var(--text); }

.modelName {
  display: inline-block;                 /* 省略号只对块级盒生效；inline 的 span 设了 max-width 也不会裁 */
  max-width: 10em;                       /* 130 档 = 169px：模型名再长，这张表的 max-content 也有上界 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;                /* 与空格行对齐，不吃掉基线下沿 */
  color: var(--text); font-weight: 600; margin-right: var(--sp-2);
}
.modelMeta {
  color: var(--text-tertiary); font-size: var(--fs-xs); line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
.note { margin: var(--sp-15) 0 0; color: var(--text-tertiary); font-size: var(--fs-xs); line-height: var(--lh-xs); }
```

**列**：`模型 ｜ 输入 ｜ 输出 ｜ 缓存写入 ｜ 缓存读取 ｜ 小计`（6 列）。调用数与「定价所在档」折进模型格里的一行小字，
不再单独占两列——这就是「小票」：一行一个模型，右边一串数字，最后是它的钱。

**模型格逐字**：

| 状态 | 内容 | 例 |
| --- | --- | --- |
| 可定价 | `<strong>{formatModelId(model)}</strong><span>· {档} 档 · {calls} 次调用</span>` | `Sonnet 4.5 · Sonnet 档 · 39 次调用` |
| 定价未知 | `<strong>{formatModelId(model) 或 截断后的原 id}</strong><span>· 定价未知 · {calls} 次调用</span>` | `GPT-5 · 定价未知 · 2 次调用` |
| 缺 model | `（未记录模型）` | `（未记录模型） · 定价未知 · 1 次调用` |

档名：`Opus 档` / `Sonnet 档` / `Haiku 档`（`ModelFamily` → 中文，取自 `MODEL_PRICING` 的键）。
**未知模型的「定价未知」用 `--text-tertiary`，不用 `--warning`**（见 §9.2 的琥珀配给）。

**数字形态**：四个 token 格与最贵五次的 token 格用 `formatTokenCount` 的紧凑形（`1.2M` / `60.0K` / `9,900`），
`title` 与 `aria-label` 带完整千分位数。**逐位数字只在收据**——收据是唯一需要对账的地方，
紧凑形是为了在 634 宽里放下六列：实测 130% 下四列紧凑读数共 ~188px（每列 ~47px），
换成逐位千分位（10 位、mono 12px/130% 每位 9.39px）则要 ~375px，整表 `scrollWidth` 超过 634，
在卡内就是被裁（见 §15 坑 4）。所以「逐位」是收据的特权，紧凑表一律 `formatTokenCount`。

**报告用的脚注（逐字）**：

> `分项为紧凑读数；逐位合计见上方收据。≈ 为按各模型实际用量加权的均价，各模型自己的确定单价见本表。`

**排序**：可定价模型按 `usd` 降序，未知模型排最后（R2 已定，UI 不再重排）。

**行高**：26（100%）/ 31.41（130%）——与「最贵五次」同高，两表密度一致。
**「定价未知」的金额格**：`—`，`--text-tertiary`，`data-col="sum"`，`aria-label="小计 定价未知"`。

**空/部分数据**：
- 单个模型 → 表只一行；单价列回到「单档」形态（§2.4）。
- 全部未知 → 本表仍渲染（token 量是真实存在的），金额列全 `—`；见 §9 状态 2。
- 模型数 > 5 → 不折叠、不滚动，放任区块长高（它在滚动区里）。

---

## §6 缓存经济学

**不做第三张表**。这里是三个读数 + 一句说明——它与上面两张表的区别一眼可辨：字大、无列、无金额列。

```tsx
<dl className={styles.stats} data-probe="cost-cache">
  <div className={styles.stat}>
    <dt className={styles.statName}>缓存命中率</dt>
    <dd className={styles.statValue}>{hitRateText}</dd>
  </div>
  <div className={styles.stat}>
    <dt className={styles.statName}>缓存读取（token）</dt>
    <dd className={styles.statValue}>{cache.readTokens.toLocaleString("en-US")}</dd>
  </div>
  <div className={styles.stat}>
    <dt className={styles.statName}>省下（估算）</dt>
    <dd className={styles.statValue}>{savedText}</dd>
  </div>
</dl>
```

```css
.stats { display: flex; flex-wrap: wrap; gap: var(--sp-3) var(--sp-5); margin: 0; }
.stat { display: flex; flex-direction: column; gap: var(--sp-05); }
.statName { margin: 0; color: var(--text-tertiary); font-size: var(--fs-xs); line-height: var(--lh-xs); }
.statValue {
  margin: 0; color: var(--text); font-size: var(--fs-md); line-height: var(--lh-md);
  font-weight: 600; font-variant-numeric: tabular-nums;
}
```

**逐字与取值规则**

| 读数 | 值来源 | 形态 | 退化 |
| --- | --- | --- | --- |
| 缓存命中率 | `cache.hitRate`（`read / (read + input)`） | `86.5%`，一位小数；`> 0 且 < 0.05%` → `<0.1%`；`= 1` → `100.0%` | `hitRate === null` → `—` |
| 缓存读取（token） | `cache.readTokens` | 千分位 `8,214,770` | 0 → `0`（真零） |
| 省下（估算） | `cache.savedUsd` | `formatLedgerUsd` → `$22.17` | 无可定价模型 → `—` |

**说明行（逐字）**：

> `按同一模型的输入单价估算：读取量 ×（输入单价 − 缓存读取单价），只算可定价模型。`

**三条口径裁决**（写进 `costLedger.ts` 的注释，也写进 `costLedger.test.ts`）：

1. **`hitRate` 覆盖全部带 `usage` 的调用，含未定价模型**。它是 token 比值，与定价无关；
   用「可定价调用」作分子分母会让一个「有 90% 命中率但模型没收录」的会话显示 `—`，那是信息损失。
   （这是对 R2 的澄清，不是改变：`cache.inputTokens/readTokens` 从全部 usage 记录累加，`savedUsd` 才只算可定价。）
2. `savedUsd` 逐模型算，只算可定价模型（R2 ⑥），**不跨档套价**。
3. 分母为 0（既无输入也无缓存读取）→ `hitRate = null` → `—`，**不写 0%**（0% 是「一次都没命中」，是另一件事）。

**与 BleedView 计数器的区别（尺寸定死，免得被说「两张一样的表」）**：

| | BleedView 四类计数器 | 账单三格读数 |
| --- | --- | --- |
| 字号 | `--fs-sm`（12） | `--fs-md`（15） |
| 字重 | 400 | 600 |
| 颜色 | `--text-secondary` | `--text` |
| 数量 | 每条出血点 4 格，纵向重复 | 整页 3 格，只出现一次 |
| 标签 | `--fs-xs` / `--text-tertiary` | 同（复用既有语言） |

---

## §7 最贵的五次调用

```css
.top tbody tr { position: relative; }         /* 整行按钮的 ::after 覆盖层需要定位上下文 */
.top tbody tr:hover { background: var(--bg-hover); }
.jump {
  padding: 0; border: 0; background: transparent;
  color: var(--text);
  font: inherit;                                /* 行内继承表格的 sans / 字号 / 行高 */
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.jump::after { content: ""; position: absolute; inset: 0; }  /* 整行可点，但不吃表格语义 */
.jump:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-inset);       /* 内嵌环：行贴着滚动容器边缘，外扩会被裁 */
}
```

**列**：`时刻 ｜ 模型 ｜ 输入 ｜ 输出 ｜ 缓存写入 ｜ 缓存读取 ｜ 小计`（7 列；类型列不进表，见 §2.6）。

**逐字**：

| 位置 | 内容 |
| --- | --- |
| caption（sr-only） | `最贵的五次调用（均为模型调用，按小计降序）` |
| 第 1 列 | `formatClock(timestamp, true)` → `03:12:45`，包在 `<button class="jump">` 里 |
| 按钮可访问名 | `跳到日志：{HH:mm:ss} 的模型调用（{模型名}，小计 {金额} 美元）` |
| 小计 | `formatLedgerUsd` |
| 空（无金额可排） | 整块换成一句 `本会话没有可比较的调用金额。`（`EmptyState size="inline"`），不画空表头 |

**行高** 26 / 31.41（130%），与按模型表一致。**时刻列 mono**（等宽时间戳），**模型列 sans**，
四个 token 列 mono 紧凑形，小计 mono 千分位。

**跳转行为**：`onLocateInLog(recordId)` → 页面侧 `locateInLog` → `setView("log")` + `setHighlightId(recordId)`。
账单**不新增跳转机制**，也不自己滚日志。

**为什么按钮挂在时刻格里而不是整行是 `<button>`**：表格语义不能丢（R6 要求真 `table`），
而 `tr` 不可能是按钮。用「行内按钮 + `::after` 覆盖层」同时拿到：整行可点、表结构可读、
每行一个可聚焦目标、可访问名能写全。这也是 `BillingWindowCard` 之外唯一能同时满足两者的写法。

---

## §8 动效与滚动

1. **唯一动效**：行 hover 背景 `--bg-hover`，`transition: background-color var(--dur-hover) var(--ease-out)`。
2. **零布局动画**：占比条不许有 `transition: width`（切换会话时会看到条在爬）；不新增 `@keyframes`。
3. 因为不加任何新的位移/缩放动画，**不需要新增 `prefers-reduced-motion` 分支**（R6 已声明；若实现加了动画，必须补）。
4. 滚动：只 `scroll-behavior: auto`（不写 smooth——账单里没有锚点跳转）。
5. 滚动条：见 §2.1。

---

## §9 状态矩阵与文案诚实性

### 9.1 状态矩阵（逐字）

| # | 触发 | 收据 | 按模型 | 缓存 | 最贵五次 | 脚注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `pricedCalls === 0 && unpricedCalls === 0` | **整视图空态**（不画卡）：`EmptyState size="panel"`，标题「本会话没有模型调用」，描述「日志里没有带 usage 的助手记录，没有可估算的账单。」 | — | — | — | — |
| 2 | `pricedCalls === 0 && unpricedCalls > 0` | 收据表**不渲染**，一行说明：`{N} 次调用全部定价未知，没有可估算的金额。`（`--fs-base`，`--text`） | 照常渲染（金额全 `—`，`定价未知` 标注） | 照常（命中率可用、省下 `—`） | 换成：`没有可比较的金额，无法排序。` | 照常 |
| 3 | `pricedCalls > 0 && unpricedCalls > 0` | 正常 + `另有 {N} 次调用未计入（定价未知）` | 未知模型排最后 | 正常 + 说明 | 只含可定价调用 | 照常 |
| 4 | `unpricedCalls === 0` | 正常，无未计入提示 | 全部可定价 | 正常 | 5 行（或更少） | 照常 |
| 5 | 只有一个可定价模型 | 单价列单档（不带 `≈`） | 1 行 | 正常 | 可少于 5 行 | 照常 |
| 6 | 有 usage 但四类 token 全 0（`totalUsd === 0`） | 四行 `0 / — / 0.0% / $0.00`，合计 `$0.00` | 正常（全 0） | 命中率 `—` + 说明；省下 `$0.00` | 换成：`本会话的调用金额都是 $0.00，没有可排的先后。` | 照常 |
| 7 | `hitRate === null`（无输入类 token） | — | — | 命中率格 `—` + 说明行追加「本会话没有输入类 token，命中率无从计算。」 | — | — |
| 8 | 只有缓存读取、无输入 | — | — | 命中率 `100.0%` | — | — |
| 9 | 缺 model 字段 | 正常 | 一格为 `（未记录模型）` | 正常 | 正常 | 正常 |
| 10 | 10,000+ 记录 | 正常（`useMemo` 记忆 `buildCostLedger`，R5） | 正常 | 正常 | 正常 | 正常 |

**状态 1 与状态 2 不是同一个事实**，不许合并（`BleedView` 的三态空态是同一课的来源）：
「一次模型调用都没有」与「有调用但价目表里没有」是完全不同的两件事，第二种情况下 token 量**真实存在**，
把它画成空态等于把已有数据藏起来。

### 9.2 文案诚实性自查表

| 不许写 | 为什么 | 应该写 |
| --- | --- | --- |
| `$0.00`（当 `usd === null`） | 未知 ≠ 免费 | `—` + 该模型格 `定价未知` |
| `$0.00`（当 `0 < usd < 0.01`） | 假零，{N} 次缓存读取看起来免费 | `$0.004` 或 `<$0.001`（§2.3） |
| `免费` / `没花钱` | 没定价 ≠ 0 元 | `未计入` |
| `单价 $15.00 / 百万`（跨档） | 汇总行没有唯一单价 | `≈$15.00` + 加权威价说明 |
| `合计 token 9,650,118` | 四类相加没有单价含义，容易被乘均价 | 合计行的 Token 格写 `—` |
| `账单` / `总花费` | 是估算 | `会话账单`（卡头）、`估算，不是账单`（脚注） |
| `节省 22.17 美元` | 反事实必须限定 | `省下（估算）` + 说明行 |
| `0 次调用`（当 `unpricedCalls > 0`） | 有调用，只是没价 | `另有 {N} 次调用未计入` |
| `命中率 0%`（当分母为 0） | 分母 0 不是 0% | `—` |
| `本月/本周` 等窗口词 | 账单是**单次会话**的 | 不出现任何窗口词 |

**琥珀的配给（全页最多两处）**：`--warning` 只给 ① 卡头的 `ProvenanceBadge`（estimated 档，10px 圆点）
② 合计下的「另有 {N} 次调用未计入」。**未知模型行里的「定价未知」用 `--text-tertiary`**：
它是事实标注，不是告警；琥珀留给「有东西没算进合计」这一件需要读者注意的事。
（`BleedView` 整页都是未知，那里琥珀是主导状态，必须显眼；账单里未知是例外。）

---

## §10 主题与对比度

### 10.1 零新增颜色令牌——消费清单

| 用途 | 令牌 |
| --- | --- |
| 卡面 / 发丝线 / 强发丝线 | `--bg-subtle` / `--border` / `--border-strong` |
| 正文 / 次级 / 三级 / 装饰 | `--text` / `--text-secondary` / `--text-tertiary` / `--text-faint` |
| 占比条填充 | `--chart-1`（实色；6px 厚属于既有先例，`BillingWindowCard` 与 `ParseCoverageChip` 同款） |
| 未计入 / 徽标 | `--warning` |
| 焦点环 | `--accent` |
| 行 hover | `--bg-hover` |
| HC 轨道内部 | `--bg-inset`（同上位覆写） |

**没有新增任何令牌**。`--chart-1-soft` 被否（见 10.4）。

### 10.2 门槛与算法（与 AA 同法，便于互相复核）

```
R' = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ^ 2.4      (s = c / 255)
L  = 0.2126 R' + 0.7152 G' + 0.0722 B'
对比度 = (max(L1, L2) + 0.05) / (min(L1, L2) + 0.05)
```
门槛：正文 ≥ 4.5、大字号（≥18.66px/600 或 24px）≥ 3、**有意义的图形** ≥ 3；rgba 先按底色合成再算。

### 10.3 表 A：图形（门槛 3:1）

| 前景 / 背景 | 浅 | 深 | HC 浅 | HC 深 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `--chart-1` 填充 / 卡面 `--bg-subtle` | **5.64** | **8.39** | **7.82** | **8.90** | 过（占比条可辨） |
| `--chart-1` 填充 / 常态轨道（`--border-strong` 合成 `#d4d5d8` / `#35373a` / `#3f4854` / `#9e9e9e`） | 3.85 | 5.55 | **1.19** | **1.27** | **HC 崩 → 见 10.4** |
| `--chart-1` 填充 / HC 轨道内部 `--bg-inset` | 5.07 | 9.12 | **6.90** | **9.97** | 改用 HC 覆写后过 |
| HC 轨道环 `--border-strong` / 轨道内部 `--bg-inset` | 15.95 | 19.69 | **8.18** | **7.84** | 过（环可见） |
| 轨道 / 卡面（只作容器，非信息图形） | 1.46 | 1.51 | 9.27 | 6.99 | 不作 3:1 判据；百分比文字承担信息 |
| 合计分隔线 `--border-strong` / 卡面 | 1.46 | 1.51 | 9.27 | 6.99 | 判「可见」，见 G9 的像素判据 |
| 点线引导 `--text-faint` / 卡面 | 2.60 | 2.98 | 7.29 | 7.88 | 装饰（`aria-hidden`），不作 3:1 判据 |
| 焦点环 `--accent` / 卡面 | 6.62 | 7.72 | 9.52 | 8.97 | 过 |

### 10.4 表 C：被否掉的候选（带实算，省下一个人再试一遍）

| 候选 | 算出来的值 | 否掉的理由与改写 |
| --- | --- | --- |
| 用 `--border-strong` 实色当高对比度轨道 | 填充对轨道 **1.19 / 1.27**（HC 浅 / HC 深） | HC 下深蓝填充与深灰轨道同亮度，条**看起来不存在**。改写：HC 下轨道 = `--bg-inset` + `0 0 0 1px --border-strong` 环 → 填充对内部 6.90 / 9.97，环对内部 8.18 / 7.84。与 `BillingWindowCard` 的既有覆写同款 |
| 用 `--border` 画合计分隔线 | **1.23 / 1.20**（浅 / 深） | 与行分隔线同色，合计行看不出「到此为止」。改写：`--border-strong`（1.46 / 1.51）+ 8px 上内边距，并靠字号+600 字重再拉一档 |
| 脚注放在页面底 `--bg` 上 | `--text-tertiary` 对 `--bg` 只有 **4.38**（浅色，< 4.5） | 脚注必须落在卡面内（4.78） |
| `--chart-1-soft` 作占比条填充 | **1.36 / 1.88 / 1.22 / 2.37**（四主题；AA 已实算） | 大面积 -soft 是图表色板的规定，但 6px 条是「图形」不是「面积」，-soft 直接看不见。改写：实色 `--chart-1` |
| `--accent` 作小计金额色 | 6.62（浅） | 金额是读数不是链接，蓝色会把收据变成表单。改写：`--text` |

### 10.5 表 B：文字（门槛 4.5:1）

| 前景 / 卡面 `--bg-subtle` | 浅 | 深 | HC 浅 | HC 深 | 用在 |
| --- | --- | --- | --- | --- | --- |
| `--text` | 17.79 | 16.15 | 21.00 | 18.73 | 科目名、小计、合计、读数、模型名 |
| `--text-secondary` | 7.87 | 9.44 | 14.34 | 13.66 | Token / 单价 / 占比数字 |
| `--text-tertiary` | **4.78** | 5.83 | 10.45 | 10.74 | 列头、说明行、`定价未知`、百分比、脚注 |
| `--warning` | 5.24 | 8.17 | 7.13 | 12.12 | 「另有 N 次调用未计入」 |
| `--accent` | 6.62 | 7.72 | 9.52 | 8.97 | 焦点环（图形，列此备查） |

`--text-tertiary` 在浅色主题是 **4.78**——刚刚过线，所以它的所有用场都**必须在卡面上**，
不得下沉到页面底（那里 4.38，会挂）。

### 10.6 复现脚本（node，读真 `tokens.css`，任何人可重跑核对我上面每一个数）

```js
import fs from "node:fs";
const src = fs.readFileSync("web/src/styles/tokens.css", "utf8");
const block = (sel) => {
  const i = src.indexOf(sel), s = src.indexOf("{", i) + 1, e = src.indexOf("\n}", s);
  return Object.fromEntries([...src.slice(s, e).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const themes = {
  浅: block(":root {"), 深: block('[data-theme="dark"] {'),
  HC浅: block('[data-contrast="high"] {'), HC深: block('[data-theme="dark"][data-contrast="high"] {')
};
const rgb = (v, base) => {
  if (v.startsWith("#")) { const n = parseInt(v.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const p = v.match(/rgba?\(([^)]+)\)/)[1].split(/[,/]/).map((x) => x.trim());
  const c = p.slice(0, 3).map((x) => (x.endsWith("%") ? parseFloat(x) / 100 * 255 : parseFloat(x)));
  const a = p[3] === undefined ? 1 : parseFloat(p[3]);
  return base && a < 1 ? c.map((x, i) => x * a + base[i] * (1 - a)) : c;
};
const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const R = (a, b) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);
for (const [name, t] of Object.entries(themes)) {
  const card = rgb(t["bg-subtle"]), track = rgb(t["border-strong"], card);
  console.log(name, {
    fill_on_card: R(rgb(t["chart-1"]), card).toFixed(2),
    fill_on_track: R(rgb(t["chart-1"]), track).toFixed(2),
    track_on_card: R(track, card).toFixed(2),
    tertiary_on_card: R(rgb(t["text-tertiary"]), card).toFixed(2),
    warning_on_card: R(rgb(t["warning"]), card).toFixed(2)
  });
}
```

---

## §11 960 窄窗与 130% 字号

### 11.1 高度账（每一行可加）

| 工况 | pane | 卡头 | 内边距上/下 | 脚注 | 滚动视口 | 内容高 | 滚动量 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1440×900 / 100% | 526 | 40 | 12 / 12 | 8+16 | **436** | 695 | 259 |
| 1440×900 / 100% / 详情开 | 526 | 40 | 12 / 12 | 8+16 | 436 | 695 | 259（宽度变窄，高度不变） |
| 1440×900 / 130% | 519 | 40 | 12 / 12 | 8+20.8 | **424.2**（按面板 526 实测 431，真实的 519 要再少 6.8） | 827 | 402.8 |
| 1440×900 / 130% / 详情开 | 486.2 | 40 | 12 / 12 | 8+20.8 | **391.4** | 827 | 435.6 |
| 960×640 / 100% | **238**（7 标签吃掉 28） | 40 | 12 / 12 | 8+16 | **148** | 695 | 547 |
| 960×640 / 130% | 238 | 40 | 12 / 12 | 8+20.8 | 143 | 827 | 684 |

- 1440×900 整页**不出现**纵向滚动：`document.scrollingElement.scrollHeight <= clientHeight + 1`（G11）。
- 960×640 页内高度刚好 592（`24 + 78 + 12 + 56 + 12 + 238 + 12 + 160 = 592`），
  第 7 标签把 pane 从 266 压到 238，仍在 `.pane{min-height:180px}` 之上。
- 960 下可视区只有 148px（约 5 行收据）——这是「一页一卡」在窄窗的物理代价；
  **不为此改成两列**（§2.1），也不给收据单独加 `max-height`（那会出现第二条竖轴）。

### 11.2 横向账

三张表的 **max-content 宽**（`width: max-content` 实测，Chromium / WebKit；模型名按 §12.4 的 10em 省略号封顶，
里面塞了一个 40 字符的 id 压测）：

| 表 | 100% | 130% |
| --- | --- | --- |
| 收据（5 列） | 390.4 / 394.6 | 460.1 / 466.7 |
| 按模型（6 列，含 40 字符模型名） | 474.1 / 482.8 | **600.0 / 609.8** |
| 最贵五次（7 列） | 370.1 / 376.9 | 463.8 / 471.0 |

| 窗口 | 侧栏 | workspace | 卡内宽 | 与最紧的按模型表余量（130% / WebKit） |
| --- | --- | --- | --- | --- |
| 1440 无详情 | 300 | 1100 | **1074** | 464 |
| 1440 详情开 | 300 + 360 | 724 | **698** | 88 |
| 1400（默认窗） | 300 | 1060 | 1034 | 424 |
| 1100（断点） | 260 | 800 | 774 | 164 |
| 960 | 260 | 660 | **634** | **24** |

余量最紧的是 960 / 130% / WebKit：按模型表 609.8 vs 634，只有 24px。
这 24px 不是运气，是 §12.4 那条 `max-width: 10em` 换来的——模型名再长，这张表的 max-content 也有上界。
**实测无横向溢出**（Chromium 与 WebKit、100% 与 130%、四种卡内宽全部 `scrollWidth <= clientWidth`，
且 634 容器里 `table.scrollWidth === 634`）。

### 11.3 折行与折叠策略（每一条都有实测背书）

| 元素 | 100% | 130% | 策略 |
| --- | --- | --- | --- |
| 收据五列 | 全在 | 全在（634 下仍有余量） | 不折叠、不隐藏列 |
| 收据点线 | 705.6 / 329.6 / 265.6 | 643.7 / 267.7 / 203.7 | 由科目列吸收，最短 197px（WebKit/960/130%）仍可读 |
| 收据金额/单价/token | 不换行 | 不换行 | `white-space: nowrap` 是硬规则；宽了就压点线，不换行 |
| 按模型四个 token 列头 | 一行 | 一行（实测列头高 25.8 = 20.8 + 4 + 1） | 不缩写、不折叠 |
| 按模型/最贵五次的行 | 一行 26 | 一行 31.41 | 模型名用 CSS 10em 省略号（§12.4）+ `title` 全名，**不折行** |
| 三格读数 | 一行 | 一行（`42.1%`/`8,214,770`/`$22.17` 合计 < 400px） | `flex-wrap` 兜底，允许换行 |
| 脚注 | 一行 | 一行（实测 ~255px） | 允许换行 |
| viewBar 7 标签 | 1440 一行；960 折两行（+28px） | 1440 一行；1440+详情 / 960 折两行（60.8） | 既有 `flex-wrap`，不干预 |

---

## §12 无障碍

### 12.1 语义与可访问名

| 元素 | role / 属性 | 可访问名或值 |
| --- | --- | --- |
| 卡 | `<section aria-label="会话账单">` | `会话账单`（Panel 既有） |
| 收据表 | `<table>` + `<caption>`（视觉隐藏） | `会话账单：四类 token 的用量、单价、占比与小计，最后一行是合计` |
| 列头 | `<th scope="col">` | `科目` / `Token` / `单价 / 百万` / `占比` / `小计` |
| 科目 | `<th scope="row">` | `输入` / `输出` / `缓存写入` / `缓存读取` |
| 合计行 | `<tfoot><tr><th scope="row">合计</th>…` | `合计` |
| Token 格 | `<td>` | `aria-label="输入 1,284,930 token"` |
| 单价格 | `<td>` | `aria-label="输入单价 3.00 美元每百万 token（Sonnet 档）"` / `…加权均价 3.79 美元每百万 token，按各模型实际用量加权` / `单价 无用量` |
| 占比条 | `<span aria-hidden="true">`（轨道 + 填充） | 不读；百分比文字可读 |
| 占比百分比 | 文本 | `53.3%` / `<0.1%` |
| 小计格 | `<td aria-label="小计 4.87 美元">` / `aria-label="小计 定价未知"` | 所有金额格都带单位「美元」 |
| 合计金额 | `<td aria-label="合计 9.15 美元">` / `aria-label="合计 定价未知"` | |
| 未计入 | `<p data-probe="cost-unpriced">` | 文本本身 |
| 滚动容器 | `<div tabIndex={0} aria-label="账单内容">` | 键盘可聚焦，方向键/PageDown 可滚 |
| 跳转 | `<button class="jump" aria-label="跳到日志：03:12:45 的模型调用（Sonnet 4.5，小计 0.42 美元）">` | 见 §7 |

**金额一律用 `aria-label` 带单位**（`美元`），可视文本保留 `$` 前缀。`—` 读作「定价未知」而不是「破折号」。

### 12.2 键盘

| 键 | 行为 |
| --- | --- |
| `Tab` | 滚动容器 → 第 1 行跳转按钮 → … → 第 5 行（DOM 顺序，无 `tabindex` 干预） |
| `Enter` / `Space` | 触发跳转（原生 `<button>`） |
| `↑ ↓ PageUp PageDown Home End` | 滚动容器聚焦时原生滚动内容（不拦截） |
| `Tab` 出容器 | 焦点到脚注之后的页面元素 |

**没有任何自定义方向键逻辑**：账单一屏内没有可选择的项，roving tabindex 用不上。

### 12.3 焦点环

```css
.jump:focus-visible { outline: var(--focus-ring-width) solid var(--accent); outline-offset: var(--focus-ring-inset); }
.scroll:focus-visible { outline: var(--focus-ring-width) solid var(--accent); outline-offset: var(--focus-ring-inset); }
```

- 用**内嵌环**（负 offset），因为这两者都贴着 `overflow` 容器/表格边缘，外扩会被裁掉（AA §12 的同一课）。
- `focusRing.test.ts` 锁死了 `outline: var(--focus-ring-width)` / `outline-offset: var(--focus-ring-offset)` /
  inset 的**出现次数**。本轮新增 2 处 outline + 2 处 inset，实现后**必须 grep 实际数字再改守卫**，
  不许照抄我这里的预估（AA 的教训：预估数与实数差三处）。

### 12.4 长字符串（模型 id）

模型名用 **CSS 省略号**截断，不用 JS 数字符：`.modelName { display:inline-block; max-width:10em; overflow:hidden;
text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom }`，完整 id 进 `title` 与 `aria-label`。
理由三条：

1. `ParseCoverageChip.typeName` 的先例是「长名换行不截断」，但那里可用宽度是弹层（420px）；账单里模型格是表格的
   1fr 轨，换行会让表在 130% 下冒出两套行高（实测 26 → 54.8），破坏 G8 的行高门禁。
2. **10em 给的是上界，不是「大致够」**：实测往模型格里塞一个 40 字符的 id，按模型表的 max-content 仍是
   474.1 / 482.8（100%）与 600.0 / 609.8（130%）——**与 id 长度无关**。JS 数字符做不到这一点：
   「24 个码点」在等宽与比例字体、中文与拉丁下的宽度差 30%，130% 下会顶到 634 边界（按 130% 下每字符
   8.4px 估算，24 字符 + 未知档标注 ≈ 345px，整表就冲到 635px）。
3. 纯 CSS 没有「量宽度再渲染」的二次布局，WebKit 与 Chromium 在同一 `em` 下裁出同一个点。

### 12.5 颜色不是唯一编码

| 信息 | 颜色通道 | 形状/文字通道 |
| --- | --- | --- |
| 某科目多少钱 | 占比条长度 | 百分比数字 + 小计金额 |
| 定价未知 | 无颜色（`--text-tertiary`） | `—` + 「定价未知」文字 |
| 未计入合计 | `--warning` | 「另有 N 次调用未计入」整句 |
| 跨档加权 | 无颜色 | `≈` 前缀 + 脚注整句 |
| 估算 | `ProvenanceBadge` 琥珀点 | 脚注「估算，不是账单」整句（常驻） |
| 焦点 | `--accent` 环 | 2px 环形状 + 内嵌位置 |

灰度打印/灰度截图下，上表每一行都仍能分辨——这是本页的自查口径。

---

## §13 锚点与门禁

### 13.1 `data-probe` 锚点表（事实在应用，断言在脚本）

| 锚点 | 挂在哪 | 门禁要读的事实 |
| --- | --- | --- |
| `cost-root` | 视图根 div | 视图在场 |
| `cost-scroll` | 滚动容器 | `clientHeight/scrollHeight/clientWidth/scrollWidth`、`tabIndex` |
| `cost-receipt` | 收据 `<table>` | `rows`、`headerH`、`rowH[]`、`totalH` |
| `cost-receipt-row` + `data-class` | 四个科目行 | 行高、`data-class` 顺序 |
| `cost-receipt-total` | 合计行 | 上边框、金额右沿 |
| `cost-money` / `data-col="sum"` | 所有金额格（4 + 1 + 按模型行 + 最贵五次行） | 右沿 `right` 值、（按表分组）最大差 |
| `cost-unpriced` | 未计入提示 | 在场 ⇔ `unpricedCalls > 0`；文本含 `另有 N 次调用未计入` |
| `cost-models` / `cost-model-row` | 按模型表 / 行 | 行数、金额右沿、`定价未知` 行数 |
| `cost-cache` | 三格读数 `<dl>` | 三格在场 |
| `cost-top` / `cost-top-row` | 最贵五次表 / 行 | 行数 ≤ 5、每行有 `button` |
| `cost-bar` | 占比条轨道 | `aria-hidden="true"`、`offsetWidth === 56`、`offsetHeight === 6` |
| `cost-footnote` | 常驻脚注 | 文本含 `估算，不是账单` 与 `2026-10-01`；`bottom <= 卡底` |

### 13.2 e2e 不变量（`web/e2e/cost.spec.ts`，Chromium + WebKit）

| # | 不变量 | 阈值 | 测量方式 |
| --- | --- | --- | --- |
| G1 | 第 7 个标签可切、刷新可恢复 | 标签数 = 7，末项文本 = `账单`；重载后 `aria-selected` 仍在「账单」 | `getByRole("tab")` 计数 + `localStorage["cca-analyzer-view"]` |
| G2 | 收据结构与合计 | 4 个 `cost-receipt-row`，顺序 `input/output/cacheWrite/cacheRead`；合计行 1 个 | `data-class` 序列 |
| G3 | 逐位可复算 | 每行小计 = `tokens/1e6 × 单价` 的显示值，误差 < 1e-9（比数值而不是比字符串）；合计 = 四行之和 | 夹具复算 + `parseFloat(text.replace(/[^0-9.]/g,""))` |
| G4 | **不出现假零** | 存在至少一行小计 ∈ (0, 0.01) 且文本 ∈ `/^\$0\.00[1-9]$/`；全表没有「token > 0 且金额文本 = `$0.00`」的行 | 读 `data-col="sum"` 与 token 格 |
| G5 | 未知模型 | 未知模型的金额格文本 = `—`（不是 `$0.00`）；模型格含 `定价未知`；`cost-unpriced` 出现且含「另有 {N} 次调用未计入」 | 选择器 + 文本正则 |
| G6 | 单价消歧 | ≥2 档时**所有**单价格以 `≈` 开头；单档夹具时**没有任何**单价格以 `≈` 开头，且等于价目表值 | 逐个单元格正则 |
| G7 | 金额列右沿对齐 | 收据 5 个金额格（4 行 + 合计）`right` 最大值 − 最小值 ≤ **1px**；按模型表内 ≤ 1px；最贵五次表内 ≤ 1px | `getBoundingClientRect().right` |
| G8 | 行高确定 | 四个科目行高两两差 ≤ **0.5px**，且 = 28（100%）/ 34（130%）± 1；按模型与最贵五次行 = 26 / 31.4 ± 1 | `getBoundingClientRect().height` |
| G9 | 合计分隔线可见 | 合计行单元格 `borderTopWidth === "1px"` 且 `borderTopStyle === "solid"`；截图在分隔线所在 y 取一列像素，与卡面亮度差 ≥ **16/255** | DOM 计算样式 + 像素采样 |
| G10 | 卡内无横向溢出 | `cost-scroll.scrollWidth <= clientWidth + 1`（1440 与 960 各测一次） | 原生属性 |
| G11 | 整页只有一条竖轴 | `document.scrollingElement.scrollHeight <= clientHeight + 1`（1440×900）；`cost-scroll.scrollHeight > clientHeight`（确实在卡内滚） | 原生属性 |
| G12 | 跳转 | 点第 1 行按钮 → `[role=tab][aria-selected=true]` 文本 = `日志视图`；日志表滚到该记录（`scrollTop > 0` 或存在含该时刻的行） | 点击 + 断言 |
| G13 | 无障碍最低线 | 每个 `cost-bar` 有 `aria-hidden="true"`；每个 `data-col="sum"` 有 `aria-label` 且匹配 `/美元$/` 或 `定价未知`；跳转按钮 `aria-label` 以 `跳到日志：` 开头 | 属性断言 |
| G14 | 130% 不裁切 | 设 `--font-scale=1.3` 后：7 个标签全部 `right <= 控件 right`；收据 5 列全部 `scrollWidth <= clientWidth + 1`；无单元格 `scrollWidth > clientWidth + 1` | 逐元素盒测量 |
| G15 | 960 下不横向滚动 | 960×640 时 `cost-scroll.scrollWidth <= clientWidth + 1`，页面竖轴允许（既有行为） | 原生属性 |

### 13.3 真机门禁（`scripts/gui-test.sh`）

**动作**：在 `CAPTURE_TARGETS` 的「重放」之后追加两步：

```
… "重放" "点选=button[aria-label^='最长停顿']" "账单" "点选=[data-probe='cost-top-row'] button" …
```

- `账单` 那一步判定：收据四行 + 合计 + 未知模型 `—` + 常驻脚注；几何（G7/G8/G9/G10/G11）。
- `点选=[data-probe='cost-top-row'] button` 那一步判定 G12（点行真的跳回日志，且停在那条记录上）。

**常量**（住脚本顶部，与 `CHANGES_FILE_COUNT` 同区）：

```bash
# 会话账单（Round BB）。夹具 cost-session.jsonl 的账：3 个模型（Sonnet 4.5 / Opus 4.1 / GPT-5 未定价）、
# 最贵 5 笔、四类小计含一笔 $0.002 的缓存读取——假零断言靠它。
COST_TAB_LABEL="账单"
COST_CLASS_ROWS=4
COST_MONEY_RIGHT_TOLERANCE=1     # px
COST_ROW_HEIGHT_TOLERANCE=1      # px
COST_UNPRICED_CALLS=2
COST_TOP_ROWS=5
```

**`PROBE_JS`（`src-tauri/src/lib.rs`）要补的事实**：

```js
cost: {
  present: !!document.querySelector('[data-probe="cost-root"]'),
  scroll: { clientH, scrollH, clientW, scrollW },
  receipt: { rows: n, headerH, rowH: [...], totalH, totalBorderTop: "1px" },
  moneyRight: { receipt: [...], models: [...], top: [...] },
  footer: { text, bottom, panelBottom },
  bars: { count: n, hidden: n, w: 56, h: 6 }
}
```

阈值与判定留在 `scripts/gui-test.sh`（**事实在应用、断言在脚本**），脚本里只判几何关系，不断言绝对像素坐标与颜色。

---

## §14 明确不做

1. 不做跨会话对比（「这次比上次贵」），不做预算/配额，不做预测。
2. 不做任何图表（柱/饼/面积/热力）。
3. 不猜定价：`pricingFamilyFor` 返回 `null` 就是未知，不按「最接近的档」兜底。
4. 不联网取价、不新增 Tauri 命令与权限。
5. 不做排序切换、不做筛选、不做导出（导出走既有的报告/归档通道）。
6. 不新增颜色令牌、不新增间距档位、不新增字号。
7. 不自定义纵向滚动条样式（沿用 `ChangedFilesView` 的 `thin` 方案）。
8. 不加布局动画、不加 `prefers-reduced-motion` 分支。
9. 不给收据单独设 `max-height`（会造成第二竖轴）。
10. 不把四类 token 合并成一个总量再乘均价（R4）。
11. 不做「本可以省多少」以外的反事实（例如「如果用 Haiku 只要 $0.3」）。
12. 不设「类型」列（§2.6）；不加「占比」以外的排序键。

---

## §15 给实现者的清单与警告

### 15.1 按顺序做

1. `pricingSnapshot.ts`：新增 `export function classRate(family: ModelFamily, key: "input"|"output"|"cacheWrite"|"cacheRead"): number`；
   `estimateCost` 改为调它；加等价性测试（`toBeCloseTo(…, 12)`）。
2. `costLedger.ts`：类型 + `buildCostLedger` + `formatLedgerUsd` + `formatLedgerRate` + `formatSharePercent`
   + 一个 `classUnitPrice(ledger, key): { kind: "none" | "rate" | "weighted"; value: number | null; family?: ModelFamily }`
   （把 §2.4 的裁决收进纯函数，UI 不许自己判断）。
3. `costLedger.test.ts`：R2 口径 1–10 + 金额格式表（§2.3 六行）+ 单价三态 + 占比 `<0.1%` 守卫。
4. `CostLedgerView.tsx` + `.module.css`：按 §3–§7 的骨架与 CSS。
5. `SessionAnalyzerPage.tsx`：`AnalyzerView` 加 `"cost"`；`ANALYZER_VIEW_ITEMS` 追加
   `{ value: "cost", label: "账单" }`（排在「重放」之后）；`readStoredView()` 白名单加 `"cost"`；
   `TimelineTrack/FilterBar` 的不渲染判断加上 `cost`；`.pane` 分派加 `cost → <CostLedgerView parsed onLocateInLog={locateInLog} />`。
6. `CostLedgerView.test.tsx`：收据行/合计/`—`/空态/点击跳转/脚注文案/`aria-hidden`。
7. `SessionAnalyzerPage.test.tsx`：+1 例（7 个标签、可切到账单、`localStorage` 恢复）。
8. `web/e2e/cost.spec.ts`（G1–G15）；夹具 `web/tests/fixtures/cost-session.jsonl`（必须含一笔 <$0.01 的小计与 2 次未定价调用）。
9. `scripts/gui-test.sh`：加 `账单` 与 `点选=…cost-top-row` 两步 + 常量；
   `src-tauri/src/lib.rs` 的 `PROBE_JS` 补 `cost` 事实块（保持小块、只读几何）。
10. `docs/screenshots/views.json` 加 `cost`（**只改这一处**）+ `web/e2e/screenshots.spec.ts` 的声明；
    截图 `docs/screenshots/cost-{light,dark}[-webkit].png`。
11. `focusRing.test.ts`：grep 实际数字后改守卫（新增 2 处 outline + 2 处 inset）。
12. CHANGELOG `[Unreleased] → Added`（中文一条）+ 双 README + 路线图 + `.trellis/spec/frontend/` 若涉新表格语义加一小节。

### 15.2 最容易踩的四个坑（按踩到的概率排序）

**坑 1：`formatUsd` 的假零。** `formatUsd(0.004) === "$0.00"`。账单必须用自己的 `formatLedgerUsd`，
并且 **`null` 要在调用之前就分出去**（`BleedView` 的注释已经把这课写在代码里了）。
自测：夹具里那笔 $0.002 的缓存读取，如果屏幕上显示 `$0.00`，说明你用了 `formatUsd`。

**坑 2：`border-collapse: collapse` + 行内 `inline-block` 的占比条会把行高搞成 28.5 / 30.45。**
实测：collapse 下四行是 `[28.5, 28, 28, 28.5]`（Chromium）与 `[29, 28, 28, 28]`（WebKit）——
被折叠边界吃掉的半像素落在与表头/表尾相邻的行上。改成 `border-collapse: separate; border-spacing: 0` 后
四行精确等于 28（130% 为 34）。另外占比条必须包在 `.shareFlex`（`height: var(--lh-base)`）里：
6px 的 inline-block 会按 `vertical-align: middle` 撑高行盒，同一张表里能出现 28.94 与 28.44 两种行高。

**坑 3：`Panel` 的 `.body` 没有 `flex-grow`，不接三段链内容会被直接裁掉。**
症状：气泡里内容明明有 695px 高，卡只显示 436px，**没有滚动条**，也没有报错——
因为 `.panel{overflow:hidden}` 把它剪了。照 `ChangedFilesView` 的四条规则写：
`.root` 撑满、`.root > section` 撑满、`.root > section > div` 变成 flex 列、`.scroll` 才 `overflow-y:auto`。

**坑 4：`table-layout: fixed` 在 130% 下会溢出。** 实测：给 token 列写死 116px 时，13 位数
（`9,999,999,999`）在 130% 下 `scrollWidth > clientWidth`，直接违反无横向溢出。
用默认的 auto 布局 + 首列 `width: 100%`：科目列吸收余量、点线自然填满、金额右沿自动对齐（实测 max−min = 0），
而且任何长度的数字都不会溢出——它只是把点线压短。

### 15.3 复核清单（提交前逐条打勾）

- [ ] 四行顺序 `input/output/cacheWrite/cacheRead`，0 行也在。
- [ ] 合计 = 四行之和（误差 < 1e-9），且合计行的 Token/单价格是 `—`。
- [ ] 未计入提示的 N 与 `unpricedCalls` 一致，`unpricedCalls === 0` 时不渲染。
- [ ] 单价：单档无 `≈`、多档有 `≈`、0 token 是 `—`。
- [ ] 未知金额是 `—`，没有任何 `$0.00` 出现在未知上。
- [ ] 常驻脚注含 `估算，不是账单` 与 `PRICING_AS_OF`。
- [ ] 7 个标签可切、可恢复；130% 下不裁标签。
- [ ] 三主题（浅/深/HC浅/HC深）下占比条在 HC 里仍能看见（§10.4 的覆写）。
- [ ] `cost-scroll` 是唯一的纵向滚动容器；整页无第二竖轴。
- [ ] 金额右沿差 ≤ 1px；科目行高一致。
- [ ] 跳转按钮可 Tab 到、Enter 生效、跳到日志并高亮。

---

## §16 留给主会话复核的开放项

1. **`|F| ≥ 2` 时单价用 `≈$X.XX`（加权均价）而不是 `—`**：保留信息量，代价是读者要理解 `≈`。
   若验收方认为「宁可不给数」，把 `classUnitPrice` 的 `weighted` 分支改成 `—` 即可，
   其余几何与门禁不变（G6 会反过来要求「多档时全部为 `—`」）。
2. **`hitRate` 覆盖全部 usage 记录（含未定价模型）**：本文把它当澄清（§6 裁决 1）。若产品坚持
   「只算可定价调用」，请在 PRD 里改一句，`costLedger.test.ts` 同时改。
3. **「类型」列删除**（§2.6）：与 PRD R3④ 的措辞不同。若坚持保留，只在 ≥1101px 渲染，
   并同步新增一条「960 下该列隐藏、无横向溢出」的门禁。

## §17 主会话评审结论

**结论：接受，随本轮 PR 合并。** 三个开放项裁决如下，其余与规格一致。

1. **`|F| ≥ 2` 保留 `≈` 加权均价**（不改成 `—`）。理由：这次会话确实花了这笔钱，
   只是没花在某一个档位上；写 `—` 会把「已知的加权数」降级成「未知」。`≈` 的
   符号成本由脚注承担，而 G6 已经把「四行都以 ≈ 开头」钉成断言。
2. **`hitRate` 只算可定价调用**（否掉本文的「覆盖全部 usage」）。一张卡里不能混
   两个分母：命中率的分母若含未定价调用，分子里的读取量却只来自可定价调用，
   这个比例就不是比率而是混合量。`cache.readTokens === classes[cacheRead].tokens`
   已作为不变量测住，界面文案写「按可定价调用计算」。
3. **「类型」列删除**（接受）。那张表的每一行都是模型调用，一列恒定的值只占宽度；
   它要表达的信息改用 caption 与跳转按钮的可访问名承载，读屏读者拿到的信息不少。

### 我独立复算的数（不照抄实现）

夹具账：`input $1.65 / output $0.3975 / cacheWrite $0.13125 / cacheRead $0.0045`，
合计 **$2.18325**（闭合差 4.4e-16）；token `230,000 / 8,100 / 15,000 / 11,000`；
加权单价 `≈7.17 / 49.07 / 8.75 / 0.41`；占比 `75.6 / 18.2 / 6.0 / 0.2`；
按模型 `Opus $1.64025`、`Sonnet $0.543`、`gpt-5 —`。
屏幕上显示 `$1.65 / $0.40 / $0.13 / $0.005 / $2.18`——**四个显示值相加正好等于
显示的合计**，这是格式化顺序（先四舍五入再相加）能否自洽的关键，也是我复核的重点。

### 规格矛盾修正

- §2.3 第 3/4 条原写「判小数点后三位」，遇到 `0.00999` 会印出 `$0.010`（四位）。
  改为判**四舍五入后的三位小数**（`rounded3`），`0.00999 → $0.01`。
- §8 的底缘提示只写了「渐隐」，没给高度。实现先做 32px，实测会把折叠线下的整行
  读数洗成「看起来没渲染」；收到 24px 并把不透明段压到最底 ~10px 后，标题清晰、
  只有被裁的那半行渐隐——**这是本轮唯一的视觉返工**，已写进 §13.2 的 G16 反查。

### 与规格的实现偏离（全部已在验收中接受）

- 状态 2（有调用但全部无法计价）不再追加「另有 N 次未计入」——那句话在只有一种
  状态时是废话。
- 最贵五次在数据为空时隐藏区头 meta（没有「0 次」可说的）。
- 模型列左对齐（数值列右对齐）；token 单元格的读屏文本带科目名。

### 验收证据（主会话亲自跑的）

- `npm --prefix web test`：**1520 通过 / 121 文件**。
- `cd web && npx tsc -b --force`：exit 0。
- `npm --prefix web run test:e2e -- cost`：Chromium 15 passed、WebKit 15 passed。
- `./scripts/gui-test.sh --build`：**508 通过 / 0 失败**，其中账单 2 步；真机实测
  收据四行 `$1.65 / $0.40 / $0.13 / $0.005`、合计 `$2.18`、未计入 2 次、
  卡内滚动 695 > 498、行高 28±1、底缘提示在场、点最贵行后 `11:13:12` 落在可见带内。
- `./scripts/check-screenshots.sh`：✓ 96 张（24 视图 × 2 主题 × 2 引擎）。
- `./scripts/lint.sh`：36 通过 / 0 失败；`cargo fmt --check` 与
  `cargo clippy -- -D warnings` 干净。
- 截图 `docs/screenshots/cost-{light,dark}[-webkit].png` 四张，我逐张看过。

---

### 附：本文所有实测数字的出处

- **tab 条 / 字符串宽度 / 卡内几何 / 行高 / 内容高 / 点线宽**：Playwright 1.64（Chromium 1248 与 WebKit 2370）
  加载真实 `web/src/styles/tokens.css` + 逐字复刻的组件 CSS，在 1440×900 / 960×640、`--font-scale` 1 与 1.3 下测量；
  每个工况跑两遍引擎、四档卡内宽（1074 / 698 / 634 / 卡内 774 推算）。
- **对比度**：§10.6 的脚本，读 `tokens.css` 四个主题块，rgba 先按卡面合成。
- **既有事实（pane 526、panel 40、.body 无 grow、滚动条先例）**：§0.2 的逐条引用。
