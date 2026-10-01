# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- 真机 GUI 测试现在**截取应用自己的窗口**，不再把截图记为「已跳过」。它不再需要 macOS 的「屏幕录制」权限，因为它根本不读屏幕：`WKWebView.createPDF` 是**让 WebKit 渲染它正在显示的那一页**，全程不经过窗口服务器。该能力挂在 `gui-capture` 这个 Cargo feature 后面，**发布构建不启用**，由 `scripts/gui-test.sh` 驱动。截图的判定是「有没有内容」而不是「文件在不在」——macOS 在真的拒绝读屏时会返回一张尺寸正确、像素全透明的位图，所以「文件出现没有」这种检查在一张透明 PNG 上照样通过。测试改为统计不同颜色的数量：空白截图过不了，真实界面能过。
- `./scripts/build-macos.sh --help` 现在打印用法并以 0 退出。此前它会落到「未知架构」分支并报「不支持的架构：--help」，读起来像是你传了一个架构进去。
- 发布说明的**中文化转换**：新增 `scripts/format-release-notes.sh` 与仓库级 `.github/release.yml`。GitHub 原生变更清单自带的英文模板串（`What's Changed`、`New Contributors`、`Full Changelog`、`by @user in …`）在拼装发布说明时被转成中文，`### ` 那一层的分类标题则由 `.github/release.yml` 直接配成中文——配置能解决的就不靠后处理去猜，猜错是静默的。`.github/workflows/ci.yml` 增加 `release-notes-test` 任务，用夹具逐字比对转换结果，并验证幂等与空输入降级；转换逻辑若只写在 `release.yml` 的 `run:` 里，唯一的验证方式就只剩「发一次版，用人眼看」。

### Changed

- `./scripts/lint.sh` 现在**拒绝任何参数**，不再默默忽略。它不接受任何选项，所以在此之前 `./scripts/lint.sh --help`（或任何打错的旗标）会一声不吭地把整套检查跑完，看起来像参数被接受了。它仍然没有 `--help`：一页只写着「跑所有检查」的说明是凑数，而拒绝一个参数是实话。
- macOS 构建包装脚本（`build-arm64-macos.sh`、`build-intel-macos.sh`）现在**拒绝架构参数**，不再丢弃它。`build-arm64-macos.sh x86_64` 以前会构建出 aarch64 产物，而调用者以为生效的是 Intel。它们的 `--help` 转发给 `build-macos.sh` 并附一行说明自己的预设，帮助文本因此只有一个来源，不会漂移。
- `./scripts/gui-test.sh --help` 打印一段 19 行的用法摘要，不再把整整 42 行头部注释连同 `#` 前缀一起倒出来。提取方式不再依赖行号——那正是早先那一版不再显示用法段的原因。
- **`CHANGELOG.md` 的条目改用中文书写。** 发布说明会把 CHANGELOG 中该版本的段落**原样**拼进去，所以 CHANGELOG 的正文就是发布说明的正文——写英文等于发一版英文说明。规则与边界（历史条目不回改）见 `.trellis/spec/guides/release-notes.md`，`AGENTS.md` 与 `docs/MAINTAINER_GUIDE.md` 只做引用。

## [0.3.0] - 2026-10-01

本轮主题：工程化与体验升级——接入 Trellis 工程框架、建立三层测试网、界面按「仪器面板」重做、新增 Token 计数面板。

### Added

