# Backend Quality Guidelines

> Code standards and the CI gates that enforce them. Everything here maps to a
> command that runs on every PR.

---

## The Baseline: Zero Warnings

`.github/workflows/ci.yml` runs four Rust jobs; all of them must pass before a
PR can merge (AGENTS.md §3 — the "CI 总览" check aggregates them):

```bash
cargo fmt    --manifest-path src-tauri/Cargo.toml --check                        # ci.yml job: rust-fmt
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings   # ci.yml job: rust-clippy
cargo check  --manifest-path src-tauri/Cargo.toml                                # ci.yml job: rust-check
cargo test   --manifest-path src-tauri/Cargo.toml                                # ci.yml job: rust-test
```

(The jobs are named rather than pinned to line numbers on purpose — the numbers
in this doc had already drifted out of date once, and every edit to `ci.yml`
moves them again. Search for the job name.)

`--all-targets` is not decoration: without it clippy compiles only the default
targets and silently skips every `#[cfg(test)]` module, so a lint in test code
passes CI and only surfaces the next time someone runs clippy locally. Keep the
flag on both sides — the commands here, in `AGENTS.md` §Testing Guidelines, in
`CONTRIBUTING.md`, and in CI must stay identical.

`-D warnings` is the important one: **clippy warnings are build failures.**
The project baseline is 0 findings (AGENTS.md §项目红线). Do not "fix" a new
warning by adding an `#[allow]` without reading the next section.

Run the same commands locally before pushing, plus:

```bash
./scripts/lint.sh   # actionlint / yamllint / shellcheck / bash -n / zizmor
```

Note `lint.sh` covers workflow and shell files only — it explicitly does **not**
run the Rust or frontend checks (`scripts/lint.sh` header comment), so run both.

---

## `#[allow]` Policy

There is exactly one `#[allow]` in the crate:

```rust
// Tauri command 的参数即前端 invoke 的调用签名；收拢成参数对象需要同步改动
// 前端 API，不属于内部可自由重构的范围，故豁免参数数量检查。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn run_lines(...)
```

The pattern: **an `#[allow]` must carry a comment stating why the lint cannot be
satisfied.** The reason here is real — the parameter list is a public contract
with `web/src/api/types.ts`, not a signature free to collapse into an options
struct.

- Prefer fixing the code. `cargo clippy --fix` then re-read the diff.
- Never add `#![allow(...)]` at the crate level.
- Never add an `#[allow]` to silence a lint you have not read the explanation for.

---

## Language and Formatting

- Edition 2021, `rust-version = "1.77"` (`src-tauri/Cargo.toml`). Don't reach
  for std APIs newer than the MSRV without bumping it in the same PR.
- `cargo fmt` decides layout; never hand-format. One exception in spirit: the
  `#[cfg(windows)]` / `#[cfg(not(windows))]` blocks in `child_command` are laid
  out for readability of the two platform branches.
- Naming follows Rust convention: `snake_case` functions/variables/modules,
  `PascalCase` types (`ProcState`, `DirEntry`, `RunLinesResult`),
  `SCREAMING_SNAKE_CASE` constants (`MAIN_WINDOW`, `FLOAT_WIDTH`,
  `CREATE_NO_WINDOW`).
