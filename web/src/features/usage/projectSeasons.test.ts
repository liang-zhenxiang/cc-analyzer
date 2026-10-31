import { describe, expect, it } from "vitest";
import { projectSeasons, PROJECT_SEASONS_MAX_PROJECTS, OTHER_PROJECTS_LABEL } from "./projectSeasons";
import type { UsageSessionInput } from "./usageAggregations";
import type { SessionRecord, SessionUsage } from "../sessions/types";

/** 本地时刻夹具（同 monthlyReport.test.ts 惯例）。 */
function at(year: number, month: number, day: number, hour = 10): number {
  return new Date(year, month - 1, day, hour).getTime();
}

function usage(input: number, output = 0, cacheCreation = 0, cacheRead = 0): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

let seq = 0;
function record(timestamp: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `s0:r${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function inputOf(records: SessionRecord[], projectLabel = "p"): UsageSessionInput {
  return { records, projectLabel };
}

describe("projectSeasons", () => {
  it("空 sessions → 空数组", () => {
    expect(projectSeasons([], at(2026, 3, 1))).toEqual([]);
  });

  it("单季窗口：一行一格，share=1", () => {
    const rows = projectSeasons(
      [inputOf([record(at(2026, 2, 1), { usage: usage(100) })], "alpha")],
      at(2026, 3, 1)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].project).toBe("alpha");
    expect(rows[0].total).toBe(100);
    expect(rows[0].quarters).toEqual([{ year: 2026, q: 1, tokens: 100, share: 1 }]);
  });

  it("share 分母是项目自身总量，不是全局", () => {
    // alpha 100、beta 400——beta 的 share 与 alpha 无关。
    const rows = projectSeasons(
      [
        inputOf([record(at(2026, 1, 1), { usage: usage(100) })], "alpha"),
        inputOf([record(at(2026, 1, 2), { usage: usage(400) })], "beta")
      ],
      at(2026, 3, 1)
    );
    expect(rows.map((r) => [r.project, r.total])).toEqual([["beta", 400], ["alpha", 100]]);
    expect(rows[0].quarters[0].share).toBe(1);
  });

  it("跨季分摊：Q1/Q2 各占一半", () => {
    const rows = projectSeasons(
      [inputOf([
        record(at(2026, 2, 1), { usage: usage(100) }),
        record(at(2026, 4, 1), { usage: usage(100) })
      ])],
      at(2026, 4, 10)
    );
    expect(rows[0].quarters.map((c) => [c.q, c.share])).toEqual([[1, 0.5], [2, 0.5]]);
  });

  it("空季度保留 share: 0（UI 不补位）", () => {
    const rows = projectSeasons(
      [inputOf([
        record(at(2026, 1, 1), { usage: usage(100) }),
        record(at(2026, 8, 1), { usage: usage(300) })
      ])],
      at(2026, 9, 1)
    );
    expect(rows[0].quarters.map((c) => [c.q, c.tokens, c.share])).toEqual([
      [1, 100, 0.25],
      [2, 0, 0],
      [3, 300, 0.75]
    ]);
  });

  it("季度归属：1–3 月 Q1、4–6 月 Q2、7–9 月 Q3、10–12 月 Q4；跨年升序", () => {
    const rows = projectSeasons(
      [inputOf([
        record(at(2025, 12, 1), { usage: usage(1) }),
        record(at(2026, 1, 2), { usage: usage(1) }),
        record(at(2026, 4, 2), { usage: usage(1) }),
        record(at(2026, 7, 2), { usage: usage(1) }),
        record(at(2026, 10, 2), { usage: usage(1) })
      ])],
      at(2026, 10, 20)
    );
    expect(rows[0].quarters.map((c) => [c.year, c.q])).toEqual([
      [2025, 4],
      [2026, 1],
      [2026, 2],
      [2026, 3],
      [2026, 4]
    ]);
  });

  it("token 口径：四计数之和；tool 记录与 compactSummary 不计", () => {
    const rows = projectSeasons(
      [inputOf([
        record(at(2026, 1, 1), { usage: usage(1, 2, 3, 4) }),
        record(at(2026, 1, 3), { kind: "tool", usage: usage(1000) }),
        record(at(2026, 1, 5), { usage: usage(50), compactSummary: true }),
        record(at(2026, 1, 7), { kind: "user" })
      ])],
      at(2026, 3, 1)
    );
    expect(rows[0].total).toBe(10);
  });

  it("排序：total 降序、并列字典序", () => {
    const rows = projectSeasons(
      [
        inputOf([record(at(2026, 1, 1), { usage: usage(100) })], "zed"),
        inputOf([record(at(2026, 1, 1), { usage: usage(100) })], "alpha"),
        inputOf([record(at(2026, 1, 1), { usage: usage(200) })], "mid")
      ],
      at(2026, 3, 1)
    );
    expect(rows.map((r) => r.project)).toEqual(["mid", "alpha", "zed"]);
  });

  it("无 usage 的项目诚实保留（total 0、share 全 0）", () => {
    const rows = projectSeasons(
      [
        inputOf([record(at(2026, 1, 1), { usage: usage(100) })], "alpha"),
        inputOf([record(at(2026, 1, 2))], "silent")
      ],
      at(2026, 3, 1)
    );
    expect(rows.map((r) => r.project)).toEqual(["alpha", "silent"]);
    expect(rows[1].total).toBe(0);
    expect(rows[1].quarters.every((c) => c.share === 0)).toBe(true);
  });

  it("超过 8 个项目：前 8 之外并「其他」，桶内 share 重算", () => {
    const labels = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "small-1", "small-2"];
    // 前 8 各 100；小项目各 25（Q1 only），并入后 50。
    const inputs = labels.map((label, i) =>
      inputOf([record(at(2026, 1, 1 + i), { usage: usage(label.startsWith("small") ? 25 : 100) })], label)
    );
    const rows = projectSeasons(inputs, at(2026, 3, 1));
    expect(rows).toHaveLength(PROJECT_SEASONS_MAX_PROJECTS + 1);
    const other = rows[rows.length - 1];
    expect(other.project).toBe(OTHER_PROJECTS_LABEL);
    expect(other.total).toBe(50);
    expect(other.quarters[0].share).toBe(1);
    // 前 8 按原样展示。
    expect(rows.slice(0, 8).map((r) => r.project)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
  });

  it("恰好 8 个项目 → 不出「其他」", () => {
    const labels = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    const inputs = labels.map((label, i) =>
      inputOf([record(at(2026, 1, 1 + i), { usage: usage(100) })], label)
    );
    const rows = projectSeasons(inputs, at(2026, 3, 1));
    expect(rows).toHaveLength(8);
    expect(rows.some((r) => r.project === OTHER_PROJECTS_LABEL)).toBe(false);
  });

  it("「其他」桶参与 total 排序（可能超过单个前 8 项目）", () => {
    // p1..p8 各 100；9 个小项目各 50 → 「其他」450 排最前。
    const labels = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];
    const inputs = labels.map((label, i) =>
      inputOf([record(at(2026, 1, 1 + i), { usage: usage(label.startsWith("s") ? 50 : 100) })], label)
    );
    const rows = projectSeasons(inputs, at(2026, 3, 1));
    expect(rows[0].project).toBe(OTHER_PROJECTS_LABEL);
    expect(rows[0].total).toBe(450);
  });

  it("now 扩窗：窗口扩到 now 季，扩出的季 share: 0", () => {
    const rows = projectSeasons(
      [inputOf([record(at(2026, 1, 1), { usage: usage(100) })], "alpha")],
      at(2026, 7, 15)
    );
    expect(rows[0].quarters.map((c) => c.q)).toEqual([1, 2, 3]);
    expect(rows[0].quarters.map((c) => c.share)).toEqual([1, 0, 0]);
  });
});
