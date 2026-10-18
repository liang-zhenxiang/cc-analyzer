# 架构说明

面向想改代码的人：模块怎么划分、数据怎么流动、以及**为什么这样设计**
（包括被否掉的方案）。

## 总体形态

Tauri 2 桌面壳 + React 单页 UI。生产形态下前端构建产物静态嵌入二进制
（`tauri.conf.json` 的 `frontendDist: "../web/dist"`），运行期 UI 通过
Tauri 的 IPC 调用 Rust 命令层完成所有文件与进程操作。

```
web/ (React 18 + TypeScript + Vite)
  └── invoke() ──IPC──▶ src-tauri/ (Rust 命令层) ──▶ 文件系统 / 子进程
```

## 前端：`web/src/`

| 目录 | 职责 |
| --- | --- |
| `api/` | **UI 组件不直接碰 Tauri**。`bridges.ts` 定义注入接口，`tauri.ts` 是 Tauri 实现，`types.ts` 是与 Rust 命令对齐的参数/返回类型 |
| `app/` | 应用壳：`AppShell`、`WorkspaceTabs`（会话分析 / 实时监控 两个工作区页）、主题与通知 Provider |
| `features/sessions/` | 会话分析主功能：仓库读取、JSONL 解析、会话图、日志行模型、筛选、耗时树、报告生成 |
| `features/monitor/` | 实时监控页：默认的原生「脉搏」视图（活跃会话 / 速率曲线 / 5 小时窗口 / 上下文填充）+ 原生「监控台」（今天读数 / 24 小时活动 / 项目热度 / 事件流）+「外部仪表盘」第三档（显式打开后才探测）+ 浮窗消息协议 |
| `features/usage/` | 用量总览：渐进扫描（`useUsageOverview`）、区间聚合与计费窗口、消耗日历与一年洞察、工具普查、错误聚合、**里程碑**（全历史的三层可核对事实）与快照导出 |
| `features/settings/` | 分析预算（阈值）的持久化与设置面板 |
| `lib/` | 通用工具（路径、格式化、JSON 序列化、剪贴板） |
| `components/` | 跨 feature 的共享组件 |

关键模块：

- **`parseJsonl.ts`**：把 Claude Code 的会话 JSONL 解析成结构化记录——
  保留系统轮时长、sidechain、assistant 块聚合、结构化工具结果、跳过事件，
  解析警告单独收集（解析失败不静默）。每 2000 行让出事件循环，避免长会话卡 UI。
- **`sessionGraph.ts`**：递归解析 Agent / workflow 子会话图；子会话路径
  **限定在会话自己的目录树内**（`<project>/<sessionId>/subagents`），
  父目录只作为兜底——防止构造的 JSONL 让应用读任意文件。
- **`duration.ts` / `durationTree.ts`**：时长口径——本地工具区间取并集、
  轮间空档单独计、子会话/workflow 用自己的时间范围，并把区间裁剪到选定窗口。
- **`logRows.ts` / `filters.ts`**：统一行模型（用户 / LLM / 工具 / Agent /
  workflow / 等用户间隙行）+ 行级筛选（类型 / 成败 / 时长 / 文本）。
- **`virtualWindow.ts` / `measuredRows.ts`**：日志表按**实测行高**窗口化渲染，
  明细表同理——大会话（几十 MB JSONL）保持可滚动的关键。
- **`reportPrompt.ts` / `report.ts`**：报告提示词骨架（角色 / 口径 / 输出格式 /
  质量硬约束 / 待分析数据）+ 截断预算；`run_lines` 流式生成，可取消。
- **`metadataScanner.ts` / `metadataCache.ts`**：从 JSONL 头部增量扫描标题，
  缓存在 `meta-cache-v2.json`（按 mtime + size 复用条目）。

## 后端：`src-tauri/src/lib.rs`

命令层刻意保持「小而显式」：

- **文件系统**：`read_dir` / `stat` / `read_text` / `read_head` / `write_text` /
  `home_dir` / `app_data_dir`——只做薄封装与错误归一（io_error），路径校验
  在前端调用侧负责。
- **进程**：`run_lines`（流式跑子进程，供报告生成；`stdin_text` 可注入，
  `timeout_ms` 可超时）、`cancel_lines`（用户点「停止分析」时杀掉运行中的
  子进程）、`exec_text`、`spawn_detached`（打开文件/终端）。
- **监控**：`monitor_port` / `monitor_ping`（探测外部仪表盘；只在「外部仪表盘」子视图里、
  用户点「打开监控」后调用——默认的「脉搏」与原生「监控台」都不碰这两个命令）。
- **浮窗**：`float` 插件的 `enter` / `exit`（保存与恢复窗口几何）。`enter` 接收前端
  传入的 `window.innerWidth/innerHeight`，因此记录和恢复的都是页面内容区口径；恢复基线
  只在窗口命令全部成功后才清除，退出失败可原样重试。浮窗是无边框窗口
  （`set_decorations(false)`），脉搏的浮窗细头靠 `data-tauri-drag-region="deep"` + 能力
  文件里的 `core:window:allow-start-dragging` 拖动窗口——无边框窗口没有别的地方可拖，
  这是本轮唯一新增的能力（见 `.trellis/spec/backend/security-and-permissions.md`）。

## 数据流

```
~/.claude/projects/**/ *.jsonl
        │ read_head（增量扫标题）/ read_text（按需全文）
        ▼
parseJsonl ──▶ 会话图（子会话递归）──▶ 时长聚合 ──▶ 日志行 / 耗时树 / 筛选
        │                                    │
        ▼                                    ▼
meta-cache-v2.json（标题缓存）        run_lines(claude CLI) ──▶ Markdown 报告
```

