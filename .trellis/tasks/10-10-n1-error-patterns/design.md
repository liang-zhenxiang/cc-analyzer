# Design：N1 · 跨会话错误分析

> 依据：`prd.md` + `research/error-data-facts.md`（实测地基）。
> 视觉形态以设计师产出的 `research/design-error-view.md` 为准（派发后落地）；
> 本文定数据流、模块边界与契约——视觉规范与本文冲突时，**先回来改本文再动代码**。

## 1. 总体形态

**不新建扫描管道。** `useUsageOverview` 已有渐进式全库扫描 + `sharedSessionParseCache`
（一个文件只解析一次）。错误聚合走 J3 压缩统计的同一条扩展路径：

```
ParsedSession ──extractErrorEvents()──▶ ErrorEvent[]（挂在 UsageSessionInput.errorEvents）
                                          │
                     （渐进扫描逐会话累积，与 tokens 同一批发布）
                                          ▼
                 mergeErrorStats(events, 窗口) ──▶ ErrorStats（纯函数，窗口化）
                                          │
                              ErrorPanel / 三个切面 + 下钻列表（视图层）
```

**落点（设计师已裁决）**：`features/usage/` 内新模块（数据与扫描都在这里）；
`UsageOverviewPage` 页头新增 `用量 | 错误` 分段子视图（复用 `SegmentedControl`，
区间选择器与扫描进度行两档共用，记忆键 `cca-usage-view`，缺省「用量」）——
错误档 = KPI 行 → 趋势面板（整行主角）→ 按工具/按项目两列 → 错误事件（整行
下钻列表）。视觉细节的唯一权威是 `research/design-error-view.md`。

## 2. 契约

### 2.1 `errorStats.ts`（新，纯函数）

```ts
/** 一条错误事件——扫描期从 ParsedSession 提取，之后只与窗口聚合打交道。 */
export type ErrorEvent = {
  kind: "api" | "tool";              // 两个独立通道，绝不合并
  timestamp: number;
  toolName?: string;                 // kind=tool 时必填（实测 100% 可归属）
  apiStatus?: number | null;         // kind=api 时（402/500/401/400/null=传输层）
  recordId: string | null;           // 主链记录的 fullId；sidechain 记录为 null（见 §4）
  path: string;                      // 会话文件路径（下钻用）
  projectLabel: string;
  preview: string;                   // ≤200 字符的脱敏预览（固定文案前缀优先）
};

/** 从一个已解析会话提取错误事件（含 sidechainMessages，见 §4 口径）。 */
export function extractErrorEvents(parsed: ParsedSession, meta: SessionMeta): ErrorEvent[];

/** 窗口化聚合：随 UsageSessionInput 逐会话累积，或对全量 inputs 一次跑。 */
export type ErrorStats = {
  total: { api: number; tool: number };
  byTool: ErrorToolBucket[];         // {toolName, errors, calls, rate}——按失败次数降序
  byProject: ErrorProjectBucket[];   // {projectLabel, toolErrors, apiErrors, records, density}（合计可派生）
  daily: ErrorDayPoint[];            // {dayStart, api, tool, assistantMessages, anomalous}——原始数，per1k 视图自算
  anomalyThreshold: number | null;   // 异常线阈值；窗口内非零日不足 2 天时 null
  events: ErrorEvent[];              // 窗口内全量（下钻列表直接吃它，按时间倒序）
};
export function mergeErrorStats(inputs, range): ErrorStats;
```

**异常日口径（定案，2026-10-10 裁决，采纳设计师建议）**：窗口内**非零日**的合计
per1k（(api+tool)÷assistantMessages×1000）取中位数 × 2 为阈值，且**当日原始错误数
≥ 10** 才判异常（下限挡小样本日：40 条消息 1 个错 = 25/千条的假异常）。实测自检：
09-14（25.1/131 条）过、09-30（8.4/100 条）不过、基线日（9~11）不过——与研究报告
人判吻合。caption 文案与判定函数**从同一常量取**（单一事实源，不许两处手写）。
窗口内非零日不足 2 天时 `anomalyThreshold = null`（不画线、异常日恒 false）。

要点：

- **分母（三条口径全部定案）**：
  - 日趋势：`每千条 assistant 消息的错误数`（实测基线 ~10.7，异常日 25+）。
    **分母含 sidechain 的 assistant 消息**（分子错误含 sidechain，分子分母必须
    同域——只数主链会系统性推高含子链的日子）。因此 `assistantMessages` 由
    `extractErrorEvents` 同趟统计，**不复用** `DayBucket.messages`（那个只含主链）；
  - 按工具的失败率分母是该工具的**总调用次数**（tool 记录数，含成功，含 sidechain
    的工具调用）；
  - 按项目的失败密度分母是该项目**记录总数**（与 Issue #146 口径一致）；
  - **三个分母各是什么，全部写进 UI**；
- **排除「等用户输入」**：AskUserQuestion 拒绝类（实测 1 例，文本
  `user doesn't want to proceed`）不计入错误——在 `extractErrorEvents` 里排除，
  排除是**白名单文本规则**（仅此一条），写测试；
