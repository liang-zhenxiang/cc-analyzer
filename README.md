# CC Analyzer

[English](README.md) · [简体中文](README.zh-CN.md)

CC Analyzer is a desktop application for reviewing AI coding
session activity. It is built with Tauri and a React web UI.

## Requirements

- macOS 10.13+ (Intel) or macOS 11+ (Apple Silicon)
- Rust 1.77 or later
- Xcode Command Line Tools
- For Windows builds: Windows 10 or later, Visual Studio Build Tools, and the
  MSVC Rust target

## Build

Run the packaging script for the target platform from the repository root:

```bash
./scripts/build-intel-macos.sh
```

For Apple Silicon, run:

```bash
./scripts/build-arm64-macos.sh
```

For Windows, run from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

The scripts produce:

- `dist-intel/CC Analyzer.app`
- `dist-intel/CC Analyzer_x64.dmg`
- `dist-arm64/CC Analyzer.app`
- `dist-arm64/CC Analyzer_arm64.dmg`
- `dist-windows/CC_Analyzer_x64.zip`

## Development

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for the local
desktop development workflow. See [docs/CI.md](docs/CI.md) for the required
CI build order and troubleshooting.

Develop the web UI:

```bash
cd web
npm install
npm run dev
```

Run pre-commit checks:

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Run a release build:

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml
```

## Repository layout

- `web/` - React, TypeScript, and Vite source for the UI; production output goes to `web/dist/`
- `src-tauri/` - Tauri backend and app configuration
- `packaging/` - macOS bundle metadata and icon
- `scripts/` - local packaging helpers
- `docs/` - development guides and CI notes

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for
details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) or
[CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) for branch, commit, and Pull
Request guidelines.
