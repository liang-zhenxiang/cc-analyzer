import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  clampThresholds,
  getThresholds,
  loadThresholds,
  resetThresholds,
  setThreshold,
  setThresholds,
  subscribeThresholds
} from "./thresholds";

const STORAGE_KEY = "cca-thresholds";

beforeEach(() => {
  localStorage.clear();
  resetThresholds();
  localStorage.clear();
});

describe("clampThresholds", () => {
  test("fills missing keys with the defaults", () => {
    expect(clampThresholds({ detailRows: 500 })).toEqual({
      ...DEFAULT_THRESHOLDS,
      detailRows: 500
    });
  });

  test("clamps out-of-range and non-numeric values", () => {
    const clamped = clampThresholds({
      promptBytes: 1,
      detailRows: 99_999,
      slowTools: "abc",
      subagents: null,
      parseChunkLines: 0,
      logWindowRows: 5
    });

    expect(clamped.promptBytes).toBe(16 * 1024);
    expect(clamped.detailRows).toBe(2000);
    expect(clamped.slowTools).toBe(DEFAULT_THRESHOLDS.slowTools);
    expect(clamped.subagents).toBe(DEFAULT_THRESHOLDS.subagents);
    expect(clamped.parseChunkLines).toBe(200);
    expect(clamped.logWindowRows).toBe(20);
  });

  test("survives values that are not objects", () => {
    expect(clampThresholds(null)).toEqual(DEFAULT_THRESHOLDS);
    expect(clampThresholds("nope")).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe("threshold store", () => {
  test("starts from the documented defaults", () => {
    expect(getThresholds()).toEqual({
      promptBytes: 96 * 1024,
      detailRows: 300,
      slowTools: 10,
      subagents: 30,
      parseChunkLines: 2000,
      logWindowRows: 120
    });
  });

  test("persists a single threshold and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThresholds(listener);

    setThreshold("detailRows", 800);

    expect(getThresholds().detailRows).toBe(800);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      detailRows: 800
    });
    unsubscribe();
  });

  test("reads stored values back clamped", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ slowTools: 999, subagents: 3 }));

    const loaded = loadThresholds();

    expect(loaded.slowTools).toBe(50);
    expect(loaded.subagents).toBe(3);
    expect(loaded.detailRows).toBe(DEFAULT_THRESHOLDS.detailRows);
  });

  test("falls back to defaults on corrupt storage", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });

  test("resetThresholds restores the defaults and clears storage", () => {
    setThresholds({ logWindowRows: 500 });
    expect(getThresholds().logWindowRows).toBe(500);

    resetThresholds();

    expect(getThresholds()).toEqual(DEFAULT_THRESHOLDS);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
