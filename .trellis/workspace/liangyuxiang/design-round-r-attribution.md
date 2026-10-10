# 「按会话的配额归因（本窗口消耗 Top 会话）」设计与文案规格（Round R）

> 角色：UI/UX 产品设计师（桌面工具 / 仪器面板，数据可视化方向）
> 日期：2026-10-10 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（已锁定，引用 Issue #151 的冻结契约，不在本文件重开）：5 小时计费窗口卡内新增一块
> 「本窗口消耗 Top 会话」。行 = 会话标题 + 窗口内消耗 + 占比条 + 占比百分比；默认 Top 5，
> 超过 5 个会话时追加「其余 N 个会话」；点行复用压缩统计的 `onOpenSession` 通道。
> **本文件只描述设计与文案，不改任何源码，不新增超出 #151 契约的功能。**

## 0. 语境与现状（写前逐字读过）

读过：Issue #151 维护者评论（契约）、`BillingWindowCard.tsx` / `.module.css`、
`UsageOverviewPage.tsx` / `.module.css`、`CompactionStatsPanel.tsx` / `.module.css`、
`ProvenanceBadge.tsx` / `provenance.ts`、`billingWindow.ts`、`usageAggregations.ts`、
`tokenTotals.ts`、`metadataCache.ts`、`lib/format.ts`、`tokens.css`、`Gauge.tsx`、
`UsageOverviewPage` 的首屏 e2e 与 `src-tauri/src/lib.rs` 的 `gui_probe`、
`scripts/gui-test.sh` 的判定段，以及上一轮的 `design-round-q-bundle.md`、
`design-round-p-tray.md`、`design-critique.md`。

**#151 冻结事实（后文只在此范围内展开）：**

- 5 小时窗口的现有口径在 `billingWindow.ts`：`clusterBillingBlocks(records)` 切块，
  `currentBlock(blocks, now)` 取当前窗口。归因必须复用 `BillingWindowCard` 手上已有的
  `active` 块，不许在归因里再算一遍边界。
- 窗口是 `[block.start, block.end)`；同一会话跨窗口要被切开，半个会话在窗口 A、
  半个在窗口 B，各算各的。
- 同一会话在窗口内只出现一行，标签用 `sessionTitle(SessionMeta)`；悬停与可访问名给
  项目目录名，不出现完整绝对路径。
- 占比分母 = 该窗口的总消耗，也就是表盘中心那个数。精确占比之和恒为 100%。
- 默认 Top 5；窗口内会话多于 5 个时，最后一行是「其余 N 个会话」的合并值。
- 窗口内没有任何会话记录时不渲染这块，不是 0 条空列表。
- token 口径与全站一致：`input + output + cacheCreation + cacheRead`。
- v1 只做 5 小时层；周窗口归因、按模型 / 工具再切一层、并发推断都不做。

**本规格定死的数值（实现者一眼版）：**

| 项 | 定死值 |
| --- | --- |
| 面板标题 | `本窗口消耗 Top 会话` |
| 行高 | `calc(var(--row-pad-y-tight) * 2 + var(--lh-xs))`，100% 字号下 24px |
| Top N | `5`，超过时追加一行 `其余 N 个会话`，总条目上限 6 |
| 占比条 | 56px x 6px 轨道，`var(--border-strong)` 底，`var(--chart-1)` 实色填充，非零最小 2px；复刻日志表占比条语言 |
| 主锚点 | `data-probe="attribution-row"`，放在真正可点的整行 `<button>` 上 |
| 分母脚注可见首句 | `占比分母 = 本窗口总消耗（与表盘中心同一个数）。` |

## 1. 位置、标题与首屏密度

### 1.1 确切 DOM 顺序

`BillingWindowCard` 现在的手写顺序是：

```text
<Gauge />
<div className={styles.readouts}> ... </div>
<section className={styles.weekly}> ... </section>
{history.length > 0 ? <div className={styles.history}> ... </div> : null}
```

Round R 只在 `.gaugeArea` 内插入一个新子块，插在 `.weekly` 之后、`history` 之前：

```text
<Gauge />
<div className={styles.readouts}> ... </div>
<section className={styles.weekly}> ... </section>
<QuotaAttributionPanel
  block={active}
  inputs={inputs}
  onOpenSession={onOpenSession}
/>
{history.length > 0 ? <div className={styles.history}> ... </div> : null}
```

阅读顺序因此固定为：表盘 → 5 小时读数 → 周层 → 本窗口 Top 会话 → 历史窗口条。
位置选择说明：这一段归因的窗口就是 5 小时层，但 Issue #151 要求它出现在
「表盘与读数之后、历史窗口条之前」，而周层本身也是读数层的一部分；放在周层之后
可以保证它不把两层限额的读数拦腰截断，同时严格落在历史条之前。

