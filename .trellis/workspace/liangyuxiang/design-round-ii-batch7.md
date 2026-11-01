# Round II · 第七批十功能 UI/UX 设计规格

> 分支 `feat/v037-batch-ten-7`（基线 `d9729d1`，`chore(release): 发布 v0.36.0-beta.1 (#290)`）
> Issue #291 ／ 十个功能 I1–I10 ／ 零新增 Tauri 命令、零网络、零新依赖
> 本文只定义界面与几何，不含实现代码。所有数字可复算，每处事实附 `文件:行号`。

---

## 0 语境与现状核对

逐行读过的文件与它给出的约束：

| 事实 | 出处 | 对设计的影响 |
| --- | --- | --- |
| `SessionFacts` 已有 `models/tools/ctxPeak/errors/durationMs/messages` 六项，`durationMs` 定义是**首末记录差（墙钟跨度，不扣等待）** | `metadataCache.ts:28-35,25` | I1 的时长口径直接用这一个定义，不自造 |
| `SessionMetadata.userPrompt` = **第一条 `type === "user"` 事件的 prompt**（已去 command/noise 标签） | `metadataScanner.ts:49-58,106-107` | I8 的预览有现成数据源，**零新增 I/O**；但它是原文，必须脱敏 |
| `SessionComparePanel` 在**用量主档**（`:939`）而不是实验室档 | `UsageOverviewPage.tsx:939` | I4 与它的差异行要写清「同在用量页、不同档位」 |
| `sessionTitle()` 的兜底链第 4 位就是 `userPrompt` | `metadataCache.ts:73-81` | 列表今天已经在显示首条消息（未脱敏）——I8 的脱敏比既有标题更严，这是有意的 |
| 会话行高 **54px 固定**，注释写明「由虚拟滚动镜像」 | `SessionList.tsx:636` | I8 要加一行预览就必须改行高，牵动 `virtualWindow` 与截图基线（见 §2-②） |
| 行本体是 `role="button"` 的 `<div>`，内嵌真 `<button>` 徽章 | `SessionList.tsx:617-650` | I8 的预览**不能**是可点节点（按钮不能嵌按钮），只能是文本 |
| 列表分组后组内 `sortSessions`、组间取首条 | `SessionList.tsx:335` | I3 的「相邻会话」必须按**开始时刻**排，不是按 mtime |
| 日志档工具行里有 `FilterBar`（`aria-pressed` chips） | `SessionAnalyzerPage.tsx:655`、`FilterBar.tsx:84-105` | I6 的开关做成同一行的独立按钮，不进 FilterBar |
| `UsageSessionInput.records` 每会话全量记录（含 model / timestamp / message） | `usageAggregations.ts:52-74` | I1/I2/I3/I9/I10 可在用量页一趟扫完，不必读盘 |
| `FilterBar` 第七个 chip 是纯文字（压缩不配色） | `FilterBar.tsx:14` | I6 的开关也走「无颜色，只有文字 + 边框」这套 |
| 搜索浮层输入框 `placeholder="搜索消息、工具输出、文件路径…（Esc 关闭）"` | `SearchPalette.tsx:194` | I7 的保存卡片不能占掉输入区，只能占空态/结果区 |
| 实验室档是「同一份窗口化 inputs 的多种看法」，当前 **11 块**：星座 / 成本地形 / 名人堂 / 火焰图 / 沙盘 / 收工推演 / 工具生态 / 项目足迹 / 心跳 / 预算跑道 / 提示节奏 | `LabView.tsx:54-120`、`:68-120` 顺序 | I2/I4/I5 归实验室档最合 IA；插入点见下三行 |
| `modelSeesaw` 是逐月两模型并排 | `modelSeesaw.ts:81` | I4 的差异行（§7）要写清「2–4 个实体 vs 两个模型」 |

---

## 0.5 模型层契约（已落地，以代码为准）

写规格时这九个模块还不存在；交付后它们全部落地，因此**下列表格覆盖本文原先自算的口径**。凡冲突处一律以本表为准——这是 Round HH §0.5 那条纪律的第二次执行。

| 功能 | 模块 | 导出 | 与本规格原案的差异（已改写） |
| --- | --- | --- | --- |
| I1 | `usage/sessionDurations.ts` | `sessionDurationsOf(durations: readonly (number \| null)[])` → `DurationBuckets` | 桶 id `under5min/5to15min/15to60min/1to4h/4hplus`，**右开边界 300k/900k/3.6M/14.4M**；`null`/非法计入「不足 5 分钟」且 `unmeasurable++`；`medianMs` 只算可计时；全不可量 → `null` |
| I2 | `usage/weekdayWeekend.ts` | `weekdayWeekendOf(sessions: {startTimestamp, tokens, activeHours?}[])` → `WeekdayWeekendSplit \| null` | `avgHoursPerDay` 分母**固定 5 / 2**（`WEEKDAY_CALENDAR_DAYS` / `WEEKEND_CALENDAR_DAYS` 已导出）；某侧 0 会话给 `0`（**不是 null**）——「该侧没有记录」由界面用「—」表达 |
| I3 | `usage/sessionGaps.ts` | `sessionGapHistogram(startTimestamps: readonly (number \| null)[])` → `SessionGapHistogram \| null` | 六桶变成**分钟/小时级**：`under1min/1to10min/10to60min/1to4h/4to24h/over24h`（原案写的天级桶作废）；`null`/非有限跳过计 `skipped`；0ms 计入 `<1 分钟`；有效 <2 → `null` |
| I4 | `usage/multiCompare.ts` | `multiCompareOf(dimension, entities)` → `MultiCompare \| null` | `rows[].shares = {tokens, sessions}`；`best = {by:"tokens", id}`（并列取 id 字典序）；`spread = (max−min)/max`，全 0 或 <2 实体 → `null`；维度只透传不参与计算 |
| I5 | `usage/promptProfile.ts` | `promptProfileOf(prompts: readonly string[])` → `PromptProfile \| null` | 字段实为 `count / lengthBuckets / codeBlockShare / cjkShare / medianLength`；长度桶 `LENGTH_BOUNDS` 五档 `<50/50–200/200–500/500–2000/≥2000`；`cjkShare` 先剔代码围栏再数汉字+字母；`<3` 条 → `null`（不是 0） |
| I6 | `sessions/decisionPoints.ts` | `decisionPointsOf(rows: DecisionRow[])` → `DecisionPoint[]` | `DecisionPoint { index, timestamp, excerpt(60 码点), reason }`；判据变成 **restart / redirect / escalate** 三条（原案的「编号列表」判据不存在，见 §6）；首条 user 永不；短确认先排除 |
| I7 | `search/savedSearches.ts` | `loadSavedSearches(storage)` / `addSavedSearch(...)`、`SAVED_SEARCHES_KEY`、`SAVED_SEARCHES_MAX` | 上限 **10**（原案 20）；**重名不覆盖**；超限**丢最旧**（`addedAt` 最小）；坏 JSON 整表作废 + `console.warn` |
| I9 | `usage/modelSwitchHeat.ts` | `modelSwitchHeatOf(sessions: {models: readonly string[]}[])` | 三桶变成 `never/once/multi` + `switchRate`（原案四桶作废）；入参是**可重复的原始序列**，成对比较 |
| I10 | `usage/toolSignature.ts` | `toolSignaturesOf(sessions: {tools: readonly string[]}[])`、`MAX_TOOL_SIGNATURES = 8`、`TOOL_SIGNATURE_SEPARATOR = " · "` | 签名分隔符是 `" · "`（不是 `+`）；模型**返回全量含 count=1**、截 top 8；`noToolsCount` 单独给；**界面滤 ≥2 再显示**——这条由界面做，不是模型做 |
| I8 | `sessions/firstMessagePreview.ts` | `firstMessagePreview(text: string \| null, maxLen = 80)` → `MessagePreview \| null`；`MessagePreview = { preview, redacted }`；`PREVIEW_MAX_CODEPOINTS = 80` | 十条规则与 §5.1 **逐条一致**（含顺序与替换串）。落盘形态与规格原案的差异只有返回形状：原案写 `redactPreview(): string`，实际返回**对象**（多了 `redacted` 布尔）+ 可空 + `maxLen` 参数。界面因此多一个可用信号：`redacted === true` 时可以标「已脱敏」 |

