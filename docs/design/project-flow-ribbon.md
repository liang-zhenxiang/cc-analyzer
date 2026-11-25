# 项目流量河流图（Issue #388）· UI/UX 设计规格

**一句话定位**：最多七条互不堆叠的河道共用同一条时间轴与同一个 y 刻度，回答「这段时间里，用量在项目之间怎么流动」——主力项目什么时候换的、旧项目是退潮还是断流、新项目是爆发还是涓流。

作者：liangzhenxiang。日期：2026-11-24。本文只写视觉与交互规格，不含实现代码。所有尺寸以 **CSS px** 为单位；颜色以令牌名为准，文中出现的十六进制只是当前取值的参考，不复制进组件。

---

## 0 先对齐事实与口径

### 0.1 已核对的事实

| 事实 | 值 / 出处 |
| --- | --- |
| 卡片原语 | 表头 `min-height: 40px`、体内距 `var(--sp-3)`=12、`--r-md`、发丝边框、无阴影（`web/src/components/Panel.module.css`） |
| 实验室栅格 | 12 列、`gap: var(--sp-3)`、`align-items: start`、卡高由内容决定（`LabView.module.css:51-56`） |
| 断点 | `≤1080px` 所有卡塌成整行（`LabView.module.css:130`）；不为本卡另造断点 |
| 窗口口径 | 最近 N 个本地自然日（含今天），`labWindow(days, now)`；日键是本地零点（`constellation.ts`、`usageAggregations.ts:146-156`） |
| 日序列 | 必须用 `addLocalDays(dayStart, 1)` 逐日推进，不能用 `+86_400_000`（DST 会错位） |
| token 口径 | 输入 + 输出 + 缓存写入 + 缓存读取四类之和（`totalsSum`，与页面 KPI 同口径） |
| 图表色板 | `--chart-1..6` 与 `-soft`；**严禁与 `--cat-*` 互借**；大面积填充只允许 `-soft`，实色只给描边、点、小徽标（`tokens.css:74-99`） |
| `-soft` 浓度 | 浅色 alpha 0.24、深色 0.30；在面板底上的对比度浅色 1.32–1.41、深色 1.78–2.05；高对比度档变成不透明浅色（`tokens.css:83-87, 330, 497-508, 570-581`） |
| 图表图元 | `niceAxisMax` / `formatAxisValue` / `tickText` / `numeric`（`charts/chartPrimitives.tsx`、`.module.css`） |
| 测量宽度 | 树图用 `ResizeObserver` 量容器宽度、`viewBox` 与 CSS 像素 1:1；无 `ResizeObserver` 时挂载量一次（`CostTreemapPanel.tsx:587-600`） |
| 浮层定位 | 先量后定位、右/下边缘翻转、portal 到 `document.body`、`position: fixed`（`CostTreemapPanel.tsx:463-527`） |
| 焦点环 | 颜色只有 `--ring` / `--accent`，宽度/偏移走 `--focus-ring-*`；高对比度自动 3px（`tokens.css:125-133, 518-521`） |
| 最小窗口 | 960 × 640（`src-tauri/tauri.conf.json`） |
| 字号档 | 90%–130%，只缩放字号与行高，不缩放间距与图形（`fontScale.ts`） |

### 0.2 与既有卡的区隔（脚注里要能读出来）

| 本卡 | 已有近似物 | 区别 |
| --- | --- | --- |
| 项目流量河流图 | 成本树图（#359） | 树图回答「钱落在哪个会话」；河流图回答「用量在项目之间随时间怎么流动」 |
| 项目流量河流图 | 会话星系（F1） | 星系画离散会话事件；河流画**逐日聚合**的连续体量 |
| 项目流量河流图 | 模型跷跷板（H6） | 跷跷板只比两个模型；河流是全部项目在同一时间轴上的形状 |
| 项目流量河流图 | 堆积面积图 | **不堆叠**：堆叠后中间层厚度读不出数值，且需要大面积实色填充，与 `-soft` 规则冲突 |

### 0.3 数据契约（纯函数层）

建议模块 `web/src/features/usage/projectFlow.ts`，组件不碰时钟、不做 I/O、零新增 Tauri 命令。

```
buildProjectFlow(inputs, days, now) -> {
  days: number[]                 // 窗口内每个本地日零点，长度 = days
  lanes: FlowLane[]              // 按窗口总量降序，最多 7 条
  max: number                    // niceAxisMax(所有绘制河道的单日最大值，含尾部合计)
  rawMax: number
  windowTokens: number
  dayTotals: number[]            // 与 days 对齐，用于「占当天」
  recordedDays: number           // dayTotals > 0 的天数
  projectCount: number           // 窗口内有 token 的项目数（不是河道数）
  emptyReason: "no-sessions" | "no-tokens" | "single-day" | "single-project" | null
}

FlowLane = {
  key: string                    // projectLabel；尾部为 "__other__"
  name: string                   // formatProjectPath 的 basename；尾部为「其他 N 个项目」
  shortName: string              // 左栏用；尾部为「其他 N 个」
  isOther: boolean               // 尾部合计（≥2 个项目被合并）
  tone: 1|2|3|4|5|6|null         // null = 不进色板（尾部合计，或恰好第 7 名的单项目）
  total: number
  peakDay: number
  peakValue: number
  activeDays: number
  values: number[]               // 与 days 对齐；0 是真实观测值，不是缺失
}
```

口径细节：

- **分组键是 `projectLabel`**（编码目录名），显示名用 `formatProjectPath(label, projectPath)`；两个不同目录恰好同名时仍是两条河——合并无关目录会算错账。
- **按记录自己的本地日落桶**，不是按会话起点。跨午夜的会话如实拆到两天，与 KPI 一致。
- `usage` 缺失的记录贡献 0；一天只要有一条 `usage` 记录，就如实进入该日桶。`recordedDays` 只数 **dayTotal > 0** 的天——河流画的是 token，没有 token 的天没有形状。
- 窗口内 token 总量为 0 的项目不参与排名、不画河道。
- 空态判定优先级：`no-sessions` → `no-tokens` → `single-day` → `single-project` → 画图。
- 同分排序：总量降序 → 显示名字典序 → `projectLabel` 字典序。同一输入必须每次得到同一组颜色。
- 峰值日并列时取**最早的一天**；摘要里的「峰值最高的河」并列时取**排名靠前**（总量更大）的一条。两条规则都要在纯函数里钉死，避免同一天刷新换答案。

### 0.4 排名与尾部

