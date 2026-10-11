import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { BILLING_WINDOW_MS } from "./billingWindow";
import { CLOCK_TICK_MS, billingReadoutsOf, useBillingReadouts } from "./billingReadouts";
import { setPlan } from "./planLimits";
import { totalsSum, type UsageSessionInput } from "./usageAggregations";

const T0 = new Date(2026, 9, 2, 9, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 86_400_000;
const USAGE_DIR = resolve(process.cwd(), "src/features/usage");

function record(at: number, input = 10_000): SessionRecord {
  return {
    id: `r-${at}`,
    kind: "assistant",
    timestamp: at,
    usage: { inputTokens: input, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
  } as unknown as SessionRecord;
}

function inputsOf(...streams: SessionRecord[][]): UsageSessionInput[] {
  return streams.map((records, index) => ({ records, projectLabel: `-repo-${index}` }));
}

describe("billingReadoutsOf", () => {
  it("把各会话记录交错成一条时间流，再按同一个窗口规则切块", () => {
    const readouts = billingReadoutsOf(
      inputsOf([record(T0 + 2 * HOUR, 2_000)], [record(T0, 1_000), record(T0 + HOUR, 3_000)]),
      T0 + 2 * HOUR,
      null
    );

    // 交错 + 排序：三份记录合成一条按时间升序的流（会话边界不参与切窗）。
    expect(readouts.records.map((item) => item.timestamp)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);
    expect(readouts.blocks).toHaveLength(1);
    expect(readouts.blocks[0].start).toBe(T0);
    expect(readouts.blocks[0].end).toBe(T0 + BILLING_WINDOW_MS);
    expect(readouts.blocks[0].messages).toBe(3);
    expect(totalsSum(readouts.blocks[0].totals)).toBe(6_000);
    // active 就是覆盖 now 的那一块（表盘中心读它）。
    expect(readouts.active).toBe(readouts.blocks[0]);
  });

  it("相隔超过一个窗口的记录切成两块，active 是覆盖 now 的那一块", () => {
    const readouts = billingReadoutsOf(
      inputsOf([record(T0, 1_000), record(T0 + 6 * HOUR, 5_000)]),
      T0 + HOUR,
      null
    );
    expect(readouts.blocks).toHaveLength(2);
    expect(readouts.active?.start).toBe(T0);
    expect(totalsSum(readouts.active!.totals)).toBe(1_000);
  });

  it("周窗口吃喂进来的预算，没预算时明确是 null", () => {
    const inputs = () => inputsOf([record(T0 - 2 * DAY, 1_000), record(T0, 2_000)]);

    const noBudget = billingReadoutsOf(inputs(), T0 + HOUR, null);
    expect(noBudget.week.limitTokens).toBeNull();
    expect(totalsSum(noBudget.week.consumed)).toBe(3_000);

    const withBudget = billingReadoutsOf(inputs(), T0 + HOUR, 10_000);
    expect(withBudget.week.limitTokens).toBe(10_000);
    expect(totalsSum(withBudget.week.consumed)).toBe(3_000);
  });

  it("归因也在同一条序列里算好：分母就是 active 的合计，没有窗口就没有归因", () => {
    const inputs = inputsOf([record(T0, 1_000), record(T0 + HOUR, 3_000)]);
    const readouts = billingReadoutsOf(inputs, T0 + HOUR, null);
    expect(readouts.attribution).not.toBeNull();
    expect(readouts.attribution!.windowTokens).toBe(totalsSum(readouts.active!.totals));
    expect(readouts.attribution!.sessionsInWindow).toBe(1);

    // now 落在所有记录之前 → 没有 active 块，也就没有归因（不给分母就不给比率）。
    const before = billingReadoutsOf(inputs, T0 - HOUR, null);
    expect(before.active).toBeNull();
    expect(before.attribution).toBeNull();
  });
});

/** 去掉注释再找调用：文档里提到的 `foo(...)` 不是调用点。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * 调用点清单（非测试源码）：扫描整个 `features/usage` 顶层目录，返回真正调用
 * `name(...)` 的文件名。定义它的那个文件不算——它是「定义」不是「调用」。
 */
function callersOf(name: string, definedIn: string): string[] {
  const call = new RegExp(`\\b${name}\\s*\\(`);
  return readdirSync(USAGE_DIR)
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file))
    .filter((file) => file !== definedIn)
    .filter((file) => call.test(stripComments(readFileSync(resolve(USAGE_DIR, file), "utf8"))))
    .sort();
}

/**
 * 结构性守卫（Issue #174 返工）：归因与窗口数学一样只有一个调用点。
 * 卡与页面都只消费 `readouts.attribution`——谁再自己调一次，这条立刻红。
 */
test("attributeQuota 全仓库只有一个调用点：billingReadouts.ts", () => {
  expect(callersOf("attributeQuota", "quotaAttribution.ts")).toEqual(["billingReadouts.ts"]);
});

describe("useBillingReadouts", () => {
  afterEach(() => {
    vi.useRealTimers();
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
  });

  it("注入 now 时不自己走时钟：推进定时器也不动", () => {
    vi.useFakeTimers();
    // 系统时钟故意与注入值不同：读数必须跟着注入值，不跟着 Date.now。
    vi.setSystemTime(T0 + 5 * HOUR);
    const inputs = inputsOf([record(T0, 1_000)]);
    const { result, rerender } = renderHook(() => useBillingReadouts(inputs, T0 + HOUR));
    expect(result.current.now).toBe(T0 + HOUR);

    act(() => {
      vi.advanceTimersByTime(10 * CLOCK_TICK_MS);
    });
    rerender();
    expect(result.current.now).toBe(T0 + HOUR);
  });

  it("不注入 now 时，每 30 秒把 now 推进一步", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const inputs = inputsOf([record(T0, 1_000)]);
    const { result } = renderHook(() => useBillingReadouts(inputs));
    expect(result.current.now).toBe(T0);

    act(() => {
      vi.advanceTimersByTime(CLOCK_TICK_MS);
    });
    expect(result.current.now).toBe(T0 + CLOCK_TICK_MS);

    act(() => {
      vi.advanceTimersByTime(CLOCK_TICK_MS);
    });
    expect(result.current.now).toBe(T0 + 2 * CLOCK_TICK_MS);
  });

  it("inputs 不变时读数引用稳定；换一份 inputs 才重算", () => {
    const inputs = inputsOf([record(T0, 1_000)]);
    const { result, rerender } = renderHook(
      ({ list }: { list: UsageSessionInput[] }) => useBillingReadouts(list, T0 + HOUR),
      { initialProps: { list: inputs } }
    );
    const first = result.current;
    rerender({ list: inputs });
    expect(result.current).toBe(first);

    // 新数组 = 新数据：必须重算出新引用，否则页面会继续显示旧窗口。
    rerender({ list: inputsOf([record(T0, 9_999)]) });
    expect(result.current).not.toBe(first);
    expect(totalsSum(result.current.active!.totals)).toBe(9_999);
  });

  it("计划从 usePlan 进来：周预算进窗口数学，5 小时限额留给卡", () => {
    setPlan({ id: "custom", limitTokens: 5_000, weeklyLimitTokens: 20_000 });
    const inputs = inputsOf([record(T0, 1_000)]);
    const { result } = renderHook(() => useBillingReadouts(inputs, T0 + HOUR));
    expect(result.current.plan.limitTokens).toBe(5_000);
    expect(result.current.week.limitTokens).toBe(20_000);
  });
});
