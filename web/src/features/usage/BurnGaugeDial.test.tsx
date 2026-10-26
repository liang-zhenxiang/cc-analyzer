import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BurnGaugeDial, GAUGE_BAND_LABEL } from "./BurnGaugeDial";

describe("BurnGaugeDial（D6 燃烧速度表）", () => {
  it("按 projectedPct 画填充弧，指针落在半圆内侧", () => {
    const { container } = render(<BurnGaugeDial projectedPct={50} band="cruising" />);

    const svg = container.querySelector('[data-probe="burn-gauge"]') as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox", "0 0 72 40");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // 轨道 + 填充弧：50% 时两段都在。
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(GAUGE_BAND_LABEL.cruising).toBe("巡航");
  });

  it("0% 时只画轨道，不画零长度弧", () => {
    const { container } = render(<BurnGaugeDial projectedPct={0} band="quiet" />);
    expect(container.querySelectorAll("path")).toHaveLength(1);
  });

  it("100% 时填充弧走大半圆（large-arc-flag=1）", () => {
    const { container } = render(<BurnGaugeDial projectedPct={100} band="hot" />);
    const fill = container.querySelectorAll("path")[1];
    expect(fill.getAttribute("d")).toContain("A 28 28 0 1 1");
  });
});
