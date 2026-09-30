# Repository Guidelines

## Open-Source Workflow（协作流程）

本项目按真实开源项目的方式维护：小批量提交、PR 驱动、CI 门禁、Issue 追踪、
里程碑与版本发布。这一节是**流程的单一入口**——新会话读完它就知道该怎么做事，
不必先去加载 skill。

> 详细执行规则（bash 编码硬规则、提交细节、完整踩坑记录）见
> [`.claude/skills/maintain-loop/SKILL.md`](.claude/skills/maintain-loop/SKILL.md)；
> 从零搭建开源基建的流程见
> [`.claude/skills/oss-bootstrap/SKILL.md`](.claude/skills/oss-bootstrap/SKILL.md)
> （项目基建已就位，日常迭代用不到它）。
> 下面写的是**每次都用得到的部分**。

**核心闭环：规划 → 实现 → 发布 → 继续规划。** 每轮围绕一个主题走完再开下一轮。

### 规则写在哪（不要写第二份）

同一个主题只允许有一个权威位置，改规则时只改权威那一处。
**完整的分工表与理由见
[`.trellis/spec/guides/collaboration-workflow.md`](.trellis/spec/guides/collaboration-workflow.md)**，
这里只给结论：

| 主题 | 权威位置 |
| --- | --- |
| 协作闭环、阶段动作、项目红线 | **本节（AGENTS.md）** |
| 执行细节、bash 编码硬规则、完整踩坑史 | `.claude/skills/maintain-loop/SKILL.md` |
| Trellis 阶段机制、任务状态机 | `.trellis/workflow.md` |
| 分层编码约定 | `.trellis/spec/frontend/`、`.trellis/spec/backend/` |
| 发布步骤与仓库配置 | `docs/MAINTAINER_GUIDE.md` |

**Trellis 管「一个任务内部怎么做完」（Plan → Execute → Finish），
我们管「任务之间怎么流转」（Issue → 分支 → PR → CI → Release）。**
Trellis 的 Finish 到「PR 已合并」为止——**它不等于发布**，发布仍是独立的一轮。
一个 GitHub Issue 对应一个 Trellis 任务；纯答疑和一行修复不必建任务。

**分工**：主会话做**调度者与验收者**，功能的实现**一律派智能体团队里的子 agent
去写，主会话不自己写实现代码**。理由是验收必须独立——实现的人说「没问题」
不构成验收。主会话仍要亲自读代码、跑验收命令、审 diff，
并且**亲自看截图、亲自复现缺陷**。完整规则见
[`.trellis/spec/guides/collaboration-workflow.md`](.trellis/spec/guides/collaboration-workflow.md)。

### 1. 动手前先盘点现状

```bash
gh issue list --state open
gh release list
git status --short && git log --oneline -3
```

检查三件事：本地与远端是否一致、`main` 的 CI 是否绿、`CHANGELOG.md` 的
`[Unreleased]` 是否积压了未发布的改动（积压即说明「发布」这一步欠着，优先补上）。

### 2. 实现：一个 Issue 一个分支一个 PR

- 分支名 `feat/*`、`fix/*`、`docs/*`、`chore/*`
- **动手前核实 Issue 的前提**——前提不成立时在 Issue 里说明并改写范围，
  不要硬着头皮实现错误的目标
- 提交信息遵循约定式提交；CI 校验 PR 里的提交**与 PR 标题**（squash 后标题
  即提交信息）。可用 `./scripts/check-commit-msg.sh --message "..."` 预检
- **用户可感知的改动**记入 `CHANGELOG.md` 的 `[Unreleased]`，分类固定为
  Added / Changed / Deprecated / Removed / Fixed / Security，不自创分类
- 推送前跑 `./scripts/lint.sh` 与下面「Testing Guidelines」里的构建检查

### 3. 合并：CI 全绿才合

- 分支保护要求 **「CI 总览」** 这一个 check 通过（增删检查项不用改保护规则）
- `gh pr merge <N> --squash --delete-branch`
- **`gh pr merge` 常报 `BLOCKED` 而检查其实全绿**：这是 GitHub 的状态同步延迟，
  等 30~60 秒变 `CLEAN` 再合，**不要当成配置问题去找绕过办法**

### 4. 发布

1. 从最新 `main` 切 `chore/release-vX.Y.Z`
2. **版本号三处同步**：`web/package.json`、`src-tauri/Cargo.toml`（跑
   `cargo check` 刷新 `Cargo.lock`）、`src-tauri/tauri.conf.json`
3. 把 CHANGELOG 的 `[Unreleased]` 归档为 `[X.Y.Z] - 日期`，段首写一句本轮主题；
   `[Unreleased]` 恢复为空壳
