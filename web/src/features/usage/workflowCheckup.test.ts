import { describe, expect, it } from "vitest";
import type { CompactEvent, SessionRecord, SessionUsage } from "../sessions/types";
import type { ErrorEvent, ErrorSessionFacts } from "./errorStats";
import type { ToolCallFact } from "./toolCensus";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import { DEFAULT_CONTEXT_THRESHOLD } from "./contextHealth";
import { contextQuantiles } from "./contextQuantiles";
import {
  CHECKUP_THRESHOLDS,
  buildWorkflowCheckup,
  formatFactPercent,
  type CheckupId,
  type CheckupItem,
  type WorkflowCheckup
} from "./workflowCheckup";

/**
 * 工作流体检纯逻辑层的用例（Issue #391，清单见
 * docs/design/workflow-checkup.md §7.1）。
 *
 * 所有日期用本地 `Date` 构造、断言也用本地日历，因此在任何时区都成立。
 * 「今天」固定为 2026-11-21 18:00，窗口 = 最近 30 个本地日
 * （10/23–11/21）。
 */

const NOW = new Date(2026, 10, 21, 18, 0, 0).getTime();
const DAYS = 30;

/** 本地日期在 `daysAgo` 天前的某一时刻（默认正午，避开 DST 边界）。 */
function dayTs(daysAgo: number, hour = 12, minute = 0): number {
  return new Date(2026, 10, 21 - daysAgo, hour, minute, 0).getTime();
}

