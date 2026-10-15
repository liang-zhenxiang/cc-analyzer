# 实时脉搏：原生实时监控视图

## Goal

把「实时监控」标签从一个外部仪表盘的 iframe 外壳，重做成**原生视图**。它纯读本地日志，
回答三个「此刻」的问题：谁在写（活跃会话）、烧得多快（token 速率与 5 小时窗口）、
上下文离被压缩还有多远（填充曲线）。同一视图能放进 420×620 的置顶浮窗，常驻副屏当桌面小组件。

用户价值：现在这个标签对多数人是空的。外部服务不在本仓库，打开只会看到「未连接」；
而「此刻的状态」恰恰是订阅用户一天里看得最多的东西。TokenTracker 的卖点就是常驻、实时、
一眼可读（调研见 `research/tokentracker-comparison.md`）。我们补上这一块，并用上下文取证
这个别人没有的底子拉开差异。

## Background（已核实的事实）

- **现状**：`web/src/features/monitor/MonitorPage.tsx` 内嵌 `localhost:8090` 的外部服务；
  后端只有 `monitor_port` / `monitor_ping` 两个 TCP 探测命令（`src-tauri/src/lib.rs:401-414`）。
  Issue #55 之后是「显式打开」，挂载时不探测。
- **可复用的数据通路**：`SessionRepository.listSessions()` → `recentSessionsFor`（14 天回看，
  `quotaReadout.ts:24`）→ `sharedSessionParseCache`（mtime+size 校验）→ `billingReadoutsOf`
  （`billingReadouts.ts:46`）/ `burnRateOf`·`predictLimitReach`（`billingWindow.ts`）/
  `contextSeriesOf`·`compactionAnchors`（`sessions/contextSeries.ts`）。托盘每 60 秒跑同一条链路
  （`useTrayReadout.ts:14`），解析是分片让出主线程的（`parseJsonlTextAsync`）。
- **陷阱一：正在被写的会话永远拿不到缓存标题。** `listSessions` 对 mtime/size 与元数据缓存
  不一致的文件一律标 `pending`（`sessionRepository.ts` 的缓存命中判断），而活跃会话每次写入都会
  让缓存失配。标题必须自己从文件头取，不能指望 `sessionTitle(meta)`。
- **陷阱二：浮窗是无边框窗口，且没有拖动实现。** `float` 插件进入浮窗时 `set_decorations(false)`
  （`lib.rs:468`）；全仓检索 `drag`（web/src、src-tauri/src、tauri.conf.json、capabilities）
  只命中无关的时间线框选。`AppShell` 没有浮窗专属布局，420px 窗里整条顶栏照常渲染。
  **未核实**：现有 iframe 浮窗能否被拖动。
- **陷阱三：e2e 桩改不了文件。** `tauri-mock.ts` 的 `stat` 返回固定 mtime（第 139 行），
  文件内容锁在闭包里，测试侧无法在两拍之间让会话「长一截」，「下一拍就更新」目前测不了。
- **依赖该标签的现有测试与基线**：`web/e2e/smoke.spec.ts:108`、`error-states.spec.ts:100`、
  `screenshots.spec.ts:162-168`（`monitor` 视图）、`docs/screenshots/manifest.json`、
  `scripts/check-screenshots.sh` 的视图清单（Issue #196：清单硬编码三处）、
  `scripts/gui-test.sh` 的 `CAPTURE_TARGETS`「实时监控」步。

## Requirements

**R1 页面结构。** 「实时监控」标签默认进入原生「脉搏」视图；页内分段控件可切到「外部仪表盘」，
该子视图保持 #55 的全部行为（显式打开、探测重试、`enter-float` 消息协议、文案不含 `cc-monitor`）。
原生视图挂载时不调用 `monitor_port` / `monitor_ping`。

**R2 活跃会话。** 列出最近 5 小时内有新记录的会话，按最近记录时间倒序；每行有标题、项目、
「N 秒/分钟前有新记录」与三档新近度（≤2 分钟 / ≤15 分钟 / 更早）。只陈述「多久前有记录」，
不声称「正在运行」。点行打开该会话（复用用量页的 `onOpenSession` 握手）。

**R3 token 速率曲线。** 最近 60 分钟、按分钟分桶；单位与 5 小时表盘一致（四类 token 之和）。
当前这一分钟尚未走完，必须以「未完成」样式绘制，不得外推或当作整分钟画出一个假低谷。

**R4 5 小时窗口读数。** 消耗、关闭时刻、窗口平均速率、**近 15 分钟实测速率**；预测触顶时刻
只来自既有 `predictLimitReach`，窗口不足 30 分钟显示「样本不足」，没设预算不显示百分比。
同一份日志下，脉搏里的 5 小时消耗必须与用量总览表盘逐位相等。

**R5 上下文填充曲线。** 对最近活跃的那个会话，画最近 40 次调用的上下文体量，压缩处标出断崖。
参考带取「最近至多 5 次自动压缩前的体量」的 [最小, 最大]，且至少 3 次才画，否则写
「样本不足（n=…）」。不画官方上限，不预测「还能撑几分钟」。

**R6 刷新。** 视图可见时自动刷新，文件增长后一拍内反映；不重叠、离开页面或窗口不可见即停、
读取失败保留上一次读数并标注「上次更新时间 · 本次读取失败」；单拍变慢时自动拉长间隔。

**R7 浮窗。** 脉搏页头有「悬浮」按钮，经既有 `custom.enterFloatMode()` 进入浮窗。浮窗态下对
脉搏页收起整条顶栏，换成一条细头（拖动区、标题、「退出浮窗」），内容用紧凑布局（≤420px 宽
无横向溢出）。既有 iframe 触发浮窗的消息协议行为不变。

