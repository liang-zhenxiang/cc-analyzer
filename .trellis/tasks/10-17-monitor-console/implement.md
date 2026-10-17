# 执行计划：监控台

> 分工：主会话只做调度与验收，实现一律派子 agent（`AGENTS.md`）。

## 0. 开工前

- [x] `git fetch origin`，本地与 `origin/main` 一致、工作区干净
- [ ] 建 GitHub Issue（引用 PRD 的 R1–R12），分支 `feat/monitor-console`
- [ ] `task.py start 10-17-monitor-console`

## 1. 设计师规格（先于实现）

- [ ] 派 UI/UX 设计师写 `.trellis/workspace/liangyuxiang/design-round-z-monitor-console.md`
      体例照 `design-round-y-milestones.md`：层级、`--sp-*`、两态、三主题色值、
      130% / 960 窄窗、24h 带的 partial 几何、项目速率条、事件流三类图标、四态、
      `data-probe` 清单
- [ ] 主会话独立评审：对比度脚本自己跑一遍、间距账自己复算

## 2. 纯逻辑（与 1 并行）

- [ ] `web/src/features/monitor/consoleModel.ts` + `.test.ts`
- [ ] 复用 `recentRate` / `totalsSum` / `dayStartOf` / `fallbackSessionTitle` / `sessionKeyOf`
- [ ] 夹具：`web/tests/fixtures/monitor-console.jsonl`（三类事件齐全）

## 3. 展示层

- [ ] `web/src/features/monitor/MonitorConsolePage.tsx` + `.module.css` + `.test.tsx`
- [ ] `MonitorPage` 分段项加「监控台」（`pulse | console | dashboard`，持久化键
      `cca-monitor-view` 增加取值，未知值回落 `pulse`）
- [ ] 三处握手：项目行筛选、事件行开会话、外部仪表盘原样

## 4. e2e 与截图

- [ ] `web/e2e/monitor-console.spec.ts`：确定值、点事件开会话、项目筛选、
      与脉搏的 5 小时数字一致、四态
- [ ] 截图 `monitor-console` 浅深 × 两引擎；`views.json` 一处
- [ ] 130% / HC 几何断言（不进基线）
- [ ] 跑之前 `uptime`；4173 被占时用临时端口配置（pitfalls #14）

## 5. 真机 GUI

- [ ] `PROBE_JS` 加 `facts.monitor_console`（读数条数、项目行数、事件行数、
      24 桶、partial 恰 1、无横向溢出）
- [ ] `CAPTURE_TARGETS` 加监控台步骤（显式切档，别让 localStorage 残留影响后续）
- [ ] `./scripts/gui-test.sh --build`，日志落文件读「通过 N · 失败 M」

## 6. 文档与规范

- [ ] README 中英、`docs/USAGE.md`、`docs/ARCHITECTURE.md`、`CHANGELOG.md [Unreleased]`
- [ ] 截图入 `docs/screenshots/`
- [ ] `trellis-update-spec`：沉淀「自带视图优先于外部服务依赖」这条取舍

## 7. 总验收

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:e2e
cargo fmt --check && cargo clippy --all-targets -D warnings && cargo check && cargo test
./scripts/gui-test.sh --build
```

- [ ] 独立复算实现者声称的数字（测试计数、15 分钟窗口、24h 桶、性能）
- [ ] PR 标题与提交过 `check-commit-msg.sh`；CI 绿后 squash 合并
