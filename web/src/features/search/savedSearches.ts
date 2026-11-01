/**
 * I7 保存的搜索（Round II）：localStorage 里的命名搜索词列表。
 *
 * 口径：
 * - 键名 `cca-saved-searches`，值为 SavedSearch[] 的 JSON。
 * - 模块不 import localStorage 全局——一律参数传入（测试注入 mock storage，
 *   界面层传 window.localStorage），这样逻辑层零环境依赖。
 * - 读取端防御：坏 JSON / 非数组 / 条目形状不对（缺 name 或 query 字符串）
 *   一律当空列表——存储是缓存不是真相，坏了不值得炸界面，但 console.warn
 *   一次留下线索（只 warn 一次：load 可能被反复调）。
 * - 上限 10 条：加第 11 条时丢最旧（addedAt 最小；并列丢 index 靠前的——
 *   先存的先丢，与人们「旧的自然过期」直觉一致）。调用方不用管上限。
 * - 重名判据：trim 后大小写不敏感相等（"Deploy" 与 " deploy " 是同一个）。
 *   重名不覆盖——搜索词可能不同，静默覆盖会丢用户数据。
 */

/** 一条保存的搜索。 */
export type SavedSearch = {
  name: string;
  query: string;
  addedAt: number;
};

/** localStorage 键（cca- 前缀与既有键同族）。 */
export const SAVED_SEARCHES_KEY = "cca-saved-searches";

/** 列表上限：超出丢最旧。 */
export const SAVED_SEARCHES_MAX = 10;

/** 形状校验：缺 name/query 或类型不对的条目整个列表作废（见头部注释）。 */
function isSavedSearch(value: unknown): value is SavedSearch {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.query === "string";
}

/** 重名判据：trim + 小写比较。 */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function loadSavedSearches(storage: Storage): SavedSearch[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SAVED_SEARCHES_KEY);
  } catch {
    // 某些环境（隐私模式/禁存储）getItem 会抛——当空列表。
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`cca-saved-searches 内容不是合法 JSON，已按空列表处理`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn(`cca-saved-searches 内容不是数组，已按空列表处理`);
    return [];
  }
  if (!parsed.every(isSavedSearch)) {
    console.warn(`cca-saved-searches 存在形状不对的条目，已按空列表处理`);
    return [];
  }
  return parsed;
}

export function saveSavedSearches(storage: Storage, list: SavedSearch[]): void {
  // 上限收口在写侧统一做：调用方给多长都只落前 10（列表本身按约定已 ≤10）。
  const capped = list.slice(0, SAVED_SEARCHES_MAX);
  try {
    storage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(capped));
  } catch {
    // 写不进（隐私模式/配额满）不炸界面：下次 load 自然读回旧值。
  }
}

/**
 * 新增一条。重名（trim 后大小写不敏感）或 name/query trim 后为空 →
 * added: false 且原列表不动；否则插入头部（最新在前）并按上限丢最旧。
 */
export function addSavedSearch(
  storage: Storage,
  name: string,
  query: string,
  addedAt: number
): { list: SavedSearch[]; added: boolean } {
  const trimmedName = name.trim();
  const trimmedQuery = query.trim();
  if (trimmedName === "" || trimmedQuery === "") {
    return { list: loadSavedSearches(storage), added: false };
  }
  const list = loadSavedSearches(storage);
  if (list.some((item) => sameName(item.name, trimmedName))) {
    return { list, added: false };
  }
  const next: SavedSearch[] = [{ name: trimmedName, query: trimmedQuery, addedAt }, ...list];
  // 超上限丢最旧：addedAt 最小者；并列丢 index 靠前（前面的先走）。
  // 遍历用严格小于换人 → 停在**第一个**最小值的下标上（index 靠前），删它。
  while (next.length > SAVED_SEARCHES_MAX) {
    let oldestIndex = 0;
    for (let index = 1; index < next.length; index += 1) {
      if (next[index].addedAt < next[oldestIndex].addedAt) {
        oldestIndex = index;
      }
    }
    next.splice(oldestIndex, 1);
  }
  saveSavedSearches(storage, next);
  return { list: next, added: true };
}

/** 按名删除（trim + 大小写不敏感）；不存在原样返回。 */
export function removeSavedSearch(storage: Storage, name: string): SavedSearch[] {
  const list = loadSavedSearches(storage);
  const next = list.filter((item) => !sameName(item.name, name));
  if (next.length !== list.length) {
    saveSavedSearches(storage, next);
  }
  return next;
}
