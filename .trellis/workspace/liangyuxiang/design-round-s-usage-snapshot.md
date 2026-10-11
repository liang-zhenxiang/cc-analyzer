# 「用量总览导出为单文件 HTML 快照」设计与版式规格（Round S）

> 角色：UI/UX 产品设计师（桌面工具 / 仪器面板，数据可视化与文档排版方向）
> 日期：2026-10-11 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（已锁定，引用 Issue #149 维护者评论的冻结契约，不在本文件重开）：用量总览导出为
> **一张独立 HTML 文档**（零脚本、零外链资源、自包含），换机器、发给同事或在归档里长期保留。
> 本文件只描述版式与视觉，以及应用内入口按钮的位置与状态；**口径句、包含 / 不含声明、
> 页脚措辞逐字沿用 Issue #149 与既有 `exportHtml.ts`**，本文件不改写它们。

---

## 0. 语境与现状（写前逐字读过）

读过：`gh issue view 149 --comments`（契约，权威）、`web/src/features/sessions/exportHtml.ts`
与 `exportHtml.test.ts`（同族文档的既有视觉语言与既有判据）、`exportTypes.ts`（`REPO_URL`、
文件名规则、`EXPORT_MAX_RECORDS`）、`ExportDialog.tsx`（保存路径 + 就地状态）、
`UsageOverviewPage.tsx` / `.module.css`、`BillingWindowCard.tsx` / `.module.css`、
`charts/{BarChart,HBarChart,StackedBar,Heatmap,Gauge}.tsx` 与 `chartPrimitives.tsx`、
`ProvenanceBadge.tsx` / `provenance.ts`、`usageAggregations.ts`、`billingWindow.ts`、
`weeklyWindow.ts`、`quotaAttribution.ts`、`pricingSnapshot.ts`、`lib/format.ts`、
`styles/tokens.css`、`components/{Button,StatusToast,Panel}.tsx`、
`scripts/gui-test.sh` 的用量页判定段、`src-tauri/src/lib.rs` 的 `gui_probe`，
以及 `docs/screenshots/usage-light.png`、`usage-below-light.png`、`usage-below-dark.png`。

**#149 冻结事实（后文只在此范围内展开）：**

- 复用既有导出管线：`escapeHtml`（从 `exportHtml.ts` 导出）、`formatTokenCount` /
  `formatUsd` / `formatDateTime` / `formatDayLabel`、`bridges.dialog.savePath` →
  `bridges.fs.writeText`；文件名 `cc-analyzer-usage-<YYYY-MM-DD>.html`。
- 数字一律取自页面手上那份 `range` / `inputs` / `now`，**生成器里不许重算窗口或加总**。
- 快照**有**：元数据（生成时刻 / 区间 / 应用版本 / 定价快照日期）、KPI 行（Tokens 总量 /
  会话数 / 消息数 / 估算成本）、每日趋势、按项目分布、按模型分布、活跃时段热力图、
  两层限额（5 小时窗口 + 滚动 7 天）、本窗口消耗 Top 会话、口径脚注、页脚。
- 快照**没有**：工具与 skill 普查、压缩统计、错误档 —— 这一条必须在文档里显式写一行。
- 隐私与自包含是红线：可见文本只出现项目目录名；所有插值过 `escapeHtml`；产物里不出现
  `<script`、`<link`、`src=`、`@import`、`url(http`；唯一外链是页脚指向本仓库的 `<a href>`。
- 应用入口：用量页头部加「导出快照」按钮，只在「用量」档出现；点击 → 系统保存对话框 →
  写单文件；取消不算失败、不写文件；成功给一条 toast；写失败就地明说原因。

### 0.1 本规格定死的数值（实现者一眼版）

| 项 | 定死值 |
| --- | --- |
| `.sheet` 宽度 / 内边距 | `max-width: 960px` / `padding: 32px`；`body` padding `32px 16px` |
| 内容盒宽度 | 896px（960 − 2×32）——所有图表、表格按这个宽度排 |
| 区块间距 | 每个 `.block` `margin-top: 32px`；`h2` `margin-bottom: 8px` |
| KPI 列数 | `4`（`repeat(4, minmax(0, 1fr))`，格间 1px 竖分隔线） |
| 图表 viewBox | 趋势 / 项目 / 模型：`720 × 高度`（页面的原生设计宽度）；热力图 `556 × 174` 且宽 556px 不放大 |
| 表盘 | 112px（`--gauge-size-compact` 档），`viewBox 0 0 120 120`、`stroke 10` |
| 区块标题 | 逐字用页面 Panel 标题：`每日 Token 消耗` / `按项目分布` / `按模型分布` / `活跃时段（周 × 小时）` / `本窗口消耗 Top 会话` |
| Top 会话行数 | `5` + 余项行（`其余 N 个会话`），条目上限 6；占比条 56×6 |
| 入口按钮 | 用量页页头右簇最右端，可见文案 `导出快照`，可访问名 `导出用量快照（单文件 HTML）` |
| 入口锚点 | `data-probe="usage-snapshot-export"`（按钮）；`data-probe="usage-progress"`（进度文本，供不重叠判定） |
| 扫描中 | **禁用**（`disabled={scanning}`），title 说明原因 |
| 打印 | 强制浅色 + 不腰斩区块 + 表头跨页重复；**不画页码、不写 `@page` 边距** |
| 深色 | `@media (prefers-color-scheme: dark)`，镜像 `tokens.css` 深色段 |

### 0.2 与工作区在建实现的对接（命名对齐，避免两套名字）

写本规格时工作区已有一份在建实现 `web/src/features/usage/usageSnapshot.ts`
（导出 `UsageSnapshotInput` / `usageSnapshotHtml(input)` / `usageSnapshotFileName(now)` /
`SNAPSHOT_TITLE` / `SNAPSHOT_EMPTY_TEXT` / `SNAPSHOT_SCOPE_NOTE`）。**规格沿用这组名字与签名，
不另起一套**；下面六条是规格对在建候选的**定稿覆盖**，实现者按本规格改，不需要再回问：

| # | 在建候选 | 本规格定稿 | 理由 |
| --- | --- | --- | --- |
| 1 | `SNAPSHOT_TITLE = "用量总览快照"` | `"用量总览"` | 与页面 `aria-label` / 侧栏标签逐字一致；「快照」由 `<title>`、文件名与页脚三处已经说清 |
| 2 | `SNAPSHOT_EMPTY_TEXT`（带 `TODO(design)` 的占位） | 第 6.2 节的两句（标题 + 正文） | 占位句没有标题、也没交代「这是事实不是渲染失败」 |
| 3 | 空态仍渲染 KPI 四个 0 | 空态**删掉读数带**（第 6 节） | 没有记录时成本是「未知」不是 `$0.00`；四个 0 会被读成真实数据 |
| 4 | 限额节标题 `限额读数`、5 小时层只有一行 `facts` | 标题 `计费窗口`；5 小时层带表盘 + 2×2 读数 + 弧下百分比句（5.2） | 表盘是这张卡的身份；纸面必须写出弧的比例，否则一圈弧没有刻度 |
| 5 | Top 会话表只有「占比」文字 | 加 56×6 占比条列（5.4） | 与日志表、归因面板同一条占比条语言 |
| 6 | 打印块只刷背景 | 打印块重声明整套浅色（2.3） | 深色系统下打印会得到白纸上的浅灰字 |

