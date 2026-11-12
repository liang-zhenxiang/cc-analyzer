import { describe, expect, it } from "vitest";
import { buildTimeCapsule } from "./timeCapsule";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 夹具全部手造，期望值按夹具手算写在断言里——不从函数读回来当期望。
 * 时间一律用 `new Date(年, 月-1, 日, 时, 分)` 构造**本地时间**：胶囊的口径
 * 是本地日，UTC 字面量会让测试在非 UTC 机器上假绿或假红。
 * `now` 固定注入（2026-11-12 12:00 本地）。
 */

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

function sessionInput(
  projectLabel: string,
  records: SessionRecord[],
  projectPath?: string
): UsageSessionInput {
  return { projectLabel, records, ...(projectPath ? { projectPath } : {}) };
}

function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

/** 2026-11-12 12:00 本地。候选日：2025-11-12 / 2026-10-12 / 2026-08-04。 */
const NOW = at(2026, 11, 12, 12);

describe("timeCapsule · 候选日优先级", () => {
  it("没有任何历史记录 → null", () => {
    expect(buildTimeCapsule([], NOW)).toBeNull();
    expect(
      buildTimeCapsule([sessionInput("alpha", [record(at(2026, 1, 1, 9))])], NOW)
    ).toBeNull();
  });

  it("只有去年同一天 → 去年，标签「一年前的今天」", () => {
    const capsule = buildTimeCapsule(
      [sessionInput("alpha", [record(at(2025, 11, 12, 9), { usage: usage(100) })])],
      NOW
    )!;
    expect(capsule.dayStart).toBe(at(2025, 11, 12, 0));
    expect(capsule.label).toBe("一年前的今天");
    expect(capsule.sessions).toBe(1);
    expect(capsule.tokens).toBe(100);
    expect(capsule.project).toBe("alpha");
    expect(capsule.sentence).toBe("那天你在 alpha 里留下了 1 个会话、100 token。");
  });

  it("去年与上个月都有记录 → 仍取去年（优先级高于上个月）", () => {
    const capsule = buildTimeCapsule(
      [
        sessionInput("alpha", [record(at(2025, 11, 12, 9), { usage: usage(111) })]),
        sessionInput("beta", [record(at(2026, 10, 12, 9), { usage: usage(222) })])
      ],
      NOW
    )!;
    expect(capsule.dayStart).toBe(at(2025, 11, 12, 0));
    expect(capsule.label).toBe("一年前的今天");
    // 只算被选中的那一天，另一候选日的 token 不混进来。
    expect(capsule.tokens).toBe(111);
    expect(capsule.sessions).toBe(1);
  });

  it("只有上个月同一天 → 上个月，标签「上个月的今天」", () => {
    const capsule = buildTimeCapsule(
      [sessionInput("alpha", [record(at(2026, 10, 12, 9), { usage: usage(222) })])],
      NOW
    )!;
    expect(capsule.dayStart).toBe(at(2026, 10, 12, 0));
    expect(capsule.label).toBe("上个月的今天");
  });

  it("只有 100 天前 → 标签「100 天前」（2026-11-12 回退 100 个日历日 = 2026-08-04）", () => {
    const capsule = buildTimeCapsule(
      [sessionInput("alpha", [record(at(2026, 8, 4, 9), { usage: usage(333) })])],
      NOW
    )!;
    expect(capsule.dayStart).toBe(at(2026, 8, 4, 0));
    expect(capsule.label).toBe("100 天前");
  });

  it("候选日的前一天不冒充候选日 → null", () => {
    expect(
      buildTimeCapsule([sessionInput("alpha", [record(at(2025, 11, 13, 9))])], NOW)
    ).toBeNull();
  });
});

describe("timeCapsule · 闰日与月末钳位", () => {
  it("now = 2028-02-29，去年没有 2/29 → 回退到 2027-02-28", () => {
    const now = at(2028, 2, 29, 12);
    const capsule = buildTimeCapsule(
      [sessionInput("alpha", [record(at(2027, 2, 28, 9), { usage: usage(10) })])],
      now
    )!;
    expect(capsule.dayStart).toBe(at(2027, 2, 28, 0));
    expect(capsule.label).toBe("一年前的今天");
  });

  it("now = 2028-02-29 时不会溢出到 2027-03-01（只有 3/1 的记录 → null）", () => {
    const now = at(2028, 2, 29, 12);
    expect(
      buildTimeCapsule([sessionInput("alpha", [record(at(2027, 3, 1, 9))])], now)
    ).toBeNull();
  });

  it("上个月没有 31 日 → 落到该月最后一天（5/31 → 4/30）", () => {
    const now = at(2026, 5, 31, 12);
    const capsule = buildTimeCapsule(
      [sessionInput("alpha", [record(at(2026, 4, 30, 9), { usage: usage(10) })])],
      now
    )!;
    expect(capsule.dayStart).toBe(at(2026, 4, 30, 0));
    expect(capsule.label).toBe("上个月的今天");
  });

  it("上个月没有 31 日时不会溢到本月 1 日（只有 5/1 的记录 → null）", () => {
    const now = at(2026, 5, 31, 12);
    expect(
      buildTimeCapsule([sessionInput("alpha", [record(at(2026, 5, 1, 9))])], now)
    ).toBeNull();
  });
});

