# 「会话重放」界面规格（Round AA）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 日期：2026-10-21 ｜ 状态：待主会话独立评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（任务 `.trellis/tasks/10-21-replay/prd.md`）：在会话详情标签栏新增第 6 项
> 「重放」，把一次会话的**墙钟时间**压成一部可快进、可暂停、可逐帧定位的影片。
> **本文件只写视觉与交互规格，不写实现代码、不改 `web/`、`src-tauri/`、`scripts/`。**
> 体例照 `.trellis/workspace/liangyuxiang/design-round-z-monitor-console.md` 与
> `design-round-y-milestones.md`：先给裁决，再给层级、`--sp-*`、几何、四态、色值、
> 可复算对比度、高度账、`data-probe` 与实现清单。

---

## 0. 语境与现状（写前逐字读过）

**读过的文件**：`.trellis/tasks/10-21-replay/prd.md`（R1-R9）；
`.trellis/workspace/liangyuxiang/design-round-z-monitor-console.md`（991 行，体例）、
`design-round-y-milestones.md`（1050 行，体例）；
`web/src/styles/tokens.css`（四个主题块全文）、`web/src/styles/focusRing.test.ts`；
`web/src/features/sessions/SessionAnalyzerPage.{tsx,module.css}`、
`SessionAnalyzerPage.layout.test.ts`、`SessionHeader.{tsx,module.css}`、
`LogView.module.css`（类别色与压缩行）、`logRows.ts`、`TimelineTrack.{tsx,module.css}`、
`ContextView.tsx`、`contextSeries.ts`、`tokenTotals.ts`、`costProvenance.ts`、
`BleedView.module.css`、`types.ts`（`ContextSample` / `CompactEvent`）；
`web/src/features/usage/pricingSnapshot.ts`、`web/src/lib/format.ts`；
`web/src/features/monitor/pulseCharts.{tsx,module.css}`、`pulseModel.ts`、
`MonitorPage.module.css`；
`web/src/components/{Panel,Button,SegmentedControl,EmptyState,ErrorState,Skeleton,ScrollArea}.tsx`
与各自的 `.module.css`；
`.trellis/spec/frontend/component-guidelines.md`、`quality-guidelines.md`、
`.trellis/spec/testing/gui-tests.md`、`docs/screenshots/views.json`。

**逐条核对过的既有事实**

- `AnalyzerView` 现为 `"log" | "tree" | "context" | "changes" | "bleed"`，由
  `SegmentedControl` 渲染，存 `localStorage["cca-analyzer-view"]`，默认 `log`
  （`SessionAnalyzerPage.tsx:44-65`）。第 6 项要同时进 `readStoredView` 的联合白名单。
- **上下文 / 改动 / 出血点三个标签页都不渲染 `TimelineTrack` + `FilterBar`**
  （`SessionAnalyzerPage.tsx:585-595`，注释写明理由：三者口径都是会话级全量，
  记录级筛选会让口径漂移）。**重放属于同一类，必须同样不渲染这两块**——
  重放的横轴是整条会话的墙钟，任何行级筛选都会让「片长 ÷ 墙钟」这个倍速失真。
- 页面骨架：`.page`（flex 纵向，`gap: var(--sp-3)`，`padding: var(--sp-3)`）→
  `SessionHeader` → `.body`（grid：`var(--sidebar-w)` + `minmax(0,1fr)` +
  可选 `var(--detail-w)`，`gap: var(--sp-4)`）→ `.workspace`（flex 纵向，
  `gap: var(--sp-3)`）→ `viewBar`(28px) → `.pane`（`flex: 1 1 0`，
  `min-height: 180px`）→ `.reportPane`（`flex: 0 0 auto`，`min-height: 160px`）。
  `≤1100px` 时侧栏 260px、详情面板落到第二行。
- `SessionHeader` 高 78px（border 2 + padding `--sp-2`×2 + 标题行 28（按钮
  `--control-h`）+ `--sp-1` + 读数行 28），130% 字号下 85px。
- 胶片带可以直接沿用 `TimelineTrack.module.css` 的轨道配方：1px `--border` 描边 +
  `--bg-elevated` 面 + 64px 竖纹（`.track` 66px 高 = 46 块区 + 14 刻度 + 6 余量）。
- **`LogView` 的类别 → 令牌映射是本轮唯一权威**：`user → --cat-user`、
  `llm → --cat-compute`、`tool → --cat-direct`、`subagent → --cat-delegated`、
  `workflow → --cat-workflow`、`wait → --cat-wait`；**`compact` 不占任何类别色**，
  它靠「通栏 + ◆ + 文字」表达（`LogView.module.css:248-289` 的注释逐字写明）。
- 压缩在地势图画法上另有先例：`pulseCharts` 的 `.cliff` = 1px
  `--text-tertiary` + `stroke-dasharray: 2 3` 竖虚线，注释写「断崖是要读的线，
  不是发丝分层，所以走 `--text-tertiary`（四主题 ≥4.78）」。
- `--warning` 的既定语义是「非确定信息」（`tokens.css:45-47`）。`--danger` 只给
  确定发生的错误。**压缩与停顿都是事实，一个都不许借 `--warning`。**
- `costProvenanceOf` 今天恒返回 `成本未知`，理由是「未收录该模型定价」；但
  `pricingSnapshot.estimateCost` 对 `claude-*` 三个家族能算。所以重放的「定价未知」
  是**逐会话**的真实分支，不是摆设。
- `formatDuration`（`4.2s` / `2m41s` / `1h3m`）、`formatClock(ms, withSeconds)`、
  `formatTokenCount`、`formatUsd` 是既有读数字形，不得自造第二种。
- `Button` 有 `variant` 四档与 `IconButton`（32px 见方，`label` 同时是
  aria-label 与 title）；**`Icon` 只有 `sun / moon / settings / refresh / search / close`
  六个名字**，没有播放箭头——本轮不新画 SVG，用几何字符（`◆` 已在压缩行与
  里程碑证据里用过，是既有做法）。
- `focusRing.test.ts` 当前锁死：`outline: var(--focus-ring-width)` **31** 处、
  `outline-offset: var(--focus-ring-offset)` **18** 处、
  `outline-offset: var(--focus-ring-inset)` **10** 处、焦点竖条 **7** 处、
  消费令牌的规则 **35** 条；另有「选中态字面量竖条恰好 7 处」的名单守卫。
- `docs/screenshots/views.json` 是截图视图名的**单一权威**（22 个视图，最新是
  `bleed`）。新增视图只改这一处 + `web/e2e/screenshots.spec.ts` 的声明。
- `.pane` 的 `min-height: 180px` 与 `.reportPane` 的 `min-height: 160px` 被
  `SessionAnalyzerPage.layout.test.ts` 逐字断言，**本轮不动这两条**。

---

## 1. 设计概念与一句话定位

### 1.1 一句话

> **重放是一台只读放映机：把一次会话的墙钟时间压进 30/60/120 秒，任一时刻都
> 如实说出「此刻在发生什么、已经累计了什么、上下文有多满」。**

### 1.2 为什么「影片」这个隐喻成立

不是比方好听，而是四个结构对应：

1. **会话本来就有播放顺序。** 日志的事件有先后，但日志表把每行拍成等高的行——
   10:38 的停顿和 10:41 的调用占一样的 30px。**只有重放保留「时间流过」这个维度。**
2. **影片的三种操作正好是分析的三个问题。** 播放 = 「整场的节奏怎么样」；暂停 =
   「这一秒到底在干什么」；点胶片 = 「直接跳到出事那一段」。
3. **倍速是一个可解释的单一数字。** 墙钟跨度 ÷ 片长 = `约 63×`，用户知道自己看的是
   被压缩 63 倍的真实时间，而不是被「看起来很快」骗。这是本视图唯一允许的速度承诺。
4. **影片有「帧」，帧必须诚实。** 播放头不在任何事件上时，画面必须说「停顿 2 分
   41 秒」，而不是把最近一条事件摆在那里假装它在发生（PRD R4）。

### 1.3 分工：一个概念一个窗口

| 视图 | 它的横轴 | 它回答 | 它**不**回答 |
| --- | --- | --- | --- |
| 日志视图 | 无（行序） | 逐条记录是什么、原文长什么样 | 什么时候发生（有时间戳，但没有位置感） |
| 树视图 | 无（层级） | 谁发起了谁、调用链断在哪 | 节奏 |
| 上下文 | 调用序号 | 上下文满不满、压缩切掉了哪一段 | 时间怎么流 |
| 改动 | 文件 | 哪些文件被动过、动了几次 | 何时动的 |
| 出血点 | 压缩点 | 每条消息在压缩时的 token 归属 | 会话是怎么跑到这一步的 |
| **重放** | **墙钟（线性）** | **这次会话是怎么发生的** | **内容全文、筛选、成本分布** |

四条边界（写进「明确不做」，也写进实现者的脑内红线段）：

1. **重放不做筛选。** 与 context / changes / bleed 同款理由：横轴一旦是整条会话的
   墙钟，行级筛选会让「片长 ÷ 墙钟」不再是同一个会话的倍速。
2. **重放不显示完整记录正文。** 舞台最多 2 行摘要——看全文是日志视图的事，也是它
   唯一做得好而重放做不好的事。
3. **重放不画成本分布。** 那是用量页的模型/项目维度。重放只说「已播放部分花了多少」。
4. **重放不新增第五种「这条记录重要」的判断。** 跃点全部来自 PRD R2 的
   `film.marks`，视图不自己挑「精彩片段」——挑片段就是编故事。

### 1.4 术语表（本文件与实现里只用这六个词）

| 词 | 定义 | 绝不能换成 |
| --- | --- | --- |
| **墙钟跨度** | `film.end − film.start`，两侧来自记录时间戳的 min/max | 「活动时长」「运行时长」——后半是推断 |
| **片长** | 用户选的 30 / 60 / 120 秒 | 「时长」（与墙钟跨度撞词） |
| **倍速** | 墙钟跨度 ÷ 片长，取整 | 「压缩率」 |
| **帧** | 播放头所在的一个墙钟时刻（`ReplayFrame`） | 「当前状态」 |
| **跃点** | `film.marks` 里的一条（起点 / 首个错误 / 最烧的一分钟 / 最长停顿 / 压缩） | 「里程碑」（那是用量页的词） |
| **停顿** | 相邻两条事件之间没有任何记录的一段区间 | 「等待」——会与 `wait` 类别（等用户）混淆 |

---

## 2. 三个必须先落的裁决

### 2.1 版式：两张卡，不是四张

