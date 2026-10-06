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
