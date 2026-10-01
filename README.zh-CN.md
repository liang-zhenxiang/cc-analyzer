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

![CC Analyzer 的会话分析页：左侧分组会话列表、中部筛选区与日志表、下方分析报告面板](docs/screenshots/analyzer-log-light.png)

打开会话后的「会话分析」页——左侧是分组会话列表，中间是筛选区与日志表，
下方是分析报告面板。每个界面的浅色与深色截图都归档在
[`docs/screenshots/`](docs/screenshots)。

## 功能特性

- **会话浏览** —— 按 时间线（今天 / 昨天 / 本周 / 本月 / 更早）与项目分组，
  标题增量扫描、相对时间显示。
- **统一行模型的日志视图** —— 用户 / LLM / 工具 / Agent / workflow /
  等待行，带耗时、占比与瀑布列；按行类型、成败、时长区间与自由文本筛选。
- **耗时树** —— Agent 与 workflow 子会话解析成图，时长按图计算；
  可下钻任意节点，或只分析选中的时间块。
- **AI 分析报告** —— 结构化提示词交给本机 `claude` CLI，以 Markdown
  渲染（语法高亮）；随时可取消，支持节点级与时间块级分析。
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

推送前的检查（与 CI 相同）：

```bash
./scripts/lint.sh                      # 静态检查：actionlint、yamllint、shellcheck、zizmor
npm --prefix web test
npm --prefix web run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml
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

- [ ] 会话跨时间对比（周 / 月趋势）
- [ ] 报告模板与导出格式
- [ ] 更多平台支持
- [ ] 前端升级到 React 19（需与 `@types/react` / `@types/react-dom` 成套迁移）

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
