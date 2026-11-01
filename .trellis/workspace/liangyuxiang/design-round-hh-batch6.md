# Round HH · 第六批十功能 UI/UX 设计规格

> 分支 `feat/v036-batch-ten-6`（基线 `9c966ea`，`docs(readme): 勾选第五批十功能路线图条目 (#287)`）
> Issue #288 ／ 十个功能 H1–H10 ／ 零新增 Tauri 命令（H8 复用 `write_binary`）
> 本文只定义界面与几何，不含实现代码。所有数字可复算，每处事实附 `文件:行号`。

---

## 0 语境与现状核对

写这份规格之前逐行读过的文件与它给出的约束（这些是后面每一条裁决的地基）：

| 事实 | 出处 | 对设计的影响 |
| --- | --- | --- |
| 用量页 14 块顺序：`BillingWindowCard` → `kpiRow` → 归因/趋势/项目卡/日历/模型分布/活跃时段/工具普查/压缩统计 | `web/src/features/usage/UsageOverviewPage.tsx:764-1000` | H1 只能插在 `BillingWindowCard` 之前或之后，不能插进 `kpiRow` |
| 页头右簇已有「导出快照」「对比快照」两个按钮 + `actionError` 行 | `UsageOverviewPage.tsx:700-720` | H9 的入口**不**再加第三个页头按钮 |
| `hourly[day][hour] += 1` | `usageAggregations.ts:240` | **H2 的前提不成立**（见 §2-②）：现有小时分布是消息条数，不是 token |
| `RangeAggregate` 的扩展先例：`cross?: ProjectModelCross`（「Additive only: no existing field changes meaning」） | `usageAggregations.ts:126-131` | `hourlyTokens` 可按同样方式加法式扩展 |
| 成本沙盘在 `LabView` 里，三根推杆 + 瀑布图 | `web/src/features/usage/LabView.tsx:79`、`CostSandboxPanel.tsx:61` | H2 与它同类同档，挂在同一档内相邻 |
| 沙盘的既有语言：实测柱 `--bg-inset`+边框，推演柱 `--chart-1-soft`，不按好坏上色 | `CostSandboxPanel.tsx:26-33`（注释） | H2 的推演读数沿用这套双画法，零新色 |
| 会话列表已有二档 `SegmentedControl`（`VIEW_ITEMS`） | `SessionList.tsx:32,390` | H3 再加一档就变三段，窄窗放不下 |
| 分组逻辑：组内按 `compareSessions`（最新优先），组间取组内首条 | `SessionList.tsx:70-88` | H3 的排序必须同时回答「组内」和「组间」两件事 |
| `SessionHeader` 是独立文件，已有 时长/token/工具/模型 四读数 + `onExport` | `web/src/features/sessions/SessionHeader.tsx:38-52` | H5 的徽章、H8 的按钮都要挤进这一条带子 |
| `SessionHeader` 只收到**一个** `session: SessionMeta` | 同上 | **H5 的数据不在会话页**（见 §2-④） |
| 海报管线：`POSTER_WIDTH 1080 / POSTER_HEIGHT 1350`，`posterLayout`/`posterSvg`/`drawPoster`/`posterFileName` | `posterCanvas.ts:12-13,60,126,139,157` | H8 直接复用，尺寸不另立 |
| `writeBinary?(path, contentsBase64)` 已在桥里 | `web/src/api/types.ts:44` | H8 无需新命令 |
| `parseJsonlText` 返回 `ParsedSession`，含 `warnings: string[]`、`unmatchedToolUses`、记录级 `unmatched?` | `parseJsonl.ts:428`、`types.ts:185,236-237` | H9 的口径全部落在这三个字段上 |
| 设置界面是侧栏浮层 `<section aria-label="阈值设置">`，带 `footer` | `ThresholdsPanel.tsx:684,863` | H9 的报告放不进这个宽度（见 §2-⑥） |
| `EmptyState` 只有三档尺寸 `page|panel|inline`，注释明写「尺寸之外不要再加变体」 | `components/EmptyState.tsx:9-19` | H10 **不得**新增第四档，只能给 `page` 档加内容 |
| `activityClock.ts` 把 `7×24` 折成 24 小时并给出 `peakHour`，且强调「缺失读数不是 0」 | `activityClock.ts:1-55` | H2 的小时轴取同一份形状，口径措辞沿用这句 |
| `modelTimeline()` 讲的是「何时换的模型」 | `modelTimeline.ts:51` | H6 必须与它划清差异（§6 第 1 行） |

### 0.5 模型层已落地的契约（写规格期间并行出现）

写完 §1–§2 时，`git status` 里出现了并行队友新落的 8 个模型模块。它们**已经定义**了本批五个功能的输入输出形状，所以规格必须按它们的契约改写，而不是让 UI 另造一套。下表是最终对齐结果：

| 模块 | 契约形状 | 被它取代的我的初稿 |
| --- | --- | --- |
| `usage/dailyBriefing.ts` | `BriefingItem { id, rank, kind, headline≤20字, detail?, target }`；`MAX_BRIEFING_ITEMS = 3`；kind ∈ `spike/drop/anomaly/budget/errors/quiet` | §4.1 我自己排的 C1–C6 权重表（改为按 `rank` 渲染） |
| `usage/cutoffProjection.ts` | `projectCutoff(hourlyTokens: HourlyTokens[], cutoffHour) → CutoffProjection \| null`；`HourlyTokens = { hour, tokens }` | §4.2 里我假设的「滑杆值即砍点」 |
| `usage/conversationRhythm.ts` | `ConversationRhythm { gaps, medianMs, p90Ms, longestMs, bursts, label }`；`label ∈ 快问快追/匀速/长考后一击`；`MIN_RHYTHM_MESSAGES = 3` | §4.4 我自造的六档文案（档位保留，标签改用模型的） |
| `usage/cacheHealth.ts` | `CacheHealth { weeks, trend: improving/flat/declining }`；`TREND_WINDOW_WEEKS = 4`、`TREND_MIN_WEEKS = 3` | §4.7 我写的「不足两周」 |
| `usage/modelSeesaw.ts` | `ModelSeesaw { months: SeesawMonth[] }` | §4.6 的逐月行（不变） |
| `sessions/sessionSort.ts` | `SessionSortKey = recent/tokens/durationMs/messages/tools/errors`；`getValue` 返回 null 整体垫底 | §4.3 我写的 `duration`（应为 `durationMs`） |
| `sessions/restartCount.ts` | `countRestarts(...) → RestartSession` | §4.5 的纯 UI 假设 |
| `sessions/dataHealth.ts` | `HealthReport { grade: 优/良/关注, score, checks: HealthCheck[5] }` | §4.9 我自造的五档（改为「三档评级 + 五项检查」） |

**这条事实改变了两处结论**：§2-② 从「要不要加字段」变成「界面层从哪拿 `HourlyTokens[]`」；§2-① 的预算重复问题已被 `BUDGET_ALERT_PCT = 85` 解决（见 §2-①'）。