实施要点：**界面不重算任何口径**。`bucket.label` 由模型给（「不足 5 分钟」而不是我原案写的 `<5 分`），界面只渲染；`medianMs/switchRate/spread` 一律直接显示，不在组件里二次除。

## 1 十条裁决

| # | 裁决 | 理由 |
| --- | --- | --- |
| I1 时长分布 | 用量主档**一张「会话形状」卡**的第 1 个子视图 | 见 I3/I9/I10：四张同构的分布图堆四张卡会多出 3×52px 的表头与 3 条间隔，只换一个切换器更省 |
| I2 工作日起周末 | **实验室档**新卡 | 「周末是不是也在烧」是一个看法，不是首页读数 |
| I3 会话间隔 | 「会话形状」卡的第 2 个子视图 | 与时长同一个数据源、同一种画法（五桶柱），只是横轴换了 |
| I4 多选对照 | **实验室档**新卡，2–4 实体表格 | 实验室就是「多种看法」；表格比条形更适合 4 列同屏比较 |
| I5 提问画像 | **实验室档**新卡 | 输入侧观察是「我怎么用这个工具」，与实验室的自我实验气质一致 |
| I6 决策点回顾 | 日志档工具行的**独立开关按钮**（`aria-pressed`） | 加 tab 是第 9 个；加进 FilterBar 会把它变成「筛选 + 模式」两种语义的混装 |
| I7 保存的搜索 | 搜索浮层的**空态区**（无输入时的卡片列表） | 有输入时用户在看结果，卡片挤在结果上方会抢焦点 |
| I8 首条消息预览 | 会话行的**新增一行**（`--fs-xs`），行高 54 → **72** | 预览必须与标题同屏才叫「不用点进去」；代价是虚拟滚动常量与基线（§2-②） |
| I9 模型切换热力 | 「会话形状」卡的第 3 个子视图 | 三个分布同一张卡，用户在同一处比较「时长/间隔/切换」 |
| I10 工具签名排行 | 「会话形状」卡的第 4 个子视图 | 同上；签名是「集合」不是「时间」，但仍是形状 |

**「会话形状」卡的总账**：一张 `Panel`（表头 40）+ 一个 `SegmentedControl`（4 档）+ 一个画布区。四个子视图共用 212px 高度，比四张卡（4×212 + 3×12 = 884）省 **672px**——这是本批最重要的一条几何裁决。

---

## 2 七条需要拍板的异议

### ① 六张分布卡不能都进用量主档

如果 I1/I2/I3/I5/I9/I10 都各自一张卡，用量主档要涨 **1228px**（6×204 + 5×12），等于又加一屏半，而这一档已经有 14 块。

**建议**：I1/I3/I9/I10 合成一张「会话形状」卡（+224），I2/I5 归实验室档（+156 / +168）。用量档只涨 224。

### ② I8 必须改会话行高（54 → 72），这是本批唯一会动虚拟滚动的改动

`SessionList.tsx:636` 的注释写着「行高 54px 由虚拟滚动镜像」——行高是常量，不是自适应。

**建议**：固定 **72**，预览行**始终渲染**（没有首条消息时写「这条会话没有用户消息」，`--text-tertiary`）。不做「有预览才变高」——变高会让 `virtualWindow` 的 `padTop/padBottom` 全部算错，滚动条会跳。

代价：列表一屏约从 14 行降到 10 行（列表视口约 700px）；需要同步改 `virtualWindow` 的调用常量与 3 张截图基线。

**替代方案（我不推荐）**：把预览塞进 `.meta` 行替换文件大小——信息量减少，且不能让「长什么样」一眼可见。

### ③ I3 的「相邻会话」用开始时刻，不是 mtime

`SessionFacts.durationMs` 是首末差，但**开始时刻**没有单独字段；`mtimeMs` 是文件修改时间，不等于开始时刻（一个会话可以开着不写）。

**建议**：I3/I1 的模块输入用「每个会话的首条记录时间戳」，在用量页从 `records[0].timestamp` 取（同一趟扫描），会话列表侧不参与 I3。若你要求列表也能算，则必须给 `SessionFacts` 加 `startedAt`（缓存 v3 → v4），我倾向不加。

### ④ I9 需要「模型切换」的判定口径

「切 1 次」的判定必须是**相邻两条带 usage 的 assistant 记录的 model 不同**，而不是「会话里出现过两个 model」（后者把 A→B→A 也算 1 个差异，实际切了 2 次）。

**建议**：按记录序扫描 model 序列，统计「与前一条不同」的次数；无 usage 的记录跳过（它们没有模型归属）。口径写进模块注释与单测，避免两处实现不一致。

### ⑤ I6 的判据

我提议过三条（长度比 / 转折词 / 编号列表），**模型层最终落地的是另一套**（`decisionPoints.ts`）：restart 词表 + escalate（≥80 字且 ≥1.5 倍）+ redirect（指令动词开头且间隔 >10 分钟）。规格已按模型改写，见 §6。

**留给你的判断**：redirect 的「10 分钟」是一个经验阈值，模型把它写死成常量是对的；但它意味着「隔夜回来问完全不同的问题」会被算成决策点——**这正是想要的**（换题就是改主意），只是要在说明带的 `title` 里说清，否则用户会以为是 bug。

### ⑥ I5 的「中英占比」需要明确分母

