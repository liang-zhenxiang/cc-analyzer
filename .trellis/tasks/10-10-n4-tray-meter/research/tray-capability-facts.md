# Research: 菜单栏/托盘常驻限额读数——技术地基（Issue #150）

- **Query**: Tauri 2 托盘能力、跨平台形态、本项目数据流架构、刷新节奏、竞品参考
- **Scope**: mixed（内部代码盘点 + 官方文档/docs.rs/tauri-runtime-wry 源码 + 竞品 README）
- **Date**: 2026-10-10

## 一、Tauri 2 托盘能力清单

### 开启方式

```toml
# src-tauri/Cargo.toml（官方指南原文）
tauri = { version = "2.11.5", features = ["tray-icon"] }
```

托盘完全由代码创建（`TrayIconBuilder`），`tauri.conf.json` 没有托盘配置节。
出处：<https://v2.tauri.app/learn/system-tray/>

### API 能力（按 tauri 2.11.5 文档逐条核对）

| 能力 | API | 平台行为 | 出处 |
|---|---|---|---|
| 文本标题 | `TrayIcon::set_title(Option<S>)` / `TrayIconBuilder::title()` | **macOS 支持**；**Windows: Unsupported（文档原文）**；Linux 需同时有图标才显示 | [docs.rs/tauri/2.11.5 TrayIcon](https://docs.rs/tauri/2.11.5/tauri/tray/struct.TrayIcon.html) |
| 图标 | `set_icon(Option<Image>)`、`set_visible(bool)` | 全平台 | 同上 |
| tooltip | `set_tooltip(Option<S>)` | macOS/Windows 支持；Linux 不支持 | 同上 |
| 模板图标 | `set_icon_as_template(bool)` | **macOS only**（单色 template image，自动适配菜单栏深浅色） | 同上 |
| 原子换图标 | `set_icon_with_as_template(icon, template)` | macOS；文档明说 `set_icon` 后再 `set_icon_as_template` 会**渲染两次、可见闪烁**，此方法原子设置防闪；Linux/Windows 退化为 `set_icon` | 同上 |
| 菜单 | `set_menu`、`set_show_menu_on_left_click(bool)` | Linux 设置菜单后不能移除 | 同上 |
| 菜单事件 | `on_menu_event`（与任意窗口菜单共用事件通道） | 全平台 | 同上 + [官方指南](https://v2.tauri.app/learn/system-tray/) |
| 托盘事件 | `on_tray_icon_event`：Click / DoubleClick / Enter / Move / Leave | **Linux 不发任何事件**（右键菜单仍工作） | 同上 |
| 生命周期 | `TrayIcon` 引用计数，最后一个实例 drop 时图标移除（clone 多份安全） | 全平台 | 同上 |
| 运行期构造位图 | `tauri::image::Image::new_owned(Vec<u8> rgba, w, h)` | 纯代码构造 RGBA，**不需要** `image-png` feature / 编码器 | [docs.rs Image](https://docs.rs/tauri/latest/tauri/image/struct.Image.html) |

JS 侧（`@tauri-apps/api/tray` 的 `TrayIcon` 类）有同名 `setTitle/setTooltip/setIcon/...`（tauri v2.11.5 源码 `packages/api/src/tray.ts:272`），但底层走的是同一个 Rust 实现——**Windows 上 JS setTitle 同样无效**，且需要 capability 加 `core:tray:default`。

### macOS 展示形态结论

- **图标 + 文本并存可行**：NSStatusItem 的 image 与 title 独立设置、天然并存（系统自带的电池/音量即此形态），tray-icon 分别暴露两者。文本读数由系统渲染，不受 template image 规则影响。
- **文本长度**：未见文档化硬限制；实践上控制在短读数（约 ≤10 字符，如 `62%/88K`）。macOS 12+ 菜单栏空间紧张（刘海屏 + 多第三方菜单栏项）时系统会隐藏溢出的菜单栏项——这是平台已知行为，无官方 URL，读数宜短。
- **图标**：菜单栏图标应为单色 template（`set_icon_with_as_template`），否则深色菜单栏上深色图标不可见。现有 bundle 图标是彩色的，托盘需要专用单色图标资源（可在 Rust 侧以 `Image::new_owned` 画，或加一张 template PNG）。

### Windows 展示形态结论（退化取舍）

`set_title` 在 Windows 不支持（docs.rs 明文），常驻文本读数不可行。Tauri 2 下可行的两条路：

1. **tooltip（被动，一期建议）**：`set_tooltip` 支持且不受限；悬停可见两层限额读数。缺点是要悬停才可见。
2. **数字徽章图标（主动，二期候选）**：Rust 侧用 `Image::new_owned` 纯代码把「剩余百分比两位数」画成 RGBA 位图后 `set_icon`（Shell_NotifyIcon 只吃图标，这是 Windows 菜单栏类工具的通行做法）。竞品 FAQ 出现过「刷新时图标闪零」——只在数值变化时才 `set_icon` 可避免。

### 关窗常驻（源码级证据，tauri-runtime-wry v2.11.5）

退出链路（`crates/tauri-runtime-wry/src/lib.rs:4307-4324`，本次已核对源码）：
`CloseRequested` → 窗口 `Destroyed` → 窗口表为空 → 发 `RunEvent::ExitRequested { code: None }` → 无人调 `prevent_exit()` 则 `ControlFlow::Exit`。**所有平台一致：最后一个窗口关闭默认退出进程。**

常驻做法（Tauri 2 标准，无专门配置项）：

```rust
// Builder::on_window_event 拦截：
WindowEvent::CloseRequested { api, .. } => {
    api.prevent_close();
    let _ = window.hide();   // 窗口隐藏但 webview 存活
}
// 「真退出」走托盘菜单：app.exit(0)（本项目 lib.rs:1608 的 quit 菜单项已是此写法）
```

本项目 `run()` 现在是 `.run(tauri::generate_context!())`，既无 `on_window_event` 也无 RunEvent 处理——两处都要加。

### 性能 / 已知坑

- **闪烁**：唯一被文档确认的闪烁点是换图标路径（见上表 `set_icon_with_as_template`）；`set_title` 是 NSStatusItem.title 赋值，轻量，分钟级频率无压力。
- **前端定时器节流**：隐藏窗口的 WKWebView 会节流 DOM timers——「窗口隐藏时也要更新」**不能靠前端自主 setInterval 驱动**。Rust 侧 `tokio::time` interval 主动 poke 前端是可靠节拍源（前端 `listen` 回调由宿主事件注入，不属于 DOM timer 节流范畴）。残余不确定性：长隐藏下 WKWebView 是否被系统进一步挂起（App Nap）需真机验证；读数是分钟级精度，兜底策略是「停更时保持旧值」。

## 二、本项目现状盘点

### Cargo / 配置

- `src-tauri/Cargo.toml:19`：`tauri = { version = "2.11.5", features = [] }`——**tray-icon 未开启**。
- `tray-icon 0.25.1`、`muda 0.20.0` **已在 `src-tauri/Cargo.lock`**（tauri 的可选传递依赖）：开 feature 不会新增 crate 解析——与 gui-capture feature 的先例论证同款（见 Cargo.toml:26-37 注释），供应链面不变。
- `tokio` 已启用 `time` feature（Rust 节拍器零新增依赖）。`notify`（文件监听）**不在** Cargo.lock。
- `src-tauri/tauri.conf.json`：单窗口 `main`（1400×900），无托盘相关配置（Tauri 2 本也没有）。

### Rust 侧（`src-tauri/src/lib.rs`）

- 已注册命令 17 个：`read_dir` / `stat` / `read_text` / `read_head` / `write_text` / `run_lines` / `cancel_lines` / `exec_text` / `spawn_detached` / `home_dir` / `app_data_dir` / `monitor_port` / `monitor_ping` / `app_version` / `check_updates` / `install_update` / `relaunch_app`（lib.rs:1576-1594）。
- **新命令必须三处同步登记**：`generate_handler!`（lib.rs）、`build.rs` 的 `app_manifest().commands(&[])`、`capabilities/default.json` 的 `allow-*`。lib.rs:1670-1732 有两条测试守护这个一致性。
- 可直接套用的先例：
  - 应用菜单 + `on_menu_event`（lib.rs:1595-1610，`MenuBuilder`/`SubmenuBuilder`，quit 走 `app.exit(0)`）；
  - **Rust emit → 前端 listen** 事件流（`run_lines` 的 `proc:line:{streamId}`，lib.rs:205-213）；
  - **inlined plugin** 模式（`float_plugin`，lib.rs:416-539）——托盘可照此组织成独立模块。

### 限额计算位置（全部在前端 TS，`web/src/features/usage/`）

| 事实 | 位置 |
|---|---|
| 5h 计费窗口聚块（ccusage blocks 非连续变体） | `billingWindow.ts`：`clusterBillingBlocks` / `currentBlock` / `burnRateOf` / `predictLimitReach`，常量 `BILLING_WINDOW_MS` |
| 滚动 7 天窗口 | `weeklyWindow.ts`：`weeklyWindow` / `predictWeeklyLimitReach`，`WEEKLY_WINDOW_MS` |
| 计划预设与持久化 | `planLimits.ts`：`PLAN_PRESETS`（pro 1.9 万 / max5 8.8 万 / max20 22 万 / 窗口，社区估算），localStorage 键 `cca-billing-plan`，`usePlan()` |
| 数据链路 | `useSessions`（read_dir/stat 元数据扫描）→ `bridges.fs.readText` 读 JSONL → `parseJsonlTextAsync`（前端解析，`sessionParseCache` 按 mtime+size 缓存）→ `useUsageOverview` 渐进聚合 → `BillingWindowCard` |

**解析器也在前端**（`web/src/features/sessions/parseJsonl.ts`）——Rust 侧只提供文件读取原语，没有任何解析逻辑。

### 刷新机制现状

- **全项目无轮询、无文件监听**：`useSessions.ts` 是一次性扫描 + 手动 `refresh()` + `session:import` 事件；用量页打开时扫一遍。
- 「实时监控」页（`web/src/features/monitor/MonitorPage.tsx`）是**外部本机服务**（localhost:8090，不在本仓库）的 iframe + `monitor_ping`（TcpStream 连通性探测），不是可复用的数据刷新模式。

## 三、推荐数据流架构（改动面最小）

**托盘归 Rust、计算归前端、节拍归 Rust。**

1. **托盘在 Rust 侧创建**：`setup` 里 `TrayIconBuilder`（可照 `float_plugin` 组织成模块），`TrayIcon` clone 存入 state；macOS 上 `title()` + 单色 template 图标并存。
2. **限额读数仍由现有 TS 链路计算**：新增一个前端桥接层，把已算好的读数（结构化 payload：5h 剩余/总量、周剩余/总量）`invoke` 新命令 `set_tray_meter` 送达 Rust。
3. **Rust 侧组装展示**：macOS 拼 title 短读数 + 全平台 `set_tooltip` 放完整文本；Windows 一期 tooltip + 点击显示主窗口（左键 Click 事件 → `window.show()/set_focus()`，官方指南示例即此）。
4. **节拍由 Rust 驱动**：tokio interval（60s）`emit("tray:tick")` → 前端 `listen` 响应、重算、invoke 回推。窗口可见时前端渲染更新顺带推送，隐藏时靠 tick 事件驱动（规避 WKWebView 定时器节流）。
5. **关窗常驻**：`on_window_event` 拦 `CloseRequested` → `prevent_close` + `hide`；托盘菜单加「退出」。

### 为什么不是另外两条路

- **Rust 重算限额**：要在 Rust 复制解析器 + 5h 窗口规则 + 周窗口 + 计划预设——双份事实，违背项目「同一主题只有一个权威位置」原则，改动与测试面最大。仅在「窗口彻底销毁也常驻」时才必要，而 macOS 用 hide 模式 webview 存活，不需要。
- **纯前端 JS TrayIcon**：Windows `setTitle` 同样无效（底层同一 Rust 实现）；托盘生命周期挂在 webview 上（dev 热更/页面重载易残留重复图标）；隐藏节流问题原样存在；还要开 `core:tray:default` 权限。看似少写 Rust 代码，坑更多。

### 改动面清单

- `Cargo.toml`：features + `"tray-icon"`（lock 里已有，零新 crate）。
- `lib.rs`：setup 建托盘、`on_window_event`、新命令 `set_tray_meter`（三处登记 + capability）、tokio tick。
- 前端：`web/src/api/tauri.ts` 桥接 + 一个「读数变化即推送 / 收到 tick 即重算」的小模块；解析与限额计算**零改动**。

## 四、刷新节奏建议

- **60 秒 Rust tick 起步**。数据全在本地、读数分钟级变化、无 API 限额约束；竞品可配 5–300s（默认量级亦为几十秒）。
- tick 内可先 `stat` 最近会话文件的 mtime/size，无变化就跳过 emit——前端 `sessionParseCache` 的缓存键正是 mtime+size，即使全量重扫，未变文件也免解析，成本可控。
- **不建议一期上文件监听**：`notify` 不在依赖树（新增依赖）、跨平台行为有差异、JSONL 追加写会高频触发，还要自带头 debouncing。

## 五、竞品参考（Claude-Usage-Tracker，只学思路）

来源：<https://github.com/hamed-elfayome/Claude-Usage-Tracker>（原生 Swift/SwiftUI，macOS only，数据源是 claude.ai API 的 rate limit 头——**与本项目本地 JSONL + 社区估算预设的数据源根本不同**，读数口径不可能完全对齐，只能学形态）

1. **菜单栏读数形态**：5h 会话 + 周限额 + 按模型剩余，剩余/已用百分比可切换；点击弹 popover 详情、右键 context menu。
2. **刷新节奏**：可配置 5–300 秒；从睡眠唤醒后自动刷新（带 debounce）。
3. **已知坑**：FAQ 记录「刷新时图标短暂闪零」——刷新路径要避免先清后设，只在数值变化时更新图标/标题。

## 六、结论

- **可行性**：macOS 高——`set_title` + template 图标 + 图标文本并存全是 2.11.5 稳定 API，生命周期/事件模型与现有 float_plugin、菜单先例同构。Windows 无文本读数是**平台硬限制**（docs.rs 明文 Unsupported），只能退化。
- **最大风险**（按序）：
  1. Windows 形态退化要在 PRD 定案：建议一期 tooltip + 点击开主窗口，数字徽章图标（`Image::new_owned` 画位图）留二期——徽章是纯新增工作量且要处理刷新不闪。
  2. 隐藏窗口时前端对 tick 的响应可靠性（WKWebView 节流之外的 App Nap 挂起）需真机验证；兜底是保持旧值（读数分钟级精度下可接受）。
  3. 菜单栏读数口径要与 `BillingWindowCard` 一致（同一 TS 链路产出即天然一致——这正是推荐架构的理由）。
- Linux 形态差异可忽略：本项目 bundle targets 只有 app/dmg/nsis，不发 Linux。

## Caveats / Not Found

- macOS 菜单栏 title 的长度上限无官方文档（按平台实践写为「无硬限制、宜短」）；刘海屏隐藏溢出项的行为无官方 URL 出处，标注为平台常识。
- WKWebView 隐藏时事件回调是否始终送达：无权威文档，列为待真机验证项。
- 竞品为 macOS 独占，Windows 托盘形态无竞品参考。
