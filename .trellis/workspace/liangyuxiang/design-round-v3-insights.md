# 「洞察句」设计规格（Round V · 第三棒）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 日期：2026-10-13 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（Issue #199 已锁定）：消耗日历面板内新增一行「一年洞察」——从滚动 365 天
> 数据自动生成的六句事实（最长连胜 / 当前连胜 / 最贵一天 / 最长空白 / 活跃占比 /
> 本月 vs 上月），每句自带精确数字与口径，日期可点击下钻到 V2 一日回望。
> **本文件只描述设计与断言，不改任何源码。**

---

## 0. 语境与现状（写前逐字读过）

**读过的文件**：`gh issue view 199`（契约权威）、
`.trellis/workspace/liangyuxiang/design-round-v1-usage-calendar.md`（V1 规格，本文件
体例与颗粒度照它）、`gh issue view 196`（截图视图清单三处硬编码的教训）、
`web/src/features/usage/usageCalendar.ts`、`UsageCalendarPanel.tsx` 与
`.module.css`、`dayReview.ts`、`web/src/styles/tokens.css`、
`web/src/features/usage/UsageOverviewPage.tsx`、`billingReadouts.ts`、
`quotaReadout.ts`、`web/src/lib/format.ts`、`web/e2e/fixtures.ts`（calendarScenario，
第 474–575 行）、`web/e2e/usage-calendar.spec.ts`、`web/e2e/day-review.spec.ts`、
`web/e2e/screenshots.spec.ts`、`scripts/check-screenshots.sh`（EXPECTED_VIEWS，
第 61–90 行）、`scripts/gui-test.sh`（calendar 段）、`src-tauri/src/lib.rs`
（PROBE_JS 的 calendarFacts / dayReview，第 1040–1099 行）、
`web/src/features/usage/usageSnapshot.ts`、`web/src/features/usage/UsageCalendarPanel.test.tsx`、
`docs/USAGE.md`（第 191–208 行的日历段）。

**注意**：V2 一日回望以 main 现状为准（`dayReview.ts` 的融合形态方案），
`design-round-v2-day-view.md` 是未采用的并置方案，本文件不参考它。

**逐条核对过的既有事实**（后文反复引用，都是实测而不是印象）：

- main @ `84c1458`，工作区干净；V1（#187/#188）与 V2（#193/#194）均已合入。
- `buildUsageCalendar(inputs, now)` 输出 `UsageCalendar = { weekStarts, cells,
  monthMarks, quartiles }`（`usageCalendar.ts:49-58`）；窗口 =
  `[addLocalDays(todayStart, -364), todayStart]` 共 365 个本地日（第 95–99 行），
  **`cells` 里每个窗口内天都带完整 `CalendarDayFacts`**（dayStart / tokens /
  costUsd / hasUnknownCost / messages / sessions / topProject，第 30–43 行）——
  六句洞察要的数字全在这里，零新增数据通道（Issue 原话）。
- 格子档位口径：`levelOfCost` 里 `q === null || cost <= 0 → 0`（第 273–282 行）。
  **0 档包含三种天**：真无记录、只有无 usage 的记录、全 unknown 定价
  （token 不折 0 价，`hasUnknownCost` 标记，第 163–167 行）。所以「格子有色 ⇔
  costUsd > 0」——洞察的「有消耗」判定沿用这一条（§3.1）。
- #193 顺带修复并导出了 `countsAsMessage` / `sessionKeyOf`（第 78、87 行），
  `daySessionsOf` 的同键合并 bug 已修（第 361–379 行注释）；`dayReviewOf(inputs,
  dayStart)`（`dayReview.ts:144`）是展开区的唯一账本。**面板的下钻协议就是
  `setSelected(dayStart)` 一个 state**（`UsageCalendarPanel.tsx:267` 的
  `selected`），`onCellClick` 只拦 `sessions === 0` 并 toggle（第 351–357 行）——
  洞察句的日期点击接同一条 state，下钻零新协议。
- 面板 DOM 顺序：`scroll(table)` → 图例 `.legend`（`UsageCalendarPanel.tsx:489-497`）
  → 展开区 `sessions`（条件渲染，第 498–680 行）→ 脚注 `.footnote`（第 681 行）。
  `.calendar` 是 `display: grid; gap: var(--sp-2)`（`UsageCalendarPanel.module.css:6-12`），
  新子元素自动获得 8px 行距。脚注样式 = `--fs-xs` + `--text-tertiary`
  （`UsageCalendarPanel.module.css:530-536`）。
- 日期格式的两套既有语言：`cellLabelOf` 的完整式 `{Y}年{M}月{D}日`
  （`UsageCalendarPanel.tsx:59-60`，title / aria-label 用，日期永远带年）与
  `shortDateOf` 的短式 `{M}月{D}日`（第 81–84 行，展开区头部用）。月份标签的
  年号规则是「重复 ⇔ 都带」（`usageCalendar.ts:230-233`）。
- 数字格式：`formatUsd`（<$1000 两位小数，≥1000 分组取整，`format.ts:47-51`）、
  `formatTokenCount`（`format.ts:35-40`）；读数行的「双数 / 口径先行」语言见
  `billingReadouts.ts`（同屏一个 `now`、同一份窗口数学，第 9–16 行注释）与
  `quotaReadout.ts`（比率无分母返回 null 而不是 0，第 33–36 行——「没有数据」
  与「读了是零」必须分开，本轮环比文案沿用这条立场）。
