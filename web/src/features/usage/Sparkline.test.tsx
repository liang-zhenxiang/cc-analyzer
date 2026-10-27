import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline（E10）", () => {
  it("0 天 / 1 天都不渲染：两天的距离才是走势", () => {
    const { container: empty } = render(<Sparkline values={[]} />);
    expect(empty.querySelector("svg")).toBeNull();
    const { container: single } = render(<Sparkline values={[42]} />);
    expect(single.querySelector("svg")).toBeNull();
  });

  it("多点：一条折线，点数与输入一致且对读屏隐藏", () => {
    const { container } = render(<Sparkline values={[1, 5, 3]} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("data-probe")).toBe("kpi-sparkline");
    const points = svg?.querySelector("polyline")?.getAttribute("points") ?? "";
    expect(points.split(" ")).toHaveLength(3);
  });

  it("全平序列画中线，不把「没变」画成掉到底", () => {
    const { container } = render(<Sparkline values={[7, 7, 7]} />);
    expect(container.querySelector("polyline")).toBeNull();
    const line = container.querySelector("line");
    expect(line?.getAttribute("y1")).toBe("7");
    expect(line?.getAttribute("y2")).toBe("7");
  });
});
