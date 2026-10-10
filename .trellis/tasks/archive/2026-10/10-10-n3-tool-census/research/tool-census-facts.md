# Research: 工具/skill/MCP 使用统计的数据地基（Issue #153）

- **Query**: 本机工具名分布实测、skill/MCP/子 agent 形态确认、解析层现状、CCHV 参考
- **Scope**: mixed（本机 JSONL 实测 + 内部代码 + 外部 README）
- **Date**: 2026-10-10

## 1. 本机实测：工具名分布

扫描脚本：`/tmp/scan_tools.py`（只读扫描，输出聚合计数，不落任何工具参数原文）。
覆盖 `~/.claude/projects/**/*.jsonl` 全量 **382 个文件（967MB）**，共 **36,660 次 tool_use**、**26 个不同工具名**。

### Top 20（按调用次数）

| # | 工具名 | 调用次数 | 占比 | 错误次数（tool_result is_error） |
|---|---|---|---|---|
| 1 | Bash | 24,722 | 67.4% | 659 |
| 2 | Edit | 4,454 | 12.1% | 96 |
| 3 | Read | 4,344 | 11.8% | 17 |
| 4 | Write | 1,689 | 4.6% | 15 |
| 5 | Agent | 260 | 0.7% | 14 |
| 6 | SendMessage | 242 | 0.7% | — |
| 7 | TaskUpdate | 176 | 0.5% | — |
| 8 | WebSearch | 148 | 0.4% | — |
| 9 | ListAgents | 113 | 0.3% | — |
| 10 | TaskCreate | 102 | 0.3% | — |
| 11 | WebFetch | 88 | 0.2% | 20 |
| 12 | Skill | 77 | 0.2% | — |
| 13 | TaskStop | 55 | — | — |
| 14 | CronCreate | 52 | — | — |
| 15 | CronDelete | 52 | — | — |
| 16 | AskUserQuestion | 47 | — | 1 |
| 17 | TaskOutput | 10 | — | — |
| 18 | EnterWorktree | 8 | — | 1 |
| 19 | ExitWorktree | 7 | — | 2 |
| 20 | EnterPlanMode | 3 | — | — |

尾部：ExitPlanMode 3、`mcp__plugin_context7_context7__query-docs` 2、ScheduleWakeup 2、Grep 2、`mcp__plugin_context7_context7__resolve-library-id` 1、Glob 1。

分布特征：**前四名（Bash/Edit/Read/Write）占 96%**——长尾极长且极平，Top-N 折尾（现有 `OTHER_LABEL` 模式）是必须的。WebFetch 错误率最高（20/88 ≈ 23%）。

### Skill 调用的真实形态

工具名恒为 **`Skill`**，input 结构 `{ skill: string, args?: string }`（实测 `Skill:skill` 出现 77 次、`Skill:args` 27 次；无其他 key）。skill 名来自 `input.skill`。

本机出现 **25 个不同 skill**（调用次数）：git-commit 41、maintain-loop 5、trellis-update-spec 4、trellis-brainstorm 2、git-smart-update 2、next-feature 2、oss-bootstrap 2、daily-report 2、其余 18 个各 1 次（find-skills、`trellis:finish-work`、dataviz、run、repo-analyzer 等）。

注意 **`trellis:finish-work` 带 `命名空间:skill名` 形式**（plugin 前缀 skill），skill 名直接当字符串 key 即可，无需再拆。

### MCP 工具的真实形态

- 命名 `mcp__<服务器名>__<工具名>`；实测 `split("__")` **恒为 3 段**（服务器名本身可含单下划线，如本机的 `plugin_context7_context7`，但不含双下划线）。
- 本机仅 **1 个 MCP 服务器**（context7 文档查询，经 plugin 挂载）、共 3 次调用。样本：`mcp__plugin_context7_context7__query-docs`、`mcp__plugin_context7_context7__resolve-library-id`。
- 含义：本机数据上 MCP 维度极稀，UI 上它是一个「有则展示」的小切片，做不成主视图。

### 子 agent 工具的真实形态

