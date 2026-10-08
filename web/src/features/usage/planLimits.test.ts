import { afterEach, describe, expect, it } from "vitest";
import { PLAN_PRESETS, parsePlanSelection, setPlan } from "./planLimits";

describe("parsePlanSelection（持久化 JSON 不可信）", () => {
  it("合法预设 id → 对应限额", () => {
    expect(parsePlanSelection({ id: "pro" })).toEqual({
      id: "pro",
      limitTokens: 19_000,
      weeklyLimitTokens: null
    });
    expect(parsePlanSelection({ id: "max5" })).toEqual({
      id: "max5",
      limitTokens: 88_000,
      weeklyLimitTokens: null
    });
  });

  it("none → 无分母（只看消耗，不算百分比）", () => {
    expect(parsePlanSelection({ id: "none" })).toEqual({
      id: "none",
      limitTokens: null,
      weeklyLimitTokens: null
    });
  });

  it("custom 带正数 → 自定义限额；缺省/非法 → null", () => {
    expect(parsePlanSelection({ id: "custom", customLimitTokens: 12345 })).toEqual({
      id: "custom",
      limitTokens: 12345,
      weeklyLimitTokens: null
    });
    expect(parsePlanSelection({ id: "custom" })).toEqual({
      id: "custom",
      limitTokens: null,
      weeklyLimitTokens: null
    });
    expect(parsePlanSelection({ id: "custom", customLimitTokens: -5 })).toEqual({
      id: "custom",
      limitTokens: null,
      weeklyLimitTokens: null
    });
  });

  it("未知 id / 非对象 / 空输入 → 回退 none", () => {
    expect(parsePlanSelection({ id: "ultra" })).toEqual({
      id: "none",
      limitTokens: null,
      weeklyLimitTokens: null
    });
    expect(parsePlanSelection("junk")).toEqual({ id: "none", limitTokens: null, weeklyLimitTokens: null });
    expect(parsePlanSelection(null)).toEqual({ id: "none", limitTokens: null, weeklyLimitTokens: null });
  });

  it("预设 id 忽略无关的 custom 字段（预设值不被覆盖）", () => {
    expect(parsePlanSelection({ id: "pro", customLimitTokens: 999 })).toEqual({
      id: "pro",
      limitTokens: 19_000,
      weeklyLimitTokens: null
    });
  });

  it("向后兼容：旧格式（只有 id 与 customLimitTokens）反序列化后 weeklyLimitTokens 为 null", () => {
    // 旧版本写入的持久化里根本没有 customWeeklyLimitTokens 字段；
    // 反序列化必须落回 null（只显示消耗），而不是把 5h 的选择也丢掉。
    expect(parsePlanSelection({ id: "pro", customLimitTokens: 12345 })).toEqual({
      id: "pro",
      limitTokens: 19_000,
      weeklyLimitTokens: null
    });
    expect(parsePlanSelection({ id: "custom", customLimitTokens: 5000 })).toEqual({
      id: "custom",
      limitTokens: 5000,
      weeklyLimitTokens: null
    });
  });

  it("周预算与计划档位正交：任何档位都只认自设的 customWeeklyLimitTokens", () => {
    expect(
      parsePlanSelection({ id: "pro", customWeeklyLimitTokens: 600_000 })
    ).toEqual({ id: "pro", limitTokens: 19_000, weeklyLimitTokens: 600_000 });
    expect(parsePlanSelection({ id: "custom", customWeeklyLimitTokens: 600_000 })).toEqual({
      id: "custom",
      limitTokens: null,
      weeklyLimitTokens: 600_000
    });
  });

  it("周预算非法（负数 / 非数字 / 0）→ null，不产出无意义分母", () => {
    expect(parsePlanSelection({ id: "pro", customWeeklyLimitTokens: -1 })).toEqual({
      id: "pro",
      limitTokens: 19_000,
      weeklyLimitTokens: null
    });
    expect(parsePlanSelection({ id: "pro", customWeeklyLimitTokens: "many" })).toEqual({
      id: "pro",
      limitTokens: 19_000,
      weeklyLimitTokens: null
    });
    expect(parsePlanSelection({ id: "pro", customWeeklyLimitTokens: 0 })).toEqual({
      id: "pro",
      limitTokens: 19_000,
      weeklyLimitTokens: null
    });
  });

  it("预设一律不带周数字——没有可靠来源就填 null，不许编", () => {
    // 预设的周档在类型上就是 null；这条断言防止未来有人顺手填一个
    // 「看起来合理」的数字（周限额没有社区整理来源）。
    for (const preset of PLAN_PRESETS) {
      expect(preset.weeklyLimitTokens).toBeNull();
    }
  });
});

describe("setPlan 持久化与解析的往返", () => {
  afterEach(() => {
    localStorage.clear();
    // 模块内存状态复位，避免泄漏到别的用例。
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
  });

  it("自设的两层预算写出的 JSON 能被 parsePlanSelection 原样读回（重启不丢）", () => {
    setPlan({ id: "custom", limitTokens: 12_345, weeklyLimitTokens: 600_000 });
    const persisted = localStorage.getItem("cca-billing-plan");
    expect(persisted).not.toBeNull();
    expect(parsePlanSelection(JSON.parse(persisted ?? "{}"))).toEqual({
      id: "custom",
      limitTokens: 12_345,
      weeklyLimitTokens: 600_000
    });
  });

  it("预设档的往返同样成立（预设 5h 值 + 自设周预算）", () => {
    setPlan({ id: "pro", limitTokens: 19_000, weeklyLimitTokens: 600_000 });
    const persisted = localStorage.getItem("cca-billing-plan");
    expect(parsePlanSelection(JSON.parse(persisted ?? "{}"))).toEqual({
      id: "pro",
      limitTokens: 19_000,
      weeklyLimitTokens: 600_000
    });
  });
});
