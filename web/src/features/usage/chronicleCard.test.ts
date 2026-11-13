import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chronicle, ChronicleChapter } from "./chronicle";
import type { PosterItem, PosterPalette } from "./posterCanvas";
import {
  CHRONICLE_CARD_WIDTH,
  chronicleCardFileName,
  chronicleCardLayout,
  chronicleCardSvg,
  drawChronicleCard,
  textWidth
} from "./chronicleCard";

/**
 * 夹具手造，期望值按契约手算：长图的高度、章内坐标都是写死的版式常量，
 * 测试只验证「版式没有悄悄变」与「文字不出框」，不把实现算出来的值当期望。
 */

const PALETTE: PosterPalette = {
  bg: "#111111",
  text: "#eeeeee",
  muted: "#999999",
  accent: "#cc9966",
  border: "#333333"
};

function makeChapter(index: number, overrides: Partial<ChronicleChapter> = {}): ChronicleChapter {
  return {
    id: `chapter-${index}`,
    index,
    kicker: `第 ${index} 章 · 测试章节`,
    title: `章节 ${index} 的标题`,
    stat: "302,500",
    statUnit: "token",
    body: `第 ${index} 章的一句正文，带着 12 个数字。`,
    ...overrides
  };
}

function makeChronicle(count: number, overrides: Partial<Chronicle> = {}): Chronicle {
  return {
    chapters: Array.from({ length: count }, (_, i) => makeChapter(i + 1)),
    summary: "这 7 天，你在 3 个项目里留下了 12 个会话。",
    empty: false,
    ...overrides
  };
}

function isText(item: PosterItem): item is Extract<PosterItem, { kind: "text" }> {
  return item.kind === "text";
}

afterEach(() => {
  vi.useRealTimers();
});

describe("chronicleCardLayout", () => {
  it("宽度固定 1080，高度 = 300 + 240×章数 + 220", () => {
    for (const count of [1, 3, 7]) {
      const layout = chronicleCardLayout(makeChronicle(count), 7, PALETTE);
      expect(layout.width).toBe(CHRONICLE_CARD_WIDTH);
      expect(layout.width).toBe(1080);
      expect(layout.height).toBe(300 + 240 * count + 220);
    }
  });

  it("每章都包含 kicker、标题、大数字、单位、正文与发丝线", () => {
    const chronicle = makeChronicle(3);
    const { items } = chronicleCardLayout(chronicle, 7, PALETTE);

    chronicle.chapters.forEach((chapter, index) => {
      const top = 300 + index * 240;
      const band = items.filter((item) => item.y >= top && item.y < top + 240);
      const texts = band.filter(isText);

      expect(texts.some((item) => item.text === chapter.kicker && item.size === 24)).toBe(true);
      expect(texts.some((item) => item.text === chapter.title && item.size === 38)).toBe(true);
      expect(texts.some((item) => item.text === chapter.stat && item.size === 96)).toBe(true);
      expect(texts.some((item) => item.text === chapter.statUnit && item.size === 30)).toBe(true);
      expect(texts.some((item) => item.size === 28 && item.text === chapter.body)).toBe(true);
      expect(
        band.some(
          (item) =>
            item.kind === "rect" && item.y === top + 239 && item.w === 888 && item.h === 1
        )
      ).toBe(true);
    });
  });

  it("大数字与单位同一基线，单位在数字右缘之外", () => {
    const chronicle = makeChronicle(1);
    const { items } = chronicleCardLayout(chronicle, 7, PALETTE);
    const texts = items.filter(isText);
    const stat = texts.find((item) => item.text === "302,500");
    const unit = texts.find((item) => item.text === "token");

    expect(stat).toBeDefined();
    expect(unit).toBeDefined();
    if (!stat || !unit) return;
    expect(unit.y).toBe(stat.y);
    // 96px 的 "302,500" 估宽 7×0.6×96 = 403.2，单位 x = 96 + 403.2 + 16。
    expect(unit.x).toBeCloseTo(96 + 7 * 0.6 * 96 + 16, 5);
    expect(unit.x).toBeGreaterThan(stat.x);
  });

  it("能放下的正文只有一行且不加省略号", () => {
    const { items } = chronicleCardLayout(makeChronicle(1), 7, PALETTE);
    const bodyLines = items.filter(
      (item): item is Extract<PosterItem, { kind: "text" }> =>
        isText(item) && item.size === 28 && item.y >= 300 && item.y < 540
    );

    expect(bodyLines).toHaveLength(1);
    expect(bodyLines[0].text.endsWith("…")).toBe(false);
  });

  it("超长正文折成两行，每行不出 900px，最后以省略号收尾", () => {
    const longBody = "这是一段刻意写得很长的正文，用来验证折行与截断。".repeat(8);
    const chronicle = makeChronicle(1, {
      chapters: [makeChapter(1, { body: longBody })]
    });
    const { items } = chronicleCardLayout(chronicle, 7, PALETTE);
    const bodyLines = items.filter(
      (item): item is Extract<PosterItem, { kind: "text" }> =>
        isText(item) && item.size === 28 && item.y >= 300 && item.y < 540
    );

    expect(bodyLines).toHaveLength(2);
    for (const line of bodyLines) {
      expect(textWidth(line.text, 28)).toBeLessThanOrEqual(900);
    }
    expect(bodyLines[1].text.endsWith("…")).toBe(true);
  });

  it("断点正好落在句号上时，标点贴回上一行而不是单独成行", () => {
    // 32 个全角字 = 896px（≤900），第 33 个「。」会溢出；没有行首禁则时
    // 它会孤零零落在第二行。
    const body = "一".repeat(32) + "。";
    const chronicle = makeChronicle(1, {
      chapters: [makeChapter(1, { body })]
    });
    const { items } = chronicleCardLayout(chronicle, 7, PALETTE);
    const bodyLines = items.filter(
      (item): item is Extract<PosterItem, { kind: "text" }> =>
        isText(item) && item.size === 28 && item.y >= 300 && item.y < 540
    );

    expect(bodyLines).toHaveLength(1);
    expect(bodyLines[0].text.endsWith("。")).toBe(true);
  });

  it("断点落在拉丁词中间时，把整个词挪到下一行", () => {
    // 31 个中文字（868px）+ 空格 + "S" 刚好写满；下一个 "o" 会溢出。
    // 期望在词首断开，而不是产出 "…Sonnet 4" / ".5…" 这种像笔误的两行。
    const body = `${"前".repeat(31)} Sonnet 4.5 尾`;
    const chronicle = makeChronicle(1, { chapters: [makeChapter(1, { body })] });
    const bodyLines = chronicleCardLayout(chronicle, 7, PALETTE).items.filter(
      (item): item is Extract<PosterItem, { kind: "text" }> =>
        isText(item) && item.size === 28 && item.y >= 300 && item.y < 540
    );

    expect(bodyLines).toHaveLength(2);
    expect(bodyLines[0].text).toBe("前".repeat(31));
    expect(bodyLines[1].text.startsWith("Sonnet")).toBe(true);
    expect(bodyLines[1].text).toContain("Sonnet 4.5");
  });

  it("头部日期范围按「今天往前推 days-1 天」写成本地日期", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 9, 30));
    const texts = chronicleCardLayout(makeChronicle(1), 7, PALETTE).items.filter(isText);
    expect(texts.map((item) => item.text)).toContain("2026-11-07 – 2026-11-13");
  });

  it("头部与结尾的固定文案齐全", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 9, 30));
    const chronicle = makeChronicle(2, { summary: "收束这一篇故事。" });
    const values = chronicleCardLayout(chronicle, 7, PALETTE)
      .items.filter(isText)
      .map((item) => item.text);

    expect(values).toContain("CC ANALYZER · 数据故事");
    expect(values).toContain("近 7 天的故事");
    expect(values).toContain("收束这一篇故事。");
    expect(values).toContain("由 CC Analyzer 本地生成 · 数据不出本机");
    expect(values).toContain("口径：所选时间范围；token 取日志里的四类用量");
  });

  it("章节按 index 排序，不跟数组顺序走", () => {
    const shuffled: Chronicle = {
      chapters: [makeChapter(2), makeChapter(1)],
      summary: "。",
      empty: false
    };
    const items = chronicleCardLayout(shuffled, 7, PALETTE).items;
    const kickers = items.filter(
      (item): item is Extract<PosterItem, { kind: "text" }> => isText(item) && item.size === 24
    );
    expect(kickers.map((item) => item.text)).toEqual([
      "第 1 章 · 测试章节",
      "第 2 章 · 测试章节"
    ]);
    expect(kickers[0].y).toBeLessThan(kickers[1].y);
  });
});