- 前 6 名进入色板（`--chart-1..6`）；第 7 名起离开色板，是否合并成「其他」见下。
- **`> 7` 个项目**：第 7 条 = 「其他 N 个项目」的逐日合计，中性色，不可选中。
- **恰好 7 个项目**：第 7 条用**它自己的名字**与逐日真实值，但仍是中性色（色板只有 6 档）。这不是「其他」，脚注要说明「第 7 名用中性色」。
- **≤ 6 个项目**：没有尾部，河道数 = 项目数。
- 尾部的 `values` 是逐日合计，不是把所有尾部项目叠画；它不是一条具体项目，所以不提供「选中后看该项目峰值」的读数。

**非目标**：本卡只有 token 口径，不做成本口径（成本落在树图 / 成本地形）；不接 `onOpenSession`（河流是读数，不是会话启动器）；不做堆叠、不做每行归一、不做跨窗口的颜色持久化。

---

## 1 版式与尺寸

### 1.1 网格位置

- `span 12` 独占整行。90 天 × 7 条河需要宽度；半宽会把时间轴压成碎片。
- 放在 **「回声」之后、「工具火焰」之前**（DOM 里紧跟 `data-lab-card="echo"`）。叙事：钱落在哪（树图）→ 重复了什么（回声）→ 在项目之间怎么流动（河流）→ 观察 / 假设（火焰 / 沙盘）。
- 新语义类 `.ribbon { grid-column: span 12; }`；不写内联 style。
- `data-lab-card="ribbon"`；`data-probe="lab-ribbon"`；`Panel titleAs="h3"`，`aria-label="项目流量"`。
- 实验室视角数从 16 → 17；页头说明与进度行同步（见 §8）。

### 1.2 卡内结构与高度

```
┌ Panel 40px ─────────────────────────────────────────────────────┐
│ 项目流量                                                         │
├ body padding 12 ─────────────────────────────────────────────────┤
│ 摘要行（--fs-sm / --lh-sm，1 行，0 0 8）                          │
│ SVG 图（高 336，7 条河；宽度 = 实测容器宽）                        │
│ 选中读数行（min-height --lh-base，8 0 0）                         │
│ 脚注（--fs-xs / --lh-xs，8 0 0，2–3 行）                          │
└──────────────────────────────────────────────────────────────────┘
```

- **图形高度固定，不随容器宽度缩放**：树的测量宽度写法，`viewBox = "0 0 实测宽 图高"`，1 用户单位 = 1 CSS px。这一点很关键——河流的河道高度是「形」，不该像 960 定宽图那样在宽窗口里被放大、在窄窗口里被压扁。
- `rows = lanes.length`（2–7）：
  - `图高 H = 44 × rows + 28`
  - 7 行：**336px**（与成本树图的 340 基本同高）
  - 2 行：116px
- **整卡高度上限**：7 行时约 **495–515px**（100% 字号）、**≤ 560px**（130% 字号；最小窗口下选中读数折成 2 行、脚注折成 3 行）。LabView 不设 `max-height`、卡内不出现第二根滚动条；高度由固定几何 + 文本行数自然决定。不要给这张卡单独加 `max-height` 或内部滚动。
- 不预留空河道：只有 3 个项目就只画 3 条，图高 160；空河道会被读成「有项目但为 0」。

### 1.3 几何常量（TS 里的「形」，不是 CSS 间距）

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `PLOT_TOP` | 8 | 第一条河道顶部到 SVG 顶 |
| `LANE_H` | 36 | 单条河道高度（含峰顶到基线的满格） |
| `LANE_GAP` | 8 | 河道间距；几何常量写死 8，注释里对齐 `--sp-2` |
| `Y_AXIS_W` | 64 | y 刻度列；右对齐于 x=56 |
| `SELECT_BAR_X` | 66 | 选中竖条 2px，居中于河道中线 |
| `SWATCH_X` | 72 | 8×8 色块 |
| `NAME_X` | 86 | 项目名起点，右界 184（可用宽 98） |
| `PLOT_LEFT` | 192 | 绘图区左边界 |
| `PLOT_RIGHT` | 24 | 右留白（最后一个 x 标签不裁切） |
| `AXIS_LABEL_DY` | 14 | x 标签基线距最后一条基线 |
| `BOTTOM` | 6 | SVG 底留白 |
| `MIN_TICK_GAP` | `56 × fontScale` | x 标签最小水平间距 |
| `STROKE` | 1.5（高对比度 2） | 河道顶边 |
| `DOT_R` | 2.5（高对比度 3） | 悬停日读数点 |

横向分区（1 单位 = 1 CSS px）：

```
x:  0        56 64 66 72 80 86          184 192                       width-24
    [ y 刻度 ][ ][b][sw][ 项目名 …………  ][ 绘图区 …………………………………… ][ 右留白 ]
                  ↑  ↑
                  |  8×8 色块
                  2px 选中竖条
```

纵向位置（第 i 条，i 从 0 起）：

```
laneTop(i)    = 8 + 44 × i
baseline(i)   = 44 × (i + 1)
nameBaseline  = laneTop + 22      // 文字基线
swatchY       = laneTop + 14      // 8px 色块，视觉中心 26
selectBarY    = laneTop + 8       // 20px 高的 2px 竖条
yMaxLabelY    = laneTop(0) + 12   // 仅第一条
yZeroLabelY   = baseline(0) - 4   // 仅第一条
最后基线       = 44 × rows
x 标签基线     = 44 × rows + 14
```

- 河道之间的 8px 缝里只留前一条的基线，不画分隔线、不画底色、不做斑马纹。
- 不画每条河的顶部满格线：7 条顶线会变成网格，抢走河道轮廓。满格只由第一条的 y 刻度与脚注说明。

### 1.4 标题区的「怎么读」

要有一句，但**只放一处**：放在图下脚注（`--fs-xs` / `--text-tertiary`），不在图上方再写一段说明。图上方的摘要行只说**这一窗口的数据事实**，不做教学。

- 摘要行（`--fs-sm` / `--lh-sm` / `--text-secondary`，`margin: 0 0 var(--sp-2)`）：
  - `近 30 天里 8 个项目有用量，共 12.4M token；峰值最高的是 web，11/3 单日 3.1M token。`
  - 数字用 `--font-mono` / `--text` / 600 提出来，日期保持正文字体。
  - 若峰值属于尾部：`峰值最高的是「其他 3 个项目」合计，11/3 单日 3.1M token。`
