import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import { parseJsonlText } from "../sessions/parseJsonl";
import type {
  CompactEvent,
  SessionRecord,
  SessionUsage
} from "../sessions/types";
import type { UsageSessionInput } from "../usage/usageAggregations";
import {
  consoleModelOf,
  eventsOf,
  hourBucketsOf,
  projectStatsOf,
  type ConsoleEvent
} from "./consoleModel";
import type { SessionRow } from "./pulseModel";

import fixture from "../../../tests/fixtures/monitor-console.jsonl?raw";

const MINUTE = 60_000;
const NOW = new Date(2026, 9, 17, 12, 30, 0, 0).getTime();
const TODAY_START = new Date(2026, 9, 17, 0, 0, 0, 0).getTime();

function localAt(hour: number, minute: number, second = 0): number {
  return new Date(2026, 9, 17, hour, minute, second, 0).getTime();
}

function usage(
  inputTokens: number,
  outputTokens = 0,
  cacheCreationTokens = 0,
  cacheReadTokens = 0
): SessionUsage {
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens
  };
}

function record(
  timestamp: number,
  tokens: SessionUsage | undefined,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    id: `record-${timestamp}`,
    fullId: `full-${timestamp}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    usage: tokens,
    raw: {},
    ...overrides
  };
}

function compact(
  timestamp: number,
  trigger: string | null,
  preTokens: number | null,
  overrides: Partial<CompactEvent> = {}
): CompactEvent {
  return {
    id: `compact-${timestamp}`,
    timestamp,
    trigger,
    preTokens,
    postTokens: null,
    droppedTokens: null,
    durationMs: null,
    survivedUuids: [],
    summaryText: null,
    summaryUuid: null,
    logicalParentUuid: null,
    ...overrides
  };
}

function meta(
  path: string,
  projectLabel: string,
  overrides: Partial<SessionMeta> = {}
): SessionMeta {
  return {
    path,
    projectLabel,
    mtimeMs: NOW,
    sizeBytes: 100,
    hasRecords: true,
    metadataStatus: "complete",
    ...overrides
  };
}

function inputOf({
  projectLabel,
  records,
  compactEvents = [],
  path = `/repo/${projectLabel}/session.jsonl`,
  projectPath = `/repo/${projectLabel}`,
  session = meta(path, projectLabel, { cwd: projectPath })
}: {
  projectLabel: string;
  records: SessionRecord[];
  compactEvents?: CompactEvent[];
  path?: string;
  projectPath?: string;
  session?: SessionMeta;
}): UsageSessionInput {
  return {
    projectLabel,
    projectPath,
    records,
    compactEvents,
    session
  };
}

function row(
  projectLabel: string,
  path = `/repo/${projectLabel}/session.jsonl`
): SessionRow {
  return {
    path,
    title: `${projectLabel} session`,
    projectLabel,
    ageMs: 0,
    recency: "live",
    lastActivityMs: NOW
  };
}

function fixtureInputs(): UsageSessionInput[] {
  const groups = new Map<
    string,
    { cwd: string; projectLabel: string; lines: string[] }
  >();

  for (const line of fixture.trim().split(/\r?\n/)) {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : "";
    const cwd = typeof raw.cwd === "string" ? raw.cwd : "";
    if (!sessionId || !cwd) continue;
    const projectLabel = cwd.split("/").at(-1) ?? cwd;
    const group = groups.get(sessionId) ?? { cwd, projectLabel, lines: [] };
    group.lines.push(line);
    groups.set(sessionId, group);
  }

  return [...groups.entries()].map(([sessionId, group]) => {
    const path = `${group.cwd}/${sessionId}.jsonl`;
    const parsed = parseJsonlText(group.lines.join("\n"), path);
    return {
      projectLabel: group.projectLabel,
      projectPath: group.cwd,
      records: parsed.records,
      compactEvents: parsed.compactEvents ?? [],
      session: meta(path, group.projectLabel, {
        sessionId,
        cwd: group.cwd,
        mtimeMs: NOW - MINUTE,
        sizeBytes: fixture.length
      })
    };
  });
}

function previewOf(events: ConsoleEvent[]): string[] {
  return events.filter((event) => event.kind === "error").map((event) => event.preview);
}

describe("hourBucketsOf", () => {
  it("构造本地自然日的 24 个整点桶，只有当前小时 partial", () => {
    const buckets = hourBucketsOf([], NOW);

    expect(buckets).toHaveLength(24);
    expect(buckets[0].hourStart).toBe(TODAY_START);
    expect(buckets[23].hourStart).toBe(localAt(23, 0));
    expect(buckets.filter((bucket) => bucket.partial)).toEqual([
      { hourStart: localAt(12, 0), tokens: 0, partial: true, phase: "current" }
    ]);
  });

  it("按当前小时把桶分成过去 / 当前 / 未来——未来不是 0，是尚未发生", () => {
    const buckets = hourBucketsOf([], NOW);

    expect(buckets[11].phase).toBe("past");
    expect(buckets[12].phase).toBe("current");
    expect(buckets[13].phase).toBe("future");
    expect(buckets[23].phase).toBe("future");
    // 三档合起来覆盖全部 24 桶，且恰好一个当前。
    expect(buckets.filter((b) => b.phase === "current")).toHaveLength(1);
    expect(buckets.filter((b) => b.phase === "future")).toHaveLength(11);
    expect(buckets.filter((b) => b.phase === "past")).toHaveLength(12);
  });

  it("按记录自己的本地小时归桶，四类 token 走 totalsSum", () => {
    const buckets = hourBucketsOf(
      [
        record(localAt(0, 0), usage(1, 2, 3, 4)),
        record(localAt(8, 59, 59), usage(10)),
        record(localAt(9, 0), usage(20)),
        record(localAt(12, 29), usage(30)),
        record(localAt(12, 29), usage(40))
      ],
      NOW
    );

    expect(buckets[0].tokens).toBe(10);
    expect(buckets[8].tokens).toBe(10);
    expect(buckets[9].tokens).toBe(20);
    expect(buckets[12]).toEqual({
      hourStart: localAt(12, 0),
      tokens: 70,
      partial: true,
      phase: "current"
    });
  });

  it("未来、前一天、无 usage、坏时间戳与坏 token 都不计", () => {
    const buckets = hourBucketsOf(
      [
        record(TODAY_START - 1, usage(999)),
        record(NOW + 1, usage(999)),
        record(localAt(11, 0), undefined),
        record(Number.NaN, usage(999)),
        record(localAt(10, 0), { inputTokens: 5, outputTokens: Number.NaN }),
        record(localAt(10, 1), usage(7))
      ],
      NOW
    );

    expect(buckets[10].tokens).toBe(7);
    expect(buckets.reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(7);
  });

  it("无效 now 没有可定义的今天，返回空数组", () => {
    expect(hourBucketsOf([record(NOW, usage(1))], Number.NaN)).toEqual([]);
  });
});

describe("projectStatsOf", () => {
  it("聚合今天 token、近 15 分钟速率与活跃会话数", () => {
    const stats = projectStatsOf(
      [
        inputOf({
          projectLabel: "alpha",
          records: [
            record(NOW - 15 * MINUTE, usage(1_000)),
            record(NOW - 15 * MINUTE - 1, usage(2_000)),
            record(TODAY_START - 1, usage(9_000)),
            record(NOW + 1, usage(8_000))
          ]
        }),
        inputOf({
          projectLabel: "beta",
          records: [record(NOW - MINUTE, usage(1_000))]
        })
      ],
      [row("alpha"), row("alpha", "/repo/alpha/second.jsonl"), row("beta")],
      NOW
    );

    expect(stats).toEqual([
      {
        projectLabel: "alpha",
        projectPath: "/repo/alpha",
        todayTokens: 3_000,
        ratePerHour: 4_000,
        activeSessions: 2
      },
      {
        projectLabel: "beta",
        projectPath: "/repo/beta",
        todayTokens: 1_000,
        ratePerHour: 4_000,
        activeSessions: 1
      }
    ]);
  });

  it("速率并列按项目名升序；今天为 0 且速率为 0 的项目隐藏", () => {
    const stats = projectStatsOf(
      [
        inputOf({
          projectLabel: "zeta",
          records: [record(NOW - MINUTE, usage(400))]
        }),
        inputOf({
          projectLabel: "alpha",
          records: [record(NOW - MINUTE, usage(400))]
        }),
        inputOf({
          projectLabel: "yesterday-only",
          records: [record(TODAY_START - 1, usage(500))]
        }),
        inputOf({
          projectLabel: "no-usage",
          records: [record(NOW - MINUTE, undefined)]
        })
      ],
      [],
      NOW
    );

    expect(stats.map((project) => project.projectLabel)).toEqual(["alpha", "zeta"]);
  });

  it("重复路径按 sessionKeyOf 合并，不同输入里的同一会话不重复成两行", () => {
    const path = "/repo/alpha/shared.jsonl";
    const shared = meta(path, "alpha", { cwd: "/repo/alpha" });
    const stats = projectStatsOf(
      [
        inputOf({
          projectLabel: "alpha",
          path,
          records: [record(NOW - 2 * MINUTE, usage(100))],
          session: shared
        }),
        inputOf({
          projectLabel: "alpha",
          path,
          records: [record(NOW - MINUTE, usage(300))],
          session: shared
        })
      ],
      [row("alpha", path)],
      NOW
    );

    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      todayTokens: 400,
      ratePerHour: 1_600,
      activeSessions: 1
    });
  });

  it("坏 token 不当 0：整条记录的 token 贡献跳过", () => {
    const stats = projectStatsOf(
      [
        inputOf({
          projectLabel: "alpha",
          records: [
            record(NOW - MINUTE, { inputTokens: Number.NaN, outputTokens: 100 }),
            record(NOW - 2 * MINUTE, usage(20))
          ]
        })
      ],
      [],
      NOW
    );

    expect(stats[0]).toMatchObject({ todayTokens: 20, ratePerHour: 80 });
    expect(Number.isFinite(stats[0].todayTokens)).toBe(true);
    expect(Number.isFinite(stats[0].ratePerHour)).toBe(true);
  });

  it("空输入与无效 now 都返回空榜", () => {
    expect(projectStatsOf([], [], NOW)).toEqual([]);
    expect(projectStatsOf([inputOf({ projectLabel: "alpha", records: [] })], [], Number.NaN)).toEqual(
      []
    );
  });
});

describe("eventsOf", () => {
  it("夹具覆盖压缩、错误、会话开始三类，且降序", () => {
    const events = eventsOf(fixtureInputs(), [], NOW);
    const kinds = new Set(events.map((event) => event.kind));

    expect(kinds).toEqual(new Set(["compaction", "error", "session"]));
    expect(events.filter((event) => event.kind === "compaction").map((event) => event.detail)).toEqual([
      "manual",
      "auto"
    ]);
    expect(events.map((event) => event.at)).toEqual(
      [...events.map((event) => event.at)].sort((a, b) => b - a)
    );
    for (const preview of previewOf(events)) {
      expect(preview).not.toContain("/Users/");
      expect(preview).not.toContain("/home/");
      expect(preview).not.toContain("C:\\");
    }
  });

  it("错误详情用工具名或未知工具，预览取首行、折叠空白、脱敏并截断 80 字符", () => {
    const path = "/repo/alpha/errors.jsonl";
    const events = eventsOf(
      [
        inputOf({
          projectLabel: "alpha",
          path,
          records: [
            record(NOW - 2 * MINUTE, undefined, {
              id: "error-1",
              fullId: "error-1",
              kind: "tool",
              toolName: "Bash",
              isError: true,
              text: `Exit   1 /Users/alice/private/a.ts /home/bob/b.ts C:\\Users\\bob\\c.ts\n${"second line"}`
            }),
            record(NOW - MINUTE, undefined, {
              id: "error-2",
              fullId: "error-2",
              isError: true,
              text: "API failed"
            })
          ]
        })
      ],
      [],
      NOW
    );

    const errors = events.filter((event) => event.kind === "error");
    expect(errors[0]).toMatchObject({
      detail: "未知工具",
      preview: "API failed"
    });
    expect(errors[1].detail).toBe("Bash");
    expect(errors[1].preview).toContain("Exit 1");
    expect(errors[1].preview).toContain("…");
    expect(errors[1].preview).not.toContain("/Users/");
    expect(errors[1].preview).not.toContain("/home/");
    expect(errors[1].preview).not.toContain("C:\\");
    expect(errors[1].preview).not.toContain("second line");
    expect(errors[1].preview.length).toBeLessThanOrEqual(80);
  });

  it("工具错误的正文在 toolResult 里：text 为空时预览必须退回它", () => {
    // 解析器把 `tool_result` 正文放进 `toolResult`，只有 API 错误才落在 `text`
    // （见 parseJsonl.ts 的 `pending.toolResult` / `isApiErrorMessage`）。只看
    // `text` 会让最常见的工具错误预览恒为空——卡片上只剩一个工具名。
    const events = eventsOf(
      [
        inputOf({
          projectLabel: "alpha",
          path: "/repo/alpha/errors.jsonl",
          records: [
            record(NOW - MINUTE, undefined, {
              id: "tool-error",
              fullId: "tool-error",
              kind: "tool",
              toolName: "Bash",
              isError: true,
              text: "",
              toolResult: "Exit code 2\n  at /Users/alice/private/a.ts:3:1"
            })
          ]
        })
      ],
      [],
      NOW
    );

    const errors = events.filter((event) => event.kind === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].detail).toBe("Bash");
    expect(errors[0].preview).toContain("Exit code 2");
    // 只取首行；第二行（带绝对路径的那行）不该进来。
    expect(errors[0].preview).not.toContain("alice");
  });

  it("预览按码点截断 80：不会把 emoji 劈成孤立代理项", () => {
    // 79 个汉字打底，第 80 个位置放一个 emoji（UTF-16 占两个码元）。
    // 按 `slice(0, 80)` 截会在第 80 个码元处把它劈成两半。
    const emoji = "🚀";
    const text = "字".repeat(79) + emoji + "尾巴";
    const events = eventsOf(
      [
        inputOf({
          projectLabel: "alpha",
          path: "/repo/alpha/emoji.jsonl",
          records: [
            record(NOW - MINUTE, undefined, {
              id: "emoji-error",
              fullId: "emoji-error",
              kind: "tool",
              toolName: "Bash",
              isError: true,
              text
            })
          ]
        })
      ],
      [],
      NOW
    );

    const preview = events.find((event) => event.kind === "error")?.preview ?? "";
    expect([...preview]).toHaveLength(80);
    expect(preview).toContain(emoji);
    // 没有孤立代理项（U+D800–U+DFFF 单出现在字符串里就是被劈过的证据）。
    expect(preview).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(preview).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("会话开始取每会话首条有效时间戳记录，坏时间戳不抢首条", () => {
    const path = "/repo/alpha/start.jsonl";
    const events = eventsOf(
      [
        inputOf({
          projectLabel: "alpha",
          path,
          records: [
            record(Number.NaN, undefined, { kind: "user", text: "bad" }),
            record(NOW - 5 * MINUTE, undefined, {
              kind: "user",
              fullId: "start-5",
              text: "first"
            }),
            record(NOW - 4 * MINUTE, undefined, {
              kind: "user",
              fullId: "start-4",
              text: "second"
            })
          ],
          session: meta(path, "alpha", {
            sessionId: "abcdef123456",
            customTitle: "Alpha task"
          })
        })
      ],
      [],
      NOW
    );

    const starts = events.filter((event) => event.kind === "session");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      at: NOW - 5 * MINUTE,
      detail: "",
      preTokens: null,
      preview: "",
      sessionPath: path,
      sessionTitle: "Alpha task",
      projectLabel: "alpha"
    });
  });

  it("跨会话时间倒序，默认 12 条，给 13 条也只留最近 12 条", () => {
    const inputs = Array.from({ length: 13 }, (_, index) =>
      inputOf({
        projectLabel: index % 2 === 0 ? "alpha" : "beta",
        path: `/repo/project-${index}/s-${index}.jsonl`,
        records: [
          record(NOW - (13 - index) * MINUTE, undefined, {
            kind: "user",
            fullId: `start-${index}`,
            text: `start ${index}`
          })
        ]
      })
    );

    const events = eventsOf(inputs, [], NOW);

    expect(events).toHaveLength(12);
    expect(events[0].at).toBe(NOW - MINUTE);
    expect(events.at(-1)?.at).toBe(NOW - 12 * MINUTE);
    expect(eventsOf(inputs, [], NOW, 13)).toHaveLength(13);
    expect(eventsOf(inputs, [], NOW, 0)).toEqual([]);
  });

  it("压缩保留 trigger 与 preTokens 原样，未来事件不计", () => {
    const events = eventsOf(
      [
        inputOf({
          projectLabel: "alpha",
          records: [],
          compactEvents: [
            compact(NOW - 2 * MINUTE, "auto", 12_345),
            compact(NOW - MINUTE, "manual", null),
            compact(NOW + 1, "auto", 99_999)
          ]
        })
      ],
      [],
      NOW
    );

    expect(events.map((event) => [event.detail, event.preTokens])).toEqual([
      ["manual", null],
      ["auto", 12_345]
    ]);
  });

  it("同一路径的多份输入只产生一个会话开始", () => {
    const path = "/repo/alpha/shared.jsonl";
    const shared = meta(path, "alpha");
    const events = eventsOf(
      [
        inputOf({
          projectLabel: "alpha",
          path,
          session: shared,
          records: [record(NOW - 3 * MINUTE, undefined, { kind: "user", fullId: "a" })]
        }),
        inputOf({
          projectLabel: "alpha",
          path,
          session: shared,
          records: [record(NOW - 2 * MINUTE, undefined, { kind: "user", fullId: "b" })]
        })
      ],
      [],
      NOW
    );

    expect(events.filter((event) => event.kind === "session")).toHaveLength(1);
  });

  it("空输入与无效 now 返回空事件流", () => {
    expect(eventsOf([], [], NOW)).toEqual([]);
    expect(eventsOf([], [], Number.NaN)).toEqual([]);
  });
});

describe("consoleModelOf", () => {
  it("一次组装今天总量、压缩数、项目榜、24 桶与事件流", () => {
    const inputs = fixtureInputs();
    const report = consoleModelOf(inputs, [], NOW);

    expect(report.now).toBe(NOW);
    expect(report.todayTokens).toBe(1_170);
    expect(report.todayCompactions).toBe(2);
    expect(report.projects.map((project) => project.projectLabel)).toEqual([
      "alpha",
      "beta"
    ]);
    expect(report.hourly).toHaveLength(24);
    expect(report.hourly.reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(
      report.todayTokens
    );
    expect(report.events).toHaveLength(6);
    expect(report.events.filter((event) => event.kind === "compaction")).toHaveLength(2);
    expect(report.events.filter((event) => event.kind === "error")).toHaveLength(2);
    expect(report.events.filter((event) => event.kind === "session")).toHaveLength(2);
  });

  it("重复路径合并 token、今天压缩与会话开始，不重复记账", () => {
    const path = "/repo/alpha/shared.jsonl";
    const shared = meta(path, "alpha");
    const report = consoleModelOf(
      [
        inputOf({
          projectLabel: "alpha",
          path,
          session: shared,
          records: [
            record(localAt(10, 0), usage(100), { kind: "user", fullId: "shared-start" })
          ],
          compactEvents: [compact(localAt(10, 5), "auto", 100)]
        }),
        inputOf({
          projectLabel: "alpha",
          path,
          session: shared,
          records: [record(localAt(10, 6), usage(200))],
          compactEvents: [compact(localAt(10, 7), "manual", 200)]
        })
      ],
      [row("alpha", path)],
      NOW
    );

    expect(report.todayTokens).toBe(300);
    expect(report.todayCompactions).toBe(2);
    expect(report.projects).toHaveLength(1);
    expect(report.events.filter((event) => event.kind === "session")).toHaveLength(1);
  });

  it("有效 now 的空输入仍给一天 24 个零桶", () => {
    const report = consoleModelOf([], [], NOW);

    expect(report).toMatchObject({
      now: NOW,
      todayTokens: 0,
      todayCompactions: 0,
      projects: [],
      events: []
    });
    expect(report.hourly).toHaveLength(24);
    expect(report.hourly.filter((bucket) => bucket.partial)).toHaveLength(1);
  });

  it("无效 now 返回可渲染的空壳，不产生 NaN", () => {
    const report = consoleModelOf([], [], Number.NaN);

    expect(report).toEqual({
      now: Number.NaN,
      todayTokens: 0,
      todayCompactions: 0,
      projects: [],
      hourly: [],
      events: []
    });
  });
});