**R8 视觉与无障碍。** 界面美观度第一位：由 UI/UX 设计师 agent 出规格，主会话独立评审后再实现。
浅色 / 深色 / 高对比度三档、字号 130% 下无横向溢出；全部用令牌，不写死颜色；曲线是 `role="img"`
并带文字摘要；心跳类动画遵守 `prefers-reduced-motion`。

**R9 隐私与权限。** 不新增网络请求，不新增 Tauri 命令；能力变更仅限浮窗拖动所需的窗口权限，
PR 里写明理由。截图与夹具不含真实路径或会话内容。

**R10 测试（全部自动）。** 单元（纯函数 + 调度 hook + 组件）、端到端（Chromium + WebKit，
含截图与跨标签数字一致性）、真机 GUI（`./scripts/gui-test.sh`，真实打开 app 并配截图）。
既有测试里依赖旧默认态的断言要改，且写明为什么改；回归套件全绿。

**R11 文档。** README 中英双语、`docs/USAGE.md`、`docs/ARCHITECTURE.md`、`CHANGELOG.md`
的 `[Unreleased]`（中文，Added/Changed）同步；新增的约定（如「活跃会话必然缓存失配」）经
`trellis-update-spec` 沉淀。

## 已定决策

- **轮询日志，不加文件监听依赖。** 理由：`Cargo.toml` 里没有 `notify` 类依赖，新增依赖要过供应链
  基线；既有 mtime+size 缓存已经能让「没变的文件零成本」。
- **外部仪表盘保留为次要子视图，不删。** 理由：已有人在用，且 #55 的行为要求仍然有效。
- **数字同源。** 不新写窗口数学；预测只来自 `predictLimitReach`；「近 15 分钟」是实测值，
  不是外推，因此不会和 5 小时卡片的预测打架。
- **参考带用「最近几次」的区间，不用全历史中位数。** 理由：不同模型的自动压缩阈值不同，
  混在一起的中位数没有意义；最近几次更贴近当前这个模型。
- **一个 Issue、一个任务、一个 PR**；发布 v0.25.0-beta.1 是之后独立的一轮。
- **不顺手修 #196**，但本任务动到视图清单的三处必须同改，并跑 `check-screenshots-test.sh`。

## Acceptance Criteria

- [ ] 单元：切到监控标签后默认渲染脉搏，且 `monitor_port` / `monitor_ping` 调用次数为 0（R1）
- [ ] 单元：新近度三档在 120 秒、900 秒的边界两侧各一例（R2）
- [ ] 单元：速率分桶——最后一桶标 `partial`；无 usage 的记录不计；跨分钟边界的记录归桶正确（R3）
- [ ] 单元：近 15 分钟速率只数窗口内记录；窗口不足 30 分钟时预测为「样本不足」，无预算为 `noLimit`（R4）
- [ ] 单元：参考带在自动压缩 0 / 2 / 3 / 6 次的夹具下分别为：无 / 样本不足 / 画 / 只取最近 5 次；
  手动压缩与 `preTokens` 为 null 的事件不计入（R5）
- [ ] 单元：调度——不重叠；卸载与隐藏即停；失败保留旧读数；慢拍后间隔变长；
  活跃会话标题走文件头解析而非元数据缓存（R6）
- [ ] 端到端：同一夹具下，脉搏的 5 小时消耗 === 用量总览表盘读数（R4）
- [ ] 端到端：会话文件在两拍之间增长，脉搏无需操作即更新（R6）
- [ ] 端到端：点「悬浮」→ 顶栏收起、细头在场、420px 宽无横向溢出；点「退出浮窗」恢复（R7）
- [ ] 端到端：切到「外部仪表盘」后，#55 的断言（不自动探测、点击才探测、失败态可重试）全部仍成立（R1）
- [ ] 端到端：脉搏与浮窗态的截图按现有矩阵（浅 / 深 × Chromium / WebKit）入基线，
  `check-screenshots.sh` 与其自测通过；高对比度与 130% 字号不进基线图，改由几何断言
  （无横向溢出、曲线与会话行不被裁切）覆盖（R8）
- [ ] 真机 GUI：真实 `.app` 打开脉搏，探针事实（会话行数、曲线存在、无横向溢出）通过，
  主会话亲自看过截图；浮窗态抓取若 `createPDF` 不适用，PR 里如实说明退回 e2e 覆盖（R10）
- [ ] 声明层：浮窗细头带拖动区属性；`capabilities/default.json` 含对应窗口权限；
  拖动本身无法自动化验证，由主会话在真机上手动拖一次留证（R7、R9）
- [ ] 全套门禁：`./scripts/lint.sh`、`npm --prefix web test`、`npm --prefix web run build`、
  `npm --prefix web run test:e2e`、`cargo fmt --check`、`cargo clippy -D warnings`、
  `cargo check`、`cargo test`、`./scripts/gui-test.sh --build` 全绿

## Out of Scope

- 成就体系、桌宠、原生桌面小组件、其他厂商额度、服务状态页、云同步与排行榜、任何遥测
- 增量追加解析（只读文件新增部分）——v1 靠 mtime+size 缓存与自适应间隔，量化后再决定
- 子代理（subagent）文件计入速率——与既有计费读数的口径保持一致，不单独加宽
- 阈值告警与系统通知、「还能撑几分钟」类外推
- 修复 Issue #196 本身；设置面板里新增轮询间隔选项
