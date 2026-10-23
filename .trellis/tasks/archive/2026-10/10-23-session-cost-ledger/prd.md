# 会话账单：把一次会话的钱按 token 类别、模型与最贵的调用拆开

- 轮次：Round BB / 里程碑 v0.30.0
- 状态：规划

## Goal

会话详情新增第七个标签「账单」：把一次会话的估算成本拆成四类 token（输入 / 输出 /
缓存写入 / 缓存读取）的收据式账单，附逐模型账单、缓存经济学（命中率与按输入单价
估算省下的钱）与最贵的五次调用；未知定价的模型单列且绝不按 0 计价。

## 背景

这个应用处处都有「钱」，但没有一处以钱为主语。用量总览给的是 KPI 合计与逐模型
均价；上下文出血点回答的是「哪一类上下文被吃掉、花了多少」；重放把成本滚进读数带。
三者都在回答别的问题，于是使用者最常问的那个问题一直没有答案：

> 这次会话的 $8.4 到底花在哪？

Claude Code 的 usage 有四个互不相通的计数器：`input`、`output`、
`cache_creation_input`、`cache_read_input`。四者单价差一个数量级（Sonnet：
输入 $3 / 输出 $15 / 缓存写入 $3.75 / 缓存读取 $0.3，每百万 token）。所以
「token 总量」与「花了多少钱」是两个完全不同的形状：一次压缩后重读 167k 上下文
可能只花 $0.05，而 4 万 output 要 $0.6。**不拆开就永远看不见这件事。**

## 非目标

- 不做跨会话对比、不做预算、不做预测（那是别的视图与别的轮次）。
- 不猜定价：未知厂商 / 未收录模型一律「定价未知」，**绝不按 0 计价**，也绝不按
  「平均价」折算。
- 不联网：定价来自 `web/src/features/usage/pricingSnapshot.ts` 的离线快照。
- 不新增 Tauri 命令、不新增权限。

## R1 入口

- `SessionAnalyzerPage.tsx` 的 `AnalyzerView` 增加 `"cost"`，`ANALYZER_VIEW_ITEMS`
  追加第 7 项 `{ value: "cost", label: "账单" }`（顺序放在「重放」之后）。
- `readStoredView()` 白名单加入 `"cost"`；`VIEW_STORAGE_KEY` 不变。
- 「不渲染 TimelineTrack / FilterBar」的判断必须同时把 `cost` 排除（与 replay 同款）。
- 默认视图仍然是 `log`。

## R2 纯逻辑层：`web/src/features/sessions/costLedger.ts`

```ts
export type LedgerClassKey = "input" | "output" | "cacheWrite" | "cacheRead";

export type LedgerClassLine = {
  key: LedgerClassKey;
  /** 只统计**可定价**调用的 token；未定价调用的量不进这里（见 unpriced* 字段）。 */
  tokens: number;
  usd: number;
  /** usd / pricedTotalUsd；pricedTotalUsd 为 0 时是 0。 */
  share: number;
};

export type LedgerModelLine = {
  model: string;
  family: ModelFamily | null;   // null = 定价未知
  calls: number;                // 带 usage 的调用数
  tokens: Record<LedgerClassKey, number>;
  usd: number | null;           // 该模型没有任何可定价调用时为 null
  unpricedCalls: number;        // 该模型里缺 model / 未收录的调用数
};

export type LedgerCallLine = {
  recordId: string;
  timestamp: number;
  kind: RecordKind;
  model: string;
  tokens: Record<LedgerClassKey, number>;
  usd: number;                  // 只收可定价的调用
};

export type CostLedger = {
  classes: LedgerClassLine[];   // 固定四个，顺序 input/output/cacheWrite/cacheRead，含 0 行
  models: LedgerModelLine[];    // 可定价的按 usd 降序，未知 family 的排最后
  totalUsd: number | null;      // 一次可定价调用都没有时为 null
  pricedCalls: number;
  unpricedCalls: number;
  unpricedTokens: number;       // 未定价调用的四类 token 之和
  unpricedModels: string[];     // 去重、按出现顺序
  cache: {
    readTokens: number;
    inputTokens: number;
    hitRate: number | null;     // read/(read+input)，分母 0 → null
    savedUsd: number;           // Σ 逐模型 readTokens × (input 单价 − cacheRead 单价) / 1M
  };
  topCalls: LedgerCallLine[];   // 按 usd 降序、并列按 timestamp 升序，最多 5 条
  span: { start: number; end: number };
  pricingAsOf: string;          // 直接透传 PRICING_AS_OF
};

export function buildCostLedger(records: readonly SessionRecord[]): CostLedger;
```

