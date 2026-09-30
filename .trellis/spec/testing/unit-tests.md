# Unit & Component Test Guidelines

> Conventions for the Vitest + jsdom + React Testing Library suite in `web/src/` —
> where tests live, how fixtures are consumed, and how to fake the `Bridges` layer.

---

## Where tests live, and what gets collected

Tests sit beside their implementation as `*.test.ts` / `*.test.tsx`. The config is
`web/vite.config.ts` — jsdom, `globals: true`, `setupFiles: "./vitest.setup.ts"`, and
`include: ["src/**/*.test.{ts,tsx}"]` narrowed deliberately: Playwright also names its
files `.spec.ts`, so widening is not an option
([`pitfalls.md`](./pitfalls.md) #3). Two consequences: nothing outside `src/` is
collected — a test dropped in `web/tests/` runs **zero** times and passes by omission —
and `globals: true` makes `vi` / `test` / `describe` ambient. Both styles exist in the
tree (`useSessions.test.tsx` uses them bare, `duration.test.ts` imports them); **prefer
the explicit import** from `"vitest"`. Run `npm --prefix web test`.

`web/vitest.setup.ts` does three guarded things: imports
`@testing-library/jest-dom/vitest` (source of `toBeInTheDocument`, `toHaveTextContent`),
shims `window.matchMedia` (jsdom lacks it; `ThemeProvider.tsx` reads
`prefers-color-scheme`), and shims `Element.prototype.scrollIntoView` (`LogView.tsx`
and `TreeView.tsx` call it when revealing a row). A test that must *assert* on scrolling
re-assigns the mock in `beforeEach` (`LogView.test.tsx`) so the call count starts clean.

---

## Fixtures

`web/tests/fixtures/` holds transcript data, imported through Vite's `?raw` suffix — the
file is inlined as a string at build time, nothing is read from disk at runtime, so the
path is relative to the test: `"../../../tests/fixtures/session-basic.jsonl?raw"`.

| Fixture | Lines | Consumed by | Covers |
| --- | --- | --- | --- |
| `session-basic.jsonl` | 7 | `parseJsonl.test.ts`, `report.test.ts`, `TimelineTrack.test.tsx`, e2e seeds | Two turns, a paired `tool_use`/`tool_result`, token usage |
| `session-parser-enhanced.jsonl` | 17 | `parseJsonl.test.ts` | Sync vs. chunked parser equivalence, richer records |
| `session-duration-model.jsonl` | 13 | `duration.test.ts` | The hand-computed breakdown (`total: 6000`, …) |
| `session-errors.jsonl` | 6 | `sessionAnalysis.test.ts` | Error records and failure classification |
| `session-subagent.jsonl` | 3 | `sessionAnalysis.test.ts`, e2e seeds | Sidechain / delegated records |
| `session-metadata.jsonl` | 4 | `sessionRepository.test.ts`, `metadataScanner.test.ts` | Session-id/cwd extraction from a file head |

### Directory-shaped fixtures

`session-graph/` is a **tree**, and the shape is the point: `main.jsonl` next to
`subagents/agent-child.jsonl`, `agents/agent-grandchild.jsonl`, and
`subagents/workflows/run-1.json` beside the `subagents/workflows/run-1/` directory
holding `agent-workflow-child.jsonl`.

`sessionGraph.ts` discovers children by walking the layout Claude Code actually writes
(`<project>/<sessionId>/subagents/`, `…/workflows/<runId>.json` next to
`…/workflows/<runId>/`); a flat fixture would not exercise that walk. Tests then
re-declare the same content as an explicit `files` / `directories` object, because
`resolveSessionGraph` reads directory listings — and a test needs a directory it can
make empty, missing, or unreadable on purpose (`"ignores unreadable subagent and
workflow directories"`). Add a fixture whenever you touch the parser, duration model,
filter or report.

---

## Assertions

- **Query by role and accessible name**: `getByRole("button", { name: /project-a/ })`,
  `getByRole("status", { name: "会话图状态" })`, `getByRole("region", { name: "工具输入" })`;
  `getByPlaceholderText("搜会话 ID 或目录…")` for the search input.
- **Scope repeated text with `within`.** `LogView.test.tsx` resolves
  `screen.getByText("工具").closest("tr")!` and asserts inside that row, because the same
  labels appear in several columns.
- **Match the contract, not the object.** `toMatchObject` where only a few fields matter;
  `toEqual` on the whole value when the full shape *is* the contract
  (`computeDurationBreakdown`, `normalizeMetadataCache`).
- **Chinese accessible names are the norm** (the UI is Chinese). Do not assume a
  separator between concatenated inline elements — `SessionList.test.tsx` documents that
  `/会话 399/` has no trailing space for exactly this reason.
- **CSS Module classes are reachable** via `import styles from "./X.module.css"` and
  `` container.querySelectorAll(`.${styles.sessionRow}`) `` — the sanctioned way to count
  rows in the virtualized list, where a row is a `div` with no distinct role.
- **Stylesheets are testable as text.** `SessionAnalyzerPage.layout.test.ts` reads
  `SessionAnalyzerPage.module.css` with `node:fs` and asserts regexes (`grid-auto-rows`
  present, `min-height: 640px` absent). It is a `.test.ts` — it renders nothing.

---

## Faking `Bridges`

`useBridges()` throws outside a provider, so any component that touches the filesystem
needs one. Three techniques, in order of preference:

**1. A literal cast once.** `createBridges()` in `useSessions.test.tsx`,
`SessionAnalyzerPage.test.tsx` and `sessionGraph.test.ts` ends with
`} as unknown as Bridges;`. The cast is why a *missing* method is not a compile error —
so **copy an existing `createBridges()`** rather than writing a new one, and fill in only
the branches the test drives. `sessionGraph.test.ts` throws on an unexpected path
(`if (!(path in files)) throw …`) so a stray read is loud.

**2. Real class, spied prototype** — when the test is about *ordering*, not I/O.
`useSessions.test.tsx` spies on
`SessionRepository.prototype.completeMetadata` and implements it to release metadata
batches one at a time, then asserts sessions are patched **by path, without reordering**.

**3. Mock the bridge factory, at the app root only.** `App.test.tsx` does
`vi.mock("./api/tauri", …)` because `App` installs the real bridges itself. Do not do
this in a feature test — the feature should receive bridges through `BridgesProvider`.
`api/bridges.test.ts` is the one file allowed to mock `@tauri-apps/api/core`, because
asserting the exact command names (`"read_dir"`, `"home_dir"`) is precisely its job.

---

## Hooks and async flows

- `renderHook(() => useSessions(), { wrapper })` with a `<BridgesProvider bridges={…}>`
  wrapper. Drive with `await waitFor(() => expect(result.current.loading).toBe(false))`;
  wrap direct hook calls in `await act(async () => { await result.current.importPath(path) })`.
- **Races are tested by holding the resolver.** `SessionAnalyzerPage.test.tsx` defines
  `createDeferred<T>()`; `useSessions.test.tsx` inlines `new Promise` and captures
  `resolve`. Resolve the *newer* request first, then the older, and assert the stale
  payload never reaches the DOM (`expect(screen.queryByText(/first content/)).not.toBeInTheDocument()`).
- **Fake timers only where wall-clock is the subject** — date grouping in
  `SessionList.test.tsx`, the monitor in `MonitorPage.test.tsx`.
  `vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 24, 12))` inside `try`,
  `vi.useRealTimers()` in `finally`.
- **Reset global state explicitly.** `window.localStorage.clear()` in `beforeEach`
  (`SessionList.test.tsx`) or at the top of a test asserting a persisted `cca-*` key
  (`SessionAnalyzerPage.test.tsx`); `vi.restoreAllMocks()` in `afterEach` where spies
  were installed.
- `unmount()` only when re-mounting within the same test — see
  `"remembers the list view in localStorage"`, which unmounts and renders again to prove
  the setting is read back.