另外两处**在建候选更好，纳入定稿**：Top 会话表保留「项目」列（页面只把它放进
`aria-label`，纸面上收件人看不到悬停，项目名必须可见，见 5.4）；周层保留 `活跃天数`
这个读数（`weeklyWindow` 已经算出来，纸面多一列事实没有成本，见 5.3）。
`SNAPSHOT_SCOPE_NOTE` 里「不含工具与 skill 普查、压缩统计、错误档」逐字保留，「数字取自当时
的聚合结果、生成时未重算」这半句一并保留 —— 它正好回答「这数会不会随页面变动」，
与第 1.3 节的定稿句子合并成一条说明条。

---

## 1. 文档骨架与顺序

### 1.1 逐行骨架（实现者照抄）

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>CC Analyzer 用量快照 · 近 30 天</title>
  <style>{{STYLE}}</style>
</head>
<body>
  <main class="sheet">
    <header class="head">
      <span class="wordmark">{{WORDMARK_SVG}} CC Analyzer</span>
      <h1>用量总览</h1>
      <p class="meta">区间 <code>近 30 天</code> · 生成于 2026-10-11 10:20 · CC Analyzer v0.18.0 · 定价快照 <code>2026-10-01</code></p>
      <p class="coverage">本快照包含用量总览的读数与图表；不含工具与 skill 普查、压缩统计、错误档。</p>
    </header>

    <dl class="readouts">
      {{4 个 readout，标签带 sup 上标 1 / 2}}
    </dl>
    <p class="readouts-note">¹ Tokens 总量、会话数、消息数读自本机日志；² 估算成本按定价快照（2026-10-01）折算，不是账单。</p>

    <section class="block">
      <h2>每日 Token 消耗</h2>
      <figure class="figure">{{趋势 SVG，viewBox 720×170}}</figure>
      <p class="caption">每根柱 = 一个自然日（本地时区）；纵轴为四类 token 之和（与上方「Tokens 总量」同一个口径）。</p>
    </section>

    <section class="block">
      <h2>按项目分布</h2>
      <figure class="figure">{{横向条 SVG，viewBox 720×(4+n×26+4)}}</figure>
    </section>

    <section class="block">
      <h2>按模型分布</h2>
      <figure class="figure">{{堆叠条 SVG，viewBox 720×30}}</figure>
      <ul class="legend">{{每条：色块 + 名称 + 数值}}</ul>
    </section>

    <section class="block">
      <h2>活跃时段（周 × 小时）</h2>
      <div class="heat">{{热力图 SVG，556×174}} 加色阶图例</div>
    </section>

    <section class="block">
      <h2>计费窗口</h2>
      <h3>5 小时窗口</h3>
      <div class="window">{{表盘 + 2×2 读数}} 加计划说明行</div>
      <h3>滚动 7 天</h3>
      <div class="weekly">{{读数 + 可选预算条}}</div>
      <p class="note">滚动 7 天累计，不是官方重置窗口，两者不逐分钟吻合</p>
      <h3>本窗口消耗 Top 会话 <span class="note">占比分母 = 本窗口总消耗（与表盘中心同一个数）。</span></h3>
      <div class="table-wrap"><table>{{会话 / 本窗口消耗 / 占比条 / 占比}}</table></div>
    </section>

    <footer class="foot">
      <p>本快照由 CC Analyzer 生成，数据未上传至任何服务器。</p>
      <p>CC Analyzer v0.18.0 · <a href="{{REPO_URL}}" rel="noreferrer">github.com/liang-zhenxiang/cc-analyzer</a></p>
      <p>快照生成于 2026-10-11 10:20</p>
    </footer>
  </main>
</body>
</html>
```

**文档里 `href="` 只能出现一次**（页脚仓库链接），与 `exportHtml.test.ts` 的既有判据同款。
`<sup>` 是本快照唯一的富文本标记；不用 `<abbr>`（打印出来的缩写没有解释），不用 tooltip 承载信息。

### 1.2 顺序，以及为什么不照抄页面

页面的 DOM 顺序是「计费窗口卡 → KPI 行 → 三张图 → 热力图 → 工具普查 → 压缩统计」：
那是**实时仪表**的顺序，最上面放的是现在正在发生的事。快照是**摘要文档**，读法必须反过来：

1. 这是什么、什么时候生成的（head + 包含声明）；
2. 结论（KPI 四个读数）；
3. 分布与节奏（趋势 → 项目 → 模型 → 热力图）；
4. 过程与明细（两层限额 → 本窗口 Top 会话）；
5. 出处与限制（脚注 + 页脚）。

这条顺序与 Issue #149 的内容清单逐项对应，不新增、不省略、不换位。**唯一允许的顺序差异
就是上面这一条**：KPI 上移、计费窗口下移。收件人打开文件先看到的是「这段时间用了多少」，
而不是「五分钟前那个窗口还剩多久」。

### 1.3 标题、元数据行、包含声明

- `<title>`：`CC Analyzer 用量快照 · 近 30 天`（浏览器标签页与「另存为」建议名都用它；
  区间跟随实际档位，`近 7 天` / `近 30 天` / `近 90 天`）。
- `h1`：`用量总览` —— 逐字用页面 `aria-label="用量总览"` 与侧栏标签，不写成「用量报告」。
- 元数据行（`.meta`，11px/16px tertiary，`code` 用 `--font-mono`）四段，顺序固定：
  1. `区间 <code>近 30 天</code>`
  2. `生成于 <formatDateTime(generatedAt)>`
  3. `CC Analyzer v<appVersion>`
  4. `定价快照 <code>{PRICING_AS_OF}</code>`
  分隔符统一 ` · `；缺应用版本号时整段省略（不留一个孤零零的 `v`）。
- 包含声明（`.coverage`）**逐字**：`本快照包含用量总览的读数与图表；不含工具与 skill 普查、压缩统计、错误档。`
  其中 `不含工具与 skill 普查、压缩统计、错误档` 来自 Issue #149 的原句，不得改写。

  形态：一条内嵌说明条（`background: var(--inset)`、1px `var(--border)`、`border-radius: 4px`、
  `padding: 8px 10px`、11px/16px、`--text-secondary`）。它**不是警告**：不用 `--warning`、
  不用图标、不用「注意」开头 —— 它是这份文档的自述，语气与页脚一致。

### 1.4 尺寸与留白

```css
body { margin: 0; padding: 32px 16px; background: var(--bg); color: var(--text);
       font-family: var(--font-sans); font-size: 13px; line-height: 20px; -webkit-font-smoothing: antialiased; }
.sheet { max-width: 960px; margin: 0 auto; padding: 32px; border: 1px solid var(--border);
         border-radius: 8px; background: var(--surface); }
.head { display: flex; flex-direction: column; gap: 12px; }
.block { margin-top: 32px; }
h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; line-height: 20px; }
h3 { margin: 16px 0 8px; font-size: 12px; font-weight: 600; line-height: 18px; color: var(--text-secondary); }
.foot { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border);
        color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.foot p { margin: 0; } .foot p + p { margin-top: 4px; } .foot a { color: var(--accent); }
```

