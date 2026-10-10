# Design：N2 · 会话「改动文件」视图

> 依据：`prd.md` + `research/file-history-facts.md`（定案 A 方案：视图走 tool_use 聚合）。
> 视觉形态以 `research/design-changes-view.md`（设计师，轻量规格）为准。

## 0. 对 PRD 的一处事实修正（HEAD 核实）

`attachment` / `file-history-snapshot` / `file-history-delta` **已在** `parseJsonl.ts` 的
`SKIPPED_EVENT_TYPES` 里（J1 登记过）——它们计数进 `skippedCounts`、**不**进未知桶。
因此 F1 的真实剩余工作只剩：把实机抽样里仍落未知桶的类型（`cost-state` 已确认；
`ai-title` / `mode` / `atis-latch` 由实现时用夹具+实机核实哪个还在桶里）加进
`SKIPPED_EVENT_TYPES`。快照/delta 维持只跳过不展开（研究报告定案）。

## 1. 数据契约

### 1.1 `changedFiles.ts`（新，纯函数，`features/sessions/`）

```ts
/** 一个文件在本会话内的活动汇总（成功调用才计数，失败调用不冒充改动）。 */
export type FileActivity = {
  /** 完整路径（悬停 title 用）；列表显示用 relPath。 */
  path: string;
  /** 会话 cwd 内 → 相对路径；否则原路径。显示层直接吃它。 */
  relPath: string;
  reads: number;      // 成功 Read
  edits: number;      // 成功 Edit / NotebookEdit
  writes: number;     // 成功 Write
  createdNew: boolean;// 任一成功 Write 的 created 标记为 true（研究报告：结构里有）
  firstAt: number;    // 首次任一活动（含 Read）的时间戳
  lastAt: number;
  /** 涉及记录的 fullId（含失败调用的——下钻列表要能看到失败现场）。 */
  recordIds: string[];
  sidechainCount: number; // 子 agent 发起的成功调用数（徽标用，N1 同款）
};

export function extractFileActivities(parsed: ParsedSession): FileActivity[];
```

路径来源（按工具）：

- **Edit / Write**：`structuredResult.filePath`（`toolUseResult` 提取，HEAD 已有）；
  缺失时兜底 `toolInput.file_path`（被中断的调用没有结果结构）；
- **Read**：同上双源；
- **NotebookEdit**：`toolInput.notebook_path`（实测有没有由夹具决定，没有就不认）；
- **Bash 不参与**（口径：通过文件工具的改动；Bash 间接写文件两类数据源都看不见，
  这句话写进界面脚注）。

规则：

- **失败调用不计入 counts**（`isError` 过滤），但其 recordId **保留**在
  `recordIds`（下钻能看到失败现场——「试了没改成」也是事实）；
- **firstAt / lastAt 含失败调用**（2026-10-10 裁决，采纳设计师异议 1：失败也是
  接触该文件的事实，且全失败文件需要时间落位——否则契约会被迫改可空）；
- **含 sidechain**（子 agent 的 Edit/Write 是真实改动，语义比 N1 更强）；徽标计数；
- 排序：`lastAt` 降序（最近动过的在最上）；同刻按路径稳定排序；
- 无任何文件活动的会话 → 空数组（空态）。

### 1.2 显示路径（隐私与惯例）

`relPath` = 路径以会话 cwd 为前缀时去掉前缀（含开头的 `/`），否则原样；完整路径
只进 `title` 悬停——与现有「项目显示末段、完整名进 title」同约定。

## 2. 视图与交互

- 会话分析器新增第 4 个子视图「改动」（`AnalyzerView` 加 `"changes"`，分段控件
  追加，持久化键沿用现有 analyzer 子视图存储——实现时看 `readStoredView` 的键，
  未识别值回退 log 的既有防呆已覆盖）；
- 会话已解析时 `useMemo(extractFileActivities)`（会话级视图，无扫描管道需求）；
- **展开区记录查回**（设计师异议 3 裁决）：视图内建 `Map<string, SessionRecord>`
  键为 fullId、值并集 `records + sidechainMessages`（ContextView `recordByFullId`
  同款），契约不补字段；**sidechain 记录点击照调 `locateInLog` 不拦**（异议 2
  裁决，与 N1 同构：跳回日志现场仍是有效落点，chip title 预先说明；若
  highlightId 落空有副作用，在 `locateInLog` 内对不可命中 id 早退，不动本视图）；
- 布局（细节按设计师规格）：文件行 = 相对路径（createdNew 标「新建」徽标）+
  改动/查看计数 + 首末次时间 + 子 agent 徽标（有则显）；点击文件行 → 展开该文件
  的记录清单（时间 + 工具 + 成功/失败标记），点记录 → **跳回日志视图定位**
  （复用现有 `locateInLog`/`highlightId` 机制——同页切子视图 + 高亮，比 N1 的
  跨页 reveal 更近一层）；
- 空态（纯问答会话）：如实文案 + 口径说明（「改动 = 成功的 Edit/Write/
  NotebookEdit；查看 = Read；不含 Bash 间接写」）；
- 脚注常显口径（provenance 语言），写明：快照记录已登记但 v1 不消费。

## 3. ParseCoverage 登记（F1 落地）

- `SKIPPED_EVENT_TYPES` 增补实机确认的未知类型（至少 `cost-state`）；
- 单测：新类型行进 `skippedCounts`、**不**进 `unknownTypeCounts`；既有未知类型
  行为不变（用未登记的假类型断言仍进未知桶）。

## 4. 测试设计

| 层 | 内容 |
| --- | --- |
| 夹具 | `web/tests/fixtures/changed-files-session.jsonl`：成功的 Read/Edit/Write（Write 带创建标记）、失败的 Edit（is_error）、sidechain 内的成功 Edit、cwd 内外各一文件、snapshot/delta/attachment/cost-state 行各一 |
| 单元 | extract：双源取径、created 标记、失败不计入但保留 recordId、sidechain 并入、relPath 前缀剥离与外部路径原样、排序、空会话；ParseCoverage：新类型登记断言 |
| 组件 | 改动标签页：行渲染、展开记录清单、跳转定位、空态、口径脚注在场 |
| e2e（双引擎） | 夹具注入 → 改动视图可见且数字与夹具一致 → 展开文件 → 点记录跳回日志视图且高亮行在视口 → 纯问答夹具空态 |
| GUI 门禁 | 默认清单在「上下文」后插「改动」步骤 + 几何事实（文件列表是真列表、展开区可达）；**注意 N1 教训：若改动视图有自己的持久化状态，门禁步骤要能自愈（沿用「视图=」动作模式或显式点击）** |
| 截图 | 改动视图亮暗 × 双引擎进 EXPECTED_VIEWS + 自测夹具同步（N1 的 CI 教训：**主清单与自测清单必须同一 PR 同步**） |
| 变异 | 删 isError 过滤 → 失败计数用例红；删 sidechain 遍历 → sidechain 用例红 |

## 5. 边界与回滚

- 新代码集中：`changedFiles.ts` + `ChangedFilesView.tsx/.module.css` + parseJsonl
  一行集合增补 + SessionAnalyzerPage 接线；单 PR revert 即回滚；
- 不动 N1 的错误档、不动既有图表组件；
- 「跨会话的文件维度聚合」明确不做（后续轮次）。

## 6. 与 N1 的关系

串行：N1 合并后基于新 main 切 `feat/n2-changed-files`。样式语言沿用 N1 已定的
通道/徽标/行交互基线（子 agent 徽标同款、行选中 accent 左缘竖条同款），
不新发明。