4. 提交 `chore(release): 发布 vX.Y.Z`，建发布 PR，CI 绿后 squash 合并
5. **推送 tag 前先确认远端没有同名 tag**（`git ls-remote --tags origin vX.Y.Z`
   应为空——网络抖动时 `git push` 可能「显示失败、远端已成功」，重推会触发两次
   发布），然后 `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`
6. `release.yml` 自动完成：三平台构建（macOS ARM64 / macOS Intel / Windows NSIS）
   → 三段式发布说明（CHANGELOG 手写段 + GitHub 原生 PR 清单 + 可选 AI 摘要，
   各自独立降级）→ 创建 Release 并挂载产物
7. 验证：`gh release view vX.Y.Z` 确认说明与产物齐全；
   `gh run list --workflow=release.yml` 确认运行成功

### 项目红线（任何时候不得违反）

- `${{ }}` 表达式不直接写进 `run:`，一律经 `env:` 中转（表达式注入）
- `pull_request_target` 的工作流**绝不 checkout PR 代码**
- 不在日志中输出 Secret；会话内容与用户路径视同敏感数据，引用前先剔除
- 所有 `uses:` 保持按 commit SHA pin、所有 checkout 保持 `persist-credentials: false`
- `zizmor` 基线 0 findings、`clippy` 基线 0 warnings（`-D warnings`）
- 不提交生成产物（`web/dist/`、`target/`、`dist-*`、`node_modules/`）
- release 构建不引入任何缓存路径（缓存投毒 → 带毒产物 → 分发用户）
- 会话数据不出本机：应用不内置任何遥测

### 只在 CI / 发布时暴露的坑（本地与 macOS 构建都看不出来）

CI 不跑打包，所以下面这些**只有发布时才会炸**。改完打包脚本或 `release.yml`，
本地全绿不代表发布能成——必要时发预发布 tag（`vX.Y.Z-rc.1`）真跑一次。

- **跨平台 workflow 的 `run:` 是多行 bash 时必须显式 `shell: bash`**。Windows
  runner 默认 shell 是 PowerShell，`set -euo pipefail` 会被逐字当命令执行
- **含非 ASCII 字符的 `.ps1` 必须存成 UTF-8 with BOM**。PowerShell 5.1 无 BOM 时
  按系统 ANSI 解码，中文注释会导致 `Missing closing '}' in statement block`
  ——报的是解析错误，与真正的原因（编码）隔了好几层。`./scripts/lint.sh` 已加检查
- **产物文件名不含空格**。Tauri 按 `productName`（"CC Analyzer"）命名，而 GitHub
  上传 release 产物时把空格换成点，会让本地、文档、用户下载到的是三个名字

## Project Structure & Module Organization

- `web/` contains the React, TypeScript, and Vite frontend source. Review `web/src/api/tauri.ts` for platform bridges and `web/src/features/` for feature modules.
- `web/dist/` is generated output consumed by Tauri through `frontendDist`; do not commit it.
- `src-tauri/` contains the Tauri 2 backend, Rust entry points, app configuration, bundle config (`tauri.conf.json`), capabilities, and icons. Review `src-tauri/src/lib.rs` for the main command implementations.
- `scripts/` contains packaging wrappers, the lint entry point, and the commit-message validator.
- `package.json` (repo root, private) carries build tooling only; the web frontend keeps its own manifest in `web/package.json`.
- `docs/` contains development guides and CI notes.
- Built bundles are written to `dist-arm64/`, `dist-intel/`, and `dist-windows/`; do not commit them.

## Build, Test, and Development Commands

- `npm install` (repo root): install the build toolchain. `@tauri-apps/cli` is a devDependency, so no global Tauri CLI install is needed.
- `npm run build` / `npm test`: build the frontend / run the frontend tests (delegates to `web/`).
- `npm --prefix web install`: install frontend dependencies.
- `npm --prefix web run dev`: run the Vite frontend on `127.0.0.1:5173`.
- `npm --prefix web test`: run Vitest and Testing Library tests.
- `npm --prefix web run build`: type-check and build `web/dist/`.
- `cargo run --manifest-path src-tauri/Cargo.toml`: launch the desktop app in debug mode.
- `cargo check --manifest-path src-tauri/Cargo.toml`: run a fast compile and type check.
- `cargo build --release --manifest-path src-tauri/Cargo.toml`: build the release binary (no bundling).
- `npm run build:macos` / `build:macos:arm64` / `build:macos:intel` / `build:windows`: build platform bundles through Tauri's official bundler (`.app` + `.dmg` on macOS; NSIS installer + portable ZIP on Windows).
- `npm run tauri -- <args>`: call the Tauri CLI directly.
- `./scripts/build-macos.sh [x86_64|aarch64]`: thin wrapper that installs dependencies and runs `npx tauri build`; `./scripts/build-intel-macos.sh`, `./scripts/build-arm64-macos.sh`, and `scripts/build-windows.ps1 [-Architecture x86_64|aarch64]` forward to the same flow.
- `./scripts/lint.sh`: run every static check CI runs locally (actionlint, yamllint, shellcheck, `bash -n`, zizmor). Run before pushing.
- `./scripts/check-commit-msg.sh --message "<title>"`: pre-check a commit or PR title against the Conventional Commits convention enforced in CI.

