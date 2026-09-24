import { useLayoutEffect, type RefObject } from "react";

/**
 * Caps an element to the space left below it in the viewport.
 *
 * The analyzer page grows with its content, so a pane inside it would stretch
 * the whole page instead of scrolling — and a list that cannot scroll can never
 * show more than its first screen. Re-applies on window resize and whenever the
 * element's parent changes size (the blocks above it can wrap).
 */
export function useViewportCap(
  ref: RefObject<HTMLElement | null>,
  { minHeight = 240, gutter = 24 }: { minHeight?: number; gutter?: number } = {}
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const apply = () => {
      const top = element.getBoundingClientRect().top;
      element.style.maxHeight = `${Math.max(minHeight, globalThis.innerHeight - top - gutter)}px`;
    };

    apply();
    window.addEventListener("resize", apply);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    if (observer && element.parentElement) observer.observe(element.parentElement);
    return () => {
      window.removeEventListener("resize", apply);
      observer?.disconnect();
    };
  }, [gutter, minHeight, ref]);
}
