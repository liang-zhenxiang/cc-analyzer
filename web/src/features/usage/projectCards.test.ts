import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { buildProjectCards, CARD_LIMIT, SPARKLINE_DAYS } from "./projectCards";

/**
 * Round CC / F6 的纯逻辑：一张卡 = 一个窗口内有活动的项目。
 *
 * 断言的全是具体数字（会话数、消息数、token、金额、走势下标），因为卡片
 * 的全部价值就是「不用点进去也能读到准确读数」。
 */

const NOW = new Date(2026, 0, 15, 18, 0).getTime();
const ALPHA = "-work-alpha";
const BETA = "-work-beta";
const ZETA = "-work-zeta";
const GAMMA = "-work-gamma";

function at(dayOffset: number, hour = 10): number {
  return new Date(2026, 0, 15 + dayOffset, hour).getTime();
}

function recordOf(
  id: string,
  timestamp: number,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...overrides
  };
}

function usageOf(input: number, output = 0): SessionUsage {
  return { inputTokens: input, outputTokens: output };
}

function inputOf(
  label: string,
  records: SessionRecord[],
  projectPath?: string
): UsageSessionInput {
  const input: UsageSessionInput = { projectLabel: label, records };
  if (projectPath) input.projectPath = projectPath;
  return input;
}

/** 两个会话、一个工具记录、一条压缩摘要、还有一条 10 天前的记录。 */
function alphaSessions(): UsageSessionInput[] {
  return [
    inputOf(
      ALPHA,
      [
        recordOf("a-user", at(0), { kind: "user", text: "看看这个仓库" }),
        recordOf("a-llm", at(0, 10) + 60_000, {
          model: "claude-sonnet-4-5-20250929",
          usage: usageOf(1_000_000, 100_000)
        }),
        recordOf("a-tool", at(0, 10) + 120_000, { kind: "tool" })
      ],
      "/work/alpha"
    ),
    inputOf(ALPHA, [
      recordOf("a2-llm", at(-1), {
        model: "claude-sonnet-4-5-20250929",
        usage: usageOf(500_000)
      }),
      recordOf("a2-compact", at(-1) + 60_000, {
        kind: "user",
        compactSummary: true
      }),
      recordOf("a2-user", at(-1) + 120_000, { kind: "user", text: "继续" })
    ]),
    inputOf(ALPHA, [
      recordOf("a3-old", at(-10), {
        model: "claude-sonnet-4-5-20250929",
        usage: usageOf(400_000)
      })
    ])
  ];
}

function betaSession(): UsageSessionInput {
  return inputOf(
    BETA,
    [
      recordOf("b-user", at(0), { kind: "user" }),
      recordOf("b-llm", at(0, 10) + 60_000, {
        model: "claude-sonnet-4-5-20250929",
        usage: usageOf(300_000)
      })
    ],
    "/work/beta"
  );
}

function zetaSession(): UsageSessionInput {
  return inputOf(ZETA, [
    recordOf("z-llm", at(0), { model: "gemini-3-pro", usage: usageOf(10_000) })
  ]);
}

describe("buildProjectCards", () => {
  it("builds one card per in-window project with exact counts", () => {
    const cards = buildProjectCards(
      [...alphaSessions(), betaSession(), zetaSession()],
      30,
      CARD_LIMIT,
      NOW
    );

    expect(cards.map((card) => card.displayName)).toEqual([
      "alpha",
      "beta",
      "work-zeta"
    ]);

    const alpha = cards[0];
    expect(alpha.sessions).toBe(3);
    // user + assistant + assistant + user + the 10-days-ago assistant (still
    // inside 30 days); the tool record and the compact summary are not messages.
    expect(alpha.messages).toBe(5);
    expect(alpha.tokens).toBe(1_000_000 + 100_000 + 500_000 + 400_000);
    expect(alpha.usd).toBeCloseTo(3 + 1.5 + 1.5 + 1.2, 6);
    expect(alpha.path).toBe("/work/alpha");

    const beta = cards[1];
    expect(beta.sessions).toBe(1);
    expect(beta.messages).toBe(2);
    expect(beta.tokens).toBe(300_000);
    expect(beta.usd).toBeCloseTo(0.9, 6);
  });

  it("marks a project with an unpriced model as 定价未知 instead of a partial sum", () => {
    const cards = buildProjectCards([zetaSession(), betaSession()], 30, CARD_LIMIT, NOW);
    const zeta = cards.find((card) => card.displayName === "work-zeta");
    expect(zeta?.usd).toBeNull();
    expect(cards.find((card) => card.displayName === "beta")?.usd).toBeCloseTo(0.9, 6);
  });

  it("drops projects whose records all fall outside the window", () => {
    const gamma = inputOf(GAMMA, [
      recordOf("g-old", at(-40), { usage: usageOf(9_000_000) })
    ]);
    const cards = buildProjectCards([gamma, betaSession()], 30, CARD_LIMIT, NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0].label).toBe(BETA);
  });

  it("sorts by tokens and honours the limit", () => {
    const cards = buildProjectCards(
      [...alphaSessions(), betaSession(), zetaSession()],
      30,
      2,
      NOW
    );
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.tokens)).toEqual([2_000_000, 300_000]);
  });

  it("keeps a fixed 14-day sparkline even when the range is 7 days", () => {
    const cards = buildProjectCards(alphaSessions(), 7, CARD_LIMIT, NOW);
    const alpha = cards[0];
    expect(alpha.sparkline).toHaveLength(SPARKLINE_DAYS);
    // 10 天前那条只出现在走势里，不进 7 天窗口的 token 合计。
    expect(alpha.tokens).toBe(1_000_000 + 100_000 + 500_000);
    expect(alpha.sparkline[3]).toBe(400_000);
    expect(alpha.sparkline[SPARKLINE_DAYS - 1]).toBe(1_100_000);
    expect(alpha.sparkline[SPARKLINE_DAYS - 2]).toBe(500_000);
    expect(alpha.sparkline[0]).toBe(0);
  });

  it("uses the newest in-window record as 最近活跃", () => {
    const cards = buildProjectCards(alphaSessions(), 7, CARD_LIMIT, NOW);
    expect(cards[0].lastActive).toBe(at(0, 10) + 120_000);
  });

  it("returns an empty list when nothing is in the window", () => {
    expect(buildProjectCards([], 30, CARD_LIMIT, NOW)).toEqual([]);
  });
});