PRD R3 列了四个区块（舞台 / 读数 / 胶片带 / 传送带）。**照字面做成四张卡是错的**：
页面在这个高度上已经有 `SessionHeader` 一张卡、报告区一张卡，再加四张就是一屏六张
卡——这是 Z 规格 §2 明令禁止的「卡套卡」。

**裁决**：

| 卡 | 装什么 | 为什么合在一张 |
| --- | --- | --- |
| **A `.screen`（幕）** | 舞台 + 发丝线 + 读数带 | 「此刻演什么」与「已经累计了什么」是同一块屏幕的两半；读数就是幕下的仪表 |
| **B `.reel`（片）** | 胶片带 + 发丝线 + 传送带 | 「整部片子的地图」与「放它的按键」是同一台机器 |

两张卡都是 `Panel` 的既有几何：`--bg-subtle` 面 + 1px `--border` + `--r-md` 圆角，
内部用**发丝线**分隔，**不再嵌套第二层 `--bg-subtle`**。卡 A 与卡 B 之间是
`var(--sp-3)` 的间隙。

### 2.2 颜色：类别色从 `LogView` 继承，压缩不占类别色

**裁决**：重放的事件字形用**和日志表完全相同的** `--cat-*` 映射，一个不换。

| kind | 令牌 | 该 token 在别处也意味着同一件事 |
| --- | --- | --- |
| `user` | `--cat-user` | `LogView` 用户行、`TimelineTrack` 用户块 |
| `llm` | `--cat-compute` | `LogView` LLM 行 |
| `tool` | `--cat-direct` | `LogView` 工具行 |
| `subagent` | `--cat-delegated` | `LogView` 子 agent 行 |
| `workflow` | `--cat-workflow` | `LogView` workflow 行 |
| `wait` | `--cat-wait` | `LogView` 等用户行 |
| `compact` | **不占类别色**：`--text-tertiary` 虚线断崖 | `pulseCharts` 的 `.cliff` |

理由：用户在同一屏里会同时看到日志表和重放（切标签），**同一个类别在两个视图里
必须是同一种颜色**——否则她要学两套。而 `compact` 在 `LogView` 里就已经
「一个类别色都不动」，靠几何（通栏）+ 形状（◆）+ 文字表达；到时间轴上，
「几何」就是**在它发生的那个时刻贯穿一条虚线**（pulse 的既有语言）。同一个事实，
两种几何，零新色。

`--warning` 只给两处，且都是「关于读数的确定性」而不是「关于会话的事实」：
`定价未知`（与 `BleedView` 的 `.cost` 用法一致），以及打开「跳过停顿」后的
`非等速 · 已跳过停顿`（见 §7.3——此时倍速读数不成立，是这个界面里唯一会
失效的读数）。压缩是事实、停顿是事实，两个都不借 `--warning`。

### 2.3 密度：按像素聚合，渲染节点数与会话规模无关

1074px 宽的胶片带遇上 10,000 行，若一事件一字形，平均间距 0.107px —— 那不是
「一片糊」，那是**什么都没画**。

**裁决**：**bin 的宽度由「最小可分辨间距 10px」定，不按事件数定**。

```
BINS  = floor(laneWidth / 10)          // 1074px → 107，634px → 63
bin(t)= min(BINS-1, floor(progressAt(t) * BINS))
```

每个 bin 内部：

| bin 内事件数 | 画法 |
| --- | --- |
| 1 | 该事件的类别字形（8px） |
| 2–3 | 密度柱，高 4px |
| 4–9 | 密度柱，高 8px |
| 10–29 | 密度柱，高 12px |
| ≥30 | 密度柱，高 16px |

密度柱的横向宽度 6px、色取 bin 内**主导类别**（出现次数最多；并列取
`user→llm→tool→subagent→workflow→wait→compact` 的先后）。

**渲染节点数上界**（可断言）：

| 会话规模 | 字形/密度柱 | 错误 tick | 跃点 | 刻度 + 播放头 | 合计 |
| --- | --- | --- | --- | --- | --- |
| 200 行（1074px） | ≤107 | ≤16 | ≤5 | 4 | **≤132** |
| 10,000 行（1074px） | ≤107 | ≤107 | ≤5 | 4 | **≤223** |
| 10,000 行（634px） | ≤63 | ≤63 | ≤5 | 4 | **≤135** |

节点数与 N **无关**，这是 R5「10,000 行单帧 < 16ms」在几何上的保证；剩下的是
`requestAnimationFrame` 与二分查找（PRD R5，不在本文件范围）。

**错误 tick 是独立的第四通道**：任何一个 bin 里有 `isError` 事件，就在该 bin 顶部
画一个 2×2 的 `--danger` 小方块。它不参与密度聚合、不被主导色吃掉——这是
「颜色不是唯一编码」在密度模式下仍然成立的原因。

---

## 3. 层级、顺序与间距

### 3.1 DOM 骨架（class 名可直接照做）

```tsx
<div className={styles.replay} data-probe="replay-root">
  {/* 卡 A：幕 */}
  <section className={styles.screen} aria-label="重放舞台">
    <div className={styles.stage} data-probe="replay-stage">
      <article className={styles.card} aria-labelledby="replay-card-label">
        <div className={styles.cardHead}>
          <span className={styles.kindChip} data-kind="tool">
            <span className={styles.glyph} aria-hidden="true">▮</span>工具
          </span>
          <span className={styles.position}>第 42 / 618 条</span>
          <span className={styles.sameTick}>同刻 2 / 3</span>{/* 仅同刻多条时 */}
        </div>
        <h3 className={styles.cardLabel} id="replay-card-label">Bash · npm test</h3>
        <p className={styles.cardDetail}>…2 行摘要…</p>
        <div className={styles.cardFoot}>
          <span className={styles.stamp}>10:41:07</span>
          <span className={styles.stamp}>时长 4.2s</span>
        </div>
      </article>
    </div>
    <div className={styles.reads} data-probe="replay-reads">
      <div className={styles.readGroup}>{/* 4 个计数 */}</div>
      <div className={styles.readGroup}>{/* prompt / output */}</div>
      <div className={styles.readGroup}>{/* 成本 */}</div>
      <div className={styles.water}>
        <span className={styles.waterLabel}>上下文</span>
        <span className={styles.waterTrack}>
          <span className={styles.waterFill} />
          <span className={styles.waterNotch} data-passed="false" />
        </span>
        <span className={styles.waterValue}>128,400 / 峰值 214,100</span>
      </div>
    </div>
  </section>

  {/* 卡 B：片 */}
  <section className={styles.reel} aria-label="会话胶片">
    <div className={styles.film} data-probe="replay-film">
      <p className={styles.srOnly}>…胶片文字摘要…</p>
      <div className={styles.legend} aria-hidden="true">{/* 7 类图例 + 计数 */}</div>
      <div className={styles.lane} role="slider" tabIndex={0}
           aria-label="重放进度" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={…} aria-valuetext={…} data-probe="replay-lane">
        <div className={styles.grid} aria-hidden="true" />
        <div className={styles.dense} aria-hidden="true" />
        <div className={styles.glyphs} aria-hidden="true" />
        <div className={styles.cliffs} aria-hidden="true" />
        <div className={styles.slots} aria-hidden="true" />
        <div className={styles.marks}>{/* 跃点按钮 */}</div>
        <div className={styles.head} aria-hidden="true" data-probe="replay-head" />
      </div>
      <div className={styles.axis} aria-hidden="true">{/* 起点 / 中点 / 终点 */}</div>
    </div>
    <div className={styles.transport} data-probe="replay-transport">
      <div className={styles.transportGroup}>{/* 5 个播放控件 */}</div>
      <div className={styles.transportGroup}>{/* 片长 30s/60s/120s */}</div>
      <button type="button" className={styles.gapSwitch} aria-pressed={…}>跳过停顿</button>
      <span className={styles.speed}>约 63×，60 秒看完</span>
    </div>
  </section>
  <p role="status" aria-live="polite" className={styles.srOnly}>{announcement}</p>
</div>
```

`.replay` 挂 `.pane` 里（`SessionAnalyzerPage` 的 `.pane > *` 规则会把它拉满），
**不带自己的一条滚动轴**：`overflow: visible`，让超出的部分交给页面滚动。

### 3.2 纵向顺序与权重

| 序 | 区块 | 高 | 弹性 | 为什么在这个位置 |
| --- | --- | --- | --- | --- |
| 1 | 舞台 | `min 148`，`flex: 1 1 auto` | **吃满剩余** | 它是主角，多出来的高度应该变成幕布留白，不是变成第六块 |
| 2 | 读数 | 72 | 固定 | 仪表紧贴幕下，读数必须能同时读到 |
| 3 | 胶片带 | 112 | 固定 | 地图在仪表之后、按键之前：先看整场，再动 |
| 4 | 传送带 | 40 | 固定 | 操作在最下 |

`viewBar`（标签切换 + 会话图状态 + 解析覆盖率）在 `.replay` **之上**，由页面渲染，
不在本视图内——重放不抢它的位置。

### 3.3 间距表

| 位置 | 值 | 说明 |
| --- | --- | --- |
| `.replay` 与卡 A/B 的间隙 | `var(--sp-3)` | 与 `.workspace` 同一档，页面节奏不变 |
| 卡内 `padding` | `var(--sp-3)` | `Panel` 的既有内边距 |
| 舞台内 `padding` | `var(--sp-3)` | 幕布四周同宽 |
| 卡 A 舞台 ↔ 读数 的分隔 | 1px `var(--border)` | 发丝线，不加间距 |
| 卡 B 胶片 ↔ 传送带 的分隔 | 1px `var(--border)` | 同上 |
| 读数带内部 | `12 / 6 / 20 / 12`（上/行隙/水位行/下） | 见 §5.1 |
| 胶片带内部 | `12 / 16 / 4 / 48 / 4 / 16 / 12` | 见 §6.1 |
| 传送带内部 | `8`（上）`+ 24`（控件）`+ 8`（下） | `--control-h-sm` 一行 |
| 读数项之间 | `var(--sp-4)` | 与 `SessionHeader` 读数行同档 |
| 传送带分区之间 | `var(--sp-3)` | 五个分区之间 |

**禁止**：`gap` 用 `--sp-4`（16）以上（会把两张卡推成三段）；卡片内再加 `--bg-subtle`
子卡片；用 `margin` 代替 `gap`。

### 3.4 为什么读数不是 KPI 大数字

