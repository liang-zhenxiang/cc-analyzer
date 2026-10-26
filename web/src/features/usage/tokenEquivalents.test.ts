import { describe, expect, it } from "vitest";
import { EQUIVALENTS, equivalentsFor } from "./tokenEquivalents";

describe("tokenEquivalents", () => {
  it("returns every entry at zero count for 0 tokens", () => {
    const result = equivalentsFor(0);
    expect(result).toHaveLength(EQUIVALENTS.length);
    for (const entry of result) {
      expect(entry.count).toBe(0);
      expect(entry.formatted).toBe("0");
    }
  });

  it("floors below one unit to 0 but keeps the entry", () => {
    const result = equivalentsFor(800_000);
    const byId = new Map(result.map((entry) => [entry.id, entry]));
    expect(byId.get("coffee")?.count).toBe(0);
    expect(byId.get("novel")?.count).toBe(6);
    expect(byId.get("movie")?.count).toBe(100);
    expect(byId.get("carbon")?.count).toBe(26);
  });

  it("formats large counts with thousands separators", () => {
    const result = equivalentsFor(2_500_000_000);
    const byId = new Map(result.map((entry) => [entry.id, entry]));
    expect(byId.get("coffee")).toMatchObject({ count: 1666, formatted: "1,666" });
    expect(byId.get("novel")).toMatchObject({ count: 20_833, formatted: "20,833" });
    expect(byId.get("movie")).toMatchObject({ count: 312_500, formatted: "312,500" });
    expect(byId.get("carbon")).toMatchObject({ count: 83_333, formatted: "83,333" });
  });

  it("formats exactly one unit without a separator", () => {
    const coffee = equivalentsFor(1_500_000).find((entry) => entry.id === "coffee");
    expect(coffee).toMatchObject({ count: 1, formatted: "1" });
  });

  it("treats negative and non-finite tokens as zero", () => {
    expect(equivalentsFor(-5).every((entry) => entry.count === 0)).toBe(true);
    expect(equivalentsFor(Number.NaN).every((entry) => entry.count === 0)).toBe(true);
    expect(equivalentsFor(Number.POSITIVE_INFINITY).every((entry) => entry.count === 0)).toBe(true);
  });

  it("documents every conversion: positive unit and a non-empty note", () => {
    for (const seed of EQUIVALENTS) {
      expect(seed.tokensPerUnit).toBeGreaterThan(0);
      expect(seed.note.trim().length).toBeGreaterThan(0);
      expect(seed.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the public id/label shape in the output", () => {
    const result = equivalentsFor(1_500_000);
    expect(result.map((entry) => entry.id)).toEqual(EQUIVALENTS.map((seed) => seed.id));
    expect(result.map((entry) => entry.label)).toEqual(EQUIVALENTS.map((seed) => seed.label));
  });
});