- 令牌现状：`--cal-1..4` 四块已被「日期成本四分位」语义占满（`tokens.css:96-99` /
  327–330 / 404–407 / 475–478）；`--accent` 的既定语义是「焦点环、链接、选中底，
  像素占比 < 3%」（`tokens.css:39-40`）；`--warning` 是「非确定信息」、`--success`
  是「确定的读数」（第 46–53 行）——语义三色都不能挪来表达「洞察强调」
  （§4.2 裁决）。焦点环几何走 `--focus-ring-width/-offset`（第 121–123 行）。
- `calendarNow` 是挂载时刻的稳定实例、memo 依赖 `[inputs, now]`
  （`UsageOverviewPage.tsx:131`、`UsageCalendarPanel.tsx:263`）——洞察的重算时机
  与日历格子完全同拍（渐进扫描随批次刷新），零新增状态。
- e2e 夹具 `calendarScenario`（`fixtures.ts:504` 起）的**确定值**：有成本天 =
  now−300 / −200 / −100 / −30 / −8 各 1 会话（$0.6 / $1.2 / $1.8 / $3 / $6）+
  now−1 四会话合计 $12 + today 四会话合计 $3.45；now−2 / −3 密集日 / 稀疏日
  **刻意不带 usage**（0 档但 sessions > 0，可点开，`fixtures.ts:499-502`）。
  由此 e2e 可断死：活跃 7/365、最长连胜 2 天（昨天到今天）、最贵一天 $12.00、
  最长空白 99 天（§7.4）。
- 门禁协议：探针「事实在应用、断言在脚本」——`calendarFacts` 在
  `lib.rs:1040-1099`，断言在 `gui-test.sh:1601-1711`（两次同名点选按计数分流）；
  `DAY_SUMMARY_LABELS` 六项标签逐字对账的先例（`gui-test.sh:1038`）是本轮
  「六句键齐」断言的直接模板。Rust 侧守卫测试断 PROBE_JS 含锚点字符串
  （`lib.rs:1889-1897`）。
- Issue #196：截图视图清单硬编码在**三处**（`screenshots.spec.ts` /
  `check-screenshots.sh` 的 `EXPECTED_VIEWS` / `check-screenshots-test.sh` 的假基线），
  #193 加 `usage-day` 时第三处漏同步、CI 直接红。既有视图 `usage`（用量首屏）、
  `usage-below`、`usage-day`（日历 + 展开态，`screenshots.spec.ts:375-422`）都
  会自然带上日历面板——本轮**不新增截图视图**（§7.5 裁决与理由）。
- `SNAPSHOT_SCOPE_NOTE` 现文本「…不含消耗日历、工具与 skill 普查、压缩统计、
  错误档」（`usageSnapshot.ts:86-87`）——洞察句住在日历面板内，这句天然涵盖
  它，**本轮不改**（§8.5 记录理由）。

---

## 1. 实现约束

### 1.1 数据层：`calendarInsights.ts` 纯函数，输入 `UsageCalendar`

- 新模块 `web/src/features/usage/calendarInsights.ts`，唯一导出函数
  `calendarInsightsOf(calendar: UsageCalendar, now: number): CalendarInsights`。
  **输入吃现成的 `UsageCalendar`**（页面已有 memo，`UsageCalendarPanel.tsx:263`），
  不再从 `inputs` 重算一遍——Issue 原话「不新增数据通道：全部读自
  buildUsageCalendar 已有的事实」。`now` 必须是**生成这份 calendar 的同一个
  实例**（面板里就是那两个值一起传），当前连胜与环比的「今天」才有定义；
  防御：`now` 的 dayStart 不在窗口内时按窗口最后一天算（跨天挂机的理论边界，
  正常不可达，单测造一格钉住行为）。
- `now` 不引入新时钟：不加 `useState(Date.now())`、不加 tick（`billingReadouts`
  的 30 秒 tick 是计费对账的需要，洞察是历史事实，「今天还没消耗」的语义在
  午夜前永远成立，见 §3.4）。

### 1.2 位置：日历面板内部，图例之下、展开区之上——不新建 Panel

- DOM / 视觉位置：`.calendar` 网格里，图例 `.legend` 之后、展开区 `sessions`
  之前插一个 `<ul>`（§5.2 的结构）。裁决理由：
  ① Issue 允许「面板内或紧随其后的新 Panel」，但新 Panel 的外壳开销
  （标题 + 内距 + 边框 ≈ 50px）远超洞察句本身（§4.3 预算 40px），而洞察在
  语义上是日历的**注脚**——「先看形状，再看刻度，再看结论，点开看细节，
  最后口径」的阅读顺序天然成立；
  ② 独立 Panel 会重复一遍 `compactionRow` 整行布局（`UsageOverviewPage.tsx:454`），
  两行相邻的「日历 + 洞察」在 960px 窗口下把首屏顶穿；
  ③ 放展开区**之上**：展开一日回望时洞察句不动、展开区从它下方生长——
  视觉稳定，且「点洞察日期 → 展开区出现」的因果在空间上相邻。
- 不动既有结构：`FOOTNOTE`（`UsageCalendarPanel.tsx:30-31`）一个字不改——
  洞察句的口径各自挂在自己的 `title` 上（§5.2），不往面板脚注里塞六条口径
  （那会让脚注膨胀成第二段正文）。

---

## 2. `calendarInsights.ts`：类型签名与精确公式

### 2.1 类型（TypeScript，实现照抄）

