# Round DD · 第二批十功能 · UI/UX 设计规格

**一句话定位**：这十个功能不是十个新页面，而是**用量总览这一张仪表盘的十条刻度**——每一条都挂在已经存在的读数旁边，回答「刚才那个数字，换一种问法是多少」。

作者：liangyuxiang（本轮由主会话兼任设计）。日期：2026-10-27。
代码基线：分支 `feat/v032-batch-ten-2`。本文只写规格，不含实现；`web/`、`src-tauri/`、`scripts/` 在本轮**一字未改**。

---

## 0 语境与现状（先把事实对齐）

### 0.1 逐字读过的文件

| 文件 | 行数 | 本文用它做什么 |
| --- | --- | --- |
| `web/src/styles/tokens.css` | 476 | 唯一取色 / 取间距 / 取字号的来源；四主题块逐字对照 |
| `web/src/features/usage/UsageOverviewPage.tsx` | 661 | 渲染顺序、既有 12 块、档位状态、导出快照链路 |
| `web/src/features/usage/UsageOverviewPage.module.css` | 197 | `.page` / `.header` / `.kpiRow` / `.board` / `.compactionRow` 的精确值 |
| `web/src/features/usage/*.module.css` | 14 个文件 | 各面板内高、行高、图表尺寸 |
| `web/src/components/Panel.tsx` + `.module.css` | 41 + 41 | 卡片原语：表头 `min-height: 40px`、体内距 `var(--sp-3)` |
| `web/src/components/SegmentedControl.tsx` | 130 | 卡内视图切换的唯一形态（`role="tablist"` + roving tabindex） |
| `web/src/api/types.ts` | 130+ | `FsBridge` / `DialogBridge` 的真实方法集（决定了 D5 的结论） |
| `src-tauri/src/lib.rs` | 55–160 段 | `write_text` 的路径校验形态（`create_dir_all` + `write`） |
| `web/src/features/usage/{toolHealth,workHabits,peakMinute,tokenEquivalents}.ts` | 142 / 200+ / 60 / 80 | **D2 / D8 / D9 / D10 的模型层已经存在**，本文按真实签名接线 |
| `web/src/features/usage/{limitForecast,pricingSnapshot,billingReadouts}.ts` | 99 / 200+ / 200+ | D6 的分档阈值、D3 的定价族、计费窗口读数 |
| `.trellis/spec/frontend/{component-guidelines,quality-guidelines}.md` | — | 分层约定、禁止模式、诚实读数三条 |
| `web/src/features/sessions/LogView.tsx` 的类别映射 | — | 类别色语义（本轮不新增任何类别） |

### 0.2 页面现状（插入前，逐条）

用量档的渲染顺序（`UsageOverviewPage.tsx:496–657`）：

1. `BillingWindowCard`（计费卡，整行）→ 2. `.kpiRow`（四个读数 + 跨列脚注）→ 3. `WeeklyDigestPanel`（周战报，整行）→ 4. `.board` 两列网格：
`每日 Token 消耗` ｜ `ProjectArenaPanel` → `.compactionRow` `ProjectCardsPanel` → `.compactionRow` `UsageCalendarPanel` → `按模型分布` ｜ `.compactionRow` `FlowDiagramPanel` → `活跃时段（周 × 小时）` ｜ `.compactionRow` `ToolCensusPanel` → `.compactionRow` `CompactionStatsPanel`。

即：**两列网格里夹着五块整行**。`.compactionRow` 的唯一定义是 `grid-column: 1 / -1`（`UsageOverviewPage.module.css:132`），页面上**五处**整行容器共用这一个类名（`UsageOverviewPage.tsx:570 / 577 / 613 / 638 / 649`），这是既有约定，本轮沿用、不新造第二个名字。

三个关键尺寸事实：

- `.page` padding `var(--sp-3)` = 12px，纵向 gap 12px；`.board` gap 12px。
- `Panel` 表头 `min-height: 40px`、体内距 12px —— **任何新面板的固定开销是 40 + 24 = 64px**，写进账里。
- 卡内图表高度：`BarChart` 缺省 220（此处传入 170）、`StackedBar` 固定 30、`Heatmap` = `LABEL_TOP + 7×CELL + 6×GAP + 6`。

### 0.3 四个功能的数据层已经落地（这是本轮最重要的现状）

| 功能 | 已存在的模块 | 真实签名 | 意味着 |
| --- | --- | --- | --- |
| D2 工具健康 | `toolHealth.ts` | `toolHealth(facts: readonly ToolCallFact[]): ToolHealthReport`；`MIN_FAILURE_SAMPLE = 3`；`P95_SAMPLE_WINDOW = 100`；`worst` 已按「失败率 → 调用数 → 码元序」排好 | 界面**不做任何重排、不重算 p95**，只取 `report.worst.slice(0, 6)` |
| D8 工作习惯 | `workHabits.ts` | `workHabits(sessions: readonly UsageSessionInput[], now: number): WorkHabits`；字段 `chronoType / currentStreak / longestStreak / longestSessionMinutes / peakHour / peakHourShare` | 四宫格的四个格子**恰好**是这四组字段，不多不少 |
| D9 峰值时刻 | `peakMinute.ts` | `peakMinute(sessions): PeakMinuteReport`；字段 `minuteStart: number | null / tokens / runnerUp: PeakMinute | null / distinctMinutes` | 一行读数，`minuteStart === null` 时整行消失 |
| D10 token 等价物 | `tokenEquivalents.ts` | `equivalentsFor(tokens): EquivalentCount[]`；`EQUIVALENTS` 四条，每条带 `note` | 四条单价与依据**只用常量里的**，界面不得自己乘一遍 |

这四个模块的单元测试已经存在（`*.test.ts` 同目录）。本规格因此**不定义它们的接口**，只定义界面如何消费——实现者不该再写第二份同样的数学。

> 写作时 D3 的 `modelShiftPricing.ts`（换模价差）正在并行落地（未提交）。本规格只用它的**语义**（同一批 usage 按另一族单价重算 + 逐条 `±%`），不锁定文件名与函数名：若它最终叫别的名字、或字段不同，实现者按 §3.3 的列语义对接即可，不要为了对齐规格改名。

### 0.4 三条诚实读数口径（沿用，不重新发明）

- **没有分母就不印百分比**（`limitForecast.ts:22–52`）：`planLimitTokens === null` 时 `buildLimitForecast` 返回 `null`，界面整行消失，而不是画一个 0% 的表盘。
- **样本不足不硬拗**（`toolHealth.ts:11–21`）：`calls < 3` 时 `failureRate = null`，界面印「样本不足（2 次）」，不印 0%。
- **缺字段不是 0**（`tokenEquivalents` / `workHabits` 同款）：`avgMs`、`peakHour`、`minuteStart` 为 `null` 时，位置留空或整行消失，不拿 0 顶替。

---

## 1 七条裁决（先落，再画）

### D-1 十功能的档位归属：usage 档 8 个、milestones 档 1 个、errors 档 0 个

| 功能 | 档位 | 挂载点 | 形态 | 增量高度 |
| --- | --- | --- | --- | --- |
| D1 会话对比 | usage | 周战报之后、`.board` 之前 | **整行**面板 | 268 |
| D2 工具健康 | usage | `ToolCensusPanel` 卡内新增第二个 tab | 卡内视图 | 0 |
| D3 换模计价 | usage | `按模型分布` 卡内新增第二个 tab | 卡内视图 | 0（同级行高被对侧吸收） |
| D4 指纹雷达 | usage | 项目卡片之后（与 D8 同行） | 半宽面板 | 268（行高 = max(D4, D8)） |
| D5 开发者海报 | **milestones** | 里程碑档尾部 | 整行面板，预览默认折叠 | 120 → 380（展开） |
| D6 烧钱仪表 | usage | `BillingWindowCard` 的 forecast 行内 | 行内 72×40 微表 | +24 |
| D7 会话甘特 | usage | 消耗日历之后（与日历同为整行叙事） | **整行**面板 | 356 |
| D8 工作习惯 | usage | 活跃时段之后、工具普查之前（与 D4 同排的下一行） | 半宽面板 | 见 D4 行 |
| D9 峰值时刻 | usage | `WeeklyDigestPanel` 内新增一行 | 读数行 | +16 |
| D10 token 等价物 | usage | `.kpiRow` 脚注的展开区 | 折叠区 | 0（折叠）/ +96（展开） |

**为什么 errors 档一个都不进**：错误档的语言是「今天出了什么事」——事故、簇、单条事件的可回跳路径。十功能里唯一沾边的是 D2（工具失败率），但它是**跨窗口的画像**，不是事故；把它塞进错误档会把「事故现场」稀释成「长期体检报告」。错误档保持它现在的三块（趋势 / 簇 / 事件清单），一个都不加。

**为什么 D5 进 milestones 档**：里程碑档的既有语义是「值得留档的事实」（全历史口径 + 报告落款 + 可导出）。海报是同一个语义的另一种介质——把它放进 usage 档会让「近 30 天」的窗口控件看起来管着它，而海报的数字是全历史。