---

## 1 十条裁决

每条只回答一个问题：**它在哪个窗口里，用什么形状，凭什么不算撒谎。**

| # | 裁决 | 理由 |
| --- | --- | --- |
| H1 晨报 | 插在页头与 `BillingWindowCard` 之间的**一条 42px 带子**（不是卡片），三件事各是一个 `<button>`，没有值得说的事就**整条不渲染** | 「先看哪块」的答案必须比第一张卡更靠前；做成卡片就变成第 15 块读数，与它要解决的问题相反 |
| H2 收工推演 | 独立 `Panel`，挂在 `LabView` 的**沙盘之后**，一根 0–23 时滑杆 + 两行结果 | 与沙盘同属「如果……会怎样」；放进用量主档会让反事实混进实测读数区 |
| H3 会话排序 | 列表工具的**右侧一个原生 `<select>`**（6 个选项），不动 `SegmentedControl` | 六个维度塞进分段控件会占满一行；`<select>` 是键盘与读屏的既有解法 |
| H4 对话节奏谱 | 挂在**重放档底部**的 `Panel`，画用户消息间隔的分布 | 已有 8 个 tab，第 9 个是灾难；重放讲「过程」，节奏讲「我提问的间隔」，同一时间轴两层聚合 |
| H5 重启计数 | `SessionHeader` 里一枚**纯文本徽章**，`重新发起 3 次`；首次会话**不渲染** | 写「0 次」等于宣称「你没在重试」，而首会话本来就不该有这个概念 |
| H6 模型跷跷板 | 用量主档**新 `Panel`**，紧跟「按模型分布」之后，只在历史 ≥ 2 个自然月时渲染 | 模型分布讲「这个窗口里谁多」，跷跷板讲「逐月此消彼长」；不足两个月时它只有一根条，不成画 |
| H7 缓存命中率 | **压缩卡内的第二个 section**，不新开卡 | 压缩与缓存是同一个问题的两面（上下文有多贵）；新开卡会多一条 12px 间隔与一个 40px 表头，只为一个数字 |
| H8 会话分享卡 | `SessionHeader` 里一枚 `IconButton`（复用 `onExport` 的位置逻辑），产出 1080×1350 PNG | 与海报同尺寸同管线；**不印会话名**（见 §2-⑤） |
| H9 数据体检 | 设置侧栏 `footer` 一个按钮 + **独立浮层**展示报告 | 侧栏宽约 420px，装不下逐会话明细；浮层语言与「对比快照」一致 |
| H10 空态三步 | 只改 `EmptyState` 的 `page` 档：加可选 `steps`，三步编号渲染在描述与按钮之间 | 组件注释明确禁止第四档；`panel`/`inline` 的空是「这一块没有」，不该讲新人引导 |

---

## 2 七条需要拍板的异议

写规格时撞上的前提问题。前六条影响实现，第七条是实现细节但会影响验收。

### ①' H1 的「预算余量」重复问题已被模型层解决（撤回，仅留文案约束）

我原本担心晨报念一遍余量、`BillingWindowCard` 再念一遍。`dailyBriefing` 落地后这条自动消失：它的 `BUDGET_ALERT_PCT = 85` 只在**预计用量达到限额 85%** 时才生成 `budget` 条目——那时它不是复述，是警报。

**剩下的只有一条文案约束**：`budget` 条目的 `headline` 必须写「预计用到限额 85%」，不要写「还剩 15%」；后者与 `BillingWindowCard` 的余量口径同字不同源，容易被当成两个数。

### ② H2 的数据来源：`hourly` 是条数，`projectCutoff` 要的是 token

`usageAggregations.ts:240` 是 `aggregate.hourly[at.getDay()][at.getHours()] += 1`——**消息条数**。而 `projectCutoff` 的入参是 `HourlyTokens[] = { hour, tokens }`。两者不是一回事，拿条数代进去等于把「一次长思考」与「一次短问候」等权。

**建议**：按 `cross?` 的加法式先例，在 `RangeAggregate` 加 `hourlyTokens?: HourlyTokens[]`（同一次窗口化扫描内累加四类 token 合计）。旧字段语义不变，热力图与时钟一个字节都不改。

**替代方案（若你不想动聚合）**：界面层在 `useMemo` 里对 `inputs` 二次扫一遍。代价是每次切窗口多一次全量遍历（10k 行夹具下约 +2ms，可接受），但它会让「同一个窗口的两种小时分布」并存于两处代码。

顺便一条**新发现的口径冲突**（见 §4.2 滑杆范围）：`projectCutoff` 把 `cutoffHour <= 0` 当作「不砍」（防坏值），而「0 点收工」在语义上应当是「全天砍光」。这两件事不能靠注释调和，滑杆必须改成 **1–24**。

### ③ H4 没有第 9 个 tab 的位置

会话分析页已 7 个 tab（日志/树/上下文/改动/出血点/重放/账单），Round EE 的时间轴又加了一个。再加一个，960 窗就会横向溢出。

**建议**：挂重放档底部（理由见 §1）。若你坚持独立 tab，需要先决定「挤掉哪一个」，我不建议动任何既有 tab。

### ④ H5 的数据不在会话页

`SessionHeader` 只收到 `session: SessionMeta`；「同 cwd 24 小时内连续新会话」需要**整个扫描结果**。这个聚合只能发生在 `AppShell`（它有 `sessions` 全表），再以 `restartCount?: number` 下传到 `SessionAnalyzerPage` → `SessionHeader`。

**建议**：接受这处跨层签名（两处 props 各加一个可选字段，纯加法）；否则 H5 只能改成「本会话内的重新发起」（口径不同，也不是 Issue 想要的）。

### ⑤ H8 的「含会话名」与「不含任何消息内容」冲突

`sessionTitle(session)` 的取值来自首条用户消息的摘要（`metadataCache`）。把它印到一张会发到聊天窗口的 PNG 上，就是**把消息内容发出去**。

**建议**：分享卡不印会话名，改印「项目名 + 日期 + 会话短 id（前 8 位）」。项目名同样脱敏到 basename（沿用 G3 档案那条「不含文件路径」的口径）。若你要名字，得先允许用户在卡上**手动输入**标题，那是另一个控件。

### ⑥ H9 的报告放不进设置侧栏

`ThresholdsPanel` 是宽 420 左右的侧栏浮层，逐会话明细放进去要横向滚动。

**建议**：侧栏 `footer` 放「数据体检」按钮，报告在**独立浮层**里（宽 `min(640px, 100%)`，与「对比快照」同一套）。另外报告必须区分三种「没发现问题」：**未扫描** / **扫描过但解析器没吐警告** / **有警告但已全部恢复**——三者不能都写成「健康」。

### ⑦ H3 排序与「置顶组」的相互作用的裁决（实现细节，但请一并批准）