```ts
import type { UsageCalendar } from "./usageCalendar";

/** 一段连续区间（连胜或空白）；单日段 startDay === endDay。 */
export type InsightSpan = {
  days: number;
  startDay: number;
  endDay: number;
  /** 段起点 === 窗口第一天：真实长度可能延续到窗口外，渲染时 title 注明。 */
  touchesWindowStart: boolean;
};

/** 当前连胜的三态（「有消耗」= costUsd > 0，§3.1）。 */
export type CurrentStreak =
  | { kind: "active"; days: number; startDay: number } // 今天有消耗
  | { kind: "pending"; days: number; startDay: number; endDay: number } // 今天没有，昨天往前连续
  | { kind: "broken"; lastActiveDay: number; idleDays: number }; // 昨天也没有

/** 本月 vs 上月同期（等长对齐窗口，§3.5）。 */
export type MonthCompare = {
  /** 对齐天数 N = min(今天几号, 上月天数)。 */
  days: number;
  /** 本月第 1..N 天的 costUsd 之和。 */
  currentUsd: number;
  /** 上月第 1..N 天的 costUsd 之和。 */
  previousUsd: number;
};

export type CalendarInsights = {
  /** 窗口内最长连胜；全年无消耗天为 null（空态，§6）。并列取最近段（§3.2）。 */
  longestStreak: InsightSpan | null;
  /** 三态之一；全年无消耗时为 broken 且 lastActiveDay 为 null 之外的三态外空态——
      见 §3.4：全空年整区走空态，本字段为 { kind: "broken", lastActiveDay: null, idleDays: 0 }。 */
  currentStreak: CurrentStreak | { kind: "broken"; lastActiveDay: null; idleDays: 0 };
  /** 最贵一天；全空年为 null。并列取最近（§3.2）。 */
  peakDay: { dayStart: number; costUsd: number } | null;
  /** 最长空白；365 天全有消耗为 null（理论态，真实不可达）。并列取最近段。 */
  longestGap: InsightSpan | null;
  /** 窗口天数从天格实数（恒 365，但不断字面量——窗口变长时口径跟着走）。 */
  activeDays: { days: number; total: number };
  /** 永远可算（纯日历数学）；空态由渲染层处理。 */
  monthCompare: MonthCompare;
};

export function calendarInsightsOf(
  calendar: UsageCalendar,
  now: number
): CalendarInsights;
```

### 2.2 六条公式（可单测的唯一写法）

前置：从 `calendar.cells` 拍平出升序的 `dayFacts: CalendarDayFacts[]`
（只收 `kind === "day"`，pad 丢弃；`buildUsageCalendar` 保证 365 项升序，
`usageCalendar.ts:194-228`）。`active(day) ⇔ day.costUsd > 0`（§3.1）。

```
1. longestStreak：扫描 dayFacts 找最长连续 active 段。
   比较：days 降序 → endDay 降序（days 相同的连续段 endDay 必不同，无第三键）。
2. currentStreak：today = dayStartOf(now)（不在窗口时取 dayFacts 最后一项，§1.1）。
   - today active → active：days = 从 today 往回连续 active 的天数，startDay = 首日。
   - today 不 active 且 yesterday active → pending：days = 从 yesterday 往回连续
     active 的天数，startDay / endDay = 该段首末日。
   - yesterday 也不 active → broken：lastActiveDay = dayFacts 里最后一个 active 天
     （无则 null + idleDays 0，即全空年的哨兵值）；idleDays = today − lastActiveDay
     的天数差（addLocalDays 计数，不用 ms 除法——DST 日不等长）。
3. peakDay：costUsd 降序 → dayStart 降序，取第一。全空（无 active 天）→ null。
4. longestGap：同 1，找最长连续 ¬active 段（比较键同款：days 降序 → endDay 降序）。
   touchesWindowStart = 段起点 === dayFacts[0].dayStart。
5. activeDays：days = count(active)，total = dayFacts.length。
6. monthCompare：全走日历分量（照 clockAt 的做法，不用 ms 数学）：
   monthStart = new Date(y, m, 1)（today 的年月）
   lastMonthEnd = addLocalDays(monthStart, -1)
   N = min(today.getDate(), lastMonthEnd.getDate())
   currentUsd = Σ costUsd(monthStart .. addLocalDays(monthStart, N-1))          // 本月第 1..N 天
   prevStart = addLocalDays(lastMonthEnd, -(lastMonthEnd.getDate() - 1))        // 上月第 1 天
   previousUsd = Σ costUsd(prevStart .. addLocalDays(prevStart, N - 1))         // 上月第 1..N 天
   （主会话工程评审修正：初稿公式 prevStart = addLocalDays(lastMonthEnd, -(N-1))
     算出的是**上月末 N 天**，与 §3.5 的「上月第 1..N 天（同期）」文本矛盾——
     两个区间各 N 天、两端闭区间，首日对齐各自的月首。）
```

### 2.3 恒等式（单测的验收线，照 V1 §2.3 的写法）

同一批 `inputs` 喂 `buildUsageCalendar` 再喂 `calendarInsightsOf` 时必然成立：

- `longestStreak.days === longestGap.days === 0` 不可能同时非零成立——
  即 `longestStreak 与 longestGap 的段` 各自内部的每个 `dayStart` 都能在
  `dayFacts` 里找到，且段的 active 状态逐天一致；
- `activeDays.days === dayFacts.filter(d => d.costUsd > 0).length`；
- `activeDays.days ≥ 1 ⇔ peakDay !== null ⇔ longestStreak !== null`；
- `monthCompare` 的两个区间各 N 天且 `N ≥ 1`，两区间都不越出 dayFacts 的
  窗口范围（扫 12 个月锚点的 `now` 逐一验证，§7.1）。

---

## 3. 取舍规则（全部写死——实现不许临场发挥）

### 3.1 「有消耗」判定 = `costUsd > 0`，与格子 0 档同一口径

连胜、空白、活跃占比、最贵一天、环比**全部**用 `costUsd > 0`。全 unknown
定价的天（有 token 有会话但成本未知，`hasUnknownCost` 家族）**不算有消耗**。