## Coding Style & Naming Conventions

- Follow standard Rust 2021 formatting: run `cargo fmt --manifest-path src-tauri/Cargo.toml` where practical.
- Use descriptive snake_case names for Rust functions, variables, and modules, and CamelCase for types and traits.
- Follow strict TypeScript and React function-component conventions. Use PascalCase for components/types, camelCase for variables/functions, and SCREAMING_SNAKE_CASE for constants.
- Keep CSS in CSS Modules; use shared design tokens from `web/src/styles/tokens.css` instead of hard-coded colors where practical.
- Route all Tauri access through `web/src/api/`; UI components should depend on the injected Bridges interfaces.
- Keep Tauri command behavior small and explicit; validate filesystem paths and user-provided input before use.
- Preserve existing JSON and shell-script formatting. Use two-space indentation for JSON and shell configuration where the file already follows that style.

## Testing Guidelines

Three layers, each covering the others' blind spot. **The authoritative rules —
which layer a change needs, acceptance criteria, and the pitfalls — live in
[`.trellis/spec/testing/`](.trellis/spec/testing/index.md).** Summary:

| Layer | Command | Covers |
| --- | --- | --- |
| Unit / component (Vitest + jsdom) | `npm --prefix web test` | Parsing, duration, filters, reports, component behavior |
| End-to-end (Playwright, real browser) | `npm --prefix web run test:e2e` | User flows against the **built** bundle; catches real CSS/layout defects |
| Real-app GUI (`./scripts/gui-test.sh`) | `./scripts/gui-test.sh [--build]` | The packaged `.app` actually launches and the whole IPC → filesystem chain runs |

- Place unit tests beside implementation files as `*.test.ts` / `*.test.tsx`; shared JSONL fixtures go under `web/tests/fixtures/` and are used by **both** the unit and the end-to-end suites.
- **New features ship with tests.** Parser, duration, filter or report changes need fixture-based cases.
- For parser, duration, filter, or report changes, add or update fixture-based tests.
- Before submitting, run `./scripts/lint.sh`, `npm --prefix web test`, `npm --prefix web run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, and `cargo check --manifest-path src-tauri/Cargo.toml`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
- For packaging changes, run the Intel macOS build script and confirm that `dist-intel/CC Analyzer.app` and `dist-intel/CC-Analyzer_<version>_x64.dmg` are produced (Windows builds emit both a `-setup.exe` NSIS installer and `CC_Analyzer_x64_portable.zip` under `dist-windows/`). Packaging is **not** exercised by CI — sending a pre-release tag remains the only real verification.
- If adding Rust tests, place unit tests beside the code in `src-tauri/src/` and name them for the behavior under test.

## Commit & Pull Request Guidelines

- Use scoped conventional commit titles such as `feat(web): add session export`, `fix(web): normalize log path`, `feat(tauri): harden command scope`, or `docs: update build steps`. CI validates PR commits and the PR title with `scripts/check-commit-msg.sh`; keep the type table in `CONTRIBUTING.md` in sync with the script.
- Keep commits focused and explain non-obvious decisions in the body when needed.
- Pull requests should describe what changed, why the change is needed, how it was tested, and any macOS-specific considerations.
- Link related issues or tasks, and include screenshots or generated-bundle names for visible or packaging changes.
- Update README, local development docs, changelog, or capability documentation whenever behavior, commands, permissions, or packaging outputs change.

## Security & Configuration Tips

- Do not disable Tauri capability checks or broaden filesystem, process, or shell permissions without explaining the requirement in the PR.
- Avoid committing generated outputs such as `dist-intel/`, `dist-arm64/`, `dist-windows/`, or the root `node_modules/`.
- Avoid committing `web/dist/`, `web/node_modules/`, Rust `target/`, or temporary analysis files.
- Keep the application version synchronized across `web/package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. There were four places until the hand-written `packaging/macos/Info.plist` was deleted — Tauri now generates the plist from `tauri.conf.json`, so do not reintroduce a fourth file to keep in sync.
- Do not edit inside the `<!-- TRELLIS:START -->` … `<!-- TRELLIS:END -->` block at the end of this file — `trellis update` regenerates it.

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

