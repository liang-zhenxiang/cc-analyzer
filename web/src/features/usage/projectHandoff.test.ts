import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import {
  GAP_MAX,
  GAP_MIN,
  HANDOFF_VISIBLE_SESSIONS,
  buildProjectHandoff,
  formatEchoAria,
  formatEchoLine,
  formatLastAction,
  handoffGapLabel,
  handoffGapPx
} from "./projectHandoff";

/**
 * 夹具全部手造，期望值按夹具手算写死在断言里——不把函数输出读回来当期望。
 * 时间一律用 `new Date(年, 月-1, 日, 时, 分)` 构造**本地时间**；`now` 固定
 * 注入，模型层不读当前时钟。
 */

let seq = 0;

function record(
  kind: SessionRecord["kind"],
  timestamp: number,
  patch: Partial<SessionRecord> = {}
): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind,
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function user(
  timestamp: number,
  text: string,
  patch: Partial<SessionRecord> = {}
): SessionRecord {
  return record("user", timestamp, { text, ...patch });
}

function tool(
  timestamp: number,
  toolName?: string,
  patch: Partial<SessionRecord> = {}
): SessionRecord {
  return record("tool", timestamp, { toolName, text: "", ...patch });
}

function meta(
  path: string,
  mtimeMs: number,
  patch: Partial<SessionMeta> = {}
): SessionMeta {
  return {
    path,
    mtimeMs,
    sizeBytes: 0,
    projectLabel: "encoded-label",
    hasRecords: true,
    ...patch
  };
}

function input(
  projectLabel: string,
  projectPath: string | undefined,
  records: SessionRecord[],
  session?: SessionMeta
): UsageSessionInput {
  return { projectLabel, projectPath, records, ...(session ? { session } : {}) };
}

/** 2026 年本地时间。 */
function at(month: number, dayOfMonth: number, hour: number, minute = 0): number {
  return new Date(2026, month - 1, dayOfMonth, hour, minute).getTime();
}