### 1.2 首屏不撑破的布局取舍

面板不另起一整行。它与表盘、读数、周层同处 `.gaugeArea` 的弹性行；历史窗口条
改成 `flex: 1 1 100%`，因此在宽容器下被推到下一行、占满整行宽度。这样：

- 第一行的高度由最高项决定。6 条目时面板约 182px，历史条被推到第二行后自身
  约 112px，整张卡比原来高约 176px；这是本规格为归因面板付出的全部首屏成本，
  不再额外增加一整行面板。
- 历史条不被删除、不被折叠，只是从第一行换到第二行；它的 72px 图形、轴标签与
  「柱间距不代表真实间隔」那句 caption 全部保留。
- 面板在宽容器下排在周层右侧；窄容器下自然换行到周层下方、历史条上方。无论宽窄，
  DOM 顺序和键盘顺序都保持表盘 → 读数 → 周层 → 归因 → 历史条。

面板自身用 `align-self: center`，不拉伸成固定高度。窗口内只有 1 个有记录的会话时
面板自然矮下去，行高由读数与周层兜底；窗口内有 5 到 6 个条目时面板成为这一行的
最高项，仍保持内容顶对齐、外框完整。

**首屏红线：** 实现后 `web/e2e/usage-overview.spec.ts` 里
「1440 x 900 不滚动时三块面板的标题都在首屏」必须保持绿色。
如果实测不绿，只允许按以下顺序降级，且每一步都必须保留 Top 5 + 余项与全部锚点：

1. 分母脚注已经只显示首句，不再改；
2. 行高从 24px 降到 `calc(var(--lh-xs) + var(--sp-05) * 2)`，100% 字号下 20px；
3. 历史图从 `height={72}` 降到 `height={56}`，图形与 caption 仍保留。

不得把 Top 5 改成 Top 3，不得默认折叠，不得删除余项行，不得删除历史条。

### 1.3 是否可折叠

v1 **不折叠**，也不提供展开 / 收起按钮。理由：

- 面板总条目上限就是 6，折叠不会节省有意义的高度，只会把 Issue #151 的核心答案
  藏到一次点击后面。
- 用户看到表盘中心的大数字后，下一步问题就是「谁在烧」；Top 5 必须立刻可见。
- 折叠控件会引入第二套状态、第二套键盘语言与第二套截图分支，收益与成本不成比例。

## 2. 数据口径（唯一真源）

### 2.1 复用同一份窗口

归因函数只接收 `BillingWindowCard` 已经算好的 `active` 块，不接收 `records + now`，
也不调用 `clusterBillingBlocks` / `currentBlock`。工作区已经有
`web/src/features/usage/quotaAttribution.ts` 与 `quotaAttribution.test.ts`；
本文以下统一使用它的命名与返回字段，UI 实现不再另起 `sessionAttribution` 一套名字。
函数签名固定为：

```ts
attributeQuota(
  inputs: readonly UsageSessionInput[],
  block: BillingBlock,
  options?: { top?: number }
): QuotaAttribution
```

返回对象里的 `windowTokens` 就是 `totalsSum(block.totals)`，也就是表盘中心
已经使用的 `consumed`。函数从 `block` 自己取分母，不从 `rows` 汇总；调用方不再传
第二份分母，从源头上消灭第二套数字。UI 侧只消费 `attributeQuota` 的结果，
不得在组件里再算一遍窗口边界或分母。

### 2.2 一条记录只属于一个窗口

过滤规则固定为：

```text
block.start <= record.timestamp < block.end
```

右边界必须是严格小于。`clusterBillingBlocks` 的下一块起点正是 `>= block.end`，
所以一条恰好落在 `block.end` 的记录属于下一块，不属于当前块。单测必须包含
「恰好落在 `block.end`」的变异用例：把 `<` 改成 `<=` 必须让用例红。

同一会话跨两个窗口时，两个窗口各拿到自己那一段记录。窗口 A 的行只计 A 段 token，
窗口 B 的行只计 B 段 token，任何一边都不能吃掉整个会话。

### 2.3 同一会话只出现一行

先按稳定会话键合并输入，再排序。`attributeQuota` 已经定死两条键：

1. `input.session` 存在时，键 = `path:${input.session.path}`；
2. 没有 `session` 时，键 = `anonymous:${input 在数组中的位置}`。

没有元数据的输入**不按 `projectLabel` 合并**：两个同名项目的匿名会话是两条独立
记录，合并会少记一条。有元数据的输入才按 `SessionMeta.path` 合并；同键输入合并
记录后再按 §2.2 过滤。合并后的 token 用 `tokenTotalsOf(过滤后的记录)` 再折进
`totalsSum`，与 TokenPanel、用量页共用同一个求和实现，不手写第二套加法。

