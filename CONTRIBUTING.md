# Contributing

Thanks for considering a contribution.

中文指南见 [`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md)。

## Development environment

- Node.js 22 and npm
- Rust 1.77 or later
- Xcode Command Line Tools on macOS
- Visual Studio Build Tools and the MSVC Rust target for Windows builds

Install and verify:

```bash
npm --prefix web install
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Start development with:

```bash
npm --prefix web run dev
cargo run --manifest-path src-tauri/Cargo.toml
```

See [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) for details.

## Workflow

1. Create a focused branch from the latest `main`, for example `feat/session-export` or `fix/windows-terminal`.
2. Keep changes focused and explain the reason for the change.
3. Run the frontend and backend checks before opening a PR.
4. Use scoped conventional commit titles such as `feat(web): add session export`, `fix(web): normalize log path`, or `docs: update build steps`.

## Pull requests

Please include:

- what changed,
- why it is needed,
- how it was tested,
- any platform-specific considerations,
- linked issues or tasks,
- screenshots or recordings for visible UI changes,
- notes if permissions, packaging, versions, or documentation changed.

Do not commit generated output such as `web/dist/`, `node_modules/`, Rust `target/`, `dist-intel/`, `dist-arm64/`, or `dist-windows/`. Security vulnerabilities should be reported through GitHub Security Advisories rather than public issues.