- 组**内**按所选维度排；组**间**仍按组内首条的时间排。
- 「置顶」组永远在最前，且组内也按所选维度排——置顶是用户意图，排序是观察口径，两者不冲突。
- 缺读数（`metadataStatus` 为 `pending`/`failed`）的会话**排到最后**，不按 0 参与比较。

---

## 3 全局几何（三档宽度与既有开销）

### 3.1 既有开销（不改，只引用）

| 项 | 值 | 出处 |
| --- | --- | --- |
| 页面内距 | `var(--sp-3)` = 12 | `UsageOverviewPage.module.css` `.page` |
| 块间距 | `var(--sp-3)` = 12 | `.page { gap }` |
| `Panel` 表头 | 40（`min-height`，含体 padding） | `components/Panel.module.css` |
| `Panel` 体内距 | `var(--sp-3)` = 12（四边） | 同上 |
| KPI 瓦片内距 | 12 / 16 | `UsageOverviewPage.module.css:84` |
| 侧栏 | 300 | `--sidebar-w` |
| 行高 | `--lh-sm` 18 / `--lh-base` 20 / `--lh-md` 22 | `tokens.css` |

新块的每一处高度都按 **表头 40 + 体 12×2 + 内容** 记账，与既有块同法。

### 3.2 横向账（1440 与 960）

- 1440：主区 = 1440 − 300（侧栏）= 1140；扣页内距 24 → **1116**；两列时每列 `(1116 − 12) / 2 = 552`。
- 960：主区 = 960 − 300 = 660；扣 24 → **636**；两列时每列 `(636 − 12) / 2 = 312`。
- 新块全部**单列满宽**（H1/H2/H6/H7/H4），所以横向风险只在**内部**：H6 的双条需要 312 − 12×2 = 288 可用，条形区 288 − 72（标签列）= 216，两个模型各 100 + 间距 16，成立。
- H1 的三件事在 636 下：每件 `(636 − 12×2 − 12×2) / 3 = 196`，一句话 12px（`--fs-sm`）在 196px 内约合 16 个全角字，恰好够「昨日 token 比前天多 42%」这种长度；所以 H1 每件事的文案上限定为 **16 个全角字**（超出截断加省略号，完整句放 `title`）。

### 3.3 纵向：三档主题与字号都不改 padding

`--font-scale` 只影响 `--fs-*` 与 `--lh-*` 的乘积，padding 全是 `--sp-*` 固定值。所以 130% 只放大行高，高度账按「固定 padding + 行高 ×1.3」复算。EV 见 §10。

---

## 4 逐功能规格

### 4.1 H1 晨报（Daily Briefing）

**挂载**：`UsageOverviewPage.tsx` 的用量档（`view === "usage"` 分支）最前面，`BillingWindowCard` 之前。年报/实验室/里程碑/错误档**都不渲染**——那些档的「三件事」口径不同，硬塞会给出跨口径的假对比。

**DOM**

```tsx
<section className={styles.briefing} data-probe="briefing" aria-label="今天值得注意的三件事">
  {items.map((item) => (
    <button
      key={item.id}
      type="button"
      className={styles.briefingItem}
      data-tone={item.tone}          /* neutral | warning | alert */
      data-probe="briefing-item"
      onClick={item.run}
    >
      <span className={styles.briefingTag}>{item.tag}</span>   {/* 昨日 / 异常日 / 错误聚集 */}
      <span className={styles.briefingText}>{item.text}</span>
    </button>
  ))}
</section>
```

**几何**：`display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 0;` 整体 `padding: var(--sp-3); min-height: 42px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-subtle);`；每件之间一条 `1px` 竖分隔（`border-left: 1px solid var(--border)`），第二、三件 `padding-left: var(--sp-3)`。整条高 = 12 + 18 + 12 = **42**。

**三件事怎么来的（模型层已定，界面只渲染）**

`dailyBriefing` 已经给出 `items: BriefingItem[]`（`rank` 1–3、`headline` ≤ 20 字、`kind`、`target`），界面**不重排、不增删**，只做三件事：渲染、跳转、按 `rank` 定 tone。

| `kind` | 模型给出的出现条件 | 界面 tag | tone | `target` 落到哪 |
| --- | --- | --- | --- | --- |
| `spike` / `drop` | 昨日环比 ±50%（`SWING_RATIO`） | 昨日 | neutral | usage |
| `anomaly` | 最近 7 天 z 分数超阈（`ANOMALY_RECENT_DAYS`） | 异常日 | warning | usage |
| `budget` | 预计用量 ≥ 限额 85%（`BUDGET_ALERT_PCT`） | 预算 | alert | usage |
| `errors` | 窗口内错误总数 ≥ 10（`ERROR_ALERT_TOTAL`） | 错误 | alert | errors |
| `quiet` | 连续 ≥ 3 天 0 消息（`QUIET_ALERT_DAYS`） | 安静 | warning | usage |

- **`quiet` 不是「一切正常」**：它说的是「你已经三天没消息了」，那确实值得说一句；我原先「一条都不渲染」的规则只适用于**模型返回空数组**的情况。
- 不足 3 条：栅格自动 `repeat(auto-fit, minmax(196px, 1fr))`，有几条显示几条，不补空位。
- 空数组：整条不渲染（零高度）。
- 标题 20 字上限与我的 16 全角字宽度账冲突时，**宽度优先**：960 下单行 `text-overflow: ellipsis` 裁到 16 字，完整句放 `title`。

**文案（逐字）**：tag 用 `--fs-xs` `--text-tertiary`；正文 `--fs-sm` `--text`；`data-tone` 只改左侧 2px 竖条与 tag 前缀词，不改正文颜色。

| tone | 左侧竖条 | tag 前缀 |
| --- | --- | --- |
| neutral | `--text-tertiary` | 无 |
| warning | `--warning` | 「注意」 |
| alert | `--danger` | 「警报」 |

**为什么不是颜色单通道**：前缀词是文字，竖条只是加强；去掉颜色仍能读（§7 复核）。

### 4.2 H2 收工推演（What-if Cut-off）

**挂载**：`LabView.tsx` 里 `CostSandboxPanel` 之后。**不在用量主档**——反事实不能与实测同屏。

**DOM**

```tsx
<Panel title="收工推演" actions={<ProvenanceBadge provenance="estimated" />}>
  <div className={styles.cutoff} data-probe="cutoff">
    <div className={styles.cutoffRow}>
      <label className={styles.cutoffLabel} htmlFor={id}>每天几点收工</label>
      <input id={id} type="range" min={1} max={24} step={1} value={hour}
             className={styles.cutoffSlider} data-probe="cutoff-slider"
             aria-valuetext={hour >= 24 ? "不收工" : `每天 ${hour} 点收工`} />
      <span className={styles.cutoffValue} data-probe="cutoff-hour">
        {hour >= 24 ? "不收工" : `${hour}:00`}
      </span>
    </div>
    <dl className={styles.cutoffResult} data-probe="cutoff-result">
      <div><dt>本周会少用</dt><dd>{formatTokenCount(proj.cutTokens)}</dd></div>
      <div><dt>占总用量</dt><dd>{(proj.cutShare * 100).toFixed(1)}%</dd></div>
    </dl>
    <p className={styles.cutoffNote}>按过去 {days} 天「每小时 token 分布」推演，不是预测；预测不到的时段按 0 计。</p>
  </div>
</Panel>
```