页面上已有 `SessionHeader` 的五个 20px 读数。重放再摆一排 `--fs-lg` 的大数字，
读者会以为它们比头部那些更权威。**裁决**：读数带的值用 `--fs-md`（15px），
标签 `--fs-xs`（11px）——与 `BleedView` 的 `.counterName` / `.counterValue` 完全同构，
比头部低一级。数字的大小在这里**不表示重要性，只表示层级**。

---

## 4. 舞台（幕）

### 4.1 结构

```css
.stage {
  display: flex;
  min-height: 148px;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  padding: var(--sp-3);
}

.card {
  display: flex;
  width: 100%;
  max-width: 720px;
  flex-direction: column;
  gap: var(--sp-1);
  border-left: 2px solid var(--cat-direct); /* 由 data-kind 决定，见 4.3 */
  padding-left: var(--sp-3);
}

.card[data-error="true"] {
  border-left-color: var(--danger);
}
```

- `max-width: 720px` + 居中：宽窗下卡片两侧留白是**幕布**，不是没填满。屏幕上
  只有一个焦点，眼睛不用横扫 1074px。
- 左侧 2px 竖条是「形」通道（不是间距），色随 `data-kind` 走类别令牌——它让
  卡片在灰度截图里也能分辨类型，与 `LogView` 的行首竖条同族。
- 卡片**没有背景、没有边框、没有圆角**：它悬在卡 A 的 `--bg-subtle` 面上。
  再加一层白底就是「卡套卡」。

### 4.2 逐字内容（四种帧）

| 帧 | 内容 | 逐字 |
| --- | --- | --- |
| **正常帧** | 类目 chip | `工具`（`ROW_KIND_LABELS[kind]` 原文，不另起译名） |
| | 位置 | `第 42 / 618 条` |
| | 标题 | `row.label`（如 `Bash · npm test`） |
| | 摘要 | `row.summary`（`truncate` 到 2 行，超长 `…`） |
| | 脚注 | `10:41:07` 与 `时长 4.2s`（`formatClock(at, true)` / `formatDuration(durationMs)`；`durationMs === null` 时不渲染第二项，**不写 0s**） |
| **停顿帧** | 标题 | `停顿 2 分 41 秒` |
| | 上端 | `上一条 · 10:38:26 · 工具 · Bash npm test` |
| | 下端 | `下一条 · 10:41:07 · 用户 · 帮我改一下` |
| | 脚注 | `这两条之间没有任何记录。` |
| **错误帧** | 正常帧 + 一行 | `失败 · exit code 1`（`--danger`，600 字重） |
| **结束帧** | 正常帧（最后一条）+ 脚注追加 | `已放完 · 共 618 条 · 墙钟 1h3m` |

**停顿帧是关键**：PRD R4 要求「播放头不在事件上时显示停顿而非最近事件」。停顿帧
**不渲染事件卡**——它渲染的是一个「空」的事实，用两端的边界事件说明这段空在哪。
标题的 `2 分 41 秒` 用中文数字单位（`formatDuration` 给的是 `2m41s`，但停顿的时长
是**说给人听的**，用「分/秒」读起来才是话；这里允许一次措辞差异，因为
`formatDuration` 的口径是「紧凑读数」，停顿标题是「一句陈述」）。
若停顿跨越压缩边界，PRD R4 要求压缩必须被播放到——实现由 `film.events` 里
`compact` 事件的 `at` 保证，视觉上就是**停顿帧不会出现在压缩事件两侧之间**：
压缩事件落在停顿区间内时，`frameAt` 必须先给出压缩事件本身的那一帧。

### 4.3 字号与内部样式

| 元素 | 字号/行高 | 色 | 字重 |
| --- | --- | --- | --- |
| `.kindChip` | `--fs-xs` / `--lh-xs` | `--text-secondary`（文字）/ 类别色仅用于 8px 字形 | 400 |
| `.position` / `.sameTick` | `--fs-xs` / `--lh-xs` | `--text-tertiary` | 400，`tabular-nums` |
| `.cardLabel` | `--fs-lg` / `--lh-lg` | `--text` | 600 |
| `.cardDetail` | `--fs-sm` / `--lh-sm` | `--text-secondary` | 400 |
| `.stamp` | `--fs-xs` / `--lh-xs` | `--text-tertiary` | 400，`tabular-nums` |
| `.errorLine` | `--fs-sm` / `--lh-sm` | `--danger` | 600 |

`.cardLabel` 单行 `nowrap` + `text-overflow: ellipsis`；`.cardDetail`
`-webkit-line-clamp: 2`。**两者都不许把卡片撑过 136px**（见 §11.1 的高度账）。

`data-kind` 与左侧竖条：`user→--cat-user`、`llm→--cat-compute`、`tool→--cat-direct`、
`subagent→--cat-delegated`、`workflow→--cat-workflow`、`wait→--cat-wait`、
`compact→--text-tertiary`。七条映射与 §2.2 的表**必须逐字相同**（同一份映射，
不要写第二份）。

---

## 5. 读数带

### 5.1 结构与高度账

```
读数带 72 = 12（上） + 22（读数行 --lh-md） + 6 + 20（水位行） + 12（下）
水位行 20 = 轨道 12 + 上下各 4
```

七个读数分三组，用 `--sp-4` 间隔：

| 组 | 项 | 标签 | 值 |
| --- | --- | --- | --- |
| 已播放 | 1 | `消息` | `passed.messages` |
| | 2 | `工具` | `passed.tools` |
| | 3 | `错误` | `passed.errors` |
| | 4 | `压缩` | `passed.compacts` |
| 已花 | 5 | `prompt` | `formatTokenCount(passed.tokensPrompt)` |
| | 6 | `output` | `formatTokenCount(passed.tokensOutput)` |
| 成本 | 7 | `成本` | `formatUsd(passed.costUsd)` / `定价未知` |

**为什么 `prompt` / `output` 保留英文**：它们对应 `tokenTotals` 的四类计数器，
是 token 口径的专名。译成「输入/输出」会与 `SessionHeader` 已有的「输入」
（`input_tokens`，**不含缓存**）撞名——而那正是 PRD ② 要防的那个坑
（`tokensPrompt = input + cacheCreation + cacheRead`）。同一个词不能在一屏里指两件事。

`.read` 内部：标签 `--fs-xs` / `--lh-xs` / `--text-tertiary` → `--sp-1` → 值
`--fs-md` / `--lh-md` / 600 / `tabular-nums` / `--text`。这是全站定型的读数语言
（Z 规格 §3），重放不发明第二种。

「已播放」三个字是**口径的锚**：这七个数都是 `frame.passed`，不是整会话的合计。
整会话合计在 `SessionHeader` 里，两者永远不同——所以标签前缀必须是「已播放」，
且**只在读数行左端出现一次**（每个值前面都加会变成噪音）。

### 5.2 上下文水位条

```
上下文 [▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░] 128,400 / 峰值 214,100
        └ fill = 当前水位        └ 轨道余量    └ 当前 / 本片峰值
```

| 部件 | 几何 | 令牌 |
| --- | --- | --- |
| `.waterLabel` | `--fs-xs` / `--lh-xs`，不自缩 | `--text-tertiary` |
| `.waterTrack` | `flex: 1 1 auto`，高 12px，`border-radius: var(--r-xs)` | 底 `--bg-inset`，1px `--border` |
| `.waterFill` | 宽 = `当前 tokens ÷ 本片峰值 × 100%`，高满 | **`--chart-1` 实色** |
| `.waterNotch` | 宽 2px，高 16px（上下各出 2px），`border-radius: 1px` | 已发生 = `--text-tertiary` 实色；未播放 = 1px 虚线（`2 3`） |
| `.waterValue` | `--fs-xs` / `--lh-xs`，`tabular-nums` | `--text-secondary` |

**三条硬规矩**：

1. **不画模型上限。** 轨道的满量程是**本片观测到的峰值**，标签逐字写
   `峰值 214,100`。应用不知道 200k/1M 哪个是真的上限，画一条「官方上限」就是
   编造（`quality-guidelines.md` §Honest Readings 的「不做未经请求的外推」）。
2. **填充必须是实色。** 被否掉的候选：`--chart-1-soft` 在 `--bg-inset` 上只有
   **1.36 / 1.88 / 1.22 / 2.37**（浅/深/HC浅/HC深），远低于图形 3:1。实色是
   **5.07 / 9.12 / 6.90 / 9.97**。
3. **压缩断崖画在「水位」上，不画在「时间」上。** 这条横轴的量是 token 水位，
   所以断崖标记的 x = `preTokens ÷ 峰值`。它的身份是「在这么满的时候被切了一刀」，
   与胶片带上那条**按时间**画的虚线断崖是同一个事实的两种投影——两者都用
   `--text-tertiary` + 虚线族的形，读者学到一次就够。
   播放头还没走到压缩事件时，断崖是**空心虚线**；走过去之后才变实线——这是
   R4「未来不得显示成已发生」在读数带上的落点。

### 5.3 定价未知的两种形态

| 情形 | 成本位 | 脚注（读数带右端 `--fs-xs` / `--warning`） |
| --- | --- | --- |
| 全部事件都算得出 | `$1.83` | 无 |
| 部分算不出 | `$0.42` | `另有 42 条事件未计价` |
| 一条都算不出 | `定价未知` | `未收录该模型定价` |

**`$0.00` 永远不许出现**，除非 `passed.costUsd === 0` 且确实有事件被计价（罕见但
真实：极短会话）。判断顺序：`costUnknownEvents === 0` → 直接显示金额；
`costUsd === null` → `定价未知`；其余 → 金额 + 脚注。这三条与 PRD ③ 一一对应。

---

## 6. 胶片带

### 6.1 结构与 48px 泳道的高度账

```
胶片带 112 = 12（上） + 16（图例） + 4 + 48（泳道） + 4 + 16（刻度） + 12（下）
泳道 48   = 6（播放头帽） + 2 + 10（跃点层） + 2 + 2（错误 tick） + 2
            + 18（事件层） + 2 + 6（停顿槽）
```

坐标（泳道内，从顶算）：

| y | 层 | 内容 |
| --- | --- | --- |
| 0–6 | 播放头帽 | 6×6 `--accent` 方块，`pointer-events: none` |
| 8–18 | 跃点层 | 菱形 / 横带 / `+N` |
| 20–22 | 错误 tick | 2×2 `--danger` 方块，随 bin |
| 24–42 | 事件层 | 字形 8px（基线 42）或密度柱（从 42 向上 4/8/12/16） |
| 42–48 | 停顿槽 | 6px `--bg-inset` 凹槽 + 两端 1px 竖线 + 最长停顿的 2px 底线 |

