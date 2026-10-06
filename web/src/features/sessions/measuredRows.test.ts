import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { useMeasuredRowHeights } from "./measuredRows";

/** `record` 只读 `.height`，所以带一个够用的假元素即可。 */
function elementOfHeight(height: number): HTMLElement {
  return { getBoundingClientRect: () => ({ height }) } as unknown as HTMLElement;
}

test("clears the measured heights when the reset key changes", () => {
  const { result, rerender } = renderHook(
    ({ resetKey }: { resetKey: unknown }) => useMeasuredRowHeights(30, resetKey),
    { initialProps: { resetKey: 1 } }
  );

  act(() => result.current.measureRow("a", elementOfHeight(30)));
  expect(result.current.heights.size).toBe(1);

  const before = result.current.version;
  rerender({ resetKey: 2 });
  expect(result.current.heights.size).toBe(0);
  expect(result.current.version).toBeGreaterThan(before);
});

test("does not clear the cache while the reset key stays the same", () => {
  const { result, rerender } = renderHook(
    ({ resetKey }: { resetKey: unknown }) => useMeasuredRowHeights(30, resetKey),
    { initialProps: { resetKey: "1" } }
  );

  act(() => result.current.measureRow("a", elementOfHeight(30)));
  rerender({ resetKey: "1" });
  expect(result.current.heights.size).toBe(1);
});
