# 执行计划：里程碑

> 分工：主会话只做调度与验收，实现一律派子 agent（`AGENTS.md`）。
> 验收要亲自读 diff、跑命令、看截图，不接受实现者说「没问题」。

## 0. 开工前

- [x] `git fetch origin` 并核对 `origin/main`——**并行会话已经把 Round W 与 Round X 都
      发成 v0.26.0-beta.1 了**，本地落后 3 个提交，已 `reset --hard origin/main`
- [ ] 建 GitHub Issue 锁定范围（引用本 PRD 的 R1–R12），分支 `feat/milestones`
- [ ] `python3 ./.trellis/scripts/task.py start 10-16-milestones`

## 1. 设计师规格（先于任何实现）

- [ ] 派 UI/UX 设计师 agent 写 `.trellis/workspace/liangyuxiang/design-round-y-milestones.md`，
      体例照 `design-round-w-live-pulse.md`：层级、间距档位（只用 `--sp-*`）、
      已达成 / 未达成两态的**几何**差异、浅 / 深 / 高对比度色值、字号 130%、
      动效与 reduced-motion、`data-probe` 锚点清单
- [ ] 主会话独立评审：对比度表自己重算、间距与高度账自己复算、规格内部矛盾逐条挑

## 2. 纯逻辑（可与 3 并行，文件不相交）

- [ ] `web/src/features/usage/milestones.ts` + `milestones.test.ts`
- [ ] 档位表是常量、逐条测；并列规则（记录类取最早达成）测死
- [ ] 夹具：`web/tests/fixtures/` 增补覆盖「首次 / 阶梯边界 / 空」的会话
- [ ] 验证：`npm --prefix web test -- milestones`

## 3. 展示层

- [ ] `MilestonesPanel.tsx` + `.module.css` + `.test.tsx`，严格按设计师规格
- [ ] `UsageOverviewPage` 分段项加「里程碑」（顺序 `用量 | 里程碑 | 错误`），
      `readStoredView` 增加取值；**挂载不触发新扫描**
- [ ] 两处握手：会话 → `onOpenSession`；某天 → 一日回望下钻（复用日历那条状态）

## 4. 测试基础设施与 e2e

- [ ] 新 e2e：切到里程碑档看到确定值、点入口落到会话 / 日回望、空场景
- [ ] 截图矩阵加 `milestones` 视图；四处清单同改；跑 `check-screenshots-test.sh`
- [ ] 高对比度与 130% 的几何断言（不进基线图）
- [ ] **跑浏览器测试前先 `uptime`**，负载 >100 先等（前两轮的教训）

## 5. 真机 GUI

- [ ] `PROBE_JS` 加里程碑探针事实（卡片数 / 值在场 / 无横向溢出），一律 `data-probe`
- [ ] `CAPTURE_TARGETS` 加里程碑步骤；日志落文件读「通过 N · 失败 M」行，不信 exit code
- [ ] `./scripts/gui-test.sh --build`；主会话亲自看截图

## 6. 文档与规范

- [ ] README 中英、`docs/USAGE.md`、`docs/ARCHITECTURE.md`、`CHANGELOG.md [Unreleased]`
- [ ] `docs/screenshots/` 新图（仅夹具数据，核对无真实路径）
- [ ] `trellis-update-spec`：沉淀「全历史口径 vs 滚动窗口口径不得同屏出现同一概念」

## 7. 总验收（主会话亲自跑）

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
./scripts/gui-test.sh --build
```

- [ ] 独立复算实现者声称的数字（测试计数、档位阈值、性能耗时）
- [ ] PR 标题与提交过 `check-commit-msg.sh`；CI「CI 总览」绿再 squash 合并

## 回滚点

- 步骤 3 之前：仅新增文件，删除即可
- 步骤 3 起：`UsageOverviewPage` 的分段项与 `readStoredView`，还原这两处