「中英文字符占比」若按**全部字符**算，空格/标点/代码会稀释掉结论。

**建议**：分母只算**字母与汉字**（`\p{Script=Han}` 与 `A-Za-z`），标点、数字、空白、代码块内容**都不进分母**；代码块比例单独一列（含 ``` 的消息数 ÷ 用户消息数）。这样「中文 62%」才读得懂。

### ⑦ I7 的保存卡片要不要带筛选条件

搜索当前只有查询串；如果只存串，重跑时结果与当时一致（索引相同）。**建议只存查询串 + 名称 + 保存时刻**，不存筛选档位——存了就会出现「卡片点了却显示另一档」的困惑。

**模型已落地的事实**：上限是 **10**（不是我原案的 20），超限**丢最旧**、重名**不覆盖**、坏 JSON 整表作废。界面因此只补两句文案：重名时 `role="alert"` 提示「已有同名搜索，换个名字保存」；超限丢旧卡时**不提示**（旧的自然过期，比弹一句「已删掉一条」更少打扰）。

---

## 3 全局几何

### 3.1 既有开销（引用，不改）

页面内距 `--sp-3` 12；块间距 12；`Panel` 表头 40（min-height）+ 体内距 12×2；`--control-h` 28；行高 `--lh-xs` 16 / `--lh-sm` 18 / `--lh-base` 20 / `--lh-md` 22；侧栏 300。

### 3.2 横向账

- 1440：主区 1140，扣页内距 24 → **1116**；两列各 `(1116−12)/2 = 552`。
- 960：主区 660，扣 24 → **636**；两列各 **312**。
- 「会话形状」卡单列满宽：1116 / 636。四档切换器 4×88 = 352 < 636，不换行。
- I4 表格 4 列实体：636 下单实体列 `(636 − 12×2 − 4×12) / 4 ≈ 141`，够放「模型名 + 一个数」。

### 3.3 会话行高变更（I8）

| 项 | 旧 | 新 |
| --- | --- | --- |
| 行高 | 54 | **72** |
| 结构 | 标题行 20 + 状态行 16 + meta 行 18 = 54 | 标题行 20 + 状态行 16 + **预览行 16** + meta 行 18 = 70，取整 72 |
| 一屏行数（视口 700） | 13.0 | **9.7** |

---

## 4 逐功能规格

### 4.1 会话形状卡（I1 / I3 / I9 / I10 共用）

**挂载**：用量主档，「活跃时段」（`ActivityClockPanel`，`UsageOverviewPage.tsx:1104`）之后、「工具普查」（`ToolCensusPanel`，`:1114`）之前——四档里最后一档就是工具配方，与工具普查相邻最顺；同时不打断首屏三件套（`BillingWindowCard` → `WeeklyDigestPanel` → `SessionComparePanel`）。

**DOM**

```tsx
<Panel
  title="会话形状"
  actions={
    <SegmentedControl
      items={[{value:"duration",label:"时长"},{value:"gap",label:"间隔"},
              {value:"switch",label:"切换"},{value:"signature",label:"配方"}]}
      value={shape} onChange={setShape} ariaLabel="会话形状视图"
    />
  }
>
  <div className={styles.shape} data-probe="session-shape" data-shape={shape}>
    <div className={styles.shapeBars} data-probe="shape-bars">
      {buckets.map((b) => (
        <div key={b.id} className={styles.shapeCol} data-probe="shape-bar" data-bucket={b.id}>
          <span className={styles.shapeBar} style={{height:`${b.pct}%`}} aria-hidden="true" />
          <span className={styles.shapeCount}>{b.count}</span>
          <span className={styles.shapeLabel}>{b.label}</span>{/* label 来自模型 */}
        </div>
      ))}
    </div>
    <p className={styles.shapeReadout} data-probe="shape-readout">{readout}</p>
    <p className={styles.shapeNote}>{note}</p>
  </div>
</Panel>
```

**四个子视图（桶数与标签全部来自模型，此处只定读数与脚注）**

| 子视图 | 桶（由模型给） | 读数行（逐字） | 脚注（逐字） |
| --- | --- | --- | --- |
| 时长 | 5：不足 5 分钟 / 5–15 分钟 / 15–60 分钟 / 1–4 小时 / ≥ 4 小时 | 「中位跨度 {formatDuration(medianMs)}，{n} 个会话」 | 「按首末记录差算，含等待。」+ `unmeasurable > 0` 时追加「另有 {u} 个会话只有一条记录，计入「不足 5 分钟」。」 |
| 间隔 | 6：<1 分钟 / 1–10 分钟 / 10–60 分钟 / 1–4 小时 / 4–24 小时 / >24 小时 | 「中位间隔 {formatDuration(medianMs)}，{n} 对相邻会话」 | 「按开始时刻排序取相邻差。」+ `skipped > 0` 时追加「{k} 个会话缺开始时刻，未参与。」 |
| 切换 | 3：从不 / 1 次 / 2 次及以上 | 「{percent(switchRate)} 的会话换过模型」 | 「相邻两条带 usage 的记录模型不同记一次；换回旧模型也算（A→B→A 是 2 次）。」 |
| 配方 | 取 `signatures` 里 `count ≥ 2` 的前 5 条（模型给 top 8，界面再滤） | 「{k} 种配方重复出现」 | 「签名 = 工具集合排序后以「 · 」拼接。」+ `noToolsCount > 0` 时追加「{m} 个会话没有调用工具。」 |

**几何**：表头 40 + 体 12 + 画布 96 + 8 + 读数 20 + 8 + 脚注 16 + 12 = **212**。

- 画布 96 = 柱区 68 + 档名 16 + 4 余量；柱宽 `min(40, 可用/桶数 − 8)`；六桶时每桶 ≤ 96，柱宽 40 仍放得下。
- 配方子视图不用柱：五行 24px 的「签名 + 次数」清单，画布仍是 96（5×19 余量），**高度一致**，切换不跳。
- `medianMs === null`（全不可量 / 有效 <2）时画布区写「样本不足，画不出分布」，柱与读数都不渲染。

### 4.2 I2 工作日起周末

**挂载**：实验室档，`CutoffPanel` 之后、`ToolEcosystemPanel` 之前（`LabView.tsx:95-104`）——沙盘 → 收工推演 → 工作日对照，三张都在问「时间怎么用掉的」。

**DOM**

```tsx
<Panel title="工作日 vs 周末" actions={<ProvenanceBadge provenance="logged" />}>
  <div className={styles.weekend} data-probe="workday-split">
    <div className={styles.weekendHead}>
      <span /><span>Token</span><span>会话</span><span>日均活跃小时</span>
    </div>
    {["weekday","weekend"].map((key) => {
      const side = split[key];  // 由模型给
      return (
        <div key={key} className={styles.weekendRow} data-probe="workday-row" data-group={key}>
          <span className={styles.weekendLabel}>{key === "weekday" ? "工作日" : "周末"}</span>
          <span>{side.sessions === 0 ? "—" : formatNumber(side.tokens)}</span>
          <span>{side.sessions}</span>
          <span>{side.sessions === 0 ? "—" : formatHours(side.avgHoursPerDay)}</span>
        </div>
      );
    })}
  </div>
  <p className={styles.weekendNote}>按本地日历日分组；日均分母固定 5 天 / 2 天。</p>
