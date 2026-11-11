import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  ACCENT_PRESETS,
  ACCENT_STORAGE_KEY,
  applyAccent,
  initAccent,
  readAccent,
  setAccent,
  type AccentId
} from "./accent";

afterEach(() => {
  document.documentElement.removeAttribute("data-accent");
  vi.restoreAllMocks();
  localStorage.clear();
});

// 色板住在 tokens.css 而不是 TS 里（CSS 是唯一能生效的地方）。测试直接读磁盘：
// 复制一份十六进制到测试里，只能证明「复制的那份」达标，证明不了应用会用它。
const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

function blockAt(selector: RegExp): string {
  const match = selector.exec(css);
  expect(match, `tokens.css 里找不到行首的 ${selector}`).not.toBeNull();
  const start = (match as RegExpExecArray).index;
  const end = css.indexOf("\n}", start);
  return css.slice(start, end === -1 ? undefined : end);
}

function tokenValue(source: string, name: string): string {
  const value = source.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  expect(value, `色块里缺 --${name}`).toBeTruthy();
  return value as string;
}

function luminance(hex: string): number {
  const channel = (value: number) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const [r, g, b] = [1, 3, 5].map((index) =>
    channel(Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function alphaOf(rgba: string): number {
  const alpha = Number(rgba.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1]);
  expect(Number.isFinite(alpha), `${rgba} 不是带透明度的 rgba()`).toBe(true);
  return alpha;
}

test("预设正好六套、id 唯一且顺序稳定（默认蓝在最前）", () => {
  expect(ACCENT_PRESETS).toHaveLength(6);
  const ids = ACCENT_PRESETS.map((preset) => preset.id);
  expect(new Set(ids).size).toBe(6);
  expect(ids).toEqual(["blue", "teal", "violet", "amber", "rose", "green"]);
  expect(ACCENT_STORAGE_KEY).toBe("cca-accent");
  // 色块填充必须是可直接内联的十六进制——主题色由 tokens.css 管，不走这里。
  for (const preset of ACCENT_PRESETS) {
    expect(preset.swatch, `${preset.id} 的 swatch 不是 #rrggbb`).toMatch(/^#[0-9a-f]{6}$/);
    expect(preset.label.length).toBeGreaterThan(0);
  }
});

test("readAccent：未设置、非法值、storage 抛异常一律回品牌蓝", () => {
  localStorage.removeItem(ACCENT_STORAGE_KEY);
  expect(readAccent()).toBe("blue");

  localStorage.setItem(ACCENT_STORAGE_KEY, "weird");
  expect(readAccent()).toBe("blue");

  localStorage.setItem(ACCENT_STORAGE_KEY, "");
  expect(readAccent()).toBe("blue");

  localStorage.setItem(ACCENT_STORAGE_KEY, "violet");
  expect(readAccent()).toBe("violet");

  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage disabled");
  });
  expect(readAccent()).toBe("blue");
});

test("applyAccent 只写 data-accent；默认蓝移除属性而不是写 'blue'", () => {
  applyAccent("teal");
  expect(document.documentElement.getAttribute("data-accent")).toBe("teal");

  applyAccent("blue");
  expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
});

test("setAccent 落盘并立即应用；选蓝时属性被移除", () => {
  setAccent("amber");
  expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("amber");
  expect(document.documentElement.getAttribute("data-accent")).toBe("amber");

  setAccent("blue");
  expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("blue");
  expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
});

test("存储写不进去时仍然应用：这次会话的换色不能因为持久化失败而失效", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota exceeded");
  });

  expect(() => setAccent("rose")).not.toThrow();
  expect(document.documentElement.getAttribute("data-accent")).toBe("rose");
});

test("initAccent 从存储恢复，非法值回蓝并清掉属性", () => {
  localStorage.setItem(ACCENT_STORAGE_KEY, "green");
  expect(initAccent()).toBe("green");
  expect(document.documentElement.getAttribute("data-accent")).toBe("green");

  // 外部写入的坏值不能把界面带到第三个状态。
  localStorage.setItem(ACCENT_STORAGE_KEY, "chartreuse");
  expect(initAccent()).toBe("blue");
  expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
});