`input.session` 缺失时（单测手工构造的假输入）行仍可显示：`path` 是空串，
标题回退为 `input.projectLabel`，`projectPath` 用 `input.projectPath ?? session?.cwd`。
该行没有可打开的 `SessionMeta`，即使外部传了 `onOpenSession` 也必须禁用。

### 2.4 排序、Top 5 与余项

- 窗口内只要有一条记录落在 `[start, end)`，该会话就纳入归因；token 为 0 的会话
  也保留，排在最后，显示 `0 tok`、`0.0%`、空条。这样「窗口内有几个会话」与
  余项账目都不漏。零消耗会话不占头部，也不会把真正烧额度的会话挤掉。
- 排序：`tokens` 降序；并列时标题 `localeCompare` 升序；再并列时 `path`
  `localeCompare` 升序。排序必须稳定、可在单测中逐项断言。
- 前 5 个会话生成 5 个真实行；第 6 个及以后合并成一行：
  `sessions = sessionsInWindow - 5`，`tokens = 尾部的 tokens 之和`
  （生产路径等价于 `windowTokens - sum(前 5 行 tokens)`）。
- `sessionsInWindow <= 5` 时不生成余项行。
- 余项行不是会话，不得挂 `onOpenSession`，不得进入 Tab 顺序，不得有指针光标。

### 2.5 分母与恒等式

每行的精确占比：

```text
share = row.tokens / windowTokens
```

分母永远是 `attributeQuota` 返回的 `windowTokens`（来自 `block.totals`），
不是计划限额、不是「Top 5 自己的和」。生产路径里 `block` 与 `inputs` 出自同一批
记录，因此数据层面：

```text
sum(前 5 行 tokens) + 余项 tokens = windowTokens
sum(所有行的精确 share) = 1
```

**恒等式说的是 token 与精确占比。** 显示文本按 §3.4 四舍五入，允许合计与 100%
相差 0.1 到 0.3 个百分点；脚注必须把这件事写出来。任何实现不得为了凑显示整数
去改余项 token 值，也不得把余项写成「其他」这种容易被误解为类别的词。
单测允许手工造出 `block` 大于 `inputs` 的夹具，专门验证「分母不从行合计反推」；
那种夹具下 `sum(share)` 本来就不会是 1，不能拿它反证生产路径的口径错了。

### 2.6 空态：`sessionsInWindow === 0` 或 `windowTokens <= 0`

`attributeQuota` 是纯函数，不返回 `null`；它如实返回 `windowTokens`、
`sessionsInWindow`、`rows`、`remainder`。**渲染决策在组件**：

- `sessionsInWindow === 0` 时整块不渲染；
- `windowTokens <= 0` 时整块不渲染，即使有 0 token 的行也不画 0 行列表；
- 不存在「0 行空列表」「暂无数据」占位。

没有分母就没有比率，这条与全站的 `planNote` 立场一致。

## 3. 面板结构

### 3.1 容器

新增组件 `QuotaAttributionPanel`，根节点是一个有名字的 region：

```tsx
<section
  className={styles.attribution}
  aria-labelledby="attribution-title"
  data-probe="attribution-panel"
>
```

视觉沿用周层的「内嵌工具块」语言，不套 `Panel` 组件：

- `border: 1px solid var(--border)`
- `border-radius: var(--r-md)`
- `background: var(--bg-inset)`
- `padding: var(--sp-2) var(--sp-3)`
- `display: grid`
- `gap: var(--sp-1)`
- `min-width: 0`
- `align-self: center`

原因是它住在 `BillingWindowCard` 内部，和周层一样是「卡里的一个仪器块」，
不是页面级面板；再套一层 `.panel` 会变成卡片套卡片。

### 3.2 标题行与来源

标题行是单个 flex 行，固定顺序为：标题 → 来源圆点 → 分母脚注。

- `<h3 id="attribution-title" data-probe="attribution-title">本窗口消耗 Top 会话</h3>`
- `<ProvenanceBadge provenance="logged" />`
- 分母脚注 `data-probe="attribution-footnote"`，可见文本只放首句：
  `占比分母 = 本窗口总消耗（与表盘中心同一个数）。`

标题样式：`--fs-sm` / `--lh-sm` / 600 / `var(--text-secondary)`，不换行。
来源圆点只挂这一枚，行内不重复挂。脚注样式：`--fs-xs` / `--lh-xs` /
`var(--text-tertiary)`，`margin-left: auto`，`white-space: nowrap`，
`overflow: hidden`，`text-overflow: ellipsis`。

脚注的 `title` 与 `aria-label` 放完整版本，首句不变：

```text
占比分母 = 本窗口总消耗（与表盘中心同一个数）。精确占比之和恒为 100%；行内按 0.1% 四舍五入显示，合计可能与 100% 相差 0.1 到 0.3 个百分点。
```

