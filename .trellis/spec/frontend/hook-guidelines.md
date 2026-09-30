# Hook Guidelines

> Custom hooks, async data flow, and the race conditions this app has to guard against.

---

## Overview

There is **no data-fetching library** — no React Query, no SWR, no Redux.
Asynchronous work is plain `async` functions inside `useCallback`, tracked with
`useState`, guarded with a `useRef` request id. There is no `fetch()` in the
frontend at all: every read goes through `Bridges`. Only one hook is generic
enough to live in `lib/` (`useViewportCap`); everything else sits beside its feature.

---

## Hook Inventory

| Hook | File | Returns |
| --- | --- | --- |
| `useSessions` | `features/sessions/useSessions.ts` | `{ sessions, loading, error, progress, refresh, importPath }` |
| `useBridges` | `api/bridges.ts` | the injected `Bridges` (throws outside the provider) |
| `useNotifications` | `app/NotificationProvider.tsx` | `{ notify(message, tone?) }` |
| `useTheme` | `app/ThemeProvider.tsx` | `{ theme, setTheme, toggleTheme }` |
| `useThresholds` | `features/settings/thresholds.ts` | `Thresholds` via `useSyncExternalStore` |
| `useViewportCap` | `lib/useViewportCap.ts` | caps an element to the viewport (writes `maxHeight`) |
| `useMeasuredRowHeights` | `features/sessions/measuredRows.ts` | `{ heights, extras, estimate, measureRow, measureExtra, version }` |

Every context hook **throws** when used outside its provider, with a Chinese
message — `throw new Error("useBridges 必须在 BridgesProvider 内使用")`. Keep
that shape: a missing provider must fail loudly, not silently return `null`.

---

## Async Work: The Request-Id Guard

Every async operation that can be superseded carries a monotonically increasing
id in a ref and re-checks it after **each** `await`. This is the single most
repeated pattern in the codebase (`useSessions.ts`, `SessionAnalyzerPage.tsx`,
`MonitorPage.tsx`):

```ts
// features/sessions/useSessions.ts
const refreshIdRef = useRef(0);

const refresh = useCallback(async () => {
  const requestId = ++refreshIdRef.current;
  setLoading(true);
  try {
    const scannedSessions = await repository.listSessions();
    if (refreshIdRef.current !== requestId) return;   // superseded: drop the result
    setSessions(...);
  } finally {
    if (refreshIdRef.current === requestId) setLoading(false);
  }
}, [repository]);
```

Note the `finally`: the loading flag is only cleared by the **latest** request,
otherwise a stale request finishing late would blank a spinner that is still
needed.

Long-running work that must actually stop uses an `AbortController` instead —
`reportAbortRef` in `SessionAnalyzerPage.tsx` feeds `generateReport(...)`, which
forwards the signal to `bridges.proc.cancelLines` and throws `ReportCancelledError`.

---

## Effects

- Kick off async work with an explicit `void`: `void refresh();`, `void probe();`.
- **Subscriptions must return a disposer that handles the promise** —
  `onSessionImport` resolves to an unsubscribe function:

```ts
useEffect(() => {
  void refresh();
  const unlisten = bridges.events.onSessionImport((path) => void importPath(path));
  return () => { void unlisten.then((dispose) => dispose()); };
}, [bridges.events, refresh, importPath]);
```

- Every `setTimeout` gets a `clearTimeout` in cleanup. `NotificationProvider`
  keeps its timer ids in a `Set` ref and clears all of them on unmount.
- Depend on the narrowest thing: the effect above lists `bridges.events`, not the
  whole `bridges` object.

---

## Measuring Instead of Guessing

`lib/useViewportCap.ts` and `features/sessions/measuredRows.ts` are the two
hooks that touch the DOM. Both exist because a layout heuristic was not good
enough:

- `useViewportCap` uses `useLayoutEffect` and re-applies on `window.resize` and
  on a `ResizeObserver` watching the parent — the blocks above a pane can wrap
  and change its available height without the window resizing.
- `useMeasuredRowHeights` measures rows through ref callbacks and **re-renders
  only when a height actually changes** (`if (previous !== undefined && Math.abs(previous - height) < 2) return;`).
  Without that guard the measurement loop feeds itself.

**Do not add a hook that estimates a row height from a constant and calls it
done.** `LogView.tsx` still declares `ROW_HEIGHT = 31`, but it is only the
fallback for rows that have never been rendered; the estimate converges on the
measured average after one screenful. The 31px guess was the shipped estimate
once, and measured rows turned out to be 39px — the scroll offset drifted by
thousands of pixels on long sessions.

---

## Common Mistakes

- **Awaiting inside `useMemo`.** Derived models in `SessionAnalyzerPage.tsx`
  (`buildLogRows`, `filterLogRows`, `reportSignature`) are synchronous by
  contract; the async half is the `activate` / `openSession` callbacks.
- **Putting an async function directly in `useEffect`.** Wrap it and call with `void`.
- **Storing a mutable cache in state.** Caches live in refs
  (`sessionParseCacheRef`, `heights.current`, `timersRef`); a `version` counter
  in state is what triggers the re-render.
