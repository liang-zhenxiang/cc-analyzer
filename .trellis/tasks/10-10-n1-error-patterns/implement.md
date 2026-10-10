# Implement：N1 · 跨会话错误分析

> 执行计划：按序勾完，每步带验证命令。视觉细节以
> `research/design-error-view.md`（设计师规范，落地后为唯一视觉权威）为准；
> 数据契约以 `design.md` 为准。

## 前置

- [ ] 设计师规范 `research/design-error-view.md` 已落地并经主会话验收
      （异议节逐条裁决后回写 design.md）
- [ ] 分支：`feat/n1-error-patterns`（自最新 main 切出）

## 步骤

### 1. 夹具先行

- [ ] 新建 `web/tests/fixtures/error-session.jsonl`：
      - assistant 行 ×≥6（分母），其中 1 行 `isApiErrorMessage:true` + `apiErrorStatus:402`、
        1 行无 status（`Connection refused` 文本）、1 行 `apiErrorStatus:500`；
      - tool_use/tool_result 对：Bash 成功 ×1、Bash 失败（`Exit code 3` 头部）×2、
        Edit 失败（`String to replace not found...`）×1、Read 成功 ×1；
      - 1 条 sidechain 内的 Bash 失败（isSidechain 行形态照真实样本）；
      - 1 条 AskUserQuestion 拒绝（`user doesn't want to proceed`，必须被排除）；
      - 时间戳跨 ≥2 个自然日（供日趋势裁剪断言）。
- 验证：`npm --prefix web test -- errorSession`（尚无测试，先保证文件可被
  parseJsonl 读且行数符合预期——写一个最小解析冒烟用例）。

### 2. 聚合纯函数 `features/usage/errorStats.ts`

- [ ] `ErrorEvent` / `ErrorStats` 类型与 `extractErrorEvents` / `mergeErrorStats`
      按 design.md §2.1 实现；
- [ ] 排除规则：AskUserQuestion 拒绝文本白名单排除；sidechain 并入；
      preview 截断 ≤200 字符；
- [ ] `errorStats.test.ts`：分类、三分母口径、窗口裁剪、空输入、全零、
      排除规则、sidechain 并入、排序稳定性（每条对应用例）。
- 验证：`npm --prefix web test -- errorStats`。

### 3. 扫描接线

- [ ] `UsageSessionInput` 增 `errorEvents?: readonly ErrorEvent[]`；
      `useUsageOverview.readSession` 产出时调 `extractErrorEvents`；
- [ ] 既有 `useUsageOverview.test.tsx` 补断言：errorEvents 挂载、缓存命中路径
      不重算。
- 验证：`npm --prefix web test -- useUsageOverview`。

### 4. 错误面板组件（按设计师规范）

- [ ] 新面板组件 + `*.module.css`（令牌只用现有 190 个之内的名字，规范裁决的颜色
      冲突若需新令牌——**停，先回主会话裁决**）；
- [ ] KPI 行、三切面（Top-N 折尾 + 「其他」）、归一趋势（原始数悬停）、
      事件列表（时间倒序、子 agent 徽标、preview）、空态（0 错误被验证过的表述）、
      口径脚注；
- [ ] 组件测试：渲染断言 + 折尾 + 空态 + 脚注在场 + 键盘导航（Tab 序）。
- 验证：`npm --prefix web test`（全量）。

### 5. 下钻链路

- [ ] AppShell → `UsageOverviewPage` 传 `onRevealRecord`（与 SearchPalette 的
      `onReveal` 同款接线）；事件行点击 → `setTab("analyzer") + revealRequest`；
- [ ] recordId=null（sidechain）落会话；主链事件高亮行进视口。
- 验证：组件测试模拟点击后 AppShell 状态变化；`npm --prefix web test`。

### 6. e2e（双引擎）

- [ ] `web/e2e/error-panel.spec.ts`：夹具注入 → 面板可见且数字与夹具一致 →
      展开工具切面 → 点主链事件跳回会话分析、高亮行在视口 → 切空区间验证空态；
- 验证：`npm --prefix web run build && npm --prefix web run test:e2e -- error-panel`。

### 7. GUI 门禁与截图

- [ ] `gui-test.sh` 默认视图清单加错误面板步骤（用量总览 → 滚到错误面板）+
      几何探针：趋势 SVG 有界、事件列表行高×行数=总高、下钻后高亮行在视口；
- [ ] `web/e2e/screenshots.spec.ts` 加错误面板视图（亮暗 × 双引擎）；
- 验证：`./scripts/gui-test.sh`（真机）+ `npm --prefix web run test:e2e -- screenshots`。

### 8. 变异验证（主会话亲自做）

- [ ] 变异 A：注释 sidechain 遍历 → `errorStats` sidechain 用例先红，恢复后绿；
- [ ] 变异 B：删排除规则 → 拒绝排除用例先红，恢复后绿。

### 9. 收尾

- [ ] `./scripts/lint.sh` + `npm --prefix web test` + `npm --prefix web run build`
      + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo check` + `cargo test`
      （后四项理论上无 Rust 改动，跑通即证）；
- [ ] CHANGELOG `[Unreleased]` 加中文条目（Added）；
- [ ] 提交（约定式标题）、推分支、开 PR（关联 `Closes #146`）、等 CI 绿。

## 回滚点

- 单分支单 PR；revert PR 即完整回滚（design.md §6）。
