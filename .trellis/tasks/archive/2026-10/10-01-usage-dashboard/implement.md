# 执行计划：用量总览仪表盘

> 对应 prd.md / design.md · 每步完成后打勾并记录验证命令输出摘要

## 前置

- [x] 设计师评审报告落盘，design.md §6 视觉规格定稿（色板进 tokens.css 的命名）
- [x] 分支 `feat/usage-dashboard` 从最新 main 切出

## 步骤（按序执行，每步一个可验证的产出）

1. [x] **聚合引擎** `usageAggregations.ts` + 单测
   - `aggregateSession` / `mergeAggregate` / `aggregateAll`
   - 验证：`npm --prefix web test -- usageAggregations`
2. [x] **定价快照与成本** `pricingSnapshot.ts` + `provenance.ts` + 单测
   - 验证：`npm --prefix web test -- pricingSnapshot`
3. [x] **图表基元与组件** `charts/*` + 单测（渲染节点 / aria-label / 空数据）
   - 验证：`npm --prefix web test -- charts`
4. [x] **色板与令牌**：`tokens.css` 增 `--chart-*` 系列（深浅两套），过对比度检查
5. [x] **页面与接线** `UsageOverviewPage.tsx` + `useUsageOverview.ts` +
   WorkspaceTab 接线 + 空状态
   - 验证：`npm --prefix web run build` + 手动 dev 查看
6. [x] **夹具扩充**：`web/tests/fixtures/` 补跨天/多模型会话（三层共用）
7. [x] **E2E**：`usage-overview.spec.ts`（双引擎）+ screenshots 清单更新
   - 验证：`npm --prefix web run test:e2e`
8. [x] **GUI**：gui-test.sh 扩展用量总览场景，真机截图含内容断言
   - 验证：`./scripts/gui-test.sh`（读截图，亲眼看）
9. [x] **全量回归**：`./scripts/lint.sh`、`npm --prefix web test`、
   `npm --prefix web run build`、`cargo fmt --check`、`cargo clippy -D warnings`、
   `cargo check`、`cargo test`
10. [ ] **文档**：CHANGELOG `[Unreleased]` 中文条目、README 截图与功能说明、
    docs/USAGE.md 增标签页章节
11. [ ] PR：`gh pr create`，CI 绿后 squash 合并；随后走发布轮（v0.5.0）

## 回滚点

- 步骤 1–3 纯新增文件，回滚 = 删文件
- 步骤 5 接线改动集中在 3 个文件（WorkspaceTabs/AppShell/types），回滚 = revert 单提交

## 验收门（全部满足才算完）

- prd.md 的验收清单全勾
- 我（主会话）亲自看过 GUI 截图，亲自跑过全量回归命令