理由：验收线是「每句可核对——数字能对上格子」。用户对着格子数连胜，数的是
**有色格**；0 档格包含全 unknown 天（`levelOfCost` 的 `q === null || cost <= 0 → 0`），
如果洞察把它们算成「有活动」，连胜天数就和格子对不上，核对闭环破裂。代价是
「密集日有 8 个会话却算空白」的表面矛盾——由两点化解：① 该天格子点开仍有一日
回望（`onCellClick` 只拦 `sessions === 0`，`UsageCalendarPanel.tsx:354`），
活动事实没有消失；② 涉及口径的句子在 `title` 里写明「定价未知的天不计」
（§5.2 的口径表）。六句一个口径，不搞第二套。

### 3.2 并列取最近段（streak / gap / peak 同一条规则）

- 最长连胜并列：`days` 降序 → `endDay` 降序，取第一。
- 最长空白并列：同款。
- 最贵一天并列：`costUsd` 降序 → `dayStart` 降序，取第一。

理由：① 滚动窗口的**首段可能被窗口裁断**——段触及 windowStart 时真实长度
未知（`touchesWindowStart` 标记 + title 注明），近段的数据完整性总是更好；
② 用户核对近期的格子不用横向滚动很远。三条并列规则同构，单测逐一钉死。

### 3.3 窗口边缘的诚实性

- `touchesWindowStart === true` 的 streak / gap 段：句子照报，`title` 追加
  「区间自窗口首日起算，实际可能更长」——报告值是下界，不假装精确。
- gap 段触及 today（当前断档延续中）不特标：`currentStreak` 的 broken 态已经
  表达了「现在还断着」，两句话不重复同一事实。

### 3.4 当前连胜的三态文案（今天无活动如实说，不硬凑）

| 态 | 条件 | 正文（逐字） |
| --- | --- | --- |
| active | 今天 costUsd > 0 | `当前连胜 {N} 天（{start}至今）` |
| pending | 今天无、昨天有 | `今天还没有消耗；此前连续 {N} 天（{start}–{end}）` |
| broken | 今天昨天都无 | `连胜已断：最近消耗 {last}（{idle} 天前）` |

- pending 不说「已断」：午夜之前今天永远可能产生新记录，「今天还没有消耗」
  是事实的全部，不替用户下结论（`quotaReadout` 的「没有数据 ≠ 读了是零」
  同款立场，`quotaReadout.ts:33-36`）。
- broken 的 idleDays ≥ 2 恒成立（昨天也无活动才会进这个分支）。
- `lastActiveDay` 为 null（全空年）不进句子——整区走空态（§6）。

### 3.5 环比口径：本月前 N 天 vs 上月同期 N 天（等长对齐），不做日均化

**问题**：本月是进行中的月。拿本月至今（如 13 天）比上月整月（31 天），
总量对比必然「暴跌」——那是日历的形状，不是用户行为的变化。

**裁决**：`N = min(今天几号, 上月天数)`，比「本月第 1..N 天」与「上月第
1..N 天」的 costUsd 之和。两个等长日历窗，直接比总量。

理由：① **可核对**——两个区间都能在格子上框出来，数字逐格可验；② 不引入
假设——日均化（本月日均 vs 上月日均）隐含「本月剩余天数保持同样节奏」，
是把外推伪装成读数，且日均值对不上任何格子的和；③ 3 月 31 日的天然不对齐
（上月只有 28 天）由 `N = min(...)` 截齐，句子如实说「本月前 28 天」而不是
「本月至今」。

**文案分支**（`prev` / `cur` = previousUsd / currentUsd，`pct = Math.round(
(cur − prev) / prev × 100)`，仅 prev > 0 时定义）：

| 条件 | 正文（逐字） |
| --- | --- |
| prev > 0，cur > prev | `本月前 {N} 天 {formatUsd(cur)}（较上月同期多 {pct}%）` |
| prev > 0，cur < prev | `本月前 {N} 天 {formatUsd(cur)}（较上月同期少 {pct}%）` |
| prev > 0，cur = prev | `本月前 {N} 天 {formatUsd(cur)}（与上月同期持平）` |
| prev = 0，cur > 0 | `本月前 {N} 天 {formatUsd(cur)}（上月同期无消耗）` |
| prev = 0，cur = 0 | `本月前 {N} 天与上月同期都无消耗` |

- **「数据不足 30 天」不设专门话术、不隐藏句子**：刚装应用的用户拿到的会是
  「上月同期无消耗」或「都无消耗」分支——这已经是实话，再造一条「数据不足」
  判断就得回答「多少天算足」这个没有答案的问题（第二个口径只会更糊）。
  Issue 把这条留给设计裁决，裁决就是：**如实报数，不造门槛**。
- prev = 0 时不写百分比（分母为 0，`+∞%` 是噪声）——同 `percentOf` 返回
  null 的既有立场（`quotaReadout.ts:33-36`）。
- 方向词用「多 / 少」不用「+ / −」：中文句子里符号方向易漏看，词更稳。

### 3.6 日期显示格式：同年短式、跨年带年；title / aria-label 永远带年

- 句子**正文**里的日期：与今年同年的天用 `{M}月{D}日`（`shortDateOf` 的
  格式，`UsageCalendarPanel.tsx:81-84`）；不在今年的天用 `{Y}年{M}月{D}日`。
  跨年窗口的常态是只有首月 / 末月附近的日期可能落在去年——规则与月份标签
  的「重复 ⇔ 都带」同精神：**需要区分时才带年**。六句只有一两个日期，
  不是 13 个标签，正文短式 + 全格式 title 的信息成本最优。
- 日期**按钮**的 `title` 与 `aria-label`：`{Y}年{M}月{D}日 · 打开一日回望`
  ——带年（`cellLabelOf` 的既有原则：跨年窗口里符号必须有可靠落点，
  `UsageCalendarPanel.tsx:46-49` 注释）。
