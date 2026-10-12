import { afterEach, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import {
  CONTRAST_KEY,
  DEFAULT_CONTRAST,
  applyContrast,
  getContrast,
  initContrast,
  parseContrast,
  prefersHighContrast,
  readStoredContrast,
  resetContrastForTest,
  resolveContrast,
  setContrast,
  subscribeContrast
} from "./contrast";

/** 可注入的 storage 替身：只用到 getItem 这一个面。 */
function storageOf(value: string | null, throwOnRead = false) {
  return {
    getItem: (key: string) => {
      if (throwOnRead) throw new Error("storage disabled");
      return key === CONTRAST_KEY ? value : null;
    }
  };
}

afterEach(() => {
  resetContrastForTest();
  // 每个用例都把根属性清干净，避免用例之间互相污染。
  applyContrast(DEFAULT_CONTRAST);
  localStorage.clear();
});

test("档位是白名单：未知值与坏数据一律回落普通", () => {
  expect(parseContrast("high")).toBe("high");
  expect(parseContrast("normal")).toBe("normal");
  expect(parseContrast("max")).toBe("normal");
  expect(parseContrast("HIGH")).toBe("normal");
  expect(parseContrast("")).toBe("normal");
  expect(parseContrast(null)).toBe("normal");
  expect(parseContrast(123)).toBe("normal");
});

test("readStoredContrast 只认白名单，『没写过』与『选过普通』必须分开", () => {
  expect(readStoredContrast(storageOf("high"))).toBe("high");
  expect(readStoredContrast(storageOf("normal"))).toBe("normal");
  // 未写 / 非法 / 读抛异常都返回 null——「没选过」才允许继续跟随系统。
  expect(readStoredContrast(storageOf(null))).toBeNull();
  expect(readStoredContrast(storageOf("max"))).toBeNull();
  expect(readStoredContrast(storageOf("normal", true))).toBeNull();
});

test("三步判定：存储优先、系统次之、都问不到就普通", () => {
  const more = { matches: true };
  const less = { matches: false };
  // ① 存储命中就先信存储。
  expect(resolveContrast(storageOf("high"), more)).toBe("high");
  expect(resolveContrast(storageOf("normal"), more)).toBe("normal");
  // ② 没写过才看系统偏好。
  expect(resolveContrast(storageOf(null), more)).toBe("high");
  expect(resolveContrast(storageOf(null), less)).toBe("normal");
  // ③ 系统偏好问不到（jsdom / 老引擎）→ 普通。
  expect(resolveContrast(storageOf(null), null)).toBe("normal");
  expect(prefersHighContrast(more)).toBe(true);
  expect(prefersHighContrast(null)).toBe(false);
});

test("唯一的换挡载体是根元素 data-contrast：高对比度写上、普通档删掉", () => {
  const root = document.createElement("div");

  applyContrast("high", root);
  expect(root.getAttribute("data-contrast")).toBe("high");

  // 普通档是**移除属性**，不是写 "normal"——留残属性会让「当前档位」多出一种表示法。
  applyContrast("normal", root);
  expect(root.hasAttribute("data-contrast")).toBe(false);
});

test("显式切换会落盘、写根属性，并通知订阅者", () => {
  resetContrastForTest();
  localStorage.removeItem(CONTRAST_KEY);
  const seen: string[] = [];
  const unsubscribe = subscribeContrast(() => seen.push(getContrast()));

  setContrast("high");

  expect(getContrast()).toBe("high");
  expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
  expect(localStorage.getItem(CONTRAST_KEY)).toBe("high");
  expect(seen).toEqual(["high"]);

  unsubscribe();
});

test("同值不重复通知，但『点过普通』这件事仍然要落盘", () => {
  resetContrastForTest();
  localStorage.removeItem(CONTRAST_KEY);
  let calls = 0;
  const unsubscribe = subscribeContrast(() => (calls += 1));

  setContrast("normal");

  // 没有重渲染（值没变），但显式选择必须写下去：否则在系统 more 的机器上
  // 点「普通」会退化成「继续跟随系统」。
  expect(calls).toBe(0);
  expect(localStorage.getItem(CONTRAST_KEY)).toBe("normal");
  unsubscribe();
});

test("存储抛异常时不抛错，本次会话照样生效", () => {
  resetContrastForTest();
  const realSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {
    throw new Error("quota exceeded");
  };
  try {
    expect(() => setContrast("high")).not.toThrow();
    expect(getContrast()).toBe("high");
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
  } finally {
    Storage.prototype.setItem = realSetItem;
  }
});

/**
 * 跟随系统的生命周期（规格 §5.3 的三条）：只在「没有显式选择」时跟随。
 * 这里把 window.matchMedia 换成可手动翻转的替身，拿到 initContrast 注册的
 * change 回调，再模拟系统偏好变化。
 */
test("系统偏好只在没有显式选择时跟随，选过之后就不再被系统改动", () => {
  const original = window.matchMedia;
  const listeners: Array<() => void> = [];
  const media = {
    matches: true,
    addEventListener: (_type: string, callback: () => void) => {
      listeners.push(callback);
    }
  };
  window.matchMedia = ((query: string) =>
    query === "(prefers-contrast: more)"
      ? media
      : { matches: false, addEventListener: () => undefined }) as unknown as typeof window.matchMedia;

  try {
    // ① 无存储 + 系统 more → 首屏即高对比度。
    resetContrastForTest();
    localStorage.removeItem(CONTRAST_KEY);
    expect(initContrast()).toBe("high");
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");

    // ② 系统从 more 变成 no-preference → 回普通档（属性被删掉）。
    media.matches = false;
    listeners.forEach((callback) => callback());
    expect(getContrast()).toBe("normal");
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);

    // ③ 用户点过「普通」之后，系统再切回 more → 不动。
    media.matches = true;
    setContrast("normal");
    listeners.forEach((callback) => callback());
    expect(getContrast()).toBe("normal");
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
  } finally {
    window.matchMedia = original;
  }
});

/**
 * 首帧不闪（规格 §5.4）：index.html 的第三段预绘制脚本要在模块脚本之前把
 * data-contrast 落地。与 fontScale.test.ts 同款 JSDOM 形状，这里直接读磁盘上的
 * 源文件——测的是「浏览器最先执行的那几行」，不是模块里的 store。
 */
const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

function runIndexScriptsWithStoredContrast(stored: string) {
  return new JSDOM(indexHtml, {
    runScripts: "dangerously",
    url: "http://localhost/",
    beforeParse(window) {
      window.localStorage.setItem(CONTRAST_KEY, stored);
    }
  });
}

test("index.html 在模块脚本之前把持久化的高对比度档预写到根元素", () => {
  const dom = runIndexScriptsWithStoredContrast("high");

  expect(dom.window.document.documentElement.getAttribute("data-contrast")).toBe("high");
});

test("index.html 对未知对比度档位不写属性，停在普通档", () => {
  const dom = runIndexScriptsWithStoredContrast("weird");

  expect(dom.window.document.documentElement.hasAttribute("data-contrast")).toBe(false);
});
