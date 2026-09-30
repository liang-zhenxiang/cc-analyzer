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
npm install                  # root build toolchain: the Tauri CLI
npm --prefix web install
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

The private `package.json` at the repo root carries build tooling only —
`@tauri-apps/cli` is a devDependency pinned by `package-lock.json`, so no global
`tauri` install (and no `cargo install tauri-cli`) is needed.

Start development with:

```bash
npm --prefix web run dev
cargo run --manifest-path src-tauri/Cargo.toml
```

See [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) for details.

## Packaging

All three platforms build through Tauri's official bundler (`tauri build`), so
`identifier`, `copyright`, publisher and installer shape come from one place:
`src-tauri/tauri.conf.json`. The scripts under `scripts/` are thin wrappers —
they install the dependencies (root `npm install` + `npm --prefix web ci`) and
then call `npx tauri build`, so you do not need to install anything beforehand.

```bash
npm run build:macos:arm64    # dist-arm64/CC Analyzer.app + CC-Analyzer_<version>_aarch64.dmg
npm run build:macos:intel    # dist-intel/CC Analyzer.app + CC-Analyzer_<version>_x64.dmg
npm run build:windows        # dist-windows/ NSIS installer + CC_Analyzer_x64_portable.zip
```

`npm run build:macos` builds for the host architecture; the equivalent
`./scripts/build-macos.sh <arch>` entry points work too. macOS bundles are
ad-hoc signed (`signingIdentity: "-"`), which needs no developer certificate.

## Local checks

Run `./scripts/lint.sh` before pushing — it runs every static check that CI
runs and can run locally (actionlint, yamllint, shellcheck, `bash -n`, zizmor).
Missing tools are skipped with an install hint; skipped items are never
counted as passing.

```bash
./scripts/lint.sh
```

Two things it deliberately does **not** cover:

- **Build & test checks** (`vitest`, `tsc`, `cargo fmt` / `clippy` / `check`) —
  run them locally as you develop:

  ```bash
  npm --prefix web test
  npm --prefix web run build
  cargo fmt --manifest-path src-tauri/Cargo.toml --check
  cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
  cargo check --manifest-path src-tauri/Cargo.toml
  ```

- **Commit messages** — CI validates the commits in a PR *and the PR title*,
  and the title does not exist before the PR does. You can pre-check a title
  with `./scripts/check-commit-msg.sh --message "feat(web): ..."`.

## Workflow

1. Create a focused branch from the latest `main`, for example
   `feat/session-export` or `fix/windows-terminal`.
2. One issue per branch per PR. Keep changes focused.
3. Run the checks above before opening a PR.
4. Open the PR with a title that follows the commit convention (after a
   squash merge the title becomes the commit message, and CI validates it).

## Commit message convention

The project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Both the commit messages in a PR and the PR title are validated by CI
(`scripts/check-commit-msg.sh`). Allowed types — keep this table in sync with
the script:

| Type | Used for |
| --- | --- |
| `feat` | New user-facing capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `ci` | Workflow / CI configuration changes |
| `chore` | Maintenance that touches neither src nor tests |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or correcting tests |
| `style` | Formatting, whitespace, no meaning change |
| `revert` | Reverting a previous commit |
| `build` | Build system or dependency changes (Cargo / npm) |

Scopes describe the area, e.g. `web`, `tauri`, `packaging`, `ci`, `docs`.

```
feat(web): add session export
fix(tauri): normalize log path before reading
docs: update build steps
```

## Pull requests

Please include:

- what changed, and **why** it is needed (the diff already says what changed),
- how it was tested — concretely, not just "tests pass",
- any platform-specific considerations,
- linked issues or tasks (`Closes #12`),
- screenshots or recordings for visible UI changes,
- notes if permissions, packaging, versions, or documentation changed.

Do not commit generated output such as `web/dist/`, `node_modules/`, Rust
`target/`, `dist-intel/`, `dist-arm64/`, or `dist-windows/`.

If a change is user-visible, add an entry to the `Unreleased` section of
[`CHANGELOG.md`](CHANGELOG.md) under the fixed categories (Added / Changed /
Deprecated / Removed / Fixed / Security).

## Reporting security issues

Please report security vulnerabilities through
[GitHub Security Advisories](https://github.com/liang-zhenxiang/cc-analyzer/security/advisories/new)
rather than public issues. See [`SECURITY.md`](SECURITY.md) for the project's
threat model.
