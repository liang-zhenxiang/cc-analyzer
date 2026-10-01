import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HBarChart } from "./HBarChart";

const data = [
  { label: "project-a", value: 100 },
  { label: "project-b", value: 50 },
  { label: "其他", value: 25 }
];

describe("HBarChart", () => {
  it("renders one bar per row with a role and accessible name", () => {
    render(<HBarChart data={data} ariaLabel="按项目用量" />);

    const svg = screen.getByRole("img", { name: "按项目用量" });
    expect(svg.querySelectorAll("rect")).toHaveLength(3);
    expect(svg.textContent).toContain("project-a");
    expect(svg.textContent).toContain("其他");
  });

  it("normalises bar lengths to the maximum value", () => {
    render(<HBarChart data={data} ariaLabel="按项目用量" />);

    const widths = Array.from(screen.getByRole("img", { name: "按项目用量" }).querySelectorAll("rect")).map(
      (rect) => Number.parseFloat(rect.getAttribute("width") ?? "0")
    );
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths[0]).toBeCloseTo(widths[1] * 2, 5);
    expect(widths[1]).toBeCloseTo(widths[2] * 2, 5);
  });

  it("carries a tooltip and formatted value per row", () => {
    render(<HBarChart data={data} ariaLabel="按项目用量" formatValue={(value) => `${value} tk`} />);

    const svg = screen.getByRole("img", { name: "按项目用量" });
    expect(svg.querySelector("rect > title")?.textContent).toBe("project-a：100 tk");
    expect(svg.textContent).toContain("100 tk");
  });

  it("shows empty-state copy instead of an empty SVG", () => {
    render(<HBarChart data={[]} ariaLabel="按项目用量" emptyText="暂无项目用量" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("暂无项目用量")).toBeInTheDocument();
  });
});
