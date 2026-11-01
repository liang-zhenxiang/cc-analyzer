import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { HourlyTokens } from "./cutoffProjection";
import { CutoffPanel } from "./CutoffPanel";

/** 9 点 1k、17 点 3k、22 点 6k，其余为 0：三个可分辨的砍点。 */
function hourly(): HourlyTokens[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    tokens: hour === 9 ? 1_000 : hour === 17 ? 3_000 : hour === 22 ? 6_000 : 0
  }));
}

describe("CutoffPanel", () => {
  it("says the session has no hourly readings instead of printing zeros", () => {
    render(<CutoffPanel days={7} sampleDays={0} />);

    expect(screen.getByText("这条会话没有逐小时读数")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByText(/0\.0%/)).toBeNull();
  });

  it("shows the failed-aggregation state when the distribution is empty", () => {
    render(<CutoffPanel hourlyTokens={[]} days={7} sampleDays={0} />);

    expect(screen.getByText("小时分布算不出来，先刷新试试")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("refuses to project from fewer than three days of readings", () => {
    render(<CutoffPanel hourlyTokens={hourly()} days={7} sampleDays={2} />);

    expect(
      screen.getByText("过去 7 天只有 2 天有逐小时读数，先攒够 3 天再看推演")
    ).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("defaults to 17:00 and shows kept, cut and share for that cut-off", () => {
    render(<CutoffPanel hourlyTokens={hourly()} days={7} sampleDays={5} />);

    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("min")).toBe("1");
    expect(slider.getAttribute("max")).toBe("24");
    expect((slider as HTMLInputElement).value).toBe("17");
    expect(slider.getAttribute("aria-valuetext")).toBe("每天 17 点收工");
    expect(screen.getByText("17:00")).toBeTruthy();

    const dl = document.querySelector('[data-probe="cutoff-result"]');
    expect(dl?.textContent).toBe("保留 tokens1,000会少用9,000占总用量90.0%");
  });

  it("turns the last notch into 不收工 and keeps every token", () => {
    render(<CutoffPanel hourlyTokens={hourly()} days={30} sampleDays={12} />);

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "24" } });

    expect(screen.getByText("不收工")).toBeTruthy();
    expect(slider.getAttribute("aria-valuetext")).toBe("不收工");
    const dl = document.querySelector('[data-probe="cutoff-result"]');
    expect(dl?.textContent).toBe("保留 tokens10,000会少用0占总用量0.0%");
    expect(
      screen.getByText("按过去 30 天「每小时 token 分布」推演，不是预测；预测不到的时段按 0 计。")
    ).toBeTruthy();
  });

  it("disables the slider while a refresh is aggregating the distribution", () => {
    render(<CutoffPanel hourlyTokens={hourly()} days={7} sampleDays={5} scanning />);

    expect((screen.getByRole("slider") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("正在汇总小时分布")).toBeTruthy();
  });
});
