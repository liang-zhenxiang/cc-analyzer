# 执行计划：实时脉搏

> 分工：主会话只做调度与验收，实现一律派子 agent（`AGENTS.md`）。验收要亲自读 diff、
> 跑命令、看截图，不接受实现者说「没问题」。

## 0. 开工前

- [ ] `git fetch origin` 并核对 `origin/main` 与已合并 PR——并行会话可能已抢先交付
  （Round V 的教训，journal 有记录）
- [ ] 建 GitHub Issue 锁定范围（引用本 PRD 的 R1–R11），分支 `feat/live-pulse`
- [ ] `python3 ./.trellis/scripts/task.py start`（仅在用户明确批准最新规划摘要之后）

## 1. 设计师规格（先于任何实现）

- [ ] 派 UI/UX 设计师 agent 写 `.trellis/workspace/liangyuxiang/design-round-w-live-pulse.md`，
  体例照 `design-round-v3-insights.md`：层级、间距档位（只用 `--sp-*`）、四态（空/加载/错误/过期）、
  浅/深/高对比度色值、字号 130%、420px 紧凑版、动效与 reduced-motion、`data-probe` 锚点清单
- [ ] 主会话独立评审：对比度表自己重算，数值验收自己复算，规格内部矛盾逐条挑
  （V 系列每轮都在这一步抓到过设计师的算错）

## 2. 纯逻辑（可与 3 并行，文件不相交）

- [ ] `pulseModel.ts` + 单测，夹具用现有 JSONL 夹具，需要时在 `web/tests/fixtures/` 增补
  含 0/2/3/6 次自动压缩的会话
- [ ] 验证：`npm --prefix web test -- pulseModel`

## 3. 调度与数据 hook

- [ ] `usePulseFeed.ts`：setTimeout 链、可见性、请求 id、自适应间隔、头部标题缓存、失败保留旧读数
- [ ] 单测用假定时器；断言「不写 meta-cache」「活跃会话标题不依赖元数据缓存」
- [ ] 在合成大夹具上量单拍主线程耗时，数字写进 PR（不是断言，是证据）

## 4. 界面

- [ ] 展示组件 + CSS Modules，严格按设计师规格；曲线组件优先复用 `usage/charts/` 的原语
- [ ] `MonitorPage` 拆出 `ExternalDashboard`（行为零变化）+ 分段控件
- [ ] `AppShell` 浮窗分支与 `PulseFloatHeader`；`compact` 走容器查询
- [ ] `src-tauri/capabilities/default.json` 加拖动权限（先核对标识）；更新
  `security-and-permissions.md`；`cargo check`

## 5. 测试基础设施与 e2e

- [ ] `tauri-mock.ts` 增加可变文件 / mtime 钩子；新增 `pulseScenario`（时间戳相对 `Date.now()`，
  不写死日期）
- [ ] 新 e2e：默认态零探测、跨标签数字一致、文件增长后更新（`page.clock`）、浮窗往返、
  外部仪表盘子视图保持 #55 不变量
- [ ] 改既有三处断言（smoke / error-states / screenshots）并在提交信息里写明为什么改
- [ ] 视图清单四处同改（`screenshots.spec.ts`、`check-screenshots.sh`、`check-screenshots-test.sh`、
  `manifest.json`），跑 `scripts/check-screenshots-test.sh`
- [ ] 注意高负载：跑浏览器测试前先 `uptime`，负载 >100 不跑（journal 教训）

## 6. 真机 GUI

- [ ] `gui-test.sh`：用 `date -u +格式串` 现算时间戳生成脉搏夹具；`PROBE_JS`（`lib.rs`，`gui-capture`
  feature）加脉搏探针事实，一律 `data-probe` 锚点；`CAPTURE_TARGETS` 补步骤
- [ ] 浮窗态抓取作为加分项：`createPDF` 在 420 宽窗口下不可靠就退回 e2e 覆盖，并在 PR 里如实说明
- [ ] `./scripts/gui-test.sh --build`，**日志落文件，读「通过 N · 失败 M」行，不看 exit code**
  （后台接 `| tail` 会吃掉退出码）
- [ ] 主会话亲自看每张截图：色深可辨、曲线末桶是「未完成」样式、会话行不挤、浮窗细头在场

## 7. 文档与规范

- [ ] README 中英、`docs/USAGE.md`、`docs/ARCHITECTURE.md`、`CHANGELOG.md [Unreleased]`（中文）
- [ ] `docs/screenshots/` 新图（仅夹具数据，核对无真实路径）
- [ ] `trellis-update-spec`：沉淀「活跃会话必然元数据缓存失配」「活跃度只陈述事实不声称运行态」

## 8. 总验收（主会话亲自跑）

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
./scripts/check-commit-msg.sh --message "feat(web): 实时脉搏——…"
```

- [ ] 独立复算实现者声称的数字（测试计数、速率、对比度），不转述
- [ ] PR 标题与每条提交过 `check-commit-msg.sh`；CI「CI 总览」绿再 `gh pr merge --squash --delete-branch`
  （`BLOCKED` 先等 30–60 秒，别当配置问题）

## 回滚点

- 步骤 4 之前：仅新增文件，删除即可
- 步骤 4 起：`MonitorPage` 入口与 `AppShell` 浮窗分支，还原这两处并移除拖动权限
- 发布 v0.25.0-beta.1 是之后单独一轮，不在本任务内
