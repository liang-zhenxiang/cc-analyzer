import { describe, expect, it } from "vitest";
import {
  roundGgContextQuantiles,
  roundGgProjectCard,
  roundGgStoryDays,
  storyDayMetaText,
  type GgFixtureRecord
} from "./round-gg-expectations";

/**
 * 这份单测用**固定日历日**的假定时钟证明：期望值只跟「运行时刻相对夹具
 * 日期落在窗口哪一侧」有关，与运行日是几号无关。夹具形状照 `buildRoundGG`
 * 裁剪（四季各一条 + 最近三天五条），数字也照抄，方便和 e2e 的实际读数对账：
 *
 *   - Q4 的 alpha 会话钉在 10-15：11-13 运行时距今天 29 天（窗内），11-14
 *     起变成 30 天（窗外）——这正是 Issue #331 的边界；
 *   - 最近三天的用量固定，所以窗口外的 Q1–Q3（以及 11-14 起的 Q4）滑出后，
 *     读数应稳定在「只剩最近三天」的那一档，而不是随运行日期继续漂移。
 *
 * 全部断言都不读 `Date.now()`：`now` 是显式传入的假时钟，夹具的最近三天也
 * 由同一个 now 派生。
 */

const ALPHA = "/repo/gg-alpha";
const BETA = "/repo/gg-beta";
const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-haiku-4-5-20251001";

type UsageTuple = [input: number, output: number, cacheCreation: number, cacheRead: number];

const TOOL_USAGE: UsageTuple = [500, 200, 0, 1500];

/** 本地日历时刻（月份 1–12）——不依赖 CI 是 UTC 还是开发机是 Asia/Shanghai。 */
function localTime(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function rawUsage([input, output, cacheCreation, cacheRead]: UsageTuple) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead
  };
}

let uuidSeed = 0;

function messageRecord(
  kind: "user" | "assistant",
  sessionId: string,
  cwd: string,
  at: number,
  options: { model?: string; usage?: UsageTuple; contentType?: string; text?: string } = {}
): GgFixtureRecord {
  uuidSeed += 1;
  return {
    type: kind,
    sessionId,
    cwd,
    uuid: `roundgg-test-${uuidSeed}`,
    timestamp: new Date(at).toISOString(),
    message: {
      ...(options.model ? { model: options.model } : {}),
      ...(options.usage ? { usage: rawUsage(options.usage) } : {}),
      content:
        options.contentType === "tool_use"
          ? [{ type: "tool_use" }]
          : options.text ?? `prompt ${uuidSeed}`
    }
  };
}

/** 一段会话：user → assistant(usage) → N 个带 usage 的 tool_use 记录。 */
function session(
  cwd: string,
  id: string,
  start: number,
  usage: UsageTuple,
  toolCount: number,
  model = SONNET
): GgFixtureRecord[] {
  const records = [
    messageRecord("user", id, cwd, start),
    messageRecord("assistant", id, cwd, start + 60_000, { model, usage })
  ];
  for (let index = 0; index < toolCount; index += 1) {
    records.push(
      messageRecord("assistant", id, cwd, start + 120_000 + index * 30_000, {
        model,
        usage: TOOL_USAGE,
        contentType: "tool_use"
      })
    );
  }
  return records;
}

/** `buildRoundGG` 的简化复刻：四季会话 + 最近三天五条，全部相对传入的 now。 */
function fixtureAt(now: number): GgFixtureRecord[] {
  const quarterAt = (quarter: 1 | 2 | 3 | 4, hour: number): number => {
    const year = new Date(now).getFullYear();
    const month = (quarter - 1) * 3;
    let stamp = new Date(year, month, 15, hour, 0, 0, 0).getTime();
    if (stamp > now) stamp = new Date(year - 1, month, 15, hour, 0, 0, 0).getTime();
    return stamp;
  };
  const at = (daysAgo: number, hour: number, minute: number): number => {
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    day.setHours(hour, minute, 0, 0);
    return day.getTime();
  };

  const alphaQuarters: UsageTuple[] = [
    [80_000, 20_000, 10_000, 10_000],
    [200_000, 50_000, 30_000, 20_000],
    [120_000, 30_000, 20_000, 10_000],
    [260_000, 70_000, 40_000, 30_000]
  ];
  const betaQuarters: UsageTuple[] = [
    [70_000, 15_000, 5_000, 0],
    [20_000, 5_000, 5_000, 0],
    [30_000, 5_000, 5_000, 0],
    [15_000, 5_000, 0, 0]
  ];

  const records: GgFixtureRecord[] = [];
  for (let index = 0; index < 4; index += 1) {
    const quarter = (index + 1) as 1 | 2 | 3 | 4;
    records.push(
      ...session(ALPHA, `alpha-q${quarter}`, quarterAt(quarter, 10), alphaQuarters[index], 3)
    );
    records.push(
      ...session(BETA, `beta-q${quarter}`, quarterAt(quarter, 15), betaQuarters[index], 2, HAIKU)
    );
  }

  // 最近三天：今天两段、昨天两段、三天前一段（与夹具同形）。
  records.push(...session(ALPHA, "recent-301", at(0, 9, 10), [120_000, 60_000, 40_000, 80_000], 4));
  records.push(...session(ALPHA, "recent-302", at(0, 14, 30), [110_000, 55_000, 35_000, 80_000], 3));
  records.push(...session(ALPHA, "recent-303", at(1, 10, 0), [50_000, 25_000, 10_000, 5_000], 3));
  records.push(...session(BETA, "recent-304", at(1, 11, 20), [35_000, 15_000, 5_000, 5_000], 3, HAIKU));
  records.push(...session(BETA, "recent-305", at(3, 16, 0), [25_000, 10_000, 3_000, 2_000], 3, HAIKU));

  return records;
}

