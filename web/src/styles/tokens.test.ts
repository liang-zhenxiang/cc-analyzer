import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 终端调色板的两块值必须在两个主题里都齐全。
 *
 * `lib/ansi.ts` 给基本色发的是 `var(--ansi-N)`，缺一档不会报错——只会让那段文字
 * 用回继承色，看起来像「这段输出没有颜色」，而它其实是有颜色的。这类缺口在源码
 * 里看不出来（值写在另一个文件），所以用一条断言把它钉住。
 */
// 注释先剥掉：`--ansi-N: #xxxxxx` 这种形状也可能出现在注释里（「旧值是 …」），
// 只做子串匹配的话，把真声明删掉、注释留着，测试仍然会通过。
const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "tokens.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `tokens.css 里找不到 ${selector}`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end === -1 ? undefined : end);
}

test("定义了两个主题各自的 16 档终端基本色", () => {
  const light = block(":root {");
  const dark = block('[data-theme="dark"] {');
  for (let index = 0; index < 16; index += 1) {
    expect(light, `浅色缺 --ansi-${index}`).toContain(`--ansi-${index}: #`);
    expect(dark, `深色缺 --ansi-${index}`).toContain(`--ansi-${index}: #`);
  }
});

test("两套终端基本色互不相同——深色档不是浅色档的复制品", () => {
  const light = block(":root {");
  const dark = block('[data-theme="dark"] {');
  const value = (source: string, index: number) =>
    source.match(new RegExp(`--ansi-${index}: (#[0-9a-f]{6})`))?.[1];
  for (let index = 0; index < 16; index += 1) {
    expect(value(light, index)).not.toBe(value(dark, index));
  }
});

/**
 * 终端颜色是**任意文本**的颜色，所以它比图表色更受对比度约束：一段红字如果
 * 在面板底色上读不出来，用户只会以为「这段输出没渲染」。
 * 底色取 `--bg-elevated` 两个主题的值（浅 #ffffff / 深 #1a1d21）——报告与详情
 * 面板里的终端输出就落在这一层上。
 */
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

