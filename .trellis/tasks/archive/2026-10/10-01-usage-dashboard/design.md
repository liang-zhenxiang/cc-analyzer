# 技术设计：用量总览仪表盘

> 对应 prd.md · Round B · 状态：视觉规格待设计师评审报告补充（§6）

## 1. 模块边界

新目录 `web/src/features/usage/`，不侵入既有 `features/sessions` 内部：

```
web/src/features/usage/
├── usageAggregations.ts   # 纯函数：会话数组 → 聚合结果（趋势/分布/热力/KPI）
├── pricingSnapshot.ts     # 离线定价快照 + costOf() 计算（纯函数）
├── provenance.ts          # Provenance 类型与标签文案
├── ProvenanceBadge.tsx    # 置信徽章组件（读自日志/估算/快照日期）
├── UsageOverviewPage.tsx  # 页面编排（渐进聚合 + 布局）
├── useUsageOverview.ts    # 渐进扫描 hook（编排层，可测）
└── charts/                # 纯 SVG 图表组件，零依赖
    ├── BarChart.tsx       # 按天趋势（柱）
    ├── HBarChart.tsx      # 水平条形（按项目）
    ├── StackedBar.tsx     # 堆叠条（按模型）
    ├── Heatmap.tsx        # 7×24 时段热力
    └── chartPrimitives.ts # 轴/网格/tooltip 共用基元
```

共享图表基元放 `chartPrimitives.ts`，后续 Round C（限额窗口仪表）复用。

## 2. 数据流

```
~/.claude/projects/**/*.jsonl
  → metadataScanner（既有，列表）
  → 逐会话 parseJsonl（既有，含 sessionParseCache 按 mtime 缓存）
  → SessionRecord[]（含 usage 四类 token + model + timestamp + cwd/projectLabel）
  → usageAggregations.aggregate(records of all sessions)
      → { daily: DayBucket[], byProject: [...], byModel: [...],
          hourly: number[7][24], kpi: {...} }
  → UsageOverviewPage 渲染
```

关键决策：

- **复用而不是新建解析层**。`tokenTotalsOf` / `parseJsonl` 已被 TokenPanel 使用并有
  测试，聚合引擎只消费 `SessionRecord[]`，不直接碰 JSONL 文本。
- **渐进聚合**：`useUsageOverview` 按列表顺序逐会话解析并增量更新聚合结果
  （聚合函数设计为可合并：`mergeAggregate(acc, sessionAgg)`），页面先渲染已聚合
  部分并显示进度（「已分析 37 / 128 个会话」）。已解析过的会话命中
  `sessionParseCache`，二次进入即时呈现。
- **单会话聚合先行**：`aggregateSession(records)` → `mergeAggregate` 组合出全量，
  单会话粒度让单元测试不必构造多会话夹具也能覆盖合并逻辑。

## 3. 口径与 provenance

- **时间桶按本地时区的天**（用户视角的「今天」），夹具测试用显式构造的时间戳
  避免跨时区 CI 漂移；跨天会话的 token 归属到**记录所在天**（按每条 assistant
  记录的 timestamp 分桶），不是会话开始日。这是「按天消耗」的正确口径。
- **四类 token 分开聚合**（input / output / cache_creation / cache_read），
  与 TokenPanel 的既有立场一致：cache_read 与 input 差别比价格更大。
- **成本 = Σ(token_i / 1M × price_i(model))**，按模型逐条计价后求和，
  不做「平均模型价」的糊算。未知模型：该会话成本记为不可估算（KPI 显示
  「部分会话未知价」），不静默按 0 计。
- Provenance 三档：`logged`（读自日志）、`estimated`（按快照估算）、
  `snapshot`（快照数据本身，带日期）。KPI、趋势、成本各自的来源不同，
  徽章分别标注。

## 4. 定价快照

