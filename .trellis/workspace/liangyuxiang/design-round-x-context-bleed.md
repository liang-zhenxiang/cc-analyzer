# 「出血点」界面规格（Round X）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 状态：待主会话独立评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（主会话已锁定）：在会话详情页已有 `日志视图 | 树视图 | 上下文 | 改动` 四标签之后
> 新增第五标签 **「出血点」**——把「这次会话哪里烧钱」变成一份**可执行的整改清单**。
> **本文件只描述设计与断言，不改任何源码。**
>
> **与同目录既有规格的关系（请先读这一段）**：
> 本文件是 `design-round-x-context-bleed.md` 的**完整替换稿**。该文件的前 217 行是主会话在
> 「原定的设计师 agent 长时间运行后未产出文档」的判断下写的**占位稿**。占位稿做了大量
> 正确的核实工作（行号级契约、`evidence: "countOnly"` 的诚实降级、`droppedTokens` 量纲
> 的自我纠正），**这些结论全部被本文件继承并在 §9 逐条标注**；占位稿缺少的部分
> （§0 逐字读过清单、§1 信息架构与「上下文」标签页的分工、§2 逐块几何与被否方案、
> §3 逐字文案表、§4 六类判定口径、§5 对比度实算、§6 无障碍、§7 断言清单、§8 反例与红线自查）
> 由本文件补齐。**体例母本是 `design-round-w-live-pulse.md`**（章节骨架、换算表、
> 四主题对比度实算、data-probe 锚点清单、明确不做、实现者清单都照它）。

英文 key：`context-bleed`；分支：`feat/context-bleed`。

---

## 0. 语境与现状（写前逐字读过）

### 0.1 读过的文件（逐字，不是印象）

**设计令牌与视觉契约**

- `web/src/styles/tokens.css`（483 行，全文四块主题：`:root` / `[data-theme="dark"]` /
  `[data-contrast="high"]` / `[data-theme="dark"][data-contrast="high"]`）
- `web/src/styles/global.css`（63 行）、`web/src/styles/animations.css`（73 行）
- `web/src/features/usage/charts/chartPrimitives.tsx`（97 行）+ `chartPrimitives.module.css`（30 行）
- `web/src/features/usage/charts/BarChart.tsx`（98 行）+ `.module.css`
- `web/src/features/usage/charts/StackedBar.tsx`（70 行）+ `.module.css`
- `web/src/features/usage/charts/HBarChart.tsx`（68 行）+ `.module.css`
- `web/src/features/usage/charts/Heatmap.tsx`（105 行）+ `.module.css`
- `web/src/features/usage/charts/Gauge.tsx`（84 行）+ `.module.css`

**同类页面的既有体例（新页面必须与它们像一家人）**

- `web/src/features/sessions/ContextView.tsx`（488 行）+ `ContextView.module.css`（184 行）——**最接近的邻居**
- `web/src/features/sessions/ChangedFilesView.tsx`（459 行）+ `.module.css`（410 行）
- `web/src/features/sessions/SessionAnalyzerPage.tsx`（631 行）+ `.module.css`（106 行）
- `web/src/features/sessions/CompactionPanel.tsx`（207 行）+ `.module.css`（205 行）
- `web/src/features/sessions/DroppedList.tsx`（161 行）+ `.module.css`（146 行）
- `web/src/features/sessions/TokenPanel.tsx`（136 行）+ `.module.css`（104 行）
- `web/src/features/sessions/LogView.tsx`（685 行）+ `.module.css`（418 行）
- `web/src/features/usage/CompactionStatsPanel.tsx`（121 行）+ `.module.css`
- `web/src/features/usage/ErrorOverviewSection.tsx`、`ErrorRankList.tsx` + `.module.css`
- `web/src/components/`：`Panel`（41 行）、`EmptyState`（40 行）、`ErrorState`、`Skeleton`、
  `SegmentedControl`（130 行）+ `.module.css`（67 行）、`Button`（46 行）、`Icon`（67 行）、
  `ScrollArea`（99 行）、`BrandMark`、`StatusToast`、`TextInput`、`AnsiText`
- `web/src/features/usage/ProvenanceBadge.tsx`（33 行）+ `.module.css`、`provenance.ts`（19 行）

**数据契约（只允许在既有数据上设计）**

- `web/src/features/sessions/types.ts`（274 行，全文）
- `web/src/features/sessions/tokenTotals.ts`（88 行，全文）
- `web/src/features/sessions/contextSeries.ts`（70 行，全文）
- `web/src/features/sessions/droppedMessages.ts`（79 行，全文）
- `web/src/features/sessions/changedFiles.ts`（169 行，全文）
- `web/src/features/sessions/structuredToolResult.ts`（95 行，全文）
- `web/src/features/sessions/measuredRows.ts`（69 行，全文）
- `web/src/features/sessions/contextCurve.ts`（206 行，全文）
- `web/src/features/sessions/useRowNavigation.ts`（58 行，全文）
- `web/src/features/sessions/virtualWindow.ts`（104 行，全文）
- `web/src/features/sessions/parseJsonl.ts`（674 行，重点段逐字）
- `web/src/features/sessions/logRows.ts`（571 行，重点段逐字）
- `web/src/features/sessions/sessionHealth.ts`（46 行，全文）
- `web/src/features/sessions/costProvenance.ts`（30 行，全文）
- `web/src/features/usage/pricingSnapshot.ts`（全文）
- `web/src/features/usage/usageAggregations.ts`（`UsageTotals` 定义段）
- `web/src/lib/format.ts`（154 行，全文）

**真机门禁基础设施**

- `src-tauri/src/lib.rs`（`gui_probe::PROBE_JS` 全文与逐块断言守卫测试）
- `scripts/gui-test.sh`（2524 行，判定段）
- `web/tests/fixtures/`（20 个 `.jsonl` 全清单 + 行数）

**体例参照**

- `.trellis/workspace/liangyuxiang/design-round-w-live-pulse.md`（1061 行，全文）
- `.trellis/workspace/liangyuxiang/design-round-v2-day-review.md`（1104 行）
- `.trellis/workspace/liangyuxiang/design-round-u-high-contrast.md`（932 行，对比度章程来源）

### 0.2 核实到的既有事实（后文反复引用，全部有行号）

**F1｜四类 token 计数器永不折叠。**
`web/src/features/sessions/tokenTotals.ts:3-13` 的文件头注释逐字：真实会话里 `cache_read`
比 `input` 高一个数量级、比 `output` 高三倍，四个计数器求和后
「their sum describes nothing a reader could act on」。
`TokenTotals.total` **只做占比分母，从不展示**——注释逐字「the share denominator, never displayed」。

**F2｜缺字段是零，不是未知；但 `usage` 整个缺失是另一回事。**
`web/src/features/sessions/types.ts:20-29` 的 `SessionUsage` 注释写明四个计数器各自独立、
缺字段记 0。而 `tokenTotalsOf`（`tokenTotals.ts:65`）对**无 `usage` 的记录直接 `continue`**
（`tokenTotals.ts:68-70`），所以「这条记录没有用量」在求和结果里**不可见**。
本文件的每一类判定都必须避开这个歧义（§4.9）。

**F3｜`resultTruncated` 是「工具结果被 5 KB 截断」的可靠布尔。**
`parseJsonl.ts:104` `const TOOL_RESULT_LIMIT = 5 * 1024;`；
`toolResultText()` 超限时截断并附加
`[Truncated: showing first {retained} of {total} characters]`；
赋值点 `parseJsonl.ts:634-635`
`pending.toolResult = result.text; pending.resultTruncated = result.truncated;`。
**推论（本文件最重要的一条诚实约束）**：`record.toolResult` 的长度**上限就是 5 KB**，
所以「这条工具结果原本有多大」**在数据里不存在**。任何「超大工具结果 = X KB」的数字都是编的。

**F4｜`usage` 只挂在 assistant 记录上；`tool` 记录没有 `usage`。**
`parseJsonl.ts:514` 把 `usage` 写到 assistant 记录上；`parseJsonl.ts:566-581` 构造 tool 记录时
**不写 `usage`**。因此「某次工具调用占了多少上下文」**没有直接字段**——占位稿 §3.3 B 已核实
并据此设立了 `evidence: "countOnly"`。**本文件继承这个裁决，并把它推广到另外三类。**

**F5｜`ContextSample.contextTokens` 不含 output。**
`contextSeries.ts`：`contextTokens = (inputTokens ?? 0) + (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0)`。
曲线口径与 `ContextView` 的坐标轴脚注同款（逐字：「横轴 = 模型消息序号（非墙钟时间）·
纵轴 = 该次调用喂给模型的 token 总量（输入 + 缓存写入 + 缓存读取，与日志表「提示词」同口径）」）。

**F6｜压缩锚点可能缺失。**
`compactionAnchors(samples, events)`：`beforeIndex` 优先用 `event.logicalParentUuid` 在 samples
里命中，否则回落「最后一个 timestamp ≤ 事件时间的样本」，**都找不到时给 `-1`**；
`afterIndex = beforeIndex + 1`（无后继时等于 `samples.length`）。
`-1` 与 `samples.length` 都是**合法的越界值**，消费方必须自己夹紧。

**F7｜被丢清单的口径与分母。**
`droppedMessages.ts`：某边界丢出的内容 = 该边界**之前出现过**的全部消息（主链 + 侧链按
timestamp 合并，排除 `compactSummary === true`）− `survivedUuids`；同一消息只在**首次**被丢的
边界下列出；`contextCount = context.size` 是「幸存 N/M 条」的**分母**。切割线取
`samples[anchor.beforeIndex].timestamp`（**不是**边界时间戳——真日志里边界先写盘、
后续消息带更早时间戳）。

**F8｜`droppedTokens` 与「按记录求和」量纲不同（占位稿已自我纠正，此处确认）。**
`parseJsonl.ts:196` 的 `cumulativeDroppedTokens` 是**上下文窗口体积**且**累计**；
`tokenTotalsOf(丢出的记录)` 是**四类计费量之和**，被 `cacheRead` 主导（同一段历史每轮重读）。
占位稿实测两者在夹具上相差 **24 倍**，且该比例**正常且恒定**。
**本文件据此禁止把两个数并排比较**（占位稿 §3.3 A 的结论逐字继承）。

**F9｜`changedFiles` 的口径边界。**
`changedFiles.ts`：只聚合 `Edit` / `NotebookEdit` / `Read` / `Write`，**`Bash` 不参与**；
失败调用（`isError`）不计 counts 但保留 `recordIds`、且 `firstAt`/`lastAt` **含**失败调用；
`sidechainCount` 只统计**成功**的侧链调用；排序 `b.lastAt - a.lastAt || 路径`。
`FileActivity` **没有「读取范围」也没有 token 字段**——重复度只能由 `reads` 自己表达。

**F10｜配色资产已经占满，且有两组严禁互借。**
`tokens.css` 的 `--cat-*` 注释逐字：「不要借去表达非类别语义，那会同时毁掉『类别』和
『被借用的那个维度』」；`--chart-*` 注释逐字：「与 `--cat-*` 是两套资产、严禁互借……
再借去表达项目/模型/日期，两个维度会一起失效」。
已占用的维度：`--cat-*`（记录类别）、`--chart-*`（系列顺序）、`--cal-1..4`（日期成本四分位）、
语义三色（确定性）、`--accent`（焦点环/链接/选中底，像素占比 < 3%）。
**留给本轮的现成色位是零**（§5.5 由此而来）。

**F11｜发丝边框不得承载要读的图形。**
`--border` / `--border-strong` 是 rgba 半透明：复合到面板底后浅色 **1.23 / 1.47**、
深色 **1.20 / 1.52**（Round W §8.3 实算，等效十六进制也在那张表里）。
它们只能做层级提示。

**F12｜间距只有八档，描边与图形尺寸豁免。**
`tokens.css` 头部注释逐字豁免：「描边宽度与图形尺寸不受此约束（焦点环 2px、选中竖条 2px、
类型徽标 3px、占比条 6px、色块 8/10px 等）——它们是『形』不是『距』」。

**F13｜`--text-faint` 只有 2.6:1。**
注释逐字：「faint 只有 2.6:1，只放不需要读的装饰字」。
既有用法只有一处先例：`ChangedFilesView` 的零读数「—」（`.countZero`）。

**F14｜尺寸与字号的缩放契约。**
`--font-scale` 是**唯一**缩放旋钮（90%–130%）；字号 4 级 + 1 保留级，
**必须成对乘 `--font-scale`**；间距、图标、表盘尺寸**不跟缩放**。
`ChangedFilesView.module.css` 有一条由此产生的教训：`.recordTime` 的 `min-width: 88px`
在 130% 下装不下 mono 时间串会折行，折出的第二行把行高顶出 `--row-h`。

**F15｜列轨道必须是常量。**
`ChangedFilesView.module.css:80` 的注释逐字：「除 1fr 外每条轨道都必须恒定」
「任何 auto/max-content 轨都会逐行解析——不只它自己变宽，它还会把 1fr 的余量偷走、
把夹在中间的三列整体推来推去（实测：行尾 59px 的子 agent chip 轨让三列整体左移 59px）」
「无列间距时数字还会贴死（"4 2" 读作 "42"）」。本文件 §2.3 的列模板照此执行。