### D-2 usage 档已经很长：本轮不动首屏，三条插入纪律

现状：`.board` 之上已有「计费卡 + KPI + 周战报」三块（首屏），`.board` 内部两列网格夹五块整行，总高远超 900。本轮十功能里 8 个进 usage 档，若每个都做整行，页面会长出 1,200px 以上——那是「滚两屏才看全」的失控高度。

三条纪律（写进实现清单，评审时逐条核）：

1. **新增整行块一律插在 `.board` 的第一个整行位置之后**，不得插在首屏三块之前，也不得插在「两列网格第一行」之前——首屏的五块内容（计费 / KPI / 周战报 / 每日 Token / 擂台）一个都不许下移。
2. **单个新块 ≤ 400px**（项目既有展开区上限惯例）。D7 = 356、D1 = 268、D4/D8 行 = 268、D5 折叠 120 / 展开 380，全部在限内；D5 若把预览做成常驻 300px，就会破限——所以预览默认折叠，这条不是风格选择，是高度预算的结果。
3. **能用卡内 tab 解决的，绝不新开一块**：D2、D3 是同一批事实的第二种问法（工具普查的失败率、模型分布的假设成本），做成第二个 tab，增量高度为 0。

### D-3 D1 会话对比的选择器：两个原生 `<select>`，不复用任何自造浮层

**结论**：两个 `<select>`，加 `<label>`。

理由三条（按重要性）：

1. **可访问性是免费的**。原生 select 自带键盘、屏幕阅读器、macOS 的原生弹出、130% 字号下不裁字。自造 listbox 要在 40 个会话里维护 roving tabindex + 弹出层定位 + 焦点归还，这些都是本项目已经在 `SearchPalette` 里付出过一次的成本。
2. **不复用 `SearchPalette`**：它是**命令面板 / 全局搜索**的地盘（Round CC F9 之后 ⌘K 归命令面板，搜索是面板里的一条命令）。两个选择器若调起同一个浮层，用户会以为「选会话」和「搜会话」是同一件事，而它们的副作用完全不同（前者只在卡内换面板，后者会跳走）。
3. **规模不需要虚拟化**：一个窗口最多 40 行会话（近 90 天），原生 select 轻松承载。超过 200 项才需要自造——那时再换，换的成本也不会比现在低。

排布：`左侧 select` → `对比` 徽标（`--text-tertiary`）→ `右侧 select`。两个 select 的 `name` 与可见标签分别是「会话 A」「会话 B」。默认值：A = 窗口内 **token 最多**的会话，B = **第二多**（并列取更早开始的）——「默认就有内容」比「默认两只空盒子」更有用；同时脚注写明默认口径。

空态与不足态文案（逐字，见 §6）：窗口内 0 个会话 → 卡不渲染（`.board` 之上不出现空盒子）；1 个会话 → 卡渲染但只有一句「本窗口只有 1 个会话，没有对手可比」，两个 select 隐藏。

### D-4 D2 工具健康：工具普查卡内新增 tab，不进 errors 档

`ToolCensusPanel` 现在是一张「调用次数」清单。健康是**同一批 `ToolCallFact` 的第二种投影**（次数 → 失败率/耗时），数据源同一个、窗口同一个，做成 tab 的增量成本接近 0；做成独立面板则会迫使读者在两处看同一批工具，并且要新开一个「窗口化」入口。

tab 标签：`调用次数` ｜ `健康`，默认仍停在 `调用次数`（既有截图与断言零变化）。

### D-5 D6 烧钱仪表：半圆微表**不进圆环**，与既有 `Gauge` 分工

现状：`charts/Gauge.tsx` 是一个 120 viewBox 的**整圆环**，中心印「已用 / 限额」的百分比，`data-probe="gauge"`，唯一调用点是计费卡。它回答的是**事实**：此刻窗口里用掉了限额的百分之几。

D6 回答的是**预测**：照当前速率走到窗口末，会到百分之几（`LimitForecast.projectedPct`）。

三个候选与裁决：

| 候选 | 做法 | 为什么否 / 为什么选 |
| --- | --- | --- |
| A 在圆环上加一根指针 | 一个表盘两个读数 | **否**：事实与预测落在同一条刻度上，读者无法分辨「哪根是现在已经发生的」。而且 `Gauge` 有既有单测（`Gauge.test.tsx:61` 断言 `.gauge { height: var(--gauge-size) }`），塞指针要改它的内部约定 |
| B 把圆环整个换成半圆 | 一个表盘、两段弧 | **否**：既有 `data-probe="gauge"` 是 gui-test 的几何锚点，换形态会让真机基线全数重出；且圆弧是「进度」的通用语汇，半圆是「仪表」，混用会削弱既有读数 |
| **C 半圆微表挂在 forecast 行内** | 72×40，四档色带，**不带数字**，指针只回答「落在哪一档」 | **选**。尺寸差（140 圆环 vs 72 微表）+ 有无数字的差 + 语义差，三重区分；数字仍由 forecast 那句话承载（「若保持此速率：预计用到限额的 118%」）。微表不新增表盘语汇，只把一行纯文字变成「一句话 + 一个刻度」 |

**指针不做补间**：数据层零补间是项目的既有原则，而预测值每次刷新都跳到新位置，补间会让「它正往热区滑」成为一个假象。指针取 `--dur-state` 之外的**瞬时跳变**；唯一的过渡是色带本身的 `fill` 不参与动画。

四档阈值（写在模型层，界面不得自己算）：`projectedPct < 60` 安静 / `60 ≤ p < 85` 巡航 / `85 ≤ p < 100` 偏热 / `p ≥ 100` 烧穿。与 `HOT_BURN_SHARE_PER_HOUR`（速率达到限额 100%/h 才整行换 warning）**是两个不同的判据**，界面必须分别标注：前者是「窗口末的存量预测」，后者是「当前速率」。两者同时成立时，只让 forecast 行挂 warning 色一次，不叠加。

### D-6 D5 开发者海报：canvas → PNG，需要一条新的二进制写盘命令

**事实核对**（`web/src/api/types.ts`）：`FsBridge` 只有 `readText / readHead / writeText / stat / homeDir / appDataDir`；`DialogBridge` 有 `saveText / saveMarkdown / savePath / openFile`。**没有 `writeBinary`**，Rust 侧也只有 `fs_write_text`。所以 `canvas.toDataURL("image/png")` 拿到的 base64 在 JS 侧 `atob` 成 `Uint8Array` 之后**无处可写**。

三个方案：

| 方案 | 代价 | 体验 | 裁决 |
| --- | --- | --- | --- |
| A 新增 `write_binary` 命令 | Rust 侧 ~10 行 + 1 个单测；PR 里要写明「新增命令与理由」 | 真 PNG，双击能看 | **选** |
| B 写自解压 HTML（内嵌 base64 `<img>`） | 零后端 | 用户拿到一个 html，右键另存——不是海报 | 否 |
| C 写 base64 文本（`.txt`） | 零后端 | 文件根本打不开 | 否 |

**规格给的签名**（与主会话给的口径一致，只多一处编码说明）：

```rust
/// 与 `write_text` 同款路径处理：先 `create_dir_all(parent)` 再写。
/// `contents_base64` 是标准 base64（不带 data URL 前缀）。
#[tauri::command]
fn write_binary(path: String, contents_base64: String) -> Result<(), String> {
    use base64::Engine as _;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| io_error("创建目录失败", e))?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64.as_bytes())
        .map_err(|e| io_error("解码失败", e))?;
    std::fs::write(&path, bytes).map_err(|e| io_error("写入文件失败", e))
}
```

**为什么传 base64 而不是 `Vec<u8>`**：Tauri 2 的命令参数走 JSON，`Vec<u8>` 会被编码成十进制数组（每字节 1–3 个字符 + 逗号），一张 1080×1350 的 PNG 约 200–400KB，JSON 后膨胀到 3–4 倍；base64 只有 1.33 倍。如果要走真正的二进制（`InvokeBody::Raw`），前端得改用 `invoke` 传 `Uint8Array` 而绕开 `savePath + write` 两次往返的既有形态——收益不足以抵消偏离。

前端接口（加在 `FsBridge` 上，与 `writeText` 并排）：

```ts
writeBinary(path: string, contentsBase64: string): Promise<void>;
```

**零后端降级（必须实现）**：后端若未合并，导出按钮旁保留「导出为 SVG」——海报的同一份版式先画成 `<svg>` 文本，走既有 `saveText` 落盘。这不是备选装饰：它保证 D5 在没有 Rust 改动时**仍然可用**，且 SVG 里的中文是可选中文本、体积只有 PNG 的几十分之一。

### D-7 D7 会话甘特：按天刻度、12 行上限、并行用「虚线竖带 + ∥」