「脉搏」复用同一条链路，不新写窗口数学：`usePulseFeed` 每拍调 `listSessions()`，
对 mtime/size 变过的文件重解析（命中 `sharedSessionParseCache` 则零成本），再交给
`billingReadoutsOf` / `burnRateOf` / `predictLimitReach` / `contextSeriesOf` ——
与用量总览和菜单栏读数**同一批纯函数**（所以脉搏的 5 小时消耗与用量表盘逐位相等）。
一个陷阱值得记住：正在被写的会话每次写入都让 `meta-cache-v2.json` 失配，
`listSessions` 一律把它们标成 `pending`、拿不到缓存标题；活跃会话的标题必须自己
`readHead` 现取（细节见 `.trellis/spec/frontend/hook-guidelines.md`）。

「监控台」复用同一个 `usePulseFeed`，不新增扫描通道：
`usePulseFeed().snapshot → consoleModelOf(inputs, rows, now)` 一次折出今天 token、
今天压缩数、项目热度、24 小时桶与最近 12 条事件；`billingReadoutsOf` 继续提供
「本窗口已用」的唯一读数。监控台与脉搏各持一个 hook 实例，但共用解析缓存；
项目筛选与事件类型筛选只过滤已经算好的报告，不扩大事件窗口。它不新增 `Bridges`
接口、不调用监控探测命令、不发网络请求；`ExternalDashboard` 仍只在第三档挂载，
并保持「显式打开后才探测」的状态机。

「里程碑」（Issue #214）同样不新写数学，也不新增扫描：
`useUsageOverview().inputs → milestonesOf(inputs, now)` 一次遍历折成
`tiers` / `firsts` / `records` 三层清单，`MilestonesPanel` 只负责排版（达成与否、
到下一档的距离、哪几枚缺席全部由纯逻辑层判好）。它的口径是**全历史**，与页面上的
7 / 30 / 90 天区间正交，所以那个 `useMemo` 的依赖里没有 `days`——切档既不重扫，
也不改变任何一个数字；这一点正是「同一概念不许有两个窗口」的落点（六句一年洞察是
滚动 365 天口径，里程碑因此刻意不做连胜 / 最贵一天 / 活跃占比）。

## 设计取舍（含被否掉的方案）

- **静态嵌入前端，不配 devUrl。** 日常开发用「`npm --prefix web run build`
  + `cargo run`」。试过配置 Vite dev server 集成，但会引入「桌面窗口里跑的
  到底是哪份前端」的歧义，而且 `web/dist` 变化会触发 Rust 重编（`generate_context!`
  重新嵌入），实测没有嵌入缓存问题，两步启动足够简单可靠。
- **打包统一走官方 `tauri build`，脚本只做薄封装。** identifier、copyright、
  publisher、安装程序形态（Windows NSIS）这些 bundle 配置集中在
  `src-tauri/tauri.conf.json` 一份，三个平台共用；`scripts/build-*.sh|ps1` 只负责
  装依赖（根 `npm install` + `web` 的 `npm ci`）再调 `npx tauri build`。此前
  手工组装 `.app` 的做法让 macOS 产物游离在这份配置之外——实测后果是 identifier
  与 copyright 只改了配置却进不了产物，DMG 里也缺少 `Applications` 快捷方式。
- **meta-cache-v2 不迁移 v1。** v1 缺字段且结构不同，写迁移代码的复杂度
  高于「首启动重扫一次」。v2 独立文件，按 mtime + size 复用条目，重扫成本
  只发生在文件变化时。
- **报告生成走本机 `claude` CLI，而不是内置 API 调用。** 使用者已经配置好
  自己信任的 CLI 与模型；内置 API 意味着应用要持有凭证、要面对供应商差异，
  都是不该由本项目承担的信任与维护成本。GUI 的 PATH 可能收窄，所以先
  hard-probe CLI 是否能启动，失败时报出实际存在的安装位置。
- **大表全部窗口化 + 实测行高。** 先按 31px 估高的方案实测行高是 39px，
  滚动偏移差出几千像素——行高必须测出来，估算的行高与真实 DOM 不同源。
- **报告生成可取消**：`run_lines` 起的子进程由 `cancel_lines` 显式回收，
  不依赖窗口关闭兜底。
- **`structured results` 与 `raw` 分离**：传给 React 的序列化经 helper
  处理 bigint / 循环引用 / 不可序列化值——敌意构造的 `record.raw` 不能
  让整个面板空白。
- **时长口径以「时间区间并集」为准**，不做简单求和：嵌套子会话会被重复
  计数，轮间等待单独成行而不是摊进工具耗时。
- **里程碑不做成本类。** 里程碑的承诺是「每枚都能从本机日志复算」，而累计成本读的是
  内嵌定价快照——一张**会过期**的表；「定价未知的天不计入」还会造成用户看不见的低估，
  让同一屏上的数字有**不同的完备性**（token 类 100% 完备，成本类不是）。它已经由
  KPI「估算成本」（带来源徽章与快照日期）与日历色深承载，所以 `milestonesOf` 的七枚
  阶梯全部只读日志本身（`totalsSum` / 事件计数 / 去重集合），不发第二枚金额徽章。
- **前端工具链跟随最新主版本，React 暂留 18。** vite / vitest / plugin-react
  只影响开发与构建：安全补丁与构建速度的收益明确，又被测试和 CI 兜住，
  一次升到位成本最低。React 19 则要求 `@types` 成套更换并适配 cleanup
  返回值、ref 处理等语义，与安全无关——混进工具链升级只会放大改动面，
  所以在 `dependabot.yml` 里显式 `ignore` major，等单独排期。