### 口径（每条都要有单测）

1. **单价唯一来源**：在 `pricingSnapshot.ts` 新增
   `export function classRate(family: ModelFamily, key: "input" | "output" | "cacheWrite" | "cacheRead"): number`，
   从 `MODEL_PRICING` 读取；`estimateCost` 改为用它实现，并用等价性测试证明改写前后
   数值一致（`toBeCloseTo`，误差 1e-12）。**不要在 costLedger 里再抄一份价目表。**
2. **只统计带 `usage` 的 assistant 记录**；`usage` 缺失的模型调用计入
   `unpricedCalls`，其 token 不计入任何 `classes[].tokens`（避免「显示有量、算不出钱」
   的对不上账）。缺 `model` 的记录视为未知模型。
3. **未知 family**：该调用的 `usd` 为 `null`，不进 `totalUsd`、不进 `classes[].usd`；
   它的 token 出现在 `models[].tokens`（该模型 `family === null`）与 `unpricedTokens`
   里，且 `unpricedModels` 列出模型名（缺 model 时列 `"（未记录模型）"`）。
4. **合计闭合**：`totalUsd` 与 `classes.reduce(sum usd)` 的差 < 1e-9；且
   `classes[].tokens` 四类求和 == 所有可定价调用的四类 token 求和。
5. **占比**：`share` 以 `totalUsd` 为分母；`totalUsd === null` 时四个 `share` 全为 0。
6. **缓存省下的钱**：逐模型 `readTokens × (input 单价 − cacheRead 单价) / 1M`
   求和，只算可定价模型。UI 必须写明「按同一模型的输入单价估算」——这不是账单，
   是「如果这些读走 input 会多花多少」。
7. **最贵的五次调用**：只收可定价调用；`usd` 并列按时间升序；`kind` 用
   `RecordKind`（UI 映射成中文标签，复用既有映射，不新造词）。
8. **空态**：无任何带 usage 的记录 → `classes` 仍返回四行 0、`totalUsd === null`、
   `topCalls === []`、`cache.hitRate === null`。UI 据此显示诚实空态。
9. **跨度**：`span` 取带 usage 记录的最早 / 最晚时间戳；没有时 `{start:0,end:0}`。
10. **不修改既有计价入口**：`estimateCost` 的签名与语义不动（另有 4 处调用方）。

## R3 界面（`CostLedgerView.tsx` + `.module.css`，设计规格见 designer 文档）

从上到下（单列，卡内）：

1. **收据卡**：标题行「会话账单 · 估算」；四行科目（输入 / 输出 / 缓存写入 /
   缓存读取），每行：科目名、token 量（千分位）、单价（`$X.XX / 百万`）、小计、
   右侧占比条（宽度 = `share`）；底部「合计」行加粗；下方脚注：定价快照日期、
   「估算，不是账单」、未定价调用条数（若有）。
2. **按模型**：每个模型一组（模型名、family、调用数、四类 token、小计）；未知模型
   组明确写「定价未知」，金额位置显示「—」而不是 `$0.00`。
3. **缓存经济学**：命中率（`read/(read+input)`，无分母写「无读数」）、缓存读取
   token 量、按输入单价估算省下的金额；一行说明这是估算。
4. **最贵的五次调用**：表格（时刻、类型、模型、四类量、小计），行可点，跳到日志
   视图并定位到那条记录（复用 `onReveal` / 既有 jump 机制）。
5. **空态**：日志里没有 usage 读数时，只显示一句事实 + 一句解释，不画空表格。

