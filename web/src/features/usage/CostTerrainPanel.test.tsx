import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { CostTerrainPanel } from "./CostTerrainPanel";
import type { UsageSessionInput } from "./usageAggregations";

/** 本地周四中午：7 天窗口。 */
const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();

function at(month: number, day: number, hour: number): number {
  return new Date(2026, month, day, hour, 0, 0).getTime();
}

function record(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "r",
    fullId: "r",
    kind: "assistant",
    timestamp: NOW,
    durationMs: 0,
    text: "",
    isError: false,
    raw: null,
    ...partial
  };
}

function inputsFixture(): UsageSessionInput[] {
  return [
    {
      projectLabel: "-repo-alpha",
      records: [
        record({
          id: "monday-peak",
          timestamp: at(9, 26, 14),
          model: "claude-sonnet-4-5-20250929",
          usage: { inputTokens: 2_000_000 }
        }),
        record({
          id: "monday-second",
          timestamp: at(9, 26, 15),
          model: "claude-sonnet-4-5-20250929",
          usage: { inputTokens: 1_000_000 }
        }),
        record({
          id: "unpriced",
          timestamp: at(9, 29, 9),
          model: "vendor-model",
          usage: { inputTokens: 10_000_000 }
        })
      ]
    }
  ];
}

describe("CostTerrainPanel", () => {
  it("renders the panel title and a descriptive image with the peak in its name", () => {
    const container = render(
      <CostTerrainPanel inputs={inputsFixture()} days={7} now={NOW} />
    ).container;

    expect(screen.getByRole("heading", { name: "成本地形", level: 3 })).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "成本地形：近 7 天估算成本最集中在周一 14 时，约 $6.00；1 个小时因未定价模型未计入。"
      })
    ).toBeInTheDocument();
    expect(container.querySelector('[data-probe="lab-terrain"]')).not.toBeNull();
  });

  it("keeps the peak annotation and the cost legend permanently visible", () => {
    const container = render(
      <CostTerrainPanel inputs={inputsFixture()} days={7} now={NOW} />
    ).container;

    expect(screen.getByText("一 14 时 · $6.00")).toBeInTheDocument();
    expect(screen.getByText("估算成本 / 小时")).toBeInTheDocument();
    expect(container.querySelector('[data-terrain-peak="true"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-terrain-contour]").length).toBeGreaterThan(0);
  });

  it("titles each cell with its weekday, hour, cost and share", () => {
    const container = render(
      <CostTerrainPanel inputs={inputsFixture()} days={7} now={NOW} />
    ).container;

    const cell = container.querySelector('[data-terrain-cell="0-14"]');
    expect(cell?.querySelector("title")?.textContent).toBe(
      "周一 14 时 · $6.00 · 占本窗口成本 66.7%"
    );
    const empty = container.querySelector('[data-terrain-cell="2-4"]');
    expect(empty?.querySelector("title")?.textContent).toBe("周三 4 时 · 无消耗");
  });

  it("outlines the hovered cell and clears it on leave", () => {
    const container = render(
      <CostTerrainPanel inputs={inputsFixture()} days={7} now={NOW} />
    ).container;
    const cell = container.querySelector<SVGRectElement>('[data-terrain-cell="0-14"]');

    fireEvent.mouseEnter(cell as SVGRectElement);
    expect(cell?.getAttribute("data-terrain-hovered")).toBe("true");
    fireEvent.mouseLeave(cell as SVGRectElement);
    expect(cell?.getAttribute("data-terrain-hovered")).toBeNull();
  });

  it("reports unpriced hours in the footnote instead of filling them with zero", () => {
    render(<CostTerrainPanel inputs={inputsFixture()} days={7} now={NOW} />);
    expect(screen.getByText(/未定价模型的小时不计入，共 1 小时受影响/)).toBeInTheDocument();
  });

  it("falls back to an inline empty state when nothing can be priced", () => {
    const container = render(
      <CostTerrainPanel
        inputs={[
          {
            projectLabel: "-repo-alpha",
            records: [
              record({
                id: "unpriced",
                timestamp: at(9, 26, 14),
                model: "vendor-model",
                usage: { inputTokens: 1_000_000 }
              })
            ]
          }
        ]}
        days={7}
        now={NOW}
      />
    ).container;

    expect(screen.getByText("所选范围内没有可估算的成本")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /成本地形/ })).toBeNull();
    expect(container.querySelector('[data-probe="lab-terrain"]')).not.toBeNull();
  });
});
