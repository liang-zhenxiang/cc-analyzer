# Design：N4 · 菜单栏 / 托盘常驻限额读数

> 依据：`prd.md` + `research/tray-capability-facts.md`（Tauri 2.11.5 文档逐条核对）。
> 视觉细节（读数字符串格式、菜单结构、tooltip 文案）以设计师轻规格为准。

## 0. 定案架构（研究报告裁定，主会话采纳）

**托盘归 Rust、计算归前端、节拍归 Rust。**

- **托盘归 Rust**：`tauri` features 增 `"tray-icon"`（tray-icon 0.25.1 已在
  Cargo.lock——零新供应链面）；Rust 侧建 TrayIcon（template image）+ 菜单
  （打开主窗口 / 用量总览 / 退出）+ `set_tray_meter` 命令接收前端已算好的读数；
- **计算归前端**：限额计算 100% 复用现有 TS 链路（billingWindow/weeklyWindow/
  planLimits）——**不允许出现第二套限额口径**（PRD 硬要求）；解析与限额代码零改动；
- **节拍归 Rust**：tokio 60s interval emit `"tray:tick"` 事件 poke 前端重算回推
  （规避隐藏窗口下 WKWebView 定时器节流）；前端收到 tick → 用现有数据重算 →
  invoke `set_tray_meter`；**兜底：tick 无响应时保持旧值**（研究报告风险项）。

## 1. Rust 侧

### 1.1 托盘初始化（setup 时）

- 图标：template image（`set_icon_with_as_template(true)` 原子设置防闪）；
- 菜单（muda）：`打开 CC Analyzer`（显示主窗口）/ `用量总览`（显示主窗口 +
  emit `"tray:goto-usage"` 让前端切标签页）/ `---` / `退出`（app.exit(0)）；
- **窗口关闭语义**：拦 `CloseRequested` → `prevent_close()` + `hide()`（应用
  常驻托盘；退出只走托盘菜单）——**默认开启常驻**（本功能的意义所在），
  设置页加开关「关闭窗口时驻留菜单栏」（默认开；关掉则恢复关窗即退出的旧语义），
  语义变化写进 CHANGELOG；

### 1.2 `set_tray_meter` 命令（新）

```rust
#[derive(Deserialize)]
pub struct TrayMeter {
    pub title: String,     // macOS 菜单栏读数（如 "78%·周45%"，格式设计师定）
    pub tooltip: String,   // 悬停全文（含 provenance 文案）
    pub near_limit: bool,  // 接近限额两态图标（沿用现有阈值语义）
}
```

- `set_title(&meter.title)`（Windows Unsupported——按平台编译分支跳过 title，
  tooltip 照设）；`set_tooltip(&meter.tooltip)`；
- **两态图标保持 template**（2026-10-10 裁决，采纳设计师推翻本草案）：同一
  32×32 黑色 alpha ��图内「描边环（常态）→ 实心饼（near_limit，同外接圆
  22px）」，只在状态切换时原子 set——彩色菜单栏图标违反 macOS 单色惯例且深浅
  菜单栏必有一边不可读；位图 `Image::new_owned` 纯代码生成（零新依赖，两枚
  启动时缓存）；
- **near_limit 阈值定案**：5h 或周任一层已用 ≥ 80%（新定常量，v1 固定；两层
  都无分母恒 false——「沿用现有阈值语义」指口径语义，项目内本无现成警戒数字）；
- **命令三处登记**（项目既有测试守护）：`generate_handler!` 列表、
  `build.rs` app_manifest、capability 文件；

### 1.3 tokio tick

- setup 里 `tauri::async_runtime::spawn` 60s interval → `app.emit("tray:tick", ())`；
- 首次读数：前端启动完成扫描后主动推一次（不等首个 tick）。

## 2. 前端侧

- `web/src/api/` 桥接层加 `setTrayMeter` invoke 封装 + `onTrayTick` /
  `onTrayGotoUsage` 事件监听（ Bridges 接口注入，UI 不直接碰 Tauri——项目铁律）；
- `AppShell`：挂载时注册 tick 监听 → 重算（复用 useUsageOverview 已扫描的数据？
  **不行**——usage 页未挂载时扫描不在跑。改为：tick 时按需轻量重算——读
  metadataCache + 全量解析太重；**v1 口径：读数只在用量数据可用时更新**
  （应用启动后 usage 扫描至少跑过一次即缓存于内存 hook；tick 到来时若内存无
  数据则跳过保持旧值）。实现时核实 useUsageOverview 的数据生命周期，若页面卸载
  即丢，则把「最近一次限额读数」提升到 AppShell 级的单例缓存（usage 页每次
  扫描完成时顺手写）——**取舍实现时定，写进代码注释**；
- `onTrayGotoUsage` → `setTab("usage")` + 显示窗口；
- provenance：tooltip 文案按现有档位语言生成（读自日志/估算/推算）。

## 3. 跨平台形态

| 平台 | 读数 | 图标 | 退出 |
| --- | --- | --- | --- |
| macOS | 菜单栏 title 文本 + tooltip | template 图标 / near_limit 强调位图 | 托盘菜单 |
| Windows | **无 title**（平台硬限制）——tooltip 全文 + 点击开主窗 | 同上 | 托盘菜单 |

## 4. 测试设计

| 层 | 内容 |
| --- | --- |
| Rust 单测 | TrayMeter 反序列化；title/tooltip 格式化纯函数；near_limit 阈值判定；命令三处登记的既有测试模式（app_manifest 含新命令） |
| 前端单测 | 桥接封装（mock Bridges）；AppShell 的 tick→重算→推送链路（fake timer）；goto-usage 切页；驻留开关的设置读写 |
| e2e | mock 层验证 invoke 调用序列（Tauri 托盘本体 headless 测不了） |
| GUI 门禁 | 真机启动后：**截取含菜单栏的全屏图**（screencapture 系统命令，验证托盘图标与读数在场）+ 应用日志断言 tray 初始化与 tick 循环运行；点选托盘不可自动化（系统 UI），菜单行为以 Rust 单测 + 人工一次核验 |
| 截图 | 菜单栏特写图进 docs/（README 门面用，加进清单需主/自测同步——若只进 docs/ 不进 EXPECTED_VIEWS 则不用） |

## 5. 风险与回滚

- 隐藏窗口下 WKWebView 对 tick 事件的响应可靠性：真机门禁验证；兜底保持旧值
  （读数最多滞后到下次窗口可见，不会错）；
- 常驻语义变化是用户可感知的行为改变：CHANGELOG 用 Changed 段写清 + 设置开关；
- 回滚：Rust 托盘模块 + 前端桥接 + 设置开关集中在少量文件，revert 即回滚
  （feature 移除后 tauri feature 也移除）。