间距全部落在 `exportHtml.ts` 同一套档位上（4 / 8 / 12 / 16 / 32），**不新造数值**。
`.sheet` 的 960px、32px 内边距、8px 圆角、`body` 的 `32px 16px` 与 `exportHtml.ts` 逐字相同 ——
两张文档并排放在一起时，它们必须是同一张信纸的两个版次。

### 1.5 排版标尺（字号 / 行高 / 字重）

| 角色 | 字号 / 行高 | 字重 | 颜色 token |
| --- | --- | --- | --- |
| wordmark | 15 / 22 | 600 | `--text` |
| h1 | 20 / 28 | 600 | `--text` |
| h2 | 13 / 20 | 600 | `--text` |
| h3 | 12 / 18 | 600 | `--text-secondary` |
| KPI 数值（`.readout dd`） | 20 / 28 + `tabular-nums` | 600 | `--text` |
| 表格读数与正文 | 13 / 20 | 400 | `--text` |
| 标签 / 轴刻度 / 元数据 / 脚注 | 11 / 16（表头 500） | 400 | `--text-tertiary` |
| SVG 轴刻度与图例 | 11（原生，不随容器缩放） | 400 | `--text-tertiary` |

**快照的字号不跟随应用内的 `--font-scale`**：界面字号缩放是使用者在屏幕上的偏好，与传给同事的
文件无关；文档自己的标尺在两张文档之间必须一致。`--font-scale` 不出现在快照的样式里。

---

## 2. 视觉系统：镜像哪些令牌

### 2.1 浅色段（常量，镜像 `tokens.css`；沿用 `exportHtml.ts` 的镜像方式）

| 快照变量 | 值 | 来源 token |
| --- | --- | --- |
| `--bg` | `#f4f5f7` | `--bg` |
| `--surface` | `#ffffff` | `--bg-subtle` / `--bg-elevated` |
| `--inset` | `#f1f3f5` | `--bg-inset` |
| `--text` | `#16181b` | `--text` |
| `--text-secondary` | `#4a5260` | `--text-secondary` |
| `--text-tertiary` | `#6b7381` | `--text-tertiary` |
| `--border` | `rgba(16, 24, 40, 0.1)` | `--border` |
| `--border-strong` | `rgba(16, 24, 40, 0.18)` | `--border-strong` |
| `--accent` | `#2952cc` | `--accent` |
| `--danger` | `#b3261e` | `--danger` |
| `--warning` | `#946200` | `--warning` |
| `--chart-1` | `#2f6b9f` | `--chart-1` |
| `--chart-1-soft` | `rgba(47, 107, 159, 0.24)` | `--chart-1-soft` |
| `--chart-2` | `#0f7f8f` | `--chart-2` |
| `--chart-2-soft` | `rgba(15, 127, 143, 0.24)` | `--chart-2-soft` |
| `--chart-3` | `#618428` | `--chart-3` |
| `--chart-3-soft` | `rgba(97, 132, 40, 0.24)` | `--chart-3-soft` |
| `--chart-4` | `#a67a08` | `--chart-4` |
| `--chart-4-soft` | `rgba(166, 122, 8, 0.24)` | `--chart-4-soft` |
| `--chart-5` | `#8a6fd4` | `--chart-5` |
| `--chart-5-soft` | `rgba(138, 111, 212, 0.24)` | `--chart-5-soft` |
| `--chart-6` | `#bf4a78` | `--chart-6` |
| `--chart-6-soft` | `rgba(191, 74, 120, 0.24)` | `--chart-6-soft` |
| `--font-sans` / `--font-mono` | 与 `exportHtml.ts` 逐字相同 | `--font-sans` / `--font-mono` |

`--chart-*` 是 `exportHtml.ts` 里**没有**的一层（会话报告不含图表），必须在本快照的常量块里
补齐 6 色 ×（实色 + soft）共 12 个值；值直接抄 `tokens.css`，不许微调。

### 2.2 深色段（`prefers-color-scheme`）

```css
:root { color-scheme: light dark; }
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0f12; --surface: #1a1d21; --inset: #0a0b0d;
    --text: #f0f2f5; --text-secondary: #b4bcc6; --text-tertiary: #8b939e;
    --border: rgba(255, 255, 255, 0.07); --border-strong: rgba(255, 255, 255, 0.14);
    --accent: #7fa8ff; --danger: #f0776c; --warning: #e0a33e;
    --chart-1: #82b5e8; --chart-1-soft: rgba(130, 181, 232, 0.3);
    --chart-2: #55bfce; --chart-2-soft: rgba(85, 191, 206, 0.3);
    --chart-3: #8ec45c; --chart-3-soft: rgba(142, 196, 92, 0.3);
    --chart-4: #edc14e; --chart-4-soft: rgba(237, 193, 78, 0.3);
    --chart-5: #c398ec; --chart-5-soft: rgba(195, 152, 236, 0.3);
    --chart-6: #ef8ab3; --chart-6-soft: rgba(239, 138, 179, 0.3);
  }
}
```

映射与 `exportHtml.ts` 深色段逐值相同（它已经镜像过一遍，这里是同一条规则的延续）；
`<meta name="color-scheme" content="light dark">` 与 `color-scheme: light dark` 两处都要有 ——
少了 `<meta>`，WebKit 里滚动条与表单控件会停在浅色，与文档主体分裂。

**深色是「跟随系统」，不提供档位切换**：没有开关、没有查询参数、没有 `localStorage`。
文档要能被原样转发，多一个状态就多一种收件人看到的版本。

### 2.3 打印（`@media print`）

```css
@media print {
  /* 强制整套浅色：深色系统上打印，只把背景刷白会得到「白纸上的浅灰字」。 */
  :root { /* 完整浅色段，逐值重声明 */ }
  body { padding: 0; background: #ffffff; }
  .sheet { max-width: none; padding: 0; border: 0; border-radius: 0; }
  h1, h2, h3 { break-after: avoid; }
  .readouts, .figure, .heat, .table-wrap, .window, .weekly, .coverage { break-inside: avoid; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .foot a { color: inherit; text-decoration: none; }
}
```

三条裁决，理由写在这里以免后人反复：

1. **必须重声明整套浅色，而不是只改 `--bg` / `--surface`。** 现有的
   `exportHtml.ts` 打印块只刷白背景：如果用户在深色系统下打印，`prefers-color-scheme: dark`
   通常仍然生效，文字会保持 `#f0f2f5` 落在白纸上 —— 几乎不可读。本快照不留这个坑
   （会话报告那处属于既有行为，不在本轮改动范围）。
2. **不画页码、不写 `@page`。** 页码要靠 `@page` 的边距盒计数器，浏览器实现既不统一也不
   可靠；用固定的「第 X 页」文本伪造页码，一旦用户改了缩放或纸张就会说谎。打印边距也是
   用户在打印对话框里的设置，文档不该去覆盖它。跨页后的定位靠区块标题与页脚的生成时刻。
3. **不腰斩**：图表、读数带、表格容器整块 `break-inside: avoid`；长表格（本快照最多 6 行，
   给未来留出）靠 `thead` 重复表头。`h1/h2/h3` 后 `break-after: avoid`，标题不落单页尾。

---

