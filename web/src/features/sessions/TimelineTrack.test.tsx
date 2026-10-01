import { describe, expect, it } from "vitest";
import { blockWidthShare } from "./TimelineTrack";

describe("blockWidthShare（块宽按时长映射）", () => {
  it("时长为轨道跨度的 10% → 10% 宽", () => {
    expect(blockWidthShare(1_000, 10_000)).toBeCloseTo(0.1);
  });

  it("6 秒与 30 毫秒在同一条 60 秒轨道上不再同宽", () => {
    const span = 60_000;
    expect(blockWidthShare(6_000, span)).toBeCloseTo(0.1);
    expect(blockWidthShare(30, span)).toBeCloseTo(0.0005);
  });

  it("超长记录封顶 15%——单条挂起不能吞掉整条轨道", () => {
    expect(blockWidthShare(120_000, 60_000)).toBe(0.15);
  });

  it("零时长或零跨度 → 0（由 CSS min-width 兜底可见性）", () => {
    expect(blockWidthShare(0, 10_000)).toBe(0);
    expect(blockWidthShare(1_000, 0)).toBe(0);
  });
});