这样屏幕上第一眼读到的是分母定义，完整口径仍在 DOM、悬停提示与读屏里，
不会因为面板宽度不足把第一句截掉。

### 3.3 会话行逐件结构

列表是 `<ol data-probe="attribution-list" aria-label="本窗口消耗最多的会话">`。
每个真实会话行是 `<li>` 里包一个整行 `<button type="button" data-probe="attribution-row">`。
行内顺序固定为四件：

| 位置 | 内容 | 锚点 | 样式要点 |
| --- | --- | --- | --- |
| 1 | 会话标题 | `data-probe="attribution-row-title"` | `minmax(0, 1fr)`，单行省略，`var(--text-secondary)` |
| 2 | 消耗数值 | `data-probe="attribution-row-token"` | `auto` 宽，右对齐，`var(--font-mono)`，`tabular-nums` |
| 3 | 占比条 | `data-probe="attribution-row-bar"` | 固定 56px x 6px，轨道 + 实色填充 |
| 4 | 占比百分比 | `data-probe="attribution-row-pct"` | 固定 56px，右对齐，`tabular-nums` |

行的 grid 固定为：

```css
grid-template-columns: minmax(0, 1fr) auto 56px 56px;
gap: var(--sp-2);
align-items: center;
padding: 0 var(--sp-1);
```

标题的截断规则固定为：