## 3. KPI 区

### 3.1 结构与尺寸

复用 `exportHtml.ts` 的读数带语言，列数从 5 改为 4：

```css
.readouts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 4px;
            padding: 12px 16px; border: 1px solid var(--border); border-radius: 4px; background: var(--inset); }
.readout { display: flex; flex-direction: column; gap: 2px; padding: 0 12px; }
.readout + .readout { border-left: 1px solid var(--border); }
.readout dt { color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.readout dd { margin: 0; color: var(--text); font-size: 20px; font-weight: 600; line-height: 28px;
              font-variant-numeric: tabular-nums; }
.readouts-note { margin: 4px 0 0; padding: 0 4px; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
```

四格顺序固定：`Tokens 总量` → `会话数` → `消息数` → `估算成本`（与页面逐字、逐序相同）。
数值取 `range.kpi.tokens` / `range.kpi.sessions` / `range.kpi.messages` / 成本估算，
格式分别走 `formatTokenCount` / `toLocaleString("en-US")` / `toLocaleString("en-US")` /
`formatUsd`。

### 3.2 来源在纸面上怎么表达（禁 tooltip）

页面上每个读数挂一枚 `ProvenanceBadge` 圆点（`title` + `aria-label` 承载整句话）。**圆点在
纸上不可用**：它没有旁注就是一枚没有图例的色点，黑白打印后连颜色也没了；`title` 在纸面
完全不存在。因此快照改用**同一个文档内的静态标记**：

- 标签写成 `Tokens 总量` + `<sup>1</sup>`、`会话数` + `<sup>1</sup>`、`消息数` + `<sup>1</sup>`、
  `估算成本` + `<sup>2</sup>`（上标用 `<sup>`，字号继承 `dt` 的 11px，不另设颜色）。
- 整条带子下方紧接一行 `.readouts-note`，把两枚上标就地解释掉（不在文末排队、不要求翻页）：

  `¹ Tokens 总量、会话数、消息数读自本机日志；² 估算成本按定价快照（2026-10-01）折算，不是账单。`

  这句话的字来自页面 KPI 带下方那句脚注，**逐字不改**，只是把两枚上标钉在各自的半句前
  （页面原句：`Tokens 总量、会话数、消息数读自本机日志；估算成本按定价快照（…）折算，不是账单。`）。
- 成本含未收录定价的模型时，句尾追加页面同款：` 部分会话未知价 · 约 {formatTokenCount(n)} tok 未计入`，
  且成本数值改显 `未知`（`--text-tertiary`、不加粗）—— **绝不显示 `$0.0000`**。
- 不出现「读自日志」/「估算」的彩色 chip；档位只由文字表达。快照是给人读的纸，
  不是给屏幕扫的仪表。

### 3.3 0 值与缺值

- 正常空窗（区间内有会话但 token 为 0）：照常画带子，数值按实际值写。
- 成本未知：数值位置写 `未知`（tertiary、400），`.readouts-note` 里说明原因，不写 `$0.00`。
- 整篇空态（区间内 0 会话）不进这条带子，见第 6 节。

---

## 4. 图表区

### 4.1 通则（先定这四条，四张图都照它）

1. **零交互、零依赖**：全部内联 SVG，只使用 `rect` / `line` / `text` / `circle` / `g` 与
   `fill` / `stroke` / `fill-opacity`。不引图表库、不用 `<img>`、不用 `data:` URI。
   CSS 里的 `.tickText` / `.gridLine` / `.axisLine` 抄 `chartPrimitives.module.css` 的取值
   （`--text-tertiary`、11px、`stroke-width: 1`、`shape-rendering: crispEdges`）。
2. **`<title>` 保留但不算交付**：SVG 的 `<title>` 是原生语义、不是脚本，浏览器里仍可悬停；
   但**任何只存在于悬停里的数字都不算读到了** —— 图上可见的文字、刻度、图例、表格必须能
   独立读懂这张图。打印时 `<title>` 自然消失，这不构成信息损失。
3. **尺寸：按 viewBox 原生宽度排，不放大、不缩到双列。** 页面的双列网格之所以成立，是因为
   每列约 690–700px，接近 viewBox 的 720。快照内容盒 896px，因此**四张图一律单列、全宽**；
   SVG 走 `display: block; width: 100%; height: auto` 并 `max-width: 720px`（热力图除外，
   见 4.5）。这不是排版口味：SVG 是等比缩放的，把 720 宽的图塞进 432px 的双列里，
   11px 的轴标签会缩到 6.6px —— 比正文小一半，等于删掉刻度。
4. **逐块空态**：某一块没数据时，保留 `h2` 标题 + 一行 11px/16px tertiary 的说明，
   **不画空坐标轴、不画空框、不留一块灰底**（空框比一句话更像渲染失败）。文案逐字用页面
   同款的 `emptyText`（见 4.6 表）。整篇空态见第 6 节。

### 4.2 每日 Token 消耗（趋势）

- `viewBox="0 0 720 170"`，几何逐值抄 `BarChart.tsx`：`padLeft 56` / `padRight 10` /
  `padTop 8` / `padBottom 22`；`barWidth = min(slot × 0.72, 44)`；每根柱
  `height = max(value / maxValue × plotHeight, 1.5)`（**空日保留 1.5px 底桩**，与页面一致：
  高度为 0 的柱和渲染失败分不开）；`labelStride = ceil(n / 12)`；
  纵轴 3 条网格线来自 `axisTicks(niceAxisMax(max), 3)`，刻度文案走 `formatAxisValue`（紧凑写法
  `12K` / `1.2M`），基线（tick 0）用 `--border-strong`，其余网格线用 `--border`。
- 柱体：`fill: var(--chart-1-soft)` + `stroke: var(--chart-1)` + `stroke-width: 1`
  （大面积填充只给 soft、实色只给轮廓，与页面同一条纪律）。
- 横轴标签 = `formatDayLabel(dayStart)`（`9/28` 这种），居中在柱位。
- `<title>`：`{日}：{formatTokenCount(value)}` —— 补充信息，不是唯一来源。
- 图下 `caption`（本规格新增措辞）：`每根柱 = 一个自然日（本地时区）；纵轴为四类 token 之和（与上方「Tokens 总量」同一个口径）。`
- **裁决：快照固定导出「全部（四类之和）」，不跟随页面上的 Token 类别分段。**
  两个理由：一是快照的头条就是 `Tokens 总量`，图与头条必须是同一个数；二是如果快照悄悄
  采用了「当前标签页正选着哪个类别」，两份快照就会无法互相比较，而这个状态在文件里看不见。
  90 天档的横轴抽稀照旧由 `labelStride` 保证。

### 4.3 按项目分布

- `viewBox="0 0 720 {4 + n×26 + 4}"`，几何抄 `HBarChart.tsx`：`labelWidth 170` /
  `valueWidth 76` / `rowHeight 26` / `padTop 4` / `padBottom 4`；条长按最大值归一化
  （`value / max`，`max` 至少 1）。
- 行数 = `range.topProjects`（`DEFAULT_TOP_N` = 6，尾部已由「其他」折并在聚合层完成 ——
  快照不重新分组、不重新排序）。
