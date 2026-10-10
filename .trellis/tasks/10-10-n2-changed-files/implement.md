# Implement：N2 · 会话「改动文件」视图

> 执行计划。视觉细节以 `research/design-changes-view.md` 为准；契约以 `design.md` 为准。
> 前置：N1 已合并（PR #159），自最新 main 切 `feat/n2-changed-files`。

## 步骤

### 1. 夹具先行

- [ ] `web/tests/fixtures/changed-files-session.jsonl`：
  - cwd 内文件 A：成功 Read ×2 → 成功 Edit ×2 → 成功 Write ×1（toolUseResult 带
    `type:"create"` 形态，实机结构照 research 报告采样）；再失败 Edit ×1（is_error）；
  - cwd 内文件 B：仅成功 Read ×1；
  - cwd 外文件 C：成功 Edit ×1（验证 relPath 原样显示）；
  - sidechain 内成功 Edit 文件 A ×1（子 agent 徽标 + sidechainCount）；
  - `file-history-snapshot` / `file-history-delta` / `attachment` / `cost-state` 行各 1；
  - 时间戳有序（首末次断言用）。
- 验证：最小解析冒烟（行数、records/sidechainMessages 数、coverage 桶）。

### 2. ParseCoverage 登记（design §0/§3）

- [ ] `SKIPPED_EVENT_TYPES` 增 `cost-state`；用夹具核实 `ai-title` / `mode` /
  `atis-latch` 哪些仍在未知桶（实机抽样出现过），在桶里的一并登记；
- [ ] 单测：新类型进 skippedCounts 不进 unknownTypeCounts；假类型 `zzz-fake`
  仍进未知桶（既有行为不变）。
- 验证：`npm --prefix web test -- parseJsonl`。

### 3. 聚合纯函数 `features/sessions/changedFiles.ts`

- [ ] `FileActivity` / `extractFileActivities` 按 design §1 实现（双源取径、
  isError 过滤计数但保留 recordId、sidechain 并入、relPath 剥离、排序）；
- [ ] `changedFiles.test.ts` 逐规则用例 + 空会话。
- 验证：`npm --prefix web test -- changedFiles`。

### 4. 「改动」子视图（按设计师规格）

- [ ] `AnalyzerView` 加 `"changes"`，分段追加「改动」；
- [ ] `ChangedFilesView.tsx/.module.css`：文件行（路径/新建徽标/计数/时间/子 agent
  徽标）→ 展开记录清单 → 点记录 `locateInLog`（切回 log 视图 + 高亮，复用
  SessionAnalyzerPage 现有机制）；空态；口径脚注；
- [ ] 组件测试：渲染、展开、跳转、空态、脚注在场。
- 验证：`npm --prefix web test`。

### 5. e2e（双引擎）

- [ ] `web/e2e/changed-files.spec.ts`：数字与夹具一致 → 展开 → 跳转高亮在视口 →
  空态（复用既有纯问答夹具或造一个最小的）。
- 验证：`npm --prefix web run build && npm --prefix web run test:e2e -- changed-files`。

### 6. 门禁与截图（N1 的三条教训全部适用）

- [ ] `gui-test.sh` 默认清单「上下文」后插「改动」步骤 + 几何事实（真列表账目：
  **注意行结构必须让 li 承载精确行高**——N1 修复的教训；展开态可达）；
- [ ] 若改动视图引入新的持久化状态（如展开记忆），门禁步骤显式重置（「视图=」
  动作模式）；
- [ ] `screenshots.spec.ts` 加改动视图（亮暗 × 双引擎）；**`check-screenshots.sh`
  的 EXPECTED_VIEWS 与 `check-screenshots-test.sh` 的自测 views 清单必须同一提交
  同步**（PR #159 的 CI 教训）。
- 验证：`./scripts/gui-test.sh --build`（亲自看退出码，别用管道吞）；
  `./scripts/check-screenshots-test.sh`。

### 7. 变异验证（主会话做）

- [ ] 删 isError 过滤 → 失败计数用例红，恢复绿；
- [ ] 删 sidechain 遍历 → sidechain 用例红，恢复绿。

### 8. 收尾（主会话做）

- [ ] 全量：lint / web test / build / e2e / cargo fmt+clippy+check+test
  （**带 `--features gui-capture`**，Issue #160 的缺口本地先补上）；
- [ ] CHANGELOG `[Unreleased]` Added 中文条目；
- [ ] 提交、PR（Closes #148）、CI 绿、squash 合并。

## 回滚点

单分支单 PR；revert 即完整回滚（design §5）。
