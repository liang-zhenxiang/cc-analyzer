import {
  DEFAULT_FONT_SCALE,
  applyFontScale,
  formatFontScale,
  getFontScale,
  loadFontScale,
  parseFontScale,
  resetFontScaleForTest,
  setFontScale,
  subscribeFontScale
} from "./fontScale";
import { JSDOM } from "jsdom";
import indexSource from "../../../index.html?raw";

test("档位是白名单：未知值与坏数据一律回落 100%", () => {
  expect(parseFontScale("0.9")).toBe(0.9);
  expect(parseFontScale(1.3)).toBe(1.3);
  expect(parseFontScale("130%")).toBe(1);       // 不是我们写出去的格式
  expect(parseFontScale("1.05")).toBe(1);       // 不在档位里
  expect(parseFontScale("")).toBe(1);
  expect(parseFontScale(null)).toBe(1);
  expect(parseFontScale("nonsense")).toBe(1);
});

test("读取持久化值，storage 不可用时回落默认", () => {
  const store = { getItem: (key: string) => (key === "cca-font-scale" ? "1.2" : null) };
  expect(loadFontScale(store)).toBe(1.2);
  expect(
    loadFontScale({
      getItem: () => {
        throw new Error("storage disabled");
      }
    })
  ).toBe(DEFAULT_FONT_SCALE);
});

test("缩放的唯一出口是根元素的 --font-scale", () => {
  const setProperty = vi.fn();
  // 只用到 Pick<style> 的最小面：用轻量替身，避免引入真实 DOM。
  applyFontScale(1.3, { style: { setProperty } } as unknown as Pick<HTMLElement, "style">);
  expect(setProperty).toHaveBeenCalledWith("--font-scale", "1.3");
});

test("切换档位会落盘、写根变量，并通知订阅者", () => {
  resetFontScaleForTest();
  // jsdom 的 localStorage 是代理对象，拦 setItem 不生效——直接读回更诚实。
  localStorage.removeItem("cca-font-scale");
  const seen: number[] = [];
  const unsubscribe = subscribeFontScale(() => seen.push(getFontScale()));

  // 直接调用会写 document.documentElement；这里用同一条路径断言行为，再清掉。
  setFontScale(1.3);
  expect(getFontScale()).toBe(1.3);
  expect(localStorage.getItem("cca-font-scale")).toBe("1.3");
  expect(seen).toContain(1.3);
  expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.3");

  setFontScale(1);          // 回到默认，避免影响其它用例
  unsubscribe();
  expect(formatFontScale(1.3)).toBe("130%");
});

test("相同档位不重复通知（避免无谓重渲染）", () => {
  resetFontScaleForTest();
  let calls = 0;
  const unsubscribe = subscribeFontScale(() => (calls += 1));
  setFontScale(1);
  expect(calls).toBe(0);
  unsubscribe();
});

test("index.html 在模块脚本之前把持久化档位预写进 --font-scale", () => {
  const dom = new JSDOM(indexSource, {
    runScripts: "dangerously",
    url: "http://localhost/",
    beforeParse(window) {
      window.localStorage.setItem("cca-font-scale", "1.3");
    }
  });

  expect(
    dom.window.document.documentElement.style.getPropertyValue("--font-scale")
  ).toBe("1.3");
});

test("index.html 对未知档位回落 1，避免按坏值画第一帧", () => {
  const dom = new JSDOM(indexSource, {
    runScripts: "dangerously",
    url: "http://localhost/",
    beforeParse(window) {
      window.localStorage.setItem("cca-font-scale", "115");
    }
  });

  expect(
    dom.window.document.documentElement.style.getPropertyValue("--font-scale")
  ).toBe("1");
});