describe("chronicleCardSvg", () => {
  it("宽度 1080、高度与版式一致，并转义 XML 特殊字符", () => {
    const chronicle = makeChronicle(1, { summary: 'A & B <C> "D"' });
    const layout = chronicleCardLayout(chronicle, 7, PALETTE);
    const svg = chronicleCardSvg(layout);

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="1080"');
    expect(svg).toContain(`height="${layout.height}"`);
    expect(svg).toContain(`viewBox="0 0 1080 ${layout.height}"`);
    expect(svg).toContain("A &amp; B");
    expect(svg).toContain("&lt;C&gt;");
    expect(svg).toContain("&quot;D&quot;");
    // 转义后正文里不应再出现裸的 "<C>"。
    expect(svg).not.toContain("<C>");
  });
});

describe("drawChronicleCard", () => {
  it("每个图元都落到 canvas：rect 用 fillRect，text 用 fillText", () => {
    const layout = chronicleCardLayout(makeChronicle(2), 7, PALETTE);
    const rects: string[] = [];
    const texts: Array<{ text: string; font: string; x: number; y: number }> = [];
    // 用闭包记住当前 font，避免在对象字面量方法里依赖 `this` 的类型推断。
    const state = { font: "" };
    const ctx = {
      fillStyle: "",
      get font() {
        return state.font;
      },
      set font(value: string) {
        state.font = value;
      },
      textBaseline: "",
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push(`${x},${y},${w},${h}`);
      },
      fillText(text: string, x: number, y: number) {
        texts.push({ text, font: state.font, x, y });
      }
    } as unknown as CanvasRenderingContext2D;

    drawChronicleCard(ctx, layout);

    const expectedRects = layout.items.filter((item) => item.kind === "rect");
    const expectedTexts = layout.items.filter(isText);
    expect(rects).toHaveLength(expectedRects.length);
    expect(texts).toHaveLength(expectedTexts.length);
    expect(texts[0].font).toBe(
      "500 28px system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif"
    );
    expect(texts.map((entry) => entry.text)).toContain("近 7 天的故事");
  });
});

describe("chronicleCardFileName", () => {
  it("沿用海报的命名法：cc-analyzer-story-YYYY-MM-DD-theme.png", () => {
    expect(chronicleCardFileName(new Date(2026, 4, 31), "dark")).toBe(
      "cc-analyzer-story-2026-05-31-dark.png"
    );
    expect(chronicleCardFileName(new Date(2026, 0, 3), "light")).toBe(
      "cc-analyzer-story-2026-01-03-light.png"
    );
  });
});