- 区间两端各自适用年份规则；跨年区间如 `2025年12月28日–2026年1月20日`，
  连接符用 en dash `–`（`formatClock` 的 `00:25–18:41` 同款先例）。

---

## 4. 形态与视觉

### 4.1 形态裁决：脚注级「一句话列表」（flex-wrap 的 `<ul>`），不是卡片行、不是悬停摘要

- **不是六张 stat 卡**：卡片行（照 `daySummary` 的瓦片形态）会造出六个等宽
  瓦片 ≈ 100px 高，把「注脚」做成「第二张仪表盘」——日历是主图，洞察是
  主图的读后感，高度预算撑不起平级呈现（§4.3）。
- **不是悬停摘要**：六句是「扫一眼就有」的结论，藏进 hover 等于没有
  （触屏 / 键盘用户完全不可达，也违背「让数据自己开口说话」的 Issue 初衷）。
- **不是可展开区**：默认收起的话结论不可见；默认展开就等于本方案，多一层
  开合状态没有收益。
- 落地形态：`<ul>` 每句一个 `<li>`，`display: flex; flex-wrap: wrap`，
  句间以 `gap` 分隔，窄窗口自然折行（`daySummary` 的 auto-fit 折行先例，
  `UsageCalendarPanel.module.css:254-260`——高度预算靠折行消化，不横向滚）。

句序固定 = Issue 契约顺序（`longest-streak → current-streak → peak-day →
longest-gap → active-share → month-compare`），键写死（照 `SummaryKey`
六项键写死的先例，`UsageCalendarPanel.tsx:43`）：

```
最长连胜 23 天（8月12日–9月3日）
当前连胜 2 天（10月12日至今）
最贵一天 10月11日（$12.00）
最长空白 99 天（1月3日–4月11日）
这一年 7/365 天有消耗（2%）
本月前 13 天 $3.45（较上月同期多 15%）
```

六句正文逐字模板（组件测试与 e2e 的断言契约）：

```
longest-streak   最长连胜 {N} 天（{d1}–{d2}）
current-streak   三态，§3.4
peak-day         最贵一天 {d}（{formatUsd(cost)}）
longest-gap      最长空白 {N} 天（{d1}–{d2}）
active-share     这一年 {days}/{total} 天有消耗（{pct}%）   // pct = Math.round(days/total*100)
month-compare    五分支，§3.5
```

### 4.2 强调色裁决：不加新令牌，不借语义色——数字提一档、日期走链接语义

- **不加 `--insight-*` 之类的新色**：六句是文本读数不是图形，全部走既有
  文本层级即可。最贵一天 / 最长连胜**不做彩色强调**：色在日历面板里已经
  被「日期成本四分位」（`--cal-*`）占满，再引入第二种强调色等于教用户
  第二套颜色语言，而它不承载任何新维度。
- **不借语义色**：`--warning` 是「非确定信息」（估算 / 未知价），洞察句是
  读自日志的确定事实，挂 warning 会污染「确定性」三档语义（`tokens.css:46-53`）；
  `--success` 是「确定的读数」——六句全是确定读数，全绿等于没强调。
- 落地：句子正文 `--text-secondary` + `--fs-xs` / `--lh-xs`（比脚注的
  `--text-tertiary` 高一档——洞察是内容，脚注是口径）；句内**数字**与
  **日期**用 `--text` + `font-variant-numeric: tabular-nums`（同
  `.summaryValue` 的数字语言，`UsageCalendarPanel.module.css:282-289`）。
  日期按钮文本色 `--accent`——「链接」是 `--accent` 的既定语义位
  （焦点环、链接、选中底，`tokens.css:39-40`），点击下钻正是链接行为；
  hover 加下划线。焦点环走 `--focus-ring-width/-offset` 令牌，组件零分支。

### 4.3 高度预算：常态 ≤ 2 行（40px），130% 字号最坏 3 行（≈ 76px）

- 六句平均 ≈ 20 个全角字符 ≈ 220px（`--fs-xs` 11px）；内容区 ≈ 910px
  （960 窗口）常态折成 2 行：`2 × --lh-xs(16) + gap` ≈ **40px**（含
  `.calendar` 的 8px 行距）。最坏（长日期 + 跨年区间 + 130% 字号）3 行：
  `3 × 20.8 + 16 ≈ 78px`。日历面板总高从 ≈ 170px 涨到 ≈ 210px，首屏
  容得下（`usage-day` 截图的滚动定位按面板顶算，不受影响）。
- 不设 `max-height`、不内部滚动——折行消化一切，同 `daySummary` 的取舍。

---

## 5. 交互与可达性

### 5.1 日期下钻协议：与格子点击同一条 state

- 洞察句里的日期**按钮**点击 = `onCellClick(dayStart, sessions)` 的同款语义：
  `setFocusDay(dayStart)` + `setSelected(current => current === day ? null : day)`
  （toggle，再点收起），并把该格 `scrollIntoView({ block: "nearest",
  inline: "nearest" })`——洞察点到的常是很久以前的日期，格子多半不在横向
  视野内，滚过去用户才能看到选中描边（`aria-expanded=true` 的 2px accent
  outline，`UsageCalendarPanel.module.css:114-116`）。
