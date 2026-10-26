import { describe, expect, it } from "vitest";
import { buildGantt } from "./sessionGantt";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

/** 固定时间基：2026-10-10 09:00 本地，全部时刻由它偏移，无「现在」依赖。 */
const BASE = new Date(2026, 9, 10, 9, 0).getTime();
const MIN = 60_000;

let seq = 0;
function record(at: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(input: number, output: number, cacheCreation: number, cacheRead: number): SessionUsage {
  return { inputTokens: input, outputTokens: output, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead };
}

function session(times: Array<[number, number]>, projectLabel = "p", withUsage = false): UsageSessionInput {
  return {
    projectLabel,
    records: times.map(([at, token]) =>
      withUsage
        ? record(at, { usage: usage(token, 0, 0, 0) })
        : record(at)
    )
  };
}

describe("sessionGantt", () => {
  it("空输入：rows 空、maxOverlaps 0、spanStart === spanEnd === now", () => {
    const now = BASE + 10 * MIN;
    const data = buildGantt([], now);
    expect(data.rows).toEqual([]);
    expect(data.maxOverlaps).toBe(0);
    expect(data.spanStart).toBe(now);
    expect(data.spanEnd).toBe(now);
  });

  it("空 records 的会话被跳过，不产生零长度行", () => {
    const data = buildGantt([session([], "empty"), session([[BASE, 0], [BASE + 5 * MIN, 0]], "live")], BASE);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].projectLabel).toBe("live");
  });

  it("单会话：overlap 0，start/end 取首末 timestamp", () => {
    const data = buildGantt([session([[BASE, 0], [BASE + 3 * MIN, 0], [BASE + 7 * MIN, 0]])], BASE);
    expect(data.rows).toHaveLength(1);
    const row = data.rows[0];
    expect(row.start).toBe(BASE);
    expect(row.end).toBe(BASE + 7 * MIN);
    expect(row.overlapCount).toBe(0);
    expect(data.maxOverlaps).toBe(0);
    expect(data.spanStart).toBe(BASE);
    expect(data.spanEnd).toBe(BASE + 7 * MIN);
  });

  it("tokens = 四计数器之和（与 KPI 同口径）", () => {
    const records = [
      record(BASE, { usage: usage(100, 10, 1000, 500) }),
      record(BASE + MIN, { usage: usage(50, 5, 0, 250) })
    ];
    const data = buildGantt([{ projectLabel: "p", records }], BASE);
    // 100+10+1000+500 + 50+5+0+250 = 1915
    expect(data.rows[0].tokens).toBe(1915);
  });

  it("端点相触（一者 end === 另一者 start）算重叠：双方 overlapCount 各 +1", () => {
    const first = session([[BASE, 0], [BASE + 10 * MIN, 0]], "a");
    const second = session([[BASE + 10 * MIN, 0], [BASE + 20 * MIN, 0]], "b");
    const data = buildGantt([first, second], BASE);
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0].overlapCount).toBe(1);
    expect(data.rows[1].overlapCount).toBe(1);
    expect(data.maxOverlaps).toBe(1);
  });

  it("完全不相交：双方 overlap 0", () => {
    const first = session([[BASE, 0], [BASE + 10 * MIN, 0]], "a");
    const second = session([[BASE + 11 * MIN, 0], [BASE + 20 * MIN, 0]], "b");
    const data = buildGantt([first, second], BASE);
    expect(data.rows[0].overlapCount).toBe(0);
    expect(data.rows[1].overlapCount).toBe(0);
  });

  it("嵌套会话：内层与外层互算重叠；三条同窗 → 每条 overlap 2", () => {
    const outer = session([[BASE, 0], [BASE + 60 * MIN, 0]], "outer");
    const inner = session([[BASE + 10 * MIN, 0], [BASE + 20 * MIN, 0]], "inner");
    const data = buildGantt([outer, inner], BASE);
    expect(data.rows.find((r) => r.projectLabel === "outer")!.overlapCount).toBe(1);
    expect(data.rows.find((r) => r.projectLabel === "inner")!.overlapCount).toBe(1);

    const third = session([[BASE + 5 * MIN, 0], [BASE + 30 * MIN, 0]], "third");
    const three = buildGantt([outer, inner, third], BASE);
    for (const row of three.rows) {
      expect(row.overlapCount).toBe(2);
    }
    expect(three.maxOverlaps).toBe(2);
  });

  it("rows 按 start 升序；同 start 按 end 升序；再按 label 字典序（输入乱序仍稳定）", () => {
    const late = session([[BASE + 30 * MIN, 0], [BASE + 40 * MIN, 0]], "late");
    const earlyShort = session([[BASE, 0], [BASE + 5 * MIN, 0]], "b-short");
    const earlyLong = session([[BASE, 0], [BASE + 8 * MIN, 0]], "a-long");
    const data = buildGantt([late, earlyShort, earlyLong], BASE);

    expect(data.rows.map((r) => r.projectLabel)).toEqual(["b-short", "a-long", "late"]);
    // start/end 全等、label 决定次序
    const tie1 = session([[BASE, 0], [BASE + 5 * MIN, 0]], "zz");
    const tie2 = session([[BASE, 0], [BASE + 5 * MIN, 0]], "aa");
    const ties = buildGantt([tie1, tie2], BASE);
    expect(ties.rows.map((r) => r.projectLabel)).toEqual(["aa", "zz"]);
  });

  it("span 取全体 min/max，不随 now 改变；now 只落在空输入上", () => {
    const only = session([[BASE + 10 * MIN, 0], [BASE + 30 * MIN, 0]]);
    const early = buildGantt([only], BASE);
    const late = buildGantt([only], BASE + 999 * MIN);
    expect(early.spanStart).toBe(late.spanStart);
    expect(early.spanEnd).toBe(late.spanEnd);
    expect(early.spanStart).toBe(BASE + 10 * MIN);
    expect(early.spanEnd).toBe(BASE + 30 * MIN);
  });

  it("label 优先用 session meta 的标题链，缺 meta 时用 projectLabel", () => {
    const withMeta: UsageSessionInput = {
      ...session([[BASE, 0]], "proj"),
      session: {
        projectLabel: "proj",
        hasRecords: true,
        path: "/x.jsonl",
        mtimeMs: 0,
        sizeBytes: 0,
        customTitle: "自定义标题"
      }
    };
    const data = buildGantt([withMeta, session([[BASE, 0]], "bare")], BASE);
    expect(data.rows.find((r) => r.projectLabel === "proj")!.label).toBe("自定义标题");
    expect(data.rows.find((r) => r.projectLabel === "bare")!.label).toBe("bare");
  });
});
