import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DailyTrendChart } from "./DailyTrendChart";
import { buildAnomalyDays, type AnomalyDay } from "./anomalyDays";
import { buildTrendChannel } from "./trendChannel";

function fixture(values: number[]) {
  const daily = values.map((tokens, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    tokens
  }));
  const trend = buildTrendChannel(daily);
  const days = buildAnomalyDays(daily);
  const anomalies: (AnomalyDay | null)[] = days.map((day) => (day.z === null ? null : day));
  const data = values.map((value, index) => ({ label: `9/${index + 1}`, value }));
  return { daily, trend, anomalies, data };
}

function marks(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-probe="anomaly-marks"] > span')
  );
}

describe("DailyTrendChart（E1 + E2）", () => {
  it("不足 7 天：不画均线，图例说明缺的是几天", () => {
    const { trend, anomalies, data } = fixture([1, 1, 1]);
    const { container } = render(
      <DailyTrendChart data={data} trend={trend} anomalies={anomalies} ariaLabel="每日趋势" />
    );

    expect(container.querySelector('[data-probe="trend-ma"]')).toBeNull();
    expect(container.querySelector('[data-probe="trend-forecast"]')).toBeNull();
    expect(container.textContent).toContain("均线需要 7 天数据，当前只有 3 天");
    expect(container.textContent).toContain("外推需要 14 天数据");
  });

  it("7–13 天：均线出现，外推仍未到 14 天", () => {
    const { trend, anomalies, data } = fixture([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const { container } = render(
      <DailyTrendChart data={data} trend={trend} anomalies={anomalies} ariaLabel="每日趋势" />
    );

    expect(container.querySelector('[data-probe="trend-ma"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="trend-forecast"]')).toBeNull();
    expect(container.textContent).toContain("实线＝7 天移动平均");
    expect(container.textContent).toContain("外推需要 14 天数据");
  });

  it("满 14 天：两条线都在，图例是一整行", () => {
    const values = Array.from({ length: 16 }, (_, index) => 100 + index * 10);
    const { trend, anomalies, data } = fixture(values);
    const { container } = render(
      <DailyTrendChart data={data} trend={trend} anomalies={anomalies} ariaLabel="每日趋势" />
    );

    const ma = container.querySelector('[data-probe="trend-ma"]');
    const forecast = container.querySelector('[data-probe="trend-forecast"]');
    expect(ma?.getAttribute("points")?.split(" ")).toHaveLength(16 - 6);
    expect(forecast?.getAttribute("points")?.split(" ").length).toBeGreaterThan(2);
    expect(container.textContent).toContain("实线＝7 天移动平均 · 虚线＝按最近 14 天外推");
  });

  it("异常日：只给 spike/dip 画标记，title 写明 z 值", () => {
    // A single spike after a flat week: z is large and positive.
    const values = [100, 120, 90, 110, 95, 105, 100, 4000];
    const { trend, anomalies, data } = fixture(values);
    const { container } = render(
      <DailyTrendChart data={data} trend={trend} anomalies={anomalies} ariaLabel="每日趋势" />
    );

    const rendered = marks(container);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].className).toContain("spike");
    expect(rendered[0].title).toMatch(/^该日 4,000 tok，相对前 7 天 z=\+[\d.]+$/);
    expect(container.textContent).toContain("▲＝异常日（z ≥ 2）");
  });

  it("没有异常日时图例如实说明，不画标记", () => {
    const values = Array.from({ length: 14 }, (_, index) => 1000 + (index % 2));
    const { trend, anomalies, data } = fixture(values);
    const { container } = render(
      <DailyTrendChart data={data} trend={trend} anomalies={anomalies} ariaLabel="每日趋势" />
    );

    expect(marks(container)).toHaveLength(0);
    expect(container.textContent).toContain("所选范围内没有异常日（|z| ≥ 2）");
  });
});