```css
.lane {
  position: relative;
  height: 48px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background-color: var(--bg-elevated);
  background-image: repeating-linear-gradient(
    to right,
    var(--border) 0 1px,
    transparent 1px 64px
  );
  cursor: ew-resize;
}
```

**泳道底必须是 `--bg-elevated`，不是 `--bg-inset`。** 依据是算出来的：`--cat-user`
在 `--bg-inset` 上只有 **2.75**（浅色，低于图形 3:1），在 `--bg-elevated` 上是
**3.06**。这一个数字决定了泳道的底色（详见 §10.6 被否掉的候选）。

### 6.2 事件字形表（颜色 + 形状双通道）

| kind | 形状 | 画法 | 令牌 | 8px 下的辨识点 |
| --- | --- | --- | --- | --- |
| `user` | 实心圆 | `<circle r="4">` | `--cat-user` | 圆的 |
| `llm` | 实心方 | `<rect 8×8 rx="1">` | `--cat-compute` | 方的 |
| `tool` | 实心竖条 | `<rect 3×8 rx="1">` | `--cat-direct` | **细高的** |
| `subagent` | 双圆竖排 | 两个 `<circle r="2">`，y 各偏 2.5 | `--cat-delegated` | **两点一串** |
| `workflow` | 实心菱形 | `<rect 6×6>` 旋转 45° | `--cat-workflow` | 尖的 |
| `wait` | **空心方框** | `<rect 8×8>` stroke 1.5，fill none | `--cat-wait` | **镂空的** |
| `compact` | 断崖 | 1px 竖直虚线（`2 3`）贯穿 y 8–48 + 顶部 8×2 横杠 | `--text-tertiary` | 一条切开的线 |

三条纪律：

1. **字形尺寸 8px、描边 1.5px、播放头 2px 都是「形」，不是「距」**——
   `tokens.css` 头注释逐字允许（「描边宽度与图形尺寸不受此限」）。它们写模块
   局部变量（`--dot: 8px` 之类），**不进 `--sp-*` 档位**。
2. **未播放区（x > 播放头）的字形一律空心/描边**：实心 = 已发生，空心 = 还没演到。
   `compact` 断崖同理：未播放时是 1px 虚线，播放头走过之后仍保持虚线（它本来就是
   虚线），但横杠由空变实。**这里不用透明度**——透明度在浅色主题下与「弱化」、
   在深色主题下与「禁用」都会撞语义。
3. `wait` 是**事件**（等用户，来自 `toolCategory`），停顿是**区间**（相邻事件之间没有
   记录）。两者在画面上必须不同：`wait` 是空心方框在事件层，停顿是底部凹槽。
   把停顿画成 `wait` 形状是最容易犯的「把停顿写成事件」的错误。

### 6.3 图例行

一行，16px 高，`--fs-xs` / `--lh-xs` / `--text-tertiary`，`aria-hidden="true"`
（信息由下方的 `srOnly` 摘要承担，避免屏幕阅读器读一串色块）：

```
● 用户 12  ▪ LLM 296  ▮ 工具 288  ● 子 agent 6  ◆ workflow 2  □ 等用户 9  ┃ 压缩 1
```

- **只列存在的类别**（计数为 0 的不画）——一条 12 个用户的会话不需要看见
  「workflow 0」。
- 每个条目 = 字形（8px，用同一个 SVG 复用） + 名称 + 计数（`tabular-nums`）。
- 条目之间 `var(--sp-3)`。130% 字号下若超宽，**允许 `flex-wrap: wrap`**，
  胶片带随之长 16px（见 §11.3）。
- 图例是**颜色不是唯一编码**的第一份证据：它把颜色、形状、名称、计数四者绑在一起。

### 6.4 播放头与命中区

- 播放头：2px 宽，`--accent`，y 0–48 贯穿（`--bg-elevated` 上 5.64/7.21/9.52/8.33，
  `--bg-inset` 上 5.07/9.12/8.90/10.05——四主题都远超 3:1）。
- 帽：6×6 方块，y 0–6，同色。
- 命中区：**整个泳道**（`role="slider"`），`cursor: ew-resize`；
  `pointerdown` → `setPointerCapture` → `pointermove` 连续 scrub，
  `pointerup` 结束。点一下 = 跳到该 x 的时刻。
- 播放头**不做 transition**（§8.1）。

### 6.5 跃点标记

| kind | 形状 | x | 令牌 | 命中区 |
| --- | --- | --- | --- | --- |
| `start` | **不画**（坐标系原点） | 0 | — | 刻度左标签即入口 |
| `first-error` | 8×8 菱形（未播放时空心） | `progressAt(mark.at)` | `--danger` | 12×12 |
| `costliest-minute` | 3px 高横带，长 = 60 秒对应像素宽（≥8px） | `progressAt(mark.at)` 起 | `--chart-1` | 带高 12px |
| `longest-gap` | 停顿槽内的 2px 实心底线，长 = 该停顿的像素宽 | `progressAt(start)` | `--text-secondary` | 高 12px |
| `compact` | 同 6.2 的断崖 + 顶部 8×2 横杠 | `progressAt(mark.at)` | `--text-tertiary` | 12×12 |

- 跃点各自是 `<button>`（`aria-label` = `mark.label`，`title` = `mark.label`），
  落在 `.marks` 层；**Tab 序与时间序一致**。
- `costliest-minute` 用 `--chart-1` 的正当性：它的定义就是「60 秒窗口内 token 合计
  最大」，度量的量正是 token ——与 `--chart-1` 的既定语义（token 量的数据墨）
  完全同一件事。这是本轮唯一一次「图表色进时间轴」，理由写在注释里。
- **同刻多个跃点**（罕见但可能：会话在起点就压缩过）：跃点层 10px 高，最多并排
  2 个（各 4×4 缩小版）；第 3 个起合并成 `+N` 圆点（`--text-tertiary`，
  `title` 列出被并入的 label，点击跳到最后一个被并入的跃点）。
  该规则要有一条单测（PRD R8 的「点跃点」用例里加一个同刻夹具）。

### 6.6 时间刻度

一行 16px，`--fs-xs` / `--lh-xs` / `--text-tertiary` / `tabular-nums`，
`aria-hidden="true"`：

| 位置 | 内容 |
| --- | --- |
| 左（`left: 0`） | `formatClock(film.start, true)` → `10:12:04` |
| 中（`left: 50%`，`translateX(-50%)`） | `formatClock(start + span/2, true)` |
| 右（`right: 0`） | `formatClock(film.end, true)` |

- 三个标签都是**当天时刻**（HH:mm:ss），不是「+12:30」这种相对量：读者要能把它和
  日志表的时间列对上。
- **零跨度时三合一**：只渲染一个居中的单标签，且格式退化为 `10:41:07`
  （不重复三遍同一个时刻）。
- 三个 HH:mm:ss 在 634px 下占约 150px（每条约 50px，8 位数字 × 11px × 0.55 ≈ 48），
  永远放得下，不做碰撞剔除。

### 6.7 停顿槽

```
[事件层]  ▮ ▮   ▮         ▮ ▮
[停顿槽]      ├───────────┤        ← 两端 1px 竖线 + 2px 凹槽底
```

- 每个 `row.gap`（相邻事件之间的空档）在槽里画一段：底 = `--bg-inset`（对
  `--bg-elevated` 只有 1.11–1.21，所以它**不承担信息**，只是凹下去的地方），
  两端各一根 1px 竖线 `--text-tertiary`（4.78/5.45/10.45/9.98，≥3:1）。
- **最长停顿**在槽里多一条 2px 高的 `--text-secondary` 底线（`longest-gap` 跃点）。
- 停顿槽**不填充斜纹、不做渐变、不用透明度**：斜纹在本项目里已经是「进行中」的
  专有语汇（脉搏的当前分钟），用在停顿上会说反话。
- 槽是地图的一部分，所以「跳过停顿」开关**不改变槽的绘制**（§7.3）。

---

## 7. 传送带

### 7.1 控件顺序与逐字标签

从左到右五个分区：

| # | 控件 | 实现 | 可见文字 | 可访问名 |
| --- | --- | --- | --- | --- |
| 1 | 跳到开头 | `IconButton` | `\|◀` | `跳到开头` |
| 2 | 上一事件 | `IconButton` | `◀` | `上一事件` |
| 3 | 播放/暂停 | `Button variant="primary"` | `播放` / `暂停` | 同可见文字 |
| 4 | 下一事件 | `IconButton` | `▶` | `下一事件` |
| 5 | 跳到结尾 | `IconButton` | `▶\|` | `跳到结尾` |

- 全部复用 `Button` / `IconButton`：焦点环、hover、disabled 的既有画法一行都不用重写，
  `focusRing.test.ts` 的计数也不会因为传送带而变。
- **播放/暂停是唯一的主按钮**（`--ink` 底），四个步进是 ghost。播放中它变成
  `暂停`——两个字都靠文字而非图标，所以 `getByRole("button", { name: "播放" })`
  在测试里直接可查。
- 几何字符只用 `| ◀ ▶` 三个码位（U+007C / U+25C0 / U+25B6），不引入 `⏮ ⏭ ⏸`
  ——后三个在部分系统字体里是豆腐块，而本项目没有图标字体。

| # | 控件 | 逐字 | 说明 |
| --- | --- | --- | --- |
| 6 | 片长 | `片长` + `30s` `60s` `120s` | `SegmentedControl`，`ariaLabel="片长"` |
| 7 | 跳过停顿 | `跳过停顿` | `button[aria-pressed]`（FilterBar chip 的既有语言） |
| 8 | 倍速读数 | `约 63×，60 秒看完` | `--fs-xs`，`--text-secondary`，`tabular-nums` |

`30s` 而不是 `30 秒`：`formatDuration` 已经全站用 `4.2s` / `2m41s`，
片长是同一族的**读数**，不是一句中文话。中文「秒」只出现在 §7.1 的倍速句子里
（那里确实是一句话）。

### 7.2 宽度账（可复算）

传送带内宽 = 卡 B 内宽 = `paneWidth − 2（卡边框）− 24（padding）`。

| 视口 | workspace | 传送带内宽 | 100% 下需要 | 130% 下需要 |
| --- | --- | --- | --- | --- |
| 1440（无详情） | 1100 | 1074 | ~567 | ~659 |
| 1440（详情开） | 724 | 698 | ~567 | ~659 |
| 960（应用最窄） | 660 | **634** | **~567 ✓** | **~659 ✗ → 折行** |

100% 下的分项（可逐项复核）：

