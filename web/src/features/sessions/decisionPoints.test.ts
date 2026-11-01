import { describe, expect, it } from "vitest";
import { decisionPointsOf, type DecisionRow } from "./decisionPoints";

const T0 = new Date(2026, 9, 2, 9).getTime();
const MINUTE = 60_000;

/** user 行工厂；kind 可改传，便于测过滤。 */
function row(
  summary: string,
  offsetMinutes: number,
  kind: string = "user"
): DecisionRow {
  return { kind, summary, timestamp: T0 + offsetMinutes * MINUTE };
}

describe("decisionPointsOf（I6 决策点回顾）", () => {
  it("空 rows / 全非 user 行 → 空结果", () => {
    expect(decisionPointsOf([])).toEqual([]);
    expect(
      decisionPointsOf([
        row("assistant 说了一句话", 0, "llm"),
        row("tool 跑了一趟", 1, "tool")
      ])
    ).toEqual([]);
  });

  it("首条 user 不可能是决策点——restart 词也不行", () => {
    // 第一句话没有「上一条」做对照；会话的第一句谈不上「重做」。
    const points = decisionPointsOf([row("不对，重来", 0)]);
    expect(points).toEqual([]);
  });

  it("① restart：转折/重做词命中", () => {
    const points = decisionPointsOf([
      row("帮我写一个解析器", 0),
      row("不对，字段名解析错了", 5)
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].reason).toBe("restart");
    expect(points[0].index).toBe(1);
    expect(points[0].timestamp).toBe(T0 + 5 * MINUTE);
  });

  it("② escalate：≥80 码点且比上一条长至少 50%", () => {
    const short = "帮我看看报错"; // 6 码点
    const long = `${"补".repeat(80)}充一下细节`; // 83 码点 ≥ 80，且 ≥ 6×1.5
    const points = decisionPointsOf([row(short, 0), row(long, 3)]);
    expect(points).toHaveLength(1);
    expect(points[0].reason).toBe("escalate");
    expect(points[0].index).toBe(1);
  });

  it("50% 边界：恰好 1.5 倍命中，差一点不命中", () => {
    // 上一条 80 码点：本条 120 = 1.5× 恰好命中；119 < 120 不命中。
    const base = "x".repeat(80);
    const points = decisionPointsOf([
      row(base, 0),
      row("y".repeat(120), 2),
      row(base, 30), // 重置基准：80 码点
      row("y".repeat(119), 33)
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].reason).toBe("escalate");
  });

  it("③ redirect：指令动词开头 + 间隔 > 10 分钟", () => {
    const points = decisionPointsOf([
      row("帮我写解析器", 0),
      row("然后我们去吃饭了", 30), // 30 分钟后的新指令
      row("检查一下测试", 45)
    ]);
    expect(points).toHaveLength(2);
    expect(points.every((point) => point.reason === "redirect")).toBe(true);
  });

  it("10min 边界：恰好 600000ms 不算（严格大于）", () => {
    const points = decisionPointsOf([
      row("帮我写解析器", 0),
      row("检查输出", 10) // 恰好 10 分钟 → 不触发
    ]);
    expect(points).toHaveLength(0);
    const later = decisionPointsOf([
      row("帮我写解析器", 0),
      row("检查输出", 10.0001) // 刚过 10 分钟 → 触发
    ]);
    expect(later).toHaveLength(1);
    expect(later[0].reason).toBe("redirect");
  });

  it("非指令动词开头且间隔长 → 不判 redirect", () => {
    const points = decisionPointsOf([
      row("帮我写解析器", 0),
      row("我觉得这里可能有个问题", 30) // 不以动词开头
    ]);
    expect(points).toHaveLength(0);
  });

  it("短确认一律排除——即使隔了 40 分钟也不判 redirect", () => {
    const points = decisionPointsOf([
      row("帮我写解析器", 0),
      row("继续", 40),
      row("ok", 80)
    ]);
    expect(points).toHaveLength(0);
  });

  it("多条连续决策点 + 按序命中即归类（restart 优先于 escalate/redirect）", () => {
    const points = decisionPointsOf([
      row("帮我起步", 0),
      row(`${"补".repeat(90)}细节`, 2), // escalate（上一条 4 码点）
      row("不对，全部重来", 5), // restart 优先
      row("然后我们把日志层补上", 40) // redirect（间隔 > 10min，动词开头，无转折词）
    ]);
    expect(points.map((point) => point.reason)).toEqual([
      "escalate",
      "restart",
      "redirect"
    ]);
    expect(points.map((point) => point.index)).toEqual([1, 2, 3]);
  });

  it("excerpt：前 60 码点 +「…」，60 以内原文", () => {
    // 第一夹具：超长条验证截断——escalate 要求 ≥80 码点，81 码点截前 60 +「…」。
    const excerptPoints = decisionPointsOf([
      row("a".repeat(10), 0),
      row(`${"b".repeat(59)}尾巴${"c".repeat(20)}`, 1) // 81 码点 ≥ 80，且 ≥ 10×1.5
    ]);
    expect(excerptPoints).toHaveLength(1);
    const escalated = excerptPoints[0];
    expect(escalated.excerpt).toBe(`${"b".repeat(59)}尾…`); // 前 60 码点恰好停在「尾」
    expect(Array.from(escalated.excerpt)).toHaveLength(61);

    // 第二夹具：短决策点 excerpt 原文不截。
    const shortPoints = decisionPointsOf([
      row("帮我起步", 0),
      row("不对", 2)
    ]);
    expect(shortPoints[0].excerpt).toBe("不对");
  });

  it("escalate 基准是上一条 user（不管中间隔了几条 tool/llm 行）", () => {
    const points = decisionPointsOf([
      row("短的", 0),
      row("tool 行不该当基准", 1, "tool"),
      row("llm 行也不该", 2, "llm"),
      row(`${"补".repeat(80)}细节`, 5) // 基准是「短的」
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].reason).toBe("escalate");
  });
});
