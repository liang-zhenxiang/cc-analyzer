# Backend Development Guidelines

> Coding rules for the Rust side of CC Analyzer (`src-tauri/`).

---

## Overview

The backend is a **deliberately thin Tauri 2 command layer**. It owns no
database, no domain model, and no business logic that can live elsewhere:

- `src-tauri/src/lib.rs` holds every command, the inlined `float` plugin, and
  the app bootstrap in `pub fn run()`.
- `src-tauri/src/main.rs` is 5 lines: the `windows_subsystem` attribute plus a
  call to `cc_analyzer::run()`.
- The actual analysis (JSONL parsing, session graphs, duration math, filters,
  report prompts) lives in `web/src/`. See `docs/ARCHITECTURE.md` §总体形态.

Rust exists only to hand the webview what it cannot do itself: filesystem
reads/writes, spawning / streaming / cancelling child processes, window
geometry, and two fixed monitor probes.

### Where does new logic go?

| Need | Layer |
|------|-------|
| Parse, aggregate, derive, filter, format | Frontend (`web/src/`) |
| Read/write a file, list a directory, `stat` | Rust command, thin wrapper only |
| Spawn a process, stream stdout to the UI, cancel it | Rust (`run_lines` / `cancel_lines`) |
| Something needing a *new* OS capability | Rust command **plus** the 6-place IPC wiring in `command-guidelines.md` |

If a helper can be written in TypeScript without touching the OS, it belongs
in `web/src/` — do not grow a Rust utility layer. The thin layer is a design
decision, not an accident (`docs/ARCHITECTURE.md` §设计取舍).

---

## Pre-Development Checklist

Before writing Rust in this repo:

- [ ] Read `src-tauri/src/lib.rs` end to end (it is ~545 lines, one file).
- [ ] Check `src-tauri/capabilities/default.json` — is the capability you need
      already granted? A registered command that is **not** listed there is
      unreachable from JS, and this fails silently at runtime, not at build.
- [ ] If you touch paths or process spawning, read
      [security-and-permissions.md](./security-and-permissions.md) first.
- [ ] Decide whether the change is user-visible; if yes it needs a
      `CHANGELOG.md` `[Unreleased]` entry (AGENTS.md §2).
- [ ] Confirm the frontend contract in `web/src/api/tauri.ts` still matches —
      Rust and TS types are hand-synced, there is no codegen.

---

## Quality Check

Run these before pushing (identical to `.github/workflows/ci.yml`):

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml
./scripts/lint.sh        # actionlint / yamllint / shellcheck / zizmor, no Rust
```

Clippy runs with `-D warnings`: **0 warnings is the baseline**, a new warning
is a red build. Details in [quality-guidelines.md](./quality-guidelines.md).

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | What lives in `src-tauri/`, what is generated, what to commit |
| [Command Guidelines](./command-guidelines.md) | Writing a `#[tauri::command]` and the full IPC wiring checklist |
| [Security & Permissions](./security-and-permissions.md) | The ACL/capability model, path validation, process spawning rules |
| [Error Handling](./error-handling.md) | How failures cross the IPC boundary (`Result<_, String>` vs `ok: false`) |
| [Quality Guidelines](./quality-guidelines.md) | fmt/clippy baselines, `#[allow]` policy, naming, doc sync |
