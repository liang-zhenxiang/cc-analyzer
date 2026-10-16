# Quality Guidelines

> The gates a frontend change must pass, the patterns that are banned, and what
> reviewers look for.

---

## Overview

There is **no ESLint and no Prettier** in this repo — `.eslintrc` and
`.prettierrc` do not exist, and `web/package.json` has no `lint` script. The
frontend gates are:

| Gate | Command | Enforced by |
| --- | --- | --- |
| Types + unused code | `tsc -b` (inside `npm --prefix web run build`) | `web-build` CI job |
| Tests | `npm --prefix web test` (Vitest, jsdom) | `web-test` CI job |
| Shell/YAML/Actions linting | `./scripts/lint.sh` | several CI jobs |

Note that `scripts/lint.sh` explicitly **does not** cover vitest, `tsc` or Rust
(see the header comment in that script) — running it is not a substitute for
`npm --prefix web test` and `npm --prefix web run build`.

`tsconfig.json` is `strict` with `noUnusedLocals`, `noUnusedParameters` and
`noFallthroughCasesInSwitch`. Because formatting and import order are unchecked
by tooling, **they are upheld by review** — match the surrounding file.

---

## Forbidden Patterns

- **`any`, `as any`, `@ts-ignore`, `@ts-expect-error`.** There are zero
  occurrences in `web/src` today. Use `unknown` plus a narrowing function.
- **Importing `@tauri-apps/*` outside `api/`.** The only permitted files are
  `api/tauri.ts` and `api/bridges.test.ts` (which mocks the module).
- **Hard-coded colors, spacing or radii in CSS.** Use the variables in
  `styles/tokens.css`. The single existing literal is a box-shadow in
  `ThresholdsPanel.module.css`; do not add a sibling.
- **`console.*` for diagnostics.** The only call in `web/src` is
  `console.error("界面渲染失败", ...)` in `ErrorBoundary`, and a test asserts on it.
  Surface user-visible failures through `useNotifications().notify(msg, "error")`.
- **`JSON.stringify` on transcript data.** Records come from files on disk and can
  hold `bigint` or cycles. Use `safeStringify` from `lib/json.ts`, which renders
  `[循环引用]` / `[函数]` instead of throwing mid-render.
- **Unvalidated casts of persisted or parsed JSON** (`raw as MetadataCache`).
  Run it through a normalizer first — see `type-safety.md`.
- **A second `export default`.** Only `App.tsx` has one.
- **Committing generated output**: `web/dist/`, `web/node_modules/`,
  `tsconfig.tsbuildinfo`.

---

## Required Patterns

- **All OS access goes through `Bridges`** (`api/types.ts`), obtained via
  `useBridges()` or passed as a service prop.
- **Errors are caught and shown, never swallowed.** Async failures set an error
  string and/or call `notify(...)`, e.g. ``setError(`扫描会话列表失败: ${String(cause)}`)``.
- **Name the caught value `cause`** and stringify it with `String(cause)`. Tauri
  commands return `Result<T, String>`, so a rejection is a **plain string, not an
  `Error`** — never rely on `cause instanceof Error` without a fallback.
- **User-facing strings are Chinese; code comments and identifiers are English.**
  Error text like `"会话读取失败"` and labels like `aria-label="阈值设置"` are asserted
  by tests, so changing them is a code change, not a copy tweak.
- **Exit conditions stay explicit**: `if (refreshIdRef.current !== requestId) return;`
  rather than letting a stale result land.
- **When aggregating a "first" or an extreme, compare the value and its label as
  one pair.** A reduction that keeps only the timestamp (`this.firstSkillAt`) and
  looks the name up later will happily print `09:10` next to the `09:30` call's
  name. `features/usage/milestones.ts` keeps a `{ at, detail }` pair
  (`earlierMoment`) precisely so the winner carries both halves; the same hazard
  applies to longest/fastest/most-expensive reductions wherever the display
  needs anything besides the number. Test it by feeding candidates in an order
  that contradicts their timestamps.

---

## Honest Readings

A number read from the logs is a fact; a number computed from a rate is not. The
UI must not blur the two. This is one rule with several faces:

- **Activity is a fact about the log, not about the process.** The pulse's
  active-session list (`features/monitor/PulsePage.tsx`) says
  `N 分钟前有新记录` and footnotes `只陈述「多久前有新记录」，不代表会话正在运行。`
  It never claims a session is "running" — mtime is all we know, and a
  long-running tool call that writes nothing looks idle. State the timestamp,
  not the inference.
- **No unrequested extrapolation.** The pulse draws the context curve but not an
  official ceiling, and never predicts "how many minutes are left"; the band it
  *does* draw is the **measured** pre-compaction volume of recent automatic
  compactions, labeled as such. Where an extrapolated time is shown at all
  (predicted limit reach), it comes from the shared `predictLimitReach` and is
  the page's only `--warning` reading — the color says "non-deterministic", the
  label says what it is.