**F16｜会话级口径的标签页不渲染时间线与筛选。**
`SessionAnalyzerPage.tsx:492-506` 注释逐字：「上下文 / 改动标签页不渲染时间线与筛选：
两者的口径都是会话级全量（压缩取证 =「压缩点之前全部消息 − 幸存清单」；
改动清单 =「通过文件工具动过的文件」），记录级筛选会让口径漂移」。
**「出血点」同属会话级全量，必须加入这条短路。**

**F17｜新标签页的三处挂载点。**
`SessionAnalyzerPage.tsx:42` `type AnalyzerView`、`:44-49` `ANALYZER_VIEW_ITEMS`、
`:51-60` `readStoredView()` 的白名单（逐字
`return stored === "tree" || stored === "context" || stored === "changes" ? stored : "log";`）。
漏掉白名单 → 刷新后标签跳回日志视图。另需在 `:535-569` 的渲染分派链里显式插入分支
（**else 分支当前被 `ContextView` 占着，不要覆盖它**）。

**F18｜「有数据的零」的既有先例。**
`ContextView.tsx:470-472` `<EmptyState size="inline" title="本会话未发生压缩——上下文从未重置" />`；
「一段话代替一张空图」的另一个先例是 `CompactionStatsPanel.tsx`：
`` `近 ${days} 天没有压缩记录——没有会话触发过上下文重置。` ``。

**F19｜同时压缩统计面板已经吃过「自动/手动」的教训。**
`CompactionStatsPanel.module.css` 的内联注释逐字：slots 用 `chart-1 × chart-4` 是设计 §1-8
核过的（两主题下 CVD ΔE 21–24），「相邻的 chart-1/2 在深色下坍缩（3.7），不允许」。
Round W §8.3 表 D 实算 `--chart-1` vs `--chart-4` 相邻比值只有 **1.13–1.46**——
**1px 线上读不出来**，所以本文件**不给任何出血点类别上色**（§5.5）。

**F20｜`ProvenanceBadge` 是一枚 10px 圆点，不是填充药丸。**
`ProvenanceBadge.module.css`：`logged` → `--success`，`estimated`/`inferred` → `--warning`，
`snapshot` → `--text-tertiary`。`aria-label` 与 `title` 都是 `数据来源：{label}{，detail}`，
档位文字进 `.srOnly`。`PROVENANCE_LABELS` 逐字：`读自日志` / `按定价快照估算` / `定价快照` /
`按消耗速度推算`。

**F21｜定价信息与一处陈旧注释的冲突（已核实）。**
`web/src/features/usage/pricingSnapshot.ts` 存在且可用：`PRICING_AS_OF = "2026-10-01"`；
`MODEL_PRICING` = opus `{input:15, output:75, cacheWrite:18.75, cacheRead:1.5}`、
sonnet `{3, 15, 3.75, 0.3}`、haiku `{1, 5, 1.25, 0.1}`（USD/MTok）；
`pricingFamilyFor(model)` 按前缀 `claude-opus` / `claude-sonnet` / `claude-haiku` 匹配，
其它返回 `null`；`estimateCost(totals, model): { usd } | { unknownModel: true }`。
**但** `web/src/features/sessions/costProvenance.ts` 的注释说「本应用不带价格表，本地估算阶梯
被刻意留空」——**这处注释是旧的**。本文件以 `pricingSnapshot.ts` 的**代码**为准，
并在 §8.6 第 9 条要求顺手修正那句陈旧注释。

**F22｜`Icon` 只有 6 个。**
`IconName = "sun" | "moon" | "settings" | "refresh" | "search" | "close"`（`Icon.tsx`，
注释「刻意不引入图标库」）。**本轮不得假设火焰/剪刀/警告类图标存在**，
新图形一律用内联 SVG 或既有字符（`◆` 在 `CompactionPanel` 已有先例）。

**F23｜`data-probe` 锚点是真机取证的唯一稳定接口。**
`src-tauri/src/lib.rs` 的 `PROBE_JS` 头注释逐字：「只收集事实，不含任何断言或阈值——
判定属于测试脚本，应用不该携带测试门槛」。锚点**挂稳定属性不挂可见文案**
（`Gauge.tsx` 注释逐字：「`aria-label` 是随读数变化的文案，靠它匹配会在文案改动后静默失配」）。
Rust 侧每个锚点族有一条 `PROBE_JS.contains(...)` 守卫测试。
`lib.rs` 里有一条反面教训被写成回归守卫：`assert!(!PROBE_JS.contains("changesView.closest"))`
——用 `closest('section')` 会走**祖先链**，而 Panel 的 `section` 是**子元素**，
真机上导致 `declaredCount` 永久为 null。

**F24｜`gui-test.sh` 的兜底 `点选=` 块要求逐一点名。**
判定段逐字注释：「**每加一个「点选=」目标都要在这里点一次名**」。
该块还断言取证卡完整落在视口内、被丢清单是**真列表**（`abs(scroll_h − declared × row_h) > 4`
即失败；有 pad 时 `abs(scroll_h − (Σpads + visible × row_h)) > 4`）。

**F25｜夹具可用性（决定能否写真数字断言）。**
`web/tests/fixtures/` 共 20 个 `.jsonl`。与本轮相关的：`compact-session.jsonl` **251 行**
（`user` 122 / `assistant` 120 / `system` 2 / `future-widget` 2 / `quantum-latch` 1 /
`progress` 2 / `attachment` 1，**零 `tool_use`**）、`changed-files-session.jsonl` **24 行**
（`Edit` 5 / `Read` 3 / `Write` 1）、`session-token-usage.jsonl` **6 行**、
`session-subagent.jsonl` **3 行**（含 `Agent` 1 次）、`pulse-compact-{none,two,three,six}.jsonl`
（4 / 6 / 15 / 18 行）、`tool-census-session.jsonl` 31 行、`error-session.jsonl` 21 行。
**关键推论**：`compact-session.jsonl` 里**零 `tool_use`**，所以「工具类」出血
**无法**在该夹具上产生非零计数；工具类的数字断言必须另选夹具
（`changed-files-session.jsonl` 或 `tool-census-session.jsonl`）。

### 0.3 既有令牌的可用量表（哪些能用、哪些被硬规则禁止）

| 用途 | 可用令牌 | 判定依据 |
| --- | --- | --- |
| 读数、主文案 | `--text` | 四主题 17.79 / 16.15 / 21.00 / 18.73，全过正文 ≥7 |
| 次要素描、行标题 | `--text-secondary` | 7.87 / 9.44 / 14.34 / 13.66，全过 ≥4.5 |
| 标签、脚注、caption、表头 | `--text-tertiary` | 4.78 / 5.83 / 10.45 / 10.74，全过 ≥4.5 |
| 零读数的「—」 | `--text-faint` | 2.77 / 2.71 / 7.06 / 7.30；**只放装饰字**（F13），本文件唯一允许的用处是零值占位 |
| 面积填充分档 | `--chart-1-soft` 的不透明度阶梯 | `Heatmap` 先例：`OPACITY_STEPS = [0, 0.3, 0.5, 0.68, 0.84]`，最热一档也不是实色 |
| 占比条描边、字形、小徽标 | `--chart-1` 实色 | `BarChart.module.css` 注释：大面积填充只许 `-soft`，实色只给描边/点/小徽标 |
| 估算标注点 | `--warning` | 语义三色：`--warning` = **非确定信息**，正是「估算金额」的语义位 |
| 事实标注点 | `--success` | 语义三色：`--success` = 确定的读数 |
| 焦点环、选中底 | `--accent` / `--accent-soft` | 像素占比 < 3% |
| **禁止**：类别区分 | `--cat-*` | F10 逐字：不得借去表达非类别语义 |
| **禁止**：系列/项目/模型着色 | `--chart-2..6` | F10 逐字：借去表达项目/模型会「两个维度一起失效」 |
| **禁止**：图形描边用边框色 | `--border` / `--border-strong` | F11：1.20–1.52，读不出 |
| **禁止**：新色位 | — | 本轮**零新增颜色令牌**（§5.5 逐候选排查后裁决） |

---

## 1. 信息架构

### 1.1 与「上下文」标签页的分工（本轮的立身之本）

两个标签页**读同一批原料**（`contextSeries` / `compactionAnchors` / `droppedByEvent`）。
如果不把分工写死，它们必然长成同一件事的两种画法。分工如下：

| | 「上下文」标签页（既有） | 「出血点」标签页（本轮） |
| --- | --- | --- |
| 回答的问题 | **什么时候**涨到要压缩、压缩掉了多少 | **这些 token 的来路**、**哪些可以避免**、**下一步做什么** |
| 时间性 | 沿**时间轴**（模型消息序号），有形状 | **无时间轴**，只有排序后的清单 |
| 主语 | 会话（一整条曲线） | **一笔笔出血**（每条可下钻到记录） |
| 数字形态 | 曲线 + 峰值读数 + 压缩取证卡 | **表格行**，每行四类计数器分开 + 计数 |
| 结论 | 无判定，只有事实（峰值 N tok、压缩 #k） | **有判定**：标出「可避免 / 难避免 / 不可避免」并给一句动作 |
| 用户动作 | 看形状 → 点事件条看取证 | 看清单 → 照着「下一步」做 |

**一句话边界**：`上下文` 画的是**压力本身**；`出血点` 列的是**压力的成因与账单**。
前者有一条曲线，**后者一条曲线都不许有**（§5.1 具体裁决）。

**为什么不做成「上下文」标签页里的第二块**：`ContextView` 已经吃掉整页高度
（压缩事件区 `flex: 1 1 0; min-height: 180px` 把剩余高度全拿走），再加一块会把两块都压到
不可读；而且「**有判定**的内容」与「**纯事实**的曲线」在同一屏里，读者无法判断哪一句是
日志事实、哪一句是本视图的判定——这是诚实口径的直接冲突（F1 + §2 红线第 3 条）。

### 1.2 页面骨架

```
SessionAnalyzerPage（第五项标签「出血点」）
└─ BleedView  [data-probe="bleed-view"]
   ├─ Panel「出血点清单」  [data-probe="bleed-panel"]
   │    ├─ Panel actions：结论读数 + ProvenanceBadge   [data-probe="bleed-headline"]
   │    ├─ 口径脚注（常显，面板顶）                     [data-probe="bleed-scope"]
   │    ├─ 表头行（六轨）                              [data-probe="bleed-head"]
   │    ├─ 滚动容器 = 真列表                            [data-probe="bleed-list"]
   │    │    └─ 每条出血一行（可展开下钻）               [data-probe="bleed-row-{n}"]
   │    │         └─ 下钻区（证据记录 + 承认句）         [data-probe="bleed-drill"]
   │    └─ 面板底脚注（判定口径 + 反例自认）             [data-probe="bleed-footnote"]
   └─ Panel「压缩前那一段」  [data-probe="bleed-precompaction"]
        ├─ 三行读数（不是曲线）
        └─ 一句话结论
```

**两块，不是一块。** 理由：#1「来路」与 #3「断崖前什么最大」是两个**不同分母**的答案
（前者以**会话四类合计**为分母，后者以**压缩前那一段**为分母）。塞进一张表会让读者以为
「压缩前那一段」的占比是对整个会话算的——那正是口径漂移。

### 1.3 顺序与权重

| 序 | 块 | 回答的问题 | 视觉权重 | 顺序理由 |
| --- | --- | --- | --- | --- |
| 1 | 出血点清单 | 来路 + 可避免 + 下一步（问题 1/2/4） | **最高**：唯一的表，行高 `--row-h`，占比条 6px | 用户来这个标签就是要「该改什么」；清单一屏内可扫完 |
| 2 | 压缩前那一段 | 断崖前什么最大（问题 3） | 中：三行读数 + 一句结论，无表无图 | 它是清单里「压缩」那一类的时间切片解释，紧跟其后才读得通 |

**为什么清单在前**：清单是**可执行的**（每行带动作），第二块是**解释性的**。
本轮的命题是「变成一份可执行的整改清单」，所以可执行的部分占首屏。
这与 `ChangedFilesView` 把聚合读数放进 Panel actions、清单独占面板体是同一个取舍。

---

## 2. 每块的视觉规格

### 2.1 出血点清单：形态选择

**形态 = 表格（列固定 + 行可展开）**，复用 `ChangedFilesView` 的表格语言。

**为什么是表格而不是条形图或清单卡**：

