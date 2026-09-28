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
| `app/` | 应用壳：`AppShell`、`WorkspaceTabs`（三个工作区页）、主题与通知 Provider |
| `features/sessions/` | 会话分析主功能：仓库读取、JSONL 解析、会话图、日志行模型、筛选、耗时树、报告生成 |
| `features/monitor/` | 实时监控页（内嵌外部 dashboard）与浮窗消息协议 |
| `features/settings/` | 分析预算（阈值）的持久化与设置面板 |
| `lib/` | 通用工具（路径、格式化、JSON 序列化、视口高度约束） |
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
- **监控**：`monitor_port` / `monitor_ping`（探测外部 dashboard）。
- **浮窗**：`float` 插件的 `enter` / `exit`（保存与恢复窗口几何）。

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

## 设计取舍（含被否掉的方案）

- **静态嵌入前端，不配 devUrl。** 日常开发用「`npm --prefix web run build`
  + `cargo run`」。试过配置 Vite dev server 集成，但会引入「桌面窗口里跑的
  到底是哪份前端」的歧义，而且 `web/dist` 变化会触发 Rust 重编（`generate_context!`
  重新嵌入），实测没有嵌入缓存问题，两步启动足够简单可靠。
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