- **时间轴刻度按天**，不按小时：窗口是 7/30/90 天，小时级刻度在 90 天里会变成 2,160 条无从辨认的线。刻度取「窗口内每个周一的 00:00」；7 天窗口退化为「每天一条」；90 天窗口退化为「每月 1 日」——三种密度共用同一套取整函数，见 §3.7。
- **行上限 12**，超出部分由脚注承接（「另有 N 个会话未画出，按开始时间排在后面」）。不虚拟化：12 行 × 20px 是 240px，属于一屏内的块；虚拟滚动会让「上下相邻的并行会话」这个语义消失。
- **并行会话**：若 `B.start < A.end`（区间相交），两行在**相交区间**上各铺一条 `1px` 虚线竖带（`--text-tertiary`，4.78:1），并在行尾印 `∥`。相交是**事实**（两段墙钟重叠），不等于「同时在干活」——脚注必须写这句。

---

## 2 信息架构：插入后的顺序与高度账

### 2.1 插入后的 usage 档顺序（13 块）

| # | 块 | 形态 | 备注 |
| --- | --- | --- | --- |
| 1 | 计费卡 + **D6 微表** | 整行 | 只在 forecast 行内 +24px |
| 2 | KPI 四读数 + **D10 展开区** | 整行 | 折叠时 0，展开 +96px |
| 3 | 周战报 + **D9 峰值行** | 整行 | +16px |
| 4 | **D1 会话对比** | 整行 | 268px，插在首屏之后、`.board` 之前 |
| 5 | 每日 Token 消耗 ｜ 擂台 | 半宽 ×2 | 不动 |
| 6 | 项目卡片 | 整行 | 不动 |
| 7 | **D4 指纹雷达 ｜ D8 工作习惯** | 半宽 ×2 | 268px（行高 = 两块较高者） |
| 8 | 消耗日历 | 整行 | 不动 |
| 9 | **D7 会话甘特** | 整行 | 356px |
| 10 | 按模型分布（+ **D3 换模** tab） ｜ 流向图 | 半宽 + 整行 | 卡内 tab，0px |
| 11 | 活跃时段 ｜ 工具普查（+ **D2 健康** tab） | 半宽 + 整行 | 卡内 tab，0px |
| 12 | 压缩统计 | 整行 | 不动 |

为什么 D4/D8 插在项目卡片之后、日历之前：项目卡片回答「哪个项目值得看」，雷达与习惯回答「我这个人的形状」——从「项目」过渡到「人」，再落到「日历与甘特」这两个时间轴，是「横向叙事（项目）→ 纵向叙事（我）→ 时间」的自然顺序，与既有「量级主体 → 配置清单 → 现场」那条横线不打架。

为什么 D1 插在周战报之后：战报是「这周比上周」，对比是「这两个会话差多少」——都是**两个数之间的关系**，相邻阅读成本最低；而它必须整行（两栏并排），所以不能在 `.board` 里做。

### 2.2 高度账（1440×900）

内容区宽 = 1440 − 侧栏 300 = **1140**；页面 padding 12 ×2 → 页面内容宽 **1116**；`.board` 两列各 (1116 − 12) / 2 = **552**。

新增整行块的内部账（每块 = 表头 40 + 体内距 12 ×2 + 内容）：

| 块 | 内容算式 | 高 |
| --- | --- | --- |
| D1 | 12 + 28(选择器行) + 12 + 18(摘要行) + 12 + 106(两栏读数) + 12 + 16(脚注) + 12 | 40+240 = **268** |
| D4 | 12 + 176(雷达 176×176) + 12 + 16(脚注) + 12 | 40+228 = **268** |
| D8 | 12 + 168(2×2 宫格，格 78 + gap 12) + 12 + 16 + 12 | 40+220 = **260** |
| D7 | 12 + 20(刻度行) + 8 + 240(12 行 × 20) + 8 + 16(脚注) + 12 | 40+316 = **356** |

D4 与 D8 同行 → 该行高 = max(268, 256) = **268**。

**本轮对 usage 档总高的增量**：

```
D1 268 + (D4|D8) 268 + D7 356 + 新增块之间的 gap 3×12=36 + D6 24 + D9 16 = 968px
```

968 ≤ 900 的 1.08 倍 → **整页只多出约一屏**，且多出来的部分全部在首屏之下。若把 D5 也硬塞进 usage 档，增量会变成 1,348（+39%），这是我们拒绝的形态。

**既有页面总高本轮不重估**：它的权威数字只能来自真机（`data-probe="usage-page"` 的 `scrollHeight`），任何纸上估算都会与真实内容（53 列日历、N 行工具表）差出几十像素。规格只承诺**增量**，并要求实现者在 PR 里贴出实测 `scrollHeight`（见 §12 第 4 条）。

### 2.3 首屏预算（900px 视口，本轮前后不变）

| 首屏内 | 高度（既有） | 本轮变化 |
| --- | --- | --- |
| 页头（视图分段 + 区间 + 导出） | 28 + 12 | 不变 |
| 计费卡 | ~330 | **+24**（D6 微表） |
| KPI 行 | ~119 | 0（D10 折叠） |
| 周战报 | ~150 | **+16**（D9） |
| `.board` 第一行（每日 Token ｜ 擂台） | ~250 | 不变 |

首屏增加 40px，仍在 900 内；D1 从第 5 块开始，其表头会落在首屏底部**附近**——这是可接受的：读者在首屏看到的仍是「计费 → 读数 → 方向 → 趋势」，D1 的第一行只有 40px 露出，等于一个「下面还有」的提示。

### 2.4 960 窄窗（应用最窄档）账

内容区宽 = 960 − 300 = **660**；页面内容宽 **636**；`.board` 两列各 (636 − 12) / 2 = **312**。

| 块 | 960 下的账 |
| --- | --- |
| D1 两栏 | (636 − 24 − 12) / 2 = **300** / 栏，每栏 5 行读数仍单行不折（最长标签「缓存写入 tok」约 92px + 数值 96px） |
| D4 雷达 | **整行**（`@media (max-width: 1080px)`）→ 雷达 176 + 数值表 400+，不挤 |
| D8 宫格 | 同上整行 → 2×2 各 300 |
| D7 甘特 | 画布 = 636 − 24 − 168(行首标签列) − 12 = **432**；30 天 → 14.4px/天，条最小 2px 仍可见 |
| D6 微表 | forecast 行在 596 内宽里折行：微表 72 固定 + 文本可折，行高 40 → 56 |

结论：960 下无横向溢出；`@media (max-width: 1080px)` 让 D4/D8 各自整行，是**新增的唯一断点**（理由：既有 900px 断点晚于 960 这个最窄档，等于没做防护）。

---

## 3 逐功能版式与几何

统一约定（十块都适用）：
- 卡内一切走 `Panel`（表头 40 / 体内距 12），**不新造卡片画法**。
- 字号只用 `--fs-xs / --fs-sm / --fs-base / --fs-md / --fs-lg`，行高成对使用。
- 间距只用 `--sp-05 / --sp-1 / --sp-15 / --sp-2 / --sp-3 / --sp-4`；描边宽与图形尺寸写模块局部常量（`--sp-*` 不承载「形」）。
- 圆角只用 `--r-xs / --r-sm / --r-md`。
- 每块至少一个 `data-probe`（§9 汇总）。

### 3.1 D1 会话对比（整行，268px）

```
<Panel title="会话对比" ariaLabel="会话对比" actions={<span class=footHint>token 总量前两名</span>}>
  <div class=pickers>
    <label class=picker><span class=pickerLabel>会话 A</span><select class=select data-probe="compare-a">…</select></label>
    <span class=versus aria-hidden="true">对比</span>
    <label class=picker><span class=pickerLabel>会话 B</span><select class=select data-probe="compare-b">…</select></label>
  </div>
  <p class=summary data-probe="compare-summary">…一句差异…</p>
  <div class=pairs>
    <div class=side data-probe="compare-side-a">…5 行读数…</div>
    <div class=side data-probe="compare-side-b">…5 行读数…</div>
  </div>
  <p class=foot>…口径…</p>
</Panel>
```

| 元素 | 尺寸 / 样式 |
| --- | --- |
| `.pickers` | `display:flex; gap:var(--sp-2); align-items:center`，高 `var(--control-h)` 28 |
| `.select` | 原生 `<select>`：高 28、`padding: 0 var(--sp-2)`、`border:1px solid var(--border)`、`border-radius: var(--r-sm)`、`background: var(--bg-elevated)`、`color: var(--text)`、`font-size: var(--fs-sm)`；`max-width: 320px`，超出 `text-overflow: ellipsis` |
| `.pickerLabel` | `--fs-xs / --text-tertiary`，与 select 同一行（`gap: var(--sp-15)`） |
| `.versus` | `--fs-xs / --text-faint`，左右各 `var(--sp-1)` —— 装饰，`aria-hidden` |
| `.summary` | `--fs-sm / --lh-sm`、`--text-secondary`、`margin: 0` |
| `.pairs` | `display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--sp-3)` |
| `.side` | 5 行读数：每行 `display:grid; grid-template-columns: 96px minmax(0,1fr); align-items:baseline; height: 22px`（不用 `.kpi` 那种大瓦片：卡内已经有 4 个大数字了，这里要的是**对照**不是**主角**） |
| `.side` 行标签 | `--fs-xs / --text-tertiary` |
| `.side` 行值 | `--fs-sm / 600 / tabular-nums / --text`；差值列（第二栏右端）`--fs-xs`，正数 `--text-tertiary`、负数同色**不带红色**（差 20% 不是错误，用颜色会把它说成问题） |
| `.foot` | `--fs-xs / --lh-xs / --text-tertiary / margin:0` |