- 标签 = `formatProjectPath(label, path)`（只出目录名）；数值在条尾，11px mono。
- **隐私裁决（与页面不同，必须写死）**：页面把完整路径放在 `title` 里（屏幕上有悬停、给本人看），
  快照的 `<title>` **只允许写目录名或模型显示名，绝不写 `hint` 里的完整路径** ——
  这个文件是要发出去的，`title` 也是文档内容。
- 不新增占比列：页面这块只给绝对值，快照不制造页面没有的读数。

### 4.4 按模型分布

- 单行堆叠条 `viewBox="0 0 720 30"`，几何抄 `StackedBar.tsx`（`pad 2`、条体 `y=4`、
  `height=22`）；每段 `fill: var(--chart-{i}-soft)` + `stroke: var(--chart-{i})`，
  索引按 `(i % 6) + 1` 循环（6 是色板长度，`tokens.css` 里写死）。
- 条下接两列图例（`grid-template-columns: repeat(2, minmax(0, 1fr))`，`gap: 4px 12px`）：
  10×10 色块（`border-radius: 2px`，实色）+ 名称 + 数值（mono、右对齐）。
  名称 = `formatModelId(label)`（与页面图例逐字一致）。
- **裁决：原始模型 id 不进快照。** 页面上它住在悬停 `title` 里；纸面没有悬停，塞进括号会让
  两列图例溢出，而完整 id 清单不属于这张摘要。收件人要查原始 id，去开应用即可。

### 4.5 活跃时段（周 × 小时）

- `viewBox="0 0 556 174"`：`CELL 20` / `GAP 2` / `LABEL_LEFT 22` / `LABEL_TOP 16` /
  宽 `22 + 24×20 + 23×2 + 8 = 556`、高 `16 + 7×20 + 6×2 + 6 = 174` —— 逐值抄 `Heatmap.tsx`。
- **`width: 556px; max-width: 100%`，不放大**：它原生就是 556 宽，拉到 896 会把 20px 的格子
  撑成 32px 的巨格、11px 的刻度撑成 18px，与全篇字号脱节。容器 `.heat` 用
  `display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 24px`，图例在图右侧，
  宽度不够时换到图下方。
- 行：周一优先（`WEEKDAY_ROW_TO_DAY = [1,2,3,4,5,6,0]`，标签 `一` 到 `日`）；列：每 4 小时一个
  刻度（`0 / 4 / 8 / 12 / 16 / 20`）。
- 色阶：`fill: var(--chart-1)` + `fill-opacity` 阶梯 `[0, 0.3, 0.5, 0.68, 0.84]`
  （`level = max(1, ceil(count / max × 4))`，`count = 0` 走 0 档）；
  空格子 `fill: var(--inset)`，**只有填充、没有描边**（描边只表示「这一格有数据」）。
- **单位是消息条数，不是 token** —— 与页面一致，图下不另写说明（图例的「少 / 多」就是刻度）。
- 色阶图例：`少` + 四枚 10×10 格（`background: var(--chart-1)`，`opacity` 取
  0.3 / 0.5 / 0.68 / 0.84）+ `多`，用法与页面相同。**没有图例的色阶不算刻度**，这一行不能省。
- `<title>`：`{周一…} {hour}时：{count} 条消息`。

### 4.6 逐块空态文案表（逐字用页面 `emptyText`）

| 区块 | 空态文案 |
| --- | --- |
| 每日 Token 消耗 | `所选范围内暂无消耗` |
| 按项目分布 | `所选范围内暂无项目消耗` |
| 按模型分布 | `所选范围内暂无模型消耗` |
| 活跃时段（周 × 小时） | `暂无活跃时段` |

形态统一：`h2` 照常渲染，标题下方一行 11px/16px `--text-tertiary` 的句子，块内高度只剩这行。

---

## 5. 计费窗口区（两层限额 + 本窗口消耗 Top 会话）

### 5.1 结构

一个 `h2 计费窗口`，下面三个 `h3`：`5 小时窗口`、`滚动 7 天`、`本窗口消耗 Top 会话`。
两层限额的「层名」因此保留，同时明确三者属于同一张卡（页面里它们也同处
`aria-label="计费窗口"` 的一张卡）。数据来源一条：调用方手上那份 `active` 块与 `week`
（`currentBlock` / `weeklyWindow` / `attributeQuota` 的既有输出），生成器不重算。

**不进快照的**：页面上的「近几个窗口」历史条。它不在 Issue #149 的内容清单里，且它的横轴
「按开始时刻等距排布、柱间距不代表真实间隔」在纸面上更难自证 —— 留一句话解释一张装饰性图，
不如不留。

### 5.2 5 小时窗口

布局：`display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px`。

左：表盘（**只有选了计划、有分母时才画**）

- 几何逐值抄 `Gauge.tsx`：`size 120` / `stroke 10` / `r = 55` / 底环 `stroke: var(--border)` /
  进度弧 `stroke: var(--chart-1)` + `strokeLinecap: round` + `rotate(-90)`；
  显示尺寸 112px（紧凑档，与页面一致 —— 没选计划时它是一个空环，占 140px 没有信息量）。
- 环心两行：`formatTokenCount(consumed)`（`--text`、600、tabular）+ `本窗口消耗`（tertiary、11px）。
- 弧下加一行 caption（**本规格新增的纸面升格**）：`当前窗口已用 N%（估算限额）` ——
  这句话在页面里就是表盘的 `aria-label`（`shareText`），纸面上它必须变成可见文字：
  没有刻度的一圈弧在打印稿上读不出比例，这与热力图必须有色阶图例是同一条道理。

右：读数 2×2 网格（`grid-template-columns: repeat(2, minmax(0, 1fr))`，`gap: 8px 16px`）

| 标签 | 值 | 缺值表现 |
| --- | --- | --- |
| `窗口开启` | `formatClock(active.start)` | 无 |
| `窗口关闭` | `formatClock(active.end)` | 无 |
| `消耗速度` | `{formatTokenCount(rate.tokensPerHour)}/时` | `样本不足` |
| `预计到达限额` | `formatPredictionTime(prediction.reachAt)` | `样本不足` / `未选计划` |

**裁决：纸面写绝对时刻，不写倒计时。** 页面上的「窗口关闭」是 `X 时 Y 分` 的倒计时
（30 秒一跳）；文件打开时那个数早就错了。快照给 `HH:mm` 的关闭时刻，让它永远成立。
`窗口开启` / `窗口关闭` **都要进文档** —— 5 小时窗口的读数离开了它属于哪一段时刻就没有意义，
而收件人无法回到应用去补看。

计划说明行（`.plan-note`，11px/16px tertiary，跨列）：

- 未选计划：`未选择订阅计划：只显示消耗，不显示百分比——没有分母就没有比率。`
  （**本规格对页面原句的唯一删改**：页面原句后半段是「在『设置 → 计费窗口』选择计划」，
  那是应用内操作指引，收件人手上没有这个应用，留着只会让人去找一个不存在的按钮。
  前半段逐字保留 —— 这是刻意记录的改动，不是顺手删的。）
- 已选计划：`限额为社区整理的估算值（整理于 {PLAN_LIMITS_AS_OF}，非官方数字），仅供参照；估算与预测都不是账单。`
  （逐字沿用页面。）

### 5.3 滚动 7 天

