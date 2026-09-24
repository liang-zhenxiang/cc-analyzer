import { useCallback, useRef, useState } from "react";

/**
 * Caches the heights a virtualised list actually rendered.
 *
 * Rows are measured through a ref callback, so the offsets can use real
 * heights for everything already on screen and fall back to an estimate for
 * rows that have never been rendered. Re-renders only happen when a height
 * changes, which keeps the measuring loop from feeding itself.
 */
export function useMeasuredRowHeights(fallbackHeight: number) {
  const heights = useRef(new Map<string, number>());
  const extras = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);

  const record = useCallback((store: Map<string, number>, key: string, element: HTMLElement | null) => {
    if (!element) return;
    const height = Math.round(element.getBoundingClientRect().height);
    if (height <= 0) return;
    const previous = store.get(key);
    if (previous !== undefined && Math.abs(previous - height) < 2) return;
    store.set(key, height);
    setVersion((value) => value + 1);
  }, []);

  /** Height of a normal row. */
  const measureRow = useCallback(
    (key: string, element: HTMLElement | null) => record(heights.current, key, element),
    [record]
  );

  /** Height of an extra panel a row can add (kept out of the row average). */
  const measureExtra = useCallback(
    (key: string, element: HTMLElement | null) => record(extras.current, key, element),
    [record]
  );

  // Rows that have never been rendered use the average of what has been
  // measured, which converges on the real row height after one screenful.
  const estimate =
    heights.current.size > 0
      ? [...heights.current.values()].reduce((total, height) => total + height, 0) /
        heights.current.size
      : fallbackHeight;

  return {
    extras: extras.current,
    heights: heights.current,
    estimate,
    measureExtra,
    measureRow,
    version
  };
}