const clocks = {
  "11-13": localTime(2026, 11, 13),
  "11-14": localTime(2026, 11, 14),
  "11-30": localTime(2026, 11, 30),
  "12-25": localTime(2026, 12, 25),
  "次年 1-05": localTime(2027, 1, 5),
  "4-01": localTime(2027, 4, 1)
} as const;

type ClockName = keyof typeof clocks;

/** 只依赖最近三天的读数——Q4 滑出窗口之后，六个时钟都应给出同一组值。 */
const AFTER_Q4 = "692,000";

function expectAfterQ4(clock: ClockName): void {
  const now = clocks[clock];
  const records = fixtureAt(now);

  const days = roundGgStoryDays(records, now);
  expect(days).toHaveLength(3);
  expect(storyDayMetaText(days[0])).toBe("2 会话 · 1 项目 · 595,400 token · 最忙 09:00");

  const alpha = roundGgProjectCard(records, now, ALPHA);
  expect(alpha.sessions).toBe(3);
  expect(alpha.tokensText).toBe(AFTER_Q4);
  expect(alpha.costText).toMatch(/^\$/);

  const beta = roundGgProjectCard(records, now, BETA);
  expect(beta.sessions).toBe(2);
  expect(beta.tokensText).toBe("113,200");

  const quantiles = roundGgContextQuantiles(records, now);
  expect(quantiles.maxText).toBe("240k");
  expect(quantiles.p90Text).toBe("225k");
}

describe("Round GG 期望值从夹具现算", () => {
  it("11-13：Q4 距今天 29 天，仍在 30 天窗口内", () => {
    const now = clocks["11-13"];
    const records = fixtureAt(now);

    const days = roundGgStoryDays(records, now);
    // 10-15 的 alpha/beta Q4 + 今天 / 昨天 / 三天前 = 4 个有活动的自然日。
    expect(days).toHaveLength(4);

    const alpha = roundGgProjectCard(records, now, ALPHA);
    // Q4 一份 + 最近三天三份 = 4 个会话；Q4 的 406,600 token 让总量跨进 1M 档。
    expect(alpha.sessions).toBe(4);
    expect(alpha.tokensText).toBe("1.1M");

    const beta = roundGgProjectCard(records, now, BETA);
    expect(beta.sessions).toBe(3);
    expect(beta.tokensText).toBe("137,600");

    const quantiles = roundGgContextQuantiles(records, now);
    // Q4 alpha 的 330k 峰值在样本里 → 最大值 330k；13 个样本的 P90 落在 240k。
    expect(quantiles.maxText).toBe("330k");
    expect(quantiles.p90Text).toBe("240k");
  });

  it("11-14：Q4 变成 30 天前，滑出窗口，读数同步变化", () => {
    expectAfterQ4("11-14");
  });

  it.each<ClockName>(["11-30", "12-25", "次年 1-05", "4-01"])(
    "%s：窗口里只剩最近三天，读数保持稳定",
    (clock) => {
      expectAfterQ4(clock);
    }
  );

  it("季节占比是全历史口径：同一季度内不变，跨季才换", () => {
    // 最近三天的会话也落在「当前季」——11/12 月它们给 Q4 添量，1 月/4 月
    // 则落到 Q1。占比因此不是窗口读数，而是真实日历季的分布；仍由
    // projectSeasons 现算，spec 不写死任何一档。
    const endOf2026 = "Q1 7% · Q2 18% · Q3 11% · Q4 64%";
    const january2027 = "Q1 48% · Q2 18% · Q3 11% · Q4 24%";
    const april2027 = "Q1 13% · Q2 52% · Q3 11% · Q4 24%";

    for (const clock of ["11-13", "11-14", "11-30", "12-25"] as const) {
      const now = clocks[clock];
      expect(roundGgProjectCard(fixtureAt(now), now, ALPHA).seasonText).toBe(endOf2026);
    }
    // 1-05：最近三天都在 Q1；4-01：今天在 Q2、昨天/三天前仍在 Q1，
    // 所以两档 Q1/Q2 占比不同——这正是「季节」是日历事实而非窗口读数。
    expect(
      roundGgProjectCard(fixtureAt(clocks["次年 1-05"]), clocks["次年 1-05"], ALPHA).seasonText
    ).toBe(january2027);
    expect(roundGgProjectCard(fixtureAt(clocks["4-01"]), clocks["4-01"], ALPHA).seasonText).toBe(
      april2027
    );
  });

  it("季节 aria 与可见文字同源，空季写「无记录」", () => {
    const now = clocks["11-13"];
    const alpha = roundGgProjectCard(fixtureAt(now), now, ALPHA);
    expect(alpha.seasonAria).toBe("Q1 7%、Q2 18%、Q3 11%、Q4 64%");
    expect(alpha.seasonText).toBe("Q1 7% · Q2 18% · Q3 11% · Q4 64%");
  });

  it("同一份夹具在不同时钟下产生不同期望值——证明它不是写死的", () => {
    const early = fixtureAt(clocks["11-13"]);
    const late = fixtureAt(clocks["11-14"]);
    expect(roundGgStoryDays(early, clocks["11-13"]).length).not.toBe(
      roundGgStoryDays(late, clocks["11-14"]).length
    );
    expect(roundGgProjectCard(early, clocks["11-13"], ALPHA).tokensText).not.toBe(
      roundGgProjectCard(late, clocks["11-14"], ALPHA).tokensText
    );
  });
});
