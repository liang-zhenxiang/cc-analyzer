# 使用手册

从拿到应用到用上每个功能的完整说明。

## 获取应用

### 方式一：下载构建产物（推荐）

到 [Releases](https://github.com/liang-zhenxiang/cc-analyzer/releases) 页面下载对应平台的产物：

| 平台 | 产物 |
| --- | --- |
| macOS Apple Silicon | `CC_Analyzer_arm64.dmg` |
| macOS Intel | `CC_Analyzer_x64.dmg` |
| Windows x64 | `CC_Analyzer_x64.zip` |

macOS：打开 dmg，把 **CC Analyzer** 拖进「应用程序」。产物使用 ad-hoc 签名，
首次打开若被 Gatekeeper 拦截，右键 →「打开」即可（只需一次）。

Windows：解压 zip 后直接运行 `CC Analyzer.exe`。

### 方式二：从源码构建

见 [README 的 Build 一节](../README.md#build)。macOS 用
`./scripts/build-arm64-macos.sh` / `./scripts/build-intel-macos.sh`，
Windows 用 `powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1`。

## 系统要求

- macOS 10.13+（Intel）/ macOS 11+（Apple Silicon）
- Windows 10+
- 应用分析的数据来自本机 Claude Code 的会话目录（`~/.claude/projects`），
  本机安装过 Claude Code 并产生过会话即可

## 功能总览

应用围绕「AI 编码会话回顾」组织，顶部工作区标签在三类页面之间切换。

### 会话分析

1. 左侧会话列表按 **时间线（今天 / 昨天 / 本周 / 本月 / 更早）** 与
   **项目** 分组，可折叠；列表顶部可在两条时间线口径之间切换，会显示
   标题补全进度。
2. 双击会话进入分析页。页首是会话头（标题 · 总耗时 · 项目 · 相对时间 ·
   打开位置）。
3. **日志视图**：一行一个活动（用户 / LLM / 工具 / Agent / workflow /
   「等用户」间隙行），带耗时、占比、瀑布列；支持按行类型、成败状态、
   时长区间与自由文本筛选。
4. **耗时树**：Agent 与 workflow 子会话以树形展开，时长按图解析；
   勾选「仅分析所选时间块」可以只看选中的时间范围。
5. 日志与树**双向定位**：在树里点一条记录，日志滚动过去，反之亦然。
6. **记录详情**：单条记录展开可见结构化结果、子会话预览，以及
   「用 claude 分析此子 agent」入口。

### 分析报告

- 点击「生成分析报告」，应用会把结构化摘要交给本机 `claude` CLI，
  返回 Markdown 报告（表格、代码块、列表均有渲染，代码块带语法高亮）。
- 报告大纲固定：概述 / 耗时分桶 / 慢工具 / 错误 / 子代理 / 工作流 /
  并行度 / 文件地图 / 证据。
- 生成过程中可点「停止分析」取消；生成结束后按钮消失是预期行为。
- 可以只对某个子 agent 或选中的时间块生成报告（节点级分析）。

### 实时监控

- 顶部工作区切换到「实时监控」，内嵌本机 `localhost` 上运行的
  cc-monitor/dashboard 页面。
- 该服务**不在本仓库内**，需要另行运行；页面会自动探测端口并重试。
- 仪表盘可以通过 `postMessage` 请求把窗口切进「浮窗模式」
  （小窗置顶）；浮窗状态下顶栏有「退出浮窗」按钮。

### 设置

顶栏齿轮打开设置面板，可调分析预算（提示词大小、明细行数、慢工具条数、
子代理数量、解析分块、日志窗口行数）。这些值持久化在本机应用数据目录。

## 数据与隐私

- 会话数据只在本机解析与展示，应用不内置任何遥测或网络上传。
- 「生成分析报告」会把**结构化摘要**交给本机 `claude` CLI，由你配置的
  模型服务处理；对数据流向敏感时请收紧设置里的报告预算，或不使用该功能。
- 应用自身的状态（标题缓存 `meta-cache-v2.json`、阈值、主题）存储在
  应用数据目录（bundle id `com.flydiy.cc-analyzer` 对应的
  application-support 目录），不写入 Claude Code 的原始数据。

## 下一步

- 遇到问题：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- 想了解实现：[ARCHITECTURE.md](ARCHITECTURE.md)
- 想参与开发：[CONTRIBUTING.md](../CONTRIBUTING.md)