- 脚注（定稿）：
  - `每条河是一个项目的当日 token（输入、输出、缓存写入、缓存读取四类之和，与页面 KPI 同口径）。所有河共用同一刻度：满格 1.2M token/日，所以高度可直接比较。最后一天是今天，尚未过完。悬停看某天，点一条河锁定项目，Esc 取消。`
  - `> 7` 个项目时追加：`第 7 条「其他 3 个」是总量第 7 名及以后项目的当日合计。`
  - 恰好 7 个项目时追加：`色板只有六档，第 7 名用中性色；它仍是单个项目，不是合计。`
  - 未定价模型不需要声明：token 口径不依赖定价，照常计入。页面若已有别处声明，本卡不重复。
- 不设 `actions` 槽：没有第二个视图、没有导出、没有来源徽章（`logged` 档本来就不渲染圆点）。窗口选择器仍只有页头那一份。

---

## 2 颜色映射

### 2.1 固定映射，不跟排序/选中漂移

1. 先按**窗口内 token 总量降序**排名（同分按显示名、再按 `projectLabel`）。
2. 第 1–6 名固定映射 `--chart-1..6`；第 7 条起为中性。
3. **不循环 `% 6`**：第 7 条如果又回到 `--chart-1`，读者会把两个不同项目读成同一条。
4. 映射在一次渲染里只算一次，由河道、图例色块、tooltip、选中读数、等价表格**共用同一个 `tone`**。

**为什么必须固定**：颜色是身份通道。如果颜色跟着「当前排序」或「选中后置顶」重算，同一个项目会在一次交互中换色，读者刚建立的「青色 = web」立刻失效；更糟的是 tooltip 与图各自重排后会给出两套颜色。窗口从 7 天切到 90 天时可以重新排名——数据集变了，但**同一次渲染内绝不重排**。

### 2.2 填充与描边

| 部件 | 令牌 | 规格 |
| --- | --- | --- |
| 河道面积 | `--chart-N-soft` | 整块填充；**不叠** `opacity` / `fill-opacity` / `color-mix` |
| 河道顶边 | `--chart-N` | 1.5px 实色；高对比度 2px |
| 未选中（有选中时） | `--border-strong` | 顶边换成 1px 中性线；填充仍是 `-soft`，不压暗 |
| 选中 | `--chart-N` | 顶边 2px + 左栏 2px 选中竖条；名字 `--text` / 600 |
| 尾部 | `--bg-active` 填充 + `--text-tertiary` 虚线 | `stroke-dasharray: 4 3`，1px（高对比度 2px） |
| 基准线 | `--border-strong` | 1px；高对比度改 `--border`（同星系泳道线的做法） |
| 今天线 | `--border-strong` | 1px，`2 4` 虚线 |
| 悬停竖线 | `--text-tertiary` | 1px 实线 |
| 悬停点 | 对应 `--chart-N` / 尾部 `--text-tertiary` | r=2.5，外圈 1px `--bg-subtle` |
| 名字 | `--text-secondary` | `--fs-xs`；未选中 400，悬停或选中 `--text` / 600 |
| y / x 刻度 | `--text-tertiary` | `--fs-xs`、`tabular-nums` |

- **顶边只描上沿**：面积路径的 fill 与 stroke 分开画。若直接给面积路径描边，闭合用的基线、左右两条竖边也会被描出来，等于给河道加了一个并不存在的框。
- **基准线画在填充之上**：高对比度下 `-soft` 是不透明浅色，若先画基线再填色，基线会被盖掉半条。顺序：填充 → 顶边 → 基准线 → 今天线 → 悬停线 → 点 → 焦点环。
- **选中时不改 fill、不加 opacity**：只换顶边颜色与粗细，左栏加竖条。否则 `-soft` 与 opacity 会叠成第三种 alpha，高对比度下还会失效。
- 不新增颜色令牌，不动 `tokens.css`。
- **无入场动画**：河道出现即到位，不做逐条绘制、不做高度呼吸。选中态最多允许 `stroke` 的颜色过渡 `var(--dur-hover)`；`stroke-width` 的变化不做 transition（粗细跳变是状态，不是动画）。全局 `prefers-reduced-motion` 已把时长压到接近 0，这里不另写一套。
- **不设独立图例**：左栏的 8px 色块 + 项目名就是图例，颜色身份与河道在视觉上直接相邻。再接一排图例只会把 6 个色块重复一遍，并让读者以为尾部也有第七种系列色。

### 2.3 `-soft` 够不够可辨

结论：**够用，且这是不新增令牌时的正确上限**。

- 河流是**大面积**填充，按 `tokens.css` 的硬规则只能用 `-soft`；实色 `--chart-N` 只能做 1.5px 顶边、8px 色块、2.5px 读数点。
- 浅色下 `-soft` 在面板底上的对比度是 1.32–1.41，单看填充确实只是「氛围」；但每条河的**顶边**有一条 ≥3:1 的实色线（六色相对 `--bg` 为 3.56–5.17），形状的边界由实色承担，填充只负责「体量感」。这正是令牌注释里「轮廓照旧由实色描边给」的用法。
- 不能用 `opacity` / `fill-opacity` 把 `-soft` 叠深：那是叠 alpha，深色下变成另一种浓度，高对比度下不透明的 `-soft` 又会被打回半透明。
- 不能用 `color-mix`：最低支持系统（macOS 10.13）的 WKWebView 不支持，整条 `fill` 会作废。
- 不能把 `--chart-N` 直接铺成面积：违反「大面积只允许 `-soft`」，也会和树图的面积语言打架。
- 若 1x 显示器实拍仍觉得体量太弱，**唯一允许的加强是把普通主题的顶边从 1.5px 提到 2px**（仍是描边，仍是同一令牌），不要引入新的 alpha 或新令牌。

### 2.4 尾部为什么用 `--bg-active`

尾部不是第七个系列色，而是「其余项目的合计」。用中性面 `--bg-active` + `--text-tertiary` 虚线：

- 火焰图已有先例：`FlameGraphPanel.module.css:159-160` 的「其他」段就是 `--bg-active`，高对比度下补 `--border-strong` 描边（`:230`）。
- 不用第七个色彩：色板只有六档，第七种色相会让人以为它和某个项目一样是独立系列。
- 虚线是第二通道：即使色觉差异或灰度打印，也能看出它不是一条普通河。
- 尾部若恰好是「第 7 名的单个项目」，仍用这套中性外观，但左栏写真实项目名；脚注说明它不是合计。

---

## 3 图形生成

### 3.1 x / y 映射

- **x 按本地日序，不按毫秒**：
  - `slot = (绘图宽) / days.length`
  - `x(i) = PLOT_LEFT + (i + 0.5) × slot`
  - 用日序而不是时间戳，DST 的 23/25 小时不会让某一天被压扁或拉长；每个本地自然日占同样的宽度。
  - 用**带中心**而不是 0..n-1 两端贴边：首末两天各留半个槽，河道不会贴着边框，也不暗示窗口外还有数据。
