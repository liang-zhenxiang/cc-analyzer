# Component Guidelines

> How components are declared, typed, composed and made reachable to tests.

---

## Overview

Components are plain named function declarations. There is **no** `React.FC`,
no `React.memo`, no `forwardRef`, and no class component except
`components/ErrorBoundary.tsx` (which must be a class to implement
`getDerivedStateFromError`). `web/src/App.tsx` holds the **only `export default`**
in the tree, so every component's name is greppable from its import site.

---

## Declaration Pattern

Props are typed **inline, in the parameter list** — do not introduce a separate
`type Props` above the component. Optional props are destructured with a default
value, not with `?.` at every use site.

```tsx
// web/src/components/Panel.tsx
export function Panel({
  title,
  actions,
  children
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <header className={styles.header}><h2>{title}</h2>{actions}</header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
```

**Wrappers around a native element spread the native props and merge
`className`**, instead of re-declaring every HTML attribute. `Button.tsx` types
its props as `ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ... }` and
builds the class list with:

```tsx
[styles.button, styles[variant], className].filter(Boolean).join(" ")
```

---

## Composition and Layout

- **A page component owns the state; panes are controlled.** `SessionAnalyzerPage.tsx`
  holds `parsed`, `filter`, `view` and `selectedRecord`, and passes them down as
  `value` + `onChange` props. `LogView`, `TreeView`, `FilterBar` and
  `TimelineTrack` keep no copy of that state.
- **Composition goes through `children` / `ReactNode` slots.** `Panel` takes
  `actions`; `EmptyState` takes an optional `action`. There is no render-prop or
  HOC usage in the codebase.
- **Views are switched by an explicit union, not by a router.** `AnalyzerView` is
  `"log" | "tree"`, `WorkspaceTab` is `"analyzer" | "monitor"`; the selection is
  persisted to `localStorage`, not reflected in a URL.

---

## Reaching the OS

Two patterns are in use, and both are correct:

1. **`useBridges()`** when the component already sits under `BridgesProvider`
   (`SessionAnalyzerPage.tsx`, `MonitorPage.tsx`).
2. **Explicit service props** when the component only needs one capability, so a
   test can pass a two-function stub — `RecordDetailPanel.tsx` takes
   `clipboard: ClipboardService` and `system: SystemService`; `ReportPanel.tsx`
   takes the whole `bridges: Bridges`.

Never `import { invoke } from "@tauri-apps/api/core"` in a component. The only
files allowed to import `@tauri-apps/*` are `api/tauri.ts` and `api/bridges.test.ts`.

---

## Styling

- CSS Modules only, imported as `styles from "./X.module.css"`. There is no
  Tailwind, no styled-components, no inline style objects for theming.
- **Colors, spacing, radii, fonts and transitions come from `styles/tokens.css`**
  (`var(--bg-elevated)`, `var(--sp-3)`, `var(--r-md)`, `var(--cat-compute)`, ...).
  Every `.module.css` in the tree uses these variables.
- Dark mode is a token swap on `document.documentElement.dataset.theme` (set by
  `ThemeProvider`), so a component never branches on the theme.
- One hard-coded literal exists today — `rgb(0 0 0 / 0.18)` for the settings
  popover shadow. Do not add a second one; if you need a new shadow, add a token.

---

## Accessibility

Accessible names are **load-bearing**: tests query by role and name, so a missing
label breaks a test rather than merely failing an audit.

- Interactive controls are real `<button>` / `<input>` elements with `type="button"`.
- Labels are Chinese, matching the UI: `aria-label="切换主题"`, `aria-label="阈值设置"`.
- Tabs use `role="tablist"` on the container and `role="tab"` + `aria-selected`
  on each button (`WorkspaceTabs.tsx` and the view switch in `SessionAnalyzerPage.tsx`).
- Live regions: toasts are `role="status"` + `aria-live="polite"` with `<output>`
  (`StatusToast.tsx`); the error boundary is `role="alert"`.

---

## Common Mistakes

- **`min-height`/`grid-template-rows` drift.** `SessionAnalyzerPage.module.css`
  uses `grid-auto-rows` and per-pane `min-height` on purpose. A fixed
  `grid-template-rows: auto auto auto` silently mis-assigns rows when a block is
  added or removed — `SessionAnalyzerPage.layout.test.ts` asserts against it by
  reading the CSS file.
- **Exporting a component as default.** Only `App.tsx` does.
- **Re-declaring native props** on a wrapper instead of spreading them.
- **Adding a shared component before searching `components/`.** The six files there
  already cover the shell.
