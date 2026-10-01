import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart } from "./BarChart";

const data = [
  { label: "9-28", value: 100 },
  { label: "9-29", value: 50 },
  { label: "9-30", value: 0 }
];

describe("BarChart", () => {
  it("renders one bar per data point with a role and accessible name", () => {
    render(<BarChart data={data} ariaLabel="每日 Token 消耗" />);

    const svg = screen.getByRole("img", { name: "每日 Token 消耗" });
    expect(svg.querySelectorAll("rect")).toHaveLength(3);
  });

  it("gives every bar a tooltip with its label and formatted value", () => {
    render(<BarChart data={data} ariaLabel="趋势" formatValue={(value) => `${value} tok`} />);

    const [first] = screen.getByRole("img", { name: "趋势" }).querySelectorAll("rect");
    expect(first.querySelector("title")?.textContent).toBe("9-28：100 tok");
  });

  it("draws gridlines with tick labels, the baseline strongest", () => {
    render(<BarChart data={data} ariaLabel="趋势" />);

    const svg = screen.getByRole("img", { name: "趋势" });
    expect(svg.querySelectorAll("line").length).toBeGreaterThanOrEqual(4);
    expect(svg.textContent).toContain("100");
    expect(svg.textContent).toContain("0");
  });

  it("shows empty-state copy instead of an empty SVG", () => {
    render(<BarChart data={[]} ariaLabel="趋势" emptyText="还没有可统计的会话" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("还没有可统计的会话")).toBeInTheDocument();
  });
});
