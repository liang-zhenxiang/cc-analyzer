import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart } from "./BarChart";

const data = [
  { label: "9/28", value: 100 },
  { label: "9/29", value: 50 },
  { label: "9/30", value: 0 }
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
    expect(first.querySelector("title")?.textContent).toBe("9/28：100 tok");
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

  it("0 值的柱画一根可见的短桩，而不是整根消失", () => {
    // 稀疏数据（30 天里只有 2 天有活动）时，高 0 的柱与「图表坏了」无法区分。
    render(
      <BarChart
        data={[
          { label: "9/28", value: 1_000 },
          { label: "9/29", value: 0 }
        ]}
        ariaLabel="趋势"
      />
    );

    const [tall, zero] = Array.from(
      screen.getByRole("img", { name: "趋势" }).querySelectorAll("rect")
    ).map((bar) => Number(bar.getAttribute("height")));
    expect(zero).toBeGreaterThan(0);
    expect(zero).toBeLessThan(5);
    expect(tall).toBeGreaterThan(zero);
  });

  it("柱写得宽些：六根柱的间距不再是柱宽的两倍", () => {
    const six = Array.from({ length: 6 }, (_, index) => ({ label: `w${index}`, value: 100 - index }));
    render(<BarChart data={six} ariaLabel="历史计费窗口消耗" height={90} />);

    const bars = Array.from(
      screen.getByRole("img", { name: "历史计费窗口消耗" }).querySelectorAll("rect")
    );
    const width = Number(bars[0].getAttribute("width"));
    const slot = Number(bars[1].getAttribute("x")) - Number(bars[0].getAttribute("x"));
    expect(slot - width).toBeLessThan(width * 2);
  });

  it("轴注说明一根柱代表什么", () => {
    render(
      <BarChart data={data} ariaLabel="趋势" caption="每个柱 = 一个 5 小时计费窗口" />
    );

    expect(screen.getByText("每个柱 = 一个 5 小时计费窗口")).toBeInTheDocument();
  });
});
