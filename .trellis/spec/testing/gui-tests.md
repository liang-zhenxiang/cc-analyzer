# Real-App GUI Smoke Test Guidelines

> Conventions for `scripts/gui-test.sh`: it launches the packaged `.app` for real and
> asserts the full IPC + filesystem chain **and the layout invariants of the real
> window**, with an isolated `HOME`.

---

## What it is

`./scripts/gui-test.sh` starts the built macOS bundle, waits, and inspects what the app
did. It is the only suite that covers "does the Tauri shell actually carry this" — the
thing `v0.2.1` broke twice while every other layer was green
(see [`index.md`](./index.md)) — **and** the only one that judges the *layout* at the
real window size: a blown-up gauge or a clipped table column used to pass here too,
because "the screenshot is non-blank" says nothing about whether the layout is sane.
That gap is why the geometry probe exists (see below).

```bash
./scripts/gui-test.sh                  # use the existing bundle
./scripts/gui-test.sh --build          # build first, then run
./scripts/gui-test.sh --app <path>     # point at a specific .app
CCA_GUI_CAPTURE_TAB=用量总览 ./scripts/gui-test.sh   # override the view list
```

Without `--app` the bundle is chosen by `uname -m`: `dist-arm64/CC Analyzer.app` on
arm64, `dist-intel/CC Analyzer.app` otherwise. The executable must exist at
`${APP_PATH}/Contents/MacOS/cc-analyzer`, or the script exits 1 and prints the build
command to run. **Exit code 0 means every check passed; a skipped check does not
count as a failure, a failed check does.** The script is macOS-only — `.app` layout,
`ps`, `sips` and WebKit's own `createPDF` have no portable equivalent.

---

## Isolation is a hard requirement

```bash
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cca-gui-test.XXXXXX")"
HOME="$HOME_DIR" "$BIN" >"$APP_LOG" 2>&1 &
```

- `HOME` is redirected to a fresh temp directory, and the four fixtures are copied into
  `${HOME_DIR}/.claude/projects/<project>/`. The app therefore sees only those.