```css
min-width: 0;
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

行数据直接来自 `QuotaAttributionRow`：`row.title`、`row.tokens`、`row.share`、
`row.projectLabel`、`row.projectPath`、`row.path`、`row.messages`。完整标题不进
可见的第二行，只进行按钮的 `title` 与 `aria-label`。项目名的呈现同样不进第二行：
`formatProjectPath(row.projectLabel, row.projectPath)` 只出现在 `title` 与
`aria-label` 的 `项目：...` 里。完整 cwd、`/Users/...`、`~/.claude/...` 不得
出现在可见文本、`title`、`aria-label` 或探针事实里。

### 3.4 占比条画法

直接复用日志表与解析覆盖率 chip 的「占比」轨道语言，不新造图形：

- 轨道：`56px x 6px`，`background: var(--border-strong)`，
  `border-radius: var(--r-xs)`，`overflow: hidden`。
- 填充：`height: 100%`，`background: var(--chart-1)`，
  `border-radius: var(--r-xs)`，`width: ${exactShare * 100}%`。
- 非零保底：`min-width: 2px`。哪怕占比显示 `<0.1%`，只要 `row.tokens > 0`，
  条也必须在，不能画成空；`row.tokens === 0` 时没有填充，只剩轨道。
- 填充宽度用精确 `share`，不是四舍五入后的百分比文字。
- 余项行用同一条轨道，但填充取 `var(--chart-1-soft)`，用颜色档位提示
  「这是合并值，不是单个会话」。

### 3.5 行高与列表对账

行高固定为一个由令牌组成的表达式，不新造全局 token：

```css
height: calc(var(--row-pad-y-tight) * 2 + var(--lh-xs));
```

100% 字号下是 `4 + 16 + 4 = 24px`；130% 字号下随 `--lh-xs` 变成 28.8px。
行内文字用 `--fs-xs` / `--lh-xs`，条高 6px，永远单行。

列表 `gap: 0`。余项行与真实行同高，顶部 1px 分隔线用
`box-shadow: inset 0 1px 0 var(--border)` 画在行内，不占布局高度。这样：

```text
list.scrollHeight = 真实行数 * 行高 + (有余项 ? 行高 : 0)
```

门禁按这个等式对账，防止「假列表」：看起来有 5 行，实际容器高度对不上。

### 3.6 其余 N 个会话

余项行的 DOM 是 `<li data-probe="attribution-rest">`，里面不是 `<button>`。
可见文本固定为 `其余 {N} 个会话`，N 为 `sessionsInWindow - 5`。N 为 1 时也写
`其余 1 个会话`，不做单复数变化。

视觉上与真实会话行的区别必须同时满足：

- 行首文字是 `其余 N 个会话`，不是会话标题；
- 顶部有 1px 内阴影分隔线；
- 没有 hover 背景、没有焦点环、没有 `cursor: pointer`；
- 条填充是 `var(--chart-1-soft)`；
- 语义上不是按钮，不进入 Tab 顺序，不触发 `onOpenSession`。

余项行的可访问名就是可见文本加两个数值，不需要额外 `aria-label`：
`其余 N 个会话 12.3M tok 23.4%`。

## 4. 文案与数值格式

### 4.1 固定文案

| 位置 | 原文 |
| --- | --- |
| 面板标题 | `本窗口消耗 Top 会话` |
| 列表可访问名 | `本窗口消耗最多的会话` |
| 分母脚注可见首句 | `占比分母 = 本窗口总消耗（与表盘中心同一个数）。` |
| 余项行 | `其余 {N} 个会话` |
| 禁用行可访问名后缀 | `当前不可打开` |
| 打开行可访问名前缀 | `打开会话：` |

### 4.2 消耗数值

- 可见值：`formatTokenCount(tokens)`，后面追加半角空格与 `tok`。
- 例：`0`、`1,234 tok`、`1.2M tok`、`1.23B tok`。
- `title` 与 `aria-label` 用精确值：`tokens.toLocaleString("en-US") + " tok"`。
- 不用 `K`，不用 `k`，不用裸数字；全站已有 `tok` 后缀先例（压缩统计的累计丢弃）。

### 4.3 占比百分比

- `share = row.tokens / windowTokens`。
- 显示：`(share * 100).toFixed(1) + "%"`。
- `row.tokens === 0` 时显示 `0.0%`；非零但四舍五入到 `0.0%` 时显示 `<0.1%`，
  绝不把有消耗的会话显示成 `0.0%`。
- 正好 100% 显示 `100.0%`。
- 百分比文字右对齐、`tabular-nums`，固定 56px 列宽，130% 字号下也放得下。
- 本条百分比是「占本窗口消耗」，不是「占计划限额」。可见文案不得写「已用」，
  只写「占本窗口」。表盘的百分比弧是另一个分母，两者靠脚注与可访问名区分。

### 4.4 行可访问名与悬停提示

整行的 `aria-label` 与 `title` 使用同一句，避免视觉名与朗读名分叉。

可点行：

```text
打开会话：{title}（项目：{project}）· 本窗口消耗 {精确 token} tok · 占本窗口 {pctText}
```

禁用行：

```text
{title}（项目：{project}）· 本窗口消耗 {精确 token} tok · 占本窗口 {pctText} · 当前不可打开
```

分隔符固定为 ` · `（半角空格 + U+00B7 + 半角空格），与 `ThresholdsPanel.readoutTitle`
同一套。`{project}` 是 `formatProjectPath` 的结果，不是完整路径。

### 4.5 没有 `onOpenSession` 时的禁用表现

`row.path === ""` 或 `onOpenSession` 缺失时，行仍渲染为 `<button type="button">`，
但必须同时满足：

- 原生 `disabled` 属性为真；
- `aria-label` 以数据句结尾追加 ` · 当前不可打开`；
- CSS 固定 `opacity: 1`、`cursor: default`；
- 不出现 hover 背景；
- 不出现 focus-visible 焦点环；
- 不进入 Tab 顺序；
- `onClick` 完全不挂。

生产宿主 `AppShell` 始终传入 `onOpenSession`，所以这个状态只出现在单测与
手工挂组件的场景；单测必须同时断言「按钮存在、`disabled`、点击不触发回调」。

## 5. 边界与空态

| 场景 | 面板表现 |
| --- | --- |
| 窗口内 0 个有记录的会话，或 `windowTokens <= 0` | 整块不渲染，没有空列表 |
| 窗口内 1 个有记录的会话 | 1 行，占比 `100.0%`，条铺满，没有余项行 |
| 窗口内 2 到 5 个有记录的会话 | 每个会话 1 行，没有余项行 |
| 窗口内恰好 5 个 | 5 行，最后一个不是余项行；不得为了凑数生成 `其余 0 个会话` |
| 窗口内 6 个 | 5 行真实会话 + `其余 1 个会话`，总条目 6 |
| 窗口内超过 6 个 | 5 行真实会话 + `其余 N 个会话`，N = `sessionsInWindow - 5` |
| 窗口内有记录但 token = 0 | 行仍保留，显示 `0 tok`、`0.0%`、空条；排序在最后，可能落进余项 |
| 标题极长 | 仍占 1 行，CSS 省略号截断；完整标题在 `title` 与 `aria-label`；行高不变 |
| 占比极小 | 百分比显示 `<0.1%`；条至少有 2px 宽；仍参与排序与余项计数 |
| 无 `SessionMeta`（`path` 为空） | 行可见但禁用，标题回退为 `projectLabel`，不显示完整路径 |
| 同键输入出现两次 | 合并为一行，token 相加，绝不出现两行同一会话 |

## 6. 交互与可访问性

### 6.1 点击落点

- 可点行整行都是 `<button>`，点击任意位置都触发 `onOpenSession(session)`。
- 点击落点不是标题、不是条、不是百分比，而是 100% 宽的行按钮。
- 余项行没有按钮语义，点击不产生任何行为。

### 6.2 键盘

- 每个可点行是原生按钮，`Tab` 依次可达，`Enter` / `Space` 原生触发。
- v1 不做方向键在行间移动：最多 6 个条目，`Tab` 的成本可接受；
  引入 roving tabindex 与方向键会多一套状态，收益不足。
- 余项行与禁用行不进入 Tab 顺序。
- 焦点样式：`outline: 2px solid var(--accent); outline-offset: 1px;`。

### 6.3 悬停与焦点

- 悬停：行背景 `var(--bg-active)`；标题从 `var(--text-secondary)` 提到 `var(--text)`。
  这里刻意不用 `--bg-hover`，因为面板底是 `--bg-inset`，浅色主题下
  `--bg-hover` 与 `--bg-inset` 同为 `#f1f3f5`，悬停会完全不可见；`--bg-active`
  是下一级台阶，两套主题都可见。
