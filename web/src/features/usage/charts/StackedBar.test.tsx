import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StackedBar } from "./StackedBar";

const data = [
  { label: "claude-sonnet-4-5", value: 60 },
  { label: "claude-opus-4-1", value: 30 },
  { label: "claude-haiku-4-5", value: 10 }
];

describe("StackedBar", () => {
  it("renders one segment per data point with a role and accessible name", () => {
    render(<StackedBar data={data} ariaLabel="按模型占比" />);

    const svg = screen.getByRole("img", { name: "按模型占比" });
    expect(svg.querySelectorAll("rect")).toHaveLength(3);
  });

  it("sizes segments proportionally to the total", () => {
    render(<StackedBar data={data} ariaLabel="按模型占比" />);

    const widths = Array.from(screen.getByRole("img", { name: "按模型占比" }).querySelectorAll("rect")).map(
      (rect) => Number.parseFloat(rect.getAttribute("width") ?? "0")
    );
    expect(widths[0]).toBeCloseTo(widths[1] * 2, 5);
    expect(widths[0]).toBeCloseTo(widths[2] * 6, 5);
  });

  it("carries a tooltip per segment", () => {
    render(<StackedBar data={data} ariaLabel="按模型占比" formatValue={(value) => `${value}%`} />);

    const titles = Array.from(screen.getByRole("img", { name: "按模型占比" }).querySelectorAll("rect > title")).map(
      (title) => title.textContent
    );
    expect(titles).toContain("claude-opus-4-1：30%");
  });

  it("shows empty-state copy for no data and for an all-zero total", () => {
    const { rerender } = render(<StackedBar data={[]} ariaLabel="按模型占比" emptyText="暂无模型用量" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("暂无模型用量")).toBeInTheDocument();

    rerender(<StackedBar data={[{ label: "m", value: 0 }]} ariaLabel="按模型占比" emptyText="暂无模型用量" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("暂无模型用量")).toBeInTheDocument();
  });
});