`pricingSnapshot.ts` 内嵌一个 `asOf` 日期的常量表：Claude Code 实际会用到的
模型族（sonnet / opus / haiku 当前各档），单位 USD / MTok，四类 token 四个价。
设计要点：

- 快照是一个整体替换的 `const`，升级 = 整表替换 + 改 `asOf`，不做部分合成；
- UI 永远展示「估算 · 定价快照 2026-XX-XX」，绝不出现「$」裸数字无标注；
- 未来若要接 LiteLLM 式自动更新，走「CI 定期 PR 换表」而不是运行时拉网
  （隐私红线：应用不发起网络请求）。

## 5. 标签页接线

- `WorkspaceTab` 增加 `"usage"`；`WorkspaceTabs` 数组插入「用量总览」于
  「会话分析」之后；`AppShell` 按值渲染 `UsageOverviewPage`。
- TAB_KEY localStorage 持久化沿用（非法值回退 analyzer 的既有防御保持）。
- 默认排序：analyzer 仍是首屏（老用户习惯优先），usage 居中，monitor 在后。

## 6. 视觉规格（依据 .trellis/workspace/liangyuxiang/design-critique.md 定稿）

**总原则（评审原话）：只加「信息」，不加「装饰」；明确不做渐变、玻璃拟态、彩色主题、动效装饰。**

- **色板**：`tokens.css` 新增 `--chart-1 … --chart-6`（两主题各一套：light 深版 /
  dark 亮版），语义无关、只论顺序；每色配 `--chart-*-soft`（10–14% 透明版）。
  **大面积填充（柱、面积、热力格）只允许用 soft**，实色只给描边、点、小徽标。
  记录类别继续用 `--cat-*`，两套资产严禁互借（评审维度 2：借色会毁掉两个维度）。
- **KPI 行 = 读数行语言**：数值 `--fs-md` 15px/600 + `tabular-nums`，标签与单位
  `--fs-xs` `--text-tertiary`，读数并排排在浅台阶（`--bg-subtle`）上；
  provenance 徽章紧随数值。这是评审维度 1「读数层」在跨会话维度的落地。
- **图表骨架**：中性灰骨架（`--border`/`--text-faint` 网格与刻度），颜色只上数据；
  细描边、克制网格（y 轴 3–4 条）、数据墨金比最大化；刻度与 tooltip 数字一律
  `tabular-nums`。
- **交互**：hover 十字线/高亮 + tooltip（评审维度 5 的「准线」语言）；
  `prefers-reduced-motion` 下一切过渡静止（沿用全局归零策略）。
- **空态**：复用 `EmptyState` 组件（page 档），不用空白 SVG。
- **热力图色彩**：单色阶梯（`--chart-1` 的透明度插值），不搞多色热力。

## 7. 测试策略

- **单元**（`*.test.ts` 就近）：`usageAggregations`（空数据/单会话/跨天/跨月/
  合并律/按天分桶边界/热力坐标）、`pricingSnapshot.costOf`（已知模型/未知模型/
  四类混合）、图表组件（vitest 渲染出 SVG 节点数与 aria-label）。
- **E2E**（`web/e2e/usage-overview.spec.ts`）：fixture 会话加载后切到用量总览，
  断言 KPI 数字、时间范围切换改变柱数、Chromium + WebKit 双跑；截图规格挂进
  既有 `screenshots.spec.ts` 的清单。
- **GUI**（`scripts/gui-test.sh` 框架）：真实 app 切到用量总览标签，窗口内截图
  含内容断言（复用 createPDF + 颜色多样性判定）。
- 夹具：扩展现有 `web/tests/fixtures/`，补两个跨天会话（含不同模型与四类
  token 的 usage 行）供三层测试共用。

## 8. 兼容与回滚

- 纯新增功能 + 一个 tab 接线改动，无数据迁移；出问题回滚即删 tab。
- `features/sessions` 只允许两处触碰：导出既有计算函数（若需）与
  WorkspaceTabs/AppShell 接线；其余不动。