- 过渡：`background-color var(--dur-hover) var(--ease-out)`。
- 悬停提示：`title` 是 §4.4 的整句，包含标题、项目名、精确 token 与占比。
- 条与百分比不单独做 tooltip，避免同一行出现两套读数。

### 6.4 读屏语义

- 面板：region，可访问名 `本窗口消耗 Top 会话`（来自 `aria-labelledby`）。
- 列表：list，可访问名 `本窗口消耗最多的会话`。
- 行：button，可访问名按 §4.4；条为 `aria-hidden="true"`。
- 来源圆点：沿用 `ProvenanceBadge`，可访问名 `数据来源：读自日志`。
- 分母脚注：可见首句，完整句在 `title` 与 `aria-label`，读屏拿到完整口径。

### 6.5 隐私

归因面板允许出现会话标题与项目目录名，不允许出现完整绝对路径、cwd、
`~/.claude/projects/...`、原始日志串。实现与探针都要遵守：

- 可见文本、`title`、`aria-label`、`data-*`、探针 JSON 里都不出现 `/Users/` 与
  `~/.claude`；
- React 的 `key` 可以用内部 `session.path`，但它不得写进 DOM 属性；
- 项目名只走 `formatProjectPath`，拿不到 cwd 时只去掉编码路径的前导 `-`，
  不猜第二段路径。

## 7. 状态表

| # | 状态 | 面板 | 行数 | 交互 |
| --- | --- | --- | --- | --- |
| 1 | 无有记录会话，或 `windowTokens <= 0` | 不渲染 | 0 | 无 |
| 2 | 1 个有记录的会话 | 渲染 | 1 | 有回调且 `path` 非空则可点 |
| 3 | 2 到 5 个有记录的会话 | 渲染 | N | 每行可点 |
| 4 | 恰好 5 个 | 渲染 | 5 | 无余项行 |
| 5 | 6 个 | 渲染 | 5 + 余项 1 | 余项不可点 |
| 6 | 超过 6 个 | 渲染 | 5 + 余项 N | 余项不可点 |
| 7 | 标题极长 | 渲染 | 不变 | 省略号，完整标题在提示里 |
| 8 | 占比极小 | 渲染 | 不变 | `<0.1%` + 2px 条 |
| 9 | 无 `onOpenSession` | 渲染 | 不变 | 行禁用，无悬停无焦点 |
| 10 | 输入无 `SessionMeta`（`path` 为空） | 渲染 | 不变 | 行禁用，标题回退项目名 |

表里没有的文案与状态不许出现在实现里。

## 8. 真机 GUI 门禁锚点

### 8.1 稳定锚点（不依赖 CSS Module 哈希类名）

| 锚点 | 挂在哪个元素 | 用途 |
| --- | --- | --- |
| `data-probe="attribution-panel"` | 面板 `<section>` | 面板几何、含于计费卡 |
| `data-probe="attribution-title"` | `<h3>` | 标题在场 |
| `data-probe="attribution-footnote"` | 脚注 `<span>` | 分母口径在场 |
| `data-probe="attribution-list"` | `<ol>` | 列表总高对账 |
| `data-probe="attribution-row"` | 每个真实会话的整行 `<button>` | 行数、行高、点击目标 |
| `data-probe="attribution-row-title"` | 行内标题 `<span>` | 点击前记住目标标题 |
| `data-probe="attribution-row-token"` | 行内 token `<span>` | 数值在场 |
| `data-probe="attribution-row-bar"` | 行内填充 `<span>` | 条宽与占比对应 |
| `data-probe="attribution-row-pct"` | 行内百分比 `<span>` | 百分比在场 |
| `data-probe="attribution-rest"` | 余项 `<li>` | 余项不是会话 |

ARIA 标签同样固定：

- 面板 region：`本窗口消耗 Top 会话`
- 列表 list：`本窗口消耗最多的会话`
- 可点行 button：以 `打开会话：` 开头
- 禁用行 button：以 `当前不可打开` 结尾

### 8.2 探针必须收集的事实