五行读数（两侧同序，便于横扫）：`消息` / `工具调用` / `错误` / `prompt tokens` / `output tokens`。**不印成本**：D3 就在隔壁，两处都印钱会让读者比较两个不同定价快照的读数。

`.summary` 的文案生成规则（纯逻辑层 `compareSessions(a, b)` 返回 `string`）：
- 差异最大的一维独占一句：「A 的消息数是 B 的 3.2 倍，output tokens 少 18%」；
- 两维并列时取序在前的（消息 → 工具 → 错误 → prompt → output）；
- 全部相差 <5% 时写「两个会话的五个读数相差都在 5% 以内」。

### 3.2 D2 工具健康（工具普查卡内第二 tab，0px）

`ToolCensusPanel` 的 `actions` 槽插入 `SegmentedControl`（`items: 调用次数 | 健康`，`ariaLabel="工具普查视图"`），默认 `调用次数`。

健康视图：

```
<div class=health data-probe="tool-health">
  <table class=table>
    <thead><tr><th>工具</th><th>调用</th><th>失败率</th><th>均值</th><th>p95</th></tr></thead>
    <tbody>…最多 6 行，来自 report.worst.slice(0,6)…</tbody>
  </table>
  <p class=foot>…口径…</p>
</div>
```

| 列 | 宽 | 内容 |
| --- | --- | --- |
| 工具 | `minmax(0,1fr)`，`--fs-sm / --text` | `censusKeyId` 的显示名（`builtin:Bash` → `Bash`） |
| 调用 | 64px，tabular | `calls` |
| 失败率 | 88px | `failureRate === null ? "样本不足" : "12.5%"`；`> 20%` 时文字 `--danger` + 行尾 `▲`（形状通道，不只靠颜色） |
| 均值 | 88px | `avgMs === null ? "—" : "1.2s"` |
| p95 | 88px | `p95Ms === null ? "—" : "4.8s"`；列头带 `title="最近 100 次观测"` |

行高 `var(--row-h)` = 30px；表头 `--fs-xs / --text-tertiary`，行分隔 `1px solid var(--border)`。960 下 `工具` 列收窄到 `minmax(0,1fr)`，四列固定 64+88+88+88 = 328，总 612 内不溢出。

### 3.3 D3 换模计价（按模型分布卡内第二 tab）

`actions` 槽插 `SegmentedControl`（`占比 | 换模`）。换模视图：

```
<table class=swap data-probe="model-swap">
  <thead><tr><th>计价族</th><th>同量 token 的成本</th><th>相对实际</th></tr></thead>
  <tbody>
    <tr class=actual><td>实际（按各会话模型）</td><td>¥/$ …</td><td>—</td></tr>
    <tr><td>全部按 opus</td><td>…</td><td>×2.4</td></tr>
    <tr><td>全部按 sonnet</td><td>…</td><td>×1.0</td></tr>
    <tr><td>全部按 haiku</td><td>…</td><td>×0.3</td></tr>
  </tbody>
</table>
<p class=foot>按定价快照 2026-10-01 折算，不是账单；未知价 token 未计入。</p>
```

- 三族的 token 用量 = `range` 的**四类计数器总量**（`totalsSum`），与 KPI 同一个数——「同样这些 token，换一种模型的价」。
- 倍数用 `×2.4` 而非 `+140%`：乘法口径与「换模」的直觉一致。
- 未知价：若 `cost.hasUnknown`，脚注加「其中 N tok 未计入」；若**全部**未知 → 整表退化为一句「本窗口没有可定价的调用，换模无从比较」（见 §6）。
- 行高 24，表头 16，4 行 = 112；与 `StackedBar`(30) + `modelLegend`(3 行 ≈ 66) 接近，故 **0 增量**成立（同一行的对侧是 `BarChart height=170`，行高由它决定）。

### 3.4 D4 指纹雷达（半宽，268px）

轴线与归一化（**必须写死在模型层 `fingerprint.ts`，界面不重算**）：

| 轴 | 取值 | 归一化（0–100，超过 100 记 100） | 依据 |
| --- | --- | --- | --- |
| 节奏 | `workHabits.peakHourShare` | `share * 100 / 0.30` | 峰值小时占 30% 消息即满格（一天 24 小时均匀分布时是 4.2%） |
| 深度 | 平均每会话 tokens | `avgTokens / 400_000 * 100` | 40 万 tok/会话是长程会话的量级 |
| 广度 | 不同项目数 | `projects / 6 * 100` | 6 个项目即满格 |
| 纪律 | `1 − 失败率` | `(1 − failureRate) * 100` | 失败率来自 `toolHealth`；无样本时该轴为 `null` |
| 续航 | `longestSessionMinutes` | `minutes / 240 * 100` | 4 小时是单会话的实战上限 |

SVG 几何（176×176，`viewBox="0 0 176 176"`）：

- 中心 `C = (88, 88)`，外半径 `R = 64`，5 轴角度 `θk = −90° + 72°·k`（k = 0..4），顶点坐标 `(88 + r·cosθk, 88 + r·sinθk)`。
- 网格：4 圈（r = 16 / 32 / 48 / 64），`stroke: var(--border)`，`stroke-width: 1`（结构线，不承担信息，不做 3:1 承诺）。
- 轴线：5 条 `--border`。
- 数据多边形：`fill: var(--accent-soft)`、`stroke: var(--accent)`、`stroke-width: 2`（**图形通道 6.62 / 7.72 / 9.52 / 8.97**，见 §4）。
- `null` 轴：该顶点画 **空心圆**（r = 3，`stroke: var(--text-tertiary)`，`fill: none`），多边形跳过该点并改画到 0（中心）——**不把 null 当 0 填充**，要让人看见「这一轴没有数据」。
- 右侧数值表（`<table>`，2 列 × 5 行，行高 20）：轴名 `--fs-xs/--text-tertiary`、值 `--fs-sm/600/tabular`，`null` 印 `—`。

**这张雷达不是「百分位」**：没有人群分布，五轴都是**绝对刻度**。所以卡内必须有那句脚注：「刻度是固定上限，不是百分位——满格=达到本刻度上限，不代表超过别人」。这句不写，雷达就会变成假比较。

### 3.5 D5 开发者海报（milestones 档尾，折叠 120 / 展开 380）

折叠态：

```
<Panel title="开发者海报" actions={<Button variant=secondary>预览</Button>}>
  <p class=hint>1080×1350 的竖版图：时段画像、四个数字、五轴刻度。数字全部取自里程碑档的同一份全历史统计。</p>
  <div class=buttons>
    <Button variant=primary data-probe="poster-export">导出 PNG</Button>
    <Button variant=ghost data-probe="poster-export-svg">导出 SVG</Button>
  </div>
</Panel>
```

展开态追加 `<div class=preview data-probe="poster-preview">`（208×260，`border:1px solid var(--border)`，`border-radius: var(--r-sm)`，内容为等比缩小的 `<canvas>` 或 `<svg>` 预览）。预览高 260 → 展开后整块 380 ≤ 400 上限。

**canvas 版式网格（1080×1350，全部 px）**：

| 区域 | y | 高度 | 内容 | 字号 |
| --- | --- | --- | --- | --- |
| 页边 | 96 | — | 四边内边距 96 | — |
| 眉题 | 96 | 28 | `CC ANALYZER` + `2026-10-27` | 28 / 500 |
| 主标题 | 148 | 64 | 「早鸟型 · 连击 12 天」 | 64 / 700 |
| 四数字（2×2） | 264 | 2×150 | Tokens 总量 / 会话数 / 最长会话 / 峰值小时 | 数字 88 / 700，标签 24 |
| 五轴条 | 600 | 5×64 = 320 | 五条横条（不是雷达：海报没有交互，横条更准） | 标签 24，条高 16 |
| 口径脚注 | 1180 | 3×28 | 窗口、定价快照、生成时间与版本 | 20 / `--text-tertiary` |

字体栈（**必须是系统字体，无网络**）：

```
system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
```

主题：**跟随当前主题**（浅 / 深），文件名带主题后缀；高对比度主题下海报按**普通浅色**绘制（对比度主题是为屏幕可读性调的，印成图会显得刺眼，且海报不是界面）。这条要写进按钮的 `title`：「按当前主题导出（高对比度按普通浅色导出）」。

文件名：`cc-analyzer-poster-2026-10-27-dark.png`（`savePath` 的 `defaultName`，`filterName: "PNG"`，`extensions: ["png"]`）。