- **可点资格 = 该天 `sessions > 0`，与格子完全一致**（`onCellClick` 只拦
  `sessions === 0`，`UsageCalendarPanel.tsx:354`）。于是：
  - 最贵一天 / 连胜端点 / 最近消耗日：必 `costUsd > 0` → 必可点；
  - 空白区间端点：`costUsd = 0`，其中「密集日」型（sessions > 0、全 unknown
    或无 usage）**可点**（点开有一日回望），真空白天（sessions = 0）渲染为
    **纯文本 span**——不是禁用按钮：点了没有任何反馈的控件是坏交互，
    格子对空白天也只是一个色块不是按钮（`data-sessions="0"` 去手型，
    `UsageCalendarPanel.module.css:96-98`）。
- 资格判定组件侧做：`useMemo` 把 `calendar.cells` 拍平成
  `Map<number, CalendarDayFacts>`（O(365)，一次），渲染每个日期时查
  `sessions > 0` 决定 button / span。数据层保持纯数字语义（§2.1），可点性
  断言归组件测试（§7.3）。
- Escape：日期按钮聚焦时收起展开区、焦点留在按钮上（对称于时间线行的
  Escape 行为，`UsageCalendarPanel.tsx:387-393`）。

### 5.2 aria 结构（真实 `<ul>`，每句一个 `<li>`）

```html
<ul class="…" aria-label="一年洞察" data-probe="calendar-insights">
  <li data-probe="calendar-insight-item" data-insight-key="longest-streak"
      title="连续 N 天 = 窗口内连续『当日估算成本 > $0』的最长天数，与格子 0 档同口径（定价未知的天不计）；并列取最近一段">
    最长连胜 <span class="…num">23 天</span>（<button type="button"
      title="2026年8月12日 · 打开一日回望" aria-label="2026年8月12日 · 打开一日回望">8月12日</button>–<button …>9月3日</button>）
  </li>
  …
</ul>
```

- `<ul aria-label="一年洞察">`：读屏把它当一个具名列表探索；每句 `<li>` 的
  文本即句子全文，**句内的按钮只承载日期本身**，`aria-label` 带
  「打开一日回望」的动作预告——句子语境 + 按钮名拼起来是完整指令。
- 每句的 `title` = 该句口径（悬停可查「这个数怎么算的」，`SummaryItem`
  的 title 先例，`UsageCalendarPanel.tsx:154-167`）。六条口径逐字：

| 键 | title |
| --- | --- |
| longest-streak | `连续 N 天 = 窗口内连续「当日估算成本 > $0」的最长天数，与格子 0 档同口径（定价未知的天不计）；并列取最近一段` +（touchesWindowStart 时）`；区间自窗口首日起算，实际可能更长` |
| current-streak | `从今天往回数「当日估算成本 > $0」的连续天数；今天没有消耗时如实说明，不预设今天结束` |
| peak-day | `当日估算成本最大的一天，与格子色深同口径（定价快照 {PRICING_AS_OF}）；并列取最近` |
| longest-gap | `连续「当日估算成本 ≤ $0」的最长天数；定价未知的天计入空白（与格子 0 档同口径）；并列取最近一段` +（touchesWindowStart 时）`；区间自窗口首日起算，实际可能长` |
| active-share | `窗口 365 天里「当日估算成本 > $0」的天数；定价未知的天不计入` |
| month-compare | `本月第 1..{N} 天与上月同期 {N} 天的估算成本之和对比（等长日历窗，不拿部分月比完整月）；成本为估算值（定价快照 {PRICING_AS_OF}）` |

### 5.3 键盘与焦点

- Tab 序：日期按钮是原生 `<button>`，自然进 Tab 序（每句最多 2 个日期按钮，
  六句全展开最坏 9 个 stop——可接受，不另做 roving tabindex：列表不是网格，
  无方向键语义可给）。
- 焦点环：`outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset)`——令牌自动给普通 2px / HC 3px。

---

## 6. 状态表

| 场景 | 洞察区 | 备注 |
| --- | --- | --- |
| 正常（一年有消耗） | 六句全渲染，日期按 §5.1 资格渲染 button / span | |
| **全 0 年（365 天无消耗）** | **单句空态**：`这一年还没有可统计的消耗`（`--text-tertiary`，无日期无按钮）；六句全部不渲染 | 日历照画（V1 裁决「不整块消失」），洞察同样不消失——一句实话占位，形状与结论一致；e2e 用 `emptyScenario` 断 |
| 只有 1 天有消耗 | 最长连胜 1 天（startDay === endDay，正文 `{d}` 单日不写区间） | 单日区间文案：`最长连胜 1 天（8月12日）`，不写 `8月12日–8月12日` |
| 当前连胜跨窗口起点 | 照报 + touchesWindowStart 的 title 注明 | 真实长度未知，报告下界 |
| 今天恰为月末 / 月初 | 环比 N = min(几号, 上月天数)，文案「本月前 {N} 天」照报 | 1 号运行 → 「本月前 1 天」 |
| 3 月底运行（上月 28 天） | N = 28 < 31，对比窗截到 28 天 | §3.5 裁决的天然分支 |
| 渐进扫描中 | 随批次重算（与格子同拍，memo 依赖 `[calendar, now]`） | 数字只增不减（已扫会话不回退），无闪烁问题 |
| 区间选择器切 7/30/90 | **不变** | 洞察吃 `calendar`，与区间选择器正交（V1 §1.2 同款） |
| 切「错误」档 | 整面板不渲染（含洞察） | 住在日历面板里 |
| 130% 字号 | 折行最多 3 行，≈ 76px | §4.3 预算 |
| 高对比度（浅 / 深） | 文本层级与焦点环走令牌，零分支 | 无新令牌（§4.2） |

---

## 7. 验收矩阵（每条都能被断言）

### 7.1 纯函数（`calendarInsights.test.ts` 新文件）

- [ ] **手搓 calendar 的 helper**：`calendarWith(now, costByOffset)`——先
      `buildUsageCalendar([], now)` 拿正确几何（53 列 / pad / 窗口），再按
      「now−N 天 → costUsd」覆写 cells 里对应天的 `costUsd`。几何数学不重造。
