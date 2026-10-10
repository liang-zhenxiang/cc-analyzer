# PRD：N4 · 菜单栏 / 托盘常驻限额读数

> 任务对应 Issue #150（机会清单第 5 名；Tauri 原生托盘能力从未启用）。

## 问题

要知道「现在这个 5 小时窗口还剩多少」必须切到应用、点开用量总览。订阅用户一天
看几十次这个数字。竞品证明菜单栏常驻是形态级差异化，且正落在「仪器面板」定位上：
一块常驻的小仪表。

## 技术地基（已核实，`research/tray-capability-facts.md`，按 tauri 2.11.5 文档逐条核对）

- **能力**：`set_title` macOS 支持（图标+文本并存）、**Windows 明文 Unsupported**
  （平台硬限制）；`set_tooltip` 全平台可用；`set_icon_with_as_template` 原子换图标
  防闪；`Image::new_owned(rgba,w,h)` 可纯代码构造位图（Windows 数字徽章二期路径，
  零新依赖）；最后一个窗口关闭默认退出进程（tauri-runtime-wry 源码确认），
  常驻需拦 `CloseRequested` → prevent_close + hide；
- **现状**：tauri features=[] 但 tray-icon 0.25.1 已在 Cargo.lock——开 feature
  **零新供应链面**；限额计算 100% 在前端 TS（billingWindow/weeklyWindow/planLimits）；
  全项目无轮询模式可复用（「实时监控」是外部服务 iframe）；
- **定案架构**：托盘归 Rust、计算归前端、节拍归 Rust——Rust 建托盘 + 新命令
  `set_tray_meter` 收前端已算好的读数 + tokio 60s tick emit "tray:tick" poke 前端
  重算回推（规避隐藏窗口的 WKWebView 定时器节流）；解析与限额代码零改动；
  新命令走项目既有三处登记（generate_handler / build.rs app_manifest / capability）；
- **风险**：Windows 一期 tooltip + 点击开窗（数字徽章留二期）；隐藏窗口下事件
  回调可靠性需真机验证，兜底保持旧值。

## 功能需求

### F1 托盘常驻读数

- macOS：菜单栏图标 + 读数（5h 窗口剩余百分比或已用 + 周窗口读数）；
- Windows：按研究报告的可行方案退化（tooltip / 徽章图标），**宁可朴素不做两套口径**；
- 读数与用量总览**同一份计算**（硬要求，不允许出现第二套限额口径）；
- provenance 如实：读数是「读自日志」还是「估算/推算」在提示文案标注；
- 图标两态：正常 / 接近限额（沿用现有阈值语义）。

### F2 托盘菜单与生命周期

- 菜单：打开主窗口、切到用量总览、退出；
- 主窗口关闭时应用常驻托盘（行为与现有窗口关闭语义对齐，不偷偷改语义——
  若现状是关窗即退出，则提供常驻开关或按研究报告建议，取舍写进 design.md）；
- 数字来源必须本机计算，不常驻轮询网络。

### F3 刷新机制

- 刷新节奏（轮询间隔 vs 文件监听）按研究报告建议，与现有「实时监控」机制
  对齐不重复造轮子。

## 验收

- Rust 单测：读数格式化、阈值两态判定、（若 Rust 侧算限额）窗口计算与
  web 侧口径一致的对照测试；
- 前端单测：如涉及桥接状态同步；
- 真机 GUI 门禁：**真实启动 .app 验证托盘出现**（截图含菜单栏区域）、
  读数更新、菜单可点开主窗口；Windows 形态无法在本机验证时在 PR 说明并
  依赖 CI 构建产物；
- 现有测试零回归；lint 全绿（含 `cargo clippy -D warnings`、`cargo fmt --check`）。

## 不做（v1）

- 不做 Dynamic Island / 刘海 HUD（macOS 特有，与跨平台定位不符）；
- 不做多账号 profile；
- 不常驻轮询网络。
