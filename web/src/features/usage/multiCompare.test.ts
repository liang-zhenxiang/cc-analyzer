import { describe, expect, it } from "vitest";
import {
  multiCompareOf,
  type MultiCompareEntity
} from "./multiCompare";

/* ── I4 多选对照：对照几何（份额/最优/离散）────────────────────── */

function entity(
  id: string,
  tokens: number,
  extras: Partial<MultiCompareEntity["metrics"]> = {}
): MultiCompareEntity {
  return {
    id,
    label: id,
    metrics: {
      sessions: 1,
      tokens,
      messages: 10,
      errors: 0,
      activeDays: 1,
      ...extras
    }
  };
}

describe("multiCompareOf（I4 多选对照）", () => {
  it("shares 按所选实体同指标之和归一，行原样带回 metrics", () => {
    const result = multiCompareOf("project", [
      entity("alpha", 300, { sessions: 3 }),
      entity("beta", 100, { sessions: 1 })
    ]);

    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(2);
    expect(result!.rows[0].shares.tokens).toBeCloseTo(0.75, 12);
    expect(result!.rows[1].shares.tokens).toBeCloseTo(0.25, 12);
    expect(result!.rows[0].shares.sessions).toBeCloseTo(0.75, 12);
    // metrics 原样带回：对照表要展示原始读数，不只份额。
    expect(result!.rows[0].metrics.tokens).toBe(300);
    expect(result!.rows[0].metrics.messages).toBe(10);
  });

  it("best 取 tokens 最大者；并列取 id 字典序靠前（可复现平局裁决）", () => {
    const unique = multiCompareOf("model", [entity("b", 100), entity("a", 300)]);
    expect(unique!.best).toEqual({ by: "tokens", id: "a" });

    const tied = multiCompareOf("model", [entity("zeta", 300), entity("alpha", 300)]);
    expect(tied!.best).toEqual({ by: "tokens", id: "alpha" });
  });

  it("spread = (max−min)/max；全员 0 时 null（无离散度可言）", () => {
    const normal = multiCompareOf("tool", [entity("t1", 300), entity("t2", 100)]);
    expect(normal!.spread).toBeCloseTo((300 - 100) / 300, 12);

    const flat = multiCompareOf("tool", [entity("t1", 200), entity("t2", 200)]);
    expect(flat!.spread).toBe(0);

    const zeros = multiCompareOf("tool", [
      entity("t1", 0, { sessions: 0 }),
      entity("t2", 0, { sessions: 0 })
    ]);
    expect(zeros!.spread).toBeNull();
    // 全员 0 时 shares 也是 0（0 分母 → 0），不假装有比例。
    expect(zeros!.rows[0].shares.tokens).toBe(0);
    expect(zeros!.rows[0].shares.sessions).toBe(0);
  });

  it("少于 2 个实体返回 null（「选择至少两个实体」由界面表达）", () => {
    expect(multiCompareOf("project", [])).toBeNull();
    expect(multiCompareOf("project", [entity("only", 10)])).toBeNull();
  });

  it("0 分母只发生在全体为 0 时：单实体非 0 不会出现 0 分母", () => {
    const mixed = multiCompareOf("project", [entity("p1", 500), entity("p2", 0)]);
    // 500/500=1、0/500=0——有一个非 0 分母就不是 0。
    expect(mixed!.rows[0].shares.tokens).toBe(1);
    expect(mixed!.rows[1].shares.tokens).toBe(0);
    expect(mixed!.spread).toBe(1);
  });
});
