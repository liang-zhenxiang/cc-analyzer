# Implement：N4 · 菜单栏 / 托盘常驻限额读数

> 执行计划。视觉以 `research/design-tray-meter-view.md`（轻规格）为准；
> 契约以 `design.md`（§0 定案架构）为准。
> 前置：N3 已合并（PR #162），自最新 main 切 `feat/n4-tray-meter`。

## 步骤

### 1. Rust 托盘基座

- [ ] `Cargo.toml`：tauri features 增 `"tray-icon"`（`cargo check` 刷新 lock——
  确认零新增 crate 后再继续）；
- [ ] 托盘模块：TrayIconBuilder（template 图标）+ 三项菜单 + 事件
  （打开主窗 / goto-usage emit / 退出）+ CloseRequested 拦截（读设置开关）；
- [ ] tokio 60s tick spawn + emit `"tray:tick"`；
- [ ] `set_tray_meter` 命令（title/tooltip/near_limit；平台分支跳过 Windows title；
  near_limit 强调位图启动时生成缓存）+ **三处登记**（generate_handler /
  build.rs app_manifest / capability）；
- [ ] Rust 单测：反序列化、格式化纯函数、阈值、app_manifest 含新命令。
- 验证：`cargo test --features gui-capture` + `cargo clippy --all-targets -D warnings`。

### 2. 前端桥接与数据流

- [ ] `web/src/api/` 桥接：setTrayMeter / onTrayTick / onTrayGotoUsage（Bridges
  接口注入）；mock 层补齐（e2e 用）；
- [ ] AppShell：tick → 重算 → 推送链路（数据生命周期取舍写进注释，见 design §2）；
  goto-usage 切页；首扫完成后主动推一次；
- [ ] 设置页：「关闭窗口时驻留菜单栏」开关（默认开）。
- 验证：`npm --prefix web test`（新用例 + 零回归）。

### 3. e2e

- [ ] mock 层验证 invoke 序列与事件响应（双引擎）。
- 验证：build + `test:e2e`。

### 4. GUI 门禁与截图

- [ ] 门禁新增步骤：启动后 `screencapture` 含菜单栏的全屏图 + 应用日志断言
  （tray 初始化、tick 循环、set_tray_meter 被调用过）；
- [ ] 菜单栏特写图存 docs/（README 门面；是否进 EXPECTED_VIEWS 按清单机制要求定，
      进则主/自测同步）；
- [ ] **人工一次核验**（主会话）：真机点托盘菜单的三个行为。
- 验证：`./scripts/gui-test.sh --build`（主会话）。

### 5. 变异验证（主会话）

- [ ] 删 tick spawn → 门禁日志断言红；恢复绿；
- [ ] 删 near_limit 阈值分支 → 阈值单测红；恢复绿。

### 6. 收尾（主会话）

- [ ] 全量六件套（cargo 带 gui-capture）；
- [ ] CHANGELOG：Added（托盘读数）+ **Changed（关窗常驻语义 + 开关，默认开）**
      两条都要写清；
- [ ] 提交、PR（Closes #150）、CI 绿、合并、回 main、finish。

## 回滚点

单分支单 PR；revert 即回滚（含 feature 移除）。