- **y 统一刻度**：
  - `max = niceAxisMax(max(所有绘制河道的所有单日值))`
  - `y(i, v) = baseline(lane) - (v / max) × LANE_H`，再 clamp 到 `[laneTop, baseline]`
  - **包含尾部合计**：尾部是画出来的一条河，如果它的逐日合计超过任何单项目，刻度必须跟它走，否则会溢出河道。脚注的「满格」就是这个 `max`。
  - 不做每行自归一。自归一会让一个小项目和一个主力项目看起来一样高，正好抹掉「谁在涨、谁在退」——这是本卡存在的理由。
  - `niceAxisMax` 会把上限抬到 1/2/2.5/5×10ⁿ 的圆整值；最高的一条河可能离满格差一点，这是坐标轴的常规，标签是精确的满格值，不是四舍五入后的假数。

### 3.2 平滑：单调三次插值，不用 Catmull-Rom

每个项目一条曲线，逐日取点，**必须穿过每一天的真实值**。

- **用单调三次 Hermite（Fritsch–Carlson / Steffen）**：
  - 在局部极值处把切线置 0；
  - 相邻斜率异号或有一段为 0 时，夹住切线，保证任意一段曲线都落在两端点的 y 区间内；
  - 因此曲线**不会高于两天的较大值，也不会低于较小值，更不会低于基线 0**。
- **不用 Catmull-Rom / cardinal spline**：它们会在局部极值附近过冲。一个「高—0—高」的三天序列，Catmull-Rom 会在 0 的两侧画出负面积，等于凭空造出「用量为负」的一段；一个尖峰会被拉得比真实峰值更高。这是「曲线不能做出数据里没有的峰」的直接理由。
- **不用直线**：折线把每天的噪声画成锯齿，读者看不出「慢慢退潮」和「一夜断流」——而这正是本卡要回答的问题。单调三次在保持形状的同时把日间过渡画顺，且不改变任何一天的读数。
- 曲线经过的每一个日点就是真实读数；悬停时在该点画实心点，给出精确值。
- 安全网：生成路径后仍把控制点的 y clamp 到 `[laneTop, baseline]`，防浮点误差让填充越过基线。clamp 不是插值策略，只是最后一道保险。
- 测试要**采样曲线**（t=0..1 的若干点），断言 y 落在该段两端点的闭区间内且 ≥ 基线；不要只断言 path 字符串。

### 3.3 面积与顶边

- 面积路径：上沿曲线 → 最后一天 x 处落到基线 → 沿基线回到第一天 x → 闭合。
- 填 `--chart-N-soft`，**不描边**。
- 顶边单独一条路径：只画上沿曲线，`fill: none`，实色 1.5px，`stroke-linejoin: round`、`stroke-linecap: round`。
- 左右两端不做垂直描边；面积在首末日的 x 处自然收口。窗口边界是事实，不向外多外推半天。
- 0 值：是真实的日点 y=基线，不跳过、不用前一天的值填充、不做「空洞断开」。一条河某天为 0，就在那天收为基线。
- 尾部同一套画法，填充/描边换成 §2.4 的中性组合。

### 3.4 今天与窗口边界

- 最后一天是今天，数据尚未过完。在**最后一天的 band 中心**画一条 `--border-strong` 的 `2 4` 虚线（从第一条河顶到最后一条基线），`data-ribbon-today`。
- 今天最后一个点就落在这条线上，读作「数据到此为止」。
- 脚注固定说明「最后一天是今天，尚未过完」。悬停最后一天的 tooltip 标题写 `11/24（今天，尚未过完）`。
- **不对今天做外推、不把今天的数值按已过时长折算成全天**：那是估算，不是读数。
- 窗口边界只从 `labWindow` 来，不在组件里另算。

### 3.5 坐标轴与刻度

- **y 轴只画一次，在最上面一条河**：
  - 两个标签：`0`（第一条河的基线）与 `formatAxisValue(max)`（第一条河的顶部）；
  - 两条 1px 短刻度线从 x=56 到 x=64，颜色同基准线；
  - 其余河道只画基线，不画 y 刻度。
  - 理由：所有河道共用同一刻度，每行都画会变成 14 个数字的网格；画在最上面一次，加脚注「所有河共用同一刻度」，读者才知道高度能横向比。
- **x 轴**：
  - 不单独画轴线，最后一条河的基线就是 x 轴。
  - 标签格式 `formatDayLabel`（`11/3`），与页面其它日轴一致；`--fs-xs`、`--text-tertiary`、`tabular-nums`，`text-anchor="middle"`。
  - 抽稀：候选步长 `[1, 2, 3, 7, 14, 30]` 天；取**满足以下两条的最小步长**：
    1. `ceil(days / step) ≤ floor(绘图宽 / (56 × fontScale))`
    2. `ceil(days / step) ≤ 12`
  - 刻度**从最后一天往前锚定**（`n-1, n-1-step, …`），保证右端永远有「今天」附近的日期；常见桌面宽度下，90 天通常是 14 天一步（7 个标签）、30 天是 3 天一步（10 个）、7 天是每天一个。窄窗口 + 130% 时按密度规则继续降级（例如 90 天变 30 天一步、7 天变 2 天一步），不硬塞。
  - 130% 下最小间距跟着 `fontScale` 放大到 72.8px，标签不会互相撞。
- 不画纵向网格线；唯一的竖线是今天的虚线与悬停的实线。

---

## 4 交互与可达性

### 4.1 悬停（鼠标 / 触控板）

- 指针在绘图区内移动 → 按 x 取最近的日 band：`day = clamp(floor((x - PLOT_LEFT) / slot), 0, n-1)`。
- 显示：

  - 一条 `--text-tertiary` 的 1px 竖线，从 `PLOT_TOP` 到最后一条基线；
  - 每条河在该日的 2.5px 实心点（填充对应色，外圈 1px `--bg-subtle`）；尾部用 `--text-tertiary`；
  - tooltip（§4.6）。

- 若该日 `dayTotal = 0`：只画竖线，不画点；tooltip 显示「这一天没有用量记录」。
- 指针移到左栏（x < `PLOT_LEFT`）：只把该行项目名提亮为 `--text`，不显示竖线/tooltip。
- 指针离开图：清除竖线、点、tooltip、行提亮。若图仍有键盘焦点，焦点环保留，日期游标可由下一次方向键重新出现。
- 不为了 hover 给其它河降透明度、不重排 DOM——只叠一层游标与点，避免指针下的节点切换造成闪烁。

### 4.2 点击选中

