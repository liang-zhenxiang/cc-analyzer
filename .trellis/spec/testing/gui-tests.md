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
5. **The app renders its own window to a PDF** within 15 seconds of launch.
6. **That PDF converts to a PNG** (`sips -s format png`).
7. **The PNG is not blank** — at least 20 distinct colours among a sampled grid.
   This is the check that makes the screenshot trustworthy; see the trap below.
8. **SIGTERM is followed by exit within 5 seconds.**

Checks 5–7 are what turn "the app is running" into "the app is *displaying the right
thing*". They need no privacy permission, because they never read the screen.

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

## Screenshots: captured from inside the app, no permission needed

The app renders **its own webview** to a PDF, and the script converts that to PNG.

On macOS, capturing screen content normally needs the **Screen Recording** TCC
permission, which only the user can grant. That gate is real and unavoidable for
anything that reads the screen — measured, not assumed (see below). So this does
not go through the screen at all: `WKWebView.createPDF` asks **WebKit to render
the page it is already displaying**. It never touches the window server, so no
permission is involved.

In `src-tauri/src/lib.rs` the `gui_capture` module reads `CCA_GUI_CAPTURE`; when it
holds a path, the app waits for the webview to settle, renders itself there, and
keeps running so the rest of the assertions still apply to the same launch.
`gui-test.sh` builds with `--features gui-capture` and passes the path.

### The blank-image trap (why the assertion checks pixels, not files)

The reason this section is emphatic: **macOS hands you a correctly sized, entirely
empty image instead of an error when you lack the permission.** A check like
`if file exists` or `if image != nil` passes and you ship a transparent PNG.

Measured on macOS 26 with a probe that creates an `NSWindow` in a real `NSApp.run()`
loop, draws a label, waits for compositing, then captures its own window:

| Attempt | Result |
| --- | --- |
| `screencapture -x` (any variant) | `could not create image from display` |
| `CGWindowListCreateImage` on own window, reached via `dlsym` | right-sized image, **every pixel `rgba(0,0,0,0)`** |

So "a process may capture its own window" — the obvious workaround — does **not**
work, and it fails *silently*. Hence the script decodes the PNG and asserts on
**distinct colours** (a blank capture has one; a real screen has hundreds).

Variance was tried first and rejected: a perfectly normal light UI scored 167, so
the threshold would have to sit dangerously close to real values. Colour count
separates cleanly.

### What CI does *not* cover

The `gui-capture` module is compiled only on macOS **and** only with the feature on,
so CI's Linux Rust jobs never see it — a mistake there surfaces only when someone
runs `./scripts/gui-test.sh` locally. Checking it in CI would mean a macOS runner for
one 60-line test-only module, which is not worth the cost.

The consequence is a rule: **if you touch `gui_capture`, run the script before
committing.** Nothing else will tell you it broke.

### Regenerating

Screenshots land in `gui-artifacts/app-window.png` (gitignored). They are the real
window at its actual size. For per-view coverage in both themes, use the Playwright
suite (`SCREENSHOTS=1 npm --prefix web run test:e2e -- --grep "截图归档"`), which
also runs on WebKit — the engine family the macOS app renders in.

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
