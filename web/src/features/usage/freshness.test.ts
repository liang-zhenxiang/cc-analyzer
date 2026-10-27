import { describe, expect, it } from "vitest";
import { FRESH_WINDOW_MINUTES, freshnessOf } from "./freshness";

/** 2026-10-27 10:00 本地——钟面断言可读且与运行时区无关（本地构造本地读）。 */
const NOW = new Date(2026, 9, 27, 10, 0).getTime();
const MIN = 60_000;

describe("freshness · 无数据", () => {
  it("lastRecordAt null → 暂无数据 / unknown / minutesAgo null", () => {
    const badge = freshnessOf(NOW, null, null);
    expect(badge).toEqual({
      label: "暂无数据",
      minutesAgo: null,
      staleness: "unknown",
      hint: "还没有扫描过会话目录"
    });
  });

  it("无记录但扫过 → hint 说扫描到了 0 条", () => {
    const badge = freshnessOf(NOW, null, NOW - 3 * MIN);
    expect(badge.staleness).toBe("unknown");
    expect(badge.hint).toBe("上次扫描 3 分钟前，但没有读到任何记录");
  });
});

describe("freshness · 分级边界", () => {
  it("0 分钟 → fresh", () => {
    const badge = freshnessOf(NOW, NOW, NOW);
    expect(badge.staleness).toBe("fresh");
    expect(badge.label).toBe(`数据截至 10:00`);
    expect(badge.minutesAgo).toBe(0);
  });

  it("4.9 分钟（293 秒）→ 仍 fresh，minutesAgo 向下取整为 4", () => {
    const badge = freshnessOf(NOW, NOW - 4 * MIN - 53_000, NOW);
    expect(badge.staleness).toBe("fresh");
    expect(badge.minutesAgo).toBe(4);
  });

  it("5 分钟整 → stale（≥ 5 分钟即旧）", () => {
    const badge = freshnessOf(NOW, NOW - 5 * MIN, NOW - 1 * MIN);
    expect(badge.staleness).toBe("stale");
    expect(badge.minutesAgo).toBe(5);
  });

  it("FRESH_WINDOW_MINUTES 常量 = 5", () => {
    expect(FRESH_WINDOW_MINUTES).toBe(5);
  });
});

describe("freshness · 钟面", () => {
  it("label 用本地时区 HH:MM（补零）", () => {
    const badge = freshnessOf(NOW, new Date(2026, 9, 27, 9, 5).getTime(), null);
    expect(badge.label).toBe("数据截至 09:05");
  });
});

describe("freshness · hint 拼装", () => {
  it("fresh 时 hint 只报扫描时刻（无扫描则空串）", () => {
    expect(freshnessOf(NOW, NOW - 1 * MIN, NOW - 1 * MIN).hint).toBe("上次扫描 1 分钟前");
    expect(freshnessOf(NOW, NOW - 1 * MIN, null).hint).toBe("");
  });

  it("stale 且扫描比记录新 →「正在变化或等待刷新」", () => {
    const badge = freshnessOf(NOW, NOW - 30 * MIN, NOW - 2 * MIN);
    expect(badge.staleness).toBe("stale");
    expect(badge.hint).toBe("上次扫描 2 分钟前，正在变化或等待刷新");
  });

  it("stale 且扫描比记录更早 → 建议重新扫描", () => {
    const badge = freshnessOf(NOW, NOW - 10 * MIN, NOW - 40 * MIN);
    expect(badge.staleness).toBe("stale");
    expect(badge.hint).toBe("上次扫描 40 分钟前，早于最后一条记录，建议重新扫描");
  });

  it("stale 且无扫描时刻 → 建议重新扫描（不编造扫描数字）", () => {
    const badge = freshnessOf(NOW, NOW - 10 * MIN, null);
    expect(badge.staleness).toBe("stale");
    expect(badge.hint).toBe("记录已有一会儿了，建议重新扫描");
  });
});