- 点击任意一条**可选中**的河（含左栏名字/色块区域）：选中该项目。
- 再点同一条：取消。点另一条：切换。
- 选中后：
  - 该河顶边 2px 实色；其余河顶边 1px `--border-strong`，填充保持 `-soft`；
  - 左栏该行出现 2px × 20px 的实色选中竖条，名字 `--text` / 600；
  - 图下选中读数行变成该项目的窗口读数（§4.6 末段）。
- **尾部合计不可选中**（`pointer-events: none`、光标 `default`）：它没有单一项目身份，也没有「该项目的峰值日」。恰好第 7 名的单项目可以选中，用 `--text` 2px 顶边 + `--text-tertiary` 竖条（没有色相可用，靠墨色与粗细）。
- Issue 里「其余降为 `-soft` 描边」的落地口径：**填充保持 `-soft`，顶边退成 1px `--border-strong`**。把描边本身也换成 `-soft` 会几乎看不见（alpha 0.24 的 1px 线），既没有信息量又让河道像消失了；中性发丝线保留了形状，同时把注意力让给选中的那条。
- 点击不移动 DOM 焦点，也不弹出第二个浮层；键盘焦点仍由 Tab 进入。窗口级 `Escape` 在有任何选中时清除选中（不需要图先获得焦点）。
- 切换窗口/数据后，若选中的 key 不复存在，清空选中；日期游标 clamp 到新范围。

### 4.3 键盘

- **整个图只有一个 Tab 停点**：外层 `div` `tabIndex={0}`，`role="group"`。河与点都不进 Tab 序——WKWebView 里 SVG 子元素的可聚焦性不可靠，几十个焦点目标也会毁掉键盘体验。
- 键位：

| 键 | 行为 |
| --- | --- |
| `←` / `→` | 日期游标 -1 / +1；读数与竖线跟着走 |
| `Home` / `End` | 跳到窗口第一天 / 今天 |
| `↑` / `↓` | 切换当前河（0..lanes-1）；读数播报跟着换 |
| `Enter` / `Space` | 锁定/取消锁定当前河（尾部合计除外） |
| `Esc` | 清除选中；无选中时清除游标 |

- 焦点进入时：游标默认落在**今天**，当前河默认是第 1 条（或已选中的那条），并显示焦点环与 tooltip。
- 所有被接管的键都 `preventDefault()`，避免把页面滚走；不拦 `Tab`。
- 日期变化时更新一个视觉隐藏的 `role="status" aria-live="polite"` 区域（§4.5），读屏不用看图也能听出「哪天、哪条河、多少 token、占当天多少」。

### 4.4 焦点环

- 焦点环画在**当前河道的整行 band** 上：`x=2`、宽 `图宽-4`、`y=laneTop-3`、高 `LANE_H+6`、`rx=2`；`fill:none`、`stroke: var(--ring)`、`stroke-width: var(--focus-ring-width)`（高对比度自动 3px）、`pointer-events:none`。
- 外层 div 的 `:focus { outline: none }`——环由 SVG 自己画，避免浏览器默认 outline 与环形重复。
- 环跨越左栏与绘图区，明确「这一整行是当前河」；`↑/↓` 时环随行移动。
- 焦点离开：环消失；选中保留。

### 4.5 ARIA 结构

- 外层：`role="group"`、`tabIndex=0`、`aria-label="项目流量河流图（可交互）"`、`aria-describedby` 指向两段视觉隐藏文字：键盘说明与脚注。键盘说明定稿：`方向键左右切换日期，上下切换项目，Enter 锁定项目，Esc 取消；悬停也可查看某天读数。`
- SVG：`role="img"`、`aria-label` 为一句话摘要（§4.6 末段）。`role="img"` 让 SVG 里的文字/路径成为单一图像，不会让读屏逐个念刻度。
- **等价表格**（视觉隐藏，`data-ribbon-table`）：
  - 一行一条河（含尾部），列：项目 / 窗口合计 / 占本窗口 / 峰值日 / 峰值 token / 有记录天数。
  - 不做 90 天 × 7 项目的 630 格大表：逐日读数由**日期游标 + live region** 承担，静态表承担「每条河的窗口事实」。这与树图的「图 + 等价表」同一结构，但不会把 DOM 撑成一张巨型表。
- **live region**：`role="status" aria-live="polite"`、视觉隐藏。文本格式：
  - `11/24（今天，尚未过完）：web 3.1M token，占当天 42.1%；当天合计 7.2M token。`
  - 锁定/取消时：`已锁定 web。窗口合计 12.4M token，占本窗口 38.2%，峰值 11/3。` / `已取消锁定。`
- 视觉 tooltip 是 `aria-hidden="true"`：它只是视觉增强，读屏走 live region 与等价表，避免同一句话被念两遍。
- 颜色不是唯一通道：项目名直接标在左栏；尾部有虚线；选中同时有粗细、竖条、字重；今天有虚线；游标有竖线。

### 4.6 tooltip、选中读数、摘要

**tooltip（悬停 / 键盘）**

- portal 到 `document.body`，`position: fixed`，`z-index: 10`，`--bg-elevated`、1px `--border`、`--r-xs`、`--shadow-sm`（浮层允许阴影）、padding `--sp-1 --sp-2`。
- 宽度：`width: max-content; min-width: 220px; max-width: calc(280px * var(--font-scale))`；130% 下约 364px，不靠固定 280px 硬撑。
- 结构：

  ```
  11/3 · 当天 7.2M token          ← --fs-sm / 600 / --text；数字 mono
  ■ web        1.2M token   42.1%   ← 7 行，按河道顺序
  ■ api         800K token   28.0%
  ▨ 其他 3 个    120K token    4.2%
  ```

  - 每行 `display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; column-gap: var(--sp-2); align-items: baseline`。
  - 色块 8×8、`--r-xs`、实色；尾部 `--bg-active` + 1px `--text-tertiary` 描边。
  - 名字 `--fs-xs` / `--text-secondary`；选中行 `--text` / 600；**不省略、允许换行**（最多 2 行）——tooltip 是完整项目名的通道，左栏才做截断。
  - 数值 `formatTokenCount(v)` + ` token`，`--font-mono` / `--text` / `tabular-nums`。
  - 占比 `v / dayTotal`，一位小数；`0` 显示 `0.0%`，`>0` 且 `<0.1%` 显示 `<0.1%`（同消耗日历的 `formatShareText` 口径）。
  - **所有河道全列（含 0）**：固定行序让读者能跨天对照；只有 `dayTotal = 0` 时改为一句话「这一天没有用量记录」。
  - 今天标题加 `（今天，尚未过完）`。