- [ ] **最长连胜**：单段 / 多段取最长 / **并列取最近**（两天造 `[off−10..−8]`
      与 `[off−5..−3]` 各 3 天 → endDay 大者胜）/ 触及窗口起点的
      `touchesWindowStart === true`。
- [ ] **当前三态**：今天有 / 今天无昨天有（pending 的 startDay–endDay 区间
      正确）/ 昨天也无（broken 的 lastActiveDay 与 idleDays 用 addLocalDays
      计数验证，含 idleDays ≥ 2 恒成立的分支断言）。
- [ ] **最贵一天**：唯一最大 / **并列取最近**（两天同 cost → dayStart 大者）/
      全空 null。
- [ ] **最长空白**：基本段 / 边缘段（窗口首日起算的 touchesWindowStart）/
      365 天全有消耗 → null（理论态钉死）。
- [ ] **活跃占比**：days / total 与 costByOffset 的正值计数一致；total 从
      天格实数（=== 365）。
- [ ] **环比**（固定 now 逐个钉）：
      - `now = 2026-10-13` → N = 13，currentUsd / previousUsd 只合计各自
        区间的 costUsd（手造两侧不同值）；
      - `now = 2026-03-31` → N = 28（上月 2 月只有 28 天）；
      - `now = 2028-03-31`（闰年 2 月 29 天）→ N = 29；
      - `now = 2026-10-01` → N = 1；
      - **不变量**（扫 12 个月锚点 × 任意的 now）：两个区间各 N 天、都不越出
        窗口、起点间隔恰为上月天数。
- [ ] **全空年**：`longestStreak === null && peakDay === null`、currentStreak
      为 `{ kind: "broken", lastActiveDay: null, idleDays: 0 }` 哨兵、
      `activeDays.days === 0`。
- [ ] **守卫（对账）**：同一批真 inputs 走 `buildUsageCalendar` 再走
      `calendarInsightsOf`——`activeDays.days` 与 cells 里 `costUsd > 0` 的
      计数一致（§2.3 恒等式；`dayReview.test.ts` 对账守卫的同款做法）。
- [ ] 输入顺序无关：等价 calendar（同 facts 不同 cells 内部顺序）输出相等
      （拍平后排序再算，实现天然满足，测试钉住）。

### 7.2 组件（`UsageCalendarPanel.test.tsx` 增补，`NOW` 沿用文件里既有的
2026-10-12 固定注入）

- [ ] 六句全渲染：`[data-probe="calendar-insight-item"]` 计数 6、`data-insight-key`
      序列逐字等于 `["longest-streak", "current-streak", "peak-day",
      "longest-gap", "active-share", "month-compare"]`（`SummaryKey` 键序断言
      的同款写法）。
- [ ] 文案逐字：按测试布景手算期望句（含 §4.1 模板的标点与全角括号）。
- [ ] **日期下钻**：点 `peak-day` 句里的日期按钮 → `[data-calendar-sessions]`
      在场、展开区头部含该天的「{M}月{D}日」；对应格子
      `aria-expanded="true"`；再点同一按钮收起。
- [ ] **可点资格**：真空白端点渲染为 span（`queryByRole("button")` 不含它）；
      密集日型端点（sessions > 0、costUsd = 0）渲染为 button 且点击可展开。
- [ ] 日期按钮的 `title` / `aria-label` 同文且带年（`{Y}年{M}月{D}日 · 打开一日回望`）。
- [ ] **空态**：无 usage 输入 → 六句不在、空态单句在场
      （`calendar-insights` 容器仍在）。
- [ ] Escape：展开态下焦点在日期按钮上按 Escape → 展开区收起、焦点留在按钮。
- [ ] 视觉纪律：`.insights` 相关 CSS 无颜色字面量、无 `--sp-*` 之外的间距
      字面量（读 CSS 文件断言，既有先例写法）。

### 7.3 端到端（`web/e2e/usage-calendar.spec.ts` 增补，Chromium + WebKit，
沿用 `calendarScenario`）

- [ ] 六句键序（同 7.2 的键序断言）。
- [ ] **确定值断死**（夹具数字，见 §0 的布景账）：
      `最长连胜 2 天`（昨天到今天）、`最贵一天`句含 `$12.00`、
      `最长空白 99 天`、`这一年 7/365 天有消耗（2%）`、current-streak 为
      active 态 `当前连胜 2 天`。日期文本随运行日漂移——断句子的稳定前缀
      与数字段，不断整句。
- [ ] **环比只断结构**：句子含 `本月前` 与 `上月同期` 字样（夹具活动日相对
      now、落进哪个月随运行日漂移，值不可断；数学由 7.1 的固定 now 钉死）。
- [ ] **下钻闭环**：点 `peak-day` 句的日期按钮 → `[data-calendar-sessions]`
      在场且含 `4 个会话`（昨天 = 4 会话日）→ 点格子的「× 清除」收起。
- [ ] 空白区间端点里 `now−2`（密集日）若出现在断言中，验证其为 button；
      （夹具下 longest-gap 端点是真空白天，断其为 span / 无 button。）

### 7.4 真机门禁（`scripts/gui-test.sh` + `src-tauri/src/lib.rs`）

- [ ] **探针**（PROBE_JS 的 `calendarFacts` 增一字段，`lib.rs:1040` 段）：
      `calendarFacts.insights = { present, count, keys, text }`——容器
      `[data-probe="calendar-insights"]` 在否、`[data-insight-key]` 计数与
      键序列、textContent 压平文本。Rust 守卫测试同步增断
      `PROBE_JS.contains("calendar-insights")`（`lib.rs:1889` 段同款）。
