# CC Analyzer

[English](README.md) · [简体中文](README.zh-CN.md)

CC Analyzer 是一款用于查看 AI 编程会话活动的桌面应用。
它基于 Tauri 和 React Web UI 构建。

## 环境要求

- macOS 10.13 或更高版本（Intel），或 macOS 11 或更高版本（Apple Silicon）
- Rust 1.77 或更高版本
- Xcode Command Line Tools
- 构建 Windows 版本还需要 Windows 10 或更高版本、Visual Studio Build Tools
  以及 MSVC Rust target

## 构建

在仓库根目录中运行对应平台的打包脚本：

```bash
./scripts/build-intel-macos.sh
```


如需构建 Apple Silicon 版本，运行：

```bash
./scripts/build-arm64-macos.sh
```

如需构建 Windows 版本，在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

脚本会生成：

- `dist-intel/CC Analyzer.app`
- `dist-intel/CC Analyzer_x64.dmg`
- `dist-arm64/CC Analyzer.app`
- `dist-arm64/CC Analyzer_arm64.dmg`
- `dist-windows/CC_Analyzer_x64.zip`

## 开发

本地桌面开发流程请参阅 [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md)。CI 的构建顺序和故障排查请参阅 [docs/CI.md](docs/CI.md)。

开发 Web UI：

```bash
cd web
npm install
npm run dev
```

执行提交前检查：

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

执行 release 构建：

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml
```

## 仓库结构

- `web/` - React、TypeScript 和 Vite 前端源码；生产构建输出到 `web/dist/`
- `src-tauri/` - Tauri 后端和应用配置
- `packaging/` - macOS 打包元数据和图标
- `scripts/` - 本地打包辅助脚本
- `docs/` - 开发指南和 CI 说明

## 许可证

本项目基于 MIT 许可证发布。详情请参阅 [LICENSE](LICENSE)。

## 参与贡献

请阅读 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) 或
[CONTRIBUTING.md](CONTRIBUTING.md)，了解分支、提交信息和 Pull Request 规范。
