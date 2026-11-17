import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import {
  buildCostTreemap,
  layoutTreemap,
  mergeTinySessions,
  TREEMAP_OTHER_ID,
  type TreemapSession
} from "./treemap";

/**
 * Issue #359 的纯逻辑：squarified 布局 + 项目/会话聚合。
 *
 * 布局用属性式断言（20 组随机输入）而不是只钉一个手写例子：矩形不重叠、
 * 不出界、面积严格正比于 value，是这套算法唯一的契约；手写例子能证明的
 * 只是「这一组碰巧对」。
 */

const EPS = 1e-6;

/** 固定本地时间，避免测试随真实时钟漂移。 */
const NOW = new Date(2026, 0, 15, 18, 0).getTime();

/** 7 天窗口 = 1/9 00:00 → 1/16 00:00（本地自然日，含今天）。 */
function at(day: number, hour = 10, minute = 0): number {
  return new Date(2026, 0, day, hour, minute, 0).getTime();
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

/** 1M sonnet input = $3.00，便于对金额做精确断言。 */
const SONNET = "claude-sonnet-4-5-20250929";
const UNPRICED = "mystery-model-1";

function pricedRecord(id: string, timestamp: number, input: number): SessionRecord {
  return recordOf(id, timestamp, { model: SONNET, usage: usageOf(input) });
}

function inputOf(
  label: string,
  records: SessionRecord[],
  options: { projectPath?: string; session?: SessionMeta } = {}
): UsageSessionInput {
  const input: UsageSessionInput = { projectLabel: label, records };
  if (options.projectPath) input.projectPath = options.projectPath;
  if (options.session) input.session = options.session;
  return input;
}

function metaOf(path: string, projectLabel: string, title: string, cwd?: string): SessionMeta {
  return {
    path,
    mtimeMs: 0,
    sizeBytes: 0,
    projectLabel,
    hasRecords: true,
    customTitle: title,
    ...(cwd ? { cwd } : {})
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function aspectOf(rect: { w: number; h: number }): number {
  if (rect.w <= 0 || rect.h <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(rect.w / rect.h, rect.h / rect.w);
}

// ---------------------------------------------------------------------------
// layoutTreemap
// ---------------------------------------------------------------------------

describe("layoutTreemap", () => {
  it("lays a single item over the whole canvas", () => {
    expect(layoutTreemap([{ key: "only", value: 7 }], 400, 200)).toEqual([
      { key: "only", x: 0, y: 0, w: 400, h: 200 }
    ]);
  });

  it("returns nothing for an empty canvas, empty input, or non-positive sizes", () => {
    expect(layoutTreemap([{ key: "a", value: 1 }], 0, 100)).toEqual([]);
    expect(layoutTreemap([{ key: "a", value: 1 }], 100, 0)).toEqual([]);
    expect(layoutTreemap([{ key: "a", value: 1 }], -10, 100)).toEqual([]);
    expect(layoutTreemap([], 100, 100)).toEqual([]);
    expect(layoutTreemap([{ key: "a", value: 0 }], 100, 100)).toEqual([]);
    expect(layoutTreemap([{ key: "a", value: Number.NaN }], 100, 100)).toEqual([]);
  });

  it("filters zero and negative values instead of emitting zero-area rects", () => {
    const rects = layoutTreemap(
      [
        { key: "a", value: 10 },
        { key: "zero", value: 0 },
        { key: "negative", value: -5 },
        { key: "b", value: 10 }
      ],
      100,
      100
    );

    expect(rects.map((rect) => rect.key).sort()).toEqual(["a", "b"]);
    for (const rect of rects) {
      expect(rect.w * rect.h).toBeCloseTo(5000, 6);
    }
    const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
    expect(area).toBeCloseTo(100 * 100, 6);
  });

  it("gives equal values equal area", () => {
    const rects = layoutTreemap(
      ["a", "b", "c", "d"].map((key) => ({ key, value: 100 })),
      200,
      200
    );

    expect(rects).toHaveLength(4);
    for (const rect of rects) {
      expect(rect.w * rect.h).toBeCloseTo((200 * 200) / 4, 6);
    }
  });

  it("keeps 20 random layouts non-overlapping, in bounds, and area-proportional", () => {
    const random = mulberry32(0xc0ffee);
    const bounds = 1e-6;

    for (let round = 0; round < 20; round += 1) {
      const count = 1 + Math.floor(random() * 40);
      const width = 400 + random() * 600;
      // 贴近真实面板的宽高比（0.6–1.0 倍宽）：树图铺在卡片里，不是一条细带。
      // 极端画布下单个矩形只能是极端矩形，那不是算法的问题，也无法断言「近正方形」。
      const height = width * (0.6 + random() * 0.4);
      // 中等离散度：单一元素占 95% 面积时，尾部只剩一条窄带，窄带里的任何
      // 矩形都不可能「接近正方形」——那是面积守恒的必然结果，不是布局缺陷。
      const items = Array.from({ length: count }, (_, index) => ({
        key: `item-${round}-${index}`,
        value: 10 + random() * 990
      }));
      const totalValue = items.reduce((sum, item) => sum + item.value, 0);
      const rects = layoutTreemap(items, width, height);

      expect(rects).toHaveLength(count);

      let rectArea = 0;
      for (const rect of rects) {
        expect(rect.x).toBeGreaterThanOrEqual(-bounds);
        expect(rect.y).toBeGreaterThanOrEqual(-bounds);
        expect(rect.w).toBeGreaterThanOrEqual(-bounds);
        expect(rect.h).toBeGreaterThanOrEqual(-bounds);
        expect(rect.x + rect.w).toBeLessThanOrEqual(width + bounds);
        expect(rect.y + rect.h).toBeLessThanOrEqual(height + bounds);
        rectArea += rect.w * rect.h;
      }

      // 面积之和 = 画布面积：过滤/缩放之后没有留下空洞。
      expect(rectArea).toBeCloseTo(width * height, 5);

      // 面积严格正比于 value。
      const byKey = new Map(items.map((item) => [item.key, item.value]));
      for (const rect of rects) {
        const expected = ((byKey.get(rect.key) ?? 0) / totalValue) * width * height;
        expect(Math.abs(rect.w * rect.h - expected)).toBeLessThan(EPS);
      }

      // 两两不重叠（容差内的边界接触不算重叠）。
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (overlapW > 0 && overlapH > 0) {
            expect(overlapW * overlapH).toBeLessThan(EPS);
          }
        }
      }

      // squarified 的意义：平均宽高比接近 1。
      const meanAspect =
        rects.reduce((sum, rect) => sum + aspectOf(rect), 0) / rects.length;
      expect(meanAspect).toBeLessThan(3);
    }
  });

  it("is deterministic and independent of input order", () => {
    const items = [
      { key: "a", value: 5 },
      { key: "b", value: 3 },
      { key: "c", value: 2 }
    ];
    expect(layoutTreemap(items, 300, 200)).toEqual(
      layoutTreemap([...items].reverse(), 300, 200)
    );
  });
});

// ---------------------------------------------------------------------------
// buildCostTreemap
// ---------------------------------------------------------------------------

describe("buildCostTreemap", () => {
  function mixedInputs(): UsageSessionInput[] {
    return [
      inputOf(
        "-work-alpha",
        [
          recordOf("a1-user", at(14), { kind: "user", text: "开始" }),
          pricedRecord("a1-llm", at(14, 11), 1_000_000)
        ],
        {
          projectPath: "/work/alpha",
          session: metaOf("/logs/a1.jsonl", "-work-alpha", "Alpha 已定价会话")
        }
      ),
      inputOf(
        "-work-alpha",
        [
          recordOf("a2-llm", at(13), { model: UNPRICED, usage: usageOf(1_000_000) }),
          recordOf("a2-user", at(13, 11), { kind: "user" })
        ],
        {
          projectPath: "/work/alpha",
          session: metaOf("/logs/a2.jsonl", "-work-alpha", "Alpha 未定价会话")
        }
      ),
      inputOf("-work-beta", [pricedRecord("b1-llm", at(12), 500_000)], {
        projectPath: "/work/beta",
        session: metaOf("/logs/b1.jsonl", "-work-beta", "Beta 会话")
      })
    ];
  }

  it("cost mode keeps only priced sessions and counts the excluded ones", () => {
    const tree = buildCostTreemap(mixedInputs(), "cost", 7, NOW);

    expect(tree.excludedUnpriced).toBe(1);
    expect(tree.total).toBeCloseTo(4.5, 12);
    expect(tree.projects.map((project) => project.project)).toEqual(["alpha", "beta"]);
    expect(tree.projects.map((project) => project.value)).toEqual([
      expect.closeTo(3, 12),
      expect.closeTo(1.5, 12)
    ]);

    const alpha = tree.projects[0];
    expect(alpha.sessions).toHaveLength(1);
    expect(alpha.sessions[0]).toMatchObject({
      title: "Alpha 已定价会话",
      value: 3,
      usd: 3,
      model: SONNET
    });
  });

  it("token mode includes every session, pricing unknown models as usd: null", () => {
    const tree = buildCostTreemap(mixedInputs(), "token", 7, NOW);

    expect(tree.excludedUnpriced).toBe(0);
    expect(tree.total).toBe(2_500_000);

    const alpha = tree.projects[0];
    expect(alpha.project).toBe("alpha");
    expect(alpha.value).toBe(2_000_000);
    expect(alpha.sessions.map((session) => session.title)).toEqual([
      "Alpha 已定价会话",
      "Alpha 未定价会话"
    ]);
    expect(alpha.sessions.map((session) => session.usd)).toEqual([3, null]);
    expect(alpha.sessions[1].model).toBe(UNPRICED);
  });

  it("sorts sessions and projects by value descending", () => {
    const tree = buildCostTreemap(
      [
        inputOf(
          "-work-small",
          [recordOf("s1", at(14), { model: SONNET, usage: usageOf(100) })],
          { projectPath: "/work/small" }
        ),
        inputOf(
          "-work-big",
          [recordOf("b1", at(14), { model: SONNET, usage: usageOf(500) })],
          { projectPath: "/work/big" }
        ),
        inputOf(
          "-work-big",
          [recordOf("b2", at(14), { model: SONNET, usage: usageOf(900) })],
          { projectPath: "/work/big" }
        ),
        inputOf(
          "-work-big",
          [recordOf("b3", at(14), { model: SONNET, usage: usageOf(300) })],
          { projectPath: "/work/big" }
        )
      ],
      "token",
      7,
      NOW
    );

    expect(tree.projects.map((project) => project.project)).toEqual(["big", "small"]);
    expect(tree.projects[0].sessions.map((session) => session.value)).toEqual([
      900, 500, 300
    ]);
  });

  it("clips records to the local-day window on both ends", () => {
    const tree = buildCostTreemap(
      [
        inputOf("-work-edge", [
          // 窗口起点（1/9 00:00）计入。
          recordOf("start", at(9, 0, 0), { model: SONNET, usage: usageOf(100) })
        ]),
        inputOf("-work-edge", [
          // 起点前 1ms 不计入。
          recordOf("before", at(9, 0, 0) - 1, { model: SONNET, usage: usageOf(1_000) })
        ]),
        inputOf("-work-edge", [
          // 窗口终点（1/16 00:00）不计入。
          recordOf("end", at(16, 0, 0), { model: SONNET, usage: usageOf(1_000) })
        ]),
        inputOf("-work-edge", [
          // 窗口最后一刻计入。
          recordOf("last", at(15, 23, 59), { model: SONNET, usage: usageOf(50) })
        ])
      ],
      "token",
      7,
      NOW
    );

    expect(tree.total).toBe(150);
    expect(tree.projects[0].sessions.map((session) => session.value)).toEqual([100, 50]);
  });

  it("drops zero-value sessions and keeps the project out when nothing is left", () => {
    const tree = buildCostTreemap(
      [
        inputOf("-work-empty", [recordOf("chat", at(14), { kind: "user", text: "hi" })]),
        inputOf("-work-zero", [
          recordOf("zero", at(14), { model: SONNET, usage: usageOf(0) })
        ])
      ],
      "token",
      7,
      NOW
    );

    expect(tree.projects).toEqual([]);
    expect(tree.total).toBe(0);
  });

  it("does not count a zero-token unpriced session as excluded", () => {
    const tree = buildCostTreemap(
      [
        inputOf("-work-alpha", [
          recordOf("zero", at(14), { model: UNPRICED, usage: usageOf(0) })
        ])
      ],
      "cost",
      7,
      NOW
    );

    expect(tree.excludedUnpriced).toBe(0);
    expect(tree.projects).toEqual([]);
  });

  it("falls back to the project name when there is no session metadata", () => {
    const tree = buildCostTreemap(
      [
        inputOf("-Users-me-repo-alpha", [
          recordOf("llm", at(14), { model: SONNET, usage: usageOf(100) })
        ])
      ],
      "token",
      7,
      NOW
    );

    expect(tree.projects[0].project).toBe("Users-me-repo-alpha");
    expect(tree.projects[0].sessions[0].title).toBe("Users-me-repo-alpha");
  });
});

// ---------------------------------------------------------------------------
// mergeTinySessions
// ---------------------------------------------------------------------------

describe("mergeTinySessions", () => {
  function sessionsOf(values: Array<{ value: number; usd?: number | null }>): TreemapSession[] {
    return values.map((entry, index) => ({
      id: `s${index}`,
      title: `会话 ${index}`,
      value: entry.value,
      usd: entry.usd === undefined ? 0 : entry.usd,
      model: SONNET
    }));
  }

  it("folds sub-threshold sessions into an 'other' block", () => {
    const merged = mergeTinySessions(
      sessionsOf([{ value: 100 }, { value: 80 }, { value: 5 }, { value: 3 }, { value: 2 }]),
      0.05
    );

    expect(merged.mergedCount).toBe(3);
    expect(merged.mergedValue).toBe(10);
    expect(merged.sessions).toHaveLength(3);
    expect(merged.sessions.map((session) => session.value)).toEqual([100, 80, 10]);
    expect(merged.sessions[2]).toMatchObject({
      id: TREEMAP_OTHER_ID,
      title: "其余 3 个",
      value: 10,
      usd: 0,
      model: null
    });
  });

  it("does not merge a value exactly on the threshold", () => {
    const merged = mergeTinySessions(sessionsOf([{ value: 50 }, { value: 40 }, { value: 10 }]), 0.1);

    expect(merged.mergedCount).toBe(0);
    expect(merged.sessions).toHaveLength(3);
  });

  it("leaves a single tiny session alone", () => {
    const merged = mergeTinySessions(sessionsOf([{ value: 100 }, { value: 1 }]), 0.05);

    expect(merged.mergedCount).toBe(0);
    expect(merged.sessions.map((session) => session.id)).toEqual(["s0", "s1"]);
  });

  it("honours a caller-provided denominator", () => {
    // 相对自身求和 2 是小块，但相对给定的总面积 1000 更小；阈值都取 0.1。
    const merged = mergeTinySessions(
      sessionsOf([{ value: 2 }, { value: 1 }, { value: 1 }]),
      0.1,
      1000
    );

    expect(merged.mergedCount).toBe(3);
    expect(merged.mergedValue).toBe(4);
  });

  it("keeps usd null when any folded session is unpriced", () => {
    const merged = mergeTinySessions(
      sessionsOf([
        { value: 100 },
        { value: 2, usd: 1 },
        { value: 1, usd: null }
      ]),
      0.05
    );

    expect(merged.sessions[1]).toMatchObject({ id: TREEMAP_OTHER_ID, usd: null });
  });

  it("does nothing when there is no area or no threshold", () => {
    const sessions = sessionsOf([{ value: 0 }, { value: 0 }]);
    expect(mergeTinySessions(sessions, 0.1).mergedCount).toBe(0);
    expect(mergeTinySessions(sessionsOf([{ value: 1 }, { value: 1 }]), 0).mergedCount).toBe(0);
  });
});
