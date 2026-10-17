# 「搜索覆盖面补齐（工具输出 / 错误文本 / 文件路径）」设计与文案规格（Round T）

> 角色：UI/UX 产品设计师（桌面工具 / 仪器面板，数据可视化方向）
> 日期：2026-10-12 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（已锁定，引用 Issue #147 的冻结契约，不在本文件重开）：搜索索引新增三类来源
> （工具输出 / 文件路径 / 错误文本），结果行标出来源，新增来源过滤器（至少「只看文件路径」），
> 大小写不敏感子串语义保持不变。**本文件只描述设计与文案，不改任何源码，不新增超出
> #147 契约的功能。**

## 0. 语境与现状（写前逐字读过）

读过：Issue #147 维护者评论（契约，权威）、`web/src/features/search/searchIndex.ts`、
`SearchPalette.tsx`、`SearchPalette.module.css`、`SearchPalette.test.tsx`、
`searchIndex.test.ts`、`useSearchIndex.ts`、`web/src/features/sessions/types.ts`
（`RecordKind` / `StructuredToolResult` / `SessionRecord`）、`SessionAnalyzerPage.tsx`
的 reveal 链路、`web/src/features/sessions/LogView.module.css` 的类型徽标语言、
`web/src/features/usage/ToolCensusPanel.tsx` 的 `aria-pressed` chips、
`web/src/styles/tokens.css`、上一轮的 `design-round-s-usage-snapshot.md`
与 `design-round-r-attribution.md`。

**#147 冻结事实（后文只在此范围内展开）：**

- `SearchSource = "user" | "assistant" | "tool-output" | "file-path" | "error"`；
  `SearchEntry` 新增 `source`，可选 `truncated`；`SearchFilter = { sources?: ReadonlySet<SearchSource> }`；
  `searchEntries(entries, query, limit, filter?)` 与 `GlobalSearchIndex.search(query, limit?, filter?)`。
- 同一条记录**最多产出两个条目**：一条消息（user / assistant 走原逻辑）、一条工具类
  （`file-path` / `error` / `tool-output` 三者取其一，互斥）。
- 跨来源去重优先级：`user/assistant` 消息 > `file-path` > `error` > `tool-output`；
  带来源过滤时**先按过滤裁剪再判重**。
- 工具输出索引前必须过 `lib/ansi` 的 `stripAnsi`；单条工具输出最多索引
  `INDEX_TEXT_LIMIT` 个字符，超出记 `truncated: true`。
- 文件路径来自 `structuredResult.filePath`（Edit / Write / Read）与 `toolInput` 里
  `file_path` / `filePath` / `path` 的**字符串值**，结构化提取，**原样存**，不做正则猜正文。
- **应用内搜索的路径不脱敏**（理由见 §3.4）：路径原样进索引与片段，但**不新增任何落盘**，
  索引仍是内存单例。
- v1 不做模糊匹配、正则、TF-IDF 排名、跨会话结果缓存、索引落盘、增量持久化、搜索历史。

**本规格定死的六个数值（实现者一眼版）：**

| 项 | 定死值 |
| --- | --- |
| 五类来源标签文案 | `我` / `助手` / `工具输出` / `文件路径` / `错误` |
| 标签位置 | 结果行最左，片段之前；一行只有一个标签 |
| 过滤器形态 | 输入框下方一行**多选 chips**：`全部` `我` `助手` `工具输出` `文件路径` `错误`，默认=全部 |
| 过滤 chips 行高 | `--control-h-sm`（24px），与 `--fs-xs` / `--lh-xs` 配套 |
| 路径片段字体 | `var(--font-mono)` + `--fs-xs` / `--lh-xs`，单行，左对齐省略号（e2e 断言 `direction: ltr`） |
| 锚点属性名前缀 | `data-probe="search-source"` / `search-filters` / `search-filter-chip` / `search-result` / `search-status` |

## 1. 来源标签

### 1.1 为什么每条命中都要有标签

索引把来源分成五类之后，两行片段长得再像，也可能一条是「我」说的、一条是 bash 打出来的。
标签不是装饰，是「这条命中为什么在这里」的唯一线索。因为一条记录**只会产出一种来源**、
去重后又只留一行，所以一行**恰好一个标签**，永远不会出现「我 / 工具输出」两枚并排。

**标签要不要在「我 / 助手」上也显示？要。** 只给新三类打标签会让老命中变成「没有来源的记录」，
用户无法区分「这条没来源」与「这条的标签没渲染出来」。五类一律有标签，扫读时列首是对齐的。