- 定位：先量宽高再定位；`left = anchorX + 12`，右侧放不下翻到 `anchorX - 12 - width`，再 clamp 到 `[8, vw - width - 8]`；纵向同理。键盘时 anchor 取游标线在**当前河**的 x/y，不是鼠标坐标。
- 滚动（capture）、`Escape`、指针离开时关闭；宽度变化（ResizeObserver）后关闭并由下一次交互重开。

**选中读数行（图下，固定保留一行高度）**

- 空闲文案（`--fs-xs` / `--text-tertiary`，`min-height: var(--lh-base)`）：
  `点一条河锁定项目，查看窗口合计与峰值日。`
- 选中后（`--fs-sm` / `--lh-sm`，可换行，名字 600）：
  `■ web · 窗口合计 12.4M token · 占本窗口 38.2% · 峰值 11/3（3.1M token）· 有记录 18/30 天`
  - 分隔符 ` · ` 用 `--text-tertiary`；数值 mono / `--text`。
  - 窗口占比的分母是**全部项目**的窗口总量，不是河道数，也不是当天。
- 尾部合计不产生这一行。

**SVG 摘要（aria-label）**

`项目流量：近 30 天里 8 个项目有用量，共 12.4M token；峰值最高的是 web，11/3 单日 3.1M token。所有河共用同一刻度，满格 1.2M token/日。`

---

## 5 空态

统一 `EmptyState size="inline"` + 一行 `--fs-xs` / `--text-tertiary` 说明（`margin: var(--sp-1) 0 0`，居中），不画空坐标系、不画 7 条 0 线。

| 条件 | 标题 | 说明 |
| --- | --- | --- |
| 窗口内没有会话 | `所选范围内没有会话` | 无（与树图/回声同款） |
| 有会话但没有 token 用量 | `所选范围内有会话，但没有 token 用量` | `要么日志缺少 usage 计数，要么计数全为 0；两种情况下都画不出河道。` |
| `recordedDays < 2` | `近 N 天里只有 1 天有 token 读数，画不出走向` | `河流图需要至少 2 个有读数的日子；单独一天没有走向可读。` |
| 只有 1 个项目 | `近 N 天只有 1 个项目有记录` | `<项目名> · 合计 X token · 峰值 M/D（Y token）。没有第二个项目，画不出「之间」的流动。` |

- 优先级：无会话 → 无 token → 不足 2 天 → 不足 2 个项目。前一条成立时不再报后一条。
- 「全部为 0」落在「有会话但没有 token 用量」一档：0 读数和缺读数是两件事，但都画不出面积；文案把两者都说到。
- 单项目时的峰值口径与图表一致（该项目的单日最大值）。

---

## 6 响应式、字号档、主题

### 6.1 宽度

- `span 12`；`≤1080px` 时实验室所有卡塌成整行，本卡本来就是整行，无需额外规则。
- 绘图宽 = 实测 `clientWidth - PLOT_LEFT - PLOT_RIGHT`；1 用户单位 = 1 CSS px，所以**河道高度与字号在宽窗口不会放大**。
- 最小窗口 960 时内容区约 636px，绘图区约 420px；7 天的窗口每天约 60px，90 天时约 4.7px/天。刻度按 §3.5 自动抽稀，不出现横向滚动、不出现卡内第二根滚动条。
- 首帧/jsdom 用 `FALLBACK_WIDTH = 960`；`ResizeObserver` 不存在时挂载量一次（同树图）。实测宽为 0 时用兜底；绘图宽做 `Math.max(120, 实测宽 - PLOT_LEFT - PLOT_RIGHT)` 的下限保护，避免负宽度。实际最小内容约 636px，不会触发下限。

### 6.2 130% 字号档

图形几何不缩放（36 / 8 是「形」），文字走 `--fs-*`，所以只会在这些地方变紧：

| 位置 | 100% | 130% | 防护 |
| --- | --- | --- | --- |
| 项目名 | 11px；98px ≈ 14 个拉丁字符 | 14.3px；≈ 10–11 个 | `fitLabel(name, 98, 11 × fontScale)`，超出加 `…`；全名进 tooltip/表 |
| 尾部名 | `其他 3 个` ≈ 46px | ≈ 60px | 左栏用短名「其他 N 个」，tooltip/表用全名「其他 N 个项目」 |
| x 刻度 | 最小间距 56px | 72.8px | 步长用 `56 × fontScale` 计算；标签上限 12 个 |
| y 刻度 | `999.9K` ≈ 41px | ≈ 53px | y 列 64px，标签右对齐于 x=56，最宽也放得下 |
| 河道名行高 | 11px 落在 36px band 内 | 14.3px 仍在 36px 内 | 河道高度不随字号缩放 |
| tooltip | 280px | 364px | `max-width: calc(280px * var(--font-scale))`，先量后翻边 |
| 整卡高 | ~495–515px | ≤ 560px | 不设 `max-height`，页面整体滚动 |

- **最容易破的三处**：项目名不乘 `fontScale`（溢出到绘图区）、x 标签间距写死 56px（130% 下相撞）、y 列仍按 56px（`999.9K` 左边被裁）。
- 130% 下**不要减少河道数**：Top 6 + 尾部是数据规则，不是排版妥协；河道高度固定，减少河道只会让数据消失。
- 窄窗口 + 130% 时，SVG 字号不会缩成 7px（因为 1 单位 = 1px），这是相对 960 定宽图的实质改进。

### 6.3 深色

- 组件里不写主题分支，全部由令牌承担。
- 深色 `-soft` alpha 0.30，在 `--bg-subtle #14161a` 上的对比度 1.78–2.05，河道体量可见；实色顶边 ≥7.21，轮廓清晰。
- 基准线 `--border-strong`（白色 0.14）在深底上仍然可读；高对比度深色改 `--border`（实色 #767676）。
- 尾部 `--bg-active #2a2e34` 比面板底亮一档，读作「抬起的灰面」；`--text-tertiary` 虚线在深底上是 5.5:1 左右，够用。

### 6.4 高对比度

- `-soft` 变成不透明浅色（浅色档 `#d2dde5` 等，深色档 `#394c5d` 等），填充自然变实；**仍然不叠 opacity / color-mix**。
- 河道顶边 2px（普通 1.5px）：高对比度要的是确定边界，不是氛围。
- 悬停点 r=3（普通 2.5）；焦点环 3px（由 `--focus-ring-width` 自动给）。
- 基准线：普通 `--border-strong`；高对比度 `--border`（两块高对比度主题里 `--border` 是实色灰，比 `--border-strong` 更适合 7 条横线）。这与 `ConstellationPanel.module.css` 的 `.laneRule` 完全同款。
- 尾部虚线保持 `4 3`，高对比度下加粗到 2px；虚线是形状通道，不依赖色相。
- 选中/未选中的区分在灰度下仍成立：2px 实色 + 竖条 + 字重 vs 1px 中性线。

