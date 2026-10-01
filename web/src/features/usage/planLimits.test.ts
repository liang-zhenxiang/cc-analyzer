import { describe, expect, it } from "vitest";
import { parsePlanSelection } from "./planLimits";

describe("parsePlanSelection（持久化 JSON 不可信）", () => {
  it("合法预设 id → 对应限额", () => {
    expect(parsePlanSelection({ id: "pro" })).toEqual({ id: "pro", limitTokens: 19_000 });
    expect(parsePlanSelection({ id: "max5" })).toEqual({ id: "max5", limitTokens: 88_000 });
  });

  it("none → 无分母（只看消耗，不算百分比）", () => {
    expect(parsePlanSelection({ id: "none" })).toEqual({ id: "none", limitTokens: null });
  });

  it("custom 带正数 → 自定义限额；缺省/非法 → null", () => {
    expect(parsePlanSelection({ id: "custom", customLimitTokens: 12345 })).toEqual({
      id: "custom",
      limitTokens: 12345
    });
    expect(parsePlanSelection({ id: "custom" })).toEqual({ id: "custom", limitTokens: null });
    expect(parsePlanSelection({ id: "custom", customLimitTokens: -5 })).toEqual({
      id: "custom",
      limitTokens: null
    });
  });

  it("未知 id / 非对象 / 空输入 → 回退 none", () => {
    expect(parsePlanSelection({ id: "ultra" })).toEqual({ id: "none", limitTokens: null });
    expect(parsePlanSelection("junk")).toEqual({ id: "none", limitTokens: null });
    expect(parsePlanSelection(null)).toEqual({ id: "none", limitTokens: null });
  });

  it("预设 id 忽略无关的 custom 字段（预设值不被覆盖）", () => {
    expect(parsePlanSelection({ id: "pro", customLimitTokens: 999 })).toEqual({
      id: "pro",
      limitTokens: 19_000
    });
  });
});
