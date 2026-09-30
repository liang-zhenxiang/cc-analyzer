# End-to-End Test Guidelines

> Conventions for the Playwright suite in `web/e2e/`: what it runs against, why the
> Tauri stub sits at `window.__TAURI_INTERNALS__`, and how to add a case.

---

## What it runs against

`web/playwright.config.ts` drives a real Chromium against a **production build**, not
the dev server: its `webServer.command` is `npm run build && npm run preview`, serving
`http://127.0.0.1:4173` with `reuseExistingServer: !process.env.CI` so a stale server can
never be reused in CI.

Dev and build are different code paths — tree-shaking, `manualChunks` (the markdown
renderer is split into its own chunk in `web/vite.config.ts`), production React. Users
receive the built artifact, so that is what is tested.

Also: `testDir: ./e2e`, a single `chromium` project at 1440×900, `fullyParallel`, 30s per
test / 10s per assertion, `forbidOnly` in CI, `retries: 1` and `workers: 2` in CI.
`trace` and `video` are `retain-on-failure`, `screenshot: only-on-failure`, written to
`web/e2e-results/`; the HTML report goes to `web/e2e-report/`. All gitignored by the
repo-root `.gitignore`. Run `npm --prefix web run test:e2e`, read the report with
`npm --prefix web run test:e2e:report`, narrow with `--grep "关键词"`.

---

## The stub boundary: `window.__TAURI_INTERNALS__`

`web/e2e/tauri-mock.ts` is injected by the `page` fixture in `web/e2e/fixtures.ts` via
`page.addInitScript(installTauriMock, scenario)`. It installs
`window.__TAURI_INTERNALS__` — the object `@tauri-apps/api` actually calls:
`invoke(cmd, args)` lands there directly, and `listen(event, handler)` arrives as
`plugin:event|listen` after a `transformCallback`.

Stubbing here rather than replacing the `Bridges` implementation buys two things:
**application code is untouched** (no test-only bundle, nothing test-related ships in
the release), and the suite transparently covers `web/src/api/tauri.ts` itself — a
misspelled command name or wrong argument key fails exactly as it would in the app.

Because the function is serialized into the page, **its body must be self-contained**:
it cannot close over anything but the `scenario` argument. That is why `norm`,
`parentOf` and `baseOf` are defined inside it.

### Command dispatch

`invoke` is a `switch (cmd)`. The `default` branch throws
`E2E mock 未实现的命令：${cmd}` — deliberately loud, so adding a Tauri command without a
case here surfaces as a failing test rather than an `undefined` that a downstream
assertion blames on the feature.

- `transformCallback(cb, once)` allocates an id, stores `cb` at `window['_<id>']` and
  returns the id; `unregisterCallback` deletes it. This is the real contract with Rust,
  reproduced.
- `plugin:event|listen` records the handler id under the event name;
  `plugin:event|unlisten` removes it.
- `run_lines` then emits `proc:line:<streamId>` by calling
  `window['_<handlerId>']({ event, id, payload })` for each line in
  `scenario.claudeStdout`, and returns `{ ok, error, stderr }` from
  `scenario.claudeResult`. No DOM events and no real `claude` process — but the payload
  shape the app parses is the real one.

### The virtual filesystem, and its deliberate sharp edge

`scenario.files` maps absolute path → content; `scenario.emptyDirs` declares directories
that cannot be inferred from that map. `read_dir` synthesizes entries from the declared
files one level deep (`is_dir` when the remainder still contains a `/`), includes any
declared empty directory whose parent matches, and sorts by `name.localeCompare`.

**Reading a directory nobody declared throws** instead of returning `[]`:

> `请在夹具里声明它——静默返回空数组会把夹具错误伪装成功能缺陷。`