## R4 诚实性红线

- 金额永远是「估算」，界面上必须出现 `PRICING_AS_OF`。
- 未知模型：金额栏是「—」/「定价未知」，**不是** `$0.00`；合计不含它们，且必须
  写明「另有 N 次调用未计入」。
- 不把四类 token 混成一个「总 token」再乘均价。
- 不做「本可以省多少」以外的反事实。

## R5 性能

- `buildCostLedger` 纯函数、单趟扫描（O(n)），用 `useMemo` 按 `parsed` 记忆。
- 10,000 条记录：构建 < 16ms。
- 不新增网络请求、不新增 Tauri 命令、不新增权限。

## R6 无障碍

- 账单是一张表：用真正的 `table`（`caption` + `th scope`）或等价的 `role="table"`；
  金额读屏带单位（`aria-label="小计 1.23 美元"`）。
- 占比条是装饰：`aria-hidden="true"`。
- 「最贵的五次调用」行是 `button`，键盘可达，`aria-label` 写明跳转目标。
- 不新增 `prefers-reduced-motion` 分支（若加了过渡必须补）。

## R7 视觉

- 由 `designer` 产出 `.trellis/workspace/liangyuxiang/design-round-bb-cost-ledger.md`，
  覆盖：浅色 / 深色 / 高对比度三主题、130% 字号、960px 窄窗、1440×900 高度预算。
- 目标**零新增颜色令牌**；确需新增必须在设计文档里给出理由与三主题取值。
- 数字用 `font-variant-numeric: tabular-nums`（`tokens.css` 若已有 mono 令牌则复用）。

## R8 测试

- 单测：`costLedger.test.ts`（口径 1–10，用夹具与合成记录）。
- 组件：`CostLedgerView.test.tsx`（收据行、合计、未知模型「—」、空态、点行跳转、
  缓存卡片文案）。
- 页面：`SessionAnalyzerPage.test.tsx` 加 1 例（第 7 个标签可切、记忆恢复）。
- e2e：`web/e2e/cost.spec.ts`（Chromium + WebKit），覆盖：第 7 标签可进入、四行与
  合计数字与夹具可复算值一致、未知模型显示「—」、点最贵调用跳日志、960×640 无横向溢出。
- 截图：`docs/screenshots/cost-{light,dark}[-webkit].png`，`views.json` 增加 `cost`。
- 真机：`scripts/gui-test.sh` 增加进入账单的步骤与几何断言（金额列对齐、无溢出）。
- 回归：全量单测、既有 23 个视图截图、lint、cargo 三件套。

## R9 文档

- `CHANGELOG.md` 的 `[Unreleased]` → Added 一条（中文）。
- 双 README：功能条目 + 一句截图说明；路线图加一条并勾选（Issue 链接）。
- `.trellis/spec/frontend/` 若涉及新的表格语义约定，加一小节。

## 术语（实现与文案统一）

| 键 | 中文 |
| --- | --- |
| `input` | 输入 |
| `output` | 输出 |
| `cacheWrite` | 缓存写入 |
| `cacheRead` | 缓存读取 |
| `totalUsd` | 合计 |
| `unpricedCalls` | 未定价调用 |
| 定价未知 | 「定价未知」（不是「$0.00」） |

## Acceptance Criteria

- [ ] 会话详情第 7 个标签「账单」，刷新后恢复、默认仍是日志视图
- [ ] 四类 token 的收据与合计可逐位复算，合计与逐类之和误差 < 1e-9
- [ ] 未知模型金额显示「—」/「定价未知」，合计不含，且写明未定价调用条数
- [ ] 缓存经济学给出命中率与按输入单价估算的省下金额
- [ ] 最贵的五次调用可点，跳到日志视图对应记录
- [ ] 空 usage 会话显示诚实空态，不画空表格
- [ ] 三主题、130% 字号、960px 无横向溢出；零新增颜色令牌
- [ ] 单测 / 组件 / e2e（Chromium + WebKit）/ 真机门禁 / 截图基线全绿
- [ ] CHANGELOG、双 README、路线图更新
