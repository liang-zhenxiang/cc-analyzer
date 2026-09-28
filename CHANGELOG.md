# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]


## [0.2.0] - 2026-09-29

本轮主题：开源规范基建——CI 门禁、治理文件、自动化工作流、发布流水线与文档体系全部落地，并包含此前积累的全部功能改动。

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