- **分类法 v1 只做两层**：`kind: api | tool`（结构化字段，零成本）+ API 的
  status 桶（402/401/400/500/无 status=传输层；429/529 预留文案）。工具错误的
  文本 regex 分类（Bash 非零退出 / Edit 未命中 / 超时…）**明确推迟 v2**
  （研究报告 §5 的建议：v1 按工具/时间/会话分桶先落地）；
- `preview` 只取平台固定文案头部（`Exit code 3` / `String to replace not found…`），
  尽量不带回显的命令/路径正文；转义与截断规则与现有 `toolResult` 截断一致。

### 2.2 扫描接线（改动面最小）

- `UsageSessionInput` 增可选字段 `errorEvents?: readonly ErrorEvent[]`
  （与 `compactEvents` 完全同构的先例）；
- `useUsageOverview` 的 `readSession` 在产出 `UsageSessionInput` 时调
  `extractErrorEvents`（纯函数、无 IO，开销可忽略）；
- 不改 `usageAggregations.ts` 的既有桶（错误聚合独立成 `errorStats.ts`，
  避免把两种口径搅在一个 merge 里）。

### 2.3 视图与下钻

- 新面板组件（命名随设计师规范）：三个切面（按工具、按项目/会话、按时间趋势
  ——趋势图**必须同时展示原始数与归一数**，或以归一为主、悬停出原始数，
  形态由设计师定）+ KPI 行（API 错误数 / 工具错误数 / 最常见失败工具 / 异常日）；
- **下钻链路（硬要求，复用现有机制）**：
  - 切面条目（工具/项目/日）→ 展开该切面的事件列表（events 过滤）；
  - 事件行 → **跳回会话分析并定位**：AppShell 已有
    `onReveal(path, recordId) → setTab("analyzer") + setRevealRequest({path, recordId, nonce})`
    （SearchPalette 在用）；给 `UsageOverviewPage` 增可选 prop
    `onRevealRecord?: (path: string, recordId: string | null) => void`，AppShell
    接线与 SearchPalette 同款；
  - `recordId === null`（sidechain 事件，见 §4）时落到会话本身（reveal 的
    recordId=null 语义就是「只开会话」，现有代码已处理）；
- 空态：区间内 0 错误时展示「这一区间没有失败记录」+ 说明口径的事实行
  （含多少会话、多少条记录被检查过——0 错误是被验证过的，不是没数据）。

### 2.4 口径标注（界面文案，provenance 语言）

面板脚注一句话 + 悬停展开：什么算失败（工具结果 `is_error`、API 错误消息；
不含「等用户输入」拒绝）；含子 agent 记录；三个分母各自是什么。

## 3. Sidechain 口径（设计定案）

实测 35.4% 的工具错误在 `sidechainMessages`。**聚合必须含 sidechain**（否则静默
丢三分之一），采用「并入 + 标注」：

- `extractErrorEvents` 同时遍历 `records` 与 `sidechainMessages`；
- 事件不单独分桶展示（不做「主链/子链」切换器——v1 拆这个维度只会稀释「规律」
  的叙事），但在事件列表的行内标注「子 agent」徽标；
- 下钻：sidechain 记录不在日志表行里，v1 定位到**所在会话**（recordId=null），
  事件行自身的 preview 已给出足够上下文；徽标悬停说明「子 agent 记录暂不能
  定位到行」；
- UI 口径脚注写「含子 agent 记录」。

## 4. 测试设计

| 层 | 内容 |
| --- | --- |
| 单元（Vitest） | `extractErrorEvents`：API 错误（各 status、无 status）、工具错误、sidechain 并入、AskUserQuestion 拒绝排除、preview 截断与脱敏；`mergeErrorStats`：窗口裁剪、三分母口径、空输入、全零区间、排序稳定性 |
| 夹具 | 新 `web/tests/fixtures/error-session.jsonl`：含 API 错误（402/500/无 status）、Bash/Edit/Read 工具错误（固定文案头部）、sidechain 错误、一次 AskUserQuestion 拒绝（被排除）；单测与 e2e 共用 |
| 组件 | 新面板：三切面渲染、下钻事件列表、空态文案、口径脚注在场 |
| e2e（双引擎） | 夹具注入后：错误面板可见且数字对、点工具切面展开事件、点事件跳回会话分析且高亮行在视口、空态区间 |
| GUI 门禁 | 新视图步骤进默认清单；几何事实：趋势图 SVG 有界、事件列表是真列表（行高×行数对总高）、下钻后高亮行在视口内 |
| 变异 | 至少一条：如删掉 sidechain 遍历 → 「sidechain 并入」用例先红；或删掉排除规则 → 拒绝排除用例先红 |

## 5. 明确不做（本轮边界）

- 工具错误文本的 regex 分类（v2，含「其他」桶未匹配率自监控）；
- 错误 × 模型切换的归因；
- sidechain 记录进日志表行（结构性改动，另立议题）；
- 新图表库。

## 6. 回滚

全部新代码集中在 `features/usage/errorStats.ts` + 新面板组件 + `UsageSessionInput`
一个可选字段 + AppShell 一条接线；revert 单个提交即可完整回滚，不触既有聚合桶。