| 分项 | 宽 |
| --- | --- |
| 4 × `IconButton` 32 + 3 × `--sp-1` | 128 + 12 = 140 |
| 播放按钮（`暂停` 2 CJK 24 + padding 20） | 44 |
| `片长` 标签（2 CJK 22）+ `--sp-1` | 26 |
| `SegmentedControl`（3 项 ≈ 44 + 44 + 50 + padding 4 + gap 4） | 146 |
| `跳过停顿` chip（4 CJK 44 + padding 24） | 68 |
| 倍速句子（约/，/秒/看/完 ≈ 5 CJK 55 + `63×` `60` ≈ 30 + 空格 8） | 93 |
| 5 个分区之间 4 × `--sp-3` | 48 |
| **合计** | **565** |

634 − 565 = **69px 余量**（100%，960 最窄档）。

**130% 下折行是允许的，且只发生在这里**：字号放大 30%，`--sp-*` 与控件宽不缩放，
文字部分约 565 → 659，超 634 共 25px。`flex-wrap: wrap` 后分段落到第二行，
传送带 40 → 76（`+ --sp-1` × 2 + 24），栈高 390 → 426。**这是 130% 档唯一的
尺寸增长点**，验收时按「不横向溢出、不裁行」断言，不按绝对高度断言（§11.3）。

### 7.3 倍速与「跳过停顿」的诚实说明

- 倍速读数 = `Math.round(墙钟跨度 / 片长)`，片长取当前值。它是**两个数的商**，
  不是估算，所以不加「约」以外任何限定词（`约` 是取整的诚实标记）。
- **打开「跳过停顿」后倍速数字就不成立了**（时间轴不再等速）。此时倍速位改为
  `非等速 · 已跳过停顿`（`--warning`），并在 `title` 里写
  `跳过停顿后播放头不再等速移动，倍速读数不适用`。
  这不是文案装饰：PRD 明确要求「写明时间轴不再是等速的」。
- 开关打开**不改变胶片带**（停顿槽照旧画在它真实的位置上），只改变播放头在
  停顿区间里的停留时间（0）。地图不能被播放设置改写，否则同一条会话会出现两张
  地图。
- 关闭时立刻恢复等速与倍速读数。**不记忆**（切标签即重置为关）。

### 7.4 禁用态矩阵

| 情形 | 播放 | 上/下一事件 | 开头/结尾 | 片长 | 跳过停顿 |
| --- | --- | --- | --- | --- | --- |
| 正常 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 单事件 | disabled | disabled | disabled | disabled | disabled |
| 零跨度（≥2 条同刻） | disabled | ✓（逐条换卡） | ✓ | disabled | disabled |
| 解析中 / 无记录 | 整个 `.replay` 不渲染（页面级四态接管） | | | | |
| 播放到结尾 | 显示 `播放`（可重播） | ✓ | ✓ | ✓ | ✓ |

禁用用 `Button` 既有的 `disabled`（`opacity: .5` + `cursor: not-allowed`），
**不自造禁用样式**。

---

## 8. 动效

### 8.1 裁决：数据层零补间

**播放头的移动没有 transition，水位条的长度没有 transition，事件卡的切换没有
淡入淡出。** 播放时它们由 `requestAnimationFrame` 每帧直接写值；跳转时（点胶片、
点跃点、键盘、换片长）它们**瞬时到位**。

理由有三条，缺一条都不成立：

1. **补间会伪造中间读数。** 若跳转用 220ms 过渡，这 220ms 里读数会经过一串
   「从未发生过的帧」——而 PRD R4 的整条诚实性要求是「任一时刻如实说此刻」。
   动画是表现层，但读数是事实层，事实层不许被插值。
2. **播放头上没有「过渡」这个物理量。** 真实播放是连续的，跳转是离散的。给离散
   动作加补间，等于假装它是连续播放。
3. **`prefers-reduced-motion` 因此不需要「替代动画」，只需要关掉控件过渡。**
   这让 reduced-motion 从「一套要维护的第二视觉」降级成一行 CSS。

### 8.2 允许存在的动效（全清单，四处）

| # | 对象 | 属性 | 时长 / 缓动 | 令牌 |
| --- | --- | --- | --- | --- |
| 1 | 播放/暂停按钮 | `background-color` | 80ms / `--ease-in-out` | `--dur-hover` |
| 2 | `跳过停顿` chip | `background-color` / `border-color` / `color` | 140ms / `--ease-in-out` | `--dur-state` |
| 3 | 片长 `SegmentedControl` 项 | 同上（组件自带） | 80ms | `--dur-hover` |
| 4 | 跃点按钮 hover | `opacity`→ 改为 `filter: brightness()`？**否**：改用 `background-color` 的 12×12 底 | 80ms | `--dur-hover` |

第 4 条注意：跃点按钮若没有底，hover 无处可动。给它一个 `border-radius: var(--r-xs)`
的透明底，hover 时 `background: var(--bg-hover)`。**不缩放、不移位**——跃点的位置
就是时刻，位置一动读数就假。

**全仓库唯一允许的动态循环 `--dur-pulse`（1400ms）本轮一次都不用。** 播放中不需要
呼吸灯：播放头在动，那就是唯一的「正在播放」指示。

### 8.3 `prefers-reduced-motion: reduce`

```css
@media (prefers-reduced-motion: reduce) {
  .gapSwitch, .transport button { transition: none; }
}
```

- **不自动播放**：本视图**默认就不自动播放**（见 §8.4），所以 reduced-motion 下
  行为与默认一致，不需要第二套逻辑。
- 无补间：数据层本来就没有补间（§8.1），reduce 下把控件过渡也去掉，页面变成
  「点一下就变」。
- 播放本身**不被禁用**：reduced-motion 的用户仍然要求看时间顺序，只是不要装饰性
  运动。播放头的移动是**信息**，不是装饰。

### 8.4 进入视图不自动播放（裁决）

PRD R6 提到「reduced-motion 时不自动播放」，暗示默认是自动播放。**本规格裁决：
任何情况下都不自动播放，包括第一次进入标签页。**

1. 自动播放会与诚实性冲突：用户切到重放时画面自己在动，读数在被覆盖，她看到的
   第一个数字是随机时刻的。
2. 全站没有任何自动播放的先例。脉搏页是数据流（时间真的在走），不是「播放」。
3. **一个自己动起来的播放头会让人以为会话正在运行**——这正是
   `quality-guidelines.md` §Honest Readings 明令禁止的那类暗示
   （「只陈述多久前有新记录，不代表会话正在运行」）。

若评审要求保留自动播放，则约束是：**只在挂载后播放一次、绝不循环、reduced-motion
下不播放，且播放前先渲染 t=0 的一帧**。本规格不采用。

---

## 9. 状态矩阵

### 9.1 页面级四态（不在本视图内，逐字沿用既有）

| 态 | 落点 | 逐字 |
| --- | --- | --- |
| 未选会话 | `EmptyState size="page"` | `选择一个会话开始分析` / `从左侧列表挑一个会话，或先在搜索框里按会话 ID、目录筛选。` |
| 解析中 | `.parsing` + `Skeleton variant="table"` | `正在解析会话 42%` |
| 扫描失败 | `ErrorState size="page"` | `会话列表读取失败` / `本机 ~/.claude/projects 里的会话没能读出来。确认目录可读后重试。` |
| 解析失败（已有会话） | `ErrorState` | 沿用既有 |

**`ReplayView` 内部不实现加载态**：它只在 `parsed` 存在时挂载。造一个视图内的
骨架屏等于承认「有两条加载路径」，而实际只有一条。

### 9.2 视图内九态

| # | 态 | 触发 | 落点 | 文案（逐字） | 视觉 |
| --- | --- | --- | --- | --- | --- |
| 1 | **正常** | `film.events.length ≥ 2` 且有跨度 | 全视图 | — | 四块齐全 |
| 2 | **无记录** | `rows.length === 0` | 卡 A 内 `EmptyState size="panel"` | `这次会话没有可播放的记录` / `日志里没有任何能定位到时刻的记录。` | 卡 B 不渲染（没有地图可画） |
| 3 | **单事件** | `events.length === 1` | 舞台脚注 + 传送带禁用 | `只有 1 条记录，没有时间跨度可播放。` | 胶片带：1 个字形 + 单标签刻度 `10:41:07`；读数额外脚注 `跨度 0s` |
| 4 | **零跨度** | `film.end === film.start && events.length ≥ 2` | 舞台脚注 + 传送带禁用 | `3 条记录都在同一时刻（10:41:07），没有时间跨度可播放。` | 胶片带：全部字形叠在 bin 0（显示为 1 个密度柱，高 4px）+ 单标签刻度；播放头固定在左端 |
| 5 | **全部同刻（跨度 > 0）** | 所有 `event.at` 相同但 `end > start`（压缩边界记录在事件范围外） | 舞台脚注 | `3 条记录都在 10:41:07，其余时间没有事件。` | 播放头会走完全程，但卡片不变；传送带可用（可以看它「空跑」——这也是事实） |
| 6 | **无 token 读数** | `passed.tokensPrompt + tokensOutput === 0` 且 `samples.length > 0` 之外 | 读数带 | prompt/output 位显示 `—`；水位条内居中 `本段没有可核对的上下文读数` | 水位条只留空轨道（不画 0% 填充——0 与「没有读数」是两件事） |
| 7 | **定价未知** | `passed.costUsd === null` 或 `costUnknownEvents > 0` | 读数带第 7 项 | `定价未知` / 脚注 `未收录该模型定价` 或 `另有 42 条事件未计价` | 值与脚注 `--warning`；**不出 $0.00** |
| 8 | **停顿中** | `frame.current === null && frame.gap !== null` | 舞台 | `停顿 2 分 41 秒` + 两端事件 + `这两条之间没有任何记录。` | 不渲染事件卡；左侧 2px 竖条用 `--border-strong`（无类别） |
| 9 | **播放结束** | `progress === 1 && !playing` | 舞台脚注 + live region | `已放完 · 共 618 条 · 墙钟 1h3m` | 播放按钮回到 `播放`；胶片带右端字形全实心 |

第 6 条的 `—` 是**破折号（U+2014）**，不是连字符、不是 `0`、不是 `N/A`。
它与 `BleedView` 的 `triggerLabel` 返回的 `—` 同一字符，全站一致。

### 9.3 文案诚实性自查（这些写法一律不许出现）