### 1.2 五类标签的文案、配色与含意

标签是**分类**不是**状态**。因此：绝不使用 `--danger` / `--danger-soft`（那是「确定的
错误读数」的语义）；绝不借用 `--cat-*` 类别色（「记录类别」维度已被日志表占满）。
唯一允许的着色差异来自**强调色**与**中性台阶**——颜色只用来做冗余信号，删掉它单靠文字也读得懂。

| 来源 | 可见文案 | 背景 | 文字色 | 说明 |
| --- | --- | --- | --- | --- |
| `user` | `我` | `var(--bg-inset)` | `var(--text-secondary)` | 与工具输出同形，靠文案区分 |
| `assistant` | `助手` | `var(--bg-inset)` | `var(--text-secondary)` | 同上 |
| `tool-output` | `工具输出` | `var(--bg-inset)` | `var(--text-secondary)` | 同上 |
| `file-path` | `文件路径` | `var(--accent-soft)` | `var(--accent)` | 新来源里最需要被看见的一类，唯一着强调色 |
| `error` | `错误` | `var(--bg-inset)` | `var(--text-secondary)` | **不着红**；红只留给仪表判定异常 |

裁决理由：

- 五类各配一色会让结果列表变成六色噪声，而「错误」配红会与用量页的 `--danger` 撞语义——
  同一个字在不同页面表示两件事。文字本身已经无歧义，颜色只做「哪一条不是消息」的快速提示。
- 只有 `file-path` 着强调色：它是本轮新来源里用户最想一眼扫到的那类（「我改过哪个文件」），
  且强调色的像素占比规则（< 3%）在「每行一枚小 chip」的量级内不会失控。

### 1.3 标签的排版

```css
.source {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: var(--control-h-sm);   /* 24px，随字号档不缩放（形，不是字） */
  padding: 0 var(--sp-1);
  border-radius: var(--r-xs);
  background: var(--bg-inset);
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
}

.sourceFilePath {
  background: var(--accent-soft);
  color: var(--accent);
}
```

- 标签不带边框。结果行已经有 4px 圆角的 hover 底，再给标签描边会让每一行出现三个框。
- 标签高度固定 `--control-h-sm`，**按内容宽度**伸展（`我` 与 `工具输出` 不等宽）；行首因此
  呈锯齿状，但每行只有一枚标签、下方是正文，锯齿不会影响可读性。固定宽会为了最长文案
  给所有行留死白，在 640px 的浮层里不划算。
- 标签不折行，不截断；五行文案最长的是 `工具输出`（四个汉字）。

### 1.4 标签的可访问名

标签本身是一个 `<span data-probe="search-source">`，可见文本即语义（`文件路径`）。
整行的可访问名由 §5 给出的模板拼接，读屏用户听到的是
「文件路径：src/web/foo.ts · 3 分钟前」，而不是只听到一个孤立的片段。

## 2. 来源过滤器

### 2.1 位置与 DOM 顺序

过滤器是输入框与结果状态行之间的一行，DOM 顺序固定为：

```text
<input class={styles.input} />              ← 已有
<div class={styles.filters} role="group" data-probe="search-filters"
     aria-label="按来源过滤搜索结果">
  <button data-probe="search-filter-chip" data-source="all">全部</button>
  <button data-probe="search-filter-chip" data-source="user" aria-pressed>我</button>
  …
</div>
<p class={styles.status} data-probe="search-status" role="status">…</p>   ← 原 status，见 §4
<div class={styles.results}>…</div>
```

放在输入框**下方**而不是上方：⌘K 打开后第一件事是打字，输入框必须紧贴浮层顶边；
过滤器是第二次动作，往下放一档不会打断打字流。

```css
.filters {
  display: flex;
  flex-wrap: nowrap;
  gap: var(--sp-15);
  overflow-x: auto;
  padding: var(--sp-1) var(--sp-3);
  border-bottom: 1px solid var(--border);
}
```

`overflow-x: auto` 兜底 130% 字号：六个 chip 在 640px 内放得下（实测最宽组合约 420px），
放大后若溢出，宁可横向滚动也不折成两行——折行会顶掉一屏结果。

### 2.2 控件形态：多选 chips

**多选**，不是单选、不是分段控件。理由：

- 契约的过滤是「按来源裁剪再判重」的集合语义（`ReadonlySet<SearchSource>`），
  多选与它一一对应；单选会逼出「消息合集 / 工具类合集」这种二次分类，凭空多一层概念。
- 用户最想要的两个动作——「只看文件路径」「不要看工具输出」——都是集合运算；
  分段控件的单选做不到第二个。