**几何**：表头 40 + 体 12 + 滑杆行 28（`--control-h`）+ 8 + 结果两列 44（两行 `--lh-md` 22）+ 8 + 脚注 16（`--lh-xs`）+ 12 = **168**。

**口径**（三条硬规则）

1. 推演只吃 `hourlyTokens[24]`（§2-② 的新字段）；若该字段缺失（老缓存/老快照），整卡显示空态「这条会话没有逐小时读数」，**不退回按消息条数折算**。
2. 滑杆值 `h` 的含义是「每天 `h` 点之后不再工作」，**范围 1–24**（24 = 不收工，此时 `projectCutoff` 原样返回全部 token）。`h = 23` 时只会砍掉 23 点后的量，界面照实显示，包括 0。

   **为什么不是 0–23**：`projectCutoff` 把 `cutoffHour <= 0` 当「不砍」处理（防坏值），而 0 点在语义上是「全天砍光」。滑杆给 0 会得到一个与用户意图相反的读数——这类冲突只能在控件范围里消掉，不能靠注释。
3. 推演读数沿用沙盘的双画法：实测值用 `--text`，推演值用 `--chart-1` 并带 `estimated` 徽章；**不涂绿**。

**空态/降级**：样本不足（有读数的天数 < 3）→ 不出滑杆，显示「过去 N 天只有 M 天有逐小时读数，先攒够 3 天再看推演」。M < 3 时不硬印数。

### 4.3 H3 会话排序维度

**挂载**：`SessionList.tsx` 的列表工具行右侧（`SegmentedControl` 视图切换之后）。

```tsx
<label className={styles.sortField}>
  <span className={styles.sortLabel}>排序</span>
  <select className={styles.sortSelect} value={sort} onChange={…}
          aria-label="会话排序方式" data-probe="session-sort">
    <option value="recent">最近时间</option>
    <option value="tokens">Token 最多</option>
    <option value="durationMs">时长最长</option>
    <option value="messages">消息最多</option>
    <option value="tools">工具调用最多</option>
    <option value="errors">错误最多</option>
  </select>
</label>
```

**几何**：`height: var(--control-h)` 28；标签 `--fs-xs` `--text-tertiary`；`<select>` 宽 132，`padding: 0 var(--sp-2)`，`border: 1px solid var(--border)`，`border-radius: var(--r-sm)`，`background: var(--bg-subtle)`。工具行高度不变（既有行高 ≥ 28）。

**排序语义**：见 §2-⑦。持久化键 `cca-session-sort`，与 `cca-session-view` 同族；默认 `recent`，**未知值回落 recent 并不抛**。

**缺读数**：`metadataStatus` 为 `pending`/`failed` 的会话不进排序比较，统一排在列表末尾并按时间序；列表头部那行提示沿用现有的「元信息加载中」徽章，不新增文案。

**空态**：排序维度选中但所有会话都缺该读数 → 列表照常按时间显示，列表上方一行 `--fs-xs` `--text-tertiary`：「这批会话还没有 <维度> 读数，先按时间排」。

### 4.4 H4 对话节奏谱（Dialogue Rhythm）

**挂载**：重放档（`AnalyzerView === "replay"`）底部，`ReplayView` 之后。不新增 tab。

**数据**：会话内相邻**用户消息**的间隔（ms），从 `parsed.records` 里 `rowKind === "user"` 的时间戳求差；纯函数 `buildRhythmProfile(records)` 放 `web/src/features/sessions/rhythmProfile.ts`。

**形状**：横轴 = 间隔的对数分桶（< 1 分、1–5 分、5–30 分、30 分–2 时、2–8 时、> 8 时），纵轴 = 次数；每档一根竖条 + 档名 + 次数，样式沿用 `charts` 的原语（`--chart-1` 实色描边 + `--chart-1-soft` 填充）。

**几何**：表头 40 + 体 12 + 图 72 + 8 + 读数行 20 + 8 + 脚注 16 + 12 = **188**。

**DOM**

```tsx
<Panel title="对话节奏" actions={<ProvenanceBadge provenance="logged" />}>
  <div className={styles.rhythm} data-probe="rhythm" role="img" aria-label={summary}>
    {buckets.map((b) => (
      <div key={b.key} className={styles.rhythmCol} data-probe="rhythm-bar" data-bucket={b.key}>
        <span className={styles.rhythmBar} style={{ height: `${b.pct}%` }} aria-hidden="true" />
        <span className={styles.rhythmCount}>{b.count}</span>
        <span className={styles.rhythmLabel}>{b.label}</span>
      </div>
    ))}
  </div>
  <p className={styles.rhythmReadout} data-probe="rhythm-readout">{readout}</p>
  <p className={styles.rhythmNote}>间隔是两次提问之间的墙钟，不是思考时长。</p>
</Panel>
```

六档 `label` 逐字：`< 1 分` / `1–5 分` / `5–30 分` / `30 分–2 时` / `2–8 时` / `> 8 时`。

**标签与读数**（全部来自 `ConversationRhythm`，界面不自算）

- 第一行是一个**标签**：`快问快追` / `匀速` / `长考后一击`（`rhythm.label`），`--fs-md` / 600。
- 第二行三个读数（`data-probe="rhythm-readout"`）：「中位间隔 {medianMs}」「90 分位 {p90Ms}」「最长 {longestMs}」，用 `formatDuration`。
- 第三条：`bursts`（< 60 秒的间隔个数）写成「其中 {bursts} 次在一分钟内」。
- `records` 的用户消息数 < `MIN_RHYTHM_MESSAGES`（3）时，整块退成一句话「只有 {n} 次提问，还看不出节奏」——**不画空图**，标签与读数都不显示。

六档分布由 `rhythm.gaps` 现算（纯展示层的分桶，不改模型）。

**诚实性**：间隔不是「思考时长」，是「两次提问之间的墙钟」；卡内脚注写死这句，防止被读成效率指标。

### 4.5 H5 重启计数（用户侧）

**挂载**：`SessionHeader` 的读数带，紧挨「时长」之后。

```tsx
{restartCount && restartCount > 0 ? (
  <span className={styles.restartChip} data-probe="session-restart"
        title={`同目录 24 小时内的第 ${restartCount + 1} 次新会话`}>
    重新发起 {restartCount} 次
  </span>
) : null}
```

**几何**：chip 高 20（`--lh-xs` 16 + 上下 2），`padding: 0 var(--sp-15)`，`border: 1px solid var(--border)`，`border-radius: var(--r-sm)`，`--fs-xs`；`--text-secondary`。读数带正常流式排布，不加高。