- **Provenance is the same idea in another shape.** Estimated cost, unpriced
  models and beta builds all carry a badge that says so. When you add a reading,
  ask which of these three it is: a fact, an estimate, or a prediction — and
  make the UI say it.
- **One concept, one window, one screen.** A reading is only honest if its
  window is stated with it *and* no other panel on that screen measures the same
  concept over a different window. The calendar's year-in-insights six sentences
  (`features/usage/calendarInsights.ts`) run over a **rolling 365 days**; the
  milestones (`features/usage/milestones.ts`) run over the **entire history**.
  That is why milestones ship no streak, no priciest day and no active share —
  two windows for one concept means two numbers that disagree, and the reader
  has no way to tell which one is right. The same rule is why the milestones
  sub-view renders **no range selector**: a control that does not affect the
  numbers on screen claims that it does.
- **A badge you cannot recompute is not a fact.** Milestones apply this
  literally — every one of them is rebuildable from the logs alone (`totalsSum`,
  event counts, dedup sets). Cumulative cost is the one candidate that reads an
  **expiring** artifact, the offline pricing snapshot, and "days with unknown
  pricing don't count" would make its undercount invisible; so it stays out of
  the milestone tiers and is carried by the KPI (provenance badge + snapshot
  date) and the calendar shading instead. Before adding a badge, reading or tier,
  ask: *can this be rebuilt from the logs on this machine today, with no other
  input?* If not, it needs a label that says so — or it belongs somewhere that
  already labels it.

---

## Testing Requirements

Vitest + jsdom + React Testing Library. Setup lives in `web/vitest.setup.ts`
(it shims `matchMedia` and `Element.prototype.scrollIntoView`, neither of which
jsdom implements).

- Tests sit beside the implementation as `*.test.ts(x)` and are named for the
  behavior, not the function: `"updates sessions as metadata batches complete"`,
  `"allows analyzer content to scroll at 960x640"`.
- **Query by role and accessible name**, not by test ids or CSS class:
  `screen.getByRole("button", { name: "保存" })`.
- **Transcript fixtures** live in `web/tests/fixtures/*.jsonl` and are imported
  with Vite's `?raw` suffix (`import basic from "../../../tests/fixtures/session-basic.jsonl?raw"`).
  Add a fixture when you touch the parser, duration model, filter or report.
- **Fake the whole `Bridges` object** to test a feature: build a literal and cast
  once (`} as unknown as Bridges;` in `useSessions.test.tsx`) or mock
  `./api/tauri` (`App.test.tsx`). Never mock `@tauri-apps/api` in a feature test.
- CSS invariants are testable by reading the stylesheet —
  `SessionAnalyzerPage.layout.test.ts` reads the `.module.css` with `node:fs` and
  asserts on `grid-auto-rows` / `min-height`. `@types/node` is installed for this
  (and for the Playwright config), so `node:fs` is typed properly. There used to
  be a hand-written stub at `web/src/node.d.ts`; it was deleted because it
  shadowed the real `process` type and nothing imported it. The app itself still
  calls `window.setTimeout` rather than bare `setTimeout`, which keeps
  `NodeJS.Timeout` out of the DOM code.

### Layer split

This section covers **frontend-layer mechanics** — how to write a unit test here,
how to fake `Bridges`, how fixtures are imported. The cross-cutting questions
(which layer a change needs, what counts as done, the end-to-end and real-app GUI
suites) are owned by [`../testing/index.md`](../testing/index.md).

The rule "never mock `@tauri-apps/api` in a feature test" is scoped to *this*
layer. The end-to-end suite does stub at the Tauri boundary, deliberately — see
[`../testing/e2e-tests.md`](../testing/e2e-tests.md) for why covering
`api/tauri.ts` is the point there.

---

## Code Review Checklist

- [ ] No new `any` / tauri import / hard-coded token-less color.
- [ ] Every `await` in an async callback is followed by a request-id or
      abort-signal check before touching state.
- [ ] Timers, listeners and observers are cleaned up.
- [ ] External input (files on disk, `localStorage`, JSONL records) was narrowed
      from `unknown`, not asserted.
- [ ] New behavior has a test; parser/duration/filter/report changes have a fixture.
- [ ] `npm --prefix web test` and `npm --prefix web run build` pass locally.
- [ ] User-visible change is recorded in `CHANGELOG.md` under `[Unreleased]`.
- [ ] New readings say what they are (fact / estimate / prediction) and make no
      "running"-style claim from a timestamp (see [Honest Readings](#honest-readings)).
- [ ] New readings state the window they cover, and no two panels on one screen
      compute the same concept over different windows (see
      [Honest Readings](#honest-readings)).