- Comments explaining a non-obvious decision are in **Chinese** and state *why*,
  not *what* — see the doc comment on `ProcState` ("Tracks in-flight `run_lines`
  calls so the UI can cancel them"), `RestoreState`, and the `cmd.exe` shim.

---

## `unsafe` and Dependencies

- `unsafe` appears in exactly one place: `mod gui_capture` in `lib.rs`, where
  `WKWebView` is reached through the raw pointer `with_webview` hands back, and
  `NSData` / `NSError` come through `RcBlock` callbacks. That module is gated
  `#[cfg(all(target_os = "macos", feature = "gui-capture"))]`, so **release
  builds do not contain it** (the feature exists only for the real-device GUI
  test, see [../testing/gui-tests.md](../testing/gui-tests.md)). Everything
  else in `src-tauri/src/` is safe Rust — `grep -rn unsafe src-tauri/src/`
  outside that module returns nothing. Keep it that way; if another platform
  API needs it, isolate it behind a feature, keep the block as small as the
  calls allow, and justify it in the PR.
- The dependency list is intentionally short: `tauri`, `tauri-plugin-dialog`,
  `serde`, `serde_json`, `tokio` (`process`, `io-util`, `time`, `macros`, `rt`),
  plus `tauri-build`. Adding a crate needs a stated reason in the PR — "it saves
  a few lines" is not one, and keep `tokio` feature flags minimal.

---

## Tests

- `src-tauri/src/lib.rs` holds **15 Rust unit tests** today. They cover the pure
  helpers the command layer is built from, plus the two cross-file contracts that
  would otherwise drift silently; the commands themselves are exercised from the
  frontend (`web/src/**/*.test.ts`, Vitest) against the bridge interfaces — which
  is why `web/src/api/bridges.ts` exists as a seam.

  What the Rust tests pin down:

  | Module | Covers |
  |--------|--------|
  | `tests` | `io_error` — error copy shown to users, must not leak paths (2) |
  | `tests` | `string_from_head` — byte-truncation never yields half a character (4) |
  | `tests` | `home_dir_from` — `USERPROFILE` / `HOME` precedence and empty-value handling (6) |
  | `tests` | `generate_handler!` in `lib.rs` vs. `app_manifest` in `build.rs` — the two command lists must match exactly (1) |
  | `float_plugin::tests` | window size constants and the window label mirroring `tauri.conf.json`, read at compile time via `include_str!` (2) |

  The `lib.rs` ↔ `build.rs` one is worth knowing about when you add a command:
  `build.rs` declares commands to `tauri-build` so it can autogenerate
  `permissions/autogenerated/<command>.toml`. A command registered in
  `generate_handler!` but missing from `build.rs` still builds and runs, because
  `autogenerate_command_permissions` only writes files and later globs the whole
  directory — so a stale hand-kept `.toml` under a `DO NOT EDIT` header masks the
  omission. Delete that directory once and the build breaks on a permission that
  no longer resolves, with an error that points nowhere near the cause. Add the
  command to both lists; the test above fails loudly if you don't.

- What is still **not** tested, and why — this is a deliberate gap, not an
  oversight:

  - The filesystem commands (`read_dir`, `stat`, `read_text`, `read_head`,
    `write_text`) are thin forwarders onto `std::fs`. The parts that carry real
    logic are extracted as pure helpers (`io_error`, `string_from_head`) and
    tested directly; the `#[tauri::command]` wrappers themselves add only
    argument marshalling.
  - `run_lines` is a timeout/cancel state machine over `ProcState`. Exercising it
    needs a `tauri::AppHandle` to emit events to and real child processes, so it
    cannot be a unit test — the cases that matter (timeout, cancel, partial
    output) are covered end to end from the frontend.
  - `home_dir`, `app_data_dir` and `monitor_ping` are one-line wrappers over
    `std::env`, `AppHandle` and a TCP connect respectively. `home_dir` delegates
    to the tested `home_dir_from`; `monitor_ping` is covered by the `monitor_port`
    constant that both share — it is deliberately **not** unit tested, because
    the only real assertion would be "this port is free", which fails on a
    developer machine where the analyzer is already running.
  - `float_plugin::enter` / `exit` need a live webview window.

- If you add a Rust test, put it in a `#[cfg(test)] mod tests` beside the code
  in `src-tauri/src/`, name it for the behavior under test, and keep it free of
  a Tauri runtime — commands that need `AppHandle` or `State` are not unit
  testable as written, so extract the pure part into a private helper first.
- Test code is linted: CI runs clippy with `--all-targets` (see above), so
  `#[cfg(test)]` modules are held to the same 0-warning baseline as the rest of
  the crate.

---

## Keeping Documentation in Sync

| If you change… | Also update |
|----------------|-------------|
| A command signature or JSONL-facing behavior | `docs/ARCHITECTURE.md` §后端, `web/src/api/types.ts` |
| Anything user-visible | `CHANGELOG.md` `[Unreleased]`, using only the fixed categories (AGENTS.md §2) |
| Capabilities / permissions | `src-tauri/capabilities/default.json` plus the PR explanation AGENTS.md requires |
| The crate version | `web/package.json` + `src-tauri/tauri.conf.json` (three places, AGENTS.md §4) |

---

## Red Lines That Touch This Layer (from AGENTS.md)

- `${{ }}` expressions never go directly into a workflow `run:` — always via `env:`.
- `uses:` entries stay pinned by commit SHA; checkouts keep `persist-credentials: false`.
- Never commit generated artifacts: `src-tauri/target/`, `src-tauri/gen/`,
  `web/dist/`, `dist-*`. The deliberate exception is
  `src-tauri/permissions/autogenerated/`, which **is** committed — see
  [directory-structure.md](./directory-structure.md).
- Release builds use no cache paths, and the app ships no telemetry.
- Session content and user paths are sensitive: don't print them in logs, error
  strings, or CI output.