`gui_probe` 新增一个 `facts.attribution` 分支，只收集事实，不含阈值与判定：

- `panelRect`、`listScrollHeight`、`listClientHeight`
- `rowCount`、`rowHeights[]`、`titles[]`、`tokens[]`、`pcts[]`
- `barFillWidths[]`、`barTrackWidths[]`
- `hasRest`、`restRect`、`restText`
- `footnoteText`、`footnoteTitle`

锚点全部用 `querySelector('[data-probe="..."]')`，行内事实用
`row.querySelector('[data-probe="attribution-row-title"]')` 取，不碰类名。

### 8.3 门禁判据

判定逻辑写在 `scripts/gui-test.sh` 的 Python 段，至少覆盖：

1. **真列表对账**：
   `listScrollHeight` 必须等于 `sum(rowHeights) + (hasRest ? restRect.height : 0)`，
   误差不超过 1px。行高期望值按 `8 + 16 * font_scale` 计算，不写死 24，
   这样 130% 字号档也能对账。
2. **点击真的打开会话**：
   默认清单在 `用量总览`、`视图=用量` 之后插入
   `点选=[data-probe='attribution-row']`。脚本先记住点击前 `titles[0]`，
   点击后断言会话分析页当前会话标题与它逐字相等；不能只断言「页面没崩」。
3. **点击后必须回到用量页再滚动**：
   点行会切到会话分析页；后续 `滚动=main` 与用量面板可达性断言之前，
   必须再点一次「用量总览」并 `视图=用量`，否则判定会跑在错误页面。
4. **余项不是会话**：
   `hasRest` 为真时 `rowCount === 5`，`restText` 匹配 `其余 (\d+) 个会话`，
   且余项行没有 button 元素、没有焦点环。
5. **面板含于计费卡**：
   `panelRect` 必须完整落在 `billing.card` 内，且与周层矩形无重叠。
6. **分母脚注在场**：
   `footnoteText` 必须恰好是 `占比分母 = 本窗口总消耗（与表盘中心同一个数）。`，
   `footnoteTitle` 必须包含完整版口径。
7. **隐私**：
   面板可见文本与探针 JSON 中不得出现 `/Users/`、`~/.claude`、`cwd`。

## 9. 验收矩阵

| 层 | 用例 | 断言要点 |
| --- | --- | --- |
| 纯函数单测 | 跨窗口会话 | 两个窗口各拿一段；把 `<= end` 变异后必须红；现有 `quotaAttribution.test.ts` 已覆盖 |
| 纯函数单测 | 恰好落在 `end` 的记录 | 属于下一块，不属于当前块；现有测试已覆盖 |
| 纯函数单测 | 5 / 6 / 8 个窗口内会话 | 5 行、5 行 + 余项；余项 N 与 token 和对；现有测试已覆盖 |
| 纯函数单测 | 恒等式 | 生产路径行 token 之和 + 余项 = `windowTokens`；精确 share 之和为 1 |
| 纯函数单测 | 分母唯一 | 手工 block 大于 inputs 时共享 `windowTokens`，不从行合计反推；现有测试已覆盖 |
| 纯函数单测 | 去重 | 同 path 两份输入合并为一行；无元数据输入不按项目名合并 |
| 纯函数单测 | 排序 | token 降序；并列按标题、path 依次 `localeCompare` 稳定 |
| 纯函数单测 | 极小占比 | 非零 share 但显示 `<0.1%`；条宽非零 |
| 纯函数单测 | 分母为 0 | 不产生 NaN；组件读到 `windowTokens <= 0` 时整块不渲染 |
| 组件单测 | 标题 / 列表名 / 来源 | region、list、`读自日志` 都在 |
| 组件单测 | 点击 | 点行调用 `onOpenSession(session)`；无回调或 `path === ""` 时 `disabled` 且不触发 |
| 组件单测 | 余项 | `其余 1 个会话` 不是 button，不可点 |
| 组件单测 | 长标题 | DOM 文本完整；样式含 overflow / ellipsis / nowrap |
| 组件单测 | 隐私 | `textContent`、`title`、`aria-label` 不含 `/Users/`、`~/.claude` |
| e2e | 用量页首屏 | 面板可见、至少 1 行、行内有百分比 |
| e2e | 点行 | 切到会话分析并打开对应会话 |
| e2e | 超过 5 个会话的夹具 | 出现 `其余 N 个会话`；5 个及以下不出现 |
| e2e | 首屏红线 | 原有「1440 x 900 三块面板标题在首屏」保持绿 |
| e2e | 主题 / 溢出 | 浅色与深色均无横向溢出，面板不遮周层与历史条 |
| GUI 真机 | 行数与行高对账 | §8.3 第 1 条 |
| GUI 真机 | 点行打开会话 | §8.3 第 2、3 条 |
| GUI 真机 | 面板与脚注 | §8.3 第 4、5、6、7 条 |
| 截图 | `usage-*` 重出 | 浅色 / 深色 / WebKit 三份都覆盖新面板 |

