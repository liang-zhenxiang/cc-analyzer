## 这个 PR 做了什么

<!-- 用一两句话说明改动的核心内容 -->

## 为什么要做这个改动

<!--
这是 review 时最看重的一部分。diff 已经说明了「改了什么」，
这里请说明「为什么」。关联的 Issue 请用 Closes #12 的写法。
-->

Closes #

## 改动类型

<!-- 勾选适用的项。注意：如果涉及破坏性变更，请在下方单独说明 -->

- [ ] 🐛 Bug 修复
- [ ] ✨ 新功能
- [ ] 📖 文档改进
- [ ] 🔧 CI / 工作流调整
- [ ] ♻️ 重构（不改变外部行为）
- [ ] ⚠️ 破坏性变更（**请在下方详细说明影响与迁移方式**）

## 影响的模块

- [ ] `web/`（React 前端）
- [ ] `src-tauri/`（Rust 后端 / Tauri 命令）
- [ ] `packaging/` 与打包脚本
- [ ] CI 工作流
- [ ] 文档
- [ ] 仓库配置

## 我如何验证这个改动

<!--
请不要只写「测试通过」。具体说明你做了什么，例如：
- 跑了 npm --prefix web test / run build
- 跑了 cargo check / clippy / fmt --check（manifest 见 CONTRIBUTING.md）
- 在 macOS Apple Silicon 上真实打开应用验证了某个界面行为
- 跑了 ./scripts/build-arm64-macos.sh 并安装了产出的 dmg
-->

## 提交前检查清单

- [ ] 我已在本地运行与 CI 相同的检查（见 CONTRIBUTING.md「本地检查」一节）
- [ ] 我的提交信息遵循[约定式提交规范](CONTRIBUTING.zh-CN.md#提交信息规范)
- [ ] 如果改动了用户可见的行为，我已在 CHANGELOG.md 的 `Unreleased` 段落中补充说明
- [ ] 如果改动涉及版本号，`web/package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`packaging/macos/Info.plist` 已同步
- [ ] 我没有在代码、日志或截图里泄露任何会话内容、路径或个人数据
- [ ] 我没有提交生成产物（`web/dist/`、`node_modules/`、`target/`、`dist-*`）
- [ ] Tauri capability / 权限没有放宽（如有放宽，请在下方说明必要性）
- [ ] 这个 PR 只做了一件事，没有夹带无关改动

## 平台

- [ ] macOS Intel
- [ ] macOS Apple Silicon
- [ ] Windows
- [ ] 不涉及特定平台

## 补充说明

<!--
截图、录屏、需要 reviewer 特别注意的地方，都写在这里。
如果是破坏性变更，请说明用户需要做什么才能平滑迁移。
-->