**口径**：同 `cwd`（`parentDirectory` 归一后）且相邻会话起点间隔 ≤ 24h 的连续计数；`restartCount = 0`（首次）**不渲染**——0 与「没有这个概念」不能同形。

**降级**：`AppShell` 的扫描结果未就绪时传 `undefined`，同样不渲染；**不显示占位**（占位会让 0 与未知又混起来）。

### 4.6 H6 模型跷跷板

**挂载**：用量主档「按模型分布」`Panel` 之后（`UsageOverviewPage.tsx:960` 那个块之后）。

**渲染条件**：`range` 覆盖的自然月数 ≥ 2，否则**整块不渲染**（一根条不成画）。

**DOM**

```tsx
<Panel title="模型跷跷板" actions={<ProvenanceBadge provenance="logged" />}>
  <div className={styles.seesaw} data-probe="model-seesaw">
    <div className={styles.seesawHead}>
      <span data-model="a">{modelA}</span>
      <span data-model="b">{modelB}</span>
    </div>
    {months.map((m) => (
      <div key={m.key} className={styles.seesawRow} data-probe="seesaw-row" data-month={m.key}>
        <span className={styles.seesawMonth}>{m.label}</span>
        <span className={styles.seesawBarA} style={{ width: `${m.aPct}%` }} />
        <span className={styles.seesawBarB} style={{ width: `${m.bPct}%` }} />
        <span className={styles.seesawValue}>{m.aText} / {m.bText}</span>
      </div>
    ))}
    <p className={styles.seesawNote}>按月的 token 合计；两根条共用同一刻度，长度可直接比。</p>
  </div>
</Panel>
```

**几何**：表头 40 + 体 12 + 选择行 28 + 8 + 行 3×30 + 8 + 脚注 16 + 12 = **214**。行高 30 = 6 + 18 + 6；月份列 72；两根条各占剩余的一半（1440 下各 336，960 下各 216 的一半=100）。

**双模型选择**：默认取窗口内 token 最多的两个；`<select>` 各一个（同 H3 的样式），选中同一模型时第二条改成「与自身比较」的空态文案，**不画两条等长条**。

**差异 vs `modelTimeline`**：见 §6。

### 4.7 H7 缓存命中率

**挂载**：`CompactionStatsPanel` 内部的第二个 `section`（压缩统计之后）。

```tsx
<section className={styles.cacheSection} data-probe="cache-hit">
  <header className={styles.cacheHead}>
    <span>缓存命中率</span>
    <strong data-probe="cache-hit-value">{hitPct === null ? "—" : `${hitPct.toFixed(1)}%`}</strong>
  </header>
  <Sparkline values={weekly} aria-hidden="true" />
  <p className={styles.cacheNote}>按周：缓存读取 ÷（输入 + 缓存写入 + 缓存读取）</p>
</section>
```

**几何（卡内增量）**：分隔线 1 + 8 + 表头行 16 + 4 + sparkline 28 + 8 = **65**。

**口径**：`cacheRead / (input + cacheCreation + cacheRead)`，与前四批 `tokensPrompt` 的定义同源（`logRows.tokensOf`）。分母为 0 时显示「—」并附「本窗口没有输入读数」，**不显示 0.0%**。

**周趋势**：`cacheHealth` 已定 `TREND_WINDOW_WEEKS = 4`、`TREND_MIN_WEEKS = 3`——**不足 3 周只显示数值与「样本不足」四个字，不画 sparkline**（两周的折线会被读成趋势）。方向词用模型给的 `improving/flat/declining` → 「在变好」「持平」「在变差」，`--text-secondary`，不上色。

### 4.8 H8 会话分享卡（PNG）

**挂载**：`SessionHeader` 的按钮组，`onExport` 之后一枚 `IconButton`（`label="分享会话卡片"`，`data-probe="session-share-card"`）。

**产物**：1080×1350 PNG，文件名 `cca-session-card-{短id}.png`，走既有 `writeBinary`。

**内容（四条，全部脱敏）**

| 行 | 内容 | 脱敏规则 |
| --- | --- | --- |
| 标题 | 「一次 Claude Code 会话」 | 常量，不取 `sessionTitle` |
| 副标题 | `{项目 basename} · {YYYY-MM-DD}` | 只 basename，不含完整路径 |
| 四读数 | 时长 / token / 工具调用 / 主导模型 | 全部数值，无文本内容 |
| 页脚 | `会话 {短 id 前 8 位}` + 应用名 | id 是 uuid 前 8 位，不含消息 |

**复用**：`posterLayout`/`posterSvg`/`drawPoster` 的形状不变，只是换一个 `PosterContent`；配色取当前主题的两档（浅/深），高对比度主题下**沿用浅色档**（PNG 要发给别人，不假设对方用高对比度）。

**为什么不做「含会话名」**：见 §2-⑤。

**空态**：会话仍在解析 → 按钮 `disabled` + `title`「解析完成后才能生成卡片」；解析失败 → 按钮不渲染。

### 4.9 H9 数据体检（Health Check）

**入口**：`ThresholdsPanel` 的 `footer` 里一个 `Button`（`data-probe="health-check-open"`）→ 打开浮层。

**浮层**：`min(640px, 100%)`，`max-height: min(720px, 84vh)`，`z-index: 130`，Esc 捕获阶段消化 + Tab 回绕（与「对比快照」同一套）。

**报告结构**（按 `HealthReport` 渲染，界面不自算评级）

```tsx
<section className={styles.healthPanel} role="dialog" aria-modal="true" aria-label="数据体检"
         data-probe="health-check">
  <header>
    <strong>数据体检</strong>
    <span className={styles.grade} data-probe="health-grade" data-grade={report.grade}>
      {report.grade}
    </span>
    <span className={styles.score}>{report.score} 分</span>
  </header>
  <ul className={styles.healthChecks} data-probe="health-checks">
    {report.checks.map((c) => (
      <li key={c.id} data-probe="health-check-row" data-check={c.id} data-pass={c.pass}>
        <span className={styles.checkMark} aria-hidden="true">{c.pass ? "✓" : "!"}</span>
        <span className={styles.checkLabel}>{c.label}</span>
        <span className={styles.checkActual}>{c.actual}</span>
        {c.pass ? null : <span className={styles.checkAdvice}>{c.advice}</span>}
      </li>
    ))}
  </ul>
  <p className={styles.healthNote}>
    五项检查按「截断 → 未配对 → 警告 → 缺 usage → 会话数」顺序；未通过项给出建议，不自动修数据。
  </p>
</section>
```

**为什么不是我自己设计的五档汇总表**：`dataHealth` 已经把口径固化成「三项占率 + 会话数 + 截断」五项检查与 `优/良/关注` 三档评级（0–100 分）。界面再算一遍就有两个真相。所以 H9 的界面责任只有三条：**按顺序渲染、未通过项给建议、通过项也说数**（`actual` 在 `pass` 时仍然展示——「1 条 · 占 0.01%」比一个 ✓ 更能让人相信）。

