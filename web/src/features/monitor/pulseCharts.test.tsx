import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContextSample } from "../sessions/types";
import type { CompactionAnchor } from "../sessions/contextSeries";
import { ContextCurve, RateCurve } from "./pulseCharts";
import type { CompactionBand, RateBucket } from "./pulseModel";

const NOW = new Date(2026, 8, 24, 12, 5, 0, 0).getTime();

function buckets(count: number, value: (index: number) => number): RateBucket[] {
  return Array.from({ length: count }, (_, index) => ({
    start: NOW - (count - 1 - index) * 60_000,
    tokens: value(index),
    partial: index === count - 1
  }));
}

function samples(values: number[]): ContextSample[] {
  return values.map((contextTokens, index) => ({
    uuid: `s-${index}`,
    timestamp: NOW - (values.length - index) * 60_000,
    contextTokens,
    outputTokens: 0,
    model: "claude-sonnet-4"
  }));
}

describe("RateCurve", () => {
  it("60 桶画 60 根柱，恰好 1 根 data-partial=\"true\"，并带斜纹与「现在」参考线", () => {
    render(<RateCurve buckets={buckets(60, (index) => index * 100)} />);

    expect(document.querySelectorAll('[data-probe="pulse-rate-bar"]').length).toBe(60);
    expect(
      document.querySelectorAll('[data-probe="pulse-rate-bar"][data-partial="true"]').length
    ).toBe(1);
    expect(document.querySelector('[data-probe="pulse-rate-curve"]')).toHaveAttribute(
      "data-bucket-count",
      "60"
    );
    // 未完成那根走斜纹 pattern（三个形状通道之一），参考线也在场。
    expect(document.querySelector("pattern")).not.toBeNull();
    expect(document.querySelector('[data-probe="pulse-rate-now"]')).not.toBeNull();
  });

  it("全 0 时 aria-label 直接说「没有新的 token 记录」，不编造峰值", () => {
    render(<RateCurve buckets={buckets(60, () => 0)} />);
    expect(
      screen.getByRole("img", { name: "近 60 分钟没有新的 token 记录。" })
    ).toBeInTheDocument();
  });

  it("有数据时 aria-label 带峰值、峰值时刻与当前分钟已记录量", () => {
    render(<RateCurve buckets={buckets(60, (index) => (index === 30 ? 2_000 : 10))} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toContain("峰值 2,000");
    expect(img.getAttribute("aria-label")).toContain("当前分钟进行中");
  });
});

describe("ContextCurve", () => {
  const insufficient: CompactionBand = { insufficient: true, n: 0 };
  const band: CompactionBand = { min: 100_000, max: 200_000, n: 3 };
  const noAnchors: CompactionAnchor[] = [];

  it("没有样本时只留一行事实，不画空轴", () => {
    render(<ContextCurve samples={[]} anchors={noAnchors} band={insufficient} />);
    expect(document.querySelector('[data-probe="pulse-context-curve"]')).toBeNull();
    expect(screen.getByText("这个会话还没有可画上下文体量的调用。")).toBeInTheDocument();
  });

  it("参考带样本不足时不画带，脚注给「参考带样本不足（n=…）」", () => {
    render(<ContextCurve samples={samples([1, 2, 3, 4])} anchors={noAnchors} band={insufficient} />);
    expect(document.querySelector('[data-probe="pulse-context-band"]')).toBeNull();
    expect(document.querySelector('[data-probe="pulse-context-note"]')?.textContent).toContain(
      "参考带样本不足（n=0，至少需要 3 次自动压缩）"
    );
  });

  it("n ≥ 3 时画参考带，脚注给区间与最近次数", () => {
    render(<ContextCurve samples={samples([1, 2, 3, 4])} anchors={noAnchors} band={band} />);
    expect(document.querySelector('[data-probe="pulse-context-band"]')).not.toBeNull();
    expect(document.querySelector('[data-probe="pulse-context-note"]')?.textContent).toContain(
      "自动压缩前体量 100,000–200,000（最近 3 次）"
    );
  });

  it("每个断崖一条竖虚线 + 两侧各一个采样方块", () => {
    const anchors: CompactionAnchor[] = [{ eventId: "e1", beforeIndex: 1, afterIndex: 2 }];
    render(<ContextCurve samples={samples([10, 20, 5, 6])} anchors={anchors} band={band} />);
    expect(document.querySelectorAll('[data-probe="pulse-context-cliff"]').length).toBe(1);
    expect(document.querySelectorAll('[data-probe="pulse-context-cliff"] title').length).toBe(1);
  });

  it("单个样本画一个点、不画折线；两个样本才有折线", () => {
    const { container: one } = render(
      <ContextCurve samples={samples([42])} anchors={noAnchors} band={insufficient} />
    );
    expect(one.querySelector("polyline")).toBeNull();
    expect(one.querySelectorAll("rect").length).toBe(1);
    expect(one.querySelector('[data-probe="pulse-context-note"]')?.textContent).toContain(
      "样本不足（n=1）"
    );

    const { container: two } = render(
      <ContextCurve samples={samples([42, 43])} anchors={noAnchors} band={insufficient} />
    );
    expect(two.querySelector("polyline")).not.toBeNull();
    expect(two.querySelector('[data-probe="pulse-context-note"]')?.textContent).toContain(
      "样本不足（n=2）"
    );
  });
});