| 候选形态 | 否掉的理由 |
| --- | --- |
| 横向条形 Top-N（`HBarChart`） | 它只能表达**一个**数值轴。本轮的每一行有**四类计数器 + 计数**五个数，条形只能挑一个当长度——挑哪个都会把另外四类藏起来，而 F1 明确禁止折叠。**否** |
| 堆叠条（`StackedBar`） | 单条 720×22 的堆叠条能表达「四类构成」，但无法承载「动作」这一列文本，也无法下钻到记录。**否** |
| 卡片清单（每条一张卡） | 卡片会把 6–10 条出血撑成 3 屏，首屏看不到全貌；且全站「清单」的既有画法就是行（`ChangedFilesView` / `DroppedList` / `ErrorRankList`）。**否** |
| 表格（列固定 + 行可展开） | 与本项目「清单不是图表，是事实」的既有范式一致（`ChangedFilesView` 头注释逐字：「本视图零 danger 零 chart-*（它是清单不是图表，是事实不是判定）」）。**选它** |

**「占比条」怎么放**：每行的体积列里放一条 6px 高的水平条——这是本项目**唯一**允许在
表格行里出现的图形（F12 豁免「占比条 6px」）。填充走 `--chart-1-soft` 的不透明度阶梯
（`Heatmap` 先例），**永不用实色填满**——因为行内没有颜色区分维度，实色填满会被读成
「这一类出错了」。**只有 `evidence === "logged"` 的行才画条**（§4 逐类给出）。

### 2.2 出血点清单：几何

| 项 | 值 | 依据 |
| --- | --- | --- |
| 面板 | `Panel`（`--bg-subtle` + `1px --border` + `--r-md`） | `Panel.tsx`：面板画法全站唯一来源 |
| 表头 `height` | `var(--row-h)` = `calc(var(--row-pad-y)*2 + var(--lh-sm))` | 与 `ChangedFilesView` 表头同款 |
| 表头 `background` | `var(--bg-inset)`，sticky `top: 0`，`z-index: 1` | 同 `ChangedFilesView` |
| 表头 `border-bottom` | `1px solid var(--border)` | 同上 |
| 表头文字 | `font-family: var(--font-sans); font-size: var(--fs-xs); line-height: var(--lh-xs); color: var(--text-tertiary); white-space: nowrap` | 同上（表头文字**不参与**轨道度量，F15） |
| 行 `height` | `var(--row-h)`（100% 字号下 **30px**） | `ROW_HEIGHT = 30` 是 `ChangedFilesView` / `DroppedList` 的既有基准 |
| 行 `border-bottom` | `1px solid var(--border)`，末行 `0` | 同上 |
| 行 `padding` | `0 var(--row-pad-x)` | 同上 |
| 行 hover | `background: var(--bg-hover)` | 同上 |
| 行选中/展开 | `background: var(--accent-soft)` + `box-shadow: inset 2px 0 0 var(--accent)` + 该行标题 `font-weight: 600` | 三通道（灰度截图可辨），同 `ChangedFilesView` `.rowOpen` |
| 行 focus | `outline: var(--focus-ring-width) solid var(--accent); outline-offset: var(--focus-ring-inset); box-shadow: inset var(--focus-ring-width) 0 0 var(--accent)` | 同上 |
| 占比条 `height` | **6px** | F12 明文豁免「占比条 6px」（是「形」不是「距」） |
| 占比条 `border-radius` | `var(--r-xs)`（2px） | 同 `ErrorRankList` 的 `.bar` |
| 占比条 描边 | `1px solid var(--chart-1)` | `BarChart.module.css` 注释：实色只给描边 |
| 占比条 填充 | `--chart-1-soft`，按占比分五档不透明度 `[0.30, 0.45, 0.60, 0.75, 0.84]` | 阶梯取自 `Heatmap` 的 `OPACITY_STEPS` 上限 0.84（最热一档也不是实色） |
| 下钻区 `height` | 内容自适应，**不**写死（避开 F14 的折行教训） | — |
| 下钻区 `background` | `var(--bg-subtle)`，`border-bottom: 1px solid var(--border)` | 同 `ChangedFilesView` |
| 下钻区左内边距 | `calc(var(--row-pad-x) + var(--sp-4))` = **26px** | 让下钻内容对齐第二列文字左缘 |
| 面板体 `gap` | `var(--sp-2)`（脚注与表之间） | — |
| 滚动容器 | `flex: 1 1 auto; min-height: 120px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-subtle); scrollbar-width: thin; scrollbar-color: var(--text-faint) transparent` | 逐字继承 `ChangedFilesView` `.scroller` |

### 2.3 出血点清单：列模板（F15 逐字约束下的唯一可行解）

```css
.head, .row {
  display: grid;
  grid-template-columns:
    var(--control-h-sm)      /* 序号 */
    minmax(0, 1fr)           /* 出血点名称 + 动作 */
    5ch                      /* 占比百分比 */
    9ch                      /* 体积读数 */
    4ch                      /* 可避免性字形 */
    var(--col-actions);      /* 下钻箭头 */
  column-gap: var(--sp-2);
  padding: 0 var(--row-pad-x);
  align-items: center;
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
```

**每一轨的论证**（照 F15 的体例逐轨说明）：

- `--control-h-sm`（24px）：序号列。用既有令牌而不是 `24px` 字面量，理由与
  `ChangedFilesView` 用 `var(--control-h-sm)` 当首轨一致——它是「行内小方块的尺寸」，
  不是间距，不进 `--sp-*` 档位（F12）。
- `minmax(0, 1fr)`：**唯一**的弹性轨，装「出血点名称」。`minmax(0, …)` 的 `0` 下限是必须的，
  否则长标题（如「重复读取 · src/features/sessions/SessionAnalyzerPage.tsx · 7 次」）
  会把这轨的最小内容宽顶起来，把后面四轨推出容器。
- `5ch`：占比百分比。百分比**一律取整**（§3 约定），最坏 `100%` 是 4 字符 → `5ch` 有余量。
- `9ch`：体积读数走 `formatTokenCount`，最坏 `999.9K`（6 字符）；`9ch` 给 mono `--fs-sm`
  留出 `1,234,567` 的分组宽度。
- `4ch`：可避免性。**注意它是 px 常量而不是文字宽**——见下。
- `var(--col-actions)`（44px）：下钻箭头。既有令牌（`tokens.css` 列宽组）。

**「可避免性」列必须是字形不是文字**——这是本轮一个明确的裁决。
理由：三档中文（「可避免」/「难避免」/「不可避免」）宽度不一，用 `max-content` 轨会
**逐行解析**（F15 明令禁止），用固定轨又放不下。所以该列渲染为**三个 8px 见方的字形**：

| 档 | 形态 | 令牌 | aria-label |
| --- | --- | --- | --- |
| 可避免 | **实心方块** 8×8 `rx=2` | `--chart-1` 实色（小徽标允许实色） | `可避免` |
| 难避免 | **空心方块** 8×8，1px 描边 | `--chart-1` 描边 + 透明填充 | `难避免` |
| 不可避免 | **一条 8×1 的短横** | `--text-tertiary` | `不可避免` |

三档在**形状**上就分开了（实心 / 空心 / 短线），不依赖颜色——这是 F10「色位已满」约束下
唯一诚实的降级。文字进 `title` 与 `aria-label`（§3.5 逐字给出）。

### 2.4 「压缩前那一段」块：形态与几何

**形态 = 三行读数 + 一句话结论，零图形。**

| 项 | 值 |
| --- | --- |
| 面板 | `Panel title="压缩前那一段"` |
| actions | `<ProvenanceBadge provenance="logged" />` |
| 三行读数 | `display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-2) var(--sp-4)` |
| 读数标签 | `color: var(--text-tertiary); font-size: var(--fs-xs); line-height: var(--lh-xs); white-space: nowrap` |
| 读数数值 | `color: var(--text); font-size: var(--fs-md); font-weight: 600; line-height: var(--lh-md); font-variant-numeric: tabular-nums; white-space: nowrap` |
| 结论句 | `margin: var(--sp-3) 0 0; color: var(--text-tertiary); font-size: var(--fs-xs); line-height: var(--lh-xs)` |
| 窄窗（≤ 880px） | `grid-template-columns: 1fr`（三行竖排，断点照 `CompactionPanel` 的 `@media (max-width: 880px)`） |

**为什么不做成曲线**：这一块要回答的是「断崖前**什么占最大体积**」——那是一个**归因**问题，
不是一个**形状**问题。曲线只能回答「多大」，而「多大」已经在「上下文」标签页里画过了
（`ContextView` 的峰值）。这里再画一条曲线，就是 §1.1 明令禁止的「同一件事的两种画法」。**否**。

**为什么不做成饼图**：本项目**没有任何饼图**，且饼图无法表达分母（F1）。**否**。

**为什么是三行而不是一行**：三行分别是「断崖前那一段的调用次数」/「那一段的提示词总量」/
「其中被丢掉的部分」。三者的分母不同（分别是会话总计、那一段自身、那一段自身），
所以必须分开写，不能合成一个「占比」——这是 §4.3 口径的直接后果。

### 2.5 三处状态版面（加载 / 出错 / 空）

| 状态 | 版面 | 依据 |
| --- | --- | --- |
| 加载中 | `<Skeleton variant="table" rows={4} label="正在分析出血点" />`，**自带** `data-probe-pending` | `Skeleton.tsx`：`role="status"` + `aria-label`，`data-probe-pending` 让真机取证等到算完再截图 |
| 出错 | `ErrorState size="panel" title="读不出这次会话的用量" hint="日志文件可能在读取中被截断——重试一次，或到日志视图确认文件完整。"` | `ErrorState.tsx` 的两条硬规则：`title`/`hint` 给使用者读，原始错误串进 `detail` 且**默认不进 DOM**（它常带 `/Users/...` 绝对路径，用户路径视同敏感数据） |
| 空（三种，分文案） | 见 §3.10 | 「空态」与「有数据的零」必须分开 |

### 2.6 面板 2 不是第二个 live region

`Skeleton` 自带 `role="status"`。面板 2 的读数**不加** `role="status"`——两份重复播报是噪声
（Round W §6.1 同款裁决）。

---

## 3. 逐字文案表

> 约定：下表所有字符串**逐字**进实现，包括标点（中文全角逗号 `，`、间隔号 `·`、
> 破折号 `——`）。`{}` 内是插值表达式。**百分比一律取整**（`Math.round`），
> 因为本视图的占比是「读形状」不是「对账」，两位小数会诱导读者以为它精确到 0.01。

### 3.1 标签页与面板

| 位置 | 逐字文案 |
| --- | --- |
| 分段控件项 | `出血点` |
| `SegmentedControl` 的 `ariaLabel` | `视图切换`（不变，与既有四项同一控件） |
| 面板 1 标题 | `出血点清单` |
| 面板 2 标题 | `压缩前那一段` |
| 面板 1 `ariaLabel` | `出血点清单` |
| 面板 2 `ariaLabel` | `压缩前那一段` |

### 3.2 面板 1 的结论读数（Panel actions）

| 条件 | 逐字文案 |
| --- | --- |
| 有压缩、有四类读数 | `{N} 处出血 · 压缩 {K} 次` + `<ProvenanceBadge provenance="logged" />` |
| 有压缩、含估算金额 | 上一句 + 第二枚 `<ProvenanceBadge provenance="estimated" detail={`快照 ${PRICING_AS_OF}`} />` |
| 无压缩 | `未被压缩划过——没有断崖` + `<ProvenanceBadge provenance="logged" />` |

**为什么是「N 处出血」而不是「共 X tok」**：X 需要把四类计数器求和，F1 明令禁止。
**为什么是「压缩 K 次」**：它是日志事实（`compactEvents.length`），且是本视图与
「上下文」标签页之间**唯一**允许重复的读数——重复的是**一个计数**，不是**一种画法**。

### 3.3 口径脚注（面板顶，常显）

逐字：

```
出血点 = 本会话里「占着上下文但不产出新信息」的那几笔。体积读数来自日志 message.usage，四类计数器分开、不求和；金额按定价快照估算，不是账单。
```

`ChangedFilesView` 的注释逐字：「口径脚注（常显，面板底）：藏起来的口径等于没有口径」——
本视图把口径放**面板顶**，因为它是清单的**定义**（不读它无法理解每一行是什么），
而 `ChangedFilesView` 的脚注是列的定义（读完之后才需要）。

### 3.4 表头列（逐字）

| 列 | 表头文字 | `data-col` |
| --- | --- | --- |
| 1 | `#` | `index` |
| 2 | `出血点` | `name` |
| 3 | `占比` | `share` |
| 4 | `体积` | `volume` |
| 5 | `可避免` | `avoidable` |
| 6 | （空，`aria-hidden`） | `drill` |

表头 `占比` 的 `title` 逐字：

```
各出血点的体积占本会话四类计数器合计的比例；合计本身没有语义，不作为读数展示
```

（与 `TokenPanel` 占比列 `title` 的口径同源，逐字对齐既有措辞。）

表头 `可避免` 的 `title` 逐字：

```
这一笔能不能靠改变做法省下来；形状分别是实心方块（可避免）、空心方块（难避免）、短横（不可避免）
```

### 3.5 行内容（逐字模板）