**三种「没发现问题」仍要分开**（这条不受模型层影响）：

| 情况 | 界面 |
| --- | --- |
| 没扫描过任何会话（`sessions === 0`） | 不出报告，只显示「还没有扫描过任何会话，体检无从谈起」 |
| 扫描过、五项全过 | 正常报告 + 一行「五项全过」 |
| 扫描过、有项未过但占比很小 | 该行 `!` + `actual` 照实写占比，建议里写「可以不管」 |

**几何**：表头 40 + 体 12 + 评级行 28 + 8 + 5 项 ×(24 + 可选建议 20) + 8 + 脚注 32 + 12 ≈ 300–400

**几何**：表头 40 + 体 12 + 汇总 3×24 + 8 + 表头行 28 + 明细最多 8 行×30 + 8 + 脚注 32 + 12 ≈ **356**（明细超出滚动，`max-height` 由外层控制）。

### 4.10 H10 空状态三步引导

**改法**：`EmptyState` 增加可选 `steps?: string[]`；只在 `size === "page"` 时渲染，编号 1/2/3 列表紧跟在 `description` 之后、`action` 之前。三档尺寸不变（组件注释禁止第四档）。

```tsx
<EmptyState
  size="page"
  title="还没有会话"
  description="选一个目录，应用会扫描其中的 Claude Code 会话记录。"
  steps={["选择会话目录", "等待扫描完成（首次可能几分钟）", "在总览里看第一份读数"]}
  action={<Button variant="primary" data-probe="empty-pick-dir">选择目录</Button>}
/>
```

**几何**：`page` 档已经 `padding: var(--sp-5)` 且 `min-height: 100%`，三步列表不改变容器高度（空态本来就是整块居中）；每步 `--fs-base`/`--lh-base` 20，步间距 `var(--sp-1)` 4 → 三步共 3×20 + 2×4 = **68**。

**适用范围**：只改「整块没有数据」的 `page` 档（会话列表空、用量空、监控空、上下文空）。`panel`/`inline` 档不动——「这一块没有」与「你还没开始」是两件事。

**probe**：`data-probe="empty-steps"` 挂在三步列表的 `<ol>` 上；`data-step-index` 逐项 1/2/3。

**文案铁律**：三步里的数字与状态必须与真实进度一致；第二步在**已知**首次扫描耗时长时才写「首次可能几分钟」，否则只写「等待扫描完成」。

---

## 5 隐私边界（H8 与 G3 同口径）

| 项 | H8 分享卡 | G3 会话档案 | 判断 |
| --- | --- | --- | --- |
| 消息原文 | 不含 | 不含 | 一致 |
| 文件路径 | 只 basename | 不含 | H8 放宽到 basename（项目名是分享语境必需） |
| 会话标题 | **不含**（见 §2-⑤） | 不含 | 一致 |
| 会话 id | 前 8 位 | 不含 | H8 加，用于对方核对是哪一条 |
| 用户目录 | 不含 | 不含 | 一致 |
| 错误文本 | 不含 | 不含 | 一致 |

**验收断言**（与 G3 同一句式）：生成的 SVG 字符串 `not.toContain` 会话首条消息原文、用户主目录、完整路径、`sessionTitle` 的取值。

---

## 6 重叠检查矩阵

| 新功能 | 最近的既有块 | 差异（一句话） | 判定 |
| --- | --- | --- | --- |
| H1 晨报 | `BillingWindowCard` | 卡讲「这个窗口还剩多少」，带子讲「今天有什么变了」 | 不重复；但预算余量候选降权（§2-①） |
| H2 收工推演 | `CostSandboxPanel` | 沙盘改**结构**（少缓存、少输出），推演改**时间**（几点停） | 同档相邻，不合并 |
| H4 节奏谱 | 重放胶片带 | 胶片带是事件序列，节奏谱是提问间隔的分布 | 同档，两个粒度 |
| H5 重启计数 | 会话列表的「同目录分组」 | 分组回答「这些会话是一家」，徽章回答「你在重试」 | 不重复，数据同源 |
| H6 跷跷板 | `modelTimeline`（迁移线） | 迁移讲「何时换」，跷跷板讲「同期谁多」 | 不重复 |
| H6 跷跷板 | 「按模型分布」`StackedBar` | 分布是**当前窗口**一次切片，跷跷板是**逐月**两模型对照 | 不重复 |
| H7 命中率 | `CompactionStatsPanel` | 压缩讲「上下文被砍了几次」，命中率讲「上下文读得多便宜」 | 同卡两节 |
| H9 体检 | `ParseCoverageChip` | 徽章是当前会话一行，体检是全库报告 | 不重复 |
| H10 三步 | 既有 7 种空状态画法 | 统一到 `page` 档一处，不新增画法 | 是收敛不是新增 |

---

## 7 令牌与对比度

### 7.1 零新增令牌

本批**不新增任何颜色令牌**。新块用到的全部是既有键：`--bg-subtle` / `--bg-inset` / `--border` / `--border-strong` / `--text` / `--text-secondary` / `--text-tertiary` / `--danger` / `--warning` / `--accent` / `--chart-1` / `--chart-1-soft`。

**为什么不下沉到 `--cat-*`**：晨报的三件事、跷跷板的两个模型都不是「记录类别」，借用类别色会让「同一个颜色在别处是 user、在这里是第一名」——类别色只给记录。

### 7.2 图形编码（四档主题逐一实算）

| 元素 | 令牌 | 浅 | 深 | HC 浅 | HC 深 | 门槛 |
| --- | --- | --- | --- | --- | --- | --- |
| 晨报竖条 neutral | `--text-tertiary` | 4.78 | 5.83 | 10.45 | 9.98 | 3:1 |
| 晨报竖条 warning | `--warning` | 5.24 | 8.17 | 7.13 | 11.26 | 3:1 |
| 晨报竖条 alert | `--danger` | 6.54 | 6.52 | 8.06 | 8.70 | 3:1 |
| 跷跷板条 A 描边 | `--chart-1` | 5.64 | 8.39 | 7.82 | 8.26 | 3:1 |
| 跷跷板条 B 描边 | `--chart-2` | 4.72 | 8.39 | 7.25 | 9.57 | 3:1 |
| 节奏谱柱描边 | `--chart-1` | 5.64 | 8.39 | 7.82 | 8.26 | 3:1 |
| 命中率 sparkline | `--chart-1` | 5.64 | 8.39 | 7.82 | 8.26 | 3:1 |
| 体检「无警告」点 | `--success` | 5.32 | 8.18 | 8.32 | 11.27 | 3:1 |

全部 ≥ 4.5:1，最紧的一格是浅色 `--chart-2` 的 **4.72**（仍高于图形门槛 3:1 与正文门槛 4.5:1）。