That trade-off is the point: an undeclared path means the fixture is wrong, and an empty
list would let that mistake masquerade as a product bug — the same failure mode as
[`pitfalls.md`](./pitfalls.md) #6. The cost is that a genuinely empty directory must be
listed in `emptyDirs`; `emptyScenario()` does that for `~/.claude/projects`. When the app
starts scanning somewhere new, expect a loud failure and declare the path. `stat` returns
a fixed `mtime_ms: 1_700_000_000_000` and a content-derived size, keeping ordering
assertions deterministic.

---

## Fixtures and scenarios

`fixture(name)` in `web/e2e/fixtures.ts` reads from `web/tests/fixtures/` — **the same
files the unit tests import with `?raw`**. A parser change is visible in both layers at
once, and there is one place to add transcript data.

- `defaultScenario()` — five projects, five sessions seeded from `session-basic`,
  `session-subagent`, `session-parser-enhanced`, `session-errors`,
  `session-duration-model`. It also fills `monitor`, `claudeStdout` and `savePath`,
  which the current smoke spec does not assert on yet.
- `emptyScenario()` — `files: {}` plus one declared empty `~/.claude/projects`.

`projectDir(cwd)` replaces `/` with `-`, because that is how Claude Code names a project
directory (`/repo/demo` → `-repo-demo`). Without it the mock layout would not match the
real one, and discovery would take a path production never takes.

The exported `test` extends Playwright's with a `scenario` fixture and a `page` fixture
that supersedes the built-in to call `addInitScript`. A spec overrides the scenario with
`test.use({ scenario: emptyScenario() })` (see the 空状态 block in `smoke.spec.ts`); new
scenarios should build on `defaultScenario({ …overrides })`.

---

## Writing a case

Assert **user-visible outcomes only** — `smoke.spec.ts` says so explicitly, so the suite
survives a visual rework. Shape: `page.goto("/")` → drive the UI → assert.

**Selectors.** Prefer role + accessible name: `getByRole("tab", { name: "日志视图" })`
then `toHaveAttribute("aria-selected", "true")`; `getByRole("status", { name: "会话图状态" })`
then `toContainText("会话图已加载")`; `getByLabel("会话列表")` to scope a panel.

Session rows use `button[title]`, **not** `button:has(strong)`:

```ts
page.getByLabel("会话列表").locator("button[title]")
```

`button:has(strong)` also matches the group-collapse toggle (its label is a `<strong>`),
so "5 sessions" resolves to 6 and the failure looks like a product bug. Rows carry
`title={cwd ?? path}`, the path hint shown to the user — stable and semantically right.
This is [`pitfalls.md`](./pitfalls.md) #6; read it before widening any selector.

Guard the fixtures the counts depend on: the 夹具健全性 block asserts the default scenario
still holds five `.jsonl` files under `/.claude/projects/`, so a broken fixture cannot
turn the count assertions into "0 equals 0".

## Debugging

`web/e2e-results/` holds the trace, screenshot and video of each failure — open the trace
with `npx playwright show-trace`; the HTML report links them. `--headed` and `--debug` run
in a visible browser with the inspector. Avoid `waitForTimeout`; wait on observable state.

The mock also exposes `window.__CCA_E2E_LOG__`, an array of every `{ op, args }` `invoke`
the app made. Read it with `page.evaluate(() => window.__CCA_E2E_LOG__)` to see which
commands actually ran. No spec asserts on it today — it is a debugging affordance and a
ready-made hook for "this command must (not) have been called".

## In CI

**The suite is not wired into CI today.** `ci.yml` runs `npm --prefix web test`
(`web-test`) and `npm --prefix web run build` (`web-build`); no workflow under
`.github/workflows/` mentions Playwright. So `test:e2e` is a local/manual gate — the
completion checklist in [`index.md`](./index.md) lists it, but nothing enforces it, and
the browser must be installed once (`npx playwright install chromium`).

To add a job: `npx playwright install --with-deps chromium` before
`npm --prefix web run test:e2e` (the `webServer` block builds the app itself), and upload
`web/e2e-report` when it fails. Never commit `.only` — `forbidOnly` is what makes that a
failure rather than a silently shrunken suite.