- chips 与 `ToolCensusPanel` 的 `aria-pressed` 按钮、错误档的过滤行是同一套交互语言。

档位文案与顺序（固定）：

| 顺序 | 可见文案 | 语义 |
| --- | --- | --- |
| 1 | `全部` | 五个来源全部选中（默认态） |
| 2 | `我` | `user` |
| 3 | `助手` | `assistant` |
| 4 | `工具输出` | `tool-output` |
| 5 | `文件路径` | `file-path` |
| 6 | `错误` | `error` |

`全部` 是**快捷开关**，不是第六个来源：五个来源全选时它显示为选中；点它一次
清空全部来源（结果为空，最快速回到「只看我」的起点）；再点一次恢复全选。
五个来源被单独点到任意组合时，`全部` 显示为**未选中**（半选视觉在 chips 上读不出来，
不引入 `indeterminate`）。除 `全部` 外每个 chip 独立 toggle。

### 2.3 默认态

打开浮层时五个来源**全部选中**，`全部` chip 选中，过滤器不缩窄任何结果——
本轮不改「⌘K 立刻能搜到一切」的既有承诺，老用户不会觉得搜索变少了。
浮层关闭再打开时过滤器**重置为全部选中**（与 `query` / `activeIndex` 的重置同款），
不记住上一次的过滤——「为什么这次搜不到」比「省一次点击」贵得多。

### 2.4 chip 的可视与交互

```css
.chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: var(--control-h-sm);
  padding: 0 var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
  cursor: pointer;
}

.chipActive {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
```

- 选中态只有一个信号源：`aria-pressed="true"` + 上表三点（描边 / 底色 / 文字色），
  不给 chip 加对勾图标——六枚对勾会与结果行的来源标签抢注意力。
- 过滤切换后 `activeIndex` 归 0，列表滚回顶部（复用现有 `flat.length` 变化时的
  `setActiveIndex` 兜底与 `scrollIntoView`）。

### 2.5 键盘

- 过滤器 **chips 进 Tab 序列**（原生 `<button>`，`Tab` / `Shift+Tab` 可达），
  `Enter` / `Space` 原生触发切换。理由：读屏与纯键盘用户必须能不碰鼠标切档；
  把 chips 设成 `tabindex="-1"` 会让他们失去唯一的过滤入口。
- **不开方向键导航**：chips 只有六枚，`Tab` 成本可接受；`←/→` 会与输入框的
  文本光标语义混淆（焦点在输入框时方向键必须移动光标）。
- **Enter 只在焦点不在 chip 上时才跳转**。焦点落在 chip 上时，浏览器把 `Enter` 交给
  chip 的 `click`；浮层的 `Enter`（跳转命中）必须判断 `event.target` 是输入框或浮层容器，
  否则会出现「按 Enter 想切档，结果跳去了另一条会话」。
- **最快的切档路径是打字**：输入框支持来源前缀，见 §2.6。这一条让过滤不必离开键盘主路径。

### 2.6 输入框前缀（快速切档）

在查询串开头输入下列前缀（ASCII 冒号，大小写不敏感）时，**等价于点选对应 chip**。
前缀从查询串里剥离，不参与子串匹配：

| 前缀 | 等价 chip |
| --- | --- |
| `路径:` / `文件路径:` / `file:` / `source:file-path` | `文件路径`（互斥，选中后清掉其余四个） |
| `错误:` / `error:` | `错误` |
| `我:` / `me:` | `我` |
| `助手:` / `assistant:` | `助手` |
| `输出:` / `tool:` | `工具输出` |

裁决：这一档是**输入糖**，不改变 §2.2 的集合语义——它只是「清空到只剩这一类」的快捷方式。
全角冒号（`路径：`）不做前缀，当作普通查询字符。v1 不引入第二个前缀（例如 `xx 只搜路径`），
前缀表就是上表这五行，不得扩充。

输入框 `aria-label` 与 placeholder 必须提到这条路（见 §4 文案表）。

### 2.7 零命中时的空态

空态**只有一句**，不区分「没搜到」与「被过滤掉了」：

| 场景 | 状态行原文 |
| --- | --- |
| 有查询、结果 0、索引已完成 | `没有匹配的记录` |
| 有查询、结果 0、索引仍在构建 | `索引构建中 {indexed} / {total}，稍后再试或先用已索引部分`（沿用现文案） |

不额外写「试试关掉过滤」的理由：那需要浮层记住「零命中的原因」，是第二套状态。
`全部` chip 就在同一行，用户自己看得见当前哪些档是选中的。