const NOW = at(11, 10, 12, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;

function readTool(at_: number, filePath = "/work/alpha/src/index.ts"): SessionRecord {
  return tool(at_, "Read", { toolInput: { file_path: filePath } });
}

const editResult = (filePath: string) => ({
  toolName: "Edit" as const,
  filePath,
  oldString: "",
  newString: "",
  replaceAll: false,
  structuredPatch: null
});

/** 单会话项目：返回它的轨道（测试主要看 `track.sessions[0]`）。 */
function trackFor(
  records: SessionRecord[],
  options: { label?: string; cwd?: string; path?: string; mtime?: number } = {}
): NonNullable<ReturnType<typeof buildProjectHandoff>["track"]> {
  const label = options.label ?? "-work-alpha";
  const cwd = options.cwd ?? "/work/alpha";
  const h = buildProjectHandoff(
    [
      input(
        label,
        cwd,
        records,
        meta(options.path ?? `${cwd}/s.jsonl`, options.mtime ?? NOW, {
          projectLabel: label
        })
      )
    ],
    3,
    NOW
  );
  if (!h.track) throw new Error("fixture 应当有轨道");
  return h.track;
}

describe("分组与命名", () => {
  it("按 projectLabel 分组：同名不同 label 是两个项目，并按切换条顺序追加（2）", () => {
    const longer = input(
      "-work-x-alpha",
      "/work/x/alpha",
      [readTool(at(11, 10, 10, 0), "/work/x/alpha/a.ts")],
      meta("/work/x/alpha/s1.jsonl", at(11, 10, 10, 0), {
        projectLabel: "-work-x-alpha"
      })
    );
    const older = input(
      "-repo-x-alpha",
      "/repo/x/alpha",
      [readTool(at(11, 10, 9, 0), "/repo/x/alpha/b.ts")],
      meta("/repo/x/alpha/s2.jsonl", at(11, 10, 9, 0), {
        projectLabel: "-repo-x-alpha"
      })
    );

    const handoff = buildProjectHandoff([older, longer], 3, NOW);

    expect(handoff.projects).toHaveLength(2);
    expect(handoff.projects.map((project) => project.key)).toEqual([
      "-work-x-alpha",
      "-repo-x-alpha"
    ]);
    expect(handoff.projects.map((project) => project.name)).toEqual([
      "alpha",
      "alpha（2）"
    ]);
  });

  it("分组键是 projectLabel，不是显示名", () => {
    const handoff = buildProjectHandoff(
      [
        input("-a-same", "/x/same", [readTool(NOW, "/x/same/a.ts")], meta("/x/same/a.jsonl", NOW)),
        input("-b-same", "/y/same", [readTool(NOW, "/y/same/b.ts")], meta("/y/same/b.jsonl", NOW))
      ],
      3,
      NOW
    );

    expect(handoff.projects.map((project) => project.key)).toEqual([
      "-a-same",
      "-b-same"
    ]);
    expect(handoff.projects.map((project) => project.name)).toEqual([
      "same",
      "same（2）"
    ]);
  });

  it("项目名为空 → 未命名项目；无 cwd 时退回去掉前导 - 的名称", () => {
    const handoff = buildProjectHandoff(
      [
        input("", undefined, [readTool(NOW, "/nowhere/a.ts")], meta("/nowhere/a.jsonl", NOW, { projectLabel: "" })),
        input("-c-unnamed", undefined, [readTool(NOW - HOUR, "/c/a.ts")], meta("/c/a.jsonl", NOW - HOUR))
      ],
      3,
      NOW
    );

    // `formatProjectPath` 对空 label / 无 cwd 的 -c-unnamed 分别给出空串与
    // 去掉前导 `-` 的 `c-unnamed`，所以只有第一个是「未命名项目」。
    expect(handoff.projects[0].name).toBe("未命名项目");
    expect(handoff.projects[1].name).toBe("c-unnamed");
  });
});

describe("窗口", () => {
  it("左界（窗口起点）与右界（now）都含；now 之后的时间戳不进", () => {
    const start = new Date(2026, 10, 8, 0, 0).getTime();
    const track = trackFor([
      tool(start, "Read", { toolInput: { file_path: "/work/alpha/start.ts" } }),
      tool(NOW, "Write", { toolInput: { file_path: "/work/alpha/end.ts" } }),
      tool(NOW + 1, "Bash", { toolInput: { command: "rm -rf /" } })
    ]);

    expect(track.sessions).toHaveLength(1);
    expect(track.sessions[0].startTs).toBe(start);
    expect(track.sessions[0].endTs).toBe(NOW);
    // 窗口外的未来工具记录不是「末动作」。
    expect(formatLastAction(track.sessions[0].lastAction)).toBe("改 end.ts");
  });

  it("跨窗口起点的长会话按窗口内首条记录计", () => {
    const track = trackFor([
      tool(at(11, 7, 23, 0), "Read", { toolInput: { file_path: "/work/alpha/before.ts" } }),
      tool(at(11, 8, 1, 0), "Read", { toolInput: { file_path: "/work/alpha/first.ts" } }),
      tool(at(11, 9, 1, 0), "Read", { toolInput: { file_path: "/work/alpha/last.ts" } })
    ]);

    expect(track.sessions[0].startTs).toBe(at(11, 8, 1, 0));
    expect(track.sessions[0].endTs).toBe(at(11, 9, 1, 0));
    expect(formatLastAction(track.sessions[0].lastAction)).toBe("读 last.ts");
  });

  it("窗口天数归一：0 / 负数 / 非有限值都至少 1 天", () => {
    const window = buildProjectHandoff([], 0, NOW).window;
    expect(window.days).toBe(1);
    expect(window.startTs).toBe(new Date(2026, 10, 10, 0, 0).getTime());
    expect(window.rightTs).toBe(NOW);

    const nan = buildProjectHandoff([], Number.NaN, NOW).window;
    expect(nan.days).toBe(1);
  });
});

describe("排序与确定性", () => {
  it("项目按 lastStartTs 降序 → sessions 降序 → 名称 → key", () => {
    const handoff = buildProjectHandoff(
      [
        input("-p-late", "/p/late", [readTool(at(11, 10, 11, 0))], meta("/p/late/a.jsonl", NOW)),
        input(
          "-p-alpha",
          "/p/alpha",
          [readTool(at(11, 10, 10, 0), "/p/alpha/a.ts")],
          meta("/p/alpha/a.jsonl", NOW)
        ),
        input(
          "-p-alpha",
          "/p/alpha",
          [readTool(at(11, 10, 9, 0), "/p/alpha/b.ts")],
          meta("/p/alpha/b.jsonl", NOW)
        ),
        input("-p-beta", "/p/beta", [readTool(at(11, 10, 10, 0))], meta("/p/beta/a.jsonl", NOW))
      ],
      3,
      NOW
    );

    expect(handoff.projects.map((project) => project.name)).toEqual([
      "late",
      "alpha",
      "beta"
    ]);
    expect(handoff.projects.map((project) => project.sessions)).toEqual([1, 2, 1]);
  });

  it("同名项目在同 lastStartTs / 同会话数时按 key 排序，再按顺序加后缀", () => {
    const handoff = buildProjectHandoff(
      [
        input("-z-alpha", "/z/alpha", [readTool(NOW)], meta("/z/alpha/a.jsonl", NOW)),
        input("-a-alpha", "/a/alpha", [readTool(NOW)], meta("/a/alpha/a.jsonl", NOW))
      ],
      3,
      NOW
    );

    expect(handoff.projects.map((project) => project.key)).toEqual([
      "-a-alpha",
      "-z-alpha"
    ]);
    expect(handoff.projects.map((project) => project.name)).toEqual([
      "alpha",
      "alpha（2）"
    ]);
  });

  it("会话按 startTs 升序，同一时刻按 id 字典序", () => {
    const handoff = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [readTool(NOW, "/p/x/late.ts")], meta("/p/x/z.jsonl", NOW, { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [readTool(at(11, 10, 10, 0), "/p/x/a.ts")], meta("/p/x/b.jsonl", NOW, { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [readTool(at(11, 10, 10, 0), "/p/x/b.ts")], meta("/p/x/a.jsonl", NOW, { projectLabel: "-p-x" }))
      ],
      3,
      NOW
    );

    expect(handoff.track?.sessions.map((session) => session.id)).toEqual([
      "path:/p/x/a.jsonl",
      "path:/p/x/b.jsonl",
      "path:/p/x/z.jsonl"
    ]);
  });

  it("同一输入两次得到完全一致的结果", () => {
    const inputs = [
      input("-p-a", "/p/a", [user(at(11, 9, 10, 0), "alpha beta gamma delta")], meta("/p/a/s.jsonl", at(11, 9, 10, 0))),
      input("-p-a", "/p/a", [user(at(11, 10, 10, 0), "alpha beta gamma delta")], meta("/p/a/t.jsonl", at(11, 10, 10, 0))),
      input("-p-b", "/p/b", [readTool(at(11, 10, 11, 0))], meta("/p/b/s.jsonl", NOW))
    ];

    expect(buildProjectHandoff(inputs, 3, NOW)).toEqual(
      buildProjectHandoff(inputs, 3, NOW)
    );
  });
});

describe("末动作", () => {
  it("Edit / Write / MultiEdit / NotebookEdit → 改 <basename>", () => {
    const edit = trackFor([
      tool(NOW, "Edit", { structuredResult: editResult("/work/alpha/src/foo.ts") })
    ]);
    expect(edit.sessions[0].lastAction).toEqual({
      kind: "file",
      verb: "改",
      name: "foo.ts",
      tool: "Edit"
    });
    expect(formatLastAction(edit.sessions[0].lastAction)).toBe("改 foo.ts");

    const write = trackFor([
      tool(NOW, "Write", { toolInput: { file_path: "/work/alpha/docs/readme.md" } })
    ]);
    expect(formatLastAction(write.sessions[0].lastAction)).toBe("改 readme.md");

    const multi = trackFor([
      tool(NOW, "MultiEdit", { toolInput: { file_path: "/work/alpha/src/multi.ts" } })
    ]);
    expect(formatLastAction(multi.sessions[0].lastAction)).toBe("改 multi.ts");

    const notebook = trackFor([
      tool(NOW, "NotebookEdit", { toolInput: { file_path: "/work/alpha/nb.ipynb" } })
    ]);
    expect(formatLastAction(notebook.sessions[0].lastAction)).toBe("改 nb.ipynb");
  });

  it("structuredResult.filePath 优先于 toolInput.file_path", () => {
    const track = trackFor([
      tool(NOW, "Edit", {
        toolInput: { file_path: "/work/alpha/wrong.ts" },
        structuredResult: editResult("/work/alpha/right.ts")
      })
    ]);

    expect(formatLastAction(track.sessions[0].lastAction)).toBe("改 right.ts");
  });

  it("Read → 读 <basename>", () => {
    const track = trackFor([
      tool(NOW, "Read", { toolInput: { file_path: "/work/alpha/src/index.ts" } })
    ]);
    expect(formatLastAction(track.sessions[0].lastAction)).toBe("读 index.ts");
  });

  it("Bash → 前 3 个 token；命中凭据样式只留命令名", () => {
    const normal = trackFor([
      tool(NOW, "Bash", { toolInput: { command: "npm run build --x" } })
    ]);
    expect(normal.sessions[0].lastAction).toEqual({
      kind: "command",
      command: "npm run build",
      tool: "Bash"
    });
    expect(formatLastAction(normal.sessions[0].lastAction)).toBe(
      "Bash · npm run build"
    );

    const secret = trackFor([
      tool(NOW, "Bash", {
        toolInput: { command: "GITHUB_TOKEN=ghp_abc gh pr list --token abc" }
      })
    ]);
    expect(formatLastAction(secret.sessions[0].lastAction)).toBe("Bash · gh");
  });

  it("Bash 没有命令原文时不冒充命令；工具名缺失 → 未知工具", () => {
    const bare = trackFor([tool(NOW, "Bash", { toolInput: {} })]);
    expect(bare.sessions[0].lastAction).toEqual({ kind: "tool", tool: "Bash" });

    const anon = trackFor([tool(NOW, undefined)]);
    expect(anon.sessions[0].lastAction).toEqual({ kind: "tool", tool: "未知工具" });
    expect(formatLastAction(anon.sessions[0].lastAction)).toBe("未知工具");
  });

  it("没有工具记录 → none；末动作取最后一条工具，不是最后一条记录", () => {
    const none = trackFor([user(NOW, "只说了句话")]);
    expect(none.sessions[0].lastAction).toEqual({ kind: "none" });
    expect(formatLastAction(none.sessions[0].lastAction)).toBe("无工具调用");

    const track = trackFor([
      tool(at(11, 10, 10, 0), "Read", { toolInput: { file_path: "/work/alpha/a.ts" } }),
      user(at(11, 10, 10, 5), "工具之后的助手文本")
    ]);
    expect(formatLastAction(track.sessions[0].lastAction)).toBe("读 a.ts");
  });

  it("其他带 file_path 的工具 → 工具名 · basename；不带路径 → 工具名", () => {
    const grep = trackFor([
      tool(NOW, "Grep", { toolInput: { file_path: "/work/alpha/README.md" } })
    ]);
    expect(grep.sessions[0].lastAction).toEqual({
      kind: "tool",
      tool: "Grep · README.md"
    });

    const plain = trackFor([tool(NOW, "TodoWrite", { toolInput: { todos: [] } })]);
    expect(formatLastAction(plain.sessions[0].lastAction)).toBe("TodoWrite");
  });

  it("任何末动作都不含绝对路径", () => {
    const actions = [
      trackFor([tool(NOW, "Edit", { structuredResult: editResult("/Users/x/secret/foo.ts") })]),
      trackFor([tool(NOW, "Read", { toolInput: { file_path: "/Users/x/secret/bar.ts" } })]),
      trackFor([tool(NOW, "Bash", { toolInput: { command: "cat /Users/x/secret/.env" } })])
    ].map((track) => formatLastAction(track.sessions[0].lastAction));

    for (const text of actions) {
      expect(text).not.toContain("/Users");
      expect(text).not.toContain("/");
    }
  });
});

describe("时间未知的会话", () => {
  const invalid = (at_: number) =>
    record("user", at_, { text: "没有可用时间戳的记录", missingTimestamp: true });

  it("有记录但无有效时间戳 + mtime 在窗口内 → 计数，不进轨道", () => {
    const handoff = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [readTool(at(11, 10, 10, 0))], meta("/p/x/a.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [invalid(0)], meta("/p/x/b.jsonl", at(11, 10, 11, 0), { projectLabel: "-p-x" }))
      ],
      3,
      NOW
    );

    expect(handoff.projects[0].unknownSessions).toBe(1);
    expect(handoff.track?.sessions).toHaveLength(1);
    expect(handoff.track?.emptyReason).toBe("single-session");
    expect(handoff.track?.unknownSessions).toBe(1);
    expect(handoff.track?.sessions[0].startTs).toBe(at(11, 10, 10, 0));
  });

  it("mtime 在窗口外、没有 meta、没有记录 → 都不计", () => {
    const handoff = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [readTool(at(11, 10, 10, 0))], meta("/p/x/a.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-x" })),
        // mtime 在窗口右界之后
        input("-p-x", "/p/x", [invalid(0)], meta("/p/x/b.jsonl", NOW + 1, { projectLabel: "-p-x" })),
        // 没有 SessionMeta
        input("-p-x", "/p/x", [invalid(0)]),
        // 没有任何记录
        input("-p-x", "/p/x", [], meta("/p/x/d.jsonl", at(11, 10, 11, 0), { projectLabel: "-p-x" }))
      ],
      3,
      NOW
    );

    expect(handoff.projects[0].unknownSessions).toBe(0);
  });

  it("0 可定位 + N 未知 → all-unknown，且未知会话不进 sessions", () => {
    const handoff = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [invalid(0)], meta("/p/x/a.jsonl", NOW, { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [invalid(0)], meta("/p/x/b.jsonl", NOW - HOUR, { projectLabel: "-p-x" }))
      ],
      3,
      NOW,
      "-p-x"
    );

    expect(handoff.projects).toEqual([]);
    expect(handoff.activeKey).toBe("-p-x");
    expect(handoff.track?.emptyReason).toBe("all-unknown");
    expect(handoff.track?.sessions).toEqual([]);
    expect(handoff.track?.unknownSessions).toBe(2);
    expect(handoff.track?.project?.name).toBe("x");
  });

  it("没有可定位会话且没有 activeKey → 没有项目、没有轨道", () => {
    const handoff = buildProjectHandoff(
      [input("-p-x", "/p/x", [invalid(0)], meta("/p/x/a.jsonl", NOW, { projectLabel: "-p-x" }))],
      3,
      NOW
    );

    expect(handoff.projects).toEqual([]);
    expect(handoff.activeKey).toBeNull();
    expect(handoff.track).toBeNull();
  });
});

