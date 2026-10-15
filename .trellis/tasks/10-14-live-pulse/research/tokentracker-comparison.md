# TokenTracker 及同类项目对比（2026-10-14 调研）

来源：`gh repo view xiufengsun/TokenTracker`、其 README 与 `docs/` 目录、`gh search repos`。
星标数是调研当天的读数，会变。

## TokenTracker（约 2k star，JavaScript，MIT）

- 定位：本地优先的 token 用量与成本看板，覆盖 45 个 AI 编码工具；CLI（`npx tokentracker-cli`）+
  macOS 菜单栏 / Windows 托盘 / Linux AppImage 原生壳。
- 实时相关：内置本地服务解析日志；菜单栏、4 个桌面小组件（用量 / 热力图 / 热门模型 / 额度）、
  桌宠都读同一份本地快照。
- 其他：15 条成就轨道、17 家 provider 的额度窗口、8 家官方状态页、可选排行榜与跨设备云同步、
  Skills 管理页、`outcomes.jsonl` 侧车表的「每美元质量」（默认关）。
- 隐私：README 自述「只提取数字、时间戳、模型名」；但**默认带匿名遥测**（每日心跳 + PostHog 页面
  浏览，可用 `TOKENTRACKER_NO_TELEMETRY=1` 或 `DO_NOT_TRACK=1` 关闭）。

## 其他

- `Maciek-roboblog/Claude-Code-Usage-Monitor`（约 8.7k star）：终端里的实时预测与预警。
- `CodeZeno/Claude-Code-Usage-Monitor`（约 600）：Windows 任务栏小组件，看额度与重置时间。
- `babakarto/CodexBar-Win`、`Sapeet/claude-code-usage-monitor-macos`：托盘 / 菜单栏读数。

## 对本项目的取舍

| 取 | 不取 |
| --- | --- |
| 内置实时视图作为产品本体，不依赖外部服务 | 多 provider 额度、状态页、云同步、排行榜（要联网或账号，违反「数据不出本机」） |
| 常驻 / 副屏形态（我们的置顶浮窗承载） | 桌宠、原生桌面小组件（体量大，与「只说可核对的数字」调性不合） |
| 一眼可读的速率曲线 | 默认遥测（我们零遥测，是差异点，宜写进 README） |
| 成就体系（价值明确，但须每枚徽章可从日志核对）→ **留给后续一轮** | 4 个工具以上的宽覆盖（我们专注 Claude Code 的深度） |

差异化：上下文取证（压缩断崖、被丢弃的消息）是它们都没有的底子。本轮把它接进「此刻」视图。
