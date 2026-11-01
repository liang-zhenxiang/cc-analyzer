import { describe, expect, it } from "vitest";
import { sessionCardData } from "./sessionCard";

/** 基准时刻：2026-11-01 08:30（本地）。 */
const GENERATED_AT = new Date(2026, 10, 1, 8, 30).getTime();

const BASE = {
  title: "重构解析器",
  projectLabel: "/Users/dev/work/yu-project/cc-analyzer",
  durationMs: 754_000, // 12m34s
  tokens: { prompt: 1_234_567, output: 89_012 },
  toolCount: 5,
  modelLabel: "claude-sonnet-4-5",
  firstTimestamp: new Date(2026, 10, 1, 8, 0).getTime(),
  generatedAt: GENERATED_AT
};

describe("sessionCardData", () => {
  it("正常输入：四行统计 + footer 日期格式 YYYY-MM-DD", () => {
    const card = sessionCardData(BASE);
    expect(card.headline).toBe("重构解析器");
    expect(card.lines).toEqual([
      "项目 cc-analyzer",
      "时长 12m34s",
      "token 1.3M（输入 1.2M · 输出 89,012）",
      "工具 5 种 · 主力 claude-sonnet-4-5"
    ]);
    expect(card.footer).toBe("CC Analyzer · 生成于 2026-11-01");
  });

  it("隐私红线：项目只留最后一段，完整路径绝不出现", () => {
    const card = sessionCardData({ ...BASE, projectLabel: "/home/liang/secret/工作/私人项目" });
    expect(card.lines[0]).toBe("项目 私人项目");
    // 整卡（headline + lines + footer 拼串）不含任何路径片段。
    const whole = [card.headline, ...card.lines, card.footer].join("\n");
    expect(whole).not.toContain("/home");
    expect(whole).not.toContain("secret");
    expect(whole).not.toContain("liang");
  });

  it("超长标题：24 字截断加 …，不把消息内容带进 headline", () => {
    const long = "这是一个非常长的会话标题需要被截断处理避免撑爆卡片宽度".repeat(3);
    const card = sessionCardData({ ...BASE, title: long });
    expect(card.headline.length).toBe(25); // 24 字 + …
    expect(card.headline.endsWith("…")).toBe(true);
    // 截断保留的是前 24 字。
    expect(card.headline.startsWith(long.slice(0, 24))).toBe(true);
  });

  it("全 null / 缺数据的诚实文案：无 token 读数、模型未知、未知项目", () => {
    const card = sessionCardData({
      ...BASE,
      projectLabel: null,
      tokens: null,
      modelLabel: null,
      toolCount: 0
    });
    expect(card.lines).toEqual([
      "项目 （未知项目）",
      "时长 12m34s",
      "token 无 token 读数",
      "工具 0 种 · 主力 模型未知"
    ]);
  });

  it("footer 日期补零：单数月日也写 YYYY-MM-DD", () => {
    const card = sessionCardData({ ...BASE, generatedAt: new Date(2026, 0, 5, 9).getTime() });
    expect(card.footer).toBe("CC Analyzer · 生成于 2026-01-05");
  });

  it("恰好 24 字的标题不截断（> 才截，= 保留原样）", () => {
    const exact = "一二三四五六七八九十一二三四五六七八九十一二三四"; // 24 字
    expect(exact.length).toBe(24);
    const card = sessionCardData({ ...BASE, title: exact });
    expect(card.headline).toBe(exact);
  });
});