当五个来源被清空（全不选）时，结果恒为 0，状态行显示 `没有匹配的记录`；
**不**显示 `全部` 的选中态（它显示未选中），语义与视觉一致。

## 3. 片段与路径的排版

### 3.1 一行三件的固定网格

结果行仍是整行 `<button>`。行内顺序固定为三件，与现况只差最左侧新增的来源标签：

| 位置 | 内容 | 锚点 | 样式要点 |
| --- | --- | --- | --- |
| 1 | 来源标签 | `data-probe="search-source"` | `flex: none`；文案与配色见 §1.2 |
| 2 | 片段 | `data-probe="search-snippet"` | `flex: 1 1 auto`；`min-width: 0`；单行省略号 |
| 3 | 相对时间 | 无（沿用现况） | `flex: none`；`--fs-xs` / `--lh-xs` / `tabular-nums` |

```css
.item {
  display: flex;
  align-items: center;            /* 现在是 baseline；标签是固定高的盒子，baseline 会让它浮起来 */
  gap: var(--sp-2);
  /* 其余保持现况：width 100% / padding / radius / 字号 / 文本左对齐 */
}
```

### 3.2 消息与工具输出的片段：保持单行压平

`tool-output` 与 `error` 的片段**继续沿用现况**：`snippetOf` 命中窗口 → `stripAnsi` →
`.replace(/\s+/g, " ")` 压成一行 → 单行省略号。不做多行展开，不保留换行。

理由：

- 结果行的职责是「认得出是哪一条 + 认得出为什么命中」，不是阅读正文；正文在
  Enter 之后的详情面板里。
- 多行片段会让不同结果的行高不一，↑↓ 移动焦点时列表会跳动，`scrollIntoView`
  的锚定观感也会碎掉。
- 工具输出已被 `INDEX_TEXT_LIMIT` 截断，展开它有时会展开到「截断处」，
  反而给出「文本到此为止」的错误印象。

`truncated: true` 的条目**不改片段模板**：`snippetOf` 在 `end < text.length` 时已经
补了尾部 `…`，用户在片段里看到的省略号就是现成信号。但标签的 `title`
（§3.5）要包含完整片段（受索引上限约束的那份 `text`）。

### 3.3 文件路径的片段：等宽、单行、左对齐省略

命中的是 `file-path` 时，片段切换为路径排版：

