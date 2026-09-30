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
  asserts on `grid-auto-rows` / `min-height`. The hand-written stubs in
  `web/src/node.d.ts` only declare `readFileSync`, `resolve` and `process.cwd()`
  because `@types/node` is deliberately not installed.

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
