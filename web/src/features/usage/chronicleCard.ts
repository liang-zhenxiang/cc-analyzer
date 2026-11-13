import { formatFullDate } from "../../lib/format";
import type { Chronicle } from "./chronicle";
import type { PosterItem, PosterPalette } from "./posterCanvas";

/**
 * 「数据故事」长图的排版：把 `Chronicle` 的章节排成一张 1080 宽的竖版图。
 *
 * 为什么复用 `PosterItem` 而不另起一套图元：预览（SVG data URL）与导出
 * （canvas → PNG）必须同源，否则两处版式会慢慢漂开——这正是 `posterCanvas`
 * 当初把「排版」与「渲染」拆开的理由，故事长图直接沿用同一份基础设施。
 *
 * 版式的三条取舍：
 * 1. 1080 宽是全图唯一的固定尺寸，高度 = 头 300 + 章 240×n + 尾 220，
 *    让长图随故事长短伸缩，而不是把 7 章硬塞进一张固定画幅（挤掉的会是正文）。
 * 2. 坐标全部写死，不跟字号缩放——这是一张图，不是界面。
 * 3. 颜色只从 `PosterPalette` 来，本文件不出现任何颜色字面量。
 */

export const CHRONICLE_CARD_WIDTH = 1080;

/** 头部固定高度：与开发者海报同一套坐标，两张图看起来是同一个产品出的。 */
const HEADER_HEIGHT = 300;
/** 每章固定高度：kicker / 标题 / 大数字 / 两行正文 / 发丝线刚好排满。 */
const CHAPTER_HEIGHT = 240;
/** 结尾固定高度：summary（最多两行）+ 两行页脚。 */
const FOOTER_HEIGHT = 220;

const MARGIN_X = 96;
/** 发丝线宽度：与海报同一列宽。 */
const RULE_WIDTH = 888;
/** 正文与 summary 的排版宽度：留出右侧呼吸位，长句在这里折行。 */
const TEXT_MAX_WIDTH = 900;

/** 正文最多两行：第三行开始就不是「一眼扫过」而是一段文章了。 */
const BODY_MAX_LINES = 2;
const BODY_SIZE = 28;
const SUMMARY_SIZE = 34;
const SUMMARY_MAX_LINES = 2;

/**
 * `posterCanvas.ts` 里的 FONT_STACK 是模块私有的；两处必须逐字一致，
 * 否则同一张图在 SVG 预览与 canvas 导出里的字宽会不同。改这里时同步那边。
 */
const FONT_STACK =
  "system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif";

export type ChronicleCardLayout = {
  width: number;
  height: number;
  items: PosterItem[];
};

/**
 * 字宽估算（单位 em，再乘字号）：中文/全角 1.0、数字与字母 0.6、空格 0.3。
 *
 * 为什么需要它：canvas 与 SVG 都没有「测量后再排版」的两段式接口，而单位
 * 要贴着大数字的右缘、正文要在 900px 处折行——只能先估。估宽只用于定位与
 * 折行，不用于截断数字：数字本身永远完整。等宽字体（`font-variant-numeric`）
 * 在 canvas 上不可用，这个系数已经按常见 sans 的经验值取整数。
 */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === " ") em += 0.3;
    // 0x2E80 以上的码点覆盖 CJK 部首、标点、假名与全角形式，按一个全角算。
    else if (code >= 0x2e80) em += 1;
    else em += 0.6;
  }
  return em * size;
}

/** 拉丁词字符：数字、字母与常见的词内标点（`4.5`、`8,214`、`cc-analyzer`）。 */
const LATIN_RUN = /^[0-9A-Za-z_.,:%/+-]$/;

function isLatin(char: string | undefined): boolean {
  return char !== undefined && LATIN_RUN.test(char);
}

/** 行尾这段拉丁词的起点（UTF-16 下标）；中文/空白处自然截断。 */
function latinTailStart(text: string): number {
  let index = text.length;
  while (index > 0 && isLatin(text[index - 1])) index -= 1;
  return index;
}

/**
 * 按估算宽度折行，最多 `maxLines` 行；放不下时最后一行以「…」收尾。
 *
 * 中文按字符断行（没有词间空格可依），但拉丁词不劈开：`Sonnet 4.5` 落成
 * `Sonnet 4` / `.5` 在分享图里像笔误，所以断点落在词中间时回退到词首，
 * 把整个词挪到下一行。词本身比一行还宽（极长的 slug）时才退化为硬切，
 * 保证任何情况下都不横向溢出画布。
 */