导出链路（顺序固定，任一步失败就 `role="alert"` 就地报错，与「导出快照」同款）：

```
canvas(1080×1350) → toDataURL("image/png") → .split(",")[1] → atob → Uint8Array
→ bridges.dialog.savePath(name, {title:"导出开发者海报", filterName:"PNG", extensions:["png"]})
→ null 即取消（不提示）→ bridges.fs.writeBinary(path, base64) → notify("已导出海报", "success")
```

**隐私**：海报里不得出现项目路径、仓库名、会话 id、任何消息原文——只允许聚合量与「早鸟 / 夜猫」这类结论词。路径含用户名，一旦进图就等于把本机目录结构发出去。

### 3.6 D6 烧钱仪表（计费卡 forecast 行内，72×40，+24px）

```
<div class=forecast data-probe="forecast-row">
  <svg class=burnGauge viewBox="0 0 72 40" role="img" aria-label="…">
    <path class=track d="M 8 36 A 28 28 0 0 1 64 36" />
    <path class=bandQuiet  … /> <path class=bandCruise … /> <path class=bandWarm … />
    <line class=needle … />
  </svg>
  <p class=forecastText>若保持此速率：预计用到限额的 118% · 21:40 触顶</p>
</div>
```

几何（全部可复算）：

- `viewBox="0 0 72 40"`；半圆圆心 `C = (36, 36)`，半径 `R = 28`，`stroke-width = 6`，`fill: none`。
- 半圆总弧长 `L = πR = π×28 = 87.9646`。
- 轨道：`M 8 36 A 28 28 0 0 1 64 36`（左端 (8,36) → 上弧 → 右端 (64,36)）。
- 四档弧长（阈值取自 `projectedPct`）：安静 `0–60%` → `52.779`；巡航 `60–85%` → `21.991`；偏热 `85–100%` → `13.195`；烧穿 `≥100%` → 弧长为 0（超出部分没有刻度，用右端一个 6×6 的三角 + 端点红点表示「已经出表」）。
- 每段用独立 `<path>`：`stroke-dasharray = "{len} {L}"`，`stroke-dashoffset = "−{start}"`（起点 = 该档起点比例 × L）。**符号方向必须在真机目视确认一次**：dashoffset 的正负与路径方向相关，纸上算对不等于画对。
- 指针：`rad = (180 − 1.8 × clamp(p, 0, 100)) × π/180`；`x2 = 36 + 24·cos(rad)`，`y2 = 36 − 24·sin(rad)`；`stroke: var(--text)`、`stroke-width: 2`、`stroke-linecap: round`（针比弧带粗一档，才不会和色带混）。
- 档位文字：指针落档同时，在 `forecastText` 末尾加该档名（「· 偏热」），**颜色不是唯一编码**。

四档颜色映射（零新增，全部既有令牌）：安静 `--success`、巡航 `--chart-1`、偏热 `--warning`、烧穿 `--danger`。**没有 `--ok` 这个令牌**（主会话口径里的 `--ok` 落到 `--success`），规格里一律写真实令牌名。

`projectedPct ≥ 100` 且 `hitTime !== null` 时，整行再加 `--warning` 文字色并保留既有 `forecastHot` 行为（既有的热值判据是**速率**，两套判据分别标注，不合并）。

### 3.7 D7 会话甘特（整行，356px）

```
<Panel title="会话时间线" ariaLabel="会话时间线" actions={<span class=footHint>近 30 天 · 12 个会话</span>}>
  <div class=gantt data-probe="gantt">
    <div class=scale aria-hidden="true">…刻度标签…</div>
    <ul class=rows>
      <li class=row data-probe="gantt-row"><span class=rowLabel title="…">…</span>
          <span class=bar style="left:…%;width:…%"></span>
          <span class=parallel style="left:…%;width:…%"></span>
          <span class=rowTag>∥</span></li>
    </ul>
    <p class=foot>…口径…</p>
  </div>
</Panel>
```

几何：

- 画布宽 `W`：1440 → `1116 − 24 − 168 − 12 = 912`；960 → `636 − 24 − 168 − 12 = 432`。行首标签列 `168px`（`--fs-sm`，单行省略，`title` 给完整 id）。
- 横轴 = **窗口端点**，必须与 `aggregateRange` 同一份（`[now − N 天所在本地零点, now]`），不得自算第二份窗口。
- `x(t) = (t − start) / (end − start) × W`；条宽 `max(2, x(end) − x(start))`（最小可见宽 2px，与 `TimelineTrack` 的 `BLOCK_WIDTH_CAP` 同类取舍但**不设上限**——甘特允许满宽，因为它没有 24 条轨道要挤）。
- 行高 20，条高 8（`top: 6`），`border-radius: 0 var(--r-xs) var(--r-xs) 0`（与 `TimelineTrack` 同款圆角语汇），`background: var(--chart-1)`。
- 刻度：周一 00:00 的 `1px` 竖线 `--border` 贯穿行区；标签行（20px）只写 `M/D`；7 天窗口每天一条、30 天每周一条、90 天每月 1 日一条（同一个取整函数：`startOfWeek/Month` 逐步推进，密度随窗口自动变化）。
- 并行：`B.start < A.end` 的区间用 `<span class=parallel>` 画 `1px dashed var(--text-tertiary)`（4.78:1）竖带，`left` 取相交段起止。
- 行序：开始时间升序；超过 12 行截断，脚注写「另有 N 个会话未画出」。
- 行可点：整行是 `<button>`（既有全宽控件画法，焦点环 `outline-offset: var(--focus-ring-inset)`），点击调用既有的 `onOpenSession`——**复用**，不新开跳转。

### 3.8 D8 工作习惯（半宽，260px）

```
<div class=habits data-probe="work-habits">
  <div class=cell><span class=cellLabel>昼夜型</span><span class=cellValue>早鸟</span><span class=cellNote>上午 37% · 晚间 12%</span></div>
  <div class=cell><span class=cellLabel>连击</span><span class=cellValue>12 天</span><span class=cellNote>最长 31 天</span></div>
  <div class=cell><span class=cellLabel>最长会话</span><span class=cellValue>3 小时 8 分</span><span class=cellNote>首末记录间隔</span></div>
  <div class=cell><span class=cellLabel>峰值小时</span><span class=cellValue>15:00</span><span class=cellNote>占全部消息 18%</span></div>
</div>
```

- 宫格：`display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--sp-3)`；每格 `padding: var(--sp-2); border:1px solid var(--border); border-radius: var(--r-sm)`。
- 格内三行：标签 `--fs-xs/--text-tertiary`(16) → 值 `--fs-md/600/--text`(22) → 注 `--fs-xs/--text-tertiary`(16)，格高 `8+16+4+22+4+16+8 = 78`（取 76 记账，差 2px 由 em 行高吸收）。
- 与 D4 同排，故 `对侧` 高度由 268 决定，本块 256 底部留 12px 空白——**这是允许的**（比拉伸宫格好）。
- 文案来源严格是 `WorkHabits` 六字段：`chronoType` 直接作为值；`currentStreak`/`longestStreak` 组成连击格；`longestSessionMinutes` 格式化 `X 小时 Y 分`；`peakHour` + `peakHourShare`。**没有第七格**。

### 3.9 D9 峰值时刻（周战报内一行，+16px）

```
<p class=peak data-probe="peak-minute">
  <span class=peakLabel>峰值时刻</span>
  <span class=peakValue>10-24 15:00</span>
  <span class=peakNote>8,412 tok · 次高 7,905 tok（10-22 11:00）</span>
</p>
```

- 一行 `--fs-xs`/`--fs-sm` 混排，高 16；放在 `WeeklyDigestPanel` 四行读数之后、脚注之前。
- `minuteStart === null`（窗口内没有任何 token）→ **整行不渲染**（不印「—」，不印 0）。
- `runnerUp === null`（只有一分钟有消耗）→ 注只写「窗口内只有这 1 分钟有消耗」，不编造次高。
- 时间用本地 `MM-DD HH:mm`（与日历、周战报同一格式函数）。

### 3.10 D10 token 等价物（KPI 脚注展开区，折叠 0 / 展开 96）

KPI 脚注末尾加一个 `<button class=expand type=button aria-expanded aria-controls>`：「换算成日常事物 ▾」。

展开后追加 `<ul class=equivalents data-probe="equivalents">`，四条（来自 `EQUIVALENTS`，顺序照常量）：

```
<li><span class=eqValue>1,666</span><span class=eqLabel>杯咖啡</span><span class=eqNote>按一次深度推理≈150 万 token 估</span></li>
```

- 每条 `display:grid; grid-template-columns: 88px minmax(0,1fr); height: 24`；数值 tabular 600，标签 `--fs-sm/--text-secondary`，依据 `--fs-xs/--text-tertiary`（**每条都必须显示 `note`**：裸数字就是编造）。
- **`count === 0` 的条目也显示**，写「不足 1 杯咖啡」——把 0 藏起来会让人以为只算了三条。
- `tokens === 0` → 整块不展开，按钮改为 disabled + `title="本窗口没有 token 可换算"`。

