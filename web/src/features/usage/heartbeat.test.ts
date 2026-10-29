import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { buildHeartbeat, formatSilence, formatSilenceCompact } from "./heartbeat";

/** 固定时间基：2026-10-15 18:00 本地（「今天」= 10 月 15 日）。 */
const NOW = new Date(2026, 9, 15, 18, 0).getTime();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

function record(kind: SessionRecord["kind"], timestamp: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `r-${timestamp}-${kind}`,
    fullId: `r-${timestamp}-${kind}`,
    kind,
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function input(
  projectLabel: string,
  records: SessionRecord[],
  meta?: { path: string; title: string }
): UsageSessionInput {
  return {
    projectLabel,
    records,
    ...(meta
      ? {
          session: {
            path: meta.path,
            projectLabel,
            hasRecords: true,
            mtimeMs: NOW,
            sizeBytes: 1,
            aiTitle: meta.title
          }
        }
      : {})
  };
}

describe("buildHeartbeat（F8 对话心跳）", () => {
  it("空输入：没有可画的一天，三条通道仍在且为空", () => {
    const data = buildHeartbeat([], 7, NOW);
    expect(data.dayStart).toBeNull();
    expect(data.records).toBe(0);
    expect(data.longestSilence).toBeNull();
    expect(data.channels.map((channel) => channel.id)).toEqual(["user", "assistant", "tool"]);
    expect(data.channels.every((channel) => channel.total === 0 && channel.pulses.length === 0)).toBe(
      true
    );
  });

  it("单条记录：照画，没有「相邻」可测，所以静默为 null", () => {
    const data = buildHeartbeat(
      [input("p", [record("user", at(15, 9, 30))])],
      7,
      NOW
    );
    expect(data.dayStart).toBe(new Date(2026, 9, 15).getTime());
    expect(data.records).toBe(1);
    expect(data.channels[0].total).toBe(1);
    expect(data.channels[0].pulses).toEqual([{ minute: 570, count: 1 }]);
    expect(data.channels[0].peak).toBe(1);
    expect(data.longestSilence).toBeNull();
  });

  it("取最近一个有活动的自然日：前一天有活动也不画", () => {
    const data = buildHeartbeat(
      [
        input("p", [
          record("user", at(13, 10)),
          record("assistant", at(13, 11)),
          record("user", at(15, 9))
        ])
      ],
      7,
      NOW
    );
    expect(data.dayStart).toBe(new Date(2026, 9, 15).getTime());
    expect(data.records).toBe(1);
    expect(data.channels[0].total).toBe(1);
    expect(data.channels[1].total).toBe(0);
  });

  it("wait 与 system 不是对话节奏，不画也不计入静默", () => {
    const data = buildHeartbeat(
      [
        input("p", [
          record("user", at(15, 9)),
          record("wait", at(15, 9, 30)),
          record("system", at(15, 10)),
          record("assistant", at(15, 10, 30))
        ])
      ],
      7,
      NOW
    );
    expect(data.records).toBe(2);
    expect(data.channels.map((channel) => channel.total)).toEqual([1, 1, 0]);
    expect(data.longestSilence?.durationMs).toBe(90 * MIN);
  });

  it("同一分钟的多条记录合成一根竖线（计数为高度）", () => {
    const data = buildHeartbeat(
      [
        input("p", [
          record("tool", at(15, 9, 0)),
          record("tool", at(15, 9, 0)),
          record("tool", at(15, 9, 1))
        ])
      ],
      7,
      NOW
    );
    expect(data.channels[2].pulses).toEqual([
      { minute: 540, count: 2 },
      { minute: 541, count: 1 }
    ]);
    expect(data.channels[2].total).toBe(3);
    expect(data.channels[2].peak).toBe(2);
  });

  it("最长静默 = 相邻记录之间的最大间隔（并列取更早的一对）", () => {
    const data = buildHeartbeat(
      [
        input("p", [
          record("user", at(15, 9)),
          record("assistant", at(15, 9, 30)),
          record("user", at(15, 12, 14)),
          record("tool", at(15, 12, 20))
        ])
      ],
      7,
      NOW
    );
    expect(data.longestSilence).toEqual({
      startTs: at(15, 9, 30),
      endTs: at(15, 12, 14),
      durationMs: 164 * MIN
    });
  });

  it("单会话模式：默认取窗口内最近有活动的会话", () => {
    const data = buildHeartbeat(
      [
        input("a", [record("user", at(14, 10))], { path: "/p/a.jsonl", title: "会话 A" }),
        input("b", [record("assistant", at(15, 17))], { path: "/p/b.jsonl", title: "会话 B" })
      ],
      7,
      NOW,
      { scope: "session" }
    );
    expect(data.selectedSessionKey).toBe("/p/b.jsonl");
    expect(data.selectedSessionLabel).toBe("会话 B");
    expect(data.records).toBe(1);
    expect(data.channels[1].total).toBe(1);
    expect(data.channels[0].total).toBe(0);
    expect(data.dayStart).toBe(new Date(2026, 9, 15).getTime());
  });

  it("单会话模式：指定会话后取它自己的最近活动日", () => {
    const data = buildHeartbeat(
      [
        input("a", [record("user", at(14, 10))], { path: "/p/a.jsonl", title: "会话 A" }),
        input("b", [record("assistant", at(15, 17))], { path: "/p/b.jsonl", title: "会话 B" })
      ],
      7,
      NOW,
      { scope: "session", sessionKey: "/p/a.jsonl" }
    );
    expect(data.selectedSessionKey).toBe("/p/a.jsonl");
    expect(data.dayStart).toBe(new Date(2026, 9, 14).getTime());
    expect(data.records).toBe(1);
    expect(data.channels[0].total).toBe(1);
  });

  it("单会话模式：指定的 key 不在窗口内时回退到最近的活动会话", () => {
    const data = buildHeartbeat(
      [input("a", [record("user", at(15, 10))], { path: "/p/a.jsonl", title: "会话 A" })],
      7,
      NOW,
      { scope: "session", sessionKey: "/p/missing.jsonl" }
    );
    expect(data.selectedSessionKey).toBe("/p/a.jsonl");
  });

  it("会话选项按最近活动时间降序，手造输入用输入下标做稳定键", () => {
    const data = buildHeartbeat(
      [
        input("early", [record("user", at(14, 10))]),
        input("late", [record("user", at(15, 10))])
      ],
      7,
      NOW
    );
    expect(data.sessions.map((session) => session.key)).toEqual(["input-1", "input-0"]);
  });

  it("窗口边界：早于窗口起点的记录不参与", () => {
    const data = buildHeartbeat(
      [input("p", [record("user", NOW - 40 * DAY), record("user", at(15, 9))])],
      7,
      NOW
    );
    expect(data.records).toBe(1);
  });

  it("静默的两套文案：轴下用中文长句，读数行用紧凑写法", () => {
    expect(formatSilence(164 * MIN)).toBe("2 小时 44 分");
    expect(formatSilenceCompact(164 * MIN)).toBe("2h44m");
    expect(formatSilence(30 * 1000)).toBe("30 秒");
    expect(formatSilenceCompact(30 * 1000)).toBe("30s");
    expect(formatSilence(0)).toBe("0 分");
    expect(formatSilenceCompact(0)).toBe("0m");
  });
});