---

## 7 验收清单

### 7.1 单元测试（`projectFlow.test.ts`）

- [ ] 窗口边界：`startTs` 含、`endTs` 不含；跨午夜的会话按记录各自本地日拆桶。
- [ ] 日序列：长度恒等于 `days`；每个 key 是本地零点；DST 日不出现 23/25 小时的位移（用 `addLocalDays`，不用 `+86_400_000`）。
- [ ] 排名：总量降序；同分按显示名、再按 `projectLabel`；0 token 项目被排除。
- [ ] Top 6 + 尾部：8 个项目 → 7 条河，尾部 `isOther=true`、`tone=null`、逐日值等于被合并项目之和、`total` 等于各自之和。
- [ ] 恰好 7 个项目 → 7 条河，第 7 条 `tone=null`、`isOther=false`、名字是真实项目名。
- [ ] 6 个项目 → 6 条河、无尾部、tones 1..6。
- [ ] 统一刻度：`max = niceAxisMax(所有绘制河道的单日最大值)`；尾部合计超过单项目时，`max` 跟尾部走。
- [ ] 单调三次：对每个 segment 采样 t=0..1，y 落在两端点闭区间内、≥ 基线；「高—0—高」不出现负 y；尖峰不超过真实峰值。
- [ ] x 刻度：90 天 + 100% → 标签 ≤ 12；90 天 + 130% → 间距 ≥ 72.8，标签 ≤ 12；最后一天必有一个标签。
- [ ] 空态四态与优先级：`no-sessions` > `no-tokens` > `single-day` > `single-project`；`emptyReason` 为 `null` 时才有 `lanes.length >= 2`。
- [ ] 占比：每条河的窗口/当天占比之和为 1（浮点容差）；0 值 `0.0%`，极小的非零 `<0.1%`。

### 7.2 组件测试（`ProjectFlowPanel.test.tsx`）

探针契约（e2e / 组件测试共用，避免两套定位）：

| 探针 | 挂在哪 | 值 |
| --- | --- | --- |
| `data-probe="lab-ribbon"` | 卡片根 | 固定 |
| `data-probe="ribbon-chart"` | SVG | 固定 |
| `data-ribbon-lane` | 每条河的组/路径 | `lane.key` |
| `data-ribbon-tone` | 每条河 | `1..6` 或 `neutral` |
| `data-ribbon-rank` | 每条河 | `0..lanes-1` |
| `data-ribbon-hit` | 透明命中带 | `lane.key` |
| `data-ribbon-cursor` / `data-ribbon-cursor-day` | 竖线 / 图根 | 日索引 |
| `data-ribbon-dot` | 悬停点 | `lane.key` |
| `data-ribbon-selected` | 图根 | 选中 `lane.key` |
| `data-ribbon-dim` | 未选中的顶边 | 存在即降级 |
| `data-ribbon-focus-ring` | 焦点环 | 固定 |
| `data-ribbon-today` | 今天虚线 | 固定 |
| `data-ribbon-y-label` | y 标签 | `zero` / `max` |
| `data-ribbon-max` | 图根 | `max` 数值 |
| `data-ribbon-tooltip` / `data-ribbon-tooltip-row` | 浮层 / 浮层行 | 固定 / `lane.key` |
| `data-ribbon-table` | 等价表 | 固定 |
| `data-ribbon-empty` | 空态根 | `no-sessions` / `no-tokens` / `single-day` / `single-project` |
| `data-ribbon-live` | live region | 固定 |

- [ ] `[data-lab-card="ribbon"]` 内出现 `region`「项目流量」；`data-probe="lab-ribbon"`；`data-probe="ribbon-chart"`。
- [ ] `[data-ribbon-lane]` 数量 = 河道数；`data-ribbon-tone` 为 `1..6` 或 `neutral`，**无重复 tone**（中性除外）。
- [ ] 调整 `--font-scale` 到 1.3、再触发重渲染，`data-ribbon-tone` 映射不变；点击选中后也不变。
- [ ] 彩色河道的 `fill` 属性是 `var(--chart-N-soft)`（尾部是 `var(--bg-active)`）；SVG 内不存在 `fill-opacity` / `opacity` 属性，也不存在 `color-mix` 字符串。
- [ ] y 轴标签恰好 2 个（`data-ribbon-y-label="zero"` / `"max"`），且只在第 1 条河上；其它河只有基线。
- [ ] 悬停：在已知日 band 中心派发 `pointermove` → `[data-ribbon-cursor]` 的 x 等于 `PLOT_LEFT + (i+0.5)*slot`（±0.5）；`[data-ribbon-dot]` 数量 = 河道数；tooltip 行数 = 河道数；tooltip 盒不越出视口（8px 边距）。
- [ ] 点击第 2 条河 → `data-ribbon-selected` 存在；被选中河顶边 2px，其余 `data-ribbon-dim` 且 1px；再点一次 → 选中清除；`Escape` → 清除。
- [ ] 键盘：图内只有外层 `[tabindex="0"]` 一个 Tab 停点；`Home` → 游标第 1 天；`ArrowRight` → +1；`ArrowDown` → 当前河 +1；`Enter` → 选中；`Escape` → 清除；逐键 `preventDefault`。
- [ ] live region：移动日期后文本包含日期、当前河、token、当天占比；锁定后包含「已锁定」。
- [ ] 等价表：行数 = 河道数；尾部行名字是「其他 N 个项目」；列头包含「窗口合计」「峰值日」「有记录天数」。
- [ ] 空态：四种夹具分别渲染 `data-ribbon-empty` 的四个值，且没有 `svg[data-probe="ribbon-chart"]`。

### 7.3 e2e（Chromium + WebKit）

- [ ] `web/e2e/project-flow.spec.ts` 用 `roundFFScenario()`（5 个项目）：region「项目流量」可见；`[data-ribbon-lane]` 5 条；y 标签 2 个；`data-ribbon-max > 0`。
- [ ] 悬停第 5 天 → 游标、5 个点、5 行 tooltip；tooltip 在视口内；数字与夹具一致（只断言结构/非空，不按金额）。
- [ ] 点击第 2 条河 → 选中态；其余 4 条降级；再点清除；`Escape` 清除。
- [ ] 键盘：`Tab` 进入 → 焦点环出现在第 1 条河；`Home`/`ArrowRight` 移动日期；`ArrowDown` 换河；`Enter` 锁定；`Escape` 取消。
- [ ] 空态夹具：无会话 → `data-ribbon-empty="no-sessions"`，无图。
- [ ] 130%：切到 130% 后，x 标签包围盒互不相交；项目名不越过 x=184 的右界；图高仍等于 `44 × 河道数 + 28`（不随字号缩放）。
- [ ] 深色 / 高对比度：切主题后 `fill` 仍引用 `--chart-N-soft`；高对比度下顶边 `stroke-width` 为 2；无 `opacity` 属性。