</Panel>
```

**几何**：40 + (12 + 表头 20 + 2×24 + 8 + 16 + 12) = **156**。

**口径（模型已定）**：`getDay()` 取本地日历，`0|6` 为周末；`avgHoursPerDay` 分母**固定 5 / 2**（`WEEKDAY_CALENDAR_DAYS` / `WEEKEND_CALENDAR_DAYS`）——这样「这周六只干了 2 小时」不会被 1 天除成「日均 2 小时」而虚高。

**降级**：模型对空侧返回 `sessions: 0`（不是 null），界面据 `sessions === 0` 把 token 与日均写「—」，并在脚注后追加「过去 {days} 天没有周末记录」——**0 与「没有记录」是两件事**，这一行是界面补的，模型不负责。

### 4.3 I4 多选对照

**挂载**：实验室档，`ToolEcosystemPanel` 之后、`ProjectFootprintPanel` 之前（`LabView.tsx:104-108`）——同一维度下「工具生态」讲全局，「多选对照」讲其中几个。

**DOM**

```tsx
<Panel title="多选对照" actions={<ProvenanceBadge provenance="logged" />}>
  <div className={styles.multi} data-probe="multi-compare">
    <SegmentedControl items={[{value:"project",label:"项目"},{value:"model",label:"模型"},{value:"tool",label:"工具"}]}
                      value={dim} onChange={setDim} ariaLabel="对照维度" />
    <div className={styles.multiPick} data-probe="multi-pick">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={picked.has(o.id)}
                disabled={!picked.has(o.id) && picked.size >= 4}
                title={!picked.has(o.id) && picked.size >= 4 ? "最多选 4 个" : undefined}
                data-probe="multi-chip" data-entity={o.id} className={styles.chip}>{o.label}</button>
      ))}
    </div>
    <table className={styles.multiTable} data-probe="multi-table">
      <caption>按 {dimLabel} 对照</caption>
      <thead><tr><th>实体</th><th>Token</th><th>会话</th><th>消息</th><th>错误</th><th>活跃天</th><th>Token 占比</th></tr></thead>
      <tbody>{compare.rows.map((r) => <tr key={r.id} data-probe="multi-row" data-entity={r.id}>…</tr>)}</tbody>
    </table>
  </div>
  <p className={styles.multiNote}>最多选 4 个；不足 2 个时不出表。{compare.best ? `Token 最高：${labelOf(compare.best.id)}` : ""}</p>
</Panel>
```

**几何**：40 + (12 + 28 + 8 + 28 + 8 + 28 + 120 + 8 + 16 + 12) = **308**（选片单行）/ 336（两行）。

**口径（模型已定）**：`shares.tokens` / `shares.sessions` 是在**所选实体内部**归一（合计 100%），不是对全量——脚注必须说「占比按所选实体合计」，否则读成「占全站多少」；`spread` 全 0 或 <2 实体为 `null`，界面此时不显示「差距」一句。

**限制**：选中第 5 个时**不弹 toast**，第 5 个 chip 直接 `disabled` + `title="最多选 4 个"`；不足 2 个 → 表格区显示「再选 1 个就能对照」。

### 4.4 I5 提问画像

**挂载**：实验室档末尾，`PromptRhythmPanel` 之后（`LabView.tsx:120`）——提示节奏讲「多久问一次」，提问画像讲「问的是什么形状」。

**几何**：40 + (12 + 三指标行 48 + 8 + 长度 mini 条 24 + 8 + 16 + 12) = **168**。

**三指标（逐字，字段全部来自 `PromptProfile`）**：`提问长度中位 {medianLength} 字` / `含代码块 {percent(codeBlockShare)}` / `中文汉字占 {percent(cjkShare)}`；脚注「只统计用户消息；代码块内容不计入字数与语言占比。」

**迷你条**：`lengthBuckets` 五档（`<50` / `50–200` / `200–500` / `500–2000` / `≥2000`）的一行 24px 细条，无坐标轴，仅示意形状；标签直接用模型的 `label`。

**空态**：`promptProfileOf` 返回 `null`（0 条消息或 <3 条）时整卡空态——0 条写「这个窗口里没有用户消息」，<3 条写「只有 {n} 条提问，先看个大概」且**只显示三指标不显示迷你条**。

### 4.5 I6 决策点回顾

**挂载**：`SessionAnalyzerPage.tsx:655` 的日志档工具行，`FilterBar` 之后。

```tsx
<button
  type="button"
  className={styles.decisionToggle}
  aria-pressed={decisionsOnly}
  aria-label={`只看决策点，共 ${points.length} 个`}
  data-probe="decisions-only"
  onClick={() => setDecisionsOnly((v) => !v)}
>
  只看决策点{points.length > 0 ? `（${points.length}）` : ""}
</button>
```

**几何**：`height: var(--control-h)` 28，`padding: 0 var(--sp-2)`，`--fs-sm`，无颜色（与压缩 chip 同一套「结构不配色」）；工具行高度不变。

**行为**：开启后日志列表只留 `decisionPointsOf(rows)` 命中的行，顶部出现说明带（`data-probe="decisions-banner"`，`role="status"`）：「已滤出 {n} 个决策点。」+ 悬停 `title` 给完整口径（§6）。

**帧行标记**：每帧在该 user 行的 label 侧加一枚文字小标（不配色）：`reason === "restart"` → 「转折」、`"escalate"` → 「加码」、`"redirect"` → 「换题」。三词各 2 字，与行高 30 无冲突。

**0 帧**：按钮不渲染（见 §2-⑤）。

### 4.6 I7 保存的搜索

**挂载**：`SearchPalette` 的空态区（无输入时）。

```tsx
{query === "" && saved.length > 0 ? (
  <div className={styles.saved} data-probe="saved-searches">
    {saved.map((s) => (
      <button key={`${s.name}-${s.addedAt}`} type="button" className={styles.savedCard}
              data-probe="saved-search" data-query={s.query} onClick={() => setQuery(s.query)}>
        <strong>{s.name}</strong>
        <span>{s.query}</span>
      </button>
    ))}
  </div>
) : null}
```

**几何**：卡片两列网格，卡高 44（名称 16 + 查询 16 + 内距 12）；区高上限 3 行（3×44 + 2×8 = 148），超出滚动。

**口径（模型已定）**：`SAVED_SEARCHES_MAX = 10`；**重名不覆盖**——`addSavedSearch` 返回未添加时，界面提示「已有同名搜索，换个名字保存」（`role="alert"`，不写 localStorage）；超限**丢最旧**（模型内部处理，界面不提示——旧卡自然消失，与「旧的自然过期」一致）；坏 JSON 整表作废并 `console.warn`，界面按「没有保存的搜索」渲染，**不弹错**。

**为什么不存筛选档位**：见 §2-⑦。

### 4.7 I8 首条消息预览（隐私重点，规则表见 §5）

**挂载**：`SessionList.tsx` 会话行，`.meta` 行**之前**新增一行。

```tsx
<span className={styles.preview} data-probe="session-preview">
  {previewOf(session)}