---

## 4 颜色与令牌：零新增

### 4.1 全部映射到既有令牌

| 用途 | 令牌 | 说明 |
| --- | --- | --- |
| 卡片面 / 边框 / 圆角 | `--bg-subtle` / `--border` / `--r-md` | 全部走 `Panel`，不自己画 |
| 主体数值 | `--text` | |
| 摘要 / 会话名 / 行值 | `--text-secondary` | |
| 标签 / 脚注 / 刻度文字 | `--text-tertiary` | 面板内 4.78:1（浅色），达标 |
| 错误文字 / 失败率超阈 | `--danger` | 只在**确定错误**上用 |
| 「定价未知」「样本不足」 | `--warning` | 语义是「非确定信息」，与既有约定一致 |
| D6 四档色带 | `--success` / `--chart-1` / `--warning` / `--danger` | 见 4.2 |
| D7 甘特条 / D4 多边形填充 | `--chart-1` / `--accent-soft` | 数据墨；大面填充只用 `-soft` |
| D4 多边形描边 / D1 对比高亮 | `--accent` | |
| D7 并行虚线 / 刻度竖线 | `--text-tertiary` / `--border` | |
| 焦点环 | `--focus-ring-width / -offset / -inset` + `--accent` | 与全站同一套 |

**新增设计令牌：0 个。** 主会话口径里提到的 `--ok` 在 `tokens.css` 里**不存在**（`grep --ok` 无结果），规格统一落到 `--success`；若实现者按 `--ok` 写，会得到一个未定义变量 → 色带整段变黑。

### 4.2 对比度实测（本轮新增的每个前景/底组合）

公式：WCAG 2.1 相对亮度 `L = 0.2126R + 0.7152G + 0.0722B`（sRGB 先做 `c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`），对比度 `(Lmax + 0.05) / (Lmin + 0.05)`；`rgba(...)` 先按 alpha 合成到背景再算。