```css
.snippetPath {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- **等宽字体**：路径里的 `/`、`_`、`.`、大小写混排（`src/AppShell.tsx`）用比例字体
  极易读串行；等宽与日志表的时间列、`code` 元素是同一套语言。
- **单行不折**，省略号截断；`direction` 必须保持 `ltr`。
  **明确否决 `direction: rtl` 的右截断方案**（虽然它能让长路径保住文件名）：RTL 会让
  开头的 `/` 被浏览器重排到字符串尾部——`/Users/me/a.ts` 会显示成
  `Users/me/a.ts/`，那是一个**语义错误的路径**，会被用户当成真的复制走。宁可牺牲
  文件名的可读性，也不产出错误字符串。
- 左截断的代价（长路径只剩开头）用一个明确的兜底补：**`title` 放完整片段**（§3.5），
  悬停即可核对。`--fs-xs` 等宽在 640px 浮层里单行容量约 70 字符，多数仓库内相对路径
  一次显示得下。
- 字号用 `--fs-xs`（11px）而不是 `--fs-sm`（12px）：等宽字形本来就宽，用 12px 会让
  单行容量掉到约 62 字符。改用等宽的同时降一档字号，视觉密度与相邻的 sans 片段持平。
- 路径片段**不做语法着色**（不给 `/` 或扩展名上色）：这仍是一条搜索结果，不是代码视图；
  着色会引入 `--code-*` 令牌与解析器，且与状态过滤叠加时更难扫读。

### 3.4 路径为什么在这里不脱敏

会话报告与用量快照会**导出、转发、被别人打开**，所以那两处只出现项目目录名。
应用内搜索三件事都不同：**不导出、不落盘、不进日志**（索引是进程内单例，
关闭应用即消失）。把命中路径脱敏的代价是用户拿着 `src/web/foo.ts` 的命中记录，
却没法核对它到底是不是自己刚改的那个文件——「为什么这条命中」必须可核对。
因此本页的索引与片段**按原样展示路径**，包括用户随手粘进来的绝对路径。

**伴生约束（实现者必须同时满足）：** 不新增任何落盘（索引仍不写磁盘）；
探针事实里不得把路径写进日志或 `data-*` 之外的持久化位置；路径片段只出现在
浮层的可见文本与 `title` 里。一旦未来给搜索加「历史记录」或「索引落盘」，
这条豁免立即失效——那是本规格给 v1 划的边界，不是通用结论。

### 3.5 悬停与可访问名

- 片段的 `title` = 完整片段文本（`snippetOf` 的产物，未截断的那份 `text` 不进 DOM 属性以外
  的任何持久化位置）。
- 整行可访问名（`aria-label`）固定为：`{来源文案}：{片段}`。
  例：`文件路径：src/web/foo.ts`、`错误：构建失败：找不到模块`。
- 相对时间**不进 `aria-label`**（保持朗读简短且稳定）；时间仍是可见文本，读屏按
  按钮内的可读内容也能念到。若实现选择不用 `aria-label`、直接依赖子元素文本，
  则必须保证 DOM 文本顺序就是 标签 + 片段 + 时间（即 §3.1 的顺序）。

## 4. 体积感知与进度读数

### 4.1 裁决：进度行保留「会话」口径，另加一段「条目」读数

索引新增三类来源后，同一条记录可能产出两个条目，工具输出还各自吃满
`INDEX_TEXT_LIMIT`，**条目数会明显快于会话数增长**。但「已索引 N / M」的两个数
**不能改成条目数**：

- 那个分数的语义是「还剩几个会话没搜过」，分母来自 `useSessions()` 的会话总数；
  条目数没有对应的分母（索引前无法预知会产出多少条），改成条目会让进度条失去终点。
- 用户心里数的是会话，不是索引条目。

所以：**分数保持会话口径**，在它后面追加一段**确定存在的条目读数**：

| 状态 | `data-probe="search-status"` 的原文 |
| --- | --- |
| 未输入查询 | `搜索会话消息、工具输出与文件路径（⌘K 关闭）` |
| 索引构建中，有查询无命中 | `索引构建中 {indexed} / {total} 会话 · 已索引 {entries} 条 · 稍后再试或先用已索引部分` |
| 索引完成，有命中 | `{hits} 条命中 · 已索引 {entries} 条` |
| 索引完成，无命中 | `没有匹配的记录 · 已索引 {entries} 条` |
| 索引构建中，有命中 | `{hits} 条命中 · 已索引 {entries} 条` |

`{entries}` 来自 `GlobalSearchIndex` 新增的 `entryCount` getter（即现有 `size` 的公开别名，
语义是「当前索引里的条目总数」）；`useSearchIndex()` 的返回类型保留
`{ indexed, total }` 并**新增** `entries: number`，老调用点不受影响。
`{entries}` 用 `toLocaleString("en-US")`（与全站千分位一致）。

### 4.2 为什么不做「索引占用多少 MB」

契约要求体积账落在 **PR 里**（条目数、haystack 总字符数、UTF-16 估算字节、相对现状倍数），
不是落在 UI 上。桌面工具的用户不需要边搜边看内存占用；写进界面会变成一个新的
「读数要维护、要翻译、要给截图」的负担。**裁决：界面只给条目数，体积账进 PR。**

## 5. 可访问性

### 5.1 可访问名总表

| 元素 | 角色 | 可访问名 / 属性 |
| --- | --- | --- |
| 浮层 | dialog（现况） | `aria-label="全局搜索"`（不变） |
| 搜索输入框 | textbox | `aria-label="搜索会话记录"`（由 `搜索消息` 改；placeholder 见 §5.3） |
| 过滤条 | group | `aria-label="按来源过滤搜索结果"` |
| 每枚 chip | button | 可见文案即名字；`aria-pressed` 表示选中 |
| 结果行 | button | `aria-label = {来源文案}：{片段}`；`title = {完整片段}` |
| 结果状态行 | status | 文本即 §4.1 的表；`role="status"` 让条数变化被朗读 |
| 来源标签 | span（无 role） | 可见文本即名字；不额外加 `aria-hidden`（它就是内容的一部分） |

### 5.2 结果数变化走 aria-live

状态行加 `role="status"`（等价于 `aria-live="polite"` + `aria-atomic="true"`）。
逐键变化的结果数、以及过滤切换导致的条数变化，都由这一个 live region 播报，
**不新增第二个 live region**（两个会互相打断）。

节流：`role="status"` 的文本在**每次查询变化**时更新即可，不要为打字过程另开计时器——
React 的一次渲染就是一次更新，浏览器自带的 polite 队列会合并密集变化。

### 5.3 文案表（全部定死）

| 位置 | 原文 |
| --- | --- |
| 输入框 `aria-label` | `搜索会话记录` |
| 输入框 placeholder | `搜索消息、工具输出、文件路径…（Esc 关闭）` |
| 输入框 `title` | `可按来源快速过滤：路径: / 错误: / 我: / 助手: / 输出:` |
| 未输入查询 | `搜索会话消息、工具输出与文件路径（⌘K 关闭）` |
| 无命中（索引已完成） | `没有匹配的记录` |
| 无命中（索引构建中） | `索引构建中 {indexed} / {total} 会话 · 已索引 {entries} 条 · 稍后再试或先用已索引部分` |
| 命中 | `{hits} 条命中`（索引完成）/ `{hits} 条命中 · 已索引 {entries} 条` |
| 过滤条可访问名 | `按来源过滤搜索结果` |
| 六枚 chip 文案 | `全部` `我` `助手` `工具输出` `文件路径` `错误` |
| 结果行可访问名 | `{来源文案}：{片段}` |

注意：placeholder 里的 `Esc 关闭` 现况已有，保留；`（⌘K 关闭）` 只出现在未输入查询的
状态行里，因为状态行在输入框下方、更可能被新用户读到。

### 5.4 焦点

- 打开浮层 → 焦点进输入框（现况不变）。
- `Tab` 从输入框走到第一枚 chip，再到第二枚……最后走进结果行；`Shift+Tab` 反向。
- 关闭浮层后焦点归还顶栏放大镜按钮（现况不变，由宿主 `AppShell` 负责）。
- chips 不设 `tabindex="-1"`；禁用态不存在（过滤器任何时候都可点）。

## 6. 稳定锚点（e2e 与真机门禁）

只给 `data-probe` 属性，**不依赖 CSS Module 哈希类名**。

| 锚点 | 挂在哪个元素 | e2e / 门禁用途 |
| --- | --- | --- |
| `data-probe="search-filters"` | 过滤条容器 `<div role="group">` | 过滤条在场、在输入框下方 |
| `data-probe="search-filter-chip"` + `data-source="{all\|user\|assistant\|tool-output\|file-path\|error}"` | 每枚 chip `<button>` | 按 `data-source` 精确点选，不靠文案 |
| `data-probe="search-status"` | 状态行 `<p role="status">` | 条数与索引进度的文本对账 |
| `data-probe="search-result"` | 每个结果行 `<button>` | 行数、行高、点击目标 |
| `data-probe="search-source"` + `data-source="{五类之一}"` | 行内标签 `<span>` | 断言行首标签在场、文案与来源一致 |
| `data-probe="search-snippet"` | 行内片段 `<span>` | 片段在场；路径片段的 `ltr` / 等宽由样式判据断言 |

锚点约束：

- `data-source` 的值就是 `SearchSource` 的字面量，`全部` chip 用 `all`；
  e2e 断言 `[data-probe="search-result"] [data-probe="search-source"][data-source="file-path"]` 这类精确选择器。
- 来源标签的可见文案必须与 `data-source` 一一对应，映射表写死为
  `{user: 我, assistant: 助手, "tool-output": 工具输出, "file-path": 文件路径, error: 错误}`，
  e2e 逐项断言，防止文案与数据脱节。
- 结果行不新增 `data-item-index` 之外的属性（现况的 `data-item-index` 保留，键盘滚动靠它）。

## 7. 交互与边界状态表

| # | 状态 | 过滤条 | 结果 | 状态行 |
| --- | --- | --- | --- | --- |
| 1 | 打开浮层、无查询 | 全部选中、`全部` 选中 | 空 | `搜索会话消息、工具输出与文件路径（⌘K 关闭）` |
| 2 | 输入查询、索引完成、有命中 | 不变 | 每条带来源标签 | `{hits} 条命中 · 已索引 {entries} 条` |
| 3 | 输入查询、索引构建中 | 不变 | 已索引部分命中 | `{hits} 条命中 · 已索引 {entries} 条` |
| 4 | 索引完成、无命中 | 不变 | 空 | `没有匹配的记录 · 已索引 {entries} 条` |
| 5 | 索引构建中、无命中 | 不变 | 空 | `索引构建中 {indexed} / {total} 会话 · 已索引 {entries} 条 · 稍后再试或先用已索引部分` |
| 6 | 只选「文件路径」 | `文件路径` 选中、其余未选 | 只剩 `file-path` 行 | 同 #2 / #4 |
| 7 | 五个来源全不选（点掉 `全部`） | 六枚全未选 | 空 | `没有匹配的记录 · 已索引 {entries} 条` |
| 8 | 输入 `路径:foo` | 自动只剩 `文件路径` | 只剩路径命中，查询串为 `foo` | 同 #2 |
| 9 | 关闭再打开 | 重置为全部选中 | 空 | 同 #1 |
| 10 | 同一条记录同时含消息与工具输出 | 不变 | 只出现一行，来源按优先级取 | 同 #2 |

表里没有的文案与状态不许出现在实现里。

## 8. 验收矩阵

| 层 | 用例 | 断言要点 |
| --- | --- | --- |
| 纯函数单测 | 三类新来源各一条命中 | `tool-output` / `file-path` / `error` 各命中一次 |
| 纯函数单测 | ANSI 不进 haystack | 含 SGR 的工具输出，`haystack` 里没有 `\u001b`（正则 `\^\[`） |
| 纯函数单测 | `isError` 互斥 | 同一条 `isError` 记录只有 `error` 一个条目，没有 `tool-output` |
| 纯函数单测 | 跨来源去重与优先级 | 同记录同查询只出一行；四档优先级逐个验证 |
| 纯函数单测 | `truncated` 上限 | 超长工具输出被截到 `INDEX_TEXT_LIMIT`，`truncated === true` |
| 纯函数单测 | 来源过滤 | `sources={file-path}` 时结果里没有 `user`/`assistant`/`tool-output` |
| 组件单测 | 五类标签文案与配色类 | 逐来源断言可见文案；`file-path` 走强调色类 |
| 组件单测 | 过滤器默认态 | 六个 chip 全在、五个来源选中、`全部` 选中 |
| 组件单测 | 过滤切换 | 点 `文件路径` 后结果只剩路径行；`aria-pressed` 正确 |
| 组件单测 | `全部` 快捷开关 | 点一次清空、再点恢复 |
| 组件单测 | 前缀 | 输入 `路径:foo` 后查询串为 `foo` 且只剩 `文件路径` 选中 |
| 组件单测 | `aria-live` | 状态行 `role="status"`；条数变化后文本更新 |
| 组件单测 | 行可访问名 | `文件路径：…` / `错误：…` 前缀逐字断言 |
| 组件单测 | 路径片段样式 | 读 `.module.css` 断言 `--font-mono`、`nowrap`、`ellipsis`、未出现 `direction: rtl` |
| e2e | 错误文本命中 → 回车定位 | 搜错误串 → 结果带「错误」标签 → 回车进入会话、详情面板打开且记录被高亮 |
| e2e | 文件路径命中 → 标签 + 过滤 | 搜路径 → 结果带「文件路径」标签 → 点 `文件路径` chip 后消息类命中消失 |
| e2e | 五类标签对照 | 逐来源夹具，断言标签文案与 `data-source` 一致 |
| e2e | 主题与溢出 | 浅色 / 深色下过滤条不折行、结果行不横向溢出 |
| GUI 真机 | 搜索浮层几何（现况） | 保留；浮层仍完整在窗口内 |
| GUI 真机 | 来源标签结构事实 | 打开搜索并输入一个夹具命中词后，探针收集 `sourceLabels[]`，至少一条非空且属于五类 |

变异验证（每类各做一次）：把 `tool-output` / `file-path` / `error` 任一类从
`entryOfSession` 关掉，对应用例必须变红。

命令按仓库规范执行：`npm --prefix web test`、`npm --prefix web run build`、
`npm --prefix web run test:e2e`、`./scripts/gui-test.sh --build`、`./scripts/lint.sh`，
以及改动 `src-tauri` 探针后的 `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、
`cargo test`。

## 9. GUI 门禁说明（能不加步骤就不加）

契约要求「必要时加一条命中带来源标签的结构事实」。裁决：

- **不加新的点击步**。默认清单里 `全局搜索` 会出现两次（开 / 关），在**开的那一次**
  的探针里顺手多收一个事实即可，不新增 CAPTURE 目标。
- 现状的搜索步**没有输入查询**，因此结果区是空的；要收到来源标签，探针需要在该步
  向 `[role="dialog"][aria-label="全局搜索"]` 内的输入框写入一个夹具里必然命中的词
  （例如 `/repo/ansi` 夹具里的 `构建失败`），等一拍再采集。字数与等待窗口由实现者按
  现有 `PROBE_JS` 的节奏定，采集失败只记 `NOTE`，不改判定。
- 事实字段固定为：`filtersVisible`、`filterChipCount`、`sourceLabels[]`
  （`{data-source, text}` 的数组）、`resultRowCount`、`statusText`。
- 判定只加两条：`filterChipCount === 6`；`sourceLabels` 至少一条且 `data-source`
  属于五类。搜索浮层几何与 dialog 分流的既有判定一个字不改。

## 10. v1 不做什么

- 不做模糊匹配、正则、通配符、TF-IDF / 任何排名。子串语义不变。
- 不做搜索历史、最近搜索、结果缓存落盘、索引落盘、增量持久化（#147 红线）。
- 不做「按来源分组」的结果区块切换（分组仍是 项目 → 会话 → 记录）。
- 不做按项目 / 时间 / 模型的搜索过滤；本轮只加**来源**一个维度。
- 不做多行片段、片段高亮加粗、路径语法着色。
- 不做路径脱敏，也不因此新增任何落盘（§3.4 的豁免与约束成对存在）。
- 不做 chips 的方向键导航，不改 chips 的 Tab 可达性。
- 不做过滤器的记忆（关闭即重置），不做第二个 live region。

## 11. 实现者清单

1. **索引层**：改 `web/src/features/search/searchIndex.ts`，按 #147 契约把
   `SearchSource`、`SearchEntry.source`、`truncated`、`SearchFilter` 落到类型与
   `entryOfSession` 里；工具输出先 `stripAnsi` 再截到 `INDEX_TEXT_LIMIT`
   （常量写在模块顶部并注释）；文件路径走 `structuredResult.filePath` 与
   `toolInput` 的结构化键；`isError` 只进 `error`。
2. **去重与过滤**：`searchEntries` 新增第四参数 `filter?: SearchFilter`，
   **先按 `filter.sources` 裁剪条目再判重**；同记录同查询按
   `user/assistant > file-path > error > tool-output` 只留一条。
   `GlobalSearchIndex.search` 透传；新增 `entryCount` getter（= `size`）。
3. **索引单测**：扩 `searchIndex.test.ts`，覆盖 §8 的前六条纯函数用例；
   `INDEX_TEXT_LIMIT` 与 `truncated` 用超长夹具断言；ANSI 用例断言 `haystack`
   里没有 `\u001b`。三类来源各做一次「关掉就红」的变异验证。
4. **进度 hook**：改 `useSearchIndex.ts`，返回值加 `entries: number`，
   其余不动；老调用点（仍解构 `{ indexed, total }`）零改动。
5. **浮层**：改 `SearchPalette.tsx`，按 §1 / §2 / §3 / §5 实现标签、chips、
   前缀剥离、`aria-label` 模板与 `role="status"`；保证焦点在 chip 上时 `Enter`
   只切档不跳转；结果行 DOM 顺序为 标签 → 片段 → 时间；每个锚点照 §6 加。
6. **浮层样式**：改 `SearchPalette.module.css`，新增 `.filters` / `.chip` /
   `.chipActive` / `.source` / `.sourceFilePath` / `.snippetPath`；所有颜色只取
   §1.2 与 §2.4 列的令牌，不写字面量颜色、字面量高度、字面量圆角。
7. **组件单测**：扩 `SearchPalette.test.tsx`，覆盖 §8 的组件条；样式判据读
   `.module.css` 文本（同 `LogView.test.tsx` 的判法），断言路径片段用
   `--font-mono`、`nowrap`、`ellipsis`，并断言 CSS 文本里不出现 `direction: rtl`。
8. **e2e**：新增或扩展 `web/e2e/search*.spec.ts`，覆盖 §8 的三条 e2e；
   夹具新造（不要污染既有 `messageJsonl` 场景），错误与路径的命中串各一。
9. **GUI 探针**：按 §9 在 `src-tauri/src/lib.rs` 的搜索 dialog 事实里追加五个字段，
   不改判定清单长度；`scripts/gui-test.sh` 只加 §9 的两条判据。
10. **文档**：`CHANGELOG.md` 的 `[Unreleased]` 加一条中文 `Added`；
    `README.md` 与 `README.zh-CN.md` 把「消息级检索」改成四类来源；
    `docs/USAGE.md` 的「快捷键与全局搜索」一节补来源过滤器与五类标签。
11. **体积账**：用仓库夹具 + 一个合成的大工具输出会话，在 PR 描述里给出
    索引条目数、haystack 总字符数、UTF-16 估算字节量与相对现状的倍数
    （#147 的硬要求）。
12. **验收命令**：跑 §8 的全部命令；`./scripts/lint.sh` 若只差 zizmor，
    按既有说明记录；真机门禁必须真的启动打包后的 `.app`，并亲自看
    搜索浮层那一步的探针 JSON 与截图。

清单里没有的字符串、锚点、档位或交互协议不许进入实现。