/**
 * 对比度红线（规格：accent ≥4.5、hover ≥3，背景取该主题真正的 `--bg`）。
 * 默认蓝不写覆盖块，它由 `:root` / `[data-theme="dark"]` 承担，这里只验
 * 五套个性化色板——但要求是同一个：颜色再好看，读不出来就是坏颜色。
 */
test("五套个性化色板在各自主题的 --bg 上都过 4.5:1，hover 过 3:1", () => {
  const lightBg = tokenValue(blockAt(/^:root \{$/m), "bg");
  const darkBg = tokenValue(blockAt(/^\[data-theme="dark"\] \{$/m), "bg");

  const lightBlock = (id: AccentId) => blockAt(new RegExp(`^\\[data-accent="${id}"\\] \\{$`, "m"));
  const darkBlock = (id: AccentId) =>
    blockAt(new RegExp(`^\\[data-theme="dark"\\]\\[data-accent="${id}"\\] \\{$`, "m"));

  for (const preset of ACCENT_PRESETS) {
    if (preset.id === "blue") continue;

    const light = lightBlock(preset.id);
    const dark = darkBlock(preset.id);

    expect(
      contrast(tokenValue(light, "accent"), lightBg),
      `${preset.id} 浅色 accent 对比度不足`
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(tokenValue(dark, "accent"), darkBg),
      `${preset.id} 深色 accent 对比度不足`
    ).toBeGreaterThanOrEqual(4.5);

    expect(
      contrast(tokenValue(light, "accent-hover"), lightBg),
      `${preset.id} 浅色 hover 对比度不足`
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrast(tokenValue(dark, "accent-hover"), darkBg),
      `${preset.id} 深色 hover 对比度不足`
    ).toBeGreaterThanOrEqual(3);

    // -soft / ring 的浓度是设计契约：太淡等于没有背景台阶，太浓会盖过文字。
    expect(alphaOf(tokenValue(light, "accent-soft")), `${preset.id} 浅色 soft 浓度越界`).toBeGreaterThanOrEqual(0.1);
    expect(alphaOf(tokenValue(light, "accent-soft")), `${preset.id} 浅色 soft 浓度越界`).toBeLessThanOrEqual(0.16);
    expect(alphaOf(tokenValue(dark, "accent-soft")), `${preset.id} 深色 soft 浓度越界`).toBeGreaterThanOrEqual(0.16);
    expect(alphaOf(tokenValue(dark, "accent-soft")), `${preset.id} 深色 soft 浓度越界`).toBeLessThanOrEqual(0.24);

    for (const [label, ring] of [
      ["浅色", tokenValue(light, "ring")],
      ["深色", tokenValue(dark, "ring")]
    ] as const) {
      expect(alphaOf(ring), `${preset.id} ${label} ring 浓度越界`).toBeGreaterThanOrEqual(0.45);
      expect(alphaOf(ring), `${preset.id} ${label} ring 浓度越界`).toBeLessThanOrEqual(0.6);
    }
  }
});

/**
 * 高对比度优先（规格 §「高对比度档永远用默认最高对比色」）：覆盖段必须写在
 * 两块 `[data-contrast="high"]` 之前。同特异性下后写的胜出，靠源码顺序而不是
 * `:not(...)` 去维护第二条真相——顺序错误时这条断言先红，而不是等真机截图。
 */
test("个性化覆盖段写在高对比度之前，高对比度档不会被个性化色板顶掉", () => {
  const firstAccent = css.indexOf('[data-accent="teal"] {');
  const lightHigh = css.indexOf('[data-contrast="high"] {');
  const darkHigh = css.indexOf('[data-theme="dark"][data-contrast="high"] {');
  expect(firstAccent).toBeGreaterThanOrEqual(0);
  expect(firstAccent).toBeLessThan(lightHigh);
  expect(lightHigh).toBeLessThan(darkHigh);
});