| 不许写 | 为什么 | 应该写 |
| --- | --- | --- |
| `0 tokens` | 没有 usage ≠ 用了 0 个 token | `—` + `本段没有可核对的上下文读数` |
| `$0.00` | 未计价 ≠ 免费 | `定价未知` + `未收录该模型定价` |
| `正在思考…` | 日志里没有「思考」这个事实 | `停顿 2 分 41 秒` |
| `已等待 3 分钟` | 「等待」暗示有个对象在等 | `停顿 3 分 0 秒` |
| `会话已运行 1 小时` | 墙钟跨度不是运行时长 | `墙钟 1h3m` |
| `进度 42%`（作为唯一读数） | 百分比不告诉你到哪一刻 | `10:41:07` 与 `第 42 / 618 条` 同时给 |

---

## 10. 主题与对比度（实算）

### 10.1 零新增令牌

本轮**新增令牌 0 个**。消费清单（26 个，全部已存在于 `tokens.css`）：

表面：`--bg`、`--bg-subtle`、`--bg-elevated`、`--bg-inset`、`--bg-hover`；
墨色：`--text`、`--text-secondary`、`--text-tertiary`；
语义：`--danger`、`--warning`、`--accent`、`--accent-soft`；
类别：`--cat-user`、`--cat-compute`、`--cat-direct`、`--cat-delegated`、
`--cat-workflow`、`--cat-wait`；
数据墨：`--chart-1`；
线：`--border`、`--border-strong`；
字号/行高：`--fs-xs/--lh-xs`、`--fs-sm/--lh-sm`、`--fs-md/--lh-md`、`--fs-lg/--lh-lg`；
间距：`--sp-05`、`--sp-1`、`--sp-2`、`--sp-3`、`--sp-4`；
圆角：`--r-xs`、`--r-sm`、`--r-md`；
控件/焦点：`--control-h-sm`、`--control-h-lg`、`--focus-ring-width`、
`--focus-ring-offset`；
动效：`--dur-hover`、`--dur-state`、`--ease-in-out`。

**不许出现的字面量**：颜色（`#`/`rgb()`）、间距、圆角、时长。允许的字面量只有
「形」：泳道 48px、字形 8px、播放头 2px、水位轨道 12px、跃点 8px、tick 2px、
`--control-h-lg`（已是令牌）。

### 10.2 公式与门槛

```
L       = 0.2126·R' + 0.7152·G' + 0.0722·B'
R'      = R/255 ≤ 0.04045 ? (R/255)/12.92 : ((R/255+0.055)/1.055)^2.4
对比度  = (max(L1,L2) + 0.05) / (min(L1,L2) + 0.05)
```

门槛：正文（≤18px 常规体）≥ **4.5:1**；图形（字形、线、填充、播放头）≥ **3:1**。
`rgba()` 令牌先按 `--bg` 合成再算（复现脚本 §10.7 已实现）。

### 10.3 表 A：胶片字形（泳道底 `--bg-elevated`）

| 前景 | 浅 | 深 | HC 浅 | HC 深 | 门槛 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| `--cat-user`（user 圆） | **3.06** | 5.53 | 6.89 | 9.12 | 3 | 过（全表最低值） |
| `--cat-compute`（llm 方） | 3.42 | 4.94 | 6.06 | 9.11 | 3 | 过 |
| `--cat-direct`（tool 竖条） | 5.19 | 6.32 | 7.26 | 8.10 | 3 | 过 |
| `--cat-delegated`（subagent 双圆） | 3.87 | 4.37 | 6.51 | 8.27 | 3 | 过 |
| `--cat-workflow`（workflow 菱形） | 6.51 | 5.22 | 10.09 | 7.26 | 3 | 过 |
| `--cat-wait`（wait 空框） | 4.83 | 5.45 | 7.56 | 9.57 | 3 | 过 |
| `--danger`（错误 tick） | 6.54 | 6.09 | 8.06 | 8.70 | 3 | 过 |
| `--text-tertiary`（压缩断崖） | 4.78 | 5.45 | 10.45 | 9.98 | 3 | 过 |
| `--chart-1`（最烧一分钟横带） | 5.64 | 7.83 | 7.82 | 8.26 | 3 | 过 |

### 10.4 表 B：文字（卡面 `--bg-subtle`）

| 前景 | 浅 | 深 | HC 浅 | HC 深 | 门槛 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| `--text` | 17.79 | 16.15 | 21.00 | 18.73 | 4.5 | 卡片标题、读数数值 |
| `--text-secondary` | 7.87 | 9.44 | 14.34 | 13.66 | 4.5 | 摘要、倍速句子 |
| `--text-tertiary` | **4.78** | 5.83 | 10.45 | 10.74 | 4.5 | 标签、刻度、图例（全表最低文字值） |
| `--danger` | 6.54 | 6.52 | 8.06 | 9.37 | 4.5 | 失败行 |
| `--warning` | 5.24 | 8.17 | 7.13 | 12.12 | 4.5 | 定价未知、非等速提示 |

**注意**：`--text-tertiary` 在页面底 `--bg` 上只有 **4.38**（浅色，低于 4.5）。
所以**读数带与刻度必须在卡面上，不能在页面底上**——这一条决定了卡 A / 卡 B
的存在（§2.1），不是审美偏好。页底状态行若出现，必须用 `--text-secondary`。

### 10.5 表 C：图形与线

| 前景 | 底 | 浅 | 深 | HC 浅 | HC 深 | 门槛 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `--accent`（播放头） | `--bg-elevated` | 6.62 | 7.21 | 9.52 | 8.33 | 3 | 过 |
| `--accent`（播放头跨凹槽） | `--bg-inset` | 5.95 | 8.39 | 8.41 | 10.05 | 3 | 过 |
| `--chart-1`（水位填充） | `--bg-inset` | 5.07 | 9.12 | 6.90 | 9.97 | 3 | 过 |
| `--text-tertiary`（停顿槽两端） | `--bg-elevated` | 4.78 | 5.45 | 10.45 | 9.98 | 3 | 过 |
| `--text-secondary`（最长停顿底线） | `--bg-inset` | 7.87 | 8.82 | 14.34 | 12.69 | 3 | 过 |

### 10.6 被否掉的候选（带实算）

| 候选 | 算出来的比值 | 为什么否 |
| --- | --- | --- |
| 泳道底用 `--bg-inset` | `--cat-user` = **2.75**（浅） | 低于 3:1，用户的圆在浅色下糊进凹槽。改用 `--bg-elevated`（3.06） |
| 水位填充用 `--chart-1-soft` | 1.36 / 1.88 / 1.22 / 2.37 | 四主题全崩，图形信息等于没画。改实色 `--chart-1`（5.07+） |
| 停顿槽两端用 `--border-strong` | 1.59 / 1.38（普通两档） | HC 下反而 9.27/6.99 能用，但普通档看不见「这段是空的」边界。改 `--text-tertiary` |
| 未播放区用 `opacity: 0.45` | — | 透明度在浅色=弱化、深色=禁用、HC=不该有弱化。改用空心/实心双形态 |
| 压缩用 `--warning` | — | `--warning` 的语义是「非确定信息」，压缩是确定发生的事实 |
| 压缩占用 `--cat-*` | — | 类别色已被 6 个 kind 占满；`LogView` 已经裁决「压缩不占类别色」 |
| 跃点用 `--accent` | 6.62（够） | 强调色一旦同时是「播放头」和「跃点」，两件事在图上就同色了。跃点按语义分色（错误红 / token 蓝 / 停顿次级灰） |

### 10.7 复现脚本

```js
// node aa-contrast.mjs（在仓库根目录跑；只读 web/src/styles/tokens.css）
import { readFileSync } from "node:fs";

const css = readFileSync("web/src/styles/tokens.css", "utf8");
const BLOCKS = [
  ["light", ":root {"],
  ["dark", '[data-theme="dark"] {'],
  ["hc-light", '[data-contrast="high"] {'],
  ["hc-dark", '[data-theme="dark"][data-contrast="high"] {']
];

function vars(selector) {
  const at = css.indexOf(selector);
  const text = css.slice(at, css.indexOf("\n}", at));
  const map = new Map();
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}
const channel = (v) => ((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))(v / 255);
const lum = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
function parse(color, base) {
  if (color.startsWith("#")) {
    const v = color.slice(1);
    const f = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
    return { r: parseInt(f.slice(0, 2), 16), g: parseInt(f.slice(2, 4), 16), b: parseInt(f.slice(4, 6), 16) };
  }
  const p = color.match(/rgba?\(([^)]+)\)/)[1].split(",").map((x) => parseFloat(x.trim()));
  const a = p.length > 3 ? p[3] : 1;
  const bg = parse(base, "#ffffff");
  return { r: p[0] * a + bg.r * (1 - a), g: p[1] * a + bg.g * (1 - a), b: p[2] * a + bg.b * (1 - a) };
}
const ratio = (f, b) => {
  const [x, y] = [lum(f), lum(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};

const PAIRS = [
  ["cat-user", "bg-elevated"], ["cat-compute", "bg-elevated"],
  ["cat-direct", "bg-elevated"], ["cat-delegated", "bg-elevated"],
  ["cat-workflow", "bg-elevated"], ["cat-wait", "bg-elevated"],
  ["danger", "bg-elevated"], ["text-tertiary", "bg-elevated"],
  ["chart-1", "bg-elevated"], ["text", "bg-subtle"],
  ["text-secondary", "bg-subtle"], ["text-tertiary", "bg-subtle"],
  ["danger", "bg-subtle"], ["warning", "bg-subtle"],
  ["accent", "bg-elevated"], ["accent", "bg-inset"],
  ["chart-1", "bg-inset"], ["text-tertiary", "bg"],
  ["cat-user", "bg-inset"], ["chart-1-soft", "bg-inset"],
  ["border-strong", "bg-subtle"]
];

for (const [name, selector] of BLOCKS) {
  const V = vars(selector);
  const get = (t) => parse(V.get(t), V.get("bg"));
  const line = PAIRS.map(([f, b]) => `${f}/${b}=${ratio(get(f), get(b)).toFixed(2)}`);
  console.log(name, line.join("  "));
}
```

---

## 11. 960 窄窗与 130% 字号

### 11.1 高度账（逐项可加）

**基准式**（1440×900、无详情面板、TokenPanel 收起、报告未生成）：

```
窗口 900
− topbar                                   48  → 852
− .page padding 上/下                    12+12 → 828
− SessionHeader                            78  → 738（页间隙 12 之后 body 的高度）
  body = 738；workspace 列：
  viewBar 28 + gap 12 + pane + gap 12 + reportPane 160 = 738
  → pane = 738 − 28 − 12 − 12 − 160 = 526
```

**`.replay` 内部（完整档，视口高 ≥ 800）**：