</span>
```

**几何**：`--fs-xs` / `--lh-xs` 16，单行 `nowrap` + `text-overflow: ellipsis`，`--text-secondary`；行高 54 → **72**（§3.3）。

**内容**：`const r = firstMessagePreview(session.userPrompt ?? session.aiTitle)`；`r === null` → 写「这条会话没有用户消息」（`--text-tertiary`）；否则渲染 `r.preview`，并在 `r.redacted` 为真时尾随一枚「已脱敏」小字。

```tsx
<span className={styles.preview} data-probe="session-preview" data-redacted={r?.redacted ? "1" : undefined}>
  <span className={styles.previewText}>{r ? r.preview : "这条会话没有用户消息"}</span>
  {r?.redacted ? <span className={styles.previewTag}>已脱敏</span> : null}
</span>
```

**几何细节**：`.preview` 是 `display:flex; gap: var(--sp-1)`，`.previewText` 占 `flex:1; min-width:0` + `ellipsis`，`.previewTag` 是 `flex:none`、`--fs-xs`、`--text-tertiary`——**标签不参与截断**，被切掉的永远是正文。

**契约状态**：已落盘于 `sessions/firstMessagePreview.ts`（10 个用例全绿），与 §5.1 十条逐条一致；**界面不得再写第二份脱敏函数**。

**为什么不能是按钮**：行本体已经是 `role="button"` 的 div，内嵌第二个按钮非法（`SessionList.tsx:617-620` 的注释就是为此写的）。

### 4.8 I9 / I10

已在 §4.1 的子视图表里定义桶与读数，这里只补两条口径：

- **I9**：入参是**可重复的原始模型序列**，模型内部成对比较（A→B→A 计 2 次）；`never` 含「0 个模型」的会话；`switchRate = (once + multi) / 总会话数`，无会话为 `null`——界面此时写「没有会话」，不写 0%。
- **I10**：签名分隔符是 `" · "`（`TOOL_SIGNATURE_SEPARATOR`），不是 `+`；模型返回全量含 `count=1`、截 top 8，**界面滤 `count ≥ 2`** 后再取前 5——若过滤后为空，画布写「没有重复出现的工具配方」+ 脚注给 `noToolsCount`。工具集合的口径（主链 / 含 sidechain）由调用方决定，界面不改写，只在脚注照抄模型的注释口径。

## 5 I8 脱敏规则（本轮重点）

**原则**：脱敏发生在**生成侧**（模块 `firstMessagePreview.ts` 的 `redactPreview()`），不在渲染侧。任何拿到原文的地方都已经晚了——渲染侧脱敏会在 DOM 里留下原文。

### 5.1 打码规则表（按顺序执行，先到先打）

| # | 目标 | 正则（示意） | 替换为 |
| --- | --- | --- | --- |
| 1 | 用户主目录 | `/(?:Users\|home)/[^/\s]+` | `~` |
| 2 | 常见仓库根 | `/(?:repo\|repos\|work\|projects?)/[^\s]+` 中长度 > 24 的部分 | `~/…/<末段>`，末段保留 ≤ 16 字符 |
| 3 | 任意绝对路径 | `(?:[A-Za-z]:\\\\\|/)(?:[^\s/]+/){2,}[^\s]+` | `<路径>` |
| 4 | OpenAI/Anthropic 风格密钥 | `sk-[A-Za-z0-9_-]{16,}` | `sk-…`（保留前缀，不保留长度） |
| 5 | GitHub token | `gh[pousr]_[A-Za-z0-9]{20,}` | `ghp_…` |
| 6 | AWS key | `AKIA[0-9A-Z]{16}` | `AKIA…` |
| 7 | 通用长随机串 | `[A-Za-z0-9+/_-]{32,}`（含 `=` 结尾的 base64） | `<已隐去>` |
| 8 | 邮箱 | `[\w.+-]+@[\w-]+\.[\w.]+` | `<邮箱>` |
| 9 | 内网/本机 IP | `\b(?:10\|192\.168\|172\.(?:1[6-9]\|2\d\|3[01]))\.\d+\.\d+\b` | `<内网地址>` |
| 10 | URL 查询串 | `\?[^\s]{12,}` | `?…` |

打码之后：

11. 折叠连续空白为一个空格（换行与缩进会把 80 字符撑成几行碎片）；
12. trim 首尾空白——**只去空白，不去引号**（原案写「去掉成对引号/反引号」，落地实现没有做，已按代码改：引号是消息原貌的一部分，删了会让「他说的是『xx』」变成另一句话）；
13. 截断到 **≤ 80 个码位**（`Array.from` 计数，emoji 不劈半），超出加 `…`。

**落地一致性核对**（`sessions/firstMessagePreview.ts`，124 行）：十条规则的正则、顺序、替换串与本文逐条相同；后处理 11–13 相同（12 已按上述修正）。**唯一差异**在返回形状——文档原案 `redactPreview(): string`，实现是 `firstMessagePreview(text, maxLen = 80): { preview, redacted } | null`，多出的 `redacted` 用于界面标「已脱敏」（§4.7），`maxLen` 参数本轮界面不用（一律用默认 80）。

### 5.2 验收断言（对照落盘实现的覆盖情况）

模块测试 `sessions/firstMessagePreview.test.ts`（10 个用例，全绿）与本表逐条对应：

| 本条规格的断言 | 落在哪 | 状态 |
| --- | --- | --- |
| 主目录打掉（`/Users/liang/...` 不含 `liang`） | 用例「规则1 用户主目录」 | ✅ |
| 仓库根缩成 `~/…/<末段≤16>` | 用例「规则2 常见仓库根」 | ✅ |
| 任意绝对路径 → `<路径>`，单级相对路径不动 | 用例「规则3」 | ✅ |
| `sk-` / `gh*_` / `AKIA` 三连，保留可识别前缀 | 用例「规则4/5/6 密钥三连」 | ✅ |
| ≥32 位随机串 → `<已隐去>`，普通长句不打 | 用例「规则7」 | ✅ |
| 邮箱 / 内网 IP / URL 查询串 | 用例「规则8/9/10」 | ✅ |
| 长度 ≤ 80 码位，emoji 不劈半 | 用例「截断：≤80 码位」 | ✅ |
| 空串 / 纯空白 / 打码后为空 → `null` | 用例「null / 空串」 | ✅ |
| 空白折叠计入 `redacted` | 用例「空白折叠」 | ✅ |
| 一条消息里路径+密钥+IP 同时出现全部打掉 | 用例「组合」 | ✅ |

**唯一没有进单测的那条**：「对 100 条真实 `userPrompt` 跑一遍，断言不含 `os.homedir()` 末段」——这条**不能**做成 CI 断言，因为 CI 里没有用户的真实日志（也不该有）。

改为两道兜底：

1. **e2e 兜底**（可在 CI 跑）：夹具里构造 3 条含主目录路径的会话，进列表后对所有 `[data-probe="session-preview"]` 的 `textContent` 断言不含夹具里那个用户名串（断言读的是**渲染出来的像素文本**，比断言函数返回值更接近真实泄漏面）。
2. **手工一次性验收**（发布前，在本机）：对本地 `~/.claude/projects` 抽 100 条会话元信息跑 `firstMessagePreview`，断言无 `os.homedir()` 末段残留。这一步写进实现者的自检清单，不进 CI。

### 5.3 与既有行为的冲突（必须承认）

`sessionTitle()` 的兜底链在 `customTitle/agentName/aiTitle` 都缺失时会直接用 `userPrompt`（`metadataCache.ts:73-81`），也就是说**列表标题今天已经在显示未脱敏的首条消息**。

本批不改标题（那会改变所有既有截图与 60 个功能的行文一致性），但要在 CHANGELOG 里写明：「首条消息预览已脱敏；标题的兜底行为不变」。

---

## 6 I6 决策帧判定（以已落地模型为准）

原先我按「长度 ≥ 上一条 50% / 转折词 / 编号列表」提议过一版，模型层落地的是**另一套更严的判据**（`sessions/decisionPoints.ts`）。按 §0.5 的纪律，改成模型的：

| reason | 判据（按序命中，一条 user 最多算一次） | 常量 |
| --- | --- | --- |
| `restart` 转折/重做 | 文本匹配 `不对\|不是这样\|改一下\|换成\|重新\|重来\|撤销\|回滚\|算了` | `RESTART_PATTERN` |
| `escalate` 加码追问 | 长度 ≥ **80** 码点 **且** ≥ 上一条 user 的 **1.5 倍** | `ESCALATE_MIN_LENGTH = 80`、`ESCALATE_GROWTH_RATIO = 1.5` |
| `redirect` 隔一段时间换题 | 以指令动词开头（`帮我\|请\|能\|可以\|继续\|然后\|接下来\|现在\|再\|对比\|检查\|实现\|修复\|添加\|删除\|重构\|写\|跑`）**且**与上一条 user 的间隔 **严格大于 10 分钟** | `REDIRECT_PREFIX`、`REDIRECT_GAP_MS = 600000` |
| 排除 | trim 后整句等于 `好的?\|ok\|OK\|嗯\|继续\|go\|Go\|👍\|是的?\|对` | `SHORT_CONFIRM_PATTERN`（**先于**三判据执行） |
| 硬边界 | 首条 user 永不是决策帧；`kind !== "user"` 不参与；`excerpt` 取 60 码点 + `…`；输出保序 | `EXCERPT_LENGTH = 60` |

**与本文原案的三处差异（诚实记录）**：① 原 R3「编号列表 ≥3 项」不存在——模型没有这条，我也不主张补；② 原 R1「≥ 上一条 50%」变成 escalate 的「≥80 字且 ≥1.5 倍」（更严，宁缺勿滥）；③ 新增 redirect 的「10 分钟间隔」判据，这是原案没有的维度，但它是**最像真实场景**的一条（隔夜回来换题）。

**界面只做三件事**：调 `decisionPointsOf`、用 `index` 定位、用 `reason` 出三个中文小标（转折 / 加码 / 换题）。**不做二次判定**，不提供阈值配置——判据一旦可配置，测试就钉不住。

## 7 差异行（与既有 A/B 功能划界）

| 新功能 | 最接近的既有功能 | 差异（一句话） |
| --- | --- | --- |
| I4 多选对照 | `SessionComparePanel`（两会话 A/B） | 维度是「项目/模型/工具」，最多 4 个实体，粒度是聚合不是单会话 |
| I4 多选对照 | `modelSeesaw`（逐月两模型） | 跷跷板固定两模型 × 时间轴；I4 固定时间窗 × 2–4 实体 |
| I4 多选对照 | 快照对比（两份 JSON） | 快照比「两个时刻」，I4 比「同一切片里的多个实体」 |
| I9 模型切换热力 | `modelTimeline`（何时换的模型） | 时间线讲顺序与时刻，I9 讲「多少会话换过、换几次」的分布 |
| I1 时长分布 | 会话列表的「时长」排序 | 排序回答「哪个最长」，分布回答「通常多长」 |
| I3 会话间隔 | 甘特（并行度） | 甘特看重叠，间隔看空隙 |
| I5 提问画像 | 重放的节奏谱 | 节奏谱是时间间隔，画像是文本形状（长度/代码/语言） |
| I6 决策点 | 重放（事件序列） | 重放是全部事件，决策点只留「改主意」的那几帧 |
| I8 首条预览 | 列表标题（`sessionTitle`） | 标题可能被用户改名/被 AI 摘要替代；预览永远是**原消息的脱敏片段** |

---

## 8 时区陷阱（I2 与所有分桶）

**铁律：所有「日」与「小时」都走本地日历，不用 UTC 也不用手写时区偏移。**

| 位置 | 做法 | 反例（会被 e2e 抓） |
| --- | --- | --- |
| I2 周末判定 | `new Date(ts).getDay()`，`0/6` 为周末 | 用 `toISOString().slice(0,10)` 再判星期——UTC 偏移会把周一 00:30 判成周日 |
| I2 活跃小时 | `new Date(ts).getHours()`，0–23 去重 | 用 `ts % 86400000 / 3600000` |
| I1/I3 分桶 | 只用**时长**，不涉及时区 | — |
| 日期标签 | `formatClock`/`dayStartOf` 等既有工具 | 自造 `toLocaleDateString` 会被 e2e 的固定 locale 抓 |

**e2e 断言风格要求**：期望值**从夹具现算**，不写死。例如 I2：

```ts
// 不写 toEqual({ weekday: 12, weekend: 3 })
const expected = sampleSessions.filter((s) =>
  [0, 6].includes(new Date(s.startedAt).getDay())).length;
