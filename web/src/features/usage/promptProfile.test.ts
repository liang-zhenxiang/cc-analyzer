import { describe, expect, it } from "vitest";
import { promptProfileOf } from "./promptProfile";

/* ── I5 提问画像：长度桶 / 代码块 / 中文占比 / 中位数 ──────────── */

function msg(text: string): { text: string } {
  return { text };
}

describe("promptProfileOf（I5 提问画像）", () => {
  it("五桶边界：49→<50，50→50–200，200→200–500，500→500–2000，2000→≥2000（左闭右开）", () => {
    const profile = promptProfileOf([
      msg("a".repeat(49)),
      msg("b".repeat(50)),
      msg("c".repeat(200)),
      msg("d".repeat(500)),
      msg("e".repeat(2000))
    ]);

    expect(profile).not.toBeNull();
    expect(profile!.lengthBuckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 1]);
    expect(profile!.lengthBuckets.map((bucket) => bucket.label)).toEqual([
      "<50",
      "50–200",
      "200–500",
      "500–2000",
      "≥2000"
    ]);
  });

  it("codeBlockShare = 含 ``` 的消息占比", () => {
    const profile = promptProfileOf([
      msg("普通问题"),
      msg("带代码：\n```js\nconst a = 1;\n```"),
      msg("再一个普通的")
    ]);

    expect(profile!.codeBlockShare).toBeCloseTo(1 / 3, 12);
  });

  it("cjkShare：分母只算汉字+字母；中英混合、全英文 0、全中文 1、全标点 null", () => {
    const mixed = promptProfileOf([msg("这件事 done 了 hello")]);
    // 汉字 4（这件事了）+ 字母 donehello=9 → 4/13。
    expect(mixed!.cjkShare).toBeCloseTo(4 / 13, 12);

    const english = promptProfileOf([msg("all english words")]);
    expect(english!.cjkShare).toBe(0);

    const chinese = promptProfileOf([msg("全是中文汉字")]);
    expect(chinese!.cjkShare).toBe(1);

    // 数字标点空白不进分母：分母 0 → null（不是 0——「不知道」≠「没有」）。
    const punctuation = promptProfileOf([msg("12345 !!! ...")]);
    expect(punctuation!.cjkShare).toBeNull();
  });

  it("cjkShare 剔除代码围栏：代码里的英文不冲淡中文占比", () => {
    const withCode = promptProfileOf([
      msg("帮我看看\n```ts\nconst extremelyLongEnglishIdentifier = 42;\n```\n谢谢")
    ]);
    // 围栏剔除后剩「帮我看看」+「谢谢」= 6 汉字、0 字母 → 1。
    expect(withCode!.cjkShare).toBe(1);
    // 代码围栏本身仍计入 codeBlockShare（消息含 ```）。
    expect(withCode!.codeBlockShare).toBe(1);
  });

  it("medianLength：奇数取中值，偶数取均值；码位计数 emoji 不劈", () => {
    const odd = promptProfileOf([msg("a".repeat(10)), msg("b".repeat(30)), msg("c".repeat(100))]);
    expect(odd!.medianLength).toBe(30);

    const even = promptProfileOf([msg("a".repeat(10)), msg("b".repeat(30))]);
    expect(even!.medianLength).toBe(20);

    // 码位长度：😀（2 个 UTF-16 单元）计 1。
    const emoji = promptProfileOf([msg("😀😀😀")]);
    expect(emoji!.medianLength).toBe(3);
  });

  it("空数组 → null（「没有用户消息」由界面表达）", () => {
    expect(promptProfileOf([])).toBeNull();
  });
});