| 部分 | 逐字模板 |
| --- | --- |
| 序号 | `{index + 1}` |
| 名称（压缩类） | `压缩 #{K} · 丢掉 {M} 条消息` |
| 名称（重复读取类） | `重复读取 · {relPath} · {N} 次` |
| 名称（超大工具结果类） | `超大工具结果 · {toolName} · {N} 次` |
| 名称（工具调用类，`countOnly`） | `{toolName} · {N} 次调用` |
| 名称（重读膨胀类） | `上下文重读 · {N} 次调用 · 在 {M} 条消息里` |
| 名称（子 agent 类） | `子 agent 放大 · {N} 个子会话` |
| 名称（长尾类） | `长尾历史 · {N} 条消息 · 出现在最早 20% 的时间里` |
| 占比（`logged`） | `{Math.round(share)}%` |
| 占比（`countOnly`） | `—`（色 `--text-faint`） |
| 体积（`logged`，`title` 给精确值） | `formatTokenCount(totals.total)`，`title` = `输入 {a} · 缓存写入 {b} · 缓存读取 {c} · 输出 {d}`（各值 `toLocaleString("en-US")`） |
| 体积（`countOnly`） | `—`（色 `--text-faint`） |
| 可避免字形 | 三个字形（§2.3），`aria-label` 分别为 `可避免` / `难避免` / `不可避免` |
| 可避免字形 `title`（可避免） | `可避免——重复的读取或重复的调用，改做法就能省下` |
| 可避免字形 `title`（难避免） | `难避免——为了完成任务必须读入的内容，只能减少重复` |
| 可避免字形 `title`（不可避免） | `不可避免——系统提示词、用户发言与模型输出，不随做法变化` |

### 3.6 行下钻区（逐字）

| 位置 | 逐字模板 |
| --- | --- |
| 下钻标题 | `证据 · {N} 条记录` |
| 下钻行时间 | `formatDateTime(record.timestamp)` |
| 下钻行摘要 | 复用 `logRows` 的既有摘要函数（**不新写摘要逻辑**） |
| 下钻区 `aria-label` | `{出血点名称} 的证据记录` |
| 下钻区空（防御性，正常不可达） | `这条出血点没有可下钻的记录` |

### 3.7 每行的「下一步」动作（§4 逐类给出，此处汇总逐字）

| 类别 | 动作文案（逐字） |
| --- | --- |
| 压缩 | `压缩是上下文重置，不是浪费——请看下面「压缩前那一段」里被丢掉的是什么` |
| 工具调用（`countOnly`） | `{toolName} 调用了 {N} 次：同类的探查合并成一次，或改用更窄的检索（Grep 定位到行）` |
| 重复读取 | `同一个文件读了 {N} 次且一次都没改：先用一次 Read 记住内容，或改用 Grep 定位到行` |
| 超大工具结果 | `{toolName} 的返回被截到 5 KB：把命令的输出收窄（加 -n / --quiet / 限定路径），不要让它整篇进上下文` |
| 上下文重读 | `同一段历史被反复重读：把早先的长讨论压成一句结论再继续，别在旧上下文上叠新内容` |
| 子 agent 放大 | `{N} 个子会话各自把同一批文件读了一遍：把公共背景写在主会话里一次，再交给子 agent` |
| 长尾历史 | `{N} 条消息只在很早出现过一次：考虑换个新会话继续，而不是在旧会话尾部继续加内容` |

**语气规则**（写给实现者）：动词开头、给**具体的替代做法**（`改用 Grep` / `加 -n` /
`换个新会话` / `合并成一次`），**不许**出现「减少 token」「优化上下文」「注意用量」
这类没有动作的句子。这是本轮命题（「一句可执行的具体动作（不是『减少 token』这种废话）」）
的直接要求。

### 3.8 面板 2 的三行读数与结论（逐字）

| 读数标签 | 逐字 | 值模板 |
| --- | --- | --- |
| 1 | `断崖前的调用次数` | `{N} 次` |
| 2 | `那一段的提示词总量` | `formatTokenCount(tokens)` + ` tok` |
| 3 | `其中被丢掉的部分` | `formatTokenCount(dropped)` + ` tok`；`title` 逐字：`按被丢出的消息逐条求和。边界记录自报的累计丢弃量是另一个量纲（窗口体积），不在这里并排` |

结论句逐字模板（按条件择一）：

| 条件 | 逐字文案 |
| --- | --- |
| 有被丢消息 | `断崖前那一段里，被丢掉的最大一类是「{name}」，占被丢内容的 {P}%。` |
| 有压缩但没丢消息 | `这次压缩没有丢出任何消息——上下文是被摘要重写的，不是被截掉的。` |
| 压缩锚点缺失 | `这次压缩在曲线里找不到锚点，无法定位断崖前那一段。` |
| 没有压缩 | `本会话没有发生压缩——上下文从未重置，也就没有断崖前那一段。` |

### 3.9 面板底脚注（判定口径 + 反例自认）——逐字

```
判定只依据日志里已有的字段。工具结果在解析时最长保留 5 KB，所以「这条结果原本有多大」无法得知，本视图不报原始体积。工具调用的 token 量在日志里没有独立记录，因此只报调用次数。
```

**这一句是本轮诚实性的核心**：F3 与 F4 的两处数据缺口**必须在界面上说出来**，
而不是让读者以为「超大工具结果」那一类数字是原始大小。

### 3.10 空态与「有数据的零」（逐字，必须分开）

| 情形 | 组件 | 逐字文案 |
| --- | --- | --- |
| 会话无 `usage`（`samples.length === 0`） | `<EmptyState size="panel" title="没有可分析的用量" description="本会话没有带用量的模型消息。" />` | **空态** |
| 有 `usage` 但四类计数器全为 0 | `<EmptyState size="panel" title="没有可分析的用量" description="本会话的用量计数全为零。" />` | **空态**（与上一行 **description 不同**） |
| 有用量、无压缩、清单为空 | `<EmptyState size="panel" title="没有发现出血点" description="这个会话的上下文没有被反复读取，也没有被压缩划过。" />` | **空态** |
| 有用量、无压缩、清单非空 | 正常渲染清单；Panel actions 走 §3.2 第三行 | **有数据的零**（不显示空态） |
| 某类别的计数为 0 | 该类**不进清单** | 不是「有数据的零」——清单是榜单，零项不进榜 |
| `countOnly` 类的 `totals` 全 0 | **照常进清单**，体积/占比列显示 `—` | **「无法得出」不是空态，也不是零**（占位稿 §4 第 3 条的裁决，继承） |
| 面板 2：无压缩事件 | 面板保留，正文渲染 §3.8 第四行 | **有数据的零**（一段话代替一张空图，`CompactionStatsPanel` 先例 F18） |
| 面板 2：有压缩但无被丢消息 | 面板保留，正文渲染 §3.8 第二行 | **有数据的零** |
| 面板 2：锚点缺失 | 面板保留，正文渲染 §3.8 第三行 | **有数据的零** |
| 行内的零读数 | `—`，色 `--text-faint` | 同 `ChangedFilesView` 零读数先例（F13） |

**「空态」与「有数据的零」的分界规则（写给实现者）**：
**没有可分析的对象 → 空态**（`EmptyState`）；**有对象但某笔读数为零、或某笔读数无法得出
→ 保留面板，写一句事实**。这条规则照 `CompactionStatsPanel` 的既有实现抄。

### 3.11 `aria-label` 与屏幕阅读器通道

| 元素 | 逐字 |
| --- | --- |
| 清单滚动容器 | `aria-label="出血点清单"` |
| 清单整体 | `<ul>`（天然 `role="list"`），行 `<li>` |
| 行的按钮 | `aria-label` = `{名称}，{占比或无法得出}，{可避免档}，{动作文案}` |
| `countOnly` 行的 `aria-label` 第二段 | `体积无法从日志得出` |
| 下钻开关 | `aria-expanded` + `aria-controls`，文案 `展开证据` / `收起证据` |
| 占比条的 `srOnly` 文本 | `占本会话四类合计的 {P}%` |
| 面板 2 的读数 | `<dl>` + `<dt>`/`<dd>`（与 `CompactionPanel` 的语义同款） |
| 图形 | **本视图零 SVG 图表**，所以没有 `role="img"`；三个可避免字形各自 `aria-hidden="true"`，语义由行的 `aria-label` 承载 |

### 3.12 键盘

| 键 | 行为 |
| --- | --- |
| `Tab` | 进入清单一次（roving tabindex：只有当前行 `tabIndex={0}`），再按一次离开到下一块 |
| `↓` / `↑` | 在行间移动（`useRowNavigation` 既有行为） |
| `Home` / `End` | 跳到首行 / 末行（既有行为） |
| `Enter` / `Space` | 展开/收起该行的证据（`onActivate`） |
| `Escape` | 收起已展开的行（`ChangedFilesView` 同款） |

**照抄 `useRowNavigation` + `focusRowIn(container, selector, index)`**，不新写键盘逻辑。
下钻区内的按钮在 `keydown` 上 `event.stopPropagation()`（`ChangedFilesView` 同款防冒泡）。

---

## 4. 出血点的判定口径（本轮的核心）

### 4.0 通用约束（每一类都必须满足）

1. **只依赖 §0.2 列出的既有字段**。任何需要新字段的判定一律降级为「数据不足，不报此条」。
2. **量级口径用四类计数器分开表达**，`total` 只做分母（F1）。
3. **每类必须有反例**：写清什么时候**不报**，以及**什么时候会误报**。
4. **误报必须在文案里如实承认**（§3.9 是总入口，每类下钻区还有各自的承认句）。
5. **不预测**：任何「还能撑多久」「预计下次压缩」的措辞都不许出现。
6. **`evidence` 必须逐条标注**：`logged`（体积读自日志）或 `countOnly`（只能给计数）。
   这是占位稿 §3.1 立的契约，本文件把它当成**贯穿六类的强制字段**。

### 4.1 类别总表

| # | 类别 | `BleedKind` | `evidence` | 可避免档 | 依据字段 | 排序键 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 压缩丢弃 | `compaction` | `logged` | 难避免 | `CompactEvent` + `DroppedBucket` | 体积降序 |
| 2 | 工具调用 | `toolOutput` | **`countOnly`** | 可避免 | `toolName` 计数 | **次数降序** |
| 3 | 缓存重写 | `cacheRewrite` | `logged` | 难避免 | `usage.cacheCreationTokens` | 体积降序 |
| 4 | 重复读取同一文件 | `repeatRead` | **`countOnly`** | **可避免** | `FileActivity.reads` | **次数降序** |
| 5 | 超大工具结果 | `oversizedResult` | **`countOnly`** | **可避免** | `resultTruncated` | **条数降序** |
| 6 | 子 agent 放大 | `subagent` | `logged`（子日志自报） | 难避免 | `Agent.totalTokens` | **不参与排序** |
| 7 | 长尾历史 | `longTail` | **`countOnly`** | **可避免** | 记录条数 + 时间跨度 | **不参与排序** |

**为什么是这七类、而不是更少**：它们分别对应「系统性的」（1、3）、「习惯性的」（2、4、5）、
「结构性的」（6）、「用法性的」（7）四种成因。少于四类会漏掉「可避免」的那一半——
而本轮命题的第二问就是「哪些是可以避免的」。

**`countOnly` 占了七类里的四类**，这是本轮最重要的事实：**上下文出血的大部分体积
在日志里没有独立记录**。本文件不为此编造数字，而是把「计数」当一等公民的读数
（占位稿 §3.3 B 的裁决，本文件把它推广开）。

### 4.2 类别 1：压缩丢弃（`compaction`，`logged`）

**判定规则**：

```
for (index, event) of (parsed.compactEvents ?? []):
    bucket = droppedByEvent(...).get(event.id)     // 参数来源照抄 ContextView 的调用点
    if bucket === undefined or bucket.records.length === 0: continue   // §3.8 第二行承接
    totals = tokenTotalsOf(bucket.records)
    label  = `压缩 #${index + 1} · 丢掉 ${bucket.records.length} 条消息`
    evidence = "logged"
量级 = 每条被丢记录的 tokenTotalsOf(...)，汇总成本类
分母 = 会话四类合计
```

**F8 的禁令（逐字继承占位稿）**：**不要**把 `event.droppedTokens` 拿来跟按记录求和比较，
也**不要**并排显示。两者量纲不同（窗口体积 vs 四类计费量之和），夹具上相差 24 倍是
**正常且恒定的**。面板 2 的第三行读数只显示按记录求和的结果。

**什么时候不报**：
1. `compactEvents` 缺失或为空（→ §3.8 第四行）。
2. **锚点缺失**（`beforeIndex === -1`）→ 本类**仍报**（`droppedByEvent` 会回落），
   但面板 2 走 §3.8 第三行文案。
3. 被丢记录全是 `compactSummary === true` 的（`droppedMessages.ts` 已排除，正常不可达）。

**会误报的地方**：`droppedByEvent` 的口径是「该边界**之前出现过**的全部消息 − 幸存清单」，
其中「之前出现过」用**时间戳**判定（F7），而真日志里存在时间戳乱序。承认句（下钻区底部，
`--fs-xs` / `--text-tertiary`，逐字）：

```
被丢清单按消息时间戳切分；真实日志里压缩边界先写盘、后续消息带更早时间戳，边界附近的归类可能有一两条误差。
```

### 4.3 类别 2：工具调用（`toolOutput`，`countOnly`）

**判定规则**（占位稿 §3.3 B 的裁决逐字继承，此处补齐阈值）：

```
groups = groupBy(records.filter(r => r.kind === "tool"), r => r.toolName ?? "未标注工具")
counts = groups.map(g => ({ toolName, count: g.length, recordIds: g.map(r => r.fullId) }))
排序 = count 降序，count 相同按 toolName 升序
take  = counts.slice(0, TOOL_TOP_N)             // TOOL_TOP_N = 6
rest  = counts.slice(TOOL_TOP_N)
if rest.length > 0: push({ toolName: `剩余工具 · ${rest.length} 类`,
                           count: sum(rest.count) })