expect(weekendRow.textContent).toContain(String(expected));
```

理由：写死期望值的用例在跨时区 CI（UTC 与 Asia/Shanghai）上会随机红，而现算的断言把「本地日历」这个约定本身变成了测试。

---

## 9 令牌与对比度

### 9.1 零新增令牌

本批不新增颜色令牌。新块用到的：`--bg-subtle` / `--bg-inset` / `--border` / `--text` / `--text-secondary` / `--text-tertiary` / `--chart-1` / `--chart-1-soft` / `--chart-3` / `--accent`。

### 9.2 图形与文字（复用前几批已实算的复合值）

| 元素 | 前景 | 底 | 浅 | 深 | HC 浅 | HC 深 | 门槛 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 分布柱描边 | `--chart-1` | `--bg-subtle` | 5.64 | 8.39 | 7.82 | 8.26 | 3:1 |
| 柱填充 | `--chart-1-soft` | `--bg-subtle` | 1.41 | 1.87 | 1.38 | 1.96 | 仅填充 |
| 预览文字 | `--text-secondary` | `--bg-subtle` | 7.87 | 9.44 | 14.34 | 13.66 | 4.5:1 |
| 无消息提示 | `--text-tertiary` | `--bg-subtle` | 4.78 | 5.83 | 10.45 | 9.98 | 4.5:1 |
| 选中 chip 边 | `--accent` | `--bg-subtle` | 6.62 | 7.72 | 9.52 | 8.97 | 3:1 |
| 决策点开关边 | `--border-strong` | `--bg-subtle` | 1.59 | 1.38 | 9.27 | 6.99 | **不达 3:1** |

**最后一行是本批唯一的已知缺陷**：`--border-strong` 在普通主题下只有 1.59 / 1.38，做**开关的边框**不够。修法：开关的「开」状态不用边框表达，改用 `aria-pressed` + 背景 `--bg-active` + 文字 `--text`（文字对比度 16+，见既有表），边框只是装饰。这与 FilterBar 的 chip 同法（它们也不是靠边框达标的）。

### 9.3 颜色不是唯一编码

每个子视图都带**数值与文字标签**（柱顶次数 + 档名 + 读数行）；I4 的选中态同时有 `aria-pressed` 与背景差；I6 的开关同时有文字括号计数。

---

## 10 无障碍与焦点环

### 10.1 键盘

| 位置 | 键 | 行为 |
| --- | --- | --- |
| 会话形状切换器 | `←/→` | `SegmentedControl` 既有行为，切换即重绘，**不移动焦点到画布** |
| I4 chips | `Tab` / `Space` / `Enter` | 原生按钮；第 5 个 `disabled` 不可聚焦 |
| I6 开关 | `Space` / `Enter` | 原生按钮；开启后焦点留在按钮上，列表更新不抢焦点 |
| I7 卡片 | `Tab` / `Enter` | 回车把查询串填进输入框并聚焦输入框 |
| I8 预览 | 不聚焦 | 纯文本，随行一起被读 |

### 10.2 语义

- 会话形状：`role="img"` + `aria-label`（「时长分布：中位 18 分钟，42 个会话，最多的是 15–60 分」），四个子视图各一句。
- I2 表格：真 `<table>` + `<caption>工作日起周末对照`。
- I4：`<table>` + `<caption>按项目对照`；chips 用 `aria-pressed`。
- I6：`aria-pressed` + `aria-label="只看决策点，共 3 个"`。
- I8：预览行加 `aria-label`？不加——它就在行内，读屏会连续读「标题、预览、时间、大小、项目」，加 label 反而重复。
- 说明带（决策点）：`role="status"`，只在开关切换时读一次。

### 10.3 focusRing 新计数预估

当前基线（`web/src/styles/focusRing.test.ts`）：`outline` **63**、`outline-offset` **33**、`inset` **25 + 2 calc**、竖条 **7**、消费规则 **67**。

| 位置 | 规则 | 令牌 |
| --- | --- | --- |
| `.chip:focus-visible`（I4 多选片） | 1 条 outline | width + offset |
| `.decisionToggle:focus-visible`（I6） | 1 条 outline | width + offset |
| `.savedCard:focus-visible`（I7） | 1 条 outline | width + offset |
| `.shapeBars:focus-visible`？ | **不加** | 画布不可聚焦 |

**预估**：`outline` 63 → **66**，`outline-offset` 33 → **36**，`inset` 不变，竖条 7 不变，消费规则 67 → **70**。

I1–I3/I8/I9/I10 复用 `SegmentedControl` / 既有行 → 0 条新规则。实现后以 grep 实数复核。

---

## 11 状态矩阵

| 功能 | 空 | 加载 | 失败 | 样本不足 | 正常 |
| --- | --- | --- | --- | --- | --- |
| 会话形状 | 0 会话：页面级空态 | 骨架 96 | 「分布算不出来」 | <3 会话：「只有 3 个会话，看不出分布」 | 五桶 + 中位 |
| I2 | 窗口无记录 | 骨架 | 「分不出来」 | 某组 0 会话：该行 `—` + 脚注 | 两行对照 |
| I4 | 实体 < 2：「再选 1 个」 | 骨架 | 「这一维没有读数」 | — | 表格 2–4 列 |
| I5 | 无用户消息 | 骨架 | — | <5 条：只给三指标 | 三指标 + mini 条 |
| I6 | 0 帧：按钮不渲染 | 解析中：按钮禁用 | — | 1 帧：「（1）」 | 过滤 + 说明带 |
| I7 | 无保存：空态不显示区块 | — | 存储读坏：静默忽略（不弹错） | — | 卡片网格 |
| I8 | 无 `userPrompt`：「这条会话没有用户消息」 | 元信息 pending：预览行留空（不写「加载中」） | failed：同上 | 打码后为空 → 同「无消息」 | 脱敏片段 ≤80 |
| I9/I10 | 同会话形状 | 同 | 同 | 同 | 同 |

---

## 12 高度账

### 12.1 用量主档（1440×900）

| 块 | 算式 | 高 |
| --- | --- | --- |
| 会话形状卡 | 40 + (12 + 96 + 8 + 20 + 8 + 16 + 12) | **212** |
| 块间距 | — | 12 |
| **增量** | 212 + 12 | **224** |

### 12.2 实验室档

| 块 | 算式 | 高 |
| --- | --- | --- |
| I2 | 40 + (12 + 20 + 48 + 8 + 16 + 12) | **156** |
| I4 | 40 + (12 + 28 + 8 + 28 + 8 + 28 + 120 + 8 + 16 + 12) | **308** |
| I5 | 40 + (12 + 48 + 8 + 24 + 8 + 16 + 12) | **168** |
| 三个块间距 | 3 × 12 | 36 |
| **增量** | 156 + 308 + 168 + 36 | **668** |

实验室档本来就长（十一块卡），668 会让它再多约 0.7 屏；这是本批最重的档，见 §13 的「不做」。

### 12.3 130% 字号（行高 ×1.3，padding 不变）

文字行高 ×1.3，图形画布不缩放，padding 全是 `--sp-*` 固定值：

| 块 | 原始 | 130% | 算式（逐项 ×1.3） |
| --- | --- | --- | --- |
| 会话形状卡 | 212 | **223** | 40 + (12 + 96 + 8 + 26 + 8 + 21 + 12) |
| I2 | 156 | **181** | 40 + (12 + 26 + 62 + 8 + 21 + 12) |
| I4 | 308 | **373** | 40 + (12 + 36 + 8 + 36 + 8 + 36 + 156 + 8 + 21 + 12) |
| I5 | 168 | **187** | 40 + (12 + 62 + 8 + 24 + 8 + 21 + 12) |

- 用量档增量 223 + 12 = **235**。
- 实验室档增量 181 + 373 + 187 + 36 = **777**。

其中 I4 的表头 28→36、四行数据 30→39（4×39 = 156）是最大的一笔；若 130% 下想省，可把表格行内距从 `--sp-15` 降到 `--sp-1`（39→37），但**不建议**——那会让 130% 的用户看到比 100% 更挤的表。

### 12.4 960 窄窗

- 会话形状：636 下四个子视图各自 5–6 桶，每桶 ≤ 106，柱宽 40 放得下；配方子视图 5 行，签名最长约 40 字符（`builtin:Bash+builtin:Edit+…`），超出 `ellipsis`。
- I4：选片行 4 个 chip 在 636 下可能换行（+28），表格 5 列每列 ~118，`font-variant-numeric: tabular-nums` 防抖。
- I8 预览：636 下 `--fs-xs` 单行约 58 个全角字，80 字符会被 `ellipsis` 裁到约 58——这正是「截断」的第二道保险，不额外处理。

---

## 13 明确不做

1. 不做会话形状卡的**自定义桶边界**（固定五桶，够用）。
2. 不做 I2 的**按项目再拆**（那是 I4 的活）。
3. 不做 I3 的「同一时刻开始的会话」特殊处理（直接不计入，写进脚注）。
4. 不做 I4 的**三维同时对照**（一次只选一维，二维交叉是 N×M 的爆炸）。
5. 不做 I5 的按模型拆分画像。
6. 不做 I6 的**自动跳转**到决策帧对应位置（只过滤，不改滚动）。
7. 不做 I7 的**同步/导出**（localStorage 即全部）。
8. 不做 I8 的**悬停展开全文**（那会把原文带进 DOM）。
9. 不做 I9 的「切换矩阵」（A→B→C 的流向图），本轮只要分布。
10. 不做 I10 的**签名编辑/命名**（用户不能给配方起名字）。

---

## 14 实现者清单（模型层已落地，只剩界面）

九个模型模块已验收（§0.5），**不要再写一份分布逻辑**。按顺序做，每步可独立验收：

1. `SessionShapePanel`（`usage/`）：吃 `sessionDurationsOf` / `sessionGapHistogram` / `modelSwitchHeatOf` / `toolSignaturesOf` 四个输出，只做四档切换与渲染；`session-shape` / `shape-bar` / `shape-readout` 三个 probe；挂用量主档 `ActivityClockPanel`（`:1104`）之后。
2. `WorkdaySplitPanel`（`usage/`）：吃 `weekdayWeekendOf`；`sessions === 0` 的侧写「—」；`workday-split` / `workday-row` probe；挂 `CutoffPanel`（`LabView.tsx:95`）之后。
3. `MultiComparePanel`（`usage/`）：吃 `multiCompareOf`；chips 上限 4（`disabled` + `title`）；`multi-compare` / `multi-chip` / `multi-table` / `multi-row` probe；挂 `ToolEcosystemPanel`（`:104`）之后；**组件内不重算 shares**。
4. `PromptProfilePanel`（`usage/`）：吃 `promptProfileOf`；三指标 + `lengthBuckets` 迷你条；挂 `PromptRhythmPanel`（`:120`）之后。
5. 日志档决策点：调 `decisionPointsOf(rows)`，加开关按钮 + 说明带 + 三枚 reason 小标；`decisions-only` / `decisions-banner` probe；**不新增判据、不提供阈值配置**。
6. 搜索浮层保存卡片：调 `loadSavedSearches` / `addSavedSearch`；重名走 `role="alert"` 提示；`saved-searches` / `saved-search` probe。
7. **I8 等 `usage/firstMessagePreview.ts` 落盘**：落地前不写脱敏函数；落地后按 §5.1 十条逐条核对，再给列表行加预览 + **行高 54→72** + `virtualWindow` 常量 + 3 张截图基线。
8. `focusRing.test.ts` 计数改到实测（预估 66/36/25/7/70），注释同步。
9. 各功能 `.test.tsx`：空 / null（样本不足）/ 正常 / 降级四态各一条；断言用**模型返回值**而不是自己再算一遍。
10. CHANGELOG `[Unreleased]` 记 10 条（中文），并单独一句写明「预览已脱敏，标题兜底行为不变」。

### 14.1 probe 汇总

| probe | 功能 | 断言什么 |
| --- | --- | --- |
| `session-shape` / `shape-bar` / `shape-readout` | I1/I3/I9/I10 | 切档后桶数变化；`data-shape` 反映当前档 |
| `workday-split` / `workday-row` | I2 | 两行；周末行的值等于现算期望 |
| `multi-compare` / `multi-pick` / `multi-chip` / `multi-table` | I4 | 选第 5 个时该 chip `disabled`；< 2 个时无表 |
| `prompt-profile`（建议） | I5 | 三指标存在；无消息时整卡空态 |
| `decisions-only` / `decisions-banner` | I6 | 开→只留帧；0 帧时按钮不存在 |
| `saved-searches` / `saved-search` | I7 | 保存后出现卡片；点卡片填入查询 |
| `session-preview` | I8 | 每行一条；不含用户主目录末段 |
| `session-share-card`（既有） | — | 不受本批影响 |

### 14.2 请主会话独立复核的四处

1. §2-② 会话行高 54 → 72（唯一动虚拟滚动的改动，牵动 3 张基线）。
2. §2-⑤ I6 判据三条 + 排除集（这是「什么算改主意」的唯一定义，测试逐条钉）。
3. §2-③ I3 用开始时刻、且**不给** `SessionFacts` 加 `startedAt`（缓存不必升 v4）。
4. §5.3 承认「标题今天已经在显示未脱敏首条消息」，本批只脱敏预览、不改标题。

---

## 15 交付说明

- 本文件只写规格，未改 `web/`、`src-tauri/`、`scripts/` 任何代码。
- 高度、宽度、对比度、计数均可按 §3/§9/§12 复算。
- 未新增颜色令牌；焦点环预估 +3 条规则（§10.3）。
- 与并行队伍的对齐方式沿用 Round HH 的做法：模型层落地后，以它们的契约为准改写本文件，而不是让 UI 另造一套。