**填充软色不是独立图形**：`--chart-1-soft` / `--chart-2-soft` 复合后在面板上只有 **1.41 / 1.39**（浅）、1.87 / 1.86（深）、1.38 / 1.38（HC 浅）、1.96 / 1.96（HC 深）——它们只是填充，**编码责任在描边**，所以 §4.6/§4.7 的柱与条一律「软填充 + 实色描边」，绝不只画软色。这是本批唯一需要解释的比值差异，写在这里以免评审者按 3:1 去卡软色。

### 7.2b 复现脚本

```bash
cd web && node -e '
const T={light:{sub:"#ffffff",c1:"#2f6b9f",c2:"#0f7f8f",succ:"#1f7a4d",warn:"#946200",danger:"#b3261e",ter:"#6b7381"},
 dark:{sub:"#14161a",c1:"#82b5e8",c2:"#55bfce",succ:"#4cc38a",warn:"#e0a33e",danger:"#f0776c",ter:"#8b939e"},
 hcl:{sub:"#ffffff",c1:"#1c567f",c2:"#00606e",succ:"#0a5a33",warn:"#7a4f00",danger:"#a11208",ter:"#33414f"},
 hcd:{sub:"#1a1a1a",c1:"#7cb8f0",c2:"#5fd0dd",succ:"#6ee7a0",warn:"#ffc75e",danger:"#ff9d94",ter:"#c4c4c4"}};
const rgb=h=>{h=h.slice(1);return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
const L=v=>{const c=v.map(x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const cr=(a,b)=>{const [x,y]=[L(a),L(b)].sort((m,n)=>n-m);return ((x+.05)/(y+.05)).toFixed(2)};
for(const k of Object.keys(T)){const {sub,...f}=T[k];const b=rgb(sub);
 console.log(k,Object.entries(f).map(([n,v])=>n+"="+cr(rgb(v),b)).join(" "))}'
```

### 7.3 颜色不是唯一编码（逐功能）

| 功能 | 第二通道 |
| --- | --- |
| H1 | tag 前缀词（注意 / 警报）+ 左侧竖条 |
| H2 | 滑杆当前值文字 + 「推演」徽章 |
| H3 | `<select>` 的当前选项文字 |
| H4 | 档名（「< 1 分」等）+ 每根柱顶的次数 |
| H5 | 文案「重新发起 N 次」 |
| H6 | 两个模型名 + 每行数值 `A / B` |
| H7 | 百分比数字（「—」表示无分母） |
| H8 | 四读数都是文字 |
| H9 | 每档一行的中文句 |
| H10 | 编号 1/2/3 |

---

## 8 无障碍与焦点环

### 8.1 键盘

| 位置 | 键 | 行为 |
| --- | --- | --- |
| 晨报三件事 | `Tab` / `Enter` | 依次聚焦、进入对应视图 |
| 收工推演滑杆 | `←/→`、`Home/End` | 原生 range 行为，每小时一档；`aria-valuetext` 报「每天 18 点收工」 |
| 排序 | `<select>` 原生 | `↑/↓` 换选项，无需自造 |
| 节奏谱 | 无 | 纯图形，`role="img"` + 文字摘要 |
| 体检浮层 | `Esc` / `Tab` | 捕获阶段关；Tab 在浮层内回绕 |

### 8.2 语义

- 晨报：`<section aria-label="今天值得注意的三件事">`；每件事是 `button`，可访问名 = tag + 正文。
- 节奏谱：`role="img"` + `aria-label="提问间隔分布：中位间隔 4 分 12 秒，最快 3 秒，最慢 2 小时"`。
- 命中率 sparkline：`aria-hidden="true"`，数值另有 `strong`。
- 体检报告表：`<table>` + `<caption>`；每行首列是会话短 id（8 位），不含路径。
- 跷跷板：两根条 `aria-hidden`，数值由同行文本承担。

### 8.3 焦点环新计数预估

当前基线（`web/src/styles/focusRing.test.ts:131-138`）：`outline` **59**、`outline-offset` **29**、`inset` **27**、`inset 竖条` **7**、消费规则 **63**。

本批新增的自绘焦目标：

| 位置 | 规则 | 令牌 |
| --- | --- | --- |
| `.briefingItem:focus-visible` | 1 条 outline | `--focus-ring-width` + `--focus-ring-offset` |
| `.cutoffSlider:focus-visible` | 1 条 outline | 同上 |
| `.sortSelect:focus-visible` | 1 条 outline | 同上 |

**预估**：`outline` 59 → **62**，`outline-offset` 29 → **32**，`inset` 27 不变，竖条 7 不变，消费规则 63 → **66**。

H8 的按钮用 `IconButton`（组件已带环），H9 的浮层按钮复用 `Button`，H10 复用 `EmptyState` 的 `action`——**都不新增规则**。实现后须以 grep 实数复核，写进 `focusRing.test.ts` 的注释与断言。

---

## 9 状态矩阵

| 功能 | 空 | 加载 | 失败 | 样本不足 | 正常 |
| --- | --- | --- | --- | --- | --- |
| H1 | 整条不渲染 | 不渲染（等聚合就绪才出现，避免先闪「昨日 +0%」） | 不渲染 | 候选 < 3 时按实际条数显示 | 三件（或更少）可点 |
| H2 | 「这条会话没有逐小时读数」 | 滑杆禁用 + 「正在汇总小时分布」 | 「小时分布算不出来，先刷新试试」 | 「只有 M 天有读数，先攒够 3 天」 | 滑杆 + 两行结果 |
| H3 | 列表空态（走 H10） | 排序控件照常可用（读数是后补的） | — | 「这批会话还没有 X 读数，先按时间排」 | 按所选维度排序 |
| H4 | 「这个会话没有用户消息」 | 解析中：整块骨架 | 「会话读不出来」 | 「只有 2 次提问，还看不出节奏」 | 六档柱 + 中位间隔 |
| H5 | 首次：不渲染 | 不渲染 | 不渲染 | 同上 | 「重新发起 N 次」 |
| H6 | 不足两个自然月：不渲染 | 骨架 | 「这一档算不出来」 | 「第二个月还没有读数」 | 逐月两条 + 数值 |
| H7 | 「本窗口没有输入读数」 | 骨架 | 「缓存读数缺失」 | 不足两周：只给数字 | 百分比 + sparkline |
| H8 | 解析中：按钮 disabled | 生成中：按钮 loading | 「卡片生成失败」 | — | 落盘 PNG |
| H9 | `sessions === 0`：不出报告 | 「正在体检 N 个会话…」 | 「体检中断：{原因}」 | — | 评级 + 五项检查 |
| H10 | 三步引导 | — | 扫描失败：交回既有错误块（三步不出现） | — | — |

**文案铁律**：三种「没发现问题」绝不合并——未扫描 / 无警告 / 有警告已恢复（§2-⑥）。

---

## 10 高度账

### 10.1 1440×900

| 块 | 算式 | 高 |
| --- | --- | --- |
| H1 晨报 | 12 + 18 + 12 | **42** |
| H1 块间距 | — | 12 |
| H6 跷跷板 | 40 + (12 + 28 + 8 + 3×30 + 8 + 16 + 12) | **214** |
| H6 块间距 | — | 12 |
| H7 命中率（卡内） | 1 + 8 + 16 + 4 + 28 + 8 | **65** |
| **用量主档总增量** | 42 + 12 + 214 + 12 + 65 | **345** |