内嵌块（`background: var(--inset)`、1px `--border`、`border-radius: 8px`、`padding: 8px 12px`），
与 5 小时层靠「内嵌底色 + 线性条」的另一种语言区分开 —— 两层限额不是两张同构的仪表。

| 项 | 内容 |
| --- | --- |
| 组名 | `滚动 7 天`（11px/16px tertiary） |
| 主读数 | `formatTokenCount(totalsSum(week.consumed))`（20px/600，tabular） |
| 副读数 | `日均 {formatTokenCount(round(consumed / 7))}/日`；`较上一周期 {+N% / -N%}`，上一周期为 0 时写 `上一周期 0`（不写 ±100%） |
| 活跃天数 | `{weekly.activeDays} 天`（`weeklyWindow` 已算出的现成读数，纸面上多一格事实没有成本） |
| 预算条（仅设了周预算） | 4px 轨道 `--border-strong` + `var(--chart-1)` 填充，`width = min(100%, share × 100)%`；文案 `周预算已用 N%（预算为自设数字）`；右侧 ETA `已达预算` / `按日均推算 MM-DD HH:mm 触达` / `样本不足，不外推` |
| 未设预算 | 一行 11px tertiary：`未设周预算——只显示消耗` |
| 必带句（逐字） | `滚动 7 天累计，不是官方重置窗口，两者不逐分钟吻合` |

### 5.4 本窗口消耗 Top 会话

`h3` 行：左侧标题 `本窗口消耗 Top 会话`，右侧（`margin-left: auto`）11px tertiary 的分母句，
**逐字**：`占比分母 = 本窗口总消耗（与表盘中心同一个数）。`

表格（沿用 `exportHtml.ts` 的表格语言，不用页面的 24px 行高 —— 纸面表格的行距由文档语言决定）：

| 列 | 宽度 / 对齐 | 内容 |
| --- | --- | --- |
| 会话标题 | 自适应，`overflow-wrap: anywhere` | `row.title`（`sessionTitle`），过长省略 |
| 项目 | 自适应、`white-space: nowrap`、过长省略 | `formatProjectPath(row.projectLabel, row.projectPath)`，只出目录名 |
| 本窗口消耗 | 右对齐、mono、tabular、`white-space: nowrap` | `{formatTokenCount(row.tokens)} tok` |
| 占比 | 右侧 56×6 轨道 | 见下 |
| 占比百分比 | 右对齐、tabular | `share`：精确值 ×100 保留 1 位；`>0 但 <0.05%` 写 `<0.1%` |

「项目」列是**纸面必须新增**的一列：页面把项目名放在行的 `aria-label` 里（屏幕上有悬停与读屏），
收件人手上没有悬停，也没有那颗会话行按钮，项目名不上纸面就等于丢了这个维度。

- 行数：`attributeQuota` 的默认 Top 5；`sessionsInWindow > 5` 时表尾追加一行
  `其余 N 个会话`（`colspan="2"` 占住「会话标题 + 项目」两列，数值与占比照给，
  占比条用 `var(--chart-1-soft)` 降一档，文字用 tertiary，行首 1px `--border` 分隔线）。
- 占比条：56×6，轨道 `var(--border-strong)`，填充 `var(--chart-1)`，**非零最小 2px**
  （有消耗的行不许被画成空条）。
- 会话标题可能带尖括号：一律 `escapeHtml`。
- 行不可点是纸面的事实，不画任何「点击」提示（没有下划线、没有手型、没有动作列）。
- 空态（`sessionsInWindow === 0` 或 `windowTokens <= 0`）：只留 `h3` 与分母句，下面一行
  11px tertiary：`本窗口没有可归因的会话消耗。`（本规格新增）。

### 5.5 没有进行中的窗口

`currentBlock` 返回 `null`（日志里没有落在当前 5 小时窗口的记录）时，页面整张卡不渲染；
快照**不能整块消失** —— 一张打印稿少了一节会被读成漏页。处理：

- 5 小时窗口子块：`h3` 照常，`.window` 位置换成一行 11px tertiary：
  `当前没有进行中的 5 小时计费窗口。`（本规格新增）。
- 滚动 7 天子块与页脚照常（周层总有值，可能为 0）。
- Top 会话子块走 5.4 的空态句。

---

## 6. 空态：所选区间内一个会话都没有

### 6.1 触发条件

页面手上那份 `range.kpi.sessions === 0`（例如档位切到「近 7 天」而最近 7 天没有记录，
但本机 90 天内其实有数据）。注意与页面级空态区分：`inputs.length === 0 && progress.total === 0`
时页面根本不渲染头部（按钮也不存在），那种情况导不出、也不该导出。

### 6.2 文档长什么样

保留：`head`（wordmark / `h1 用量总览` / 元数据行 / 包含声明）与 `footer`（三行）。
**删除**：KPI 读数带、四张图、计费窗口整节、`.readouts-note`。
正文只留一张空态块：

```html
<section class="block empty">
  <h2>所选区间内没有会话记录</h2>
  <p>生成这份快照的机器上，近 30 天内没有可统计的会话记录。这份快照只记录这个事实，没有图表可画。</p>
</section>
```

两段文案标注 **本规格新增**（Issue #149 未定此句）：

1. 标题：`所选区间内没有会话记录`。不写「暂无数据」—— 那读起来像坏了，
   而「所选区间内没有」是一句准确的、可核对的事实。
2. 正文：`生成这份快照的机器上，近 N 天内没有可统计的会话记录。这份快照只记录这个事实，没有图表可画。`
   主语是「生成这份快照的机器」而不是「本机」—— 收件人打开文件时，这个文件已经换了机器。
   句尾「没有图表可画」是刻意的：它替收件人回答了「是不是渲染失败」。

样式：`.empty p { margin: 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }`，
与逐块空态同一档；不放大、不居中、不加图标。

### 6.3 空态里绝不允许出现

- `$0.0000` / `$0.00`（成本没有分母时是「未知」，不是零 —— `exportHtml.test.ts` 的既有立场）。
- 任何坐标轴、空柱、空热力格、0 行表格。
- 四句「暂无数据」并列（那会让空态看起来像四张坏图）。
- 「请到设置里选择计划」这类应用内操作指引。

---

## 7. 应用内入口（按钮）

### 7.1 位置与 DOM

按钮只在**用量档**出现。`UsageOverviewPage` 现在的 `.header` 是 `space-between` 的两簇：
左 `headerControls`（视图分段 + 区间分段），右 `progress` 文本。改成：

```html
<div class={styles.header}>
  <div class={styles.headerControls}>
    <SegmentedControl … />   <!-- 用量 | 错误 -->
    <SegmentedControl … />   <!-- 近 7 / 30 / 90 天 -->
  </div>
  <div class={styles.headerActions}>
    <span class={styles.progress} data-probe="usage-progress">…</span>
    <Button variant="secondary" data-probe="usage-snapshot-export" …>导出快照</Button>
  </div>
</div>
```

```css
.headerActions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end;
                 gap: var(--sp-2) var(--sp-3); }
```

- 按钮是右簇的**最后一个子元素**：右簇在 `space-between` 里天然贴右，因此按钮的右边缘固定，
  进度文本变长时向左生长、不会把按钮推来推去。
