# Real-App GUI Smoke Test Guidelines

> Conventions for `scripts/gui-test.sh`: it launches the packaged `.app` for real and
> asserts the full IPC + filesystem chain, with an isolated `HOME`.

---

## What it is

`./scripts/gui-test.sh` starts the built macOS bundle, waits, and inspects what the app
did. It is the only suite that covers "does the Tauri shell actually carry this" — the
thing `v0.2.1` broke twice while every other layer was green
(see [`index.md`](./index.md)).

```bash
./scripts/gui-test.sh                  # use the existing bundle
./scripts/gui-test.sh --build          # build first, then run
./scripts/gui-test.sh --app <path>     # point at a specific .app
```

Without `--app` the bundle is chosen by `uname -m`: `dist-arm64/CC Analyzer.app` on
arm64, `dist-intel/CC Analyzer.app` otherwise. The executable must exist at
`${APP_PATH}/Contents/MacOS/cc-analyzer`, or the script exits 1 and prints the build
command to run. **Exit code 0 means every check passed; a skipped screenshot does not
count as a failure, a failed check does.** The script is macOS-only — `.app` layout,
`ps`, `screencapture` and the TCC permission below have no portable equivalent.

---

## Isolation is a hard requirement

```bash
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cca-gui-test.XXXXXX")"
HOME="$HOME_DIR" "$BIN" >"$APP_LOG" 2>&1 &
```

- `HOME` is redirected to a fresh temp directory, and the two fixtures are copied into
  `${HOME_DIR}/.claude/projects/-repo-demo/`. The app therefore sees only that.
- The bundle's executable is invoked **directly**, not via `open -a`. `open` goes
  through LaunchServices and does not inherit the shell environment, so the custom
  `HOME` would be silently dropped and the app would read the developer's real
  `~/.claude` ([`pitfalls.md`](./pitfalls.md) #8).

This is not tidiness. Session transcripts are sensitive, and "会话数据不出本机" is a
project red line (`AGENTS.md`) — a leaked `HOME` means the test reads a real person's
sessions. One of the assertions exists purely to catch that regression.

`cleanup()` runs on `EXIT`: `disown` the background job, then `kill` (SIGTERM, then
SIGKILL), then `rm -rf "$WORK_DIR"`. `disown` first is required — otherwise bash
announces the terminated job on stderr and the noise reads like a failure
([`pitfalls.md`](./pitfalls.md) #10).

---

## What it asserts

1. **The process is still alive after 10 seconds** (`kill -0` polled once a second).
   Catches a crash on launch; on failure it prints the first 20 lines of the app log.
2. **Resident memory exceeds 20 MB** (`RSS_KB > 20480`). An empty shell process is a
   few MB; WKWebView plus React is tens to hundreds. The threshold is loose enough not
   to false-positive and tight enough to exclude "the webview never loaded".
3. **`meta-cache-v2.json` exists within 15 seconds.** The path is
   `${HOME_DIR}/Library/Application Support/${BUNDLE_ID}/meta-cache-v2.json`
   (`BUNDLE_ID = io.github.liang-zhenxiang.cc-analyzer`; the filename comes from
   `CACHE_NAME` in `web/src/features/sessions/sessionRepository.ts`).
4. **The cache holds exactly 2 entries** — matching the 2 fixtures copied in — and
   **every entry path starts with the isolated `HOME`** (`OUTSIDE 0`).
5. **SIGTERM is followed by exit within 5 seconds.**

Check 3 is the strongest evidence in the whole suite, and it needs **no privacy
permission**. That file can only exist if the entire chain ran: webview loaded → React
mounted → `useSessions`/`SessionRepository` called a bridge → the Rust command executed
→ the filesystem walk found `~/.claude/projects/**` → each JSONL was parsed → the
metadata cache was written back to disk. Any break anywhere in that chain yields no
file, and the script reports `会话发现链路没走通`. Check 4 is what makes it a *product*
assertion rather than a smoke test: the cache is keyed by session path
(`cache.entries[session.path] = entry`), so counting entries verifies discovery found
the right sessions, and the `OUTSIDE` check verifies isolation actually held rather
than assuming it.

The JSON is parsed by a `python3` heredoc that prints `COUNT` / `OUTSIDE` /
`PARSE_FAIL` lines, which the shell then greps. `python3` is used instead of `jq` to
avoid adding a dependency to the test.

---

## Screenshots are best-effort, and a skip is not a pass

`screencapture -x -o gui-artifacts/app-window.png` is attempted at the end. On macOS,
capturing screen content requires the **Screen Recording** TCC permission, which only
the user can grant (System Settings → Privacy & Security → Screen Recording) — a
script cannot request it. That is a security boundary, not a bug to route around
([`pitfalls.md`](./pitfalls.md) #7).

When it fails the script prints `⚠ 跳过`, the reason, and how to enable it; it
increments `SKIPPED`, does **not** increment `PASSED`, and lists every skipped check by
name in the summary so it cannot be read as a pass. Visual verification is the
Playwright suite's job — Chromium screenshots need no system permission and can run in
CI.

---

## When to run it, and how to extend it

Run it whenever the change could plausibly break the shell: packaging scripts,
`src-tauri/tauri.conf.json`, capabilities, Tauri commands, the metadata-cache path, or
before cutting a release. Add `--build` if the bundle may be stale. On Windows or
Linux there is nothing to run here — platform coverage comes from the real builds in
`release.yml`.

To add a check:

- Use the `step` / `ok` / `bad` / `skip` helpers. They own the counters and the failure
  name list that drives the exit code; printing directly bypasses both.
- Prefer evidence that needs **no privacy permission**: a file or state the app could
  only produce by completing a chain. That is why check 3 exists and why the screenshot
  is optional. "Assert on what the app wrote" beats "look at the window".
- To pin a new observable: add a fixture under `web/tests/fixtures/`, copy it into
  `$PROJECT_DIR` in the 准备隔离环境 step (and update the expected `COUNT`), then assert
  on whatever the app writes. The `python3 - "$CACHE_PATH" "$HOME_DIR" <<'PY'` heredoc
  is the template for reading JSON without new dependencies.
- Remember `gui-artifacts/` is gitignored — never commit the screenshot.