- A **Trellis engineering framework** integration ([mindfold-ai/Trellis](https://github.com/mindfold-ai/Trellis)) under `.trellis/`, so specs are split by layer instead of living in one monolith, planning is written to files instead of scrolling out of a conversation, and work state carries across sessions via a SessionStart hook. Trellis is AGPL-3.0 and this project is MIT: `NOTICE` states per-path which files come from its templates, records that **no Trellis code is compiled into any released artifact**, and gives the removal path. The hooks it installs (which run on every session) are reviewed and documented in `SECURITY.md` — they make no network requests. Trellis's own generic thinking guides were removed from `.trellis/spec/` because their examples are about Trellis's codebase, not this one.
- `scripts/lint.sh` now also checks **Python syntax in the auto-executed hooks** and the validity of `.claude/settings.json`. A syntax error in either fails silently — the hook prints one line to stderr and the session simply loses its injected context, while the developer believes the rules still apply.

- A **real-app GUI smoke test** (`./scripts/gui-test.sh`). It launches the packaged `.app` — not a simulation — and verifies the whole chain actually runs by asserting that the app **scans the session files and writes its metadata cache**, which requires webview → React → bridge → Rust → filesystem → parse → write to all have worked. It runs against an isolated `HOME`, so a test run never touches the real `~/.claude` session data. Window screenshots additionally need macOS's Screen Recording permission, which only the user can grant; without it the script reports the screenshot as *skipped* with instructions rather than passing quietly.
- An **end-to-end test suite** (Playwright) that drives the real production bundle in a real browser. It stubs the Tauri bridge at the boundary the app actually calls — `window.__TAURI_INTERNALS__` — so no application code is test-aware and no stub ships in a release. It found the group-toggle click bug above on its first run. It runs in CI as the `web-e2e` job, which uploads screenshots, video and traces when it fails.
- A **token panel** on the session page, opened from a chip beside 总耗时 in the session header. It reports the four counters Claude Code writes to every transcript — `input_tokens`, `cache_creation_input_tokens` (split into its 5-minute and 1-hour TTL tiers), `cache_read_input_tokens` and `output_tokens` — as four rows that are **never summed into one figure**, each labelled with the log field it was read from and its share of the session total. A single total would say nothing: across real sessions cache reads run an order of magnitude above input tokens, so one merged "input" number hides which of the two a session actually spent. The panel states **no cost** — this app ships no price table, and the routed third-party models these sessions run on have no authoritative offline price — and says so ("成本未知 · 未收录该模型定价") rather than printing a figure it cannot stand behind.

### Changed

- **The interface was rebuilt around a single design intent**, chosen after the previous layout was written off as "functional but without a point of view". The direction is an *instrument panel*: colour appears only on data, the chrome is monochrome, and there is exactly one accent used for focus rings, links and selection — under 3% of pixels. Category colours (the existing Okabe-Ito, colour-blind-safe palette) are now the loudest thing on screen because nothing decorative competes with them. Depth comes from background steps and hairline borders rather than shadows, which is also why the two themes finally share one visual vocabulary instead of two.
- The shell is now a **fixed-height app frame** (`100dvh` + internal scrolling) instead of a page that grew with its content. That removed `web/src/lib/useViewportCap.ts` entirely — a hook that measured the viewport in JavaScript to cap a pane's height, a workaround for the layout being content-driven. The log table now scrolls inside its own pane, which is also what the new end-to-end assertion checks.
- The empty state is a centred brand mark, headline and a concrete next step ("pick a session on the left, or filter by ID/directory in the search box") instead of a large dashed rectangle that mostly announced its own emptiness.
- The top bar gained a brand mark and wordmark, a segmented control for the workspace switch, and icon buttons for settings and theme; session and group headers gained contrast and a sticky group header so the grouping survives long scrolls.
- New shared tokens for motion (`--dur-*`, `--ease-*`) replace the single `--transition`, so timing is a decision rather than a default; `--on-accent` was removed as it had no consumers.

### Fixed

- `./scripts/build-macos.sh` printed a bash error instead of its usage message when given an unsupported architecture. The message was written as `"$ARCH（请用…）"` — a variable expansion immediately followed by a full-width character. macOS's own bash 3.2 swallows the first byte of that character into the variable name, so `set -u` aborts with `ARCH?: unbound variable` and the intended guidance never prints (the exit code was 1 instead of the designed 2). bash 4+ and CI's bash 5 parse it fine, so this only ever surfaced locally. Both instances in the tree are fixed with braces (`"${ARCH}（…）"`), and `scripts/lint.sh` now rejects the pattern so it cannot return silently.
- The log table's token column was headed **输入 / 输出 tok** while its first number was `input_tokens + cache_creation + cache_read`. On a cached session that sum is mostly cache reads, so the column showed the largest number in the session under the name of one of the smallest counters in it — and the record detail panel, reading the same value, printed a different "输入" for the same record. The column now reads **提示词(含缓存) / 输出 tok**, with a hover breakdown naming the three counters it adds up; the field behind it was renamed from `input` to `prompt` so the next consumer cannot re-apply the old label. The exported report table carries the same corrected heading.
- Clicking the first session of a group collapsed the group instead of selecting that session. `SessionList.module.css` carried an unscoped `.groups button` rule that also matched the group collapse toggle; being more specific than `.groupToggle`, it silently overrode the toggle's `display: flex`. The toggle then laid out as a vertical grid, overran its fixed 38px row by 40px, and its count badge came to rest on top of the first session — where it absorbed the click. Found by the new end-to-end suite, which could not click the session for the same reason a user could not. The session-button rules are now scoped to the session rows, so adding another button under `.groups` cannot bring this back.

## [0.2.2] - 2026-09-30

本轮主题：修正发布产物的文件名——本地产物、文档与用户下载到的三处名字此前互不一致。

### Fixed

- Release artifact names now use hyphens (`CC-Analyzer_<version>_<arch>.dmg`, `CC-Analyzer_<version>_x64-setup.exe`) instead of the product name's spaces. Tauri names files after `productName` ("CC Analyzer"), and **GitHub replaces spaces with dots when publishing a release** — so the local build, the documentation, and the file users actually downloaded were three different names. The packaging scripts and the release workflow now normalise to hyphens.
- Fixed the release pipeline failing on Windows for two separate reasons, both of which only surface there: the build steps used bash syntax while the Windows runner defaults to PowerShell, and `build-windows.ps1` carried non-ASCII comments without a UTF-8 BOM, which PowerShell 5.1 mis-decodes into `Missing closing '}' in statement block`. `scripts/lint.sh` now rejects a non-ASCII `.ps1` that lacks a BOM, so the second one cannot come back silently.

## [0.2.1] - 2026-09-30

本轮主题：打包与项目身份统一——三平台改走 Tauri 官方打包流程，Windows 增加 NSIS 安装程序，版权署名与维护者名单规范化。

### Added

- Windows releases now include an **NSIS installer** (`CC-Analyzer_<version>_x64-setup.exe`) next to the portable zip. It installs into the user profile with a Start menu entry and an uninstaller, and needs no administrator rights.
- The project-root `package.json` supplies the build toolchain (`@tauri-apps/cli`, pinned by `package-lock.json`) with `npm run build:macos*` / `build:windows` entries, so packaging no longer relies on a globally installed CLI.

### Changed

- All three platforms now build through Tauri's official bundler (`tauri build`), which makes `identifier`, `copyright`, `publisher` and installer shape a single source of truth in `src-tauri/tauri.conf.json`. Two things follow for users: the macOS dmg now carries an `Applications` shortcut, and the copyright field is populated in the bundles themselves (`NSHumanReadableCopyright` on macOS, the installer's version info on Windows).
- Copyright now reads **Copyright 2026 CC Analyzer** rather than individual names — in `LICENSE`, `NOTICE`, and the packaged bundles. Maintaining a project-name copyright keeps the attribution stable as maintainers change; the people responsible are listed separately in `MAINTAINERS.md`, `src-tauri/Cargo.toml`, `web/package.json` and `.github/CODEOWNERS`.
- The macOS bundle identifier changed from `com.flydiy.cc-analyzer` to `io.github.liang-zhenxiang.cc-analyzer` — derived from the project's GitHub identity instead of a domain the project does not own. App data (metadata cache, thresholds, theme) lives under the new identifier's application-support directory; an existing 0.2.0 install keeps its data under the old directory, so the new build recreates titles and settings on first launch.

### Removed

- The `packaging/` directory is gone. It held a hand-written `Info.plist` and a copy of the app icon, both only needed by the old hand-rolled bundler. Tauri now generates the plist from `tauri.conf.json` (verified key-for-key, plus `NSHumanReadableCopyright`) and reads the icon from `src-tauri/icons/`, whose `icon.icns` was byte-identical to the copy. This also drops the version file that had to be kept in sync by hand: releases now bump three places instead of four.

## [0.2.0] - 2026-09-30

本轮主题：开源规范基建——CI 门禁、治理文件、自动化工作流、发布流水线与文档体系全部落地，并包含此前积累的全部功能改动；发布前把前端工具链升到当前主版本，清空依赖审计告警。

### Added

- Open-source infrastructure: a four-layer CI (static checks, build & test, commit conventions, workflow security scanning) with a single `CI 总览` summary check, plus automated workflows for PR labeling, first-contributor welcome, stale cleanup, OSSF Scorecard scoring, and tag-triggered releases that build and attach macOS (ARM64/Intel) and Windows artifacts with three-part release notes.
- Project governance and documentation: YAML-form issue templates, CODEOWNERS, SUPPORT.md, a threat model in SECURITY.md, and the docs set (USAGE, ARCHITECTURE, TROUBLESHOOTING, MAINTAINER_GUIDE) alongside a restructured bilingual README.
- `./scripts/lint.sh` as the single local entry point for every static check CI runs, and `./scripts/check-commit-msg.sh` for Conventional Commits validation (also enforced in CI for PR commits and titles).
- Rebuilt the frontend as a maintainable React, TypeScript, and Vite project under `web/`.
- Added Vitest and React Testing Library coverage for JSONL parsing, duration aggregation, filtering, reports, and UI workflows.
- Added Apple Silicon macOS and Windows portable packaging support.
- Added session metadata extraction and an isolated v2 metadata cache for the React UI.
- Added recursive Agent and Workflow session graph resolution with graph-backed durations and record details.
- Added a duration tree view with a persisted log/tree switch, per-node drill-in, and node-scoped report generation.
- Added a merged log view with token/error columns, structured-result panels, and two-way locating between the log and tree views.
- Added structured report prompts (overview, buckets, slow tools, errors, subagents, workflows, parallelism, file map, evidence) with truncation budgets, node-scoped analysis, and cancellable runs backed by a new `cancel_lines` command.
- Reports now render as Markdown via `react-markdown` + `remark-gfm` (tables, code fences, lists), with raw HTML left inert and links opened as `target="_blank" rel="noreferrer"`.
- The session list shows title-completion progress, remembers the timeline/project choice, and collapses project groups.
- The realtime monitor page retries the local dashboard three times, keeps the iframe theme in sync via `postMessage`, and enters float mode when the dashboard asks for it.
- Float mode can be left again: the `float` plugin gained an `exit` command (`plugin:float|exit`, backed by the new `float:allow-exit` permission) and the top bar shows an 退出浮窗 button while the window is floating.
- Large sessions stay responsive: the log table windows past 120 rows, parsed child sessions are cached by mtime/size, parsing yields to the event loop every 2000 lines, and the report detail table is capped at 400 rows.

### Changed

- The project ships as **CC Analyzer** (`cc-analyzer`): the Tauri product name and bundle identifier (`com.flydiy.cc-analyzer`), the Rust crate/lib (`cc-analyzer` / `cc_analyzer`), the npm package names (`cc-analyzer`, `cc-analyzer-web`), the packaging artifact names, the top-bar title, and the frontend `localStorage` keys (`cca-*`) all use it.
- The macOS bundle identifier is `com.flydiy.cc-analyzer`; app data (metadata cache, thresholds, theme) is stored under that identifier's application-support directory.
- Enhanced JSONL parsing to preserve system turn durations, sidechains, assistant block aggregation, structured tool results, skipped events, and parser warnings.
- Corrected duration breakdown to union local tool intervals, account for inter-turn gaps, prefer child-session and workflow time ranges, and clip intervals to the selected window.
- Changed Tauri production assets to `web/dist/`.
- Packaging scripts now build the web frontend before compiling Rust.
- Added a `cancel_lines` Tauri command that kills a running `run_lines` child process when the user stops a report.
- Expanded contributor workflow and Pull Request guidance.
- Session titles are now scanned incrementally from JSONL heads and stored in `meta-cache-v2.json`.
- Subagent discovery now uses the session's own directory (`<project>/<sessionId>/subagents`), matching Claude Code's real layout; the parent directory is still scanned as a fallback.
- Log rows now follow one row model: inter-turn waits become `等用户` gap rows, a model response that started exactly one tool folds into an `LLM+工具` row, and model rows show the gap since the previous activity.
- The log view gained 占比 and waterfall columns (scaled to the selected time range), duration colouring by magnitude, and single-line rows with ellipsis.
- Log filtering now works on rows: row kinds (用户/LLM/工具/Agent/workflow/等用户), 成功/失败 status, 高于/低于/区间 duration comparison, and free-text search over command, path and summary.
- Added a session header (标题 · 总耗时 · 项目 · 相对时间 · 打开位置), relative time / size / project metadata in the session list, and 今天/昨天/本周/本月/更早 date grouping with collapsible sections.
- Report prompts now follow a fixed skeleton (角色 / 口径 / 输出格式 / 质量硬约束 / 待分析数据), add a 筛选后分布 table and a three-part 文件地图 (主文件, 子 agent 文件, 深挖线索), cap the record table at the slowest 300 rows, and the report panel shows that cap plus an 打开 claude 终端继续追问 action.
- The tree view gained a 仅分析所选时间块 toggle, a node detail panel, and a 用 claude 分析此子agent action that analyses the child session itself.
- Float mode now relaxes the window's minimum size while floating and restores it on exit, so the 420×620 float window is not clamped by the normal 960×640 minimum on platforms that enforce it for programmatic resizes.
- The monitor page only accepts `enter-float` messages from the loopback dashboard origin on the probed port, so a foreign origin can no longer switch the window into float mode.
- Report generation now hard-probes the `claude` CLI first: when the process cannot be started (typically a narrowed GUI PATH), the error names the install locations that exist on disk and how to fix the PATH instead of failing midway through a run.
- The hard-coded report/parse/log budgets (prompt size, detail rows, slow tools, subagents, parse chunk, log window) are now a persisted setting, editable from the new 设置 panel in the top bar.
- Report code fences are syntax highlighted via `rehype-highlight` (raw HTML stays inert), using app-palette token colours that follow the light/dark theme.
- The session list renders only the visible rows of a long list (group headers and session rows are height-aware), and the sidebar is capped to the viewport so the list scrolls inside it instead of stretching the page.
- The record table used by the detail panel (including the embedded child-session and workflow-agent previews) windows its rows too, measuring real row heights and falling back to the running average for rows that have not been rendered yet.
- Session groups are now ordered explicitly (newest session first, groups ordered by their newest member) and collapsed-group keys of projects or date buckets that no longer exist are pruned from storage.
- Child-session paths taken from a session file are now scoped to the session tree before the app reads them, so a crafted JSONL cannot make it read arbitrary files.
- Session list rows keep every line on one line with an ellipsis and gained more padding, so long project slugs no longer wrap into the clipped part of the fixed-height row.
- Fixed the report panel's generate button rendering as an empty white box: a header rule forced its background to the elevated colour while the primary variant kept white text.
- The analyzer workspace sizes its rows from the blocks it renders (each pane carries its own minimum) instead of a fixed grid template, and both the log table and the tree are capped to the viewport so they scroll internally rather than stretching the page.
- Transcript payloads are serialised with a helper that survives bigints, repeated references and unserialisable values, so a hostile `record.raw` can no longer blank a panel; non-finite `durationMs` values no longer swallow a whole window.
- The log table windows on measured row heights instead of a 31px guess (real rows measure 39px, so the scrollbar and scroll offsets were off by thousands of pixels), counts an expanded panel's real height, and caps itself to the viewport so the windowed rows can actually be scrolled to.
- Frontend toolchain upgraded: Vite 8, Vitest 5, `@vitejs/plugin-react` 6, and jsdom 30. `web/vite.config.ts` now takes `defineConfig` from `vitest/config`, uses the function form of `manualChunks` (the object shorthand was removed with the Rollup upgrade), and one virtual-list assertion no longer depends on the whitespace behaviour the older jsdom inserted between inline elements.
- TypeScript moved from 5.9 to 7.0 in `web/`; `tsc -b` and the Vite build pass unchanged.

### Security

- `npm audit` is back to zero known vulnerabilities. The advisories covering the Vite dev server and the Vitest UI (1 critical, 1 high, 3 moderate) are only patched in Vite 8 / Vitest 5, so the frontend toolchain had to move majors to clear them.

### Notes

- Desktop development still starts with `cargo run --manifest-path src-tauri/Cargo.toml`.
- Frontend changes must be built into `web/dist/` before launching the packaged/debug desktop app unless using a separately configured dev server.
- Report generation uses the local `claude` CLI.
- The realtime monitor tab depends on an external dashboard at `localhost:8090`; that service is not included in this repository.
- The React UI reads only `meta-cache-v2.json`; it does not migrate or overwrite the earlier `meta-cache.json`. The first launch rescans missing titles, then reuses entries with matching file size and modification time.

## [0.1.4] - 2026-09-20

### Added

- Intel macOS x86_64 application bundle and DMG packaging.
- Tauri 2 backend with the Rust command layer the web UI calls.
- Local packaging script for reproducing the macOS bundle.
