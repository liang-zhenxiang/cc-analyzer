# CC Analyzer

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/liang-zhenxiang/cc-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/liang-zhenxiang/cc-analyzer/actions/workflows/ci.yml)
[![Release](https://github.com/liang-zhenxiang/cc-analyzer/actions/workflows/release.yml/badge.svg)](https://github.com/liang-zhenxiang/cc-analyzer/releases)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/liang-zhenxiang/cc-analyzer/badge)](https://scorecard.dev/viewer/?uri=github.com/liang-zhenxiang/cc-analyzer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

把 AI 编码会话记录变成时间线、耗时树和结构化分析报告的桌面应用。
基于 Tauri 2 与 React Web UI 构建。

> 完整文档以[英文版 README](README.md) 为准；两份 README 结构一致，
> 细节文档（使用手册、架构、排错）目前以英文与中文并行维护。

订阅套餐按**滚动 5 小时窗口**计量用量，所以你一天要看几十次的就是那三个问题：
当前窗口什么时候关、还剩多少、按现在的消耗速度什么时候触顶。「用量总览」用你
自己的会话日志把这三个问题都答了——不需要账号，也不联网。

![CC Analyzer 的会话分析页：左侧分组会话列表、中部筛选区与日志表、下方分析报告面板](docs/screenshots/analyzer-log-light.png)

打开会话后的「会话分析」页——左侧是分组会话列表，中间是筛选区与日志表，
下方是分析报告面板。

![CC Analyzer 的用量总览页：5 小时计费窗口卡片、KPI 读数行、每日 token 趋势、按项目与模型分布、活跃时段热力图](docs/screenshots/usage-light.png)

「用量总览」页——顶部是 5 小时计费窗口卡片（本窗口消耗、开启与关闭时刻、
按消耗速度外推的到达限额时刻），接着是 KPI 读数行，以及近 7 / 30 / 90 天的
token 消耗趋势与分布，每个数字带来源徽章。每个界面的浅色与深色截图都归档在
[`docs/screenshots/`](docs/screenshots)。

## 功能特性

- **5 小时计费窗口** —— 看清订阅套餐被计量的那个窗口：当前消耗表盘、窗口开启
  时刻、关闭倒计时，以及按消耗速度外推的「预计到达限额时刻」。窗口聚类与
  ccusage 的 `blocks` 同口径（首条活动起算 5 小时）。限额是社区整理的估算值并
  如实标注；未选计划时只显示消耗、不显示百分比——没有分母就没有比率；运行不足
  30 分钟的窗口明示「样本不足」，不外推一个看起来很自信的时刻。全部由本机日志
  推导。
- **全局搜索（⌘K / Ctrl+K）** —— 跨全部项目、全部会话的消息级检索，结果按
  项目 → 会话分组，显示命中片段与相对时间。回车即进入该会话、打开对应记录并
  展开详情面板——搜得到就跳得到，而不只是列出来。索引在后台构建、纯内存不落盘。
- **用量总览** —— 近 7 / 30 / 90 天的 token 消耗趋势、按项目 / 模型分布与
  7×24 活跃时段热力图。每个数字带来源徽章（读自日志 / 估算），估算成本按内嵌
  离线定价快照逐模型计价并标注快照日期，全部本地聚合、零上传。
- **会话浏览** —— 按 时间线（今天 / 昨天 / 本周 / 本月 / 更早）与项目分组，
  标题增量扫描、相对时间显示。
- **统一行模型的日志视图** —— 用户 / LLM / 工具 / Agent / workflow /
  等待行，带耗时、占比与瀑布列；按行类型、成败、时长区间与自由文本筛选。
- **耗时树** —— Agent 与 workflow 子会话解析成图，时长按图计算；
  可下钻任意节点，或只分析选中的时间块。
- **AI 分析报告** —— 结构化提示词交给本机 `claude` CLI，以 Markdown
  渲染（语法高亮）；随时可取消，支持节点级与时间块级分析。
- **首屏读数行、时间刻度轴与键盘导航** —— 会话头以一行大号读数开场（总耗时 /
  输入 / 缓存读取 / 输出 / 记录数），点击即展开 Token 面板；时间轨道补上刻度、
  悬停准线与拖选实时读数；三张数据表共用一套行级键盘导航（↑↓、Home/End、
  Enter/Space）。头部按钮可一键复制该会话的 `claude --resume` 命令，粘进终端
  就能接着聊。
- **双渠道自动更新** —— 可选稳定版（默认，维护者验证后发布）或 Beta
  （每轮新功能自动构建的先行版），手动检查、一键安装并重启。更新包经签名校验，
  检查只是一次对 GitHub 发布页的读取——不上传任何数据。
- **实时监控** —— 点击后内嵌本机监控仪表盘（需自行运行，不在本仓库内），
  支持浮窗模式。
- **大规模性能** —— 实测行高窗口化渲染 + 分片解析，几十 MB 的会话
  依然流畅。
- **本地优先，注重隐私** —— 全部本地解析渲染，应用不内置任何遥测。

## 快速开始

### 下载

到 [Releases](https://github.com/liang-zhenxiang/cc-analyzer/releases)
下载对应平台产物：

| 平台 | 产物 |
| --- | --- |
| macOS Apple Silicon | `CC-Analyzer_<版本>_aarch64.dmg` |
| macOS Intel | `CC-Analyzer_<版本>_x64.dmg` |
| Windows x64 | `CC-Analyzer_<版本>_x64-setup.exe` —— 安装程序（开始菜单项 + 卸载入口） |
| Windows x64（便携版） | `CC_Analyzer_x64_portable.zip` —— 解压即用，不写注册表 |

打开 dmg 后把 **CC Analyzer** 拖到 `Applications` 快捷方式上即可。
macOS 产物为 ad-hoc 签名：首次打开若被 Gatekeeper 拦截，右键 →「打开」即可。

### 从源码构建

环境要求：Node.js 22 与 npm、Rust 1.77+、Xcode Command Line Tools
（macOS）或 Visual Studio Build Tools（Windows）。

三个平台都走 Tauri 官方打包流程，bundle 身份（`identifier`、`copyright`、
安装程序形态）因此只有一个来源：`src-tauri/tauri.conf.json`。

```bash
npm install                    # 构建工具链（Tauri CLI）

# macOS Apple Silicon            → dist-arm64/CC Analyzer.app + .dmg
npm run build:macos:arm64

# macOS Intel（交叉编译）        → dist-intel/CC Analyzer.app + .dmg
npm run build:macos:intel

# Windows（PowerShell）           → dist-windows/ NSIS 安装程序 + 便携版 zip
npm run build:windows
```

`scripts/` 下的打包脚本是同一套命令的封装，所以
`./scripts/build-macos.sh x86_64` 也能用。macOS 产物为 ad-hoc 签名
（`signingIdentity: "-"`），不需要开发者证书。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/USAGE.md](docs/USAGE.md) | 完整使用手册：安装、每个功能、数据与隐私 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 工作原理、设计取舍与被否掉的方案 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 现象 → 原因 → 解决，报错原文可搜索 |
| [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) | 本地桌面开发工作流 |
| [docs/CI.md](docs/CI.md) | CI 构建顺序与 `frontendDist` 常见坑 |
| [docs/MAINTAINER_GUIDE.md](docs/MAINTAINER_GUIDE.md) | 发布流程、仓库配置清单 |
| [CHANGELOG.md](CHANGELOG.md) | 每个版本的重要变更 |
| [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) | 贡献指南（[English](CONTRIBUTING.md)） |
| [SECURITY.md](SECURITY.md) | 漏洞报告渠道与项目威胁模型 |

## 开发

```bash
cd web && npm install && npm run dev   # Vite 开发服务器 127.0.0.1:5173
cargo run --manifest-path src-tauri/Cargo.toml
```

推送前的检查——按改动涉及的分层来跑。权威清单（哪类改动要跑哪一层、怎样算
做完）在 [`.trellis/spec/testing/`](.trellis/spec/testing/index.md)，由
[`AGENTS.md`](AGENTS.md) 的 Testing Guidelines 一节指向；下面的命令清单是它的
摘要，与它保持一致。

```bash
./scripts/lint.sh                       # 静态检查：actionlint、yamllint、shellcheck、zizmor
npm --prefix web test                   # 单元 / 组件测试（Vitest）
npm --prefix web run test:e2e           # 端到端测试（Playwright，Chromium + WebKit）
npm --prefix web run build              # 类型检查 + 生产构建
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
./scripts/gui-test.sh                   # 打包产物冒烟（需已有构建；改了打包 / IPC 后跑）
```

## 仓库结构

```
web/           React + TypeScript + Vite 前端源码
src-tauri/     Tauri 2 后端：Rust 命令层、应用配置、bundle 配置与图标
scripts/       打包入口、lint 统一入口、提交信息校验
docs/          使用、架构、排错、维护者文档
.github/       工作流、Issue/PR 模板、治理配置
package.json   构建工具链（Tauri CLI）与打包入口
```

## 路线图

路线图跟踪开放 Issue，每条都链到对应的 Issue。

- [ ] **本地归档仓库** —— 越过 Claude Code 的自动清理保存会话，支持跨月 / 跨年分析（[#70](https://github.com/liang-zhenxiang/cc-analyzer/issues/70)）
- [ ] **结构化导出** —— CSV 与单文件 HTML（[#71](https://github.com/liang-zhenxiang/cc-analyzer/issues/71)）
- [ ] **无障碍与性能细节包** —— ANSI 渲染、虚拟滚动、字号缩放（[#73](https://github.com/liang-zhenxiang/cc-analyzer/issues/73)）
- [ ] **前端升级到 React 19** —— 需与 `@types/react` / `@types/react-dom` 成套迁移（[#19](https://github.com/liang-zhenxiang/cc-analyzer/issues/19)）

有想法？欢迎
[提功能请求](https://github.com/liang-zhenxiang/cc-analyzer/issues/new/choose)。

## 贡献

欢迎任何形式的贡献——Bug 报告、文档改进、Pull Request。从
[贡献指南](CONTRIBUTING.zh-CN.md)开始，跑完本地检查，一个 PR 只做一件事。

## 安全

会话数据是敏感数据。应用全部本地解析、不内置遥测；威胁模型与漏洞
私下报告渠道见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)。第三方组件声明：[NOTICE](NOTICE)。
