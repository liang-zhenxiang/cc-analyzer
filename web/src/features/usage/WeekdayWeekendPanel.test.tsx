import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { WeekdayWeekendPanel } from "./WeekdayWeekendPanel";

/** 2026-10-09 是周五；10-10 周六、10-11 周日。 */
const FRIDAY = new Date(2026, 9, 9, 10, 0, 0).getTime();
const SATURDAY = new Date(2026, 9, 10, 11, 0, 0).getTime();
const NOW = new Date(2026, 9, 11, 12, 0, 0).getTime();
const HOUR = 3_600_000;

let seq = 0;
function record(at: number, tokens?: number): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...(tokens === undefined ? {} : { usage: { inputTokens: tokens } })
  };
}

function input(records: SessionRecord[]): UsageSessionInput {
  return { projectLabel: "p", records };
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-probe="workday-row"]')];
}

describe("WeekdayWeekendPanel（I2 工作日 vs 周末）", () => {
  it("两行对照：token、会话数、活跃小时与日均都按模型给的值渲染", () => {
    render(
      <WeekdayWeekendPanel
        inputs={[
          input([record(FRIDAY, 600), record(FRIDAY + HOUR, 400)]),
          input([record(SATURDAY, 200)])
        ]}
        days={7}
        now={NOW}
      />
    );

    const [weekday, weekend] = rows();
    expect(weekday?.getAttribute("data-group")).toBe("weekday");
    expect(weekday?.textContent).toContain("1,000");
    expect(weekend?.textContent).toContain("200");
    // 周六只有一条记录：活跃小时 1，日均 = 1 / 2 天 = 0.5。
    expect(weekend?.textContent).toContain("0.5");
    expect(screen.getByText(/分母固定 5 天 \/ 2 天/)).toBeInTheDocument();
  });

  it("某侧没有记录时写「—」，并在脚注点名，而不是印 0", () => {
    render(
      <WeekdayWeekendPanel inputs={[input([record(FRIDAY, 800)])]} days={7} now={NOW} />
    );

    const [, weekend] = rows();
    // token / 活跃小时 / 日均三格写「—」；会话数是真的 0，照实印。
    const cells = [...(weekend?.querySelectorAll("td") ?? [])].map((cell) => cell.textContent);
    expect(cells).toEqual(["—", "0", "—", "—"]);
    expect(screen.getByText(/过去 7 天没有周末记录。/)).toBeInTheDocument();
  });

  it("窗口内没有会话时整卡一句空态，不画空表", () => {
    render(<WeekdayWeekendPanel inputs={[]} days={7} now={NOW} />);

    expect(screen.getByText("这一窗没有可对照的会话")).toBeInTheDocument();
    expect(document.querySelector('[data-probe="workday-split"]')).toBeNull();
  });

  it("窗口外的记录不参与：30 天前的周五不算进本周对照", () => {
    const old = FRIDAY - 30 * 24 * HOUR;
    render(
      <WeekdayWeekendPanel inputs={[input([record(old, 999)])]} days={7} now={NOW} />
    );

    expect(screen.getByText("这一窗没有可对照的会话")).toBeInTheDocument();
  });
});