- 窄窗口 / 130% 字号下右簇整簇换行，按钮留在右端点；不裁切、不缩成图标。
- 错误档（`view === "errors"`）不渲染这个按钮：快照描述的是用量视图，错误档没有这个入口。

### 7.2 文案与可访问名

| 项 | 值 |
| --- | --- |
| 可见文案 | `导出快照` |
| 可访问名（`aria-label`） | `导出用量快照（单文件 HTML）` |
| 空闲 `title` | `导出用量快照（单文件 HTML）` |
| 扫描中 `title` | `正在扫描会话，扫描完成后可导出` |
| 尺寸 | `Button` 的 `secondary` 档（`--control-h` 28px）；不加大、不用 primary 墨色 —— 它不是本页的主动作 |

可访问名比可见文案长是刻意的：可见的 `导出快照` 在上下文里已经够清楚，而读屏用户听到的
第一句就该知道产物是什么（单文件 HTML）。

### 7.3 锚点

- 按钮：`data-probe="usage-snapshot-export"`（挂在真正的 `<button>` 上，实现者与真机门禁共用）。
- 进度文本：新增 `data-probe="usage-progress"` —— 门禁要判「按钮与进度文本不重叠、按钮在文本
  右侧」，没有这个锚点就只能靠 CSS Module 的哈希类名，改一次样式就静默失配。

### 7.4 扫描中是否禁用：**禁用**

裁决：`disabled={scanning}`（`useUsageOverview` 已经在返回这个布尔值）。理由：

- 扫描是**渐进式**的（`PUBLISH_EVERY = 8`，`inputs` 一批批长出来、进度行从
  `已分析 3 / 200 个会话` 走到 `近 30 天内 200 个会话纳入统计`）。扫描中途导出得到的是
  **半份统计**：KPI、趋势、Top 会话全是少了一截的数，而文件本身看不出这一点。
- 快照的用途是**外发与归档**。半份统计一旦发出去、存进档案，就没有更正的机会；
  按钮上「等一会儿」的成本极低，两者的代价完全不对等。
- 禁用的同时必须**说明原因**（`title="正在扫描会话，扫描完成后可导出"`），否则用户只会
  看到一枚点不动的按钮。扫描结束后自动恢复可用，不另加加载态或进度条。
- 不禁用的情况：`scanning === false` 就恢复，即使区间内 0 会话 —— 那导出的是第 6 节那张
  空态文档，它是一份**正确**的产物，不是错误。
- 写入过程中再禁用一次（`exporting` 状态，防重复点击弹两个保存对话框）；写完后复位。

### 7.5 反馈（成功 / 取消 / 失败）

- 成功：`notify("已导出用量快照", "success")` —— 与既有 `已导出 HTML 报告` 同一句式，
  收件人读到的名字与按钮一致。
- 用户取消（`savePath` 返回 `null`）：**不写文件、不报错、不 toast**（契约）。
- 写失败：既弹 error toast，也**就地**在页头写一行 `role="alert"` 的错误
  （`.actionError`，11px/16px，`--danger`），模板 `导出失败：{原因}` ——
  toast 会消失，错误不该跟着消失（与 `SessionHeader` / `ExportDialog` 的既有语言一致）。

### 7.6 对现有页面与截图的影响

- 页头高度不变（按钮 28px，与分段控件同高），因此**首屏红线**
  （`1440×900 不滚动时三块面板标题都在首屏`）不受影响；若实测变红，先查是不是 `.header`
  换行造成的，不要把责任推给按钮本身。
- 受影响的归档截图：`usage-light{.png,-webkit.png}`、`usage-dark{.png,-webkit.png}` 四张
  （按钮进了页头）。`usage-below-*` 预期**不变** —— 它拍的是首屏以下的滚动位；若它们也变了，
  说明页头高度被动过，先解释再重出。
- 截图验收要求：浅色 + 深色各看一次，确认按钮右边缘与进度文本之间 12px 间距、
  与区间分段控件垂直居中对齐、130% 字号档下不换行挤压。

---

## 8. 明确写清「这份快照不含什么」

那句声明的位置与形态在 1.3 已定死，这里只报结论：

- **位置**：`.head` 内、元数据行正下方、KPI 读数带之前。它是收件人读到的**第四个元素**，
  在他看第一个数字之前就已经知道这份文件不是全部。
- **形态**：一条内嵌说明条（`--inset` 底、1px `--border`、4px 圆角、11px/16px、
  `--text-secondary`），与页脚同一种「自述」语气，不是警告。
- **只出现一次**：页脚不重复这一句。同一句话写两处，改一处就会漂移；收件人读的第一屏
  就是它，没必要在文末再说一遍。
- 页脚只管三件事（逐字沿用 `exportHtml.ts` 的页脚，把「报告」换成「快照」）：
  `本快照由 CC Analyzer 生成，数据未上传至任何服务器。` /
  `CC Analyzer v{appVersion} · <a href="{REPO_URL}" rel="noreferrer">github.com/liang-zhenxiang/cc-analyzer</a>` /
  `快照生成于 {formatDateTime(generatedAt)}`。
- 快照**不含**的历史窗口条与**不含**的三块面板（工具与 skill 普查、压缩统计、错误档）
  在 5.1 与 1.3 各有一处交代，不另开一节专讲。

---

## 9. 真机 GUI 门禁：锚点与探针事实

### 9.1 锚点

| 锚点 | 挂在哪 | 用途 |
| --- | --- | --- |
| `data-probe="usage-snapshot-export"` | 入口 `<button>` 本身 | 在场、几何、可访问名、禁用态 |
| `data-probe="usage-progress"` | 页头进度 `<span>` | 与按钮不重叠、按钮在其右侧 |

两个锚点都只服务探针，不参与样式选择（`[data-probe]` 不出现在任何 CSS 选择器里）。

### 9.2 探针该收集的事实（只收集，不判定）

在 `gui_probe::PROBE_JS` 的 `facts` 里新增两组：

```js
var snapshotBtn = document.querySelector("[data-probe='usage-snapshot-export']");
var progressEl = document.querySelector("[data-probe='usage-progress']");
facts.snapshot = {
  present: !!snapshotBtn,
  rect: snapshotBtn ? rectOf(snapshotBtn) : null,
  name: snapshotBtn ? (snapshotBtn.getAttribute('aria-label') || '') : '',
  title: snapshotBtn ? (snapshotBtn.getAttribute('title') || '') : '',
  text: snapshotBtn ? (snapshotBtn.textContent || '').trim() : '',
  disabled: snapshotBtn ? !!snapshotBtn.disabled : null
};
facts.progress = progressEl ? rectOf(progressEl) : null;
```

### 9.3 脚本判据（`scripts/gui-test.sh`，在 `视图=用量` 步骤）

1. `present === true`，`text === "导出快照"`，`name` 含 `导出用量快照`。
2. `rect.width > 0 && rect.height > 0`；`24 <= rect.height <= 40`（28px 控件的高度区间，
   留出上下容差）；`rect.width >= 64`。
3. 按钮在内容区横向范围内（`rect.x >= mainRect.x - 1` 且
   `rect.x + rect.width <= mainRect.x + mainRect.width + 1`），且纵向在视口内
   （`rect.y >= 0` 且 `rect.y + rect.height <= viewport.height`）—— 页头是首屏元素，
   被挤出视口就是布局事故。
