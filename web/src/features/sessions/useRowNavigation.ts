import { useCallback, useState } from "react";

/**
 * Shared row-level keyboard navigation for the three data tables
 * (RecordTable / LogView / TreeView). One implementation instead of three
 * copies — the critique's lesson was that visually identical hand-copied
 * patterns drift; the same applies to behavior.
 *
 * Rows are roving-tabindex: exactly the active row is tabbable, ↑↓/Home/End
 * move it, Enter/Space activate it. The owning table supplies `focusRow`
 * (rows are virtualized, so the hook cannot hold refs itself) and
 * `onActivate`, which is whatever a mouse click on that row already does.
 */
export type RowNavigationOptions = {
  count: number;
  onActivate: (index: number) => void;
  focusRow: (index: number) => void;
};

export function useRowNavigation({ count, onActivate, focusRow }: RowNavigationOptions) {
  const [activeIndex, setActiveIndex] = useState(0);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (count <= 0) return;
      const key = event.key;
      let next: number | null = null;
      if (key === "ArrowDown") next = Math.min(activeIndex + 1, count - 1);
      else if (key === "ArrowUp") next = Math.max(activeIndex - 1, 0);
      else if (key === "Home") next = 0;
      else if (key === "End") next = count - 1;
      else if (key === "Enter" || key === " ") {
        event.preventDefault();
        onActivate(activeIndex);
        return;
      }
      if (next === null || next === activeIndex) return;
      event.preventDefault();
      setActiveIndex(next);
      focusRow(next);
    },
    [activeIndex, count, focusRow, onActivate]
  );

  return { activeIndex, setActiveIndex, onKeyDown };
}

/**
 * The `focusRow` implementation every table uses: rows carry
 * `data-row-index`, the scoping root keeps the query off the document.
 */
export function focusRowIn(
  root: HTMLElement | null,
  selector: string,
  index: number
): void {
  root?.querySelector<HTMLElement>(`${selector}[data-row-index="${index}"]`)?.focus();
}