命令按仓库规范执行：`npm --prefix web test`、`npm --prefix web run build`、
`npm --prefix web run test:e2e`、`./scripts/gui-test.sh --build`、`./scripts/lint.sh`，
以及改动 `src-tauri` 探针后的 `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、
`cargo test`。

## 10. v1 不做什么

- 不做周窗口归因。周层仍然是「只显示消耗 + 可选自设预算」，不套用这套 Top 5。
- 不按模型、工具、记录类别再切一层。行是会话级；再切会引入第二套分母与第二套交互。
- 不做并发推断。日志是已经发生的事实，面板不猜「现在正在跑什么」。
- 不做联网、上传、遥测、云端口令或任何数据出本机的能力。
- 不做可配置 Top N。v1 固定 5；配置项会引入新的偏好、文案与截图分支。
- 不做折叠。理由见 §1.3。
- 不做成本归因。面板只归因 token；把定价快照折成美元会引入估算层，
  与「表盘中心同一个数」的分母冲突。
- 不做计划限额占比。表盘的有预算弧是相对计划限额；本面板的百分比是相对本窗口消耗，
  两者分母不同，文案与脚注必须把这件事说死。
- 不做完整路径、cwd、原始日志串的展示或探针输出。

## 11. 实现者清单

1. **纯函数**：工作区已有 `web/src/features/usage/quotaAttribution.ts` 与
   `quotaAttribution.test.ts`，实现 §2 的合并、过滤、排序、Top 5、余项与
   `windowTokens`；UI 实现只消费 `attributeQuota`，不得在组件里重算窗口或分母。
2. **纯函数单测**：以上现有文件已覆盖 §9 的纯函数条；若 UI 实现发现缺口，
   只补 `quotaAttribution.test.ts`，不改口径。
3. **组件**：新增 `web/src/features/usage/QuotaAttributionPanel.tsx` 与
   `.module.css`，按 §3 / §4 的结构、锚点、行高、轨道具实现。
4. **组件单测**：新增 `QuotaAttributionPanel.test.tsx`，覆盖 §9 的组件条；
   样式断言照 `LogView.test.tsx` 读 CSS 文件的判法，不依赖 jsdom 布局。
5. **接入卡片**：改 `BillingWindowCard.tsx`，在 `.weekly` 之后、`history` 之前
   插入组件，传 `block={active}` 与 `inputs={inputs}`，不传第二份分母；
   给 `BillingWindowCard` 增加 `onOpenSession` prop；
   `UsageOverviewPage.tsx` 把已有的同一个回调同时传给 `BillingWindowCard`
   与 `CompactionStatsPanel`，不新开跳转路径。
6. **布局**：改 `BillingWindowCard.module.css`，新增 `.attribution` 的
   `flex: 2 1 520px`，把 `.history` 改成 `flex: 1 1 100%`；保留其他既有画法。
7. **e2e**：扩展 `web/e2e/billing-window.spec.ts` 或新增
   `web/e2e/attribution.spec.ts`，按 §9 的 e2e 条写；超过 5 个会话的夹具
   单独造，别污染 `recentActivityScenario` 的既有计数。
8. **GUI 探针**：在 `src-tauri/src/lib.rs` 的 `gui_probe::PROBE_JS` 里收集
   `facts.attribution`，只用 §8.1 的 `data-probe` 锚点。
9. **GUI 判定**：在 `scripts/gui-test.sh` 的 Python 段实现 §8.3 的七条判据，
   并在默认清单 `用量总览`、`视图=用量` 后插入点击步，点击后补回
   `用量总览` 与 `视图=用量` 再执行原有滚动步。
10. **截图**：`cd web && SCREENSHOTS=1 npx playwright test screenshots` 重出
    `usage-light.png` / `usage-dark.png` / `usage-below-*` 与 WebKit 后缀份；
    按仓库既有流程只保留本轮相关图，`manifest.json` 交给 teardown 生成。
11. **文档**：`CHANGELOG.md` 的 `[Unreleased]` 加一条中文 `Added`；
    `README.md` 与 `README.zh-CN.md` 各加一条功能描述；`docs/USAGE.md`
    在「用量总览」下补一小节，写清分母、Top 5、余项与点行打开会话。
12. **验收命令**：跑 §9 的全部命令；`./scripts/lint.sh` 在本机若只差 zizmor，
    按既有说明记录；真机门禁必须真的启动打包后的 `.app`，并亲自看
    `usage-*` 浅色 / 深色截图与 `attribution` 探针 JSON。

清单里没有的字符串、锚点、行数或降级路径不许进入实现。