| 块 | 高 | 账 |
| --- | --- | --- |
| 卡 A 边框 | 2 | 1+1 |
| 舞台 | **284**（`flex`，`min 148`） | 见下 |
| 发丝线 | 1 | |
| 读数带 | 72 | 12 + 22 + 6 + 20 + 12 |
| 卡 A 小计 | **359** | 2 + 284 + 1 + 72 |
| `.replay` gap | 12 | `--sp-3` |
| 卡 B 边框 | 2 | |
| 胶片带 | 112 | 12 + 16 + 4 + 48 + 4 + 16 + 12 |
| 发丝线 | 1 | |
| 传送带 | 40 | 8 + 24 + 8 |
| 卡 B 小计 | **155** | 2 + 112 + 1 + 40 |
| **合计** | **526** | 359 + 12 + 155 ✅ 与 pane 严丝合缝 |

舞台 284 由剩余高度吸收：`526 − (2+1+72) − 155 − 12 = 284`。
卡片本体最高 136（见下），在 284 里垂直居中，上下各 74 的幕布留白。

**卡片高度上界（不得超）**：

```
padding 12+12 = 24
cardHead      20    （chip fs-xs 16 + padding 2×2）
gap            4
cardLabel     28    （--fs-lg 20 / --lh-lg 28，单行）
gap            4
cardDetail    36    （--fs-sm 18 × 2 行 clamp）
gap            4
cardFoot      16    （--fs-xs 16）
------------------------
合计         136
```

**最小栈高（可断言的地板）**：

| 档 | 触发 | 舞台 | 读数 | 胶片 | 传送 | 间距 | 栈高 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 完整 | `min-height: 800px` | 148 | 72 | 112 | 40 | 12+2+1 | **390** |
| 紧凑 | `max-height: 799px` | 124 | 64 | 92 | 36 | 8+2+1 | **330** |

**390 ≤ 400**：重放栈本身落在「展开区 400px 上限」的惯例之内。

**960×640**：`pane = 640 − 374 = 266` < 330（紧凑档地板）→ 页面纵向滚动 **64px**。
这是**既有且被明文允许**的行为（`SessionAnalyzerPage.layout.test.ts`：
「allows analyzer content to scroll at 960x640」，`.content { overflow: auto }`）。
关键断言是**不出现第二重滚动**（`.replay` 与 `.lane` 都不设 `overflow: auto`）
与**不裁行**（每块按自身高度渲染，不被压扁）。

**130% + 1440×900**：`SessionHeader` 78 → 85，`pane = 526 − 7 = 519`，
舞台 = 519 − 75 − 167 = **277** ✅。

### 11.2 横向账

| 视口 | workspace 宽 | 卡内宽（lane） | `BINS` | 一屏能放的字形数 |
| --- | --- | --- | --- | --- |
| 1440（无详情） | 1416 − 300 − 16 = **1100** | 1100 − 2 − 24 = **1074** | 107 | 107 |
| 1440（详情开） | 1416 − 300 − 16 − 16 − 360 = **724** | **698** | 69 | 69 |
| 1400（默认窗） | 1376 − 300 − 16 = **1060** | **1034** | 103 | 103 |
| 960（最窄，侧栏降 260） | 936 − 260 − 16 = **660** | **634** | 63 | 63 |

`BINS = floor(laneWidth / 10)`。这个数同时是「密度分层的开关」与「一屏上限」，
两个含义是同一个数——所以它必须由宽度算，不能由事件数算。

### 11.3 不裁行、不折行的策略

| 元素 | 100% | 130% | 策略 |
| --- | --- | --- | --- |
| 读数行（7 项） | ~517 ≤ 634 ✓ | ~596 ≤ 634 ✓ | 不折行 |
| 图例（7 类） | ~480 ≤ 634 ✓ | ~592 ≤ 634 ✓ | 不折行；若 CJK 回退更宽则 `flex-wrap`（+16px） |
| 传送带 | 565 ≤ 634 ✓ | ~659 > 634 ✗ | **允许折成两行**（+36px），见 §7.2 |
| 舞台卡片 | 636（`max 720`） | 636 | 不折行；标题单行 ellipsis、摘要 2 行 clamp |
| 刻度（3 标签） | ~150 | ~195 | 不折行 |

「不裁行」的硬要求：**任何一块都不使用 `overflow: hidden` 去藏内容**。只有三处
例外，且都是有意的：`.lane`（地图不能溢出）、`.cardLabel` / `.cardDetail`
（clamp 是信息分级，不是隐藏——全文在日志视图）。

---

## 12. 无障碍

### 12.1 语义与可访问名

| 元素 | role / 属性 | 可访问名 / 值 |
| --- | --- | --- |
| `.screen` | `<section aria-label>` | `重放舞台` |
| `.reel` | `<section aria-label>` | `会话胶片` |
| `.stage` | 无（容器） | — |
| `.card` | `<article aria-labelledby>` | 由 `.cardLabel` 提供 |
| `.lane` | `role="slider"` `tabIndex=0` | `aria-label="重放进度"`、`aria-valuemin=0`、`aria-valuemax=100`、`aria-valuenow=Math.round(progress*100)`、`aria-valuetext`（见下） |
| 跃点 | `<button>` | `mark.label`（如 `首个错误 · 10:47:12`） |
| 播放/暂停 | `<button>` | `播放` / `暂停` |
| 四个步进 | `IconButton label` | `跳到开头` / `上一事件` / `下一事件` / `跳到结尾` |
| 片长 | `role="tablist"`（SegmentedControl） | `片长`；各项 `30s` / `60s` / `120s` |
| 跳过停顿 | `<button aria-pressed>` | `跳过停顿` |
| 倍速 | 纯文本 | 由 live region 之外的静态文本承担，不进 tab 序 |
| 胶片摘要 | `<p class="srOnly">` | 见 12.4 |

`aria-valuetext` 的逐字格式：

```
10:41:07，第 42 / 618 条，工具，Bash npm test
10:38:40，停顿中（10:38:26 至 10:41:07，2 分 41 秒）
```

停顿态的 `aria-valuetext` 是**停顿帧存在的证据**：屏幕阅读器用户无法「看到」那片
空白，只能靠这行字知道此刻没有事件。

### 12.2 键盘映射

挂在 `.replay` 的 `onKeyDown`（冒泡），命中规则：

| 键 | 行为 | 生效条件 |
| --- | --- | --- |
| `Space` | 播放 / 暂停 | 焦点在视图内，且 `event.target` **不是** `button / input / select / a / textarea` |
| `←` | 上一事件（`progressAt` 二分到前一条） | 同上 |
| `→` | 下一事件 | 同上 |
| `Home` | 跳到 `progress = 0` | 同上 |
| `End` | 跳到 `progress = 1` | 同上 |
| `Shift + ←/→` | 微调 1%（`KEYBOARD_NUDGE` 口径与 `TimelineTrack` 的 0.02 **不同**，取 0.01） | 焦点在 `.lane` 上 |

为什么要 `event.target` 判定：`Space` 在 `<button>` 上会激活按钮。若不排除，
焦点在「播放」上按空格会触发两次播放/暂停（按钮一次 + 容器一次），表现为「按空格
没反应」。这是本轮最容易漏的一个 bug，**必须有一条单测**：焦点在播放按钮上按空格，
`playing` 只翻转一次。

`←`/`→` 不处理修饰键时直接沿用；`Shift + ←/→` 只在 `.lane` 聚焦时生效，避免在
其它控件上劫持浏览器的文本选择语义。

### 12.3 焦点与焦点环

- 全部用 `var(--focus-ring-width)` / `var(--focus-ring-offset)`，**零字面量**。
- 需要新增 `:focus-visible` 规则的三处：`.lane`、`.mark`、`.gapSwitch`。
  `focusRing.test.ts` 的守卫计数相应变成：
  `outline: var(--focus-ring-width)` **31 → 34**、
  `outline-offset: var(--focus-ring-offset)` **18 → 21**、
  消费令牌的规则 **35 → 38**。
  **实现后必须用 grep 实数复核再改守卫**，不要抄这三个数——它们只是预估值。
- `.lane` 是 `overflow: hidden`，**正偏移的环会被裁掉**。所以 `.lane` 的环用
  `outline-offset: var(--focus-ring-inset)`（内嵌），与 `TimelineTrack` 的整行按钮
  同一个理由（那条注释写在 `focusRing.test.ts` 的清单里）。
- `.mark` 只有 8px，环要有 12×12 的命中盒：环画在按钮上（12×12），字形在内部居中。
- 跳转后焦点**不移动**（点跃点后焦点仍在那个跃点上，方便再按 `Space` 播放）。

### 12.4 `aria-live` 的节流裁决

**裁决：`role="status" aria-live="polite"` 只在 `playing === false` 时随事件切换
更新；播放中内容固定为「播放中，暂停后会播报当前位置」。**

理由是「播报会追不上帧率」：60 秒片长、618 条事件意味着平均每 97ms 换一次卡，
`aria-live` 会连续排队 618 条播报，用户听到的是一串永远追不上的噪音，
且**听不到自己按下的动作**。停播时不播报，是把播报留给用户真正能读的那一刻。

这不违反 PRD R6：「只在事件切换时播报」这条约束（不播报读数变化、不播报进度
百分比）仍然严格成立——本裁决只决定**切换时要不要出声**，不决定「什么算切换」。

胶片摘要（`.srOnly`，静态，不随播放变化）：

```
本次会话墙钟 1 小时 3 分，共 618 条记录：用户 12，LLM 296，工具 288，子 agent 6，
workflow 2，等用户 9，压缩 1。首个错误在 10:47:12，最烧的一分钟在 10:41，
最长停顿 2 分 41 秒，起点 10:12:04，终点 11:15:31。
```

它承担 `role="img"` 本该承担的「这个图形说了什么」。**不给 `.lane` 加 `role="img"`**
——它有交互（slider），`role="img"` 会把子元素从可访问性树里摘掉。

### 12.5 颜色不是唯一编码的证据（逐条）

| 信息 | 颜色通道 | 第二通道 | 第三通道 |
| --- | --- | --- | --- |
| 事件类别 | `--cat-*` | 形状（圆/方/竖条/双点/菱形/空框） | 舞台 chip 的中文名 / 图例文字 |
| 错误 | `--danger` | bin 顶部 2×2 tick + 卡片左侧竖条变红 + 卡片一行 `失败 · …` | 跃点菱形 + live region |
| 已播放 / 未播放 | 同一类别色 | **实心 / 空心** | 播放头的左右关系 |
| 压缩 | `--text-tertiary` | 贯穿全高的虚线 + 顶部横杠 | 图例 `┃ 压缩 1` / 跃点 |
| 停顿 | 无类别色 | 底部凹槽 + 两端竖线 | 舞台的「停顿 N 分 N 秒」 |
| 水位 | `--chart-1` 实色 | 条长（几何） | `128,400 / 峰值 214,100` 的文字 |
| 压缩断崖（水位条） | `--text-tertiary` | 实线 / 虚线（未播放） | 同一 `128,400` 读数的跳变 |

