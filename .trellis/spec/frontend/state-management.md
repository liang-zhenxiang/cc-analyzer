# State Management

> Where state lives, in the order you should reach for each option.

---

## Overview

There is no state library. State is chosen from a fixed ladder, and the rung is
decided by **who needs to read it**:

1. `useState` in the component that owns it — the default.
2. A `useRef` for mutable values that must not trigger a render.
3. React context — only for things the whole tree injects (3 providers).
4. A module-level store read through `useSyncExternalStore` — only for
   cross-cutting settings that non-React modules also need to read.

Redux, Zustand, Jotai and React Query are not used and should not be introduced
without an issue explaining why.

---

## Rung 1: Local `useState`

`SessionAnalyzerPage.tsx` holds thirteen `useState` values (`parsed`, `filter`,
`view`, `selectedRecord`, `graph`, `report`, ...). This is the intended shape: one
page component owns the screen's state, panes are controlled. Initializing from
`localStorage` uses the lazy form so the read happens once:

```tsx
const [view, setView] = useState<AnalyzerView>(readStoredView);
```

**Derived state is computed, never stored.** Log rows, filtered rows and the
report signature are `useMemo` over `parsed` + `filter`:

```tsx
const allLogRows = useMemo(() => (parsed ? buildLogRows(parsed.records, parsed.turns) : []), [parsed]);
const logRows = useMemo(() => filterLogRows(allLogRows, filter), [allLogRows, filter]);
```

Two `useState`s that must always agree are a bug waiting to happen — compute the
second one.

---

## Rung 2: Refs for caches

Anything mutable that should not re-render on write lives in a ref:

- `sessionParseCacheRef` — `Map<path, parsedSession>` reused across graph resolutions
- `heights` / `extras` in `measuredRows.ts` — measured row heights
- `timersRef` in `NotificationProvider.tsx` — live toast timers
- `refreshIdRef` / `sessionRequestRef` / `probeIdRef` — request ids (see `hook-guidelines.md`)

When a ref's contents must drive rendering, the hook keeps a separate `version`
counter in state and bumps it on change. Copy `useMeasuredRowHeights` rather than
inventing a second scheme.

---

## Rung 3: Context — exactly three providers

`AppShell.tsx` nests them in this order — `ThemeProvider` >
`BridgesProvider bridges={bridges}` > `NotificationProvider`:

- **Theme** — `theme`, `setTheme`, `toggleTheme`. Writes `data-theme` on
  `document.documentElement` and persists to `cca-theme`.
- **Bridges** — the injected OS/Rust surface. Created **once**, in `App.tsx`
  (`installTauriBridges()`), so tests can swap the whole implementation.
- **Notifications** — `notify(message, tone)`, a fire-and-forget toast.

A fourth context needs a reason. Page state does not qualify.

---

## Rung 4: Module store + `useSyncExternalStore`

`features/settings/thresholds.ts` is the only global store, and it is a module
singleton rather than a context because **non-React code reads it too**:
`parseJsonl.ts` calls `getThresholds().parseChunkLines` and `reportPrompt.ts`
reads `promptBytes` mid-generation.

```
getThresholds()            // current object, same reference until changed
subscribeThresholds(fn)    // listener set
setThresholds(patch)       // clamp -> persist -> notify
useThresholds()            // = useSyncExternalStore(subscribeThresholds, getThresholds, getThresholds)
```

`getThresholds` is passed as **both** the client and server snapshot because the
store is a stable module singleton. Every write goes through `clampThresholds`,
so an out-of-range or non-numeric value from storage can never reach the app.

---

## Persistence

- All keys are prefixed `cca-`: `cca-theme`, `cca-workspace-tab`,
  `cca-analyzer-view`, `cca-session-view`, `cca-session-collapsed`, `cca-thresholds`.
- **Storage is optional; wrap reads and writes in `try/catch`** and fall back to
  an in-memory default. `readStoredView`, `readStoredCollapsed` and
  `loadThresholds` all do this, and the settings store keeps its value in memory
  even when `localStorage.setItem` throws.
- Stored JSON is untrusted input: parse it as `unknown` and run it through a
  normalizer (`clampThresholds`, `normalizeMetadataCache`) — never cast it.

Known gap: `AppShell.tsx` reads and writes `cca-workspace-tab` without a
`try/catch`, and `ThemeProvider` guards only against a missing `window`. New code
follows the guarded pattern above.

---

## What Is *Not* State

The metadata cache (`meta-cache-v2.json`) is a **file on disk**, written by
`SessionRepository` through `bridges.fs`, not React state; `useSessions` only
mirrors the parts a view needs. Anything that must survive a restart belongs
there or in `localStorage` — not in a module variable.