量级 = count（次数），evidence = "countOnly"，totals 四类全 0，usd = null
       unpricedCalls = count
```

**为什么 `totals` 恒为 0 是「不知道」而不是「恰好 0」**（F4 逐字）：解析器构造 tool 记录时
**不写 `usage`**（`parseJsonl.ts:566-581`），`usage` 落在同一条 assistant 记录上
（`parseJsonl.ts:514`），而 `tokenTotalsOf` 对无 usage 的记录直接 `continue`
（`tokenTotals.ts:68-70`）。**所以这一类的 token 量在日志里不存在。**

**不做 1/N 分摊**（占位稿裁决，继承）：把「工具调用的消耗」摊到承载它的 assistant 记录上，
是日志里没有任何依据的数字。真实原因是「每轮重发全部历史」，不是「Read 烧掉了这些」。

**排序键为什么是次数**：全组 `total` 恒 0，按 `totals.total` 排等于把稳定序伪装成有意义的
排序（占位稿 §3.3 B 逐字）。**必须在界面上写「按调用次数」**，不能写「按占用降序」。

**`TOOL_TOP_N = 6` 的理由**：与占位稿一致；6 类之后的长尾在真机里通常是
`Bash` / `Read` 之外的杂项，合并成「剩余工具 · K 类」（**K 必须真实**，不是「若干」）。

**什么时候不报**：
1. 无 `kind === "tool"` 的记录（`compact-session.jsonl` 正是这种，F25）。
2. `records.length < LONG_SESSION_MIN`（§4.9）——短会话的工具计数是样本噪声。

**会误报的地方**：次数多**不等于**浪费。一个会话完全可能正常地调用 `Read` 40 次
（每次读不同文件）。承认句：

```
这里只报调用次数——日志里没有「这次调用占了多少上下文」的记录。次数多不等于浪费，逐条看证据再判断。
```

### 4.4 类别 3：缓存重写（`cacheRewrite`，`logged`）

**判定规则**：

```
calls = records.filter(r => r.kind === "assistant" && r.usage?.cacheCreationTokens != null)
if calls.length < CACHE_REWRITE_MIN_SAMPLES (8): 不报
median = median(calls.map(r => r.usage.cacheCreationTokens))
if median <= 0: 不报                       // 不除以 0
hits = calls.filter(r => r.usage.cacheCreationTokens > median * CACHE_REWRITE_RATIO)  // 2
if hits.length === 0: 不报
量级 = tokenTotalsOf(hits)，evidence = "logged"，分母 = 会话四类合计
label = `缓存重写 · ${hits.length} 次调用 · 超过本次会话中位数的 ${CACHE_REWRITE_RATIO} 倍`
```

**`CACHE_REWRITE_RATIO = 2` / `CACHE_REWRITE_MIN_SAMPLES = 8` 的理由**：中位数×2 是
占位稿给的判据，本文件保留数值；补 `MIN_SAMPLES = 8` 是因为**少于 8 个样本的中位数
本身不可靠**（4 个样本的中位数就是第 2 与第 3 个的均值）。

**什么时候不报**：
1. 样本数 < 8。
2. 中位数为 0（模型没有缓存能力，或日志不记缓存）。
3. **该会话只有一次压缩**：压缩会把 `input`/`cacheCreation` 归零，
   在边界附近制造出假的「显著高于中位数」的窗口。**压缩边界后的 2 个样本不参与统计。**

**会误报的地方**：`cacheCreation` 高是**正常**的——它意味着「新内容进了缓存」，
即模型在做新工作。真正的浪费是「**同一段历史被反复重写进缓存**」，而它需要
`reread` 判据（占位稿把两者合并为一类，本文件把它们分开，见 §9）。
承认句：

```
缓存重写本身是正常开销——新内容进缓存才有得读。这里标出的是「明显高于本次会话常态」的几次，不等于浪费。
```

### 4.5 类别 4：重复读取同一文件（`repeatRead`，`countOnly`）

**判定规则**：

```
for activity of extractFileActivities(parsed):
    if activity.reads >= REPEAT_READ_MIN (3)
       and activity.edits + activity.writes === 0        // 见「不报」第 2 条
    then report { relPath, count: activity.reads, recordIds: activity.recordIds }
排序 = reads 降序，取前 REPEAT_READ_TOP (3)
量级 = count（次数），evidence = "countOnly"，totals 四类全 0，usd = null
```

**常量理由**：`REPEAT_READ_MIN = 3`，不是 2——真机上「读一次、改一次、再读一次确认」是
**正常**的工作流（`changed-files-session.jsonl` 里 `Read` 3 次、`Edit` 5 次，正是这个形状）。
**只有「读了 3 次以上且一次都没改」才是纯浪费**。
`REPEAT_READ_TOP = 3`：这一类很容易占满榜单（一个大型重构会话可能有十几个文件被读多次），
不设上限会让清单只剩这一类。

**为什么体积也是 `countOnly`**：`FileActivity` **没有 token 字段**（F9）；而 `Read` 的
**结果**占的是下一次 assistant 调用的 `cacheRead`（F4），把它记到「这个文件的读取」头上是
**错归因**——而错误归因比没有归因更坏。所以本类**不报体积**。

**什么时候不报**：
1. `activity.reads < 3`。
2. **`activity.edits + activity.writes > 0`**——改过就说明读是必要的（读-改循环）。
3. `activity.sidechainCount > 0` 且 `reads === sidechainCount`——**全部来自子 agent**。
   子 agent 的读取是它自己的上下文，归到主会话头上会让用户去改一个不存在的习惯。
   此时若 `reads - sidechainCount >= 3` 才报，名称后缀改为
   `重复读取 · {relPath} · {N} 次（其中 {M} 次来自子 agent）`。
4. `records.length < LONG_SESSION_MIN`。

**会误报的地方**：`reads` 计的是**成功的** `Read` 调用（F9），但**看不到读取范围**——
一次 `Read` 读 10 行与读整个文件在 `reads` 里都是 1。承认句：

```
Read 只记录调用次数，不记录读取范围——同一个文件的多次小范围读取与多次整文件读取在这里不可区分。
```

### 4.6 类别 5：超大工具结果（`oversizedResult`，`countOnly`）

**判定规则**：

```
truncated = records.filter(r => r.kind === "tool" && r.resultTruncated === true)
if truncated.length === 0: 不报
if truncated.length === 1 and records.length < 10: 不报        // 见「不报」第 3 条
groups = groupBy(truncated, r => r.toolName ?? "未标注工具")
量级 = 每组的条数 + 「≥ 5 KB × 条数」的**下界**
evidence = "countOnly"，totals 四类全 0，usd = null
label = `超大工具结果 · ${toolName} · ${count} 次`
```

**必须写清的三件事**：

1. **`resultTruncated === true` 是可靠布尔**（F3），它意味着**原始长度 > 5 KB**。
2. **原始长度不可知**（F3）。所以本类**不报字节数**，只报**条数与工具名**。
   体积/占比列显示 `—`（`--text-faint`），单元格 `title` 逐字：
   `结果在解析时被截到 5 KB——原始长度没有记录`
3. **下界是可以说的事实**：`≥ {M} KB（{N} 条 × 每条至少 5 KB）`。
   这是**下界**不是估计值，措辞必须带「至少」。

**什么时候不报**：
1. 无 `resultTruncated === true` 的记录。
2. `records.length < LONG_SESSION_MIN`。
3. **`truncated.length === 1` 且会话调用 < 10**——一条被截断的结果不构成「出血点」
   （任何大输出的 `Bash` 都会触发）。阈值：`truncated.length >= 2`，或单条但会话调用 ≥ 10。

**会误报的地方**：`resultTruncated` 是**解析层的截断**，不是「模型读到的实际体积」。
被截断的结果**仍然全部进了模型上下文**（截断只影响本应用保留的文本），
所以「被截断」≠「模型多花了钱」。承认句：

```
截断只影响本应用保留的文本，被截断的结果仍然完整地进了模型上下文——这一类的开销在模型侧，不在本应用。
```

### 4.7 类别 6：子 agent 放大（`subagent`，`logged` 但来自子日志）

**判定规则**：

```
agentResults = records.filter(r =>
  r.toolName === "Agent" &&
  r.structuredResult != null &&
  "totalTokens" in r.structuredResult)
if agentResults.length === 0: 不报
sumTokens = Σ r.structuredResult.totalTokens
if sumTokens === 0 or 全部为 null: 不报     // 「数据不足」，不显示 0
if agentResults.length < 2 and sumTokens < sessionTotal * 0.2: 不报
label = `子 agent 放大 · ${agentResults.length} 个子会话`
量级 = sumTokens（**子会话日志自报**），evidence = "logged" 但**口径注明来自子日志**
```

**本类的关键裁决：不把子会话的 token 计入主会话的分母。**

理由：子会话的 token 记在**它自己的日志**里（`childSessionId` / `childSessionPath`），
`tokenTotalsOf(主会话 records)` **不含**它。如果本类把它加进分母，分母就与 `TokenPanel`、
与「上下文」标签页、与用量总览**全部不一致**——而 F1 的整个体系建立在「四类计数器口径唯一」
之上。

**所以本类的「占比」列显示 `—`**，行内改显示计数与自报总量：
`{N} 个子会话 · 日志自报合计 {formatTokenCount(sumTokens)} tok`。
该类**不参与体积排序**，固定落在清单的**中段**（压缩类之后、习惯类之前）。

**什么时候不报**：
1. 无 `Agent` 调用（或 `structuredResult === null`——`extractStructuredToolResult`
   对非对象返回 `null`）。
2. `sumTokens === 0` 或全为 `null` → **数据不足，不报此条**（界面上**不显示** `0 tok`，
   那会被读成「子会话没花钱」）。
3. `agentResults.length === 1` **且** `sumTokens < 主会话合计的 20%`——一个子 agent 是正常用法。

**会误报的地方**：`totalTokens` 是**子会话自己报的**，本应用没有核验它的口径
（它可能含 `cacheRead`，也可能不含）。承认句：

```
子会话的 token 是子会话日志自报的数字，本应用未核验它的口径，也没有计入本会话的占比。
```

### 4.8 类别 7：长尾历史（`longTail`，`countOnly`）

**这一类是本轮最诚实的降级示范：它只报「事实」，不报体积，不报占比。**

**判定规则**：

```
if records.length < LONG_SESSION_MIN (40): 不报
if records.length !== 0:
  startedAt = min(record.timestamp), endedAt = max(record.timestamp)
  span = endedAt - startedAt
  if span < LONG_TAIL_MIN_SPAN_MS (10 * 60 * 1000): 不报
  earlyCount = records.filter(r => r.timestamp < startedAt + span * 0.2).length
  if earlyCount >= records.length * 0.5 and (parsed.compactEvents ?? []).length === 0: 报
