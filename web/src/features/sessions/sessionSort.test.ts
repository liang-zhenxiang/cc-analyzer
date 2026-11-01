import { describe, expect, it } from "vitest";
import { sortSessions, type SessionSortKey } from "./sessionSort";

/**
 * H3 会话排序：降序、null 排最后、并列稳定。fixtures 用最小形状
 * （{ id, mtimeMs } + getValue 侧挂数值），验证的是排序契约本身。
 */

type Row = { id: string; mtimeMs: number; tokens: number | null };

function rows(): Row[] {
  return [
    { id: "a", mtimeMs: 100, tokens: 5 },
    { id: "b", mtimeMs: 300, tokens: null },
    { id: "c", mtimeMs: 200, tokens: 5 },
    { id: "d", mtimeMs: 50, tokens: 9 },
    { id: "e", mtimeMs: 400, tokens: null }
  ];
}

/** recent 走 mtimeMs（缺省字段，不经 getValue）；其余键走注入的 getValue。 */
function getValue(row: Row, key: SessionSortKey): number | null {
  if (key === "recent") return row.mtimeMs;
  return row.tokens;
}

describe("sortSessions", () => {
  it("recent：按 mtimeMs 降序", () => {
    const sorted = sortSessions(rows(), "recent", getValue);
    expect(sorted.map((r) => r.id)).toEqual(["e", "b", "c", "a", "d"]);
  });

  it("tokens：降序且 null 排最后", () => {
    const sorted = sortSessions(rows(), "tokens", getValue);
    // 9 > 5 = 5（并列 a、c 保持原相对顺序）> null（b、e 保持原序）。
    expect(sorted.map((r) => r.id)).toEqual(["d", "a", "c", "b", "e"]);
  });

  it("并列稳定：同值条目保持传入时的相对顺序", () => {
    const tied = [
      { id: "x1", mtimeMs: 1, tokens: 7 },
      { id: "x2", mtimeMs: 2, tokens: 7 },
      { id: "x3", mtimeMs: 3, tokens: 7 },
      { id: "x4", mtimeMs: 4, tokens: 7 }
    ];
    const sorted = sortSessions(tied, "tokens", getValue);
    expect(sorted.map((r) => r.id)).toEqual(["x1", "x2", "x3", "x4"]);
    // 原数组未被改动。
    expect(tied.map((r) => r.id)).toEqual(["x1", "x2", "x3", "x4"]);
  });

  it("null 之间也稳定（缺数据行保持原相对顺序）", () => {
    const partial = [
      { id: "n1", mtimeMs: 1, tokens: null },
      { id: "v", mtimeMs: 2, tokens: 3 },
      { id: "n2", mtimeMs: 3, tokens: null }
    ];
    const sorted = sortSessions(partial, "tokens", getValue);
    expect(sorted.map((r) => r.id)).toEqual(["v", "n1", "n2"]);
  });

  it("空数组返回空数组", () => {
    expect(sortSessions([], "recent", getValue)).toEqual([]);
    expect(sortSessions([], "errors", getValue)).toEqual([]);
  });

  it("自定义 getValue：durationMs/errors 等键同一契约", () => {
    type Fat = { id: string; mtimeMs: number; durationMs: number; errors: number | null };
    const fat: Fat[] = [
      { id: "f1", mtimeMs: 1, durationMs: 500, errors: null },
      { id: "f2", mtimeMs: 2, durationMs: 900, errors: 4 },
      { id: "f3", mtimeMs: 3, durationMs: 100, errors: 4 },
      { id: "f4", mtimeMs: 4, durationMs: 100, errors: 1 }
    ];
    const byDuration: (s: Fat, key: SessionSortKey) => number | null = (s, key) =>
      key === "recent" ? s.mtimeMs : key === "durationMs" ? s.durationMs : s.errors;
    expect(sortSessions(fat, "durationMs", byDuration).map((r) => r.id)).toEqual([
      "f2",
      "f1",
      "f3",
      "f4"
    ]);
    // errors：4 = 4 并列（f2 先于 f3）> 1 > null。
    expect(sortSessions(fat, "errors", byDuration).map((r) => r.id)).toEqual([
      "f2",
      "f3",
      "f4",
      "f1"
    ]);
  });
});