- 工具名是 **`Agent`**（本机 0 次 `Task`——`Task` 是旧名/别名，解析层需两个都认）。
- 细分类型在 `input.subagent_type`。本机 8 种：general-purpose 89、trellis-implement 88、trellis-check 36、Explore 33、trellis-research 10、Plan 2、claude 1、claude-code-guide 1。

### Sidechain 口径（对统计最关键的实测）

- 36,660 次 tool_use = **21,581 次主链 + 15,138 次内联 sidechain（41.3%）**；210/382 个文件含 sidechain 行。
- **本机没有任何 `childSessionPath` / `toolUseResult.agentFilePath` 链接**（计数为 0）——子 agent 记录全部内联写在主会话文件里（`isSidechain: true` 的 assistant 行）。
- `Agent` 的 `toolUseResult` 自带汇总（实测 key 形态）：`agentId, agentType, resolvedModel, status, totalDurationMs, totalTokens, totalToolUseCount, toolStats{readCount, searchCount, bashCount, editFileCount, linesAdded, linesRemoved, otherToolCount}, usage, …`。`toolStats` 是**粗分桶不含工具名**，但 `totalToolUseCount` 可用于交叉验证 sidechain 解析是否算全。
- `sessionGraph.ts:223` 另有一条兜底：从文本里用正则 `agentId:\s*([\w-]+)` 抽 agentId。

## 2. 分桶规则建议（可编码判定）

对 `toolName` 依次判定（先命中先归）：

```text
1. name.startsWith("mcp__")  → MCP 工具
   parts = name.split("__")          # 实测恒 3 段
   server = parts[1]                 # 可含单下划线
   tool   = parts.slice(2).join("__") # 防御：段数 <3 时整个名字当工具名
2. name === "Agent" || name === "Task" → 子 agent 工具
   subagentType = input.subagent_type ?? "(unknown)"
3. name === "Skill"                    → Skill 调用
   skillName = input.skill（字符串；可为 "ns:name" 形式，整个当 key）
4. 其余                                 → 内置工具
```

展示口径分四个桶：**内置工具（按名）/ Skill（按 skill 名）/ MCP（按 server，下钻工具）/ 子 agent（按 subagent_type）**。`SendMessage`/`ListAgents`/`TaskCreate` 等团队协作工具就是内置工具桶的普通成员，无需特判（`toolCategory` 的 `direct` 已覆盖）。

## 3. 解析层现状与缺口

### 已具备（`web/src/features/sessions/parseJsonl.ts`、`types.ts`）

| 能力 | 位置 | 说明 |
|---|---|---|
| tool_use → SessionRecord | `parseJsonl.ts:559-583` | `kind: "tool"`，含 `toolName`、`toolInput`（原始 input）、`toolCategory` |
| tool_use ↔ tool_result 配对 | `parseJsonl.ts:617-634` | `pendingTools` Map 按 id 配对；补上 `durationMs`、`isError`、`toolResult`（5KB 截断 + `resultTruncated`）、`structuredResult` |
| 未配对 tool_use 标记 | `parseJsonl.ts:637-640` | `unmatched = true` + warning，进 `unmatchedToolUses` |
| 粗分类 | `parseJsonl.ts:90-95` | `toolCategory`：direct / delegated(Agent,Task) / workflow / wait(AskUserQuestion) |
| sidechain 分流 | `parseJsonl.ts:524-528, 575-580` | `isSidechain` 行进 `sidechainMessages`，**不进 `records`** |
| Agent 结构化结果 | `structuredToolResult.ts` + `types.ts:142-155` | 已解析 `agentId/agentType/totalToolUseCount` 等 |
| 会话图/子会话 | `sessionGraph.ts` | childSessionPath / agentId 两条路解析子会话文件 |

### 缺口（聚合要补的）

