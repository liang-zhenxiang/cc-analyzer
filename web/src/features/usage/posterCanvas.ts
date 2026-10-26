import { formatModelId, formatTokenCount } from "../../lib/format";
import type { PosterStats } from "./posterStats";

/**
 * 海报的排版与两种渲染：同一份图元列表喂给 `<svg>` 与 `<canvas>`，
 * 免得预览和导出各画一套、越画越不一样。
 *
 * 版式 1080×1350：全部坐标写死，不跟字号缩放——这是一张图，不是界面。
 * 隐私红线：只用聚合数与模型名，不写项目路径、会话 id、消息原文。
 */

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;

export type PosterPalette = {
  bg: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
};

export type PosterContent = {
  kicker: string;
  title: string;
  period: string;
  cells: Array<{ value: string; label: string }>;
  model: string;
  footer: string[];
};

export type PosterItem =
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string }
  | { kind: "text"; x: number; y: number; size: number; weight: number; fill: string; text: string };

const FONT_STACK =
  "system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif";

export function posterContentOf(stats: PosterStats): PosterContent {
  const empty = stats.totalTokens === 0 && stats.totalMessages === 0;
  return {
    kicker: "CC ANALYZER · 开发者海报",
    title: "我的 AI 工作方式",
    period: empty ? "本窗口还没有记录" : `${stats.firstDay} – ${stats.lastDay}`,
    cells: [
      { value: formatTokenCount(stats.totalTokens), label: "已读 token" },
      { value: stats.totalMessages.toLocaleString("en-US"), label: "条消息" },
      { value: String(stats.activeDays), label: "天有记录" },
      { value: stats.peakHourLabel, label: "最忙的一小时" }
    ],
    model: stats.topModel === null ? "主力模型：—" : `主力模型：${formatModelId(stats.topModel)}`,
    footer: [
      "由 CC Analyzer 本地生成 · 数据不出本机",
      "口径：所选时间范围；token 取日志里的四类用量",
      "不是账单：成本与排名按定价快照估算"
    ]
  };
}

export function posterLayout(content: PosterContent, palette: PosterPalette): PosterItem[] {
  const items: PosterItem[] = [
    { kind: "rect", x: 0, y: 0, w: POSTER_WIDTH, h: POSTER_HEIGHT, fill: palette.bg },
    { kind: "rect", x: 96, y: 80, w: 120, h: 8, fill: palette.accent },
    { kind: "text", x: 96, y: 128, size: 28, weight: 500, fill: palette.muted, text: content.kicker },
    { kind: "text", x: 96, y: 214, size: 64, weight: 700, fill: palette.text, text: content.title },
    { kind: "text", x: 96, y: 262, size: 26, weight: 500, fill: palette.muted, text: content.period }
  ];

  content.cells.forEach((cell, index) => {
    const x = 96 + (index % 2) * 456;
    const y = 340 + Math.floor(index / 2) * 194;
    items.push({
      kind: "text",
      x,
      y: y + 88,
      size: 88,
      weight: 700,
      fill: palette.text,
      text: cell.value
    });
    items.push({
      kind: "text",
      x,
      y: y + 136,
      size: 24,
      weight: 500,
      fill: palette.muted,
      text: cell.label
    });
  });

  items.push({
    kind: "text",
    x: 96,
    y: 820,
    size: 26,
    weight: 500,
    fill: palette.muted,
    text: content.model
  });
  items.push({ kind: "rect", x: 96, y: 856, w: 888, h: 1, fill: palette.border });

  content.footer.forEach((line, index) => {
    items.push({
      kind: "text",
      x: 96,
      y: 1180 + index * 30,
      size: 20,
      weight: 400,
      fill: palette.muted,
      text: line
    });
  });

  return items;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function posterSvg(content: PosterContent, palette: PosterPalette): string {
  const body = posterLayout(content, palette)
    .map((item) => {
      if (item.kind === "rect") {
        return `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" fill="${item.fill}"/>`;
      }
      return `<text x="${item.x}" y="${item.y}" font-family="${FONT_STACK}" font-size="${item.size}" font-weight="${item.weight}" fill="${item.fill}">${escapeXml(item.text)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}">${body}</svg>`;
}

/** 把同一份图元列表画到 canvas；`ctx` 为 null（环境不支持）时调用方负责降级。 */
export function drawPoster(
  ctx: CanvasRenderingContext2D,
  content: PosterContent,
  palette: PosterPalette
): void {
  for (const item of posterLayout(content, palette)) {
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

export function posterFileName(day: Date, theme: "light" | "dark", extension: "png" | "svg"): string {
  const yyyy = String(day.getFullYear());
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return `cc-analyzer-poster-${yyyy}-${mm}-${dd}-${theme}.${extension}`;
}
