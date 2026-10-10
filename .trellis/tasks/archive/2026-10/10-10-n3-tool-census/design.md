# Design：N3 · 工具 / skill / MCP 使用统计

> 依据：`prd.md` + `research/tool-census-facts.md`（382 文件 / 36,660 次 tool_use 实测）。
> 视觉形态以 `research/design-tool-census-view.md`（设计师）为准。

## 1. 数据契约

### 1.1 `toolCensus.ts`（新，纯函数，`features/usage/`）

```ts
/** 分桶标识：先命中先归（研究报告 §2 的可编码规则，逐字实现）。 */
export type ToolBucketKey =
  | { kind: "builtin"; toolName: string }                       // 其余 → 内置工具（按名）
  | { kind: "skill"; skillName: string }                        // name==="Skill"，input.skill 整串当 key（含 ns:name）
  | { kind: "mcp"; server: string; toolName: string }           // mcp__ 前缀，split("__") 恒 3 段，<3 段防御
  | { kind: "subagent"; subagentType: string };                 // Agent/Task，input.subagent_type ?? "(unknown)"

export function classifyToolUse(name: string, input: unknown): ToolBucketKey;

/** 一个桶的统计（两个口径并列——sidechain 占 41.3%，只算主链会严重低估）。 */
export type CensusBucket = {
  key: ToolBucketKey;
  label: string;              // 展示名（skill 名 / server / 工具名 / subagent 类型）
  callsMain: number;          // 主链调用
  callsWithSidechain: number; // 含子 agent
  sessions: number;           // 涉及会话数（含子链口径）
  /** 下钻 Top-5 会话（按该桶调用数降序）——聚合口径落聚合层被单测锁住
   *  （2026-10-10 裁决，采纳设计师异议 ①；含 SessionMeta 供 onOpenSession）。 */
  topSessions: CensusSessionSlice[];
  /** MCP 桶的 server 行内工具明细（2026-10-10 裁决，采纳设计师异议 ② 方案 A：
   *  按 server 聚合进契约，桶内附 tools 明细，可单测；非 MCP 桶为空）。 */
  tools?: { toolName: string; calls: number }[];
};

export type ToolCensus = {
  buckets: CensusBucket[];    // 按 callsWithSidechain 降序，同数按 label 稳定排序
  /** MCP 桶按 server 聚合（tools 明细在桶内）；其余桶 key 不变。 */
  totalCalls: { main: number; withSidechain: number };
  /** Agent 结构化结果的 totalToolUseCount 抽样对账（��究报告建议的交叉验证）。 */
  agentReportedTotal: number;
};

/** 下钻切片：一个会话对该桶的贡献。 */
export type CensusSessionSlice = { session: SessionMeta; calls: number };

export function toolCensus(inputs: readonly UsageSessionInput[]): ToolCensus;
```

规则与口径：

- 判定顺序**先命中先归**（mcp__ 前缀 → Agent/Task → Skill → 内置），与研究报告
  §2 逐字一致；`Task` 本机 0 次但兼容判定都认（parseJsonl 的 toolCategory 同款）；
- `toolInput` 是 `unknown`，安全取值（对象且字段为 string 才认，不 throw）；
- **sidechain 并入**：遍历 `records` + `sidechainMessages`，`callsWithSidechain`
  全量、`callsMain` 只主链——**两个口径都进契约**（研究报告最大风险项）；
- 涉及会话数在含子链口径下计（主链口径不单列——下钻列表本来就要全量会话）；
- 跨文件双算：本机实测 0 个独立子会话文件；口径文档写明「内联 sidechain 并入 +
  独立子会话文件按普通会话各算一次」的行为（研究报告缺口 4）。

### 1.2 扫描接线（沿 N1 同一条扩展路径）

- `UsageSessionInput` 增可选 `toolCalls?: readonly ToolCallFact[]`——
  `ToolCallFact = { key: ToolBucketKey; timestamp: number; sidechain: boolean }`，
  `readSession` 在产出时调 `extractToolCalls(parsed)`（纯函数同文件导出）；
- 不动 `usageAggregations.ts` 既有桶。

## 2. 视图与交互

- 落点（设计师裁决细节，约束如下）：**用量总览「用量」档**新增「工具与 skill」
  Panel（与「按项目分布 / 按模型分布 / 活跃时段」同族同语言，共用区间选择器）；
  不做第三个分段档（错误档的分段是「另一种分析」，工具统计是用量分布的同类）；
- 排行：Top-N 折尾（实测前四名占 96%、长尾极平——折尾必须；N 个数设计师定）；
  四桶**混排一张榜**还是**分组四小节**由设计师裁决（数据事实：内置工具的量级
  21k+ 遥遥领先，skill 25 个但个位到 41 次，MCP 极稀 1 server/3 次——混排会让
  skill/MCP 永远沉底，分组可能更诚实）；
- **两个口径的呈现**：默认「含子 agent」为主读数（完整图景），主链数进悬停/
  次读数——不设切换控件（N1 的裁决先例：控件泛滥）；口径写进脚注；
- 每桶可下钻：点击 → 涉及会话列表（复用 CompactionStatsPanel 的 top-3 行
  onOpenSession 先例形态）→ 点会话回会话分析；
- 空态（区间无调用）如实说明；扫描中渐进更新（与用量档同款）。

## 3. 测试设计

| 层 | 内容 |
| --- | --- |
| 夹具 | 复用 `error-session.jsonl`（已有 Bash/Edit/Read/sidechain）+ **扩展或新造** `tool-census-session.jsonl`：Skill 调用（`ns:name` 形态 + 裸名）、`mcp__server__tool`（3 段 + 防御性 2 段名）、Agent（subagent_type）、主链/sidechain 各若干；单测与 e2e 共用 |
| 单元 | classifyToolUse 全分支（含边界：mcp__x 只 2 段、input 缺 skill 字段、Task 兼容）；toolCensus：双口径计数、排序稳定、空输入、会话数去重；extractToolCalls sidechain 并入 |
| 交叉验证 | 夹具里 Agent 的 toolUseResult.totalToolUseCount 与 sidechain 行数对账用例（研究报告建议的抽样验证） |
| 组件 | Panel 渲染、折尾、双口径读数、下钻列表、空态、脚注在场 |
| e2e（双引擎） | 夹具注入 → 数字与夹具一致 → 点桶下钻会话列表 → 点会话跳转 → 空态 |
| GUI 门禁 | 用量档新增「工具与 skill」面板的可达步骤 + 几何事实（榜行是真列表——**行结构用 N1/N2 的 li 承载行高先例**） |
| 截图 | 用量档含新面板的截图更新（亮暗 × 双引擎）+ 主清单与自测清单同步（N1 教训） |
| 变异 | 删 sidechain 遍历 → 双口径用例红；删 mcp 前缀判定 → mcp 用例红 |

## 4. 边界与回滚

新代码：`toolCensus.ts` + 新 Panel 组件 + `UsageSessionInput` 一个可选字段 +
`UsageOverviewPage` 一处插入 + 门禁/截图清单同步；单 PR revert 即回滚。

不做：MCP server 管理编辑、「建议卸载」、跨会话工具×时间矩阵（趋势若设计师
要求则只做单选 Top 工具的简单折线，不做全量热图）。