量级 = earlyCount（条数），evidence = "countOnly"，totals 四类全 0，usd = null
label = `长尾历史 · ${earlyCount} 条消息 · 出现在最早 20% 的时间里`
```

**语义**：一个**长**会话里，一半以上的记录出现在**最早 20% 的时间**里，
而且**从未压缩过**——意味着这些早先的历史一直原样躺在上下文里被反复重读。

**什么时候不报**：
1. `records.length < 40`。
2. `compactEvents.length > 0`——压缩已经把早期历史重写掉了，本类的前提不成立。
3. 会话时长 < 10 分钟（`span` 太短时「最早 20%」没有意义）。
4. `earlyCount < records.length * 0.5`。

**会误报的地方（本类误报率最高，所以判定最保守）**：
「出现在早期」**不等于**「没有信息量」。一个会话完全可能是
「先读完所有代码（早期），然后开始长时间推理（后期）」——那是最正常的工作流。
承认句：

```
「长尾」只看消息出现的时间位置与压缩史，不看内容——早期的探索性读取同样是必要的，命中不构成结论。
```

**来由**：这是唯一回答「要不要换个新会话」的判定，而「换个新会话」正是用户最常需要、
也最少被工具提示的动作。

### 4.9 全视图级别的抑制规则

| 条件 | 抑制内容 | 理由 |
| --- | --- | --- |
| `records.length < 40`（`LONG_SESSION_MIN`） | 类别 2、4、5、7 | 短会话的「重复」是样本噪声 |
| `samples.length === 0` | 全视图走空态 | 无用量即无可分析对象 |
| 四类计数器合计 === 0 | 全视图走空态 | 同上（与「无 usage」**分文案**，§3.10） |
| `compactionCount === 0` 且清单为空 | 全视图走空态 | §3.10 第三行 |
| 某模型定价未知 | **不抑制任何行**；金额显示「定价未知」并在面板顶汇总 | F21：绝不定价为 0，也绝不隐藏 |

### 4.10 汇总：每条规则的「误报自认」在界面上落在哪里

| 类别 | 承认句位置 | 承认句内容 |
| --- | --- | --- |
| 1 压缩 | 下钻区底部 | §4.2 结尾那句 |
| 2 工具调用 | 下钻区底部 | §4.3 结尾那句 |
| 3 缓存重写 | 下钻区底部 | §4.4 结尾那句 |
| 4 重复读取 | 下钻区底部 | §4.5 结尾那句 |
| 5 超大工具结果 | 下钻区底部 | §4.6 结尾那句 |
| 6 子 agent | 下钻区底部 | §4.7 结尾那句 |
| 7 长尾历史 | 下钻区底部 | §4.8 结尾那句 |
| **全部** | 面板底脚注（常显） | §3.9 那段 |

**七条承认句与一条总脚注，一个都不能省。** 这是 F1「日志事实 vs 估算」红线的直接兑现。

### 4.11 「数据不足，不报此条」的完整清单（写给实现者，防止顺手补字段）

| 想做的判定 | 缺什么 | 处置 |
| --- | --- | --- |
| 「这次工具调用占了多少上下文」 | `tool` 记录无 `usage`（F4） | **不报体积**，只报次数（§4.3） |
| 「这条工具结果的原始大小」 | 解析层截到 5 KB（F3） | **不报字节**，只报「≥5KB×N 下界」（§4.6） |
| 「这个文件的读取占多少 token」 | `FileActivity` 无 token 字段（F9） | **不报体积**，只报 `reads`（§4.5） |
| 「不同读取范围的重复度」 | `Read` 不收范围（F9） | **不报**，在承认句里说明 |
| 「这段话有没有信息量」 | 无任何字段 | **不报**；类别 7 只报时间位置（§4.8） |
| 「子会话花了多少钱」 | `Agent.totalTokens` 口径未核验 | **不折算美元**，只显示自报 token（§4.7） |
| 「下次会压缩吗」 | 无预测能力 | **不报**（红线） |
| 「每个模型各花了多少」 | 行级 `model` 存在，但 `tool` 记录无 `model` | 只对**有 model 的记录**折算，其余计入 `unpricedCalls` |

---

## 5. 图表与几何

### 5.1 本轮**没有** SVG 图表

**裁决：本视图零 SVG。** 理由（逐条可复核）：

1. §1.1 已定：曲线是「上下文」标签页的领地。本视图画曲线 = 违反分工。
2. F10：色位已满，无法给七个类别在图上分配可区分的颜色。
3. §4.3/4.5/4.6/4.8 有**四类**的体积不可知，形状化（长度编码）会**伪造**一个不存在的量。
4. 表格行里的占比条（6px）已经承担了「形状」的信息，且它只对 `evidence === "logged"`
   且 `totals.total > 0` 的行出现——**不可知的四类不画条**。这比画一条长度可疑的条更诚实。

**所以本轮没有 `viewBox`、没有高度换算表。** 这是与 Round W 最大的结构差异，
也应当是本文件评审时的第一个检查点。

### 5.2 唯一的「图形」：三个可避免性字形（几何死数）

| 字形 | 几何 | 令牌 |
| --- | --- | --- |
| 可避免 | `<rect width="8" height="8" rx="2">` | `fill: var(--chart-1)` |
| 难避免 | `<rect x="0.5" y="0.5" width="7" height="7" rx="2">` | `fill: none; stroke: var(--chart-1); stroke-width: 1` |
| 不可避免 | `<rect y="3.5" width="8" height="1">` | `fill: var(--text-tertiary)` |

`viewBox="0 0 8 8"`，`width="8" height="8"`（**属性写死**），
容器 `<span aria-hidden="true">`，语义由单元格 `title` 与行的 `aria-label` 承载。
`8px` 与 `1px` 是「形」不是「距」（F12 明文豁免「色块 8/10px」）。
`stroke-width: 1` 与 `--border` 无关：**描边色是 `--chart-1`，不是发丝边框**（F11 合规）。

### 5.3 占比条的对比度实算（唯一的图形色）

占比条描边 `--chart-1` 叠在 `--bg-subtle`（面板底）上，见 §5.4 表 B。
填充是 `--chart-1-soft` 的不透明度阶梯，**不承载读的任务**（承载读的是它旁边的百分比数字），
所以填充只受「面积底豁免」（同 `Heatmap` 的 0 档空格）。

### 5.4 四主题对比度实算

**复现脚本**（存为 `bleed-contrast.mjs` 后 `node bleed-contrast.mjs`，
四个函数与 Round W §8.4 同源，本表每个数字由它产出）：

```js
const chan = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => chan(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const themes = [
  ["普通浅", { panel: "#ffffff", inset: "#f1f3f5", text: "#16181b", sec: "#4a5260",
               ter: "#6b7381", faint: "#9aa1ac", chart1: "#2f6b9f", warning: "#946200",
               success: "#1f7a4d", accent: "#2952cc" }],
  ["普通深", { panel: "#14161a", inset: "#0a0b0d", text: "#f0f2f5", sec: "#b4bcc6",
               ter: "#8b939e", faint: "#5c636d", chart1: "#82b5e8", warning: "#e0a33e",
               success: "#4cc38a", accent: "#7fa8ff" }],
  ["HC 浅",  { panel: "#ffffff", inset: "#eef1f5", text: "#000000", sec: "#1f2b3a",
               ter: "#33414f", faint: "#4a5866", chart1: "#1c567f", warning: "#7a4f00",
               success: "#0a5a33", accent: "#0b3f9c" }],
  ["HC 深",  { panel: "#121212", inset: "#000000", text: "#ffffff", sec: "#dcdcdc",
               ter: "#c4c4c4", faint: "#a8a8a8", chart1: "#7cb8f0", warning: "#ffc75e",
               success: "#6ee7a0", accent: "#8ab4ff" }]
];
for (const [name, P] of themes) {
  console.log("\n### " + name);
  const row = (label, fg, bg) => console.log(label + "\t" + fg + "\t" + cr(fg, bg).toFixed(2));
  row("text/panel", P.text, P.panel);
  row("sec/panel", P.sec, P.panel);
  row("ter/panel", P.ter, P.panel);
  row("ter/inset", P.ter, P.inset);
  row("faint/panel", P.faint, P.panel);
  row("chart1/panel", P.chart1, P.panel);
  row("chart1/inset", P.chart1, P.inset);
  row("warning/panel", P.warning, P.panel);
  row("success/panel", P.success, P.panel);
  row("accent/panel", P.accent, P.panel);
}
```

**表 A｜文字（前景叠面板底 `--bg-subtle`）**

| 用途 | 令牌 | 普通浅 | 普通深 | HC 浅 | HC 深 | 门槛 |
| --- | --- | --- | --- | --- | --- | --- |
| 行名、读数数值、面板标题 | `--text` | `#16181b` **17.79** | `#f0f2f5` **16.15** | `#000000` **21.00** | `#ffffff` **18.73** | 正文 ≥4.5（项目 ≥7）达标 |
| 体积读数、动作文案 | `--text-secondary` | `#4a5260` **7.87** | `#b4bcc6` **9.44** | `#1f2b3a` **14.34** | `#dcdcdc` **13.66** | 次要 ≥4.5 达标 |
| 口径脚注、承认句、表头 | `--text-tertiary` | `#6b7381` **4.78** | `#8b939e` **5.83** | `#33414f` **10.45** | `#c4c4c4` **10.74** | 三级 ≥4.5 达标 |
| 零读数「—」 | `--text-faint` | `#9aa1ac` **2.77** | `#5c636d` **2.71** | `#4a5866` **7.06** | `#a8a8a8` **7.30** | **装饰豁免**（F13）——「—」的信息在位置不在字形 |

**由表 A 推出一条实现规则**：`--text-tertiary` 在普通浅色上只有 **4.78**（勉强过 4.5），
在**内嵌底 `--bg-inset`** 上会更低（Round W §8.3 已实算该组合为 **4.30**，不过关）。
本视图的面板里**没有内嵌块**（表头虽用 `--bg-inset`，但表头文字用的是 `--text-tertiary`
叠在 `--bg-inset` 上——**这一处需要主会话按 Round W §8.3 的结论裁决**，见 §8.7 第 4 条）。

**表 B｜图形与标注点（前景叠面板底）**

| 元素 | 令牌 | 普通浅 | 普通深 | HC 浅 | HC 深 | 门槛 |
| --- | --- | --- | --- | --- | --- | --- |
| 占比条描边 + 可避免「实心方块」 | `--chart-1` | `#2f6b9f` **5.64** | `#82b5e8` **8.39** | `#1c567f` **7.82** | `#7cb8f0` **8.90** | 图形 ≥3 达标 |
| 「难避免」空心方块的描边 | `--chart-1` | 同上 | 同上 | 同上 | 同上 | 图形 ≥3 达标 |
| 「不可避免」短横 | `--text-tertiary` | **4.78** | **5.83** | **10.45** | **10.74** | 图形 ≥3 达标 |
| 估算金额的 provenance 圆点 | `--warning` | `#946200` **5.24** | `#e0a33e` **8.17** | `#7a4f00` **7.13** | `#ffc75e` **12.12** | 图形 ≥3 达标 |
| 事实读数的 provenance 圆点 | `--success` | `#1f7a4d` **5.10** | `#4cc38a` **8.55** | `#0a5a33` **8.72** | `#6ee7a0` **12.85** | 图形 ≥3 达标 |
| 焦点环 | `--accent` | `#2952cc` **6.62** | `#7fa8ff` **7.72** | `#0b3f9c` **9.52** | `#8ab4ff` **8.97** | 图形 ≥3 达标 |

**表 C｜被否掉的候选（记录，供评审对账）**

| 候选 | 为什么**不**用 |
| --- | --- |
| 给七个类别各配一色 | F10：`--cat-*` 严禁借去表达非类别语义；`--chart-2..6` 严禁借去表达分类维度。七类**正是**一个分类维度，但**两套资产的槽位都已占满** |
| 借 `--cat-*` 给「可避免 / 难避免 / 不可避免」上色 | 同上，且「可避免性」既不是记录类别也不是系列顺序 |
| 「压缩类」行用 `--warning` 底 | `--warning` 的语义是**非确定信息**；压缩丢弃是**确定的日志事实**，用 `--warning` 会撒谎 |
| 用 `--border-strong` 画占比条的底轨 | F11：1.47 / 1.52，读不出（Round W §8.3 表 B 实测） |
| 占比条填充直接上 `--chart-1` 实色 | `BarChart.module.css` 注释：大面积填充只许 `-soft`（行内虽是 6px，但它是**面积**不是**描边**） |
| 面板 2 画一条 sparkline | §1.1：曲线归「上下文」标签页 |

### 5.5 新增令牌：**零**

本文件新出现的 CSS 变量只有**局部**变量，全部定义在 `BleedView.module.css` 的 `.bleed`
作用域上（与 `.calendar { --cal-cell: 12px }`、`PulsePage` 的 `--pulse-row-h` 同款）：

```css
.bleed {
  --bleed-bar-h: 6px;       /* 形：占比条高度，F12 豁免 */
  --bleed-glyph: 8px;       /* 形：可避免性字形边长，F12 豁免 */
}
```

它们是「形」、不是颜色、不参与主题换挡、不进 `--sp-*` 档位。
**`tokens.css` 一行都不用改。**

---

## 6. 可访问性

### 6.1 键盘可达路径（Tab 止点逐个列出）

| # | 止点 | 说明 |
| --- | --- | --- |
| 1 | 分段控件「视图切换」 | 既有，roving tabindex，方向键在五项间移动（**自动激活**，`SegmentedControl` 既有行为）；`出血点` 是第五项 |
| 2 | 清单容器 | roving tabindex：只有 `activeIndex` 那一行是 `tabIndex={0}`（`useRowNavigation`） |
| 3 | 下钻区内的按钮（**仅当某行展开**） | 展开后进入；`Escape` 收起并把焦点还给该行 |
| 4 | 面板 2 的读数 | **不是 Tab 止点**（纯文本 `<dl>`） |
| 5 | 报告面板（既有） | 不变 |

**本视图没有 Tab 止点进任何 SVG**——因为本视图零 SVG（§5.1）。三个可避免性字形
`aria-hidden="true"`，语义由行的 `aria-label` 承载。

### 6.2 `aria` 角色与标签

| 元素 | 角色 / 属性 |
| --- | --- |
| 两个 `Panel` | `<section aria-label>`（`Panel` 组件自带），各是一个具名 landmark |
| 清单容器 | `<ul aria-label="出血点清单">` |
| 行 | `<li>`，内含一个 `<button aria-expanded aria-controls>`，`aria-label` 见 §3.11 |
| 展开的证据区 | `<div role="region" aria-label="{名称} 的证据记录">`，id 由 `aria-controls` 指向 |
| 占比条 | `<span aria-hidden="true">` + 兄弟 `.srOnly` 文本（§3.11） |
| 可避免性字形 | `<span aria-hidden="true">`（语义在行的 `aria-label` 与单元格 `title`） |
| 面板 2 读数 | `<dl><dt>标签</dt><dd>值</dd></dl>`（该内容**不是** `<dt>`，是 `<dd>`） |
| 加载态 | `<Skeleton variant="table" rows={4} label="正在分析出血点" />`（自带 `role="status"` + `data-probe-pending`） |

**只保留一个 live region**：`Skeleton` 一个。

### 6.3 屏幕阅读器读法

一行读出来是：

```
压缩 #1 · 丢掉 42 条消息，占 38%，难避免，压缩是上下文重置，不是浪费——请看下面「压缩前那一段」里被丢掉的是什么
```

`countOnly` 行读出来是：

```
Read · 12 次调用，体积无法从日志得出，可避免，同一个文件读了 12 次且一次都没改：先用一次 Read 记住内容，或改用 Grep 定位到行
```

没有任何 SVG（所以没有 `role="img"` 的 `aria-label` 要求）。
三个字形不朗读（否则每行多三个音节，却与行末的「可避免」重复）。

### 6.4 130% 字号下的行为

| 项 | 行为 |
| --- | --- |
| 行高 | `--row-h = calc(var(--row-pad-y)*2 + var(--lh-sm))`，130% 下自动变高（`calc` 派生，**不写死 px**——Round W §13 的既有修正） |
| 表头 | 同上 |
| 列宽 | 全部常量轨（`5ch` / `9ch` / `4ch` / `--col-actions`）**不随字号变**，1fr 吸收剩余；`ch` 挂 `--font-mono` 度量，`font-size` 变大时 `ch` 也变大 → **轨道等比变宽**，这是想要的行为（数字不挤） |
| 溢出保护 | 名称列 `minmax(0, 1fr)` + 单行省略号（`text-overflow: ellipsis`）；**不换行**——换行会把行高顶出 `--row-h`（F14 的既有教训） |
| 阈值刷新 | 若采用 `useMeasuredRowHeights`，`resetKey` 必须传 `fontScale`（否则切档后要滚一下才对） |
| 面板 2 | `repeat(3, minmax(0, 1fr))` 在 130% 下文字变宽，880px 以下落成单列（§2.4） |

### 6.5 960px 窄窗下的行为

`SessionAnalyzerPage` 的 `.body` 在 `≤1100px` 时降为 `260px minmax(0,1fr)`（F17 相关）。
可用宽度计算（960px 窗、有 detail 栏时最坏情形，字号 130%）：

```
960 − 260（侧栏）− 360（详情栏）− 24（page padding --sp-3 ×2）
    = 316px  ← 清单可用宽
316 − 20（row-pad-x ×2）
    = 296px  ← grid 内容宽
296 − 24 − 36 − 36 − 24 − 44  （五个固定轨 24 + 5ch + 9ch + 4ch + 44，
                                130% 下 ch 放大到约 7.8px/字）
    = 92px   ← 名称列的兑现宽度
```

**92px 只能放下约 6 个中文字**（`--fs-sm` 12px × 130% = 15.6px/字）。
所以窄窗下名称列**必须**靠省略号兜底，**且**面板 2 已经落成单列（§2.4）。
这条账写给实现者：**不要在窄窗下试图放宽固定轨**——那正是 F15 记录的
「59px 把三列整体推走」那类缺陷的来源。

### 6.6 高对比度档下的行为

- **零改动**：本视图所有颜色都是既有令牌（§5.5），HC 两档在 `tokens.css` 里已经调好
  （表 A/B 的 HC 列全部 ≥7 / ≥3）。
- **占比条描边**：HC 浅 `#1c567f` **7.82**、HC 深 `#7cb8f0` **8.90**，都不需要额外描边。
- **可避免性三档**：形状通道（实心 / 空心 / 短线）在 HC 下依然可分——
  这正是本轮**不靠颜色**的收益（§2.3）。
- **行选中态**：`--accent-soft` 底 + `inset 2px 0 0 var(--accent)` + 600 字重，三通道，
  HC 下全部保留（同 `ChangedFilesView`）。
- **焦点环**：`--focus-ring-width` 在 HC 档自动从 2px 变 3px、`outline-offset` 从 1px 变 2px
  （`tokens.css` 既有）。**行内用负偏移 `--focus-ring-inset`**（正偏移会被滚动容器裁掉，
  Round W §9 的既有裁决）。

---

## 7. 断言清单

> 每条都能写成**单测**（Vitest）或**真机探针断言**（`gui-test.sh`）。
> 标 **【死数字】** 的必须钉死具体值，不许写成「> 0」或「不变」。
> 锚点一律走 `[data-probe='…']` / 稳定属性，**禁止裸标签选择器**、禁止拿可见文案当锚点（F23）。

### 7.1 纯函数层（`web/src/features/sessions/bleedModel.ts`）

| # | 断言 | 类型 |
| --- | --- | --- |
| P1 | `buildBleedReport(parsed)` 对**任何**输入都返回结构完整的对象，**不抛异常** | 单测 |
| P2 | 返回对象所有数值字段 `Number.isFinite() === true`（无 NaN / Infinity） | 单测 |
| P3 | `compact-session.jsonl` → `compactionCount === 2` **【死数字】**（与 `droppedMessages.test.ts:27,62-63` 既有断言对账） | 单测 |
| P4 | `compact-session.jsonl` → 无 `toolOutput` / `oversizedResult` / `repeatRead` 项 **【死数字：0 条】**（该夹具零 `tool_use`，F25） | 单测 |
| P5 | `changed-files-session.jsonl` → `repeatRead` 项数 **【死数字】** 等于「`reads >= 3 && edits + writes === 0` 的文件数」 | 单测 |
| P6 | 未知模型（`model` 不匹配三个 family 前缀）→ 该行 `usd === null` 且 `unpricedCalls > 0` **（本轮最重要的诚实性断言）** | 单测 |
| P7 | 全部模型已知 → `usd !== null`；全部未知 → `usd === null`（**不是 0**） | 单测 |
| P8 | `bleedHeadline` 在 `compactionCount === 0` 时**逐字**等于 `本会话没有发生压缩`（占位稿 §3.3 E 的原文，本文件保留该措辞） | 单测 |
| P9 | `bleedHeadline` 在任何输入下**不包含** `undefined` / `NaN` / 空串 | 单测 |
| P10 | `toolOutput` 类每项 `evidence === "countOnly"` 且 `totals.total === 0` 且 `usd === null`，**排序按次数**（占位稿 §6 X1 第 ⑥ 条，逐字继承） | 单测 |
| P11 | **防回归**：`totals.total === 0 && evidence === "logged"` 的项**必须为空集**（占位稿 §6 X1 第 ⑦ 条，逐字继承） | 单测 |
| P12 | `repeatRead` / `oversizedResult` / `longTail` 三类 `evidence === "countOnly"` | 单测 |
| P13 | `longTail` 在 `records.length < 40` 或 `compactEvents.length > 0` 时**不产出** | 单测 |
| P14 | `cacheRewrite` 在样本数 < 8 或中位数 ≤ 0 时**不产出**（不除以 0） | 单测 |
| P15 | `subagent` 类的 `usd` 恒为 `null`，且**不进**按体积排序的序列 | 单测 |
| P16 | `compaction` 类的读数**不含** `droppedTokens`（防 F8 的量纲混用回归） | 单测 |

### 7.2 组件层（`BleedView.test.tsx`）

| # | 断言 | 类型 |
| --- | --- | --- |
| C1 | 无用量 → 渲染 `没有可分析的用量` + `本会话没有带用量的模型消息。` | 单测 |
| C2 | 有用量但计数全零 → 渲染 `没有可分析的用量` + `本会话的用量计数全为零。`（**description 与 C1 不同**） | 单测 |
| C3 | 有压缩 → `[data-probe='bleed-list']` 内的行数 **【死数字】** 等于 `buildBleedReport` 的项数 | 单测 |
| C4 | `logged` 行的体积单元格 `title` 含四类计数器的四个中文名（`输入` / `缓存写入` / `缓存读取` / `输出`） | 单测 |
| C5 | **占比列从不渲染** `formatTokenCount` 形式的字符串（防有人把 `total` 当读数显示） | 单测 |
| C6 | `countOnly` 行**不渲染**四栏 token 读数，改渲染 `—`，并**不画**占比条 | 单测 |
| C7 | 面板 2 在无压缩事件时**仍渲染面板**，正文逐字等于 §3.8 第四行 | 单测 |
| C8 | 三个可避免性字形的 `aria-label` 逐字为 `可避免` / `难避免` / `不可避免` | 单测 |
| C9 | 行按钮的 `aria-label` 包含名称、占比（或 `体积无法从日志得出`）、可避免档、动作文案四段 | 单测 |
| C10 | `Escape` 收起已展开的行并归还焦点 | 单测 |
| C11 | 面板底脚注逐字包含 `工具结果在解析时最长保留 5 KB` | 单测 |
| C12 | 面板顶口径脚注逐字包含 `四类计数器分开、不求和` | 单测 |

### 7.3 真机探针（`gui-test.sh` + `PROBE_JS`）

| # | 断言 | 类型 |
| --- | --- | --- |
| R1 | `readStoredView` 白名单含 `bleed`：切到「出血点」→ **刷新页面** → 仍是「出血点」（`facts.analyzer.view === "bleed"`）**【死数字：`"bleed"`】** | 真机 |
| R2 | 切到「出血点」后 **`TimelineTrack` 与 `FilterBar` 都不在 DOM**（会话级口径短路，F16）**【死数字：0 个】** | 真机 |
| R3 | `[data-probe='bleed-list']` 是真列表：`abs(scroll_h − declared × row_h) ≤ 4`；有 pad 时 `abs(scroll_h − (Σpads + visible × row_h)) ≤ 4`（照 F24 的既有不等式） | 真机 |
| R4 | `[data-probe='bleed-head']` 存在且可见列头数 **【死数字：5】** | 真机 |
| R5 | 130% 字号下首行高度 **【死数字：39】**（= `round(30 × 1.3)`） | 真机 |
| R6 | 130% 字号下行高与 `--row-h` 的差 **【死数字：≤ 0.5px】**（防折行顶高，F14 的教训） | 真机 |
| R7 | 列表容器 `scrollWidth ≤ clientWidth + 1`（**不横向溢出**） | 真机 |
| R8 | 面板 2 读数在 960px 窗下 `grid-template-columns` 是 **【死数字：3 轨】**，在 860px 以下变 **【死数字：1 轨】** | 真机 |
| R9 | 点选任意一行后 `[data-probe='bleed-drill']` 完整落在视口内（照 F24 的取证卡判定） | 真机 |
| R10 | 高对比度档下 `document.documentElement.dataset.contrast === "high"`；切回普通档时该属性 **不存在**（不是 `"normal"`） | 真机 |
| R11 | `PROBE_JS.contains("bleed-view")` / `contains("bleed-list")` / `contains("bleed-headline")` / `contains("bleed-precompaction")` / `contains("bleed-scope")` / `contains("bleed-footnote")` / `contains("bleed-drill")` / `contains("bleed-head")` 各为真（Rust 侧守卫测试，**一个锚点族一条**） | Rust 单测 |
| R12 | `!PROBE_JS.contains("bleedView.closest")`（防 F23 那条 `closest('section')` 回归） | Rust 单测 |
| R13 | `gui-test.sh` 的兜底 `点选=` 块里**点名**了 `点选=[data-probe='bleed-row-1']`（F24 逐字要求） | 真机 |

### 7.4 必须钉死的几何死数字（汇总）

| 项 | 死数字 |
| --- | --- |
| 行高（100% / 130%） | **30px** / **39px** |
| 占比条高度 | **6px** |
| 可避免性字形边长 / 短横高 | **8px** / **1px** |
| 列轨道 | `var(--control-h-sm) minmax(0,1fr) 5ch 9ch 4ch var(--col-actions)` |
| 列间距 | `var(--sp-2)` = **8px** |
| 行左内边距 | `var(--row-pad-x)` = **10px** |
| 下钻区左内边距 | `calc(var(--row-pad-x) + var(--sp-4))` = **26px** |
| 面板 2 断点 | **880px**（3 轨 → 1 轨） |
| 滚动容器最小高 | **120px** |
| 抑制阈值 | `LONG_SESSION_MIN = 40` |
| 工具榜上限 | `TOOL_TOP_N = 6` |
| 缓存重写阈值 | `CACHE_REWRITE_RATIO = 2` / `CACHE_REWRITE_MIN_SAMPLES = 8` |
| 重复读取阈值 | `REPEAT_READ_MIN = 3` / `REPEAT_READ_TOP = 3` |
| 超大结果阈值 | 单条时 `records.length >= 10`，否则 `>= 2` 条 |
| 长尾阈值 | 占比 **0.5** / 窗口 **0.2** / 最短时长 **10 分钟** |
| 子 agent 阈值 | `agentResults.length >= 2` **或** `ΣtotalTokens >= 主会话 total 的 0.2` |

---

## 8. 反例与红线自查

### 8.1 刻意不做（每条带理由）

| # | 不做 | 理由 |
| --- | --- | --- |
| 1 | **不给七个类别上色** | F10：两套六槽资产已占满；F19 实算相邻比值 1.13–1.46，1px 上读不出。改用「可避免性字形 + 序号 + 名称」三通道 |
| 2 | **不新增任何颜色令牌** | §5.5：新变量只有「形」两个局部变量；`tokens.css` 零改动 |
| 3 | **不画任何曲线 / 饼图 / 堆叠条** | §1.1 + §5.1：曲线归「上下文」标签页；四类体积不可知，长度编码会伪造量 |
| 4 | **不报告任何「原始字节数」** | F3：工具结果在解析层被截到 5 KB，原始长度不存在。只报「条数 + 工具名 + ≥5KB×N 下界」 |
| 5 | **不给 `tool` 记录分摊体积** | F4：`tool` 记录无 `usage`；分摊到「下一次 assistant 调用的 cacheRead 增量」是错归因 |
| 6 | **不把子会话 token 计入主会话分母** | §4.7：会让本视图的分母与 `TokenPanel`、`ContextView`、用量总览全部不一致 |
| 7 | **不做「还能撑多久」「预计下次压缩」外推** | 项目红线：不预测、不外推 |
| 8 | **不显示折算后的「总成本」当标题数字** | F1 + 占位稿 §2 第 6 条：一律「已知部分合计」，未知定价如实标注 |
| 9 | **不引入任何图标** | F22：`Icon` 只有 6 个，且本项目刻意不引图标库。新图形用内联 SVG 或 `◆` |
| 10 | **不做跨会话的出血点排行** | 本轮范围锁定在会话详情页。占位稿 §5 的列表徽章留到下一轮——它需要新的一层聚合与新的分母口径 |
| 11 | **不做阈值告警 / 系统通知 / 自动修复** | 本视图是**报告**不是**执行器**；且告警需要新的持久化状态 |
| 12 | **不改 Rust / Tauri 逻辑** | 本轮零后端逻辑改动；只加探针锚点与守卫测试（F23 要求的既定流程） |
| 13 | **不动 `pulse` 与 `error` 的既有行为** | 占位稿 §7 已锁定 |
| 14 | **不用 `closest('section')` 定位面板** | F23：会走祖先链，真机上已造成过一次永久 null |
| 15 | **不给 `reread` / `longTail` 之类推断打分或给置信度** | 它们是**推断**，打分会让读者以为它们是测量的 |

### 8.2 可能违反红线的五处，以及避开方式

| # | 风险点 | 红线 | 避开方式 |
| --- | --- | --- | --- |
| 1 | 「超大工具结果」这一类的体积 | 「不发明新指标」 | **不报体积**，只报条数与「≥5KB×N 下界」；列显示 `—`；脚注（§3.9）明说原始大小不可知 |
| 2 | 「缓存重写」与「长尾历史」是统计推断 | 「日志事实 vs 估算必须分开标注」 | 两者都带承认句；`longTail` 的 `evidence` 是 `countOnly`、不报占比；不折美元 |
| 3 | 「长尾历史」把「早出现」当成「低信息量」 | 「不预测」+ 诚实 | 只报**事实**（条数 + 时间位置 + 无压缩），片名用「长尾历史」而不是「无用历史」；承认句明说「不看内容」 |
| 4 | 子会话 token 出现在本视图 | 分母口径唯一 | **不计入分母、不显示占比**，只显示「日志自报合计」并带承认句 |
| 5 | 七类的清单排序 | 「不外推」 | 排序键是**确定的日志事实**（条数 / 次数），不是「浪费程度」的推断分。不可知体积的四类**不参与体积排序** |

### 8.3 与占位稿（本文件前 217 行）的差异（逐条）

**保留并继承的（占位稿的正确结论，本文件逐字沿用）**：

| 占位稿的结论 | 本文件 |
| --- | --- |
| `evidence: "logged" \| "countOnly"` 契约 | §4.0 约束 6 把它推广到全部七类 |
| `toolOutput` 的 `totals` 恒 0 是「不知道」而非「恰好 0」 | §4.3 逐字继承，并补上 `TOOL_TOP_N` 与抑制规则 |
| **禁止**把 `droppedTokens` 与按记录求和比较（量纲差 24 倍是正常的） | §4.2 逐字继承，并加 P16 防回归断言 |
| 排序按调用次数、**不能**写「按占用降序」 | §4.3 继承 |
| 「已知部分合计」/ 未知定价绝不为 0 | §3.2、§4.9 |
| 空态与「有数据的零」分开、`countOnly` 的 0 不是空态 | §3.10 |
| 三处挂载点（`AnalyzerView` / `ANALYZER_VIEW_ITEMS` / `readStoredView` 白名单） | §8.6 第 5 条 |
| 复用 `formatTokenCount` / `formatUsd` / `ProvenanceBadge` / `EmptyState` / `Panel` | §3 全表 |
| 扫 U+FFFD（既有文件里已有真实损坏例子） | §8.6 第 10 条 |

**本文件改写/补齐的**：

| 占位稿 | 本文件 | 理由 |
| --- | --- | --- |
| `BleedKind` 三类 | 七类（补 `repeatRead` / `oversizedResult` / `subagent` / `longTail`） | 占位稿漏了「重复读取同一文件」与「长尾历史」——而它们正是用户问题清单里的第 1 与第 4 条 |
| `BleedItem.totals: TokenTotals` 必填 | 保留必填，但**语义由 `evidence` 决定**（`countOnly` 时是占位 0，不是读数） | 必填字段能防止实现者漏标；语义靠 `evidence` 区分，已有占位稿的先例 |
| 「结论行」放页面顶部 | 改到 **Panel actions** | 放页面顶部会与 `.viewBar` 里的 `ParseCoverageChip` 争夺同一行注意力（与 `ChangedFilesView` 的 `data-changes-aggregate` 同位） |
| 「出血清单：每条一个区块」 | 改为**表格行**（§2.1） | 「区块」会撑成 3 屏，且与 `ChangedFilesView` 的既有画法分裂 |
| 未提无障碍 | §6 补齐（Tab 止点、aria、130%、960px、HC 五节） | 本项目规格的既有体例要求（Round W §9） |
| 未提真机断言 | §7.3 补齐（R1–R13） | 同上（Round W §10） |
| `cacheRewrite` 与「重读」混为一类 | 本文件保留 `cacheRewrite`（单次显著），**未**新增 `reread` 类 | `ContextSample` 不带四类拆分（F5），`reread` 的判据只能从 `records` 重取四类序列——**判据不够稳，本轮不报此条**（原计划有，主动降级） |

### 8.4 实现者清单（按改动顺序）

1. `web/src/features/sessions/bleedModel.ts`（**新建**）：类型 + `buildBleedReport` +
   `bleedHeadline` + 七类的判据常量（§7.4 的死数字逐个照抄）。
2. `web/src/features/sessions/bleedModel.test.ts`（**新建**）：§7.1 的 P1–P16。
3. `web/src/features/sessions/BleedView.tsx` + `BleedView.module.css`（**新建**）：
   §2 几何逐条照抄；列模板照 §2.3 **一字不改**。
4. `web/src/features/sessions/BleedView.test.tsx`（**新建**）：§7.2 的 C1–C12。
5. `web/src/features/sessions/SessionAnalyzerPage.tsx`（**改动 5 处**，F17+F16）：
   `AnalyzerView` 联合类型、`ANALYZER_VIEW_ITEMS`、`readStoredView()` 白名单、
   渲染分派链插分支（**else 分支当前是 `ContextView`，不要覆盖它**）、
   以及 F16 的 `view === "context" || view === "changes"` 短路**加上 `"bleed"`**。
6. `src-tauri/src/lib.rs`（**改动 2 处**）：`PROBE_JS` 加 `bleed` 块（只收事实，F23）；
   加一条 `the_probe_reports_bleed_view_anchors` 守卫测试（§7.3 R11/R12）。
7. `scripts/gui-test.sh`（**改动 3 处**）：`CAPTURE_TARGETS` 加
   `"/repo/compact-demo" "出血点" "点选=[data-probe='bleed-row-1']"`；
   加判定块（§7.3 R1–R10）；**在兜底 `点选=` 块里点名新目标**（F24）。
8. `CHANGELOG.md` 的 `[Unreleased] → Added` 加一条**中文**条目。
9. `web/src/features/sessions/costProvenance.ts`：**修正那句陈旧注释**
   （F21：它说「本应用不带价格表」，而 `pricingSnapshot.ts` 有）。
10. 全部完成后扫 U+FFFD（`python3` 那套），并跑 §8.5 的验收命令。

### 8.5 验收（主会话亲自执行，不外包）

```
./scripts/lint.sh
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:e2e          # Chromium + WebKit
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
./scripts/gui-test.sh --build          # 真机，主会话亲自看截图
```

### 8.6 与本文件的关系（写给主会话）

本文件**整体替换** `.trellis/workspace/liangyuxiang/design-round-x-context-bleed.md`。
替换时请保留原文件被本文件 §8.3 引用到的那些结论（它们已被逐字搬进本文件，
所以原文件可以直接删）。若主会话决定两份并存，请把原文件改名为
`design-round-x-context-bleed.placeholder.md` 以免实现子 agent 拿到两份互相矛盾的权威规格——
**这一点需要主会话裁决**。

---

## 9. 契约清单（实现时逐条对照）

| 契约 | 来源（文件:行） | 本文件如何使用 |
| --- | --- | --- |
| 四类计数器分开、`total` 只做分母 | `web/src/features/sessions/tokenTotals.ts:3-13` | §3.4 占比 `title`、§4.0 约束 2 |
| `tokenTotalsOf` 对无 usage 记录 `continue` | `web/src/features/sessions/tokenTotals.ts:68-70` | §4.3（`countOnly` 的成因） |
| `shareOf` 在 `total <= 0` 时返回 `null` | `web/src/features/sessions/tokenTotals.ts` | §3.10 空态判定 |
| tool 记录不写 `usage` | `web/src/features/sessions/parseJsonl.ts:566-581` | §4.3 |
| assistant 记录承载 `usage` | `web/src/features/sessions/parseJsonl.ts:514` | §4.3 |
| `TOOL_RESULT_LIMIT` / `resultTruncated` | `web/src/features/sessions/parseJsonl.ts:104,634-635` | §4.6 |
| `cumulativeDroppedTokens` | `web/src/features/sessions/parseJsonl.ts:196` | §4.2（F8 的禁令来源） |
| `ContextSample` 不带四类拆分 | `web/src/features/sessions/types.ts:97-103` | §8.3（为何不报 `reread`） |
| `Agent` 结构 | `web/src/features/sessions/types.ts:114-163` | §4.7 |
| `CompactEvent` | `web/src/features/sessions/types.ts:41-77` | §4.2 |
| 锚点可能为 `-1` | `web/src/features/sessions/contextSeries.ts` | §4.2「不报」第 2 条、§3.8 |
| 被丢清单口径 | `web/src/features/sessions/droppedMessages.ts` | §4.2 |
| `changedFiles` 只算四个工具、无 token 字段 | `web/src/features/sessions/changedFiles.ts` | §4.5 |
| `estimateCost` / `pricingFamilyFor` | `web/src/features/usage/pricingSnapshot.ts` | §3.2、§4.9 |
| `formatTokenCount` / `formatUsd` | `web/src/lib/format.ts` | §3 全表 |
| `ProvenanceBadge` 是圆点 | `web/src/features/usage/ProvenanceBadge.tsx` | §3.2 |
| `Panel` / `EmptyState` / `Skeleton` / `ErrorState` | `web/src/components/` | §2.2、§2.5、§3.10、§6.2 |
| 会话级口径短路 | `web/src/features/sessions/SessionAnalyzerPage.tsx:492-506` | §8.4 第 5 条 |
| 三处挂载点 | `web/src/features/sessions/SessionAnalyzerPage.tsx:42,44-49,53-60` | §8.4 第 5 条 |
| 列轨道常量 | `web/src/features/sessions/ChangedFilesView.module.css:80` | §2.3 |
| 零读数「—」+ `--text-faint` | `web/src/features/sessions/ChangedFilesView.module.css` | §3.10 |
| `useRowNavigation` / `focusRowIn` | `web/src/features/sessions/useRowNavigation.ts` | §3.12 |
| 探针只收事实 | `src-tauri/src/lib.rs`（`PROBE_JS` 头注释） | §8.4 第 6 条 |
| 兜底 `点选=` 要点名 | `scripts/gui-test.sh` 判定段注释 | §8.4 第 7 条 |
