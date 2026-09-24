# 贡献指南

感谢参与本项目的开发。本文说明本地开发、提交规范和 Pull Request 流程。GitHub 中没有 “MR” 这个术语，等效概念是 **Pull Request（PR）**。

## 开发环境

- Node.js 22 和 npm
- Rust 1.77 或更高版本
- macOS 需要 Xcode Command Line Tools
- Windows 构建需要 Visual Studio Build Tools 和 MSVC Rust target

安装依赖并检查环境：

```bash
npm --prefix web install
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

启动开发环境：

```bash
# Web UI dev server：http://127.0.0.1:5173
npm --prefix web run dev

# 桌面应用
cargo run --manifest-path src-tauri/Cargo.toml
```

更多细节见 [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md)。

## 工作流程

1. 从最新的 `main` 创建功能分支。
2. 使用简短、聚焦的分支名，例如 `feat/session-export`、`fix/windows-terminal`、`docs/contributing`。
3. 一个 PR 只解决一个主题，避免混入无关格式化或依赖升级。
4. 保持提交小而清晰；非显而易见的决策写在 commit body 中。
5. 提交前运行测试和构建。
6. 打开 PR，填写模板，请求维护者 review。

## 提交信息

使用 Conventional Commits 风格，并尽量带 scope：

```text
feat(web): add session export
fix(web): normalize log path
feat(tauri): harden command scope
docs: update build steps
test(web): cover parser errors
chore(deps): bump vite to 5.4.21
```

提交标题使用祈使句、不加句号。涉及破坏性行为时，在 body 中说明迁移方式。

## Pull Request 要求

PR 描述必须包含：

- 变更内容与动机；
- 关联 issue 或任务；
- 测试方式，包括已执行的命令；
- 对用户可见变化提供截图或录屏；
- 平台注意事项，例如 macOS Intel/Apple Silicon、Windows、WebView2；
- 是否修改了权限、打包流程、版本号或文档。

提交前至少检查：

```bash
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

如果修改了 Rust 代码，运行：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
```

如果修改了打包流程，请实际运行对应平台脚本并记录产物名称。

## 文档与安全要求

- 新功能必须同步 README、`docs/LOCAL_DEVELOPMENT.md` 或 `CHANGELOG.md`。
- 不要提交 `web/dist/`、`node_modules/`、Rust `target/`、`dist-intel/`、`dist-arm64/` 或 `dist-windows/`。
- 不要扩大 Tauri 的文件系统、进程或 shell 权限；确有必要时必须在 PR 中说明范围和缓解措施。
- 会话数据可能包含代码、路径和敏感输出；修改报告生成逻辑时必须在文档中说明数据去向。
- 安全漏洞不要通过公开 issue 报告，使用 GitHub Security Advisories。
