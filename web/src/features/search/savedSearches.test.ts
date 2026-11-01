import { describe, expect, it, vi } from "vitest";
import {
  SAVED_SEARCHES_KEY,
  addSavedSearch,
  loadSavedSearches,
  removeSavedSearch,
  saveSavedSearches,
  type SavedSearch
} from "./savedSearches";

/** mock storage：真 Map 行为，只实现本模块用到的面。 */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    }
  } as unknown as Storage;
}

function entry(name: string, addedAt: number, query = "q"): SavedSearch {
  return { name, query, addedAt };
}

describe("loadSavedSearches", () => {
  it("空 storage / 键不存在 → []", () => {
    expect(loadSavedSearches(memoryStorage())).toEqual([]);
  });

  it("坏 JSON → [] 且 console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const storage = memoryStorage({ [SAVED_SEARCHES_KEY]: "{not json" });
    expect(loadSavedSearches(storage)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("非数组 → []", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const storage = memoryStorage({ [SAVED_SEARCHES_KEY]: JSON.stringify({ name: "x" }) });
    expect(loadSavedSearches(storage)).toEqual([]);
    warn.mockRestore();
  });

  it("形状过滤：缺 name 或 query 非字符串 → []（整表作废口径）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const storage = memoryStorage({
      [SAVED_SEARCHES_KEY]: JSON.stringify([
        { name: "好条目", query: "q", addedAt: 1 },
        { query: "缺 name", addedAt: 2 }
      ])
    });
    expect(loadSavedSearches(storage)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("正常读取 round-trip", () => {
    const list = [entry("部署", 1), entry("报错", 2)];
    const storage = memoryStorage();
    saveSavedSearches(storage, list);
    expect(loadSavedSearches(storage)).toEqual(list);
  });
});

describe("addSavedSearch", () => {
  it("正常新增：插到最前、trim 后落盘、added: true", () => {
    const storage = memoryStorage();
    const first = addSavedSearch(storage, "  部署 ", "  error:deploy ", 100);
    expect(first.added).toBe(true);
    expect(first.list).toEqual([{ name: "部署", query: "error:deploy", addedAt: 100 }]);
    const second = addSavedSearch(storage, "报错", "traceback", 200);
    expect(second.list.map((item) => item.name)).toEqual(["报错", "部署"]);
  });

  it("重名（trim + 大小写不敏感）不覆盖，added: false", () => {
    const storage = memoryStorage();
    addSavedSearch(storage, "Deploy", "q1", 100);
    const again = addSavedSearch(storage, " deploy ", "q2 完全不同", 200);
    expect(again.added).toBe(false);
    // 原条目不动——静默覆盖会丢用户数据。
    expect(again.list).toEqual([{ name: "Deploy", query: "q1", addedAt: 100 }]);
  });

  it("name 或 query trim 后为空 → added: false", () => {
    const storage = memoryStorage();
    expect(addSavedSearch(storage, "   ", "q", 1).added).toBe(false);
    expect(addSavedSearch(storage, "名", "   ", 1).added).toBe(false);
  });

  it("上限 10：加第 11 条丢 addedAt 最小；并列丢 index 靠前", () => {
    const storage = memoryStorage();
    // 10 条，addedAt 1..10（1 最旧）。
    for (let index = 1; index <= 10; index += 1) {
      addSavedSearch(storage, `s${index}`, `q${index}`, index);
    }
    const eleventh = addSavedSearch(storage, "新", "q", 11);
    expect(eleventh.added).toBe(true);
    expect(eleventh.list).toHaveLength(10);
    // addedAt=1 的 s1 被丢。
    expect(eleventh.list.some((item) => item.name === "s1")).toBe(false);
    expect(eleventh.list.some((item) => item.name === "s2")).toBe(true);

    // 并列场景：两条同为最小 addedAt 时，前面的先走。
    const tie = memoryStorage();
    saveSavedSearches(tie, [
      entry("甲", 5),
      entry("乙", 3), // 与丙并列最小
      entry("丙", 3),
      ...Array.from({ length: 7 }, (_, index) => entry(`填${index}`, 10 + index))
    ]);
    const tieNext = addSavedSearch(tie, "新", "q", 99);
    expect(tieNext.list).toHaveLength(10);
    expect(tieNext.list.some((item) => item.name === "乙")).toBe(false); // index 靠前的先丢
    expect(tieNext.list.some((item) => item.name === "丙")).toBe(true);
  });
});

describe("removeSavedSearch", () => {
  it("按 trim + 大小写不敏感命中删除", () => {
    const storage = memoryStorage();
    saveSavedSearches(storage, [entry("Deploy", 1), entry("报错", 2)]);
    const next = removeSavedSearch(storage, "  deploy ");
    expect(next.map((item) => item.name)).toEqual(["报错"]);
    expect(loadSavedSearches(storage)).toEqual([entry("报错", 2)]);
  });

  it("不存在原样返回、不写盘", () => {
    const storage = memoryStorage();
    saveSavedSearches(storage, [entry("甲", 1)]);
    const next = removeSavedSearch(storage, "没有的名字");
    expect(next).toEqual([entry("甲", 1)]);
    expect(loadSavedSearches(storage)).toEqual([entry("甲", 1)]);
  });
});

describe("saveSavedSearches 上限写侧收口", () => {
  it("超过 10 条只落前 10（防御调用方绕过 add）", () => {
    const storage = memoryStorage();
    const eleven = Array.from({ length: 11 }, (_, index) => entry(`s${index}`, index));
    saveSavedSearches(storage, eleven);
    const loaded = loadSavedSearches(storage);
    expect(loaded).toHaveLength(10);
    expect(loaded[0].name).toBe("s0");
  });
});
