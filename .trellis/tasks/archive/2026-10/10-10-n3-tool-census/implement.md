# Implement：N3 · 工具 / skill / MCP 使用统计

> 执行计划。视觉以 `research/design-tool-census-view.md` 为准；契约以 `design.md` 为准。
> 前置：N2 已合并（PR #161），自最新 main 切 `feat/n3-tool-census`。

## 步骤

### 1. 夹具

- [ ] `web/tests/fixtures/tool-census-session.jsonl`（或扩展 error-session——若扩展，
  所有既有断言要复核不受新行影响，**倾向新造**）：Bash/Edit/Read 主链+sidechain、
  Skill ×2（`ns:name` 与裸名各一）、`mcp__demo__query`、`mcp__broken`（2 段防御）、
  Agent ×1（input.subagent_type=trellis-research，toolUseResult 带
  totalToolUseCount=N 供对账）、时间戳在窗内。
- 验证：解析冒烟。

### 2. 聚合纯函数 `features/usage/toolCensus.ts`

- [ ] classifyToolUse（先命中先归四分支 + 全边界）、extractToolCalls（含
  sidechain）、toolCensus（双口径、排序、去重会话数、agentReportedTotal）；
- [ ] `toolCensus.test.ts`：全分支 + 对账用例 + 空/单桶。
- 验证：`npm --prefix web test -- toolCensus`。

### 3. 扫描接线

- [ ] `UsageSessionInput.toolCalls` 字段 + `readSession` 调 extractToolCalls；
- [ ] `useUsageOverview.test` 补挂载断言（缓存命中不重算）。

### 4. 「工具与 skill」Panel（按设计师规格）

- [ ] 组件 + module.css（令牌零新增；行结构 li 承载行高——N1/N2 教训）；
- [ ] 折尾、双口径读数、下钻会话列表（onOpenSession 先例）、空态、脚注；
- [ ] 组件测试。
- 验证：`npm --prefix web test`。

### 5. e2e（双引擎）

- [ ] `web/e2e/tool-census.spec.ts`：数字一致 → 折尾展开（若规格有）→ 下钻 →
  跳会话 → 空态。
- 验证：build + `test:e2e -- tool-census`。

### 6. 门禁与截图

- [ ] 用量档步骤后补「工具与 skill」面板可达（滚动=main 已滚一次可达——几何
  事实按现有三面板判定的模式扩展）；探针 `data-tool-census-*`；
- [ ] 截图：用量档截图本身已存在（usage-*），新面板使其内容变化 → 重出全套；
  **若新增独立视图名则主清单+自测清单同一提交同步**；
- 验证：`./scripts/gui-test.sh --build`（主会话终验）；`./scripts/check-screenshots-test.sh`。

### 7. 变异验证（主会话）

- [ ] 删 sidechain 遍历 → 双口径用例红，恢复绿；
- [ ] 删 mcp 前缀判定 → mcp 桶用例红，恢复绿。

### 8. 收尾（主会话）

- [ ] 全量六件套（cargo 带 `--features gui-capture`）；
- [ ] CHANGELOG `[Unreleased]` Added 中文条目（注意别复制既有条目——N2 的教训）；
- [ ] 提交、PR（Closes #153）、CI 绿、合并、回 main、task finish。

## 回滚点

单分支单 PR；revert 即回滚。
