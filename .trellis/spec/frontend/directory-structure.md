# Directory Structure

> How `web/src/` is laid out, and where a new file belongs.

---

## Overview

The frontend has exactly five top-level directories under `web/src/`. Each one
answers a different question, and the boundary between them is enforced by
review, not by tooling:

| Directory | Answers | May import from |
| --- | --- | --- |
| `api/` | "How do we reach the OS / Rust?" | `api/`, `lib/` |
| `app/` | "What is the application shell?" | anything |
| `features/<name>/` | "What does this screen do?" | `api/`, `lib/`, `components/`, other `features/` |
| `components/` | "What is shared across features?" | `react`, `components/` (today: nothing else) |
| `lib/` | "What is domain-agnostic?" | `react` only |

`lib/` must not import from `features/` or `components/`. It is the bottom of
the stack (`lib/path.ts`, `lib/json.ts`, `lib/format.ts`, `lib/useViewportCap.ts`).

---

## Directory Layout

```
web/src/
├── api/                     # the only place that talks to Tauri
│   ├── types.ts             # Bridges interface + command payload types
│   ├── bridges.ts           # BridgesProvider / useBridges (React context)
│   └── tauri.ts             # installTauriBridges(): the invoke() implementation
├── app/                     # shell: providers, tab routing, top bar
│   ├── AppShell.tsx         # composes ThemeProvider > BridgesProvider > NotificationProvider
│   ├── WorkspaceTabs.tsx
│   ├── ThemeProvider.tsx
│   └── NotificationProvider.tsx
├── features/
│   ├── sessions/            # the main feature (~30 modules, see below)
│   ├── monitor/             # iframe dashboard page + postMessage protocol
│   └── settings/            # thresholds store + panel
├── components/              # Button, Panel, EmptyState, StatusToast, TextInput, ErrorBoundary
├── lib/                     # path, json, format, useViewportCap
├── styles/
│   ├── tokens.css           # design tokens (light + [data-theme="dark"])
│   └── global.css           # reset + base element styles
├── main.tsx                 # createRoot + StrictMode
├── App.tsx                  # the only default export in the tree
├── jsdom.d.ts               # hand-written type stubs (see type-safety.md)
└── node.d.ts
```

---

## Module Organization

**A feature owns its own components, hooks, helpers and CSS.** Roughly 30
modules live in `features/sessions/`; they are grouped by responsibility, not by
kind (there is no `hooks/` or `utils/` folder inside a feature):

- Parsing and data model: `parseJsonl.ts`, `sessionGraph.ts`, `types.ts`
- Derived models: `duration.ts`, `durationTree.ts`, `logRows.ts`, `filters.ts`
- Persistence: `sessionRepository.ts`, `metadataCache.ts`, `metadataScanner.ts`, `sessionParseCache.ts`
- Virtualisation: `virtualWindow.ts`, `measuredRows.ts`
- Report pipeline: `reportPrompt.ts`, `report.ts`
- Views: `SessionAnalyzerPage.tsx`, `LogView.tsx`, `TreeView.tsx`, `SessionList.tsx`, ...

**Only split a file into a directory when it needs its own assets.** None of the
features has subdirectories today; a directory per view would add a level with
no content in it.

**Cross-feature imports are allowed in one direction only.** `features/sessions/*`
imports `features/settings/thresholds` in eight places (`LogView.tsx`,
`SessionList.tsx`, `parseJsonl.ts`, `report.ts`, ...). That is deliberate: the
thresholds store is application-wide configuration, not a sibling screen. Do not
copy this into a feature-to-feature import of *view* code — lift the shared piece
into `lib/` or `components/` instead.

---

## Naming Conventions

- `PascalCase.tsx` — anything that exports a React component (`LogView.tsx`, `Panel.tsx`).
- `camelCase.ts` — everything else, including the module exporting the component's
  own helper (`virtualWindow.ts`, `logRows.ts`).
- `useXxx.ts` — custom hooks. Hooks that are feature-specific live beside the
  feature (`features/sessions/useSessions.ts`); only generic ones go to `lib/`.
- `Xxx.module.css` — the stylesheet sits next to the file that imports it, named
  after the **component**, not the directory (`LogView.tsx` + `LogView.module.css`).
- `*.test.ts` / `*.test.tsx` — tests live beside the implementation, never in a
  separate `__tests__/` tree.
- **No path aliases.** Imports are relative (`../../api/bridges`). `tsconfig.json`
  defines no `paths`, so an alias will fail the build.

---

## Examples

- Feature with the full set of concerns: `web/src/features/sessions/`
- Smallest complete feature: `web/src/features/settings/` (store + panel + tests)
- Shared-component set: `web/src/components/`