- [ ] **判定**（`gui-test.sh`「视图=用量」目标处，`gui-test.sh:1300` 段）：
      insights.present 且 count === 6 且 keys 逐字等于六键；text 含
      `最长连胜`、`最贵一天`、`最长空白`、`天有消耗`、`本月前` 五个稳定词
      （`current-streak` 三态随今天夹具态变化，不断词——门禁夹具今天有会话，
      实际落在 active 态，可断 `当前连胜`，但把这条写成「text 含
      `连胜`」的宽松档，防夹具演进误伤）。
- [ ] **不新增 CAPTURE_TARGETS 步骤、不新增截图视图**：洞察句在 `usage`
      （首屏含日历面板）与 `usage-day`（日历 + 展开态）两张既有截图里自然
      入镜（它在图例之下、面板内部，`screenshots.spec.ts:375-422` 的截法
      面板顶部对齐后整面板在框内）。理由见 §8.4——Issue #196 的三处清单
      坑，能不加视图就不加。

---

## 8. 明确不做（各自动机）

1. **不做卡片行 / 悬停摘要 / 可展开**（§4.1 三条否决理由）；**不新建
   Panel**（§1.2 的外壳开销与注脚语义）。
2. **不加新颜色令牌、不借 `--cal-*` / 语义色 / `--chart-*`**（§4.2）：
   `--cal-*` 是日期成本语义不能挪用；`--warning` 的「非确定」语义与洞察的
   「确定事实」相反；文本两级 + accent 链接已是完整表达。
3. **不做日均化环比、不设「数据不足 30 天」门槛**（§3.5）：等长对齐窗 +
   如实分支文案；日均化是外推伪装成读数，天数门槛是没有答案的口径。
4. **不新增截图视图、不加 CAPTURE_TARGETS 动作**（§7.4）：Issue #196 的
   教训是每加一个视图要同步三处清单（`screenshots.spec.ts` /
   `check-screenshots.sh` / `check-screenshots-test.sh`），#193 就漏过第三处。
   洞察句无展开态、无主题特异（纯文本 + 令牌色），既有 `usage` / `usage-day`
   两视图足以归档形态——规避清单坑是本条裁决的第一动机，其次是真没有
   独立截图的必要。
5. **不改 `SNAPSHOT_SCOPE_NOTE`**（`usageSnapshot.ts:86-87`）：洞察句住在
   日历面板内，「不含消耗日历」在语义上已涵盖它——快照读者不会期待面板
   内部的任何子元素。改文案（如「不含消耗日历及其洞察」）只会引入第二个
   需要同步的原文位置（e2e 的 `SCOPE_NOTE` 契约常量，`usage-calendar.spec.ts`
   同款先例），收益为零。
6. **不做洞察句的 token 视角**（六句全成本口径）：格子已是成本口径
   （色即消耗），洞察与主图同口径才可核对；token 数字已在格子 title 与
   一日回望里，不重复第三遍。
7. **不把洞察搬进快照导出 / 托盘读数**：Issue 范围只有日历面板；快照的
   「不含」清单见第 5 条。

---

## 9. 实现者清单

按改动顺序，逐文件：

1. `web/src/features/usage/calendarInsights.ts`（新）：§2 类型与
   `calendarInsightsOf` 六条公式 + §3 全部取舍规则。
2. `web/src/features/usage/calendarInsights.test.ts`（新）：§7.1 全部条目
   （含手搓 helper 与对账守卫）。
3. `web/src/features/usage/UsageCalendarPanel.tsx`：图例之后插洞察 `<ul>`
   （§5.2 结构）、factsByDay 拍平 memo、日期按钮的点击 / Escape（§5.1）、
   空态分支（§6）、六条 title 口径（§5.2 表）。
4. `web/src/features/usage/UsageCalendarPanel.module.css`：`.insights`
   （flex-wrap 列表）、`.insightItem` / `.insightNum`（tabular-nums）/
   `.insightDate`（accent 链接式 + hover 下划线 + 焦点环令牌）/ 空态句。
5. `web/src/features/usage/UsageCalendarPanel.test.tsx`（增补）：§7.2。
6. `web/e2e/usage-calendar.spec.ts`（增补）：§7.3（夹具不用改——
   `calendarScenario` 的布景已够）。
7. `scripts/gui-test.sh` + `src-tauri/src/lib.rs`：§7.4 的探针字段、
   Rust 守卫断言、「视图=用量」处的六键判定（不新增截图视图与动作步骤）。
8. 文档：`CHANGELOG.md`（`[Unreleased] → Added`，中文条目「消耗日历新增
   一年洞察：最长连胜 / 当前连胜 / 最贵一天 / 最长空白 / 活跃占比 / 本月环比，
   日期可点击下钻一日回望」）、`docs/USAGE.md` 日历段（第 191–208 行）补
   一小段（六句内容、口径与格子同档、「定价未知的天不计入有消耗」两条事实）、
   `README.md` / `README.zh-CN.md` 功能条目补一句（双语）。

**一句话**：这一轮的重量压在三个地方——**取舍规则全部写死且只有一个口径**
（「有消耗 = costUsd > 0」贯穿六句，并列一律取最近，环比用等长对齐窗，
数字全部能对上格子）、**形态是注脚不是第二张仪表盘**（脚注级句列表，
40px 预算，零新令牌，日期走 accent 链接语义）、**门禁做加法但不碰截图清单**
（探针加 `insights` 字段与六键判定，靠 `usage` / `usage-day` 既有视图归档
形态——Issue #196 的三处清单坑一个都不踩）。三件事做齐，「时间的形状」
这一轮才真正收口：形状给眼睛，句子给嘴巴。
