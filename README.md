# CC Analyzer

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/liang-zhenxiang/cc-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/liang-zhenxiang/cc-analyzer/actions/workflows/ci.yml)
[![Release](https://github.com/liang-zhenxiang/cc-analyzer/actions/workflows/release.yml/badge.svg)](https://github.com/liang-zhenxiang/cc-analyzer/releases)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/liang-zhenxiang/cc-analyzer/badge)](https://scorecard.dev/viewer/?uri=github.com/liang-zhenxiang/cc-analyzer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A desktop application for reviewing AI coding session activity — turn your
Claude Code session logs into timelines, duration trees, and structured
analysis reports. Built with Tauri 2 and a React web UI.

## Features

- **Session explorer** — sessions grouped by timeline (today / this week /
  this month) and by project, with incrementally scanned titles and relative
  times.
- **Log view with one row model** — user / LLM / tool / agent / workflow /
  wait rows, with duration, share and waterfall columns; filter by row kind,
  success/failure, duration range, or free text.
- **Duration tree** — agent and workflow sub-sessions resolved into a graph
  with graph-backed durations; drill into any node or analyse a selected
  time block only.
- **AI analysis reports** — structured prompts sent to your local `claude`
  CLI, rendered as Markdown with syntax highlighting; cancellable at any
  time, with per-node and per-time-block scoping.
- **Realtime monitor** — embeds a local cc-monitor dashboard, with a
  floating-window mode.
- **Performance at scale** — windowed, measured-height rendering and chunked
  parsing keep large sessions (tens of MB of JSONL) responsive.
- **Local-first & private** — everything is parsed and rendered locally; the
  app ships no telemetry.

## Quick start

### Download

Grab the build for your platform from
[Releases](https://github.com/liang-zhenxiang/cc-analyzer/releases):

| Platform | Artifact |
| --- | --- |
| macOS Apple Silicon | `CC_Analyzer_arm64.dmg` |
| macOS Intel | `CC_Analyzer_x64.dmg` |
| Windows x64 | `CC_Analyzer_x64.zip` |

macOS bundles are ad-hoc signed: on first launch, right-click the app and
choose **Open** to pass Gatekeeper.

### Build from source

Requirements: Node.js 22 & npm, Rust 1.77+, Xcode Command Line Tools
(macOS) or Visual Studio Build Tools (Windows).

```bash
# macOS Apple Silicon
./scripts/build-arm64-macos.sh     # → dist-arm64/CC Analyzer.app, CC_Analyzer_arm64.dmg

# macOS Intel (cross-compiled)
./scripts/build-intel-macos.sh     # → dist-intel/CC Analyzer.app, CC_Analyzer_x64.dmg

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
# → dist-windows/CC_Analyzer_x64.zip
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/USAGE.md](docs/USAGE.md) | Full user guide: install, every feature, data & privacy |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works, design decisions and rejected alternatives |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Symptoms → causes → fixes, searchable error texts |
| [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) | Local desktop development workflow |
| [docs/CI.md](docs/CI.md) | CI build order and the `frontendDist` pitfall |
| [docs/MAINTAINER_GUIDE.md](docs/MAINTAINER_GUIDE.md) | Release process, repository configuration checklist |
| [CHANGELOG.md](CHANGELOG.md) | Notable changes per version |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute ([中文](CONTRIBUTING.zh-CN.md)) |
| [SECURITY.md](SECURITY.md) | How to report vulnerabilities, the project's threat model |

## Development

```bash
cd web && npm install && npm run dev   # Vite dev server on 127.0.0.1:5173
cargo run --manifest-path src-tauri/Cargo.toml
```

Pre-push checks (same as CI):

```bash
./scripts/lint.sh                      # static checks: actionlint, yamllint, shellcheck, zizmor
npm --prefix web test
npm --prefix web run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml
```

## Repository layout

```
web/           React, TypeScript and Vite source for the UI
src-tauri/     Tauri 2 backend: Rust command layer, app config, capabilities
packaging/     macOS bundle metadata and icon
scripts/       packaging helpers, lint entry point, commit-msg validator
docs/          usage, architecture, troubleshooting, maintainer guides
.github/       workflows, issue/PR templates, governance configs
```

## Roadmap

- [ ] Session comparison across time (weekly/monthly trends)
- [ ] Report templates and export formats
- [ ] Additional platform support

Have an idea? [Open a feature request](https://github.com/liang-zhenxiang/cc-analyzer/issues/new/choose).

## Contributing

Contributions are welcome — bug reports, documentation improvements and pull
requests alike. Start with [CONTRIBUTING.md](CONTRIBUTING.md), run the local
checks, and keep one change per PR.

## Security

Session data is sensitive. The app parses it locally and ships no telemetry;
see [SECURITY.md](SECURITY.md) for the threat model and how to report
vulnerabilities privately.

## License

[MIT](LICENSE). Third-party notices: [NOTICE](NOTICE).