test("16 档终端基本色在各自主题的面板底色上都达到正文对比度", () => {
  const light = block(":root {");
  const dark = block('[data-theme="dark"] {');
  // 底色不写死：它就是终端输出所在那一层的实际底色（--bg-elevated）。
  const backgroundOf = (source: string) => source.match(/--bg-elevated: (#[0-9a-f]{6})/)?.[1];
  const cases: Array<[string, string]> = [
    [light, backgroundOf(light) as string],
    [dark, backgroundOf(dark) as string]
  ];
  for (const [source, background] of cases) {
    expect(background).toBeTruthy();
    for (let index = 0; index < 16; index += 1) {
      const value = source.match(new RegExp(`--ansi-${index}: (#[0-9a-f]{6})`))?.[1];
      expect(value, `缺 --ansi-${index}`).toBeTruthy();
      expect(contrast(value as string, background)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

/**
 * 界面字号缩放全靠 `:root` 上的 `--font-scale` 写进 `calc()` 里。默认值必须
 * 落在 CSS 里（脚本没跑、单测环境、错误边界下 `calc()` 仍要能解析），
 * 而且**字号与行高必须成对**乘同一个系数——只缩字号会让行盒装不下降部。
 */
test(":root 定义了界面字号的默认缩放系数", () => {
  const root = block(":root {");
  expect(root).toMatch(/--font-scale:\s*1\s*;/);
});

test("五级字号与行高都乘同一个 --font-scale", () => {
  const root = block(":root {");
  const scaled = (name: string) => new RegExp(`--${name}:\\s*calc\\(\\d+px\\s*\\*\\s*var\\(--font-scale\\)\\)`);
  for (const size of ["xs", "sm", "base", "md", "lg"]) {
    expect(root, `--fs-${size} 未跟随 --font-scale`).toMatch(scaled(`fs-${size}`));
    expect(root, `--lh-${size} 未跟随 --font-scale`).toMatch(scaled(`lh-${size}`));
  }
});

/**
 * 表头高度（`th { height: var(--row-h) }`）曾是被写死的 30px，与数据行等高靠
 * 人肉维护。改成派生式后它跟着 `--lh-sm` 走：缩放字号时表头自动长高，
 * 不会出现「表头裁字 + 与数据行不等高」。
 */
test("--row-h 是派生式而不是写死的字面量", () => {
  const root = block(":root {");
  expect(root).toMatch(/--row-h:\s*calc\(var\(--row-pad-y\)\s*\*\s*2\s*\+\s*var\(--lh-sm\)\)/);
  expect(root).not.toMatch(/--row-h:\s*30px/);
});

/**
 * 高对比度档（Issue #73 / Round U）：两块色板都住在 `tokens.css` 里。
 *
 * 取起点不能用上面的 `block()`——它用 `indexOf`，而
 * `[data-theme="dark"][data-contrast="high"] {` 的**尾部**正是
 * `[data-contrast="high"] {`，先命中深色块会让两块守卫都验到同一段文本。
 * 这里改按行首锚定取起点，浅色块必须写在深色块之前。
 */
function blockAt(selector: RegExp): string {
  const match = selector.exec(css);
  expect(match, `tokens.css 里找不到行首的 ${selector}`).not.toBeNull();
  const start = (match as RegExpExecArray).index;
  const end = css.indexOf("\n}", start);
  return css.slice(start, end === -1 ? undefined : end);
}

/** 懒取：块不存在时让断言落在具体用例里，而不是整个文件在收集阶段就炸。 */
function highContrastBlocks(): Array<[string, string]> {
  return [
    ["浅色高对比度", blockAt(/^\[data-contrast="high"\] \{$/m)],
    ["深色高对比度", blockAt(/^\[data-theme="dark"\]\[data-contrast="high"\] \{$/m)]
  ];
}

function tokenNames(source: string): string[] {
  return [...source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]);
}

/** 名字像颜色的令牌（`--shadow-*` / `--overlay` 是层级语言，不在其列）。 */
const COLOR_TOKEN_SHAPE =
  /^--(text|bg|border|accent|ring|ink|on-ink|success|warning|danger|cat-|chart-|cal-)/;

const CATEGORY_TOKENS = ["wait", "direct", "delegated", "compute", "user", "workflow"].map(
  (name) => `--cat-${name}`
);

const REQUIRED_HIGH_CONTRAST_TOKENS = [
  "--text",
  "--text-secondary",
  "--text-tertiary",
  "--text-faint",
  "--bg",
  "--bg-subtle",
  "--bg-elevated",
  "--bg-inset",
  "--bg-hover",
  "--bg-active",
  "--border",
  "--border-strong",
  "--ink",
  "--on-ink",
  "--accent",
  "--accent-hover",
  "--accent-soft",
  "--ring",
  "--success",
  "--success-soft",
  "--warning",
  "--warning-soft",
  "--danger",
  "--danger-soft",
  ...CATEGORY_TOKENS,
  ...[1, 2, 3, 4, 5, 6].flatMap((index) => [`--chart-${index}`, `--chart-${index}-soft`]),
  ...[1, 2, 3, 4].map((index) => `--cal-${index}`),
  "--focus-ring-width",
  "--focus-ring-offset",
  "--focus-ring-inset"
];

test("高对比度的两块色板都在，且覆盖同一批令牌（漏一个主题就红）", () => {
  // 浅色块必须写在深色块之前，否则 blockAt 的起点会取错。
  expect(css.indexOf('[data-contrast="high"] {')).toBeLessThan(
    css.indexOf('[data-theme="dark"][data-contrast="high"] {')
  );
  expect(tokenNames(highContrastBlocks()[0][1]).sort()).toEqual(
    tokenNames(highContrastBlocks()[1][1]).sort()
  );
});

test("两块高对比度色板都覆盖语义色与类别色两套", () => {
  for (const [label, source] of highContrastBlocks()) {
    const names = tokenNames(source);
    for (const name of REQUIRED_HIGH_CONTRAST_TOKENS) {
      expect(names, `${label}块缺 ${name}`).toContain(name);
    }
    // 两套资产各有若干条：类别色 6 条、图表色板 12 条（实色 + 面积底），
    // 加消耗日历色带 4 条（Round V）。
    expect(names.filter((name) => name.startsWith("--cat-"))).toHaveLength(6);
    expect(names.filter((name) => name.startsWith("--chart-") && !name.endsWith("-soft"))).toHaveLength(6);
    expect(names.filter((name) => name.startsWith("--chart-") && name.endsWith("-soft"))).toHaveLength(6);
    expect(names.filter((name) => name.startsWith("--cal-"))).toHaveLength(4);
    expect(names).toHaveLength(49);
  }
});

test("高对比度只换颜色与焦点环几何——尺寸类令牌一律不得出现", () => {
  const sizeLike =
    /^--(fs-|lh-|sp-|r-|row-|col-|control-|topbar-|sidebar-|detail-|gauge-|scrollbar-|dur-|ease-|font-)/;
  const allowedNonColor = new Set([
    "--focus-ring-width",
    "--focus-ring-offset",
    "--focus-ring-inset"
  ]);
  for (const [label, source] of highContrastBlocks()) {
    for (const name of tokenNames(source)) {
      expect(sizeLike.test(name), `${label}块把尺寸类令牌 ${name} 也塞进来了`).toBe(false);
      expect(
        COLOR_TOKEN_SHAPE.test(name) || allowedNonColor.has(name),
        `${label}块里的 ${name} 既不是颜色也不是焦点环几何`
      ).toBe(true);
    }
  }
});

test("高对比度块里的颜色令牌都是 6 位十六进制", () => {
  for (const [label, source] of highContrastBlocks()) {
    for (const [, name, value] of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      if (!COLOR_TOKEN_SHAPE.test(name)) continue;
      expect(value.trim(), `${label}块里 ${name} 不是 #rrggbb`).toMatch(/^#[0-9a-f]{6}$/);
    }
  }
});

test(":root 定义了焦点环几何；两块高对比度各把它加粗并让环离开控件", () => {
  const root = block(":root {");
  expect(root).toMatch(/--focus-ring-width:\s*2px\s*;/);
  expect(root).toMatch(/--focus-ring-offset:\s*1px\s*;/);
  expect(root).toMatch(/--focus-ring-inset:\s*-2px\s*;/);
  for (const [label, source] of highContrastBlocks()) {
    expect(source, `${label}的 --focus-ring-width 没加粗`).toMatch(/--focus-ring-width:\s*3px\s*;/);
    expect(source, `${label}的 --focus-ring-offset 没跟着宽度一起加`).toMatch(
      /--focus-ring-offset:\s*2px\s*;/
    );
    expect(source, `${label}的 --focus-ring-inset 没跟着宽度一起加`).toMatch(
      /--focus-ring-inset:\s*-4px\s*;/
    );
  }
});

/** 从色块里取一个 6 位十六进制；取不到就报出是哪一条，别让 NaN 悄悄通过。 */
function hexIn(source: string, token: string): string {
  const name = token.replace(/^--/, "");
  const hex = source.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1];
  expect(hex, `高对比度块里 --${name} 不是 #rrggbb，算术守卫无法求值`).toBeTruthy();
  return hex as string;
}

/**
 * 高对比度不是「看着更深」：正文文字 ≥7:1、次要文字 ≥4.5:1、边框与图形 ≥3:1
 * 都要真算。取不到十六进制时上面的 `hexIn` 会先红。
 */
test("高对比度色板实测达标：正文 7 / 次要 4.5 / 边框与图形 3", () => {
  for (const [label, source] of highContrastBlocks()) {
    const background = hexIn(source, "bg");
    const elevated = hexIn(source, "bg-elevated");
    expect(contrast(hexIn(source, "text"), background), `${label}正文对比度不足`).toBeGreaterThanOrEqual(7);
    expect(
      contrast(hexIn(source, "text-secondary"), background),
      `${label}次要文字对比度不足`
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(hexIn(source, "text-tertiary"), elevated),
      `${label}三级文字在面板底上对比度不足`
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hexIn(source, "border"), background), `${label}边框对比度不足`).toBeGreaterThanOrEqual(3);
    expect(
      contrast(hexIn(source, "border-strong"), background),
      `${label}深边框对比度不足`
    ).toBeGreaterThanOrEqual(3);
    expect(contrast(hexIn(source, "ring"), background), `${label}焦点环对比度不足`).toBeGreaterThanOrEqual(3);
    for (const name of CATEGORY_TOKENS) {
      expect(contrast(hexIn(source, name), elevated), `${label}${name} 对比度不足`).toBeGreaterThanOrEqual(3);
    }
    for (let index = 1; index <= 6; index += 1) {
      expect(
        contrast(hexIn(source, `chart-${index}`), elevated),
        `${label}--chart-${index} 对比度不足`
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

/**
 * 终端调色板与代码高亮本轮不覆盖（那是「别人的颜色」），但换底之后不能变差。
 * 这条把深色高对比度 `--bg-elevated` 的上限钉住：谁把它调亮到 #1f1f1f，
 * `--ansi-0` 会掉到 4.39 而先红。
 */
test("换到高对比度的面板底色后，终端 16 色仍然达标", () => {
  const cases: Array<[string, string, string]> = [
    ["浅色高对比度", block(":root {"), hexIn(highContrastBlocks()[0][1], "bg-elevated")],
    ["深色高对比度", block('[data-theme="dark"] {'), hexIn(highContrastBlocks()[1][1], "bg-elevated")]
  ];
  for (const [label, ansiSource, background] of cases) {
    for (let index = 0; index < 16; index += 1) {
      const hex = ansiSource.match(new RegExp(`--ansi-${index}: (#[0-9a-f]{6})`))?.[1];
      expect(hex, `${label}缺 --ansi-${index}`).toBeTruthy();
      expect(
        contrast(hex as string, background),
        `${label}下 --ansi-${index} 在面板底上不达标`
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

/**
 * 消耗日历色带（Issue #187 / Round V）：`--cal-1..--cal-4` 在四块主题里各一组。
 * 色带格子是面积填充，不适用 3:1（同 `-soft` 豁免）；「色即消耗」的前提押在
 * 两条日历自设门槛上，必须真算：
 * - 相邻档分得开（普通 ≥1.3 / 高对比度 ≥1.7）——档位是色带的全部信息；
 * - 最浅非空档 cal-1 与空格 `--bg-inset` 分得开（普通 ≥1.2 / HC ≥1.3）——
 *   「这格有没有数据」的唯一编码，塌了就等于丢数据。
 * HC 的 `--border` vs `--bg-subtle` ≥3 已由「高对比度色板实测达标」那条
 * 顺带覆盖（--cal 描边用的就是 --border），这里不重复。
 */
test("消耗日历色带四块齐全，值都是 6 位十六进制", () => {
  const blocks: Array<[string, string]> = [
    ["普通浅", block(":root {")],
    ["普通深", block('[data-theme="dark"] {')],
    ...highContrastBlocks()
  ];
  for (const [label, source] of blocks) {
    for (let index = 1; index <= 4; index += 1) {
      expect(hexIn(source, `cal-${index}`), `${label}块里 --cal-${index} 不是 #rrggbb`).toBeTruthy();
    }
  }
});

test("日历色带对比度实测：相邻档与空格区分度达标", () => {
  const cases = [
    { label: "普通浅", source: block(":root {"), adjacent: 1.3, inset: 1.2 },
    { label: "普通深", source: block('[data-theme="dark"] {'), adjacent: 1.3, inset: 1.2 },
    ...highContrastBlocks().map(([label, source]) => ({ label, source, adjacent: 1.7, inset: 1.3 }))
  ];
  for (const { label, source, adjacent, inset } of cases) {
    const cal = (index: number) => hexIn(source, `cal-${index}`);
    const emptyCell = hexIn(source, "bg-inset");
    for (let index = 1; index <= 3; index += 1) {
      expect(
        contrast(cal(index), cal(index + 1)),
        `${label}相邻档 cal-${index}→cal-${index + 1} 分不开`
      ).toBeGreaterThanOrEqual(adjacent);
    }
    expect(contrast(cal(1), emptyCell), `${label}最浅档 cal-1 与空格分不开`).toBeGreaterThanOrEqual(inset);
  }
});
