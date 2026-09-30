# Repository Guidelines

## Project Structure & Module Organization

- `web/` contains the React, TypeScript, and Vite frontend source. Review `web/src/api/tauri.ts` for platform bridges and `web/src/features/` for feature modules.
- `web/dist/` is generated output consumed by Tauri through `frontendDist`; do not commit it.
- `src-tauri/` contains the Tauri 2 backend, Rust entry points, app configuration, capabilities, and icons. Review `src-tauri/src/lib.rs` for the main command implementations.
- `packaging/` stores macOS bundle metadata and application icons.
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

- Frontend tests use Vitest, jsdom, and React Testing Library. Place tests beside implementation files as `*.test.ts` or `*.test.tsx`, and shared JSONL fixtures under `web/tests/fixtures/`.
- Before submitting, run `./scripts/lint.sh`, `npm --prefix web test`, `npm --prefix web run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, and `cargo check --manifest-path src-tauri/Cargo.toml`.
- For parser, duration, filter, or report changes, add or update fixture-based tests.
- For packaging changes, run the Intel macOS build script and confirm that `dist-intel/CC Analyzer.app` and `dist-intel/CC Analyzer_<version>_x64.dmg` are produced (Windows builds emit both a `-setup.exe` NSIS installer and `CC_Analyzer_x64_portable.zip` under `dist-windows/`).
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
- Keep the application version synchronized between `web/package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `packaging/macos/Info.plist`.
