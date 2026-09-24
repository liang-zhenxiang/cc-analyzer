import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useViewportCap } from "./useViewportCap";

function Capped({ minHeight, gutter }: { minHeight?: number; gutter?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useViewportCap(ref, { minHeight, gutter });
  return <div ref={ref} data-testid="capped" />;
}

describe("useViewportCap", () => {
  it("caps the element to the rest of the viewport", () => {
    const { getByTestId } = render(<Capped />);

    // jsdom reports a zero top offset and a 768px window.
    expect(getByTestId("capped").style.maxHeight).toBe(`${window.innerHeight - 24}px`);
  });

  it("re-applies the cap when the window resizes", () => {
    const original = window.innerHeight;
    try {
      window.innerHeight = 1200;
      const { getByTestId } = render(<Capped minHeight={900} />);
      const element = getByTestId("capped");
      expect(element.style.maxHeight).toBe("1176px");

      window.innerHeight = 1000;
      window.dispatchEvent(new Event("resize"));
      expect(element.style.maxHeight).toBe("976px");
    } finally {
      window.innerHeight = original;
    }
  });

  it("never caps below the minimum height", () => {
    const original = window.innerHeight;
    try {
      window.innerHeight = 300;
      const { getByTestId } = render(<Capped minHeight={400} />);

      expect(getByTestId("capped").style.maxHeight).toBe("400px");
    } finally {
      window.innerHeight = original;
    }
  });

  it("uses the configured gutter", () => {
    const { getByTestId } = render(<Capped gutter={100} />);

    expect(getByTestId("capped").style.maxHeight).toBe(`${window.innerHeight - 100}px`);
  });
});