describe("间隔文案与像素", () => {
  function gapSessions(previousTs: number, currentTs: number, days = 90, now = NOW) {
    const handoff = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [readTool(previousTs, "/p/x/a.ts")], meta("/p/x/a.jsonl", previousTs, { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [readTool(currentTs, "/p/x/b.ts")], meta("/p/x/b.jsonl", currentTs, { projectLabel: "-p-x" }))
      ],
      days,
      now
    );
    if (!handoff.track) throw new Error("fixture 应当有轨道");
    return handoff.track.sessions[1];
  }

  it("同时、同日、次日、N 天后", () => {
    const same = gapSessions(at(11, 10, 9, 0), at(11, 10, 9, 0));
    expect(same.gapMs).toBe(0);
    expect(same.gapLabel).toBe("同时");

    const sameDay = gapSessions(at(11, 10, 9, 0), at(11, 10, 11, 0));
    expect(sameDay.gapLabel).toBe("同日 · 2 小时后");

    const nextDay = gapSessions(at(11, 8, 10, 0), at(11, 9, 12, 0));
    expect(nextDay.gapMs).toBe(26 * HOUR);
    // 规则是 `${formatDuration(gapMs)}后`；26 小时按既有中文档位写成「1 天 2 小时」。
    expect(nextDay.gapLabel).toBe("次日 · 1 天 2 小时后");

    const nextDayLong = gapSessions(at(11, 8, 2, 0), at(11, 9, 20, 0));
    expect(nextDayLong.gapMs).toBe(42 * HOUR);
    expect(nextDayLong.gapLabel).toBe("1 天后");

    const threeDays = gapSessions(at(11, 7, 10, 0), at(11, 10, 10, 0));
    expect(threeDays.gapLabel).toBe("3 天后");

    const long = gapSessions(at(10, 4, 12, 0), at(11, 10, 12, 0));
    expect(long.gapLabel).toBe("37 天后");
  });

  it("gapPx 单调不减，触底 44、触顶 140，永不为负/NaN", () => {
    const values = [
      0,
      30 * 60_000,
      HOUR - 1,
      HOUR,
      2 * HOUR,
      6 * HOUR,
      12 * HOUR,
      DAY,
      3 * DAY,
      7 * DAY,
      30 * DAY,
      90 * DAY
    ];
    const pixels = values.map((value) => handoffGapPx(value));

    expect(pixels[0]).toBe(GAP_MIN);
    expect(handoffGapPx(HOUR - 1)).toBe(GAP_MIN);
    expect(handoffGapPx(HOUR)).toBe(GAP_MIN);
    expect(handoffGapPx(2 * HOUR)).toBeCloseTo(52, 6);
    expect(handoffGapPx(6 * HOUR)).toBeCloseTo(64.68, 1);
    expect(handoffGapPx(12 * HOUR)).toBeCloseTo(72.68, 1);
    expect(handoffGapPx(DAY)).toBeCloseTo(80.68, 1);
    expect(handoffGapPx(3 * DAY)).toBeCloseTo(93.36, 1);
    expect(handoffGapPx(7 * DAY)).toBeCloseTo(103.14, 1);
    expect(handoffGapPx(30 * DAY)).toBeCloseTo(119.93, 1);
    // 90 天窗口内最大约 132.6（安全网 140 通常碰不到）。
    expect(handoffGapPx(90 * DAY)).toBeCloseTo(132.61, 1);
    expect(handoffGapPx(90 * DAY)).toBeLessThanOrEqual(GAP_MAX);

    // 未触底（> 1 小时）且未触顶时严格递增。
    for (let index = 1; index < values.length; index += 1) {
      const previous = pixels[index - 1];
      const current = pixels[index];
      expect(current).toBeGreaterThanOrEqual(previous);
      if (values[index - 1] > HOUR && current < GAP_MAX) {
        expect(current).toBeGreaterThan(previous);
      }
    }

    expect(handoffGapPx(365 * DAY)).toBe(GAP_MAX);
    expect(handoffGapPx(-1)).toBe(GAP_MIN);
    expect(handoffGapPx(Number.NaN)).toBe(GAP_MIN);
    for (const pixel of [handoffGapPx(-1), handoffGapPx(Number.NaN), handoffGapPx(365 * DAY)]) {
      expect(Number.isFinite(pixel)).toBe(true);
      expect(pixel).toBeGreaterThanOrEqual(GAP_MIN);
      expect(pixel).toBeLessThanOrEqual(GAP_MAX);
    }
  });

  it("跨夏令时用 Math.round 的本地日键，不用 +86_400_000 推日键（TZ=America/New_York）", (ctx) => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 前提自检：2026-03-08 是美国春令时，当天只有 23 小时。
      const springDay = new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime();
      if (springDay !== 23 * HOUR) {
        ctx.skip();
        return;
      }

      const hidden = gapSessions(
        new Date(2026, 2, 7, 12, 0).getTime(),
        new Date(2026, 2, 8, 12, 0).getTime(),
        5,
        new Date(2026, 2, 10, 12, 0).getTime()
      );
      expect(hidden.gapMs).toBe(23 * HOUR);
      // 日差是 1 天（不是 0）；`+86_400_000` 推日键会落到 01:00 并算出 0。
      expect(hidden.gapLabel).toBe("次日 · 23 小时后");

      const fall = gapSessions(
        new Date(2026, 9, 31, 12, 0).getTime(),
        new Date(2026, 10, 1, 12, 0).getTime(),
        5,
        new Date(2026, 10, 3, 12, 0).getTime()
      );
      expect(fall.gapMs).toBe(25 * HOUR);
      expect(fall.gapLabel?.startsWith("次日 · ")).toBe(true);
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("handoffGapLabel 直接喂毫秒也遵守同一口径", () => {
    const previous = at(11, 10, 9, 0);
    expect(handoffGapLabel(2 * HOUR, previous, previous + 2 * HOUR)).toBe(
      "同日 · 2 小时后"
    );
    expect(handoffGapLabel(0, previous, previous)).toBe("同时");
  });
});

