import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { classifyToolUse, type ToolCallFact } from "./toolCensus";
import type { UsageSessionInput } from "./usageAggregations";
import { buildFlameGraph } from "./flameGraph";

/** 固定时间基：2026-10-15 12:00 本地，全部时刻由它偏移。 */
const NOW = new Date(2026, 9, 15, 12, 0).getTime();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function fact(
  name: string,
  at: number,
  durationMs?: number,
  sidechain = false
): ToolCallFact {
  const result: ToolCallFact = {
    key: classifyToolUse(name, undefined),
    timestamp: at,
    sidechain
  };
  if (durationMs !== undefined) result.durationMs = durationMs;
  return result;
}

function input(
  projectLabel: string,
  facts: ToolCallFact[],
  patch: Partial<UsageSessionInput> = {}
): UsageSessionInput {
  const record: SessionRecord = {
    id: "r0",
    fullId: "r0",
    kind: "tool",
    timestamp: NOW,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {}
  };
  return { projectLabel, records: [record], toolCalls: facts, ...patch };
}

describe("buildFlameGraph（F3 工具火焰）", () => {
  it("空输入：没有行、没有工具、总量为 0，模式保持耗时（空态由视图处理）", () => {
    const data = buildFlameGraph([], 7, NOW);
    expect(data.rows).toEqual([]);
    expect(data.tools).toEqual([]);
    expect(data.mode).toBe("duration");
    expect(data.totalCalls).toBe(0);
    expect(data.measuredCalls).toBe(0);
    expect(data.unknownCalls).toBe(0);
    expect(data.maxValue).toBe(0);
    expect(data.hasOther).toBe(false);
  });

  it("单会话：段按工具聚合，行值与最大值取自已测耗时", () => {
    const data = buildFlameGraph(
      [input("p", [fact("Bash", NOW - 10 * MIN, 60_000), fact("Read", NOW - 5 * MIN, 30_000)])],
      7,
      NOW
    );
    expect(data.mode).toBe("duration");
    expect(data.rows).toHaveLength(1);
    const row = data.rows[0];
    expect(row.value).toBe(90_000);
    expect(row.totalDurationMs).toBe(90_000);
    expect(row.calls).toBe(2);
    expect(row.measuredCalls).toBe(2);
    expect(row.unknownCalls).toBe(0);
    expect(row.segments.map((segment) => segment.label)).toEqual(["Bash", "Read"]);
    expect(row.segments.map((segment) => segment.durationMs)).toEqual([60_000, 30_000]);
    expect(data.maxValue).toBe(90_000);
    expect(data.totalDurationMs).toBe(90_000);
  });

  it("未配对调用：耗时未知不进条长，单独计数；不伪造 0 耗时段", () => {
    const data = buildFlameGraph(
      [input("p", [fact("Bash", NOW - 10 * MIN, 60_000), fact("Read", NOW - 5 * MIN)])],
      7,
      NOW
    );
    const row = data.rows[0];
    expect(row.unknownCalls).toBe(1);
    expect(row.measuredCalls).toBe(1);
    expect(row.calls).toBe(2);
    expect(row.segments).toHaveLength(1);
    expect(row.segments[0].label).toBe("Bash");
    expect(data.unknownCalls).toBe(1);
    expect(data.mode).toBe("duration");
  });

  it("全部调用都未配对：降级为按次数，条长改用调用数", () => {
    const data = buildFlameGraph(
      [
        input("p", [
          fact("Bash", NOW - 10 * MIN),
          fact("Bash", NOW - 9 * MIN),
          fact("Read", NOW - 8 * MIN)
        ])
      ],
      7,
      NOW
    );
    expect(data.mode).toBe("calls");
    const row = data.rows[0];
    expect(row.value).toBe(3);
    expect(row.calls).toBe(3);
    expect(row.unknownCalls).toBe(3);
    expect(row.totalDurationMs).toBe(0);
    expect(row.segments.map((segment) => segment.label)).toEqual(["Bash", "Read"]);
    expect(row.segments.map((segment) => segment.calls)).toEqual([2, 1]);
    expect(data.maxValue).toBe(3);
  });

  it("工具按总耗时排名取前 6，第 7 名及以后合并为「其他」（colorIndex null）", () => {
    const facts = Array.from({ length: 7 }, (_, index) =>
      fact(`Tool${7 - index}`, NOW - index * MIN, (index + 1) * 1000)
    );
    const data = buildFlameGraph([input("p", facts)], 7, NOW);
    expect(data.tools).toHaveLength(6);
    // durations = (index + 1) × 1000，所以 Tool7 最短、Tool1 最长。
    expect(data.tools.map((tool) => tool.label)).toEqual([
      "Tool1",
      "Tool2",
      "Tool3",
      "Tool4",
      "Tool5",
      "Tool6"
    ]);
    expect(data.hasOther).toBe(true);
    const other = data.rows[0].segments.find((segment) => segment.label === "Tool7");
    expect(other?.colorIndex).toBeNull();
  });

  it("窗口边界：早于窗口起点的调用不参与", () => {
    const data = buildFlameGraph(
      [input("p", [fact("Bash", NOW - 40 * DAY, 60_000), fact("Read", NOW - 1 * DAY, 30_000)])],
      7,
      NOW
    );
    expect(data.totalCalls).toBe(1);
    expect(data.rows[0].segments.map((segment) => segment.label)).toEqual(["Read"]);
  });

  it("会话标签优先用 meta 标题；行按条长降序，并列按标签稳定排序", () => {
    const shortMeta = {
      path: "/p/short.jsonl",
      projectLabel: "p",
      hasRecords: true,
      mtimeMs: NOW,
      sizeBytes: 1,
      aiTitle: "短会话"
    };
    const longMeta = {
      path: "/p/long.jsonl",
      projectLabel: "p",
      hasRecords: true,
      mtimeMs: NOW,
      sizeBytes: 1,
      aiTitle: "长会话"
    };
    const data = buildFlameGraph(
      [
        input("p", [fact("Bash", NOW - 3 * MIN, 30_000)], { session: shortMeta }),
        input("p", [fact("Bash", NOW - 2 * MIN, 90_000)], { session: longMeta })
      ],
      7,
      NOW
    );
    expect(data.rows.map((row) => row.label)).toEqual(["长会话", "短会话"]);

    const tie = buildFlameGraph(
      [
        input("p", [fact("Bash", NOW - 1 * MIN, 60_000)], { session: shortMeta }),
        input("p", [fact("Bash", NOW - 1 * MIN, 60_000)], { session: longMeta })
      ],
      7,
      NOW
    );
    expect(tie.rows.map((row) => row.label)).toEqual(["短会话", "长会话"]);
  });

  it("含子 agent（sidechain）调用：同样是真实耗时，计入本会话", () => {
    const data = buildFlameGraph(
      [input("p", [fact("Bash", NOW - 1 * MIN, 20_000, true)])],
      7,
      NOW
    );
    expect(data.totalCalls).toBe(1);
    expect(data.totalDurationMs).toBe(20_000);
    expect(data.rows[0].measuredCalls).toBe(1);
  });

  it("同一工具多次调用在行内累加，工具总排名按累加后的耗时", () => {
    const data = buildFlameGraph(
      [
        input("p", [
          fact("Bash", NOW - 5 * MIN, 20_000),
          fact("Bash", NOW - 4 * MIN, 25_000),
          fact("Read", NOW - 3 * MIN, 30_000)
        ])
      ],
      7,
      NOW
    );
    expect(data.tools.map((tool) => tool.label)).toEqual(["Bash", "Read"]);
    expect(data.rows[0].segments[0]).toMatchObject({ label: "Bash", durationMs: 45_000 });
  });
});
