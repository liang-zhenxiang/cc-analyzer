# Frontend Development Guidelines

> Conventions for `web/src/` in CC Analyzer (React 18 + TypeScript + Vite, Tauri 2 desktop shell).

---

## Overview

These are the conventions this project actually follows, derived from the code in
`web/src/`. Each file states what the code does today, including the places where
the code is not yet consistent — a guideline that contradicts the tree is worse
than no guideline, because it makes people act on a wrong premise.

Scope: the frontend only. Build, packaging, commit and release rules live in
[`AGENTS.md`](../../../AGENTS.md); the design rationale behind these conventions —
including the options that were rejected — is in
[`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md).

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Five top-level dirs under `web/src/`, dependency direction between them, file naming, no path aliases | `api/` is the only Tauri boundary; tests sit beside their implementation |
| [Component Guidelines](./component-guidelines.md) | Named function components, inline props types, `children` slots, CSS Modules + tokens | No `React.FC`/`memo`/`forwardRef`; only `App.tsx` default-exports; a11y names are asserted by tests |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, async data flow, request-id guards, effect cleanup, DOM measurement hooks | No data-fetching library; every await is followed by a stale-request check |
| [State Management](./state-management.md) | The four-rung ladder: local state, refs, three contexts, one `useSyncExternalStore` module store | `cca-*` localStorage keys, guarded reads, untrusted persisted JSON; no Redux/Zustand/React Query |
| [Quality Guidelines](./quality-guidelines.md) | Gates (`tsc -b` + Vitest; no ESLint/Prettier), forbidden patterns, testing expectations, review checklist | Zero `any`/`@ts-ignore` in the tree; user-facing strings are Chinese, comments English |
| [Type Safety](./type-safety.md) | Wire types mirror Rust serde output, `unknown` at every disk/process boundary, hand-written narrowing helpers | `invoke` rejects with a plain string, not an `Error`; `safeStringify` for transcript data |

---

## How to Use These Guidelines

1. **Before writing a feature**: read the guide for the layer you are touching.
2. **When adding a file**: confirm it belongs in the directory you picked —
   [Directory Structure](./directory-structure.md) has the dependency rules.
3. **When touching parsing, duration, filters or the report**: read the
   [Testing Requirements](./quality-guidelines.md#testing-requirements) section
   first; those areas are fixture-tested.
4. **When a rule here disagrees with the code**: the code and
   `docs/ARCHITECTURE.md` win, and the guideline is the thing to fix.

---

## Related Documents

- [`AGENTS.md`](../../../AGENTS.md) — build/test commands, coding style, commit and release flow
- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) — module map and design trade-offs
- [`docs/LOCAL_DEVELOPMENT.md`](../../../docs/LOCAL_DEVELOPMENT.md) — running the app locally