let seq = 0;
function rec(timestamp: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(
  input: number,
  output = 0,
  cacheCreation = 0,
  cacheRead = 0
): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

function session(
  records: SessionRecord[],
  over: Partial<UsageSessionInput> = {}
): UsageSessionInput {
  return { records, projectLabel: "proj-alpha", ...over };
}

function compactEvent(timestamp: number, id: string): CompactEvent {
  return {
    id,
    timestamp,
    trigger: "auto",
    preTokens: 100_000,
    postTokens: 40_000,
    droppedTokens: 60_000,
    durationMs: 1000,
    survivedUuids: [],
    summaryText: null,
    summaryUuid: null,
    logicalParentUuid: null,
    raw: {}
  };
}

function toolFact(
  timestamp: number,
  key: ToolCallFact["key"],
  sidechain = false
): ToolCallFact {
  return { key, timestamp, sidechain };
}

/**
 * 一段窗口内的工具调用失败事实：分子（events）与逐日分母（toolCalls）走
 * 同一个提取通道，和 `extractErrorEvents` 的落点一致。
 */
function errorFacts(
  ts: number,
  byTool: Record<string, { calls: number; errors: number }>
): ErrorSessionFacts {
  const events: ErrorEvent[] = [];
  const toolCalls = new Map<string, number>();
  let records = 0;
  for (const [toolName, counts] of Object.entries(byTool)) {
    toolCalls.set(toolName, counts.calls);
    records += counts.calls;
    for (let index = 0; index < counts.errors; index += 1) {
      events.push({
        kind: "tool",
        timestamp: ts,
        toolName,
        recordId: null,
        path: "/repo/session.jsonl",
        projectLabel: "proj-alpha",
        preview: ""
      });
    }
  }
  return {
    events,
    days: new Map([[dayStartOf(ts), { assistantMessages: 0, records, toolCalls }]])
  };
}

function itemOf(checkup: WorkflowCheckup, id: CheckupId): CheckupItem | null {
  return checkup.items.find((item) => item.id === id) ?? null;
}

/** `total` 个有 usage 的会话，前 `atOrAbove` 个峰值 ≥ 170K。 */
function contextInputs(atOrAbove: number, total: number): UsageSessionInput[] {
  return Array.from({ length: total }, (_, index) =>
    session([
      rec(dayTs(1), { usage: index < atOrAbove ? usage(200_000) : usage(100_000) })
    ])
  );
}

/** 3 / 8 = 37.5% 的上下文压力，让 observe 项也能在 `ok` 状态下被看到。 */
function contextTriggerInputs(): UsageSessionInput[] {
  return contextInputs(3, 8);
}

/** 压缩事件的夹具：`eventsPerSession[i]` 事件挂到第 i 个会话。 */
function compactionInputs(total: number, eventsPerSession: number[]): UsageSessionInput[] {
  return Array.from({ length: total }, (_, index) =>
    session(
      [rec(dayTs(3))],
      {
        compactEvents: Array.from(
          { length: eventsPerSession[index] ?? 0 },
          (_, eventIndex) => compactEvent(dayTs(2) + eventIndex, `c${index}-${eventIndex}`)
        )
      }
    )
  );
}

/** 委派基准：`total` 个有工具事实的会话，前 `used` 个用过子 agent。 */
function delegationInputs(
  total: number,
  used: number,
  extraWithoutField = 0
): UsageSessionInput[] {
  const inputs = contextTriggerInputs();
  for (let index = 0; index < total; index += 1) {
    const ts = dayTs(2);
    const facts: ToolCallFact[] =
      index < used
        ? index % 2 === 0
          ? [toolFact(ts, { kind: "subagent", subagentType: "Explore" })]
          : [toolFact(ts, { kind: "builtin", toolName: "Read" }, true)]
        : [toolFact(ts, { kind: "builtin", toolName: "Read" })];
    inputs.push(session([rec(ts)], { toolCalls: facts }));
  }
  for (let index = 0; index < extraWithoutField; index += 1) {
    inputs.push(session([rec(dayTs(3))]));
  }
  return inputs;
}

/**
 * 五条规则全部触发的夹具：
 * - 上下文 5 / 8 = 62.5%（focus）；
 * - 错误 137 / 149 = 92%、Bash 失败率 18%（notice）；
 * - 压缩 24 / 56 = 0.43 次/会话（notice）；
 * - 缓存 9.09%（notice）；
 * - 委派 2 / 48 = 4.2%（observe，被 4 条上限挤掉）。
 *
 * `cacheReadPerHigh` 调到 200K 时缓存率升到 16.3%，只触发三条 focus/notice，
 * 加上 observe 恰好 4 条（用于验证 3 + 1 不截断）。
 */
function allTriggered(cacheReadPerHigh = 100_000): UsageSessionInput[] {
  const inputs: UsageSessionInput[] = [];
  for (let index = 0; index < 8; index += 1) {
    const high = index < 5;
    inputs.push(
      session(
        [
          rec(dayTs(1), {
            usage: high
              ? usage(1_000_000, 0, 0, cacheReadPerHigh)
              : usage(100_000, 0, 0, 10_000)
          })
        ],
        {
          compactEvents: Array.from({ length: 3 }, (_, eventIndex) =>
            compactEvent(dayTs(1) + eventIndex, `c${index}-${eventIndex}`)
          ),
          ...(index === 0
            ? {
                errorExtract: errorFacts(dayTs(1), {
                  Bash: { calls: 761, errors: 137 },
                  Read: { calls: 239, errors: 12 }
                })
              }
            : {})
        }
      )
    );
  }
  for (let index = 0; index < 48; index += 1) {
    const ts = dayTs(2);
    const facts: ToolCallFact[] =
      index === 0
        ? [toolFact(ts, { kind: "subagent", subagentType: "Explore" })]
        : index === 1
          ? [toolFact(ts, { kind: "builtin", toolName: "Read" }, true)]
          : [toolFact(ts, { kind: "builtin", toolName: "Read" })];
    inputs.push(session([rec(ts)], { toolCalls: facts }));
  }
  return inputs;
}

describe("窗口", () => {
  it("从 now 当天的本地零点起算，标签与 30 天窗口一致", () => {
    const checkup = buildWorkflowCheckup([], DAYS, NOW);

    expect(checkup.window.startDay).toBe(addLocalDays(dayStartOf(NOW), -(DAYS - 1)));
    expect(checkup.window.days).toBe(DAYS);
    expect(checkup.window.label).toBe("10/23–11/21");
    expect(checkup.status).toBe("empty");
  });

  it("起点前 1ms 的记录不进窗口，恰好落在本地零点的记录进窗口", () => {
    const startDay = addLocalDays(dayStartOf(NOW), -(DAYS - 1));
    const inputs = [
      session([rec(dayTs(2), { usage: usage(1_000_000) })]),
      session([rec(dayTs(3), { usage: usage(1_000_000) })]),
      session([rec(dayTs(4), { usage: usage(1_000_000) })]),
      session([rec(dayTs(5), { usage: usage(1_000_000) })]),
      // 恰好本地零点：进窗口（缓存样本凑到 5M 的判定线）。
      session([rec(startDay, { usage: usage(1_000_000) })]),
      // 起点前 1ms：不进窗口。
      session([rec(startDay - 1, { usage: usage(1_000_000) })])
    ];

    const checkup = buildWorkflowCheckup(inputs, DAYS, NOW);

    expect(itemOf(checkup, "cache-hit")).not.toBeNull();
    // 有记录的会话 = 5（压缩可达样本，但 0 次压缩）；缓存样本达标；
    // 上下文只有 5 个有 usage 的会话，未达 8 个下限。
    expect(checkup.checked).toBe(2);
  });

  it("跨午夜的记录按各自本地日落桶，token 合计不重不漏", () => {
    const crossMidnight = [
      rec(new Date(2026, 10, 20, 23, 59, 0).getTime(), { usage: usage(150_000) }),
      rec(new Date(2026, 10, 21, 0, 1, 0).getTime(), { usage: usage(150_000) })
    ];
    const inputs = [
      session(crossMidnight),
      session([rec(dayTs(1), { usage: usage(300_000) })]),
      session([rec(dayTs(2), { usage: usage(300_000) })]),
      session([rec(dayTs(3), { usage: usage(300_000) })])
    ];

    const checkup = buildWorkflowCheckup(inputs, DAYS, NOW);

    expect(checkup.status).toBe("insufficient");
    expect(checkup.insufficient).toEqual({
      sessions: 4,
      toolCalls: 0,
      tokens: 1_200_000
    });
  });

  it("跨夏令时按本地日历日推进，不出现 23/25 小时位移（TZ=America/New_York）", (ctx) => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 前提自检：2026-03-08 是美国春令时，当天只有 23 小时。TZ 没生效的
      // 环境就明说跳过，不让断言变成恒真。
      const dayLength = new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime();
      if (dayLength !== 23 * 3_600_000) {
        ctx.skip();
        return;
      }

      const now = new Date(2026, 2, 10, 12, 0, 0).getTime();
      const checkup = buildWorkflowCheckup([], 5, now);

      expect(checkup.window.startDay).toBe(new Date(2026, 2, 6).getTime());
      expect(addLocalDays(checkup.window.startDay, 4)).toBe(
        new Date(2026, 2, 10).getTime()
      );
      // 用 +86_400_000 推进会在这里落到 01:00。
      expect(checkup.window.startDay).toBe(dayStartOf(new Date(2026, 2, 6).getTime()));
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

describe("context-pressure", () => {
  it("峰值取会话内 max(input + cacheCreation + cacheRead)，判定线 170K 含 cache 两项", () => {
    const inputs = [
      // 100K + 50K + 20K = 170K：恰好等于判定线，规则是「≥」。
      session([rec(dayTs(1), { usage: usage(100_000, 0, 50_000, 20_000) })]),
      session([rec(dayTs(1), { usage: usage(0, 0, 100_000, 70_000) })]),
      session([rec(dayTs(1), { usage: usage(0, 0, 0, 200_000) })]),
      ...contextInputs(0, 5)
    ];

    const checkup = buildWorkflowCheckup(inputs, DAYS, NOW);
    const item = itemOf(checkup, "context-pressure");

    expect(item).not.toBeNull();
    expect(item!.fact).toBe("3 / 8 个会话的上下文峰值不低于 170K（压缩阈值 200K 的 85%）");
    expect(item!.level).toBe("notice");
    expect(item!.evidence.rows[0].value).toBe("3 / 8 个会话（有 usage 的会话）");
  });

  it("峰值恰好 170,000 的会话计入分子，事实句说「不低于」而不是「超过」", () => {
    const inputs = [
      // 恰好等于判定线：规则是 ≥，必须计入分子。
      session([rec(dayTs(1), { usage: usage(170_000) })]),
      session([rec(dayTs(1), { usage: usage(200_000) })]),
      session([rec(dayTs(1), { usage: usage(200_000) })]),
      ...contextInputs(0, 5)
    ];

    const item = itemOf(buildWorkflowCheckup(inputs, DAYS, NOW), "context-pressure")!;

    // 3 / 8 = 37.5% > 25%：恰好等于判定线的那条确实进了分子。
    expect(item.fact).toBe(
      "3 / 8 个会话的上下文峰值不低于 170K（压缩阈值 200K 的 85%）"
    );
    expect(item.fact).toContain("不低于");
    expect(item.fact).not.toContain("超过");
    expect(item.evidence.rows[0].value).toBe("3 / 8 个会话（有 usage 的会话）");
  });

  it("缺 usage 的会话不进分母（否则 3 / 12 = 25% 会漏判）", () => {
    const inputs = [
      ...contextInputs(3, 8),
      ...Array.from({ length: 4 }, () => session([rec(dayTs(1))]))
    ];

    const checkup = buildWorkflowCheckup(inputs, DAYS, NOW);

    expect(itemOf(checkup, "context-pressure")).not.toBeNull();
    expect(itemOf(checkup, "context-pressure")!.fact.startsWith("3 / 8 ")).toBe(true);
  });

  it("占比 > 25% 触发；恰好 25% 不触发", () => {
    const below = buildWorkflowCheckup(contextInputs(3, 8), DAYS, NOW);
    expect(itemOf(below, "context-pressure")!.level).toBe("notice");

    const exact = buildWorkflowCheckup(contextInputs(2, 8), DAYS, NOW);
    expect(itemOf(exact, "context-pressure")).toBeNull();
    // 8 个有 usage 的会话已达样本下限，所以它确实被「检查过」。
    expect(exact.checked).toBeGreaterThanOrEqual(1);
  });

  it("有 usage 的会话 < 8 时不判定", () => {
    const checkup = buildWorkflowCheckup(contextInputs(7, 7), DAYS, NOW);

    expect(itemOf(checkup, "context-pressure")).toBeNull();
    // 只剩压缩规则达标（7 个有记录的会话 ≥ 5），上下文一项不计入 checked。
    expect(checkup.checked).toBe(1);
  });

  it("判定线从 DEFAULT_CONTEXT_THRESHOLD × 比例派生，不写死在文案里", () => {
    const item = itemOf(
      buildWorkflowCheckup(contextInputs(3, 8), DAYS, NOW),
      "context-pressure"
    )!;
    const line = DEFAULT_CONTEXT_THRESHOLD * CHECKUP_THRESHOLDS.contextPeakRatio;

    expect(item.fact).toContain(`${line / 1000}K`);
    expect(item.fact).toContain(`${DEFAULT_CONTEXT_THRESHOLD / 1000}K`);
    expect(item.fact).toContain(`${CHECKUP_THRESHOLDS.contextPeakRatio * 100}%`);
  });
});

describe("error-focus", () => {
  function errorCheckup(byTool: Record<string, { calls: number; errors: number }>) {
    return buildWorkflowCheckup(
      [session([rec(dayTs(1))], { errorExtract: errorFacts(dayTs(1), byTool) })],
      DAYS,
      NOW
    );
  }

  it("份额恰好 60% 触发（≥），失败率恰好 10% 不触发（>）", () => {
    const atShare = errorCheckup({
      Bash: { calls: 500, errors: 60 },
      Read: { calls: 500, errors: 40 }
    });
    const item = itemOf(atShare, "error-focus");
    expect(item).not.toBeNull();
    expect(item!.fact).toBe("全部 100 次工具失败里有 60 次来自 Bash（60%），Bash 失败率 12%");
    expect(item!.level).toBe("notice");
    expect(item!.intensity).toBe(0);

    const atRate = errorCheckup({
      Bash: { calls: 600, errors: 60 },
      Read: { calls: 400, errors: 40 }
    });
    expect(itemOf(atRate, "error-focus")).toBeNull();
  });

  it("份额分母是全部工具失败，失败率分母是该工具调用，两套数字都进证据", () => {
    const checkup = errorCheckup({
      Bash: { calls: 761, errors: 137 },
      Read: { calls: 239, errors: 12 }
    });
    const item = itemOf(checkup, "error-focus")!;

    expect(item.fact).toBe(
      "全部 149 次工具失败里有 137 次来自 Bash（92%），Bash 失败率 18%"
    );
    expect(item.evidence.rows.find((row) => row.label === "失败集中度")!.value).toContain(
      "137 / 149"
    );
    expect(item.evidence.rows.find((row) => row.label === "失败率")!.value).toContain(
      "Bash 137 / 761"
    );
    expect(item.evidence.rows.find((row) => row.label === "样本")!.value).toContain("1000");
  });

  it("全部工具调用 < 20 次时不判定", () => {
    const checkup = errorCheckup({ Bash: { calls: 19, errors: 5 } });

    expect(itemOf(checkup, "error-focus")).toBeNull();
    expect(checkup.checked).toBe(0);
    expect(checkup.status).toBe("insufficient");
    expect(checkup.insufficient!.toolCalls).toBe(19);
  });

  it("同级排序用失败集中度，级别用失败率：集中但失败率低不升级", () => {
    // 份额正好 60%、失败率 15%（> 10% 但不 > 20%）→ 触发但停在 notice，
    // intensity 由份额算得 0。
    const checkup = errorCheckup({
      Bash: { calls: 400, errors: 60 },
      Read: { calls: 100, errors: 40 }
    });
    const item = itemOf(checkup, "error-focus");

    expect(item).not.toBeNull();
    expect(item!.level).toBe("notice");
    expect(item!.intensity).toBe(0);
  });

  it("失败率 10.04% 触发时事实加精度到 10.04%，不印判定线 10%", () => {
    const checkup = errorCheckup({
      Bash: { calls: 10_000, errors: 1004 },
      Read: { calls: 4_000, errors: 400 }
    });
    const item = itemOf(checkup, "error-focus")!;

    expect(item.fact).toContain("10.04%");
    expect(item.fact).not.toContain("10%");
  });
});

describe("compaction-rate", () => {
  it("分母是有记录的会话数，不是发生过压缩的会话数", () => {
    // 48 个会话里 22 次压缩，分散在 18 个会话 → 0.46 次/会话（notice）。
    // 若错用 compactionStats.sessions（18）会得到 1.22（focus）。
    const eventsPerSession = Array.from({ length: 48 }, (_, index) =>
      index === 0 ? 5 : index <= 17 ? 1 : 0
    );
    const checkup = buildWorkflowCheckup(
      compactionInputs(48, eventsPerSession),
      DAYS,
      NOW
    );
    const item = itemOf(checkup, "compaction-rate")!;

    expect(item.fact).toBe("48 个会话里发生了 22 次压缩，平均每 2.2 个会话压一次");
    expect(item.level).toBe("notice");
    expect(item.evidence.rows.find((row) => row.label === "读数")!.value).toBe(
      "0.46 次/会话（每 2.2 个会话一次）"
    );
  });

  it("> 0.40 且 ≥ 3 次才触发；恰好 0.40 不触发", () => {
    const exact = buildWorkflowCheckup(compactionInputs(10, [1, 1, 1, 1]), DAYS, NOW);
    expect(itemOf(exact, "compaction-rate")).toBeNull();

    const over = buildWorkflowCheckup(
      compactionInputs(10, [1, 1, 1, 1, 1]),
      DAYS,
      NOW
    );
    expect(itemOf(over, "compaction-rate")!.level).toBe("notice");
  });

  it("关注线是严格 > 0.80：恰好 0.80 仍是 notice", () => {
    const exact = buildWorkflowCheckup(
      compactionInputs(10, [1, 1, 1, 1, 1, 1, 1, 1]),
      DAYS,
      NOW
    );
    expect(itemOf(exact, "compaction-rate")!.level).toBe("notice");

    const focus = buildWorkflowCheckup(
      compactionInputs(10, [1, 1, 1, 1, 1, 1, 1, 1, 1]),
      DAYS,
      NOW
    );
    expect(itemOf(focus, "compaction-rate")!.level).toBe("focus");
  });

  it("有记录的会话 < 5 时不判定；恰好 5 个时判定", () => {
    const below = buildWorkflowCheckup(compactionInputs(4, [1, 1, 1]), DAYS, NOW);
    expect(itemOf(below, "compaction-rate")).toBeNull();
    expect(below.checked).toBe(0);

    // 5 个会话、3 次压缩 = 0.6 次/会话 → notice（同时满足 ≥ 3 次）。
    const exact = buildWorkflowCheckup(compactionInputs(5, [1, 1, 1]), DAYS, NOW);
    expect(itemOf(exact, "compaction-rate")!.level).toBe("notice");
  });
});

describe("cache-hit", () => {
  function cacheCheckup(
    input: number,
    cacheCreation: number,
    cacheRead: number
  ): WorkflowCheckup {
    return buildWorkflowCheckup(
      [session([rec(dayTs(1), { usage: usage(input, 0, cacheCreation, cacheRead) })])],
      DAYS,
      NOW
    );
  }

  it("分母是 input + cacheCreation + cacheRead，不是周报的 input + cacheRead", () => {
    // 三项口径 1.4M / 11.4M = 12.3% < 15% → 触发；
    // 周报口径 1.4M / 6.4M = 21.9% → 不会触发。
    const checkup = cacheCheckup(5_000_000, 5_000_000, 1_400_000);
    const item = itemOf(checkup, "cache-hit")!;

    expect(item.fact).toBe(
      "输入侧只有 12% 来自缓存读取——大部分上下文每次都在重新写入"
    );
    expect(item.level).toBe("notice");
    expect(item.evidence.rows[0].value).toContain("输入侧 11.4M token");
    expect(item.evidence.rows[1].value).toBe("12.3%");
  });

  it("恰好 15% 不触发；恰好 8% 仍是 notice", () => {
    const exactTrigger = cacheCheckup(8_500_000, 0, 1_500_000);
    expect(itemOf(exactTrigger, "cache-hit")).toBeNull();

    const exactFocus = cacheCheckup(9_200_000, 0, 800_000);
    expect(itemOf(exactFocus, "cache-hit")!.level).toBe("notice");

    const focus = cacheCheckup(9_500_000, 0, 500_000);
    expect(itemOf(focus, "cache-hit")!.level).toBe("focus");
  });

  it("窗口 token < 5M 时不判定", () => {
    const checkup = cacheCheckup(4_000_000, 0, 400_000);

    expect(itemOf(checkup, "cache-hit")).toBeNull();
    expect(checkup.checked).toBe(0);
  });

  it("命中率 < 1% 时事实不说 0%，证据标注「不足 1%」", () => {
    const checkup = cacheCheckup(9_990_000, 0, 10_000);
    const item = itemOf(checkup, "cache-hit")!;

    expect(item.fact).toBe(
      "输入侧只有不到 1% 来自缓存读取——大部分上下文每次都在重新写入"
    );
    expect(item.evidence.rows[1].value).toBe("0.1%（不足 1%）");
  });

  it("命中率 14.96% 触发时事实加精度到 14.96%，不印判定线 15%", () => {
    const checkup = cacheCheckup(4_252_000, 0, 748_000);
    const item = itemOf(checkup, "cache-hit")!;

    expect(item.fact).toContain("14.96%");
    expect(item.fact).not.toContain("15%");
    // 证据区不受约束，仍按固定一位小数。
    expect(item.evidence.rows[1].value).toBe("15.0%");
  });
});

describe("delegation", () => {
  it("分母是有工具事实的会话；subagent 与 sidechain 都算用过", () => {
    const checkup = buildWorkflowCheckup(delegationInputs(48, 2), DAYS, NOW);
    const item = itemOf(checkup, "delegation")!;

    expect(item.fact).toBe("48 个会话里只有 2 个用过子 agent");
    expect(item.level).toBe("observe");
    expect(item.action).toBeNull();
    expect(item.note).toBe("这一项只陈述事实，不给建议——是否适合委派取决于具体任务。");
    expect(item.evidence.meter).toBeNull();
    expect(item.evidence.rows[0].value).toBe(
      "2 / 48 个有工具事实的会话用过子 agent"
    );
  });

  it("恰好 5% 不触发；< 5% 才触发", () => {
    const exact = buildWorkflowCheckup(delegationInputs(40, 2), DAYS, NOW);
    expect(itemOf(exact, "delegation")).toBeNull();

    const below = buildWorkflowCheckup(delegationInputs(40, 1), DAYS, NOW);
    expect(itemOf(below, "delegation")).not.toBeNull();
  });

  it("有工具事实的会话 < 20 时不判定；恰好 20 时判定（n = 0 也用整句陈述）", () => {
    const below = buildWorkflowCheckup(delegationInputs(19, 0), DAYS, NOW);
    expect(itemOf(below, "delegation")).toBeNull();
    // 上下文 + 压缩达标，委派不计入。
    expect(below.checked).toBe(2);

    const exact = buildWorkflowCheckup(delegationInputs(20, 0), DAYS, NOW);
    expect(itemOf(exact, "delegation")!.fact).toBe("20 个会话里没有一个用过子 agent");
  });

  it("缺 toolCalls 的会话不进委派分母", () => {
    const checkup = buildWorkflowCheckup(delegationInputs(40, 1, 10), DAYS, NOW);

    expect(itemOf(checkup, "delegation")!.fact).toBe(
      "40 个会话里只有 1 个用过子 agent"
    );
  });
});

describe("级别、排序与上限", () => {
  it("关注线：上下文 > 50%、错误失败率 > 20%、压缩 > 0.80、缓存 < 8% 才升 focus", () => {
    expect(itemOf(buildWorkflowCheckup(contextInputs(4, 8), DAYS, NOW), "context-pressure")!.level).toBe(
      "notice"
    );
    expect(itemOf(buildWorkflowCheckup(contextInputs(5, 8), DAYS, NOW), "context-pressure")!.level).toBe(
      "focus"
    );

    const errorAtLine = buildWorkflowCheckup(
      [
        session([rec(dayTs(1))], {
          errorExtract: errorFacts(dayTs(1), {
            Bash: { calls: 600, errors: 120 },
            Read: { calls: 400, errors: 80 }
          })
        })
      ],
      DAYS,
      NOW
    );
    // 120 / 600 = 20% 恰好等于关注线 → 仍是 notice。
    expect(itemOf(errorAtLine, "error-focus")!.level).toBe("notice");

    const errorOver = buildWorkflowCheckup(
      [
        session([rec(dayTs(1))], {
          errorExtract: errorFacts(dayTs(1), {
            Bash: { calls: 500, errors: 130 },
            Read: { calls: 500, errors: 70 }
          })
        })
      ],
      DAYS,
      NOW
    );
    expect(itemOf(errorOver, "error-focus")!.level).toBe("focus");
  });

  it("判定行同时写触发线与关注线，级别可由读数复算", () => {
    const checkup = buildWorkflowCheckup(contextInputs(5, 8), DAYS, NOW);
    const item = itemOf(checkup, "context-pressure")!;
    const judgement = item.evidence.rows.find((row) => row.label === "判定")!.value;

    expect(judgement).toContain("触发 > 25%");
    expect(judgement).toContain("关注 > 50%");
    expect(item.evidence.rows.find((row) => row.label === "读数")!.value).toBe("62.5%");
  });

  it("排序：级别优先 → intensity 降序 → 规则序号", () => {
    const checkup = buildWorkflowCheckup(allTriggered(), DAYS, NOW);

    // context 是唯一 focus；三条 notice 按 intensity 降序：
    // 错误 0.53 > 缓存 0.39 > 压缩 0.07；observe 排最后并被上限挤掉。
    expect(checkup.items.map((item) => item.id)).toEqual([
      "context-pressure",
      "error-focus",
      "cache-hit",
      "compaction-rate"
    ]);
    expect(checkup.items.map((item) => item.level)).toEqual([
      "focus",
      "notice",
      "notice",
      "notice"
    ]);
  });

  it("同一输入两次结果完全一致", () => {
    const first = buildWorkflowCheckup(allTriggered(), DAYS, NOW);
    const second = buildWorkflowCheckup(allTriggered(), DAYS, NOW);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("5 条触发只显示 4 条、dropped 为 1、observe 先被挤掉", () => {
    const checkup = buildWorkflowCheckup(allTriggered(), DAYS, NOW);

    expect(checkup.items).toHaveLength(4);
    expect(checkup.dropped).toBe(1);
    expect(checkup.counts).toEqual({ focus: 1, notice: 3, observe: 1 });
    expect(itemOf(checkup, "delegation")).toBeNull();
  });

  it("3 + 1 条时全部显示，不截断", () => {
    // 缓存率 16.3% 不触发 → 3 条 focus/notice + 1 条 observe。
    const checkup = buildWorkflowCheckup(allTriggered(200_000), DAYS, NOW);

    expect(checkup.items).toHaveLength(4);
    expect(checkup.dropped).toBe(0);
    expect(checkup.items[3].id).toBe("delegation");
  });
});

describe("状态与 summary", () => {
  it("无会话 → empty", () => {
    const checkup = buildWorkflowCheckup([], DAYS, NOW);

    expect(checkup.status).toBe("empty");
    expect(checkup.items).toEqual([]);
    expect(checkup.checked).toBe(0);
    expect(checkup.total).toBe(5);
    expect(checkup.ineligible).toBe(5);
    expect(checkup.counts).toEqual({ focus: 0, notice: 0, observe: 0 });
    expect(checkup.summary).toBe("");
    expect(checkup.insufficient).toBeNull();
  });

  it("有会话但 checked === 0 → insufficient，三个计数正确", () => {
    const inputs = Array.from({ length: 4 }, (_, index) =>
      session(
        [
          rec(dayTs(1), { usage: usage(300_000) })
        ],
        {
          errorExtract: errorFacts(dayTs(1), { Bash: { calls: 3, errors: 1 } }),
          ...(index === 0
            ? { toolCalls: [toolFact(dayTs(1), { kind: "builtin", toolName: "Read" })] }
            : {})
        }
      )
    );

    const checkup = buildWorkflowCheckup(inputs, DAYS, NOW);

    expect(checkup.status).toBe("insufficient");
    expect(checkup.items).toEqual([]);
    expect(checkup.checked).toBe(0);
    expect(checkup.summary).toBe("");
    expect(checkup.insufficient).toEqual({
      sessions: 4,
      toolCalls: 12,
      tokens: 1_200_000
    });
  });

  it("有达标项但没有 focus/notice → quiet（含只有 observe）", () => {
    const inputs = Array.from({ length: 48 }, (_, index) =>
      session([rec(dayTs(2))], {
        toolCalls: [
          toolFact(
            dayTs(2),
            index < 2
              ? { kind: "subagent", subagentType: "Explore" }
              : { kind: "builtin", toolName: "Read" }
          )
        ]
      })
    );

    const checkup = buildWorkflowCheckup(inputs, DAYS, NOW);

    expect(checkup.status).toBe("quiet");
    expect(checkup.items).toEqual([]);
    expect(checkup.checked).toBe(2);
    expect(checkup.counts.observe).toBe(1);
    expect(checkup.summary).toBe("");
  });

  it("至少一条 focus/notice → ok，summary 分母是 checked、分子不受上限影响", () => {
    const checkup = buildWorkflowCheckup(allTriggered(), DAYS, NOW);

    expect(checkup.status).toBe("ok");
    expect(checkup.checked).toBe(5);
    expect(checkup.summary).toBe("5 项检查里 4 项值得看一眼");
    // dropped 的 observe 不进分子，但 focus/notice 的 4 条全部计入。
    expect(checkup.dropped).toBe(1);
  });

  it("部分规则样本不足时，summary 的分母只数达标的检查项", () => {
    // 上下文 + 压缩 + 委派达标；错误与缓存未达标 → checked = 3。
    const checkup = buildWorkflowCheckup(delegationInputs(48, 2), DAYS, NOW);

    expect(checkup.status).toBe("ok");
    expect(checkup.checked).toBe(3);
    expect(checkup.ineligible).toBe(2);
    expect(checkup.summary).toBe("3 项检查里 1 项值得看一眼");
  });
});

describe("文本与证据", () => {
  const fixtures = [
    buildWorkflowCheckup(allTriggered(), DAYS, NOW),
    buildWorkflowCheckup(contextInputs(3, 8), DAYS, NOW),
    buildWorkflowCheckup(compactionInputs(10, [1, 1, 1, 1, 1, 1, 1, 1, 1]), DAYS, NOW),
    buildWorkflowCheckup([session([rec(dayTs(1), { usage: usage(5_000_000, 0, 5_000_000, 1_400_000) })])], DAYS, NOW),
    buildWorkflowCheckup(delegationInputs(48, 2), DAYS, NOW)
  ];

  it("文本里没有 NaN / Infinity / undefined，也没有绝对路径或项目名", () => {
    for (const checkup of fixtures) {
      for (const item of checkup.items) {
        const text = [
          item.fact,
          item.dimension,
          item.note ?? "",
          item.action?.text ?? "",
          ...item.evidence.rows.map((row) => row.value),
          item.evidence.meter?.caption ?? ""
        ].join(" ");
        expect(text).not.toMatch(/NaN|Infinity|undefined/);
        expect(text).not.toMatch(/\/Users|\/repo|proj-alpha/);
      }
    }
  });

  it("百分比事实取整、证据一位小数；压缩事实一位小数、证据两位", () => {
    const errorCheckup = buildWorkflowCheckup(
      [
        session([rec(dayTs(1))], {
          errorExtract: errorFacts(dayTs(1), {
            Bash: { calls: 761, errors: 137 },
            Read: { calls: 239, errors: 12 }
          })
        })
      ],
      DAYS,
      NOW
    );
    const error = itemOf(errorCheckup, "error-focus")!;
    expect(error.fact).toContain("（92%）");
    expect(error.fact).toContain("失败率 18%");
    expect(error.evidence.rows[0].value).toContain("91.9%");

    const compaction = itemOf(
      buildWorkflowCheckup(compactionInputs(48, [5, ...Array(17).fill(1)]), DAYS, NOW),
      "compaction-rate"
    )!;
    expect(compaction.fact).toContain("平均每 2.2 个会话压一次");
    expect(compaction.evidence.rows[1].value).toContain("0.46 次/会话");
  });

  it("事实句里的每个数字都能在证据里找到同值", () => {
    const numbersIn = (text: string): string[] =>
      text.match(/\d+(?:\.\d+)?[KM]?%?/g) ?? [];
    const percentsIn = (text: string): number[] =>
      [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map((match) => Number(match[1]));

    for (const checkup of fixtures) {
      for (const item of checkup.items) {
        const evidenceText = item.evidence.rows.map((row) => row.value).join(" ");
        for (const token of numbersIn(item.fact)) {
          if (token.endsWith("%")) {
            // 事实按设计取整、证据保留一位小数（§3.0）：同源指同一个读数，
            // 把证据的一位小数四舍五入后必须等于事实里的整数百分比。
            const target = Number(token.slice(0, -1));
            expect(
              percentsIn(evidenceText).some((value) => Math.round(value) === target)
            ).toBe(true);
          } else {
            expect(evidenceText).toContain(token);
          }
        }
      }
    }
  });

  it("刻度几何在 0–100% 内；observe 没有 meter；方向文案正确", () => {
    for (const checkup of fixtures) {
      for (const item of checkup.items) {
        if (item.id === "delegation") {
          expect(item.evidence.meter).toBeNull();
          continue;
        }
        const meter = item.evidence.meter!;
        expect(meter.max).toBeGreaterThan(0);
        expect(meter.value / meter.max).toBeGreaterThanOrEqual(0);
        expect(meter.value / meter.max).toBeLessThanOrEqual(1);
        expect(meter.threshold / meter.max).toBeGreaterThanOrEqual(0);
        expect(meter.threshold / meter.max).toBeLessThanOrEqual(1);
        expect(meter.caption).toContain(
          meter.direction === "above" ? "高于判定线才成立" : "低于判定线才成立"
        );
      }
    }
  });

  it("读数行标记为 numeric，计数与样本/窗口行不是", () => {
    const item = itemOf(
      buildWorkflowCheckup(contextInputs(3, 8), DAYS, NOW),
      "context-pressure"
    )!;

    expect(item.evidence.rows.find((row) => row.label === "读数")!.numeric).toBe(true);
    expect(item.evidence.rows.find((row) => row.label === "计数")!.numeric).toBe(false);
    expect(item.evidence.rows.find((row) => row.label === "样本")!.numeric).toBe(false);
    expect(item.evidence.rows.find((row) => row.label === "窗口")!.numeric).toBe(false);
  });
});

describe("formatFactPercent（事实百分比的自适应精度）", () => {
  it("从 0 位小数试到 2 位，取第一个既不跨线也不等于判定线的精度", () => {
    // 0 位得到 15%（等于判定线），1 位仍是 15.0%，到 2 位才成立。
    expect(formatFactPercent(0.1496, 0.15, "below")).toBe("14.96%");
    expect(formatFactPercent(0.1004, 0.1, "above")).toBe("10.04%");
    // 正常读数保持整数，不为边界个例把每个数字都拉长。
    expect(formatFactPercent(0.92, 0.6, "above")).toBe("92%");
    expect(formatFactPercent(0.18003, 0.1, "above")).toBe("18%");
    expect(formatFactPercent(0.1228, 0.15, "below")).toBe("12%");
  });

  it("阈值两侧各取一个值：显示值与判定线的比较结论与真实值一致", () => {
    for (const value of [0.1496, 0.1504]) {
      const shown = Number(formatFactPercent(value, 0.15, "below").replace("%", ""));
      expect(shown < 15).toBe(value * 100 < 15);
      expect(shown).not.toBe(15);
    }
    for (const value of [0.0996, 0.1004]) {
      const shown = Number(formatFactPercent(value, 0.1, "above").replace("%", ""));
      expect(shown > 10).toBe(value * 100 > 10);
      expect(shown).not.toBe(10);
    }
  });
});

describe("contextPeakOf 提取", () => {
  it("有 usage 时给出会话内最大上下文，没有 usage 时给 null", () => {
    const withUsage = session([
      rec(dayTs(1), { usage: usage(100_000, 0, 10_000, 20_000) }),
      rec(dayTs(1), { usage: usage(50_000, 0, 90_000, 40_000) })
    ]);
    const withoutUsage = session([rec(dayTs(1))]);

    // 与 contextQuantiles 共享同一公式：提取后既有行为不变（无 usage 记 0）。
    const peaks = contextQuantiles([withUsage, withoutUsage]);
    expect(peaks.max).toBe(180_000);
    expect(peaks.count).toBe(2);
    expect(peaks.p50).toBe(0);
  });
});
