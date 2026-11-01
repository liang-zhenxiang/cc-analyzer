import { describe, expect, it } from "vitest";
import { modelSwitchHeatOf } from "./modelSwitchHeat";

describe("modelSwitchHeatOf", () => {
  it("returns null without sessions", () => {
    expect(modelSwitchHeatOf([])).toBeNull();
  });

  it("classifies sessions into never / once / multi", () => {
    const result = modelSwitchHeatOf([
      { models: [] },
      { models: ["a"] },
      { models: ["a", "b"] },
      { models: ["a", "b", "c"] },
      { models: ["a", "b", "c", "d"] }
    ]);
    expect(result).not.toBeNull();
    expect(result!.never).toBe(2);
    expect(result!.once).toBe(1);
    expect(result!.multi).toBe(2);
    expect(result!.switchRate).toBe(3 / 5);
  });

  it("counts every transition, including a return to an earlier model", () => {
    // A→B→A 是两次切换：换回旧模型不是「没换」。
    const result = modelSwitchHeatOf([{ models: ["a", "b", "a"] }]);
    expect(result).toEqual({ never: 0, once: 0, multi: 1, switchRate: 1 });
  });

  it("does not count repeated identical models as switches", () => {
    const result = modelSwitchHeatOf([{ models: ["a", "a", "a"] }]);
    expect(result).toEqual({ never: 1, once: 0, multi: 0, switchRate: 0 });
  });

  it("treats a single model as never switching", () => {
    expect(modelSwitchHeatOf([{ models: ["claude-sonnet-4-5"] }])).toEqual({
      never: 1,
      once: 0,
      multi: 0,
      switchRate: 0
    });
  });

  it("treats an empty model list as never switching", () => {
    expect(modelSwitchHeatOf([{ models: [] }])!.never).toBe(1);
  });

  it("counts about A→B as exactly one switch", () => {
    expect(modelSwitchHeatOf([{ models: ["a", "b"] }])).toEqual({
      never: 0,
      once: 1,
      multi: 0,
      switchRate: 1
    });
  });

  it("computes the switch rate from sessions that switched at least once", () => {
    const result = modelSwitchHeatOf([
      { models: ["a"] },
      { models: ["a", "b"] },
      { models: ["a"] },
      { models: ["a", "b", "c"] }
    ]);
    expect(result!.switchRate).toBe(0.5);
  });
});