灰度截图下的自查口径：把截图转灰度，**六种字形仍能靠形状区分**、**实心/空心仍
成立**、**虚线断崖仍是虚线**。这是截图基线可以验收的条件。

---

## 13. `data-probe` 锚点与门禁

### 13.1 锚点

| 锚点 | 挂在 | 门禁要读的事实 |
| --- | --- | --- |
| `replay-root` | `.replay` | `scrollWidth / clientWidth`、`getBoundingClientRect()` |
| `replay-stage` | `.stage` | 高 ≥ 148（完整档） |
| `replay-reads` | `.reads` | 高 = 72 |
| `replay-film` | `.film` | 高 = 112 |
| `replay-lane` | `.lane` | 宽 ≥ 400、`getBoundingClientRect().right` 在 `replay-film` 之内 |
| `replay-head` | `.head` | `x` 在 lane 的 `[left, right]` 之内 |
| `replay-transport` | `.transport` | 高 = 40（100% 字号下） |

全部是**事实**，不含阈值与 pass/fail；阈值住在 `gui-test.sh`（`gui-tests.md`
「facts in the app, assertions in the script」）。

### 13.2 不变量（建议写进 `gui-test.sh` 的新步骤）

1. **无横向溢出**：`document.scrollWidth ≤ document.clientWidth + 1`，且
   `<main>` 同样成立。
2. **栈高与 pane 对齐**：`replay-root.height ≤ pane.height + 1`，且舞台 / 读数 /
   胶片带 / 走带四块的矩形都在 root 内（1440×900 实测 526，与 §11.1 的预算一致）。
   **不要**断言 ≤ 400：400 是「展开区」的旧惯例，重放两张卡整体占满 pane，是
   有意占满，不是越界。
3. **泳道在卡内**：`replay-lane.right ≤ replay-film.right` 且
   `replay-lane.width ≥ 400`。
4. **播放头不越界**：`replay-head.x ∈ [lane.left, lane.right]`，在 `t=0` 与
   `t=1` 两端各断言一次（点一次胶片右端即可）。
5. **不出现 U+001B**：`document.body.innerText` 无 ESC（与既有检查 5 同款，
   重放会把 `row.summary` 直接上图，ansi 夹具在这里最容易漏）。

### 13.3 截图视图

`docs/screenshots/views.json` 增加一个视图名 **`replay`**（单一权威，只改这一处），
并在 `web/e2e/screenshots.spec.ts` 的声明里对齐。基线图两张：`replay-light` /
`replay-dark`（由套件按既有规则生成，不手放）。

---

## 14. 明确不做

1. **不自动播放**（§8.4）。
2. **不做播放速度滑块**（0.5×–4×）。片长三档已经覆盖「快看 / 细看」，再加一层
   速度会让「倍速」这个唯一数字失去意义。
3. **不做导出影片 / GIF / 逐帧截图**（PRD Out of scope）。
4. **不做声音、TTS、字幕**（同上）。
5. **不做跨会话重放、全天重放**（同上）。
6. **不在重放里加标注 / 书签 / 分享链接**（同上）。
7. **不做「精彩片段」自动挑选**。跃点只来自 `film.marks`。
8. **不做重放内的筛选器**（§1.3 边界 1）。
9. **不新画 SVG 图标、不引图标字体**（`Icon` 只有 6 个名字，本轮用 `| ◀ ▶`）。
10. **不新增颜色令牌、不新增组件**（复用 `Button` / `IconButton` /
    `SegmentedControl` / `EmptyState` / `Panel` 的几何，不新建 `Switch`）。
11. **不改 `.pane` / `.reportPane` 的 `min-height`**（被 layout test 逐字断言）。
12. **不给重放做第二条滚动轴**（页面滚动是唯一滚动）。

---

## 15. 实现者清单与复核清单

### 15.1 按顺序做

1. `web/src/features/sessions/replayModel.ts`（PRD R2 的纯函数，本文件不覆盖其
   算法，只覆盖它被使用的方式）+ `replayModel.test.ts`（7 条口径）。
2. `web/src/features/sessions/ReplayView.tsx`：按 §3.1 的 DOM 骨架，四个子区块
   同文件内（与 `LogView` 同构，不拆五个文件）。
3. `web/src/features/sessions/ReplayView.module.css`：§4–§7 的几何；**先写
   `--dot` / `--head` / `--track` 三个局部变量**，再写规则。
4. `SessionAnalyzerPage.tsx`：`AnalyzerView` 加 `"replay"`、`ANALYZER_VIEW_ITEMS`
   加 `{ value: "replay", label: "重放" }`、`readStoredView` 的白名单加 `replay`；
   `view === "context" || "changes" || "bleed"` 那条**必须扩成含 `replay`**
   （否则时间线与筛选会一起出现在重放页上，倍速立刻失真）。
5. `ReplayView.test.tsx`：§9.2 的九态各一条；§12.2 的双触发 bug 一条；
   同刻跃点一条；reduced-motion 一条（`matchMedia` 由 `vitest.setup.ts` 提供）。
6. `web/e2e/replay.spec.ts`（Chromium + WebKit）：6 个标签可见、点胶片跳转、
   点跃点、键盘全套、成本未知文案、停顿文案。
7. `scripts/gui-test.sh` 的 `CAPTURE_TARGETS` 加一步 `重放`；`docs/screenshots/
   views.json` 加 `replay`。
8. `focusRing.test.ts` 的计数（§12.3 的预估值，实测后再改）。
9. `CHANGELOG.md`（`[Unreleased] → Added`，中文一条）、README 视图清单、
   `docs/ARCHITECTURE.md` 的视图分工表。

### 15.2 请主会话独立复核的五处

1. **§11.1 的高度账**：1440×900 下 `359 + 12 + 155 = 526`，与页面算出来的
   `pane` 逐像素一致。任何一处改动都要重算整张表。
2. **§10.3 的最低值 3.06**（`--cat-user` 于 `--bg-elevated`，浅色）：这是全表
   唯一贴着 3:1 的值，泳道底一改就破。
3. **§6.2 的七种字形**：请人眼在 8px 下逐个认一遍。认不出的那一对，说明形状
   通道没做到位，要换形而不是换色。
4. **§12.2 的 `Space` 双触发**：这是本轮唯一一个「不写测试就一定会犯」的错。
5. **§9.2 的九态文案**：逐条念一遍，看是否有哪一句把「没有读数」说成了 0、
   把「停顿」说成了事件。

---

## 16. 主会话评审结论

**结论：接受，随本轮 PR 合并。** 规格里的硬约束逐条对过；与规格不一致的地方
都在下面写明理由，没有一处是「实现时顺手改的」而被倒灌回文档。

### 16.1 我独立复算过的数（不是照抄实现）

- **高度账**：1440×900 下 359（卡 A）+ 12（间距）+ 155（卡 B）= 526，与页面
  给重放 pane 的高度逐像素吻合；最小栈高 390 ≤ 400 的旧惯例在 ≤760px 高时成立。
- **对比度**：`--cat-user` on `--bg-elevated` = 3.06:1（图形下限 3:1，达标）；
  同一前景色换到 `--bg-inset` 只有 2.75——所以「泳道底必须是 `--bg-elevated`」
  是真的约束，不是风格偏好。文字最低 4.78:1（`--text-tertiary` on `--bg-subtle`），
  页底 `--bg` 上只有 4.38，所以**读数必须留在卡面上**。
- **密度**：5000 条事件 → 107 个 bin，DOM 节点 < 400；与 N 无关这一点在 10k 行
  的性能用例里成立。

### 16.2 与规格的偏离（已裁决）

| 规格 | 实现 | 裁决 |
| --- | --- | --- |
| 跳过停顿提示用中性色 | 用 `--warning` +「空档已跳过，时间轴不再等速」 | 接受：这是「时间轴不再等速」的唯一可见信号，中性色读不出来 |
| 空会话另有文案 | 诚实空态（无事件时说没有可播放的东西） | 接受 |
| 摘要完整展示 | 2 行截断 | 接受：卡片高度固定，截断比撑破高度诚实 |
| 末尾「下一事件」可点 | disabled | 接受：没有下一个事件可去 |
| §13.2 root 高 ≤ 400 | 实测 526 | **改文档**：400 是「展开区」的旧惯例，重放两张卡有意占满 pane；断言改为「四块都在 root 内 + root ≤ pane」 |

### 16.3 端到端同事在真浏览器里抓到、已修的两处缺陷

1. **Home 之后按 `→` 空操作**：根因是 `/repo/errors` 里 `film.start`
   （1767330000000，首条 user 记录）与 `events[0].at`（1767330001000，合并后的
   turn 行）不相等，且首两条事件同刻；舞台序号过去只由时间反推，
   `indexAtOrBefore` 对同刻事件只能落到最后一个，于是「第 1 条」永远够不着。
2. **同刻事件用 `←` 不可达**：`goPrev` 用时间比较决定目标，末两条同刻事件
   映射到同一个 progress，反复落回同一条。

修法：引入单一 `stepIndex` 游标（暂停且 `|frame.at − events[stepIndex].at| ≤ 1ms`
时采信，否则交还时间）；`←/→` 按序号步进；所有自由 seek 清游标；播放中游标强制
失效。**没有**改 `replayModel.ts` 的 `progressAt` / `realMsAt`——纯逻辑层的契约
保持不动。新用例在 `679b33f` 的旧实现上会失败（2 failed | 18 passed），修复后
20/20、全量 1473/1473。

### 16.4 验收证据（主会话亲自跑的）

- `npm --prefix web test`：1473 passed（119 文件）。
- `npm --prefix web run test:e2e -- replay`：Chromium 与 WebKit 各 8 条通过。
- `./scripts/gui-test.sh --build`：**474 通过 / 0 失败**，其中重放 6 步；真机
  实测舞台 1058×346、胶片带 112.0、轨道 1034、播放头 0.2% → 10.9%。
- `./scripts/lint.sh`：36 通过 / 0 失败；`cargo fmt --check` 与
  `cargo clippy -- -D warnings` 均干净。
- 截图：`docs/screenshots/replay-{light,dark}[-webkit].png` 四张，我逐张看过。