4. 与进度文本不相交：`rect.x >= progress.x + progress.width`（允许 1px 容差）。
5. **不点它**。点了会弹系统保存对话框，探针驱动不了（与归档导入同一限制）。
   内容层由单元测试 + e2e 覆盖，两边共用同一个生成器。

### 9.4 生成物自身的视觉验收（不进真机门禁，但要做）

真机门禁看不见快照长什么样。做法（建议写成一个临时脚本，或 e2e 里单开一个 spec）：
用固定夹具与固定 `now` 生成 HTML，写进 `os.tmpdir()`，然后
`page.goto("file://…")` 截三张 ——

1. 浅色（默认）；
2. 深色（`page.emulateMedia({ colorScheme: "dark" })`）；
3. 打印（`page.emulateMedia({ media: "print" })`）。

**人工看一遍**：文首到页脚一条不缺、图表刻度不被裁、深色下文字对比度正常、
打印版是白底深字、没有任何 `NaN` 或 `$0.0000`。这三张图不提交仓库，只在 PR 里描述结论。

---

## 10. 验收矩阵（本规格负责的视觉与版式判据）

| 层 | 判据 |
| --- | --- |
| 单元（生成器） | `.sheet` 是 960px；区块标题按 1.2 的顺序出现且各一次；包含声明句逐字在场；上标只有 1 / 2 且 `.readouts-note` 两句在场；`h1` 唯一；`href="` 恰好 1 处；无 `<script` / `<link` / `src=` / `@import`；不出现 `/Users/`、`/home/`、`.claude/projects`、`.jsonl`；项目名与标题塞 `<script>` / `&` 时被转义；趋势柱数 = 区间天数；同输入两次生成逐字节一致 |
| 单元（空态） | `sessions === 0` 时：`h2` 是 `所选区间内没有会话记录`；不出现 `.readouts`、`<svg>`、`<table>`、`$0.0000` |
| e2e | 点按钮，保存桩收到文件名 `cc-analyzer-usage-YYYY-MM-DD.html` 与含 KPI 的正文；桩返回 `null` 时不写文件、无 `role="alert"`、无 toast |
| e2e（视觉） | 生成的文档在 `file://` 下打开：`document.body.scrollWidth === clientWidth`（无横向滚动）、三张 720 图的渲染宽 `<= 720`、热力图宽 556±2 |
| 真机门禁 | 9.3 的五条；进入「视图=用量」这一步即可判，不需要新增动作步骤 |
| 截图 | `usage-*` 四张重出并人工比对；`usage-below-*` 预期不变 |

---

## 11. v1 不做什么（写清楚，免得被当成漏做）

- 不做上传 / 分享链接 / 服务端渲染（Issue 红线）。
- 不做多档主题切换、不做档位查询参数：只跟随 `prefers-color-scheme`。
- 不做「导出所有区间」的批处理；一次一份、跟随当前档位。
- 不做 CSV / Markdown / PDF 的旁路（PDF 由用户的浏览器打印生成）。
- 不做历史窗口条、工具与 skill 普查、压缩统计、错误档（见 5.1 与第 8 节）。
- 不做快照内的交互：没有折叠、没有切换、没有筛选、没有 tooltip 依赖。
- 不改会话报告 `exportHtml.ts` 的既有行为（包括它打印块只刷背景的那处旧账）。
- 不动错误档页面与任何既有聚合口径。

---

## 12. 实现者清单

1. [ ] `.sheet` 960px / padding 32px / 圆角 8px；`body` padding `32px 16px`；间距只用 4 / 8 / 12 / 16 / 32。
2. [ ] 常量块补齐浅色 + 深色两套，含 `--chart-1..6` 与 6 个 `-soft`（`exportHtml.ts` 里没有这一层）。
3. [ ] `<title>` / `h1` / 元数据四段 / 包含声明条（`.coverage`）按 1.3 逐字。
4. [ ] KPI 四格 + 两枚 `<sup>` + `.readouts-note` 一句（页面原句 + 两枚上标）。
5. [ ] 成本未知时写 `未知` 并追加「部分会话未知价 · 约 N tok 未计入」，不出现 `$0.0000`。
6. [ ] 趋势 SVG：`720×170`、`axisTicks(…, 3)`、空日 1.5px 底桩、`labelStride = ceil(n / 12)`、固定导「全部」四类之和、图下 caption。
7. [ ] 项目 SVG：`720×(4+n×26+4)`、最多 6 行含「其他」、`<title>` 只写目录名（绝不写 `hint` 完整路径）。
8. [ ] 模型 SVG：`720×30` 单行堆叠（soft 填充 + 实色描边、索引 `(i % 6) + 1`）+ 两列图例；不输出原始模型 id。
9. [ ] 热力图：`556×174` 且不放大、周一优先、每 4 小时一档、色阶 `[0, 0.3, 0.5, 0.68, 0.84]`、空格只填充、色阶图例「少 → 多」四格。
10. [ ] 计费窗口：`h2 计费窗口` + 三个 `h3`；5 小时层表盘（仅有分母）+ 弧下百分比句 + 2×2 读数（**绝对时刻，不是倒计时**）+ 计划说明行（未选计划时删掉应用内指引那半句）。
11. [ ] 滚动 7 天：主读数 + 日均 + 较上一周期 +（可选）预算条 + 必带句逐字。
12. [ ] Top 会话：`h3` 右侧分母句逐字、表格四列、Top 5 + 余项、占比条 56×6 非零最小 2px、空态句。
13. [ ] `currentBlock` 为 `null` 时写 `当前没有进行中的 5 小时计费窗口。`，整节不消失。
14. [ ] 逐块空态用 4.6 表里的四句原文，不画空轴、不画空框。
15. [ ] 整篇空态按第 6 节：保留 head 与 footer，只留 `所选区间内没有会话记录` 一块，删掉读数带与所有图。
16. [ ] 打印块：强制整套浅色、`.sheet` 去边框与内边距、区块 `break-inside: avoid`、`thead` 重复、不写 `@page`、不画页码。
17. [ ] 页脚三行逐字（「报告」改成「快照」）；`href` 全篇仅此一处。
18. [ ] 入口按钮：页头右簇最后一位、`variant="secondary"`、`aria-label="导出用量快照（单文件 HTML）"`、`data-probe="usage-snapshot-export"`；进度文本加 `data-probe="usage-progress"`。
19. [ ] `scanning` 时 `disabled` 且 `title="正在扫描会话，扫描完成后可导出"`；`exporting` 时再禁一次。
20. [ ] 成功 toast `已导出用量快照`；取消不写不报；失败 toast + 页头 `role="alert"` 就地形如 `导出失败：{原因}`。
21. [ ] 探针 `PROBE_JS` 增加 `snapshot` 与 `progress` 两组事实；`gui-test.sh` 按 9.3 判五条，**不点按钮**。
22. [ ] 重出 `usage-*` 四张截图并人工看浅色 / 深色各一次；`usage-below-*` 若变了先解释原因。
23. [ ] 生成物本身按 9.4 做浅色 / 深色 / 打印三张人工目检（不提交仓库）。
