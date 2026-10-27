import { describe, expect, it } from "vitest";
import { buildScrubber, type ScrubberEvent } from "./sessionScrubber";
import type { ContextSample } from "./types";

/** 固定时间基：2026-10-10 09:00 本地。全部断言可读、无「现在」依赖。 */
const BASE = new Date(2026, 9, 10, 9, 0).getTime();
const MIN = 60_000;

let seq = 0;
function sample(atMs: number, contextTokens: number): ContextSample {
  seq += 1;
  return {
    uuid: `s${seq}`,
    timestamp: atMs,
    contextTokens,
    outputTokens: 0,
    model: null
  };
}

function event(atMs: number, label: string): ScrubberEvent {
  return { timestamp: atMs, label };
}

describe("sessionScrubber · 轴范围", () => {
  it("空输入：start/end 均为 0，positionAt 恒 0，nearestEvent/watermarkAt 均 null", () => {
    const model = buildScrubber([], []);
    expect(model.start).toBe(0);
    expect(model.end).toBe(0);
    expect(model.positionAt(BASE)).toBe(0);
    expect(model.nearestEvent(BASE)).toBeNull();
    expect(model.watermarkAt(BASE)).toBeNull();
  });

  it("只有 events 没有 samples：轴由 events 撑起，watermarkAt 恒 null", () => {
    const model = buildScrubber([], [event(BASE, "a"), event(BASE + 10 * MIN, "b")]);
    expect(model.start).toBe(BASE);
    expect(model.end).toBe(BASE + 10 * MIN);
    expect(model.watermarkAt(BASE + 5 * MIN)).toBeNull();
    expect(model.nearestEvent(BASE + 5 * MIN)!.label).toBe("a");
  });

  it("轴取 samples ∪ events 的 min/max：事件可以落在采样区间之外", () => {
    const model = buildScrubber(
      [sample(BASE + 5 * MIN, 1000)],
      [event(BASE, "start"), event(BASE + 10 * MIN, "end")]
    );
    expect(model.start).toBe(BASE);
    expect(model.end).toBe(BASE + 10 * MIN);
  });
});

describe("sessionScrubber · positionAt", () => {
  it("线性映射：中点 0.5、两端 0 与 1、轴外夹取", () => {
    const model = buildScrubber([sample(BASE, 100), sample(BASE + 10 * MIN, 200)], []);
    expect(model.positionAt(BASE)).toBe(0);
    expect(model.positionAt(BASE + 5 * MIN)).toBeCloseTo(0.5, 12);
    expect(model.positionAt(BASE + 10 * MIN)).toBe(1);
    expect(model.positionAt(BASE - 5 * MIN)).toBe(0);
    expect(model.positionAt(BASE + 99 * MIN)).toBe(1);
  });

  it("单点（零跨度）：positionAt 恒 0，任何输入都不产生 NaN", () => {
    const model = buildScrubber([sample(BASE, 42)], []);
    expect(model.start).toBe(BASE);
    expect(model.end).toBe(BASE);
    expect(model.positionAt(BASE)).toBe(0);
    expect(model.positionAt(BASE + 1000)).toBe(0);
    expect(Number.isFinite(model.positionAt(BASE))).toBe(true);
  });
});

describe("sessionScrubber · nearestEvent", () => {
  const events = [event(BASE, "e0"), event(BASE + 10 * MIN, "e1"), event(BASE + 20 * MIN, "e2")];

  it("空表 null；普通命中取最近", () => {
    expect(buildScrubber([], []).nearestEvent(BASE)).toBeNull();
    const model = buildScrubber([], events);
    expect(model.nearestEvent(BASE + 3 * MIN)!.label).toBe("e0");
    expect(model.nearestEvent(BASE + 8 * MIN)!.label).toBe("e1");
    expect(model.nearestEvent(BASE + 17 * MIN)!.label).toBe("e2");
  });

  it("realMs 早于全部事件 → 首个；晚于全部 → 末个", () => {
    const model = buildScrubber([], events);
    expect(model.nearestEvent(BASE - 5 * MIN)!.label).toBe("e0");
    expect(model.nearestEvent(BASE - 5 * MIN)!.index).toBe(0);
    expect(model.nearestEvent(BASE + 99 * MIN)!.label).toBe("e2");
    expect(model.nearestEvent(BASE + 99 * MIN)!.index).toBe(2);
  });

  it("距离并列（恰在两事件正中）取更早的那个", () => {
    const model = buildScrubber([], events);
    const mid = BASE + 5 * MIN; // 距 e0 与 e1 各 5 分钟
    expect(model.nearestEvent(mid)!.label).toBe("e0");
    expect(model.nearestEvent(mid)!.index).toBe(0);
  });

  it("恰好落在某事件时刻 → 该事件自身（距离 0）", () => {
    const model = buildScrubber([], events);
    expect(model.nearestEvent(BASE + 10 * MIN)!.label).toBe("e1");
  });

  it("乱序输入先排序：结果与顺序无关，index 按升序表计", () => {
    const shuffled = [events[2], events[0], events[1]];
    const model = buildScrubber([], shuffled);
    expect(model.nearestEvent(BASE + 3 * MIN)!.label).toBe("e0");
    expect(model.nearestEvent(BASE + 3 * MIN)!.index).toBe(0);
  });
});

describe("sessionScrubber · watermarkAt", () => {
  const samples = [
    sample(BASE, 1000),
    sample(BASE + 10 * MIN, 2000),
    sample(BASE + 20 * MIN, 3000)
  ];

  it("早于首个 sample → null（还没有任何水位，0 会冒充「上下文为空」）", () => {
    const model = buildScrubber(samples, []);
    expect(model.watermarkAt(BASE - 1)).toBeNull();
  });

  it("恰好等于某 sample 时刻 → 取该 sample（含端点，不前瞻）", () => {
    const model = buildScrubber(samples, []);
    expect(model.watermarkAt(BASE)).toBe(1000);
    expect(model.watermarkAt(BASE + 10 * MIN)).toBe(2000);
    expect(model.watermarkAt(BASE + 20 * MIN)).toBe(3000);
  });

  it("两 sample 之间 → 前一个的 contextTokens（「当时的」水位）", () => {
    const model = buildScrubber(samples, []);
    expect(model.watermarkAt(BASE + 5 * MIN)).toBe(1000);
    expect(model.watermarkAt(BASE + 15 * MIN)).toBe(2000);
  });

  it("晚于全部 sample → 最后一个的水位", () => {
    const model = buildScrubber(samples, []);
    expect(model.watermarkAt(BASE + 99 * MIN)).toBe(3000);
  });

  it("乱序 samples 先排序再找水位", () => {
    const shuffled = [samples[2], samples[0], samples[1]];
    const model = buildScrubber(shuffled, []);
    expect(model.watermarkAt(BASE + 15 * MIN)).toBe(2000);
  });
});
