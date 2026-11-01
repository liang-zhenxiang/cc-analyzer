import { formatDuration, formatTokenCount } from "../../lib/format";
import {
  POSTER_HEIGHT,
  POSTER_WIDTH,
  type PosterContent,
  type PosterPalette
} from "../usage/posterCanvas";

/**
 * H8 会话分享卡的画布内容（Round HH §4.8）：只造 PosterContent，
 * 绘制走既有 posterLayout/drawPoster 管线（1080×1350，尺寸不另立）。
 *
 * 隐私边界（§2-⑤ 拍板）：**不印会话名**。标题是常量「一次 Claude Code
 * 会话」；副标题 = 项目 basename + 日期；页脚 = 会话 id 前 8 位 + 应用名。
 * 任何消息内容、完整路径、cwd 绝对段绝不进卡——这张卡设计为可分享，
 * 默认收卡的人不认识你的目录结构。
 *
 * 四读数全部是数值（时长 / token / 工具调用 / 主导模型），与
 * sessionCardData 的统计口径同源，但渲染成海报的 cells 形状。
 */

/** 会话 id 取前 8 位（uuid 前缀足以定位，不足以反推全量）。 */
const SHORT_ID_LENGTH = 8;

export type ShareCardSource = {
  /** 项目 basename（调用方已脱敏——只最后一段）。 */
  projectBasename: string | null;
  /** 会话首条记录的本地日期（YYYY-MM-DD，调用方格式化）。 */
  dayLabel: string;
  /** 会话时长（首尾记录之差）。 */
  durationMs: number;
  /** token 合计（null = 无读数，卡上印「—」不印 0）。 */
  totalTokens: number | null;
  /** 工具调用次数。 */
  toolCallCount: number;
  /** 主导模型名（null = 未知）。 */
  modelLabel: string | null;
  /** 会话 id（uuid），页脚取前 8 位。 */
  sessionId: string;
};

/** 「YYYY-MM-DD」本地日期：分享卡要跨 locale 稳定，手动拼（posterFileName 同款）。 */
export function shareCardDayLabel(timestamp: number): string {
  const day = new Date(timestamp);
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${mm}-${dd}`;
}

/** 分享卡文件名：cca-session-card-{短id}.png（§4.8 定稿）。 */
export function shareCardFileName(shortId: string, extension: "png" | "svg" = "png"): string {
  return `cca-session-card-${shortId}.${extension}`;
}

/** 会话 id 的短形态（前 8 位；不足 8 位原样）。 */
export function shortIdOf(sessionId: string): string {
  return sessionId.slice(0, SHORT_ID_LENGTH);
}

/**
 * 组装分享卡的 PosterContent。palette 由调用方按主题给（高对比度主题
 * 沿用浅色档的决策在按钮层做，这里不管）。
 */
export function shareCardContent(source: ShareCardSource): PosterContent {
  const shortId = shortIdOf(source.sessionId);
  return {
    kicker: "CC ANALYZER · 会话分享卡",
    // 标题是常量：不取 sessionTitle——会话名是用户给这次对话的私语，
    // 拿去分享前应该由本人决定，而不是默认印在卡上（§2-⑤）。
    title: "一次 Claude Code 会话",
    period: `${source.projectBasename ?? "未知项目"} · ${source.dayLabel}`,
    cells: [
      { value: formatDuration(source.durationMs), label: "会话时长" },
      {
        value: source.totalTokens === null ? "—" : formatTokenCount(source.totalTokens),
        label: "token（四类合计）"
      },
      { value: source.toolCallCount.toLocaleString("en-US"), label: "次工具调用" },
      { value: source.modelLabel ?? "未知", label: "主导模型" }
    ],
    model: `会话 ${shortId}`,
    footer: [
      "由 CC Analyzer 本地生成 · 数据不出本机",
      "卡面只有统计读数：不含消息内容与完整路径"
    ]
  };
}

/** 分享卡画布尺寸（与海报同一套管线，1080×1350 竖版）。 */
export const SHARE_CARD_WIDTH = POSTER_WIDTH;
export const SHARE_CARD_HEIGHT = POSTER_HEIGHT;

/** 浅色档 palette（PNG 要发给别人，不假设对方用高对比度——§4.8）。 */
export const SHARE_CARD_LIGHT_PALETTE: PosterPalette = {
  bg: "#f7f6f3",
  text: "#1f2328",
  muted: "#59636e",
  accent: "#2952cc",
  border: "#d9d5cd"
};