describe("回声评分", () => {
  const words = (prefix: string, from: number, to: number): string[] => {
    const list: string[] = [];
    for (let index = from; index <= to; index += 1) {
      list.push(`${prefix}${String(index).padStart(2, "0")}`);
    }
    return list;
  };

  function pairEcho(previousClosing: string, currentOpening: string) {
    const handoff = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [user(at(11, 9, 10, 0), previousClosing)], meta("/p/x/a.jsonl", at(11, 9, 10, 0), { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [user(at(11, 10, 10, 0), currentOpening)], meta("/p/x/b.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-x" }))
      ],
      3,
      NOW
    );
    if (!handoff.track) throw new Error("fixture 应当有轨道");
    return handoff.track.sessions[1].echo;
  }

  it("命中恰好 0.55：显示 55%，达到阈值 55%", () => {
    // A 14 个词，B 17 个词，交集 11 → Jaccard = 11 / (14 + 17 - 11) = 0.55。
    const a = words("a", 1, 14).join(" ");
    const b = [...words("a", 1, 11), ...words("b", 12, 17)].join(" ");
    const echo = pairEcho(a, b);

    expect(echo.status).toBe("scored");
    if (echo.status !== "scored") return;
    expect(echo.score).toBeCloseTo(0.55, 10);
    expect(echo.hit).toBe(true);
    expect(echo.percent).toBe(55);
    expect(formatEchoLine(echo)).toBe(
      "本次开头与上次结尾重合 55%，达到阈值 55%。"
    );
    expect(formatEchoAria(echo)).toBe("开头与上次结尾重合 55%");
  });

  it("未命中（54%）仍报出真实分数与阈值", () => {
    // 交集 6，并集 11 → 0.5454… → 向下取整 54%。
    const a = words("a", 1, 6).join(" ");
    const b = [...words("a", 1, 6), ...words("c", 7, 11)].join(" ");
    const echo = pairEcho(a, b);

    expect(echo.status).toBe("scored");
    if (echo.status !== "scored") return;
    expect(echo.score).toBeGreaterThan(0.54);
    expect(echo.score).toBeLessThan(0.55);
    expect(echo.hit).toBe(false);
    expect(echo.percent).toBe(54);
    expect(formatEchoLine(echo)).toBe(
      "本次开头与上次结尾重合 54%，低于阈值 55%。"
    );
  });

  it("0 显示 0%；>0 但不足 1% 显示 <1%", () => {
    const disjoint = pairEcho(words("x", 1, 6).join(" "), words("y", 1, 6).join(" "));
    expect(disjoint.status).toBe("scored");
    if (disjoint.status !== "scored") return;
    expect(disjoint.percent).toBe(0);
    expect(formatEchoLine(disjoint)).toBe("本次开头与上次结尾重合 0%。");

    // 两条各有 149 个汉字 bigram 的串，只共享一个 bigram → 1 / 297 ≈ 0.34%。
    const cjk = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => String.fromCodePoint(start + index)).join("");
    const previous = cjk(0x4e00, 150);
    const current = `${String.fromCodePoint(0x4e00)}${String.fromCodePoint(0x4e01)}${cjk(0x5000, 148)}`;
    const tiny = pairEcho(previous, current);
    expect(tiny.status).toBe("scored");
    if (tiny.status !== "scored") return;
    expect(tiny.score).toBeGreaterThan(0);
    expect(tiny.score).toBeLessThan(0.01);
    expect(tiny.percent).toBe("lt1");
    expect(formatEchoLine(tiny)).toBe("本次开头与上次结尾重合 <1%。");
  });

  it("窗口内第一条 → no-previous", () => {
    const track = trackFor([user(NOW, "alpha beta gamma delta")]);
    expect(track.sessions[0].echo).toEqual({ status: "no-previous" });
    expect(track.sessions[0].previousClosing).toBeNull();
    expect(formatEchoLine(track.sessions[0].echo)).toBe(
      "这是窗口内这个项目最早的一次会话。"
    );
    expect(formatEchoAria(track.sessions[0].echo)).toBeNull();
  });

  it("previousClosing 就是上一次会话的结尾预览；缺上一次结尾时为 null", () => {
    const handoff = buildProjectHandoff(
      [
        input(
          "-p-x",
          "/p/x",
          [
            user(at(11, 9, 10, 0), "alice bob carol dave"),
            user(at(11, 9, 20, 0), "上一次会话的结尾在这里")
          ],
          meta("/p/x/a.jsonl", at(11, 9, 10, 0), { projectLabel: "-p-x" })
        ),
        input(
          "-p-x",
          "/p/x",
          [user(at(11, 10, 10, 0), "eve frank grace heidi")],
          meta("/p/x/b.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-x" })
        )
      ],
      3,
      NOW
    );
    if (!handoff.track) throw new Error("fixture 应当有轨道");
    const [previous, current] = handoff.track.sessions;

    // 打分参与的两句话都能在会话对象上读到：本次开头 + 上次结尾。
    expect(current.previousClosing).toEqual(previous.closing);
    expect(current.previousClosing?.preview).toBe("上一次会话的结尾在这里");

    // 上一次没有用户结尾（只有工具记录）→ 没有可显示/可比较的那句话。
    const missing = buildProjectHandoff(
      [
        input(
          "-p-x",
          "/p/x",
          [tool(at(11, 9, 10, 0), "Read", { toolInput: { file_path: "/p/x/a.ts" } })],
          meta("/p/x/a.jsonl", at(11, 9, 10, 0), { projectLabel: "-p-x" })
        ),
        input(
          "-p-x",
          "/p/x",
          [user(at(11, 10, 10, 0), "eve frank grace heidi")],
          meta("/p/x/b.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-x" })
        )
      ],
      3,
      NOW
    );
    expect(missing.track?.sessions[1].previousClosing).toBeNull();
    expect(missing.track?.sessions[1].echo).toEqual({
      status: "insufficient",
      reason: "missing-closing"
    });
  });

  it("缺开头 / 缺上次结尾 / 文本太短 → 对应的 insufficient 理由", () => {
    const missingOpening = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [user(at(11, 9, 10, 0), "alpha beta gamma delta")], meta("/p/x/a.jsonl", at(11, 9, 10, 0), { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [tool(at(11, 10, 10, 0), "Read", { toolInput: { file_path: "/p/x/a.ts" } })], meta("/p/x/b.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-x" }))
      ],
      3,
      NOW
    );
    expect(missingOpening.track?.sessions[1].echo).toEqual({
      status: "insufficient",
      reason: "missing-opening"
    });
    expect(formatEchoLine(missingOpening.track!.sessions[1].echo)).toBe(
      "样本不足：首条或上次末条用户消息缺失。"
    );

    const missingClosing = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [tool(at(11, 9, 10, 0), "Read", { toolInput: { file_path: "/p/x/a.ts" } })], meta("/p/x/a.jsonl", at(11, 9, 10, 0), { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [user(at(11, 10, 10, 0), "alpha beta gamma delta")], meta("/p/x/b.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-x" }))
      ],
      3,
      NOW
    );
    expect(missingClosing.track?.sessions[1].echo).toEqual({
      status: "insufficient",
      reason: "missing-closing"
    });

    const shortText = pairEcho("修复", "alpha beta gamma delta");
    expect(shortText).toEqual({ status: "insufficient", reason: "short-text" });
    expect(formatEchoLine(shortText)).toBe(
      "样本不足：两条消息都太短（各需至少 4 个话题词）。"
    );
    expect(formatEchoAria(shortText)).toBe("重合度样本不足");
  });

  it("少于 4 个 token 的一侧就算样本不足（Jaccard 对极小集合过敏）", () => {
    const three = pairEcho(words("a", 1, 3).join(" "), words("a", 1, 6).join(" "));
    expect(three).toEqual({ status: "insufficient", reason: "short-text" });
  });
});