/** 中文排版的行首禁则标点：不能作为一行开头的字符。 */
const NO_LINE_START = "。，、；：！？）」』】…";

function wrapText(text: string, size: number, maxLines: number): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let current = "";

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    // 行首禁则：句号/逗号等标点不能出现在行首。允许它略微超出排版宽度
    // （最多一个字宽），画布右侧还有 84px 余量，不会被裁掉；否则会出现
    // 「…是日均的 1.7 倍」下一行孤零零一个「。」的排版事故。
    if (NO_LINE_START.includes(char) && current.length > 0) {
      current += char;
      continue;
    }
    if (textWidth(current + char, size) <= TEXT_MAX_WIDTH) {
      current += char;
      continue;
    }

    // 断点落在拉丁词中间时回退到词首；整词搬家比劈词好读。
    let head = current;
    let carry = char;
    if (isLatin(char) && isLatin(chars[index - 1])) {
      const start = latinTailStart(current);
      if (start > 0) {
        head = current.slice(0, start).trimEnd();
        carry = current.slice(start) + char;
      }
    }

    // 当前行是允许的最后一行：剩下的内容只能截掉，用省略号交代。
    if (lines.length === maxLines - 1) {
      lines.push(withEllipsis(head, size));
      return lines;
    }
    if (head.length > 0) lines.push(head);
    current = carry;

    // 极长的词自己就超过一行：按字符硬切，切出来的每一段仍受宽度约束。
    while (textWidth(current, size) > TEXT_MAX_WIDTH) {
      if (lines.length === maxLines - 1) {
        lines.push(withEllipsis(current, size));
        return lines;
      }
      let cut = current.length - 1;
      while (cut > 0 && textWidth(current.slice(0, cut), size) > TEXT_MAX_WIDTH) cut -= 1;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

/** 逐步回退字符直到「…」能放进同一行；宁可少一个词，也不让文字出框。 */
function withEllipsis(line: string, size: number): string {
  const ellipsis = "…";
  let value = line.trimEnd();
  while (value.length > 0 && textWidth(value + ellipsis, size) > TEXT_MAX_WIDTH) {
    value = Array.from(value).slice(0, -1).join("").trimEnd();
  }
  return value + ellipsis;
}

/**
 * 头部的日期范围。`Chronicle` 只保证「最近 days 个本地日」，不带窗口起止字段，
 * 契约里也没有 `now` 参数，所以这里读一次本地时钟向前推 days-1 天：长图讲的是
 * 「到今天为止的 N 天」，与用户按下导出时的心智一致。
 *
 * 用 `setDate` 而不是减毫秒：跨夏令时的那一天不会算偏。
 */
function dateRangeText(days: number): string {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return `${formatFullDate(start.getTime())} – ${formatFullDate(end.getTime())}`;
}

export function chronicleCardLayout(
  chronicle: Chronicle,
  days: number,
  palette: PosterPalette
): ChronicleCardLayout {
  // 与故事面板同序：模型层给的是章节序号，不是数组下标，按 index 排才不会
  // 因为数据源顺序抖动而让叙事时间线跳章。
  const chapters = [...chronicle.chapters].sort((a, b) => a.index - b.index);
  const windowDays = Math.max(1, Math.floor(days));
  const height = HEADER_HEIGHT + CHAPTER_HEIGHT * chapters.length + FOOTER_HEIGHT;

  const items: PosterItem[] = [
    { kind: "rect", x: 0, y: 0, w: CHRONICLE_CARD_WIDTH, h: height, fill: palette.bg },
    { kind: "rect", x: MARGIN_X, y: 80, w: 120, h: 8, fill: palette.accent },
    {
      kind: "text",
      x: MARGIN_X,
      y: 128,
      size: 28,
      weight: 500,
      fill: palette.muted,
      text: "CC ANALYZER · 数据故事"
    },
    {
      kind: "text",
      x: MARGIN_X,
      y: 214,
      size: 64,
      weight: 700,
      fill: palette.text,
      text: `近 ${windowDays} 天的故事`
    },
    {
      kind: "text",
      x: MARGIN_X,
      y: 262,
      size: 26,
      weight: 500,
      fill: palette.muted,
      text: dateRangeText(windowDays)
    }
  ];

  chapters.forEach((chapter, chapterIndex) => {
    // 每章的局部坐标从 top 起算；240 的节奏写死，章节之间不随内容伸缩——
    // 长图是「一页一章」的杂志栏位，不是流式文档。
    const top = HEADER_HEIGHT + chapterIndex * CHAPTER_HEIGHT;
    const baseline = top + 162;
    // 单位贴着大数字右缘 16px；估宽偏宽时只是多一点缝隙，不会压到数字。
    const unitX = MARGIN_X + textWidth(chapter.stat, 96) + 16;

    items.push(
      {
        kind: "text",
        x: MARGIN_X,
        y: top + 32,
        size: 24,
        weight: 500,
        fill: palette.muted,
        text: chapter.kicker
      },
      {
        kind: "text",
        x: MARGIN_X,
        y: top + 76,
        size: 38,
        weight: 700,
        fill: palette.text,
        text: chapter.title
      },
      {
        kind: "text",
        x: MARGIN_X,
        y: baseline,
        size: 96,
        weight: 700,
        fill: palette.text,
        text: chapter.stat
      },
      {
        kind: "text",
        x: unitX,
        y: baseline,
        size: 30,
        weight: 500,
        fill: palette.muted,
        text: chapter.statUnit
      }
    );

    wrapText(chapter.body, BODY_SIZE, BODY_MAX_LINES).forEach((line, lineIndex) => {
      items.push({
        kind: "text",
        x: MARGIN_X,
        y: top + 196 + lineIndex * 30,
        size: BODY_SIZE,
        weight: 400,
        // 正文用次级色：大数字才是每章的主角，正文退一档才读得出层级。
        fill: palette.muted,
        text: line
      });
    });

    items.push({
      kind: "rect",
      x: MARGIN_X,
      y: top + CHAPTER_HEIGHT - 1,
      w: RULE_WIDTH,
      h: 1,
      fill: palette.border
    });
  });

  const footerTop = HEADER_HEIGHT + chapters.length * CHAPTER_HEIGHT;

  // summary 也折行：一句话在 34px 下很容易超过 900px，不折就会顶出画布右缘。
  // 最多两行，超出截断——结尾的职责是收束，不是把正文再讲一遍。
  wrapText(chronicle.summary, SUMMARY_SIZE, SUMMARY_MAX_LINES).forEach((line, lineIndex) => {
    items.push({
      kind: "text",
      x: MARGIN_X,
      y: footerTop + 56 + lineIndex * 40,
      size: SUMMARY_SIZE,
      weight: 500,
      fill: palette.text,
      text: line
    });
  });

  items.push(
    {
      kind: "text",
      x: MARGIN_X,
      y: footerTop + 150,
      size: 22,
      weight: 400,
      fill: palette.muted,
      text: "由 CC Analyzer 本地生成 · 数据不出本机"
    },
    {
      kind: "text",
      x: MARGIN_X,
      y: footerTop + 184,
      size: 22,
      weight: 400,
      fill: palette.muted,
      text: "口径：所选时间范围；token 取日志里的四类用量"
    }
  );

  return { width: CHRONICLE_CARD_WIDTH, height, items };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function chronicleCardSvg(layout: ChronicleCardLayout): string {
  const body = layout.items
    .map((item) => {
      if (item.kind === "rect") {
        return `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" fill="${item.fill}"/>`;
      }
      return `<text x="${item.x}" y="${item.y}" font-family="${FONT_STACK}" font-size="${item.size}" font-weight="${item.weight}" fill="${item.fill}">${escapeXml(item.text)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}">${body}</svg>`;
}

/** 把同一份图元列表画到 canvas；`ctx` 为空由调用方负责降级。 */
export function drawChronicleCard(
  ctx: CanvasRenderingContext2D,
  layout: ChronicleCardLayout
): void {
  for (const item of layout.items) {
    if (item.kind === "rect") {
      ctx.fillStyle = item.fill;
      ctx.fillRect(item.x, item.y, item.w, item.h);
      continue;
    }
    ctx.fillStyle = item.fill;
    ctx.font = `${item.weight} ${item.size}px ${FONT_STACK}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(item.text, item.x, item.y);
  }
}

/** 与 `posterFileName` 同一命名法：cc-analyzer-story-YYYY-MM-DD-<theme>.png。 */
export function chronicleCardFileName(day: Date, theme: "light" | "dark"): string {
  const yyyy = String(day.getFullYear());
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return `cc-analyzer-story-${yyyy}-${mm}-${dd}-${theme}.png`;
}