| 前景 | 底 | 浅色 | 深色 | HC 浅 | HC 深 | 门槛 | 判定 | 用途 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--success` | `--bg-subtle` | 5.32 | 8.18 | 8.32 | 12.13 | 3:1 | 过 | D6 安静档 |
| `--chart-1` | `--bg-subtle` | 5.64 | 8.39 | 7.82 | 8.90 | 3:1 | 过 | D6 巡航档 / D7 甘特条 |
| `--warning` | `--bg-subtle` | 5.24 | 8.17 | 7.13 | 12.12 | 3:1 | 过 | D6 偏热档 |
| `--danger` | `--bg-subtle` | 6.54 | 6.52 | 8.06 | 9.37 | 3:1 | 过 | D6 烧穿档 / D2 失败率条 |
| `--accent` | `--bg-subtle` | 6.62 | 7.72 | 9.52 | 8.97 | 3:1 | 过 | D4 雷达描边 / D1 高亮 |
| `--text-tertiary` | `--bg-subtle` | 4.78 | 5.83 | 10.45 | 10.74 | 3:1 | 过 | D7 并行虚线 / 刻度线 |
| `--border-strong` | `--bg-subtle` | **1.47** | **1.52** | 9.27 | 6.99 | 3:1 | **✗** | 被否：不能当图形线 |
| `--text` | `--bg-subtle` | 17.79 | 16.15 | 21.00 | 18.73 | 4.5:1 | 过 | 主体数值 |
| `--text-secondary` | `--bg-subtle` | 7.87 | 9.44 | 14.34 | 13.66 | 4.5:1 | 过 | 摘要 / 会话名 |
| `--text-tertiary` | `--bg-subtle` | 4.78 | 5.83 | 10.45 | 10.74 | 4.5:1 | 过 | 标签 / 脚注 |
| `--text-tertiary` | `--bg` | **4.38** | 6.18 | 10.45 | 12.04 | 4.5:1 | **✗ 浅色** | 页底无卡底色时禁用 |
| `--danger` | `--bg-subtle` | 6.54 | 6.52 | 8.06 | 9.37 | 4.5:1 | 过 | 错误文字 |
| `--warning` | `--bg-subtle` | 5.24 | 8.17 | 7.13 | 12.12 | 4.5:1 | 过 | 「定价未知」文字 |

**最低实测值：4.38:1**（`--text-tertiary` 叠在 `--bg` 上，浅色）——它出现在「页底无卡底色」的组合里，因此本轮所有新增文字**一律住在面板内**（`.page` 的 gap 里不新增任何游离文字）。规范内的最低值是 **4.78:1**（面板内的 `--text-tertiary`）。

`--border-strong` 的 1.47 / 1.52 是一处**必须避开的陷阱**：它看起来像「网格线」，但在浅色与深色下都只有 1.5 左右，画雷达网格或甘特刻度会让线在低质量屏幕上直接消失。结构线一律用 `--border`，承载信息的线一律用 `--text-tertiary`。

### 4.3 颜色不是唯一编码（每块都给了第二通道）

| 功能 | 颜色通道 | 第二通道（形状 / 文字） |
| --- | --- | --- |
| D6 | 四档色带 | 档名文字（安静 / 巡航 / 偏热 / 烧穿）+ 指针位置 + 烧穿档的溢出三角 |
| D2 | 失败率 `--danger` | 行尾 `▲` + 数值本身 + 「样本不足」文字 |
| D7 | 甘特条 `--chart-1` | 条的位置与长度（几何）+ 行首标签 + `∥` 标记 |
| D4 | 多边形 `--accent` | 顶点圆点 + 右侧数值表（同一份数字的文字版） |
| D3 | 无颜色语义 | 只有数字与倍数 |
| D1 | 无颜色语义 | 只有数字（差值不染红，见 §3.1） |

---

## 5 动效

| 场景 | 时长 / 缓动 | 说明 |
| --- | --- | --- |
| D6 指针跳到新位置 | **无补间**（0ms） | 预测值每次刷新都是新数，补间会伪造「正在滑动」的过程 |
| D6 色带 fill | 无过渡 | 同上；档位变化是离散事实 |
| D1 切换两个 select | 无过渡 | 内容整体替换，任何淡入都会让「刚才那个数」与「现在这个数」混淆 |
| D7 悬停行 | `var(--dur-hover)` 80ms + `--ease-out` | 与全站行悬停同款 |
| D5 预览展开 | 不做高度动画（直接展开） | 高度动画会与「折叠省高度」的初衷打架，且 130% 字号下容易裁切 |
| D10 展开区 | 不做高度动画 | 同上 |

`prefers-reduced-motion: reduce`：以上唯一有时长的（行悬停）由全局规则归零；本轮**不新增任何过渡**，所以 reduced-motion 下的行为与默认一致（这是最省事的合规方式：不新增动效就没有新增的动效债）。

**动效不能影响读数正确性**：本轮的动画全部是表现层且为零时长。D6 的 `projectedPct`、D9 的 `tokens`、D10 的 `count` 都直接来自模型层函数，界面不做任何四舍五入之外的加工，与模型逐位一致。

---

## 6 状态矩阵（逐格给文案原文）

| # | 态 | 触发 | 视觉 | 文案（原文） |
| --- | --- | --- | --- | --- |
| D1 | 空 | 窗口内 0 个会话 | 卡**不渲染** | —（页面本身已是空态舞台） |
| D1 | 单会话 | 窗口内 1 个会话 | 卡渲染，两个 select 隐藏 | 「本窗口只有 1 个会话，没有对手可比」 |
| D1 | 正常 | ≥2 个会话 | 两个 select + 摘要 + 两栏 | 摘要由 `compareSessions` 生成 |
| D1 | 无 token 读数 | 两个会话都是 0 token | 两栏末两行印 `—` | 「这两个会话没有 token 读数」 |
| D2 | 空 | 窗口内无工具调用 | tab 内容替换 | 「本窗口没有工具调用记录」 |
| D2 | 样本不足 | `calls < 3` | 该行失败率位印灰字 | 「样本不足（2 次）」 |
| D2 | 无耗时 | 全部 tool_use 未配对 | 均值/p95 列印 `—` | 脚注：「未配对的调用不参与耗时统计」 |
| D2 | 全健康 | 无失败 | 正常表格 | 脚注：「本窗口没有失败调用」 |
| D3 | 正常 | 有可定价调用 | 4 行表 | — |
| D3 | 定价未知 | 部分模型未知价 | 脚注追加 | 「其中 12,400 tok 未计入」 |
| D3 | 全部未知 | `cost.knownUsd === 0` | 表退化为一句 | 「本窗口没有可定价的调用，换模无从比较」 |
| D4 | 轴不足 | 某轴为 `null` | 该顶点空心圆 + 表内 `—` | 脚注：「标 — 的轴没有足够样本」 |
| D4 | 全空 | 窗口内无会话 | 卡不渲染 | — |
| D5 | 空 | 全历史 0 会话 | 导出按钮 disabled | 「还没有可做海报的数据」 |
| D5 | 正常 | 有数据 | 折叠态 | 见 §3.5 |
| D5 | 后端缺命令 | `fs.writeBinary` 不存在 | PNG 按钮 disabled | 「当前版本不支持导出 PNG（缺少二进制写入），可用 SVG」 |
| D6 | 无分母 | 未选计划（`planLimitTokens === null`） | 微表**不渲染**，forecast 行保持现状 | 既有：「未设定计划限额」 |
| D6 | 窗口刚开 | `burnPerHour === 0` 且用量 0 | 微表只画轨道，指针在左端 | 「窗口刚开始，还没有可外推的速率」 |
| D6 | 正常 | 有速率 | 微表 + 指针 + 档名 | 「若保持此速率：预计用到限额的 118%」 |
| D6 | 烧穿 | `projectedPct ≥ 100` | 右端溢出三角 + `--danger` 档名 | 「…预计用到限额的 118% · 触顶 21:40 · 烧穿」 |
| D7 | 空 | 窗口内 0 会话 | 卡不渲染 | — |
| D7 | 单会话 | 1 个会话 | 1 行，无并行标记 | 脚注：「本窗口只有 1 个会话」 |
| D7 | 溢出 | >12 会话 | 12 行 | 「另有 7 个会话未画出，按开始时间排在后面」 |
| D7 | 零跨度 | 所有会话同一时刻 | 每条 2px 短桩 | 脚注：「这些会话的时间区间重合，条长按最小可见宽度画」 |
| D8 | 空 | 无消息 | 卡不渲染 | — |
| D8 | 连击为 0 | 今天与昨天都没有活动 | 连击格值印 `0 天` | 注：「今天和昨天都没有记录」 |
| D8 | 无峰值小时 | `peakHour === null` | 峰值格值印 `—` | 注：「本窗口没有消息」 |
| D9 | 空 | `minuteStart === null` | 整行不渲染 | — |
| D9 | 单分钟 | `runnerUp === null` | 注只剩一句 | 「窗口内只有这 1 分钟有消耗」 |
| D10 | 零 token | `tokens === 0` | 按钮 disabled | 「本窗口没有 token 可换算」 |
| D10 | 折叠 | 默认 | 一行按钮 | 「换算成日常事物 ▾」 |
| D10 | 展开 | 点击 | 4 行 | 每行带 `note` |
| 全局 | 扫描中 | `scanning && progress.total === 0` | 既有整页舞台 | 既有：「正在扫描会话列表…」 |
| 全局 | 读取失败 | `error !== null` | 既有整页 `ErrorState` | 既有：「会话列表读取失败」 |
| 全局 | 部分跳过 | `skipped > 0` | 页头进度行 | 既有：「· N 个会话读取失败已跳过」 |

**诚实性总则（十块共用）**：`null` 一律印 `—` 或整块消失，**绝不印 0**；「样本不足」与「定价未知」用 `--warning` 而不是 `--danger`（前者是信息缺失，后者是确定错误）；任何百分比都必须能追到分母（`limitForecast` 的 `null` 返回就是这条规则的执行处）。

---

## 7 无障碍

| 元素 | 语义 | 键盘 | 备注 |
| --- | --- | --- | --- |
| D1 两个 select | 原生 `<select>` + `<label>` 关联 | 原生（Tab / 方向键 / 首字母） | 焦点环走全局 `:focus-visible` |
| D2 / D3 tab | `SegmentedControl`（`role="tablist"`，roving tabindex） | 方向键移动并自动激活 | 与全站六处调用点一致 |
| D2 表格 | 原生 `<table>` + `<th scope="col">` | — | 失败率列头带 `title` 说明样本窗口 |
| D4 雷达 | `<svg role="img" aria-label="五轴画像：节奏 62、深度 41、广度 83、纪律 96、续航 38">` | — | `aria-label` 里**带数值**，屏幕阅读器不必依赖右侧表；右侧 `<table>` 是可见的等价物，`aria-hidden="false"` |
| D5 预览 | `<canvas role="img" aria-label="开发者海报预览：早鸟型，连击 12 天…">` | 按钮可 Tab | 海报是图像，`aria-label` 复述四数字 |
| D6 微表 | `<svg role="img" aria-label="限额预测：预计用到 118%，已超过限额，触顶 21:40">` | — | **不用 `role="meter"`**：meter 的语义是「当前值在已知范围内的位置」，而这里画的是**预测**，且 `aria-valuenow` 会要求一个「现在」的值——错误的语义比没有语义更糟 |
| D7 甘特 | 每行 `<button>`（整行可点），容器 `<ul>` + `<li>` | Tab 逐行，Enter 打开会话 | 行的可访问名 = 行首标签 + 起止时间；`∥` 与虚线 `aria-hidden`，由行内文字「与其他会话重叠」承担语义 |
| D9 峰值行 | `<p>`（纯读数） | — | 不是控件 |
| D10 展开 | `<button aria-expanded aria-controls>` | Enter / Space | 展开区 `id` 与 `aria-controls` 对应 |

- Tab 顺序 = DOM 顺序 = 视觉顺序；D1 的两个 select 在页面上相邻，DOM 也相邻（不靠 `order` 制造不一致）。
- 焦点环：常规控件 `outline: var(--focus-ring-width) solid var(--accent); outline-offset: var(--focus-ring-offset)`；全宽行（D7）与整行按钮用 `var(--focus-ring-inset)`（正偏移会被行的 `overflow: hidden` 裁掉——与既有 `LogView` / `TimelineTrack` 同一处理）。**不得写 `2px` 字面量**：`focusRing.test.ts` 有双向守卫，加一条字面量会红。
- `aria-live`：本轮**不需要**新的 live region。所有新增块都是「用户主动操作后原地变化」，读屏焦点本来就在控件上；D5 的导出结果走既有 toast（`notify`）+ 就地 `role="alert"`，与「导出快照」一致。

---

## 8 960px 窄窗与 130% 字号

| 检查项 | 结论 |
| --- | --- |
| 横向溢出 | D1 两栏各 300（960）不折；D2 表 612 内 4 列固定 328 + 伸缩列；D3 表 612 内三列 200/200/200；D7 画布 432、条最小 2px；D6 72px 固定 + 文本可折。**均无横向滚动** |
| 130% 字号 | 所有宽度用 `minmax(0,1fr)` + `text-overflow: ellipsis`；行高成对缩放，因此行高从 30 → 39（`--row-h` 由 `--lh-sm` 推导，自动跟随）；D7 刻度标签在 130% 下改为「只画线不写字」（`aria-hidden` 的装饰标签可省） |
| 断点 | 新增 `@media (max-width: 1080px)` 一处：D4/D8 由半宽变整行。理由见 §2.4 |
| 长串 | 会话 id / 项目名一律 `title` + 省略号；D5 海报里的项目名**不出现**（隐私），所以不存在长串问题 |

**130% 下的高度重算**：`--row-h = 2×6 + 18×1.3 = 35.4`，脚注行高 16×1.3 ≈ 21，刻度行 20×1.3 = 26。D7 若仍画 12 行：`40 + 12 + 26 + 8 + 12×35.4(=424.8) + 8 + 21 + 12 = 551.8`，**破 400 上限 38%**。降到 9 行：`40 + 12 + 26 + 8 + 318.6 + 8 + 21 + 12 = 445.6`，**仍破**。降到 7 行：`40 + 12 + 26 + 8 + 247.8 + 8 + 21 + 12 = 374.8` ✓。→ **裁决**：`rowLimit = fontScale > 1.2 ? 7 : 12`，脚注同步为「另有 N 个会话未画出」。这条必须写进实现，并且要在 130% 截图上复核行数确实是 7。

---

## 9 data-probe 锚点清单

| 锚点 | 所在 | 供谁用 |
| --- | --- | --- |
| `data-probe="usage-page"` | `.page` 根（新增） | 真机取 `scrollHeight`，验证增量 |
| `data-probe="compare-a"` / `"-b"` | D1 两个 select | e2e 切换会话 |
| `data-probe="compare-summary"` | D1 摘要句 | e2e 断言文案随选择变化 |
| `data-probe="tool-health"` | D2 健康视图根 | e2e 切 tab 后定位 |
| `data-probe="model-swap"` | D3 换模表 | e2e 断言倍数 |
| `data-probe="fingerprint"` | D4 雷达 svg | 几何探针（宽高 176×176） |
| `data-probe="poster-preview"` | D5 预览 | 展开态断言 |
| `data-probe="poster-export"` | D5 PNG 按钮 | e2e 断言 disabled/可用 |
| `data-probe="forecast-row"` | D6 行（**已存在**，复用不新建） | 既有真机基线 |
| `data-probe="burn-gauge"` | D6 微表 svg | 几何探针（72×40） |
| `data-probe="gantt"` | D7 容器 | 几何探针 |
| `data-probe="gantt-row"` | D7 每行 | 行数与并行断言 |
| `data-probe="work-habits"` | D8 宫格 | e2e 四格 |
| `data-probe="peak-minute"` | D9 行 | 空态断言（不存在 = 未渲染） |
| `data-probe="equivalents"` | D10 展开区 | 展开断言 |

`data-probe` 只给**稳定结构**挂，不给随文案变化的节点挂（`aria-label` 会随读数变，靠它匹配会在文案改动后静默失配——`Gauge.tsx` 的注释里已经踩过）。

---

## 10 明确不做

1. **不做「你比多少人强」的百分位雷达**：没有人群分布数据，做出来就是编的。
2. **不做第二个表盘**：D6 是行内微表，不与 `Gauge` 圆环并肩。
3. **不做甘特的拖拽缩放 / 时间窗选择**：窗口由页头的 7/30/90 决定，面板内再加一个窗口控件就是两套真相。
4. **不做海报的模板市场 / 多配色**：一张图、跟随主题，够用。
5. **不做 D5 的 PNG 预览热区点击放大**（先把导出跑通）。
6. **不给 D1 做「超过两个会话的对比」**：三栏并排在 960 下必然溢出。
7. **不新开档位**：不新增第 4 个 `UsageView` 值。
8. **不改 `.board` 的列数**：两列是既有语言，D4/D8 靠整行断点解决。
9. **不在 D3 里印成本曲线**：定价快照只有一个时间点，画曲线就是伪造历史。
10. **不给 D2 加「工具趋势」**：`ToolCensusPanel` 已经是窗口化的，趋势需要跨窗口历史，属于另一个功能。

---

## 11 实现者清单与复核清单

### 11.1 实现顺序（每一步都能独立验收）

1. `UsageOverviewPage.tsx` 只加**挂载点**与 slice 的空壳（不含内部实现），确认既有 12 块像素级不变、既有 e2e 全绿。
2. D6（最小、最独立）：`BurnGauge` 组件 + 分档常量 + forecast 行改造；跑 `forecast-row` 相关断言。
3. D9 + D10 + D3 + D2（四个「卡内 / 行内」小改），每个都要证明「对侧/邻居的高度没变」。
4. D1（新整行）+ `compareSessions` 纯函数 + 单测。
5. D4 + D8（同一行两块）+ `fingerprint.ts` 纯函数（五轴归一化必须有单测，边界值 0/100/超限）。
6. D7（最复杂：窗口端点复用、并行判定、行数上限、130% 降行数）。
7. D5（最后做，因为要 Rust 侧配合）：先落地 SVG 导出（零后端），PNG 等 `write_binary` 合并后接上。
8. 四个既有模型层（toolHealth / workHabits / peakMinute / tokenEquivalents）**一行都不改**——它们已有单测。

### 11.2 复核清单（评审时逐条打勾）

- [ ] 新增设计令牌数 = 0（`git diff web/src/styles/tokens.css` 为空）
- [ ] 新增颜色字面量 = 0（`grep -n "#[0-9a-fA-F]\{6\}" web/src/features/usage/*.module.css` 无新条目）
- [ ] 新增间距字面量 = 0（`padding/margin/gap` 只出现 `var(--sp-*)`）
- [ ] `focusRing.test.ts` 的计数按实数更新（新增控件各 +1 条 outline 规则；不得写字面量 `2px`）
- [ ] 1440×900：`data-probe="usage-page"` 的 `scrollHeight` 增量 ≈ 968 ± 40，且**首屏五块未下移**
- [ ] 960×640：无横向滚动（`document.documentElement.scrollWidth === clientWidth`）
- [ ] 字号 130%：D7 行数上限自动降到 9，整块仍 ≤ 400
- [ ] 三主题截图：每块在 light / dark / HC 下都不靠颜色单独传信息（对照 §4.3）
- [ ] 空态矩阵逐格对拍：`null` 处印 `—` 或整块消失，**全文搜不到把 null 印成 0 的路径**
- [ ] `--ok` 在仓库里 0 次出现（本轮新代码）
- [ ] D5 海报里搜不到项目路径 / 用户名 / 会话 id
- [ ] `write_binary` 的单测覆盖：正常写、目录不存在时自动创建、base64 非法时报错

### 11.3 已裁决：D5 走 A 方案（PNG 真导出）

**裁决（主会话，2026-10-27）**：

1. `write_binary` 由 **D5 界面实现者一并落**（`src-tauri/src/lib.rs` 命令 + `web/src/api/{types,tauri}.ts` 桥接 + Rust 单测），设计侧不碰 `src-tauri/`；
2. 参数走 **base64**（`contents_base64: String`），不用 `Vec<u8>`——理由见 §3.5 的编码成本账；
3. **降级路径保留但不做成死按钮**：后端缺命令时 PNG 按钮 `disabled`，并在按钮旁一行 `--fs-xs` / `--text-tertiary` 写「此构建没有写二进制能力，请用 SVG」；**不允许**出现点了会报错的按钮，也不允许把按钮藏掉而不解释。零后端降级仍是 **SVG 文本**（§3.5），不是自解压 HTML、不是 `.txt`。

实现时按上面三条落地即可，无需再回来确认；PR 里要写明「新增一个 Tauri 命令 + 理由」。

---

## 12 附：对比度复现脚本

```js
// node dd-contrast.mjs（仓库根目录运行）
import { readFileSync } from "node:fs";
const css = readFileSync("web/src/styles/tokens.css", "utf8");
const blocks = [
  ["light", /:root \{([\s\S]*?)\n\}/],
  ["dark", /\[data-theme="dark"\] \{([\s\S]*?)\n\}/],
  ["hc-light", /\[data-contrast="high"\] \{([\s\S]*?)\n\}/],
  ["hc-dark", /\[data-theme="dark"\]\[data-contrast="high"\] \{([\s\S]*?)\n\}/]
];
const parse = (b) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const base = parse(css.match(blocks[0][1])[1]);
const themes = Object.fromEntries(blocks.map(([n, re]) => [n, { ...base, ...parse(css.match(re)[1]) }]));
const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const over = (fg, bg) => { const m = fg.match(/rgba?\(([^)]+)\)/); if (!m) return hex(fg);
  const p = m[1].split(",").map(Number); const a = p[3] ?? 1;
  return p.slice(0, 3).map((c, i) => Math.round(c * a + bg[i] * (1 - a))); };
const lum = (rgb) => rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
  .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const L1 = Math.max(lum(a), lum(b)), L2 = Math.min(lum(a), lum(b)); return (L1 + 0.05) / (L2 + 0.05); };
const pair = (t, fg, bg) => { const v = themes[t]; const b = over(v[bg], [255, 255, 255]); return ratio(over(v[fg], b), b); };
for (const t of Object.keys(themes)) console.log(t, "success", pair(t, "success", "bg-subtle").toFixed(2),
  "chart-1", pair(t, "chart-1", "bg-subtle").toFixed(2), "border-strong", pair(t, "border-strong", "bg-subtle").toFixed(2),
  "text-tertiary/bg", pair(t, "text-tertiary", "bg").toFixed(2));
```

期望输出（与 §4.2 表逐位一致）：

```
light success 5.32 chart-1 5.64 border-strong 1.47 text-tertiary/bg 4.38
dark success 8.18 chart-1 8.39 border-strong 1.52 text-tertiary/bg 6.18
hc-light success 8.32 chart-1 7.82 border-strong 9.27 text-tertiary/bg 10.45
hc-dark success 12.13 chart-1 8.90 border-strong 6.99 text-tertiary/bg 12.04
```

---

## 13 验收后记（2026-10-27，主会话裁决记录）

实现与 e2e 交付后，以下偏离被主会话接受，本文档相应段落以实现为准：

1. **§3.4 D4 五轴绝对刻度 → 六轴相对归一**（projectRadar 实际形状）：六轴
   tokenIntensity/messageDensity/errorRate/toolDiversity/contextDepth/persistence，
   peers min/max 归一，脚注写「相对位置归一，不是人群百分位」。
2. **§3.7 D7 标题「会话时间线」→「会话甘特」**；横轴取会话实际区间
   （spanStart/spanEnd）而非窗口端点。
3. **§3.3 D3 按「源模型」分行**、每行给三族折算；未知价整行 —（sumOrNull），
   脚注「其中 N 条记录没有可用的定价」。
4. **§3.5 D5 海报字段按 PosterStats 实有聚合数**（已读 token/消息/天数/最忙
   一小时 + 主力模型），文件名带 -light/-dark 后缀。
5. **§3.6 D6 单弧档色 + 档名文字**，不画四色带（指针 projectedPct 与色带
   burnPerHour 两个判据不同轴，四色带会暗示同轴）。
6. **§2.3 首屏账**：三整行把「按项目分布」推出 1440×900 首屏，e2e 首屏口径
   改为「main 内一屏滚动可达」。
7. **§3.2 D2 工具名去 kind 前缀**，全量键留 title。

focusRing 实测计数 42/23/16/46（预期 41 与实际差 1，以实测为准）。