1. **无按工具名的聚合**：`web/src/features/usage/usageAggregations.ts` 只有 daily / models / projects / hourly 四个维度，没有 tools 维度（`UsageAggregate` 里没有对应 Map）。
2. **Skill 名、subagent_type、MCP server 不在顶层字段**：都埋在 `record.toolInput` 里，聚合时需按上面分桶规则现挖（`toolInput` 是 `unknown`，要安全取值）。
3. **sidechain 不在 `records` 里**：`aggregateSession` 只吃 `records`（主链）。工具普查若要「含子 agent 工具」，必须显式并入 `sidechainMessages`——本机 41% 的 tool_use 在里面，跳过会严重低估。
4. **跨文件双算风险**：`useSessions`/`metadataScanner` 顶层扫描不区分子会话文件；若某台机器的子 agent 记录是「独立文件」（`childSessionPath` 链接形态）而非内联 sidechain，该文件会作为独立会话进入统计一次——与内联形态不共存在同一份数据时无重叠，**本机实测为 0 个独立子会话文件，无此风险**；但口径文档要写明「内联 sidechain 并入 + 独立子会话文件按普通会话各算一次」的行为。
5. 会话列表/详情/报表均无工具统计展示：`sessionHealth.ts` 无 tool 内容；`report.ts:73` 仅在明细行打印 `record.toolName`；时长视角已有 `durationTree.ts`（按 `toolCategory` + 工具名分树，会话详情页），与调用次数视角互补。

## 4. 展示位置素材（现有 UI 里的挂载点）

| 位置 | 现状 | 适配度 |
|---|---|---|
| `usage/UsageOverviewPage.tsx`（用量总览） | 已有「按项目分布」「按模型分布」Panel（`topSlices` → `UsageSlice[]`，`DEFAULT_TOP_N=6` + `OTHER_LABEL` 折尾） | **最自然**：加「按工具分布」与其完全同构，数据管道复用 `useUsageOverview` 的渐进聚合 |
| `usage/charts/HBarChart.tsx` | 现成水平条形图组件（含测试） | Top-N 工具排行直接可用 |
| 会话详情 `SessionHeader` / `TokenPanel` | 会话级数字面板 | 可挂单会话 Top 工具（次数 + 错误数） |
| 会话详情 `durationTree` | 已按时长按工具分树 | 调用次数可作为其并列维度，不必新开页面 |

## 5. CCHV 参考要点（claude-code-history-viewer）

1. **v1.16.0 "Skill & Subagent Analytics"**：Most Used Skills / Most Used Subagents 两个区块，把 Claude `Skill` 与 `Agent` 调用**按名字**分桶，项目级 + 全局两个 scope——印证「按名聚合 + 双 scope」是用户实际要的口径（也是本 issue #153 的原话「我最常用的到底是哪几件」）。
2. **Settings Manager 内含 MCP 服务器管理**（scope 感知的 settings 编辑器）——那是管理功能，CC Analyzer 只做统计时无需跟进；MCP 维度只展示「server → 工具 → 次数」即可。
3. **v1.29.0 "Subagent cost in its session"**：子 agent 开销计入发起它的会话——与我们的 sidechain 口径问题同构；CCHV 的选择是「计入父会话、提供排除开关」。

## 6. 结论

**可行性：高。** 解析层的地基几乎全就位（tool_use/tool_result 配对、错误标记、时长、截断、sidechain 分流、Agent 结构化结果），缺的只是一层「按名聚合 + 四桶分类」的纯函数（放进 `usageAggregations.ts` 同级的模式即可），UI 有现成 Panel/条形图模式可套。

**最大风险：sidechain 口径。** 本机 41.3% 的 tool_use 在内联 sidechain 里，「我最常用哪几件」如果只算主链（现状 `records`），Bash 等会被显著低估；并入 `sidechainMessages` 则口径变成「含子 agent」，两个数差异巨大（21,581 vs 36,660）。建议聚合产出两个口径（主链 / 含子 agent）让 UI 切换，且用 `Agent.toolUseResult.totalToolUseCount` 做一次抽样交叉验证（与 sidechain 行数对账）。次级风险：MCP 维度在本机数据上极稀（1 server / 3 次），别为它做重 UI。

## Caveats / Not Found

- `Task` 工具在本机 0 次出现，其 input 形态是从 `toolCategory` 的兼容代码推断的（`parseJsonl.ts:91` 同时认 Agent/Task）；分桶规则两者都认即可。
- 独立子会话文件（`childSessionPath` 链接）本机不存在，其存在时的跨文件行为未实测，只从代码路径推断。
- 错误计数按「同文件内 tool_use id 配对」统计；16 个 tool_result 跨文件未配对（`cross_file_unmatched_results_hint`），对错误率影响可忽略。