describe("timeCapsule · 聚合口径", () => {
  it("会话数 / tokens / 最活跃项目按当天记录手算，相邻日的记录全部排除", () => {
    const capsule = buildTimeCapsule(
      [
        sessionInput(
          "-Users-alice-code-alpha",
          [
            record(at(2026, 10, 12, 9), { usage: usage(100, 10, 1000, 500) }), // 1,610
            record(at(2026, 10, 12, 23, 59), { usage: usage(100) }), //        + 100
            record(at(2026, 10, 11, 23, 59), { usage: usage(8888) }), // 前一天，忽略
            record(at(2026, 10, 13, 0, 0), { usage: usage(9999) }) // 次日零点，忽略
          ],
          "/Users/alice/code/alpha"
        ),
        sessionInput(
          "-Users-alice-code-beta",
          [record(at(2026, 10, 12, 10), { usage: usage(500) })],
          "/Users/alice/code/beta"
        ),
        // 只有次日记录的输入不算进当天会话数。
        sessionInput(
          "-Users-alice-code-gamma",
          [record(at(2026, 10, 13, 10), { usage: usage(777) })],
          "/Users/alice/code/gamma"
        )
      ],
      NOW
    )!;

    expect(capsule.dayStart).toBe(at(2026, 10, 12, 0));
    expect(capsule.label).toBe("上个月的今天");
    expect(capsule.sessions).toBe(2);
    expect(capsule.tokens).toBe(1710 + 500);
    expect(capsule.project).toBe("alpha");
    expect(capsule.sentence).toBe("那天你在 2 个项目里留下了 2 个会话、2,210 token。");
  });

  it("单项目：句子用 basename，不含绝对路径", () => {
    const capsule = buildTimeCapsule(
      [
        sessionInput(
          "-Users-bob-work-solo",
          [record(at(2026, 10, 12, 9), { usage: usage(4000, 200) })],
          "/Users/bob/work/solo"
        )
      ],
      NOW
    )!;
    expect(capsule.project).toBe("solo");
    expect(capsule.tokens).toBe(4200);
    expect(capsule.sessions).toBe(1);
    expect(capsule.sentence).toBe("那天你在 solo 里留下了 1 个会话、4,200 token。");
    expect(capsule.sentence).not.toMatch(/\/Users\/|bob/);
  });

  it("最活跃项目并列时取字典序靠前的名字", () => {
    const capsule = buildTimeCapsule(
      [
        sessionInput(
          "-Users-u-dev-zeta",
          [record(at(2026, 10, 12, 9), { usage: usage(300) })],
          "/Users/u/dev/zeta"
        ),
        sessionInput(
          "-Users-u-dev-alpha",
          [record(at(2026, 10, 12, 10), { usage: usage(300) })],
          "/Users/u/dev/alpha"
        )
      ],
      NOW
    )!;
    expect(capsule.tokens).toBe(600);
    expect(capsule.project).toBe("alpha");
  });

  it("同一输入的多次记录只算一个会话；没有 usage 的记录 token 记 0 但会话仍算", () => {
    const capsule = buildTimeCapsule(
      [
        sessionInput("alpha", [
          record(at(2026, 10, 12, 9)),
          record(at(2026, 10, 12, 10)),
          record(at(2026, 10, 12, 11))
        ])
      ],
      NOW
    )!;
    expect(capsule.sessions).toBe(1);
    expect(capsule.tokens).toBe(0);
    expect(capsule.project).toBe("alpha");
    expect(capsule.sentence).toBe("那天你在 alpha 里留下了 1 个会话、0 token。");
  });

  it("当天没有任何项目标签 → project 为 null，句子不提项目", () => {
    const capsule = buildTimeCapsule(
      [sessionInput("", [record(at(2026, 10, 12, 9), { usage: usage(100) })])],
      NOW
    )!;
    expect(capsule.project).toBeNull();
    expect(capsule.sessions).toBe(1);
    expect(capsule.tokens).toBe(100);
    expect(capsule.sentence).toBe("那天你留下了 1 个会话、100 token。");
  });
});
