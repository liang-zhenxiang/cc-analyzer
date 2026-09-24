import { describe, expect, it } from "vitest";
import { safeStringify } from "./json";

describe("safeStringify", () => {
  it("formats plain data like JSON.stringify", () => {
    expect(safeStringify({ tool: "Bash", ms: 12 }, 2)).toBe(
      ['{', '  "tool": "Bash",', '  "ms": 12', '}'].join("\n")
    );
    expect(safeStringify("hello")).toBe('"hello"');
  });

  it("renders bigints instead of throwing", () => {
    expect(safeStringify({ tokens: 9_007_199_254_740_993n })).toBe(
      '{"tokens":"9007199254740993n"}'
    );
  });

  it("marks circular references", () => {
    type Node = { name: string; self?: Node };
    const node: Node = { name: "root" };
    node.self = node;

    expect(safeStringify(node)).toBe('{"name":"root","self":"[循环引用]"}');
  });

  it("marks repeated references the same way", () => {
    const shared = { id: 1 };
    expect(safeStringify({ a: shared, b: shared })).toBe(
      '{"a":{"id":1},"b":"[循环引用]"}'
    );
  });

  it("keeps exotic values printable", () => {
    expect(safeStringify([undefined, () => undefined, Symbol("s")])).toBe(
      '[null,"[函数]","Symbol(s)"]'
    );
    expect(safeStringify(undefined)).toBe("undefined");
  });

  it("falls back to a message when serialisation fails outright", () => {
    const hostile = {
      toJSON() {
        throw new Error("boom");
      }
    };

    expect(safeStringify(hostile)).toBe("（无法序列化：boom）");
  });
});
