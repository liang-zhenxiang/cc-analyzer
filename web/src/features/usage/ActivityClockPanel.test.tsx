import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildActivityClock } from "./activityClock";
import { ActivityClockPanel } from "./ActivityClockPanel";

/**
 * 组件直挂：24 扇区里只画有量的格子、浓度四档、峰值标记与圆心时间、空态。
 * 夹具走 `buildActivityClock`，与热力图共用同一份 7×24 网格。
 */

function grid(entries: Array<[number, number]>): number[][] {
  const row = Array.from({ length: 24 }, () => 0);
  for (const [hour, value] of entries) row[hour] = value;
  return [row];
}

function clockOf(entries: Array<[number, number]>) {
  return buildActivityClock(grid(entries));
}

function wedges(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-clock-hour]"));
}

describe("ActivityClockPanel", () => {
  it("draws one sector per non-empty hour and describes the peak", () => {
    const container = render(
      <ActivityClockPanel clock={clockOf([[3, 3], [9, 6], [15, 9], [21, 12]])} />
    ).container;

    expect(screen.getByRole("img", { name: "活跃时段时钟：峰值 21:00" })).toBeInTheDocument();
    expect(wedges(container).map((wedge) => wedge.getAttribute("data-clock-hour"))).toEqual([
      "3",
      "9",
      "15",
      "21"
    ]);
    expect(screen.getByText("按小时聚合 · 半径 = 相对总量")).toBeInTheDocument();
  });

  it("escalates the four levels with relative magnitude", () => {
    const container = render(
      <ActivityClockPanel clock={clockOf([[3, 3], [9, 6], [15, 9], [21, 12]])} />
    ).container;

    expect(wedges(container).map((wedge) => wedge.getAttribute("data-level"))).toEqual([
      "1",
      "2",
      "3",
      "4"
    ]);
  });

  it("marks exactly one peak hour, with its time on the hub and in the sector title", () => {
    const container = render(
      <ActivityClockPanel clock={clockOf([[3, 3], [9, 6], [15, 9], [21, 12]])} />
    ).container;

    const peaks = wedges(container).filter((wedge) => wedge.getAttribute("data-peak") === "true");
    expect(peaks).toHaveLength(1);
    expect(peaks[0].getAttribute("data-clock-hour")).toBe("21");
    expect(peaks[0].querySelector("title")?.textContent).toBe("21:00 · 12 条");
    expect(screen.getByText("峰值")).toBeInTheDocument();
    expect(screen.getByText("21:00")).toBeInTheDocument();
  });

  it("prints quarter-day labels around the dial", () => {
    render(<ActivityClockPanel clock={clockOf([[9, 1]])} />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getByText("6:00")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getByText("18:00")).toBeInTheDocument();
  });

  it("skips empty hours instead of drawing zero-radius slivers", () => {
    const container = render(<ActivityClockPanel clock={clockOf([[9, 5]])} />).container;
    expect(wedges(container)).toHaveLength(1);
    expect(wedges(container)[0].getAttribute("data-level")).toBe("4");
  });

  it("falls back to an empty state when nothing happened in the window", () => {
    const container = render(<ActivityClockPanel clock={buildActivityClock([])} />).container;
    expect(screen.getByText("没有可画的时段")).toBeInTheDocument();
    expect(wedges(container)).toHaveLength(0);
    expect(container.querySelector('[data-probe="clock-root"]')).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