### 7.4 截图与真机

- [ ] `docs/screenshots/views.json` 增加 `lab-ribbon`（放在 `lab-echo` 之后）。
- [ ] `web/e2e/screenshots.spec.ts` 增加 `declareView("lab-ribbon")` 与 `["ribbon", V_LAB_RIBBON]`；`data-lab-card` 计数 16 → 17；文案「纳入统计 · 16 个视角」→ 17。
- [ ] `docs/screenshots/manifest.json` 与 4 张 PNG（light/dark × Chromium/WebKit）由截图脚本重出；`./scripts/check-screenshots.sh` 通过。
  - 现有 `roundFFScenario()` 只有 5 个项目，截图会是 5 条河、无尾部；尾部形态由单测与组件测试覆盖。若要让截图也出现 7 条河，需要另加一个 ≥8 项目的夹具——不是本 Issue 的必要条件。
- [ ] `web/e2e/lab.spec.ts` 的 `LAB_CARDS` 增加 `"ribbon"`；有数据/空态两处的计数 16 → 17；文案 16 → 17。
- [ ] `web/e2e/cost-treemap.spec.ts` 与 `web/e2e/echo.spec.ts` 的 `openLab` 辅助函数里「纳入统计 · 16 个视角」→ 17（它们会随计数一起假红）。
- [ ] `web/src/features/usage/UsageOverviewPage.test.tsx` 的计数 16 → 17、标题里的「十六张卡」→「十七张卡」、进度行 16 → 17。
- [ ] `LabView.tsx` 的注释、说明文案、「十六个视角」→「十七个视角」；`UsageOverviewPage.tsx:1127` 的进度行 16 → 17。
- [ ] `./scripts/gui-test.sh --build` 全绿，实验室卡数 17。
- [ ] `CHANGELOG.md` 的 `[Unreleased]` → Added，中文条目。

### 7.5 门禁与红线

- [ ] `tokens.css` 零 diff；`ProjectFlowPanel.module.css` 与 `projectFlow.ts` 中没有新的十六进制颜色。
- [ ] 没有引用 `--cat-*`、`--cal-*`、语义色。
- [ ] 没有 `color-mix`、`fill-opacity`、`opacity` 叠层。
- [ ] `./scripts/lint.sh`、`npm --prefix web test`、`npm --prefix web run build`、`cargo fmt --check`、`cargo clippy -D warnings`、`cargo check`、`cargo test` 全绿。
- [ ] 零新增 Tauri 命令、零网络请求、零新增权限；组件只吃 `inputs / days / now`。

---

## 8 实现落点

**新增**

- `web/src/features/usage/projectFlow.ts` — 分桶、排名、尾部、统一刻度、单调三次路径、刻度抽稀（纯函数）。
- `web/src/features/usage/projectFlow.test.ts`
- `web/src/features/usage/ProjectFlowPanel.tsx`
- `web/src/features/usage/ProjectFlowPanel.module.css`
- `web/src/features/usage/ProjectFlowPanel.test.tsx`
- `web/e2e/project-flow.spec.ts`

**修改**

- `LabView.tsx`：import、卡片（`echo` 之后）、描述与视角数 16 → 17。
- `LabView.module.css`：`.ribbon { grid-column: span 12; }`。
- `UsageOverviewPage.tsx:1127`：进度行 16 → 17。
- `UsageOverviewPage.test.tsx`、`web/e2e/lab.spec.ts`、`web/e2e/cost-treemap.spec.ts`、`web/e2e/echo.spec.ts`、`web/e2e/screenshots.spec.ts`、`docs/screenshots/views.json`、`docs/screenshots/manifest.json`。
- `CHANGELOG.md` 的 `[Unreleased]`。

**复用而不是重写**

- `labWindow`、`dayStartOf`、`addLocalDays`、`formatDayLabel`、`totalsSum`（`usageAggregations.ts` / `constellation.ts`）。
- `formatProjectPath`、`formatTokenCount`（`lib/format.ts`）。
- 标签截断 `fitLabel` / `textWidth` 与占比格式 `formatShareText` 目前分别住在 `CostTreemapPanel.tsx` 与 `UsageCalendarPanel.tsx`；跨组件复用时应抽到 `charts/labels.ts` / `lib/format.ts`，**不要从别的面板文件 import**。
- `niceAxisMax`、`formatAxisValue`（`charts/chartPrimitives.tsx`）。
- `Panel`、`EmptyState`。
- 树图的「测量宽度 + 固定高度 viewBox」与「先量后定位的 tooltip」写法（`CostTreemapPanel.tsx:463-527, 587-600`）。
- 星系的「基准线普通 `--border-strong` / 高对比度 `--border`」写法（`ConstellationPanel.module.css:15-25`）。

---

## 9 最容易出错的三个点

1. **平滑过冲 / x 用时间戳**
   Catmull-Rom 会在局部极值附近越过真实峰值，甚至把「高—0—高」画成负面积；按毫秒排 x 会在 DST 日把一天压扁。必须用单调三次（Fritsch–Carlson，极值处切线归零）+ 本地日序 + 基线 clamp，并在单测里采样曲线。

2. **颜色随排序/选中漂移，或第 7 条又循环回 `--chart-1`**
   颜色是项目身份。排名必须只由窗口总量决定、一次算好，河道/色块/tooltip/读数/表共用；选中与悬停绝不重排。第 7 条起用中性（`--bg-active` + `--text-tertiary` 虚线），不 `% 6`。

3. **为了「看得清」去叠 opacity / `color-mix` / 实色大面积填充**
   大面积只能用 `-soft`，透明度叠层会造出第三种 alpha、高对比度下还会失效，`color-mix` 在 10.13 WKWebView 直接作废。正确解法是 `-soft` 填充 + 1.5px 实色顶边（高对比度 2px）；轮廓负责边界，填充负责体量。

> 其余容易漏的：y 轴每行都画（应只在第一条画 0/满格）；今天未过完却没标（应有虚线 + 脚注）；130% 下 x 刻度间距写死 56px（应乘 `fontScale`）；尾部合计超过单项目时刻度没跟它走（会溢出河道）。