- The bundle's executable is invoked **directly**, not via `open -a`. `open` goes
  through LaunchServices and does not inherit the shell environment, so the custom
  `HOME` would be silently dropped and the app would read the developer's real
  `~/.claude` ([`pitfalls.md`](./pitfalls.md) #8).

This is not tidiness. Session transcripts are sensitive, and "会话数据不出本机" is a
project red line (`AGENTS.md`) — a leaked `HOME` means the test reads a real person's
sessions. One of the assertions exists purely to catch that regression.

`cleanup()` runs from a trap that covers **`EXIT` and `INT`/`TERM`/`HUP`** (the signal
handlers just `exit`, so the single `EXIT` cleanup always runs). Without the signal
traps, a Ctrl-C or an agent terminating the script kills it before it reaches `EXIT`, and
the background app leaks as a `PPID=1` orphan — measured: six of them, polluting later
runs' environment and memory baseline. `cleanup()` kills **only this run's recorded PID**;
never a broad `pkill -f "CC Analyzer"`, which could kill an app the user has open from
`/Applications`. It `disown`s the job first, then `kill` (SIGTERM, then SIGKILL), then
`rm -rf "$WORK_DIR"`; `disown` is required, otherwise bash announces the terminated job on
stderr and the noise reads like a failure ([`pitfalls.md`](./pitfalls.md) #10). The trap is
guarded by `scripts/gui-test-shutdown-test.sh` (**run in CI** as the `gui-test-shutdown`
job): it launches `gui-test.sh` against a fake bundle, sends TERM/INT, and asserts the
child is reaped — so this is a check, not "I tried it once".

---

## What it asserts

1. **The process is still alive after 10 seconds** (`kill -0` polled once a second).
   Catches a crash on launch; on failure it prints the first 20 lines of the app log.
2. **Resident memory is recorded, not asserted.** `RSS_KB` is printed as a `·` note
   line and does not count toward pass/fail. It used to be an assertion —
   `RSS_KB > 20480` ⇒ "the webview loaded" — and that was an over-claim: measured, a
   minimal window whose only content is a **blank `WKWebView` already sits at
   69 MB / 16 threads**, far above the threshold. No threshold can separate "our UI
   loaded" from "a blank webview is sitting there"; they are the same order of
   magnitude. What actually evidences a loaded webview is checks 5–7.
3. **`meta-cache-v2.json` exists within 15 seconds.** The path is
   `${HOME_DIR}/Library/Application Support/${BUNDLE_ID}/meta-cache-v2.json`
   (`BUNDLE_ID = io.github.liang-zhenxiang.cc-analyzer`; the filename comes from
   `CACHE_NAME` in `web/src/features/sessions/sessionRepository.ts`).
4. **The cache holds exactly 4 entries** — matching the four fixtures copied in — and
   **every entry path starts with the isolated `HOME`** (`OUTSIDE 0`).
5. **The app renders its own window to a PDF** within 15 seconds of launch — for the
   default view **and** for every target in `CCA_GUI_CAPTURE_TAB`. The default list is
   `会话分析 → 打开首个会话 → 日志视图 → 用量总览 → 实时监控`; a session is opened by
   clicking its `title` (i.e. its `cwd`), because session rows have no stable accessible
   name. Comma-separated; a **single** target keeps the legacy filename `-tab.pdf`.
   The first two targets are deliberate: the app persists the active workspace tab **and**
   the analyzer sub-view in **WebKit `localStorage`, which lives under the real
   `~/Library/WebKit` and is not covered by the `HOME` override**, so the app may start
   on whatever tab/view the last run left behind. Without switching back explicitly, a
   session click silently misses and the tree view (no records table) gets captured.
6. **Each PDF converts to a PNG** (`sips -s format png`).
7. **Each PNG is not blank** — at least 20 distinct colours among a sampled grid.
   This is the check that makes the screenshot trustworthy; see the trap below.
8. **Each view's geometry probe satisfies the layout invariants** — see
   "Layout invariants" below.
9. **SIGTERM is followed by exit within 5 seconds.**

Checks 5–8 are what turn "the app is running" into "the app is *displaying the right
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

---

## Layout invariants: facts in the app, assertions in the script

A non-blank screenshot still says nothing about *layout*. The gauge that `v0.10.0`
shipped at ~1030px wide, and the clipped last table column, both passed this suite
before this gate existed — they only surfaced when a human looked at the picture.
The fix is a **geometry probe**:

- `CCA_GUI_PROBE=<path>` makes the app, right after each capture, evaluate a script and
  write the result as JSON to that path.
- The script returns **only facts** — element rectangles, `scrollWidth` / `clientWidth`,
  viewport size, computed `overflow-x`, and whether the scroll hint is present. It
  **contains no thresholds and no pass/fail logic.** Those live in `gui-test.sh`:
  "facts in the app, assertions in the script", because the app should not carry test
  strategy, and thresholds change far more often than the DOM shape does.
- Retrieval uses **`evaluateJavaScript:completionHandler:`**, not `webview.eval`. `eval`
  is one-way — it can run a script but cannot return the result. The completion handler
  is the bidirectional path and reuses the same `with_webview` → raw `WKWebView` pointer
  route as `createPDF`. Failure only logs; it never panics (it is a capture side channel).
- A probe is only evaluated **after its screenshot has landed on disk**. `createPDF`'s
  render is deferred, so evaluating the probe right after triggering the capture can read
  the *pre-snapshot* view — measured once, a monitor screenshot carried a probe that still
  described the usage page. Waiting for the file makes the two describe the same view.
- Anchors are stable: the gauge carries a `data-probe="gauge"` attribute (its `aria-label`
  is runtime text and would fail *silently* if the copy changed), the gauge's card reuses
  the existing `aria-label="计费窗口"`, and the records table reuses the `table` /
  `[data-scroll-hint]` structure. Prefer reusing an existing anchor over adding a probe
  attribute; add one only when no stable anchor exists.

The invariants the script asserts (each prints the measured numbers, so a failure says
*which* invariant broke and by how much):

1. **No horizontal overflow** — document `scrollWidth ≤ clientWidth + 1`, and the same
   for `<main>` (the app's `overflow: hidden` shell hides content overflow from the
   document, so the `<main>` check is the one that actually catches a runaway layout).
2. **Gauge bounded** — width ≤ 200px **and** its rectangle fully inside the billing
   card's rectangle.
3. **Records table last column reachable** — the last header's right edge is within its
   scroll container's right edge, **or** the container is genuinely scrollable
   (`overflow-x` is `auto`/`scroll`, `scrollWidth > clientWidth`, and the hint rendered).
   A wide table that is clipped without being scrollable fails.

These judge **geometry relationships** (overflow, containment, reachability), never
pixel coordinates or colours — so they survive re-theming and engine differences. If a
view is expected to carry a gauge or a table but the probe reports none, coverage fails:
the gate must not become silently vacuous.

### Mutation-verify the gate

A gate that never fails is decoration. When you add or change an invariant, **break the
thing it is meant to catch on the real app** (`./scripts/gui-test.sh --build`), confirm
the run fails and names the invariant, then restore and confirm it passes. Keep the
output as evidence. The three canonical mutations: stretch the gauge (re-apply
`width: 100%`), force horizontal overflow (drop a `min-width: 0`), and clip the records
table (give it a `min-width` wider than its container and remove its scroll).

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

The `gui-capture` module (including the probe) is compiled only on macOS **and** only
with the feature on, so CI's Linux Rust jobs never see it — a mistake there surfaces
only when someone runs `./scripts/gui-test.sh` locally. Checking it in CI would mean a
macOS runner for one test-only module, which is not worth the cost.

The consequence is a rule: **if you touch `gui_capture`, run the script before
committing.** Nothing else will tell you it broke. The same goes for the probe JS and
its anchors — a renamed `data-probe` attribute or a changed layout shows up here first.

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
- Staged fixtures are **time-shifted so the newest activity lands on yesterday**
  (`shift_fixture_jsonl`, one offset shared by all files). Without the shift, a
  windowed page — the usage dashboard is the first — shows an empty state on the
  real-app screenshot and its data path goes unverified. Same trap, same fix as
  `recentActivityScenario` in the e2e layer; keep the two in step.
- **Adding a view**: extend the default capture list in `gui-test.sh` (the
  `CAPTURE_TARGETS` array). `CCA_GUI_CAPTURE_TAB` is a **comma-separated** list of
  targets; the app clicks each in turn (a real click via `eval`, matching on
  `aria-label` / `title` / visible text) and captures a PDF per step, each judged by the
  same convert-and-check pipeline **and** given its own probe JSON. Naming: default
  `app-capture.pdf`; a **single** target keeps `app-capture-tab.pdf`; multiple targets
  get `app-capture-<slug>.pdf` (and the probes follow the same rule with `.json`). The
  `slug_of` in `gui-test.sh` and `gui_capture::slug_of` in `lib.rs` **must match exactly**
  — otherwise the script waits forever for a file that has a different name. If the new
  view carries a gauge or a table, also extend the coverage expectations.
- **Assert on geometry, not pixels.** New invariants should compare relationships
  (overflow, containment, reachability) so they survive re-theming. Put thresholds and
  pass/fail in the script, never in the probe.
- Remember `gui-artifacts/` is gitignored — never commit the screenshot.
