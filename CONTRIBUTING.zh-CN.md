# 贡献指南

感谢你考虑为本项目做贡献。

English guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 开发环境

- Node.js 22 与 npm
- Rust 1.77 或更高版本
- macOS 需要 Xcode Command Line Tools
- Windows 构建需要 Visual Studio Build Tools 与 MSVC Rust target

安装并验证：

```bash
npm --prefix web install
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

启动开发：

```bash
npm --prefix web run dev
cargo run --manifest-path src-tauri/Cargo.toml
```

详见 [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md)。

## 本地检查

推送之前跑一次 `./scripts/lint.sh` —— 它一条命令跑完 CI 里本地能跑的
全部静态检查（actionlint、yamllint、shellcheck、`bash -n`、zizmor）。
缺失的工具会被跳过并提示安装方式；跳过项不会被算作通过。

```bash
./scripts/lint.sh
```

它刻意**不覆盖**两类检查：

- **构建与测试**（`vitest`、`tsc`、`cargo fmt` / `clippy` / `check`）——
  开发过程中按需本地运行：

  ```bash
  npm --prefix web test
  npm --prefix web run build
  cargo fmt --manifest-path src-tauri/Cargo.toml --check
  cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
  cargo check --manifest-path src-tauri/Cargo.toml
  ```

- **提交信息** —— CI 校验 PR 里的提交**和 PR 标题**，而标题在 PR 建立之前
  不存在，本地无从验证。可以先用
  `./scripts/check-commit-msg.sh --message "feat(web): ..."` 预检标题格式。

## 工作流

1. 从最新的 `main` 切出聚焦的功能分支，例如
   `feat/session-export` 或 `fix/windows-terminal`。
2. 一个 Issue 对应一个分支、一个 PR。改动保持聚焦。
3. 开 PR 之前跑完上面的检查。
4. PR 标题同样遵循提交规范（squash 合并后标题会成为提交信息，
   CI 会校验它）。

## 提交信息规范

项目遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<类型>(<范围>): <描述>
```

CI 会校验 PR 中的提交信息与 PR 标题（`scripts/check-commit-msg.sh`）。
允许的类型如下 —— 请保持此表与脚本一致：

| 类型 | 用途 |
| --- | --- |
| `feat` | 面向用户的新能力 |
| `fix` | 缺陷修复 |
| `docs` | 仅文档 |
| `ci` | 工作流 / CI 配置变更 |
| `chore` | 不触及源码与测试的维护性改动 |
| `refactor` | 既不修 bug 也不加功能的代码变更 |
| `perf` | 性能优化 |
| `test` | 补充或修正测试 |
| `style` | 格式 / 空白调整，不改变含义 |
| `revert` | 回滚此前的提交 |
| `build` | 构建系统或依赖变更（Cargo / npm） |

范围（scope）描述改动区域，例如 `web`、`tauri`、`packaging`、`ci`、`docs`。

```
feat(web): 会话列表支持导出
fix(tauri): 读取会话文件前规范化日志路径
docs: 更新打包步骤说明
```

## Pull Request

请包含：

- 改了什么，以及**为什么**（diff 已经说明了「改了什么」），
- 如何验证的 —— 写具体操作，不要只写「测试通过」，
- 平台相关的注意事项，
- 关联的 Issue 或任务（用 `Closes #12` 的写法），
- 界面可见变化请附截图或录屏，
- 涉及权限、打包、版本号、文档变更时请特别注明。

不要提交生成产物：`web/dist/`、`node_modules/`、Rust `target/`、
`dist-intel/`、`dist-arm64/`、`dist-windows/`。

改动对使用者可见时，请在 [`CHANGELOG.md`](CHANGELOG.md) 的 `Unreleased`
段落按固定分类（Added / Changed / Deprecated / Removed / Fixed / Security）
补一条说明。

## 报告安全问题

请通过
[GitHub Security Advisories](https://github.com/liang-zhenxiang/cc-analyzer/security/advisories/new)
私下报告，不要开公开 Issue。项目的威胁模型见 [`SECURITY.md`](SECURITY.md)。