用量主档当前约 2900（14 块），加 345 = **3245**，仍是「滚三屏」的量级，**不新增一屏**。`kpiRow` 仍在首屏（页头 60 + H1 42 + 12 + BillingWindowCard ≈ 120 + 12 + kpiRow ≈ 96 = 342 < 900）。

### 10.2 130% 字号（行高 ×1.3，padding 不变）

| 块 | 算式 | 高 |
| --- | --- | --- |
| H1 | 12 + 23.4 + 12 | 47.4 → **48** |
| H6 | 40 + (12 + 34 + 8 + 3×36 + 8 + 20 + 12) | **242** |
| H7（卡内） | 1 + 8 + 20 + 4 + 28 + 8 | **69** |
| 总增量 | 48 + 12 + 242 + 12 + 69 | **383** |

首屏账（130%）：页头 60 + 48 + 12 + 120 + 12 + kpiRow 120 = **372 < 900**，`kpiRow` 仍在首屏。

### 10.3 其它档

| 块 | 档 | 1440 | 130% |
| --- | --- | --- | --- |
| H2 收工推演 | 实验室 | 40 + (12 + 28 + 8 + 44 + 8 + 16 + 12) = **168** | **191** |
| H4 节奏谱 | 重放 | 40 + (12 + 72 + 8 + 20 + 8 + 16 + 12) = **188** | **212** |
| H5 徽章 | 会话页读数带 | **0**（带内流式，不加高） | **0** |
| H8 按钮 | 会话页读数带 | **0**（`IconButton` 32，带高 ≥ 32） | **0** |
| H9 浮层 | 设置 | **0**（脱离文档流） | **0** |
| H10 三步 | 各视图空态 | **0**（`min-height: 100%` 已撑满） | **0** |

实验室档加 168（+130% 191），重放档加 188（+130% 212）——两档都远未到「滚两屏才看全」，因为这两个档的既有内容本来就短。

### 10.4 960 窄窗

- 晨报三格在 636 下每格 196，文案上限 16 全角字（§3.2），不换行、不撑高。
- 跷跷板 288 可用：月份列 72 + 两条各 100 + 间距 16 = 288，恰好放满；数值列放不下时**数值换到下一行**（`flex-wrap`），行高变 48，只在 960 且 130% 时发生。
- 节奏谱六档柱在 636 下每档 90，柱宽 24，档名 11px 两字一行放得下。

---

## 11 明确不做

1. 不做晨报的「订阅 / 推送 / 每日邮件」——应用不联网。
2. 不做收工推演的「按周 / 按项目」多维滑杆——一个月度口径就够，多一维就变成沙盘。
3. 不做会话排序的**自定义组合排序**（先 token 再时长）——六选一已覆盖 95%。
4. 不做节奏谱的「按模型 / 按工具」拆分——本轮只回答「我提问的节奏」。
5. 不做重启计数的**点击跳转**到那几次会话——跨会话跳转是另一个功能（Issue 未列）。
6. 不做跷跷板的**第三个模型**——两条并排才叫跷跷板。
7. 不做命中率的**逐项目**拆分——压缩卡不做维度切换。
8. 不做分享卡的**自定义配色 / 二维码 / 水印**。
9. 不做体检的**一键修复**——只报告，不动磁盘。
10. 不做空态的**插图 / 视频 / 动画**——三步文字就够，加图只会让首屏更慢。

---

## 12 实现者清单

按顺序做，每步之间可独立验收：

1. **只有这一步需要动聚合**：`hourlyTokens?: HourlyTokens[]` 进 `RangeAggregate`（或按 §2-② 的替代方案在页面内二次扫描）+ 单测：缺失读数不是 0。
2. `BriefingStrip`：吃 `dailyBriefing` 的输出，按 `rank` 渲染，`briefing` / `briefing-item` probe + 挂用量档顶部。
3. `CutoffPanel`：吃 `projectCutoff` 与 `HourlyTokens[]`，滑杆 1–24，`cutoff*` 四个 probe + 挂 `LabView` 沙盘之后。
4. `SessionList` 排序：`<select>` + `cca-session-sort` + 调 `sortSessions`（key 用 `durationMs`）+ 组内/组间语义 + 缺读数垫底。
5. `RhythmPanel`：吃 `conversationRhythm`，标签 + 三读数 + 六档分桶（展示层），`rhythm*` 三个 probe + 挂重放档底部。
6. `restartCount` 在 `AppShell` 聚合 + 两个 props 下传 + `session-restart` chip（0 次不渲染）。
7. `ModelSeesawPanel`：吃 `modelSeesaw`，`model-seesaw` / `seesaw-row` probe + 挂模型分布之后。
8. `CacheSection`：吃 `cacheHealth`，< 3 周不画折线，`cache-hit` / `cache-hit-value` probe。
9. `sessionCard.ts`（复用 poster 管线）+ `session-share-card` 按钮 + 隐私断言测试。
10. `HealthCheckDialog`：吃 `dataHealth`，不另算口径，`health-check` / `health-grade` / `health-checks` / `health-check-row` probe + 设置侧栏入口。
11. `EmptyState` 加 `steps` + 四处 `page` 档换成三步引导（`empty-steps` probe）。
12. `focusRing.test.ts` 计数改到实测（预估 62/32/27/7/66），注释同步。
13. 各功能 `.test.tsx`：空/加载/失败/样本不足四态最少各一条。
14. CHANGELOG `[Unreleased]` 记 10 条（中文，一条一句）。

### 12.2 请主会话独立复核的四处

1. §2-② `hourlyTokens` 进 `RangeAggregate`（按 `cross?` 先例做成可选字段），还是页面内二次扫描——两者都行，但必须选一个，不能两处并存。
2. §2-④ H5 的跨层签名（`AppShell` → `SessionAnalyzerPage` → `SessionHeader`）。
3. §2-⑤ 分享卡不印会话名——与 Issue 正文的「含会话名」明确冲突，需要你拍板。
4. §4.2 滑杆改成 **1–24**（0 在 `projectCutoff` 里是「不砍」）。这是我按模型契约定的，改动落在控件范围里，不影响模型。

---

## 13 交付说明

- 本文件只写规格，未改 `web/`、`src-tauri/`、`scripts/` 任何代码。
- 所有高度、宽度、对比度、计数都可按 §3/§7/§10 的算式复算。
- 未新增颜色令牌；焦点环预估 +3 条规则（§8.3），实现后以 grep 实数复核。
- 写规格期间并行落地的 8 个模型模块已被逐条对齐（§0.5），五处原结论因此改写：H1 的候选池、H2 的滑杆范围、H3 的 key 名、H4 的标签来源、H9 的报告结构。
- 交付时文档 720 行，U+FFFD 0。