describe("消息筛选与隐私", () => {
  it("compactSummary / isInterrupt / commandName 的记录不参与开头结尾", () => {
    const track = trackFor([
      user(at(11, 10, 9, 0), "压缩摘要不是用户说的", { compactSummary: true }),
      user(at(11, 10, 9, 1), "[Request interrupted by user]", { isInterrupt: true }),
      user(at(11, 10, 9, 2), "/review 的包装文本", { commandName: "/review" }),
      user(at(11, 10, 9, 3), "真正的开头内容"),
      user(at(11, 10, 9, 4), "真正的结尾内容")
    ]);

    expect(track.sessions[0].opening?.preview).toBe("真正的开头内容");
    expect(track.sessions[0].closing?.preview).toBe("真正的结尾内容");
  });

  it("预览走既有脱敏规则；原文与绝对路径不出现在结果里", () => {
    const track = trackFor([
      user(
        NOW,
        "把 /Users/alice/Desktop/work/alpha/src/index.ts 里的 sk-abcdefghijklmnopqrstuvwxyz 换掉，再看 ?token=abcdefghijklmn 这个参数"
      )
    ]);

    const opening = track.sessions[0].opening;
    expect(opening).not.toBeNull();
    expect(opening?.redacted).toBe(true);
    expect(opening?.preview).not.toContain("/Users");
    expect(opening?.preview).not.toContain("alice");
    expect(opening?.preview).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(opening?.preview).toContain("sk-…");
    expect(opening?.preview).toContain("?…");

    const serialized = JSON.stringify(track);
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("展示预览截断 60，评分用 200（隐藏的 60–200 字符仍参与）", () => {
    const long = wordsText(20);
    const handoff = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [user(at(11, 8, 10, 0), long)], meta("/p/x/a.jsonl", at(11, 8, 10, 0), { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [user(at(11, 9, 10, 0), long.slice(0, 60)), user(at(11, 9, 11, 0), long)], meta("/p/x/b.jsonl", at(11, 9, 10, 0), { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [user(at(11, 10, 10, 0), long)], meta("/p/x/c.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-x" }))
      ],
      3,
      NOW
    );
    const sessions = handoff.track!.sessions;

    expect(sessions[1].opening!.preview.length).toBeLessThanOrEqual(60);
    expect(sessions[2].opening!.preview.length).toBeLessThanOrEqual(61);
    expect(sessions[2].opening!.preview).not.toBe(long);

    // 只看前 60 字时两条开头一样；评分用 200 字，所以完整的那条才拿满分。
    expect(sessions[1].echo.status).toBe("scored");
    expect(sessions[2].echo.status).toBe("scored");
    if (sessions[1].echo.status === "scored" && sessions[2].echo.status === "scored") {
      expect(sessions[1].echo.score).toBeLessThan(1);
      expect(sessions[2].echo.score).toBeCloseTo(1, 10);
    }
  });

  it("编码目录名不进项目名 / 会话标题", () => {
    const label = "-Users-alice-Desktop-work-alpha";
    const track = trackFor([user(NOW, "alpha beta gamma delta")], {
      label,
      cwd: "/Users/alice/Desktop/work/alpha"
    });
    // 标题没有自定义值时会退回 projectLabel；此处必须换成「未命名会话」。
    expect(track.sessions[0].title).toBe("未命名会话");
    expect(track.project?.name).toBe("alpha");
  });
});

function wordsText(count: number): string {
  return Array.from({ length: count }, (_, index) => `topic${String(index).padStart(2, "0")}`).join(" ");
}

describe("进行中", () => {
  it("距 now 120_000ms 含；120_001ms 不含；时间戳等于 now 也算", () => {
    const boundary = trackFor([user(NOW - 120_000, "alpha beta gamma delta")]);
    expect(boundary.sessions[0].inProgress).toBe(true);

    const past = trackFor([user(NOW - 120_001, "alpha beta gamma delta")]);
    expect(past.sessions[0].inProgress).toBe(false);

    const nowRecord = trackFor([user(NOW, "alpha beta gamma delta")]);
    expect(nowRecord.sessions[0].inProgress).toBe(true);
  });

  it("非最后节点也可命中（并行会话）", () => {
    const handoff = buildProjectHandoff(
      [
        input("-p-x", "/p/x", [tool(NOW - 60_000, "Read", { toolInput: { file_path: "/p/x/a.ts" } }), tool(NOW - 30_000, "Read", { toolInput: { file_path: "/p/x/a.ts" } })], meta("/p/x/a.jsonl", NOW - 30_000, { projectLabel: "-p-x" })),
        input("-p-x", "/p/x", [tool(NOW - 10_000, "Read", { toolInput: { file_path: "/p/x/b.ts" } })], meta("/p/x/b.jsonl", NOW - 10_000, { projectLabel: "-p-x" }))
      ],
      3,
      NOW
    );

    expect(handoff.track?.sessions).toHaveLength(2);
    expect(handoff.track?.sessions[0].inProgress).toBe(true);
    expect(handoff.track?.sessions[1].inProgress).toBe(true);
  });
});

describe("截断与全量返回", () => {
  it("40 个会话模型仍返回 40；可见条数是 12", () => {
    const inputs = Array.from({ length: 40 }, (_, index) => {
      const timestamp = NOW - (39 - index) * 60_000;
      return input(
        "-p-x",
        "/p/x",
        [user(timestamp, "alpha beta gamma delta")],
        meta(`/p/x/${index}.jsonl`, timestamp, { projectLabel: "-p-x" })
      );
    });

    const handoff = buildProjectHandoff(inputs, 3, NOW);
    expect(handoff.projects[0].sessions).toBe(40);
    expect(handoff.track?.sessions).toHaveLength(40);
    expect(HANDOFF_VISIBLE_SESSIONS).toBe(12);
  });

  it("被截断隐藏的上一会话仍参与回声评分", () => {
    const inputs = Array.from({ length: 14 }, (_, index) => {
      const timestamp = NOW - (13 - index) * HOUR;
      return input(
        "-p-x",
        "/p/x",
        [user(timestamp, "alpha beta gamma delta")],
        meta(`/p/x/${index}.jsonl`, timestamp, { projectLabel: "-p-x" })
      );
    });

    const handoff = buildProjectHandoff(inputs, 3, NOW);
    const sessions = handoff.track!.sessions;
    expect(sessions).toHaveLength(14);

    // 截到最近 12 条时，sessions[1] 会被隐藏；sessions[2] 的「上一次」正是它，
    // 如果先截断再评分，这里会错误地变成 no-previous。
    const third = sessions[2].echo;
    expect(third.status).toBe("scored");
    if (third.status === "scored") {
      expect(third.score).toBeCloseTo(1, 10);
      expect(third.hit).toBe(true);
    }
  });
});

describe("空态", () => {
  it("0 个项目 → 没有项目，也没有轨道（no-projects 由 track 为 null 表达）", () => {
    const handoff = buildProjectHandoff([], 3, NOW);
    expect(handoff.projects).toEqual([]);
    expect(handoff.activeKey).toBeNull();
    expect(handoff.track).toBeNull();
  });

  it("1 个可定位会话 → single-session，不画轨道（数据层仍返回这一条）", () => {
    const track = trackFor([user(NOW, "alpha beta gamma delta")]);
    expect(track.emptyReason).toBe("single-session");
    expect(track.sessions).toHaveLength(1);
  });

  it("选中的项目不在列表里时回退到最近有会话的项目", () => {
    const handoff = buildProjectHandoff(
      [
        input("-p-a", "/p/a", [readTool(at(11, 10, 10, 0))], meta("/p/a/a.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-a" })),
        input("-p-b", "/p/b", [readTool(at(11, 10, 11, 0))], meta("/p/b/a.jsonl", at(11, 10, 11, 0), { projectLabel: "-p-b" }))
      ],
      3,
      NOW,
      "-p-gone"
    );

    expect(handoff.activeKey).toBe("-p-b");
    expect(handoff.track?.project?.key).toBe("-p-b");
  });

  it("没有可定位会话的项目不进入 projects", () => {
    const handoff = buildProjectHandoff(
      [
        input("-p-a", "/p/a", [readTool(at(11, 10, 10, 0))], meta("/p/a/a.jsonl", at(11, 10, 10, 0), { projectLabel: "-p-a" })),
        input("-p-unknown", "/p/unknown", [record("user", Number.NaN, { text: "x" })], meta("/p/u/a.jsonl", NOW, { projectLabel: "-p-unknown" }))
      ],
      3,
      NOW
    );

    expect(handoff.projects.map((project) => project.key)).toEqual(["-p-a"]);
  });
});

describe("输出文本卫生", () => {
  it("结果里没有 NaN / Infinity / undefined，也没有绝对路径或完整消息", () => {
    const label = "-Users-alice-Desktop-work-alpha";
    const longMessage = `${wordsText(30)} 末尾还有内容`;
    const handoff = buildProjectHandoff(
      [
        input(
          label,
          "/Users/alice/Desktop/work/alpha",
          [
            tool(at(11, 8, 9, 0), "Edit", { structuredResult: editResult("/Users/alice/Desktop/work/alpha/src/foo.ts") }),
            user(at(11, 8, 9, 30), longMessage)
          ],
          meta("/work/alpha/a.jsonl", at(11, 8, 9, 0), { projectLabel: label, userPrompt: "标题" })
        ),
        input(
          label,
          "/Users/alice/Desktop/work/alpha",
          [user(at(11, 10, 11, 0), longMessage)],
          meta("/work/alpha/b.jsonl", at(11, 10, 11, 0), { projectLabel: label, userPrompt: "标题" })
        )
      ],
      3,
      NOW
    );

    const serialized = JSON.stringify(handoff);
    expect(serialized).not.toMatch(/NaN|Infinity|undefined/);
    expect(serialized).not.toContain("/Users/alice");

    const session = handoff.track!.sessions[0];
    expect(formatLastAction(session.lastAction)).not.toContain("/");
    expect(session.gapLabel ?? "").not.toContain("/");
    expect(session.opening!.preview).not.toContain("/Users");
    expect(session.opening!.preview.length).toBeLessThanOrEqual(61);
  });
});
