/**
 * 会话分享卡数据（H8，Round HH）：为「把这段会话晒出去」准备三段文案。
 *
 * 分工红线：本模块**只出数据与文案**，canvas 绘制归界面层（posterCanvas
 * 的管线口径不变，这里连 canvas 都不碰）。
 *
 * 隐私红线（本卡设计为可分享，任何一条都不可破）：
 * ① 任何消息内容绝不进输出——headline 是会话名，其余行是纯统计；
 * ② 完整路径 / cwd 绝对段绝不进输出——项目名只保留最后一段（与
 *    sessionArchive 的 projectNameOfCwd 同口径：剥尾部斜杠、按 / 与 \
 *    切分、取最后一段）；
 * ③ 没有的数据不编：tokens 为 null 写「无 token 读数」、modelLabel 为
 *    null 写「模型未知」——分享卡上的「0」会被人当真实读数。
 *
 * 文案口径：
 * - headline：会话名超 24 字截断加 …（display: 24 个字再加省略号）。
 * - 时长：formatDuration（与用量档同一份人话：90s / 12m30s / 1h2m3s）。
 * - token：formatTokenCount（千分位 / M / B 同海报口径）。
 * - footer：CC Analyzer · 生成于 YYYY-MM-DD（本地日期，补零；posterFileName
 *   同款手动拼接，不走 toLocaleString——格式必须在任何 locale 下稳定）。
 */

import { formatDuration, formatTokenCount } from "../../lib/format";
import { projectNameOfCwd } from "./sessionArchive";

/** headline 上限：超过 24 字截断加 …（「24 个字 + …」是界面层量过的卡宽）。 */
const TITLE_LIMIT = 24;

export type SessionCardInput = {
  /** 会话名（customTitle / aiTitle 等已由调用方择优；本模块只管截断）。 */
  title: string;
  /** 项目 cwd（只取最后一段展示；null → 「（未知项目）」由同口径函数兜底）。 */
  projectLabel: string | null;
  /** 会话时长（首尾记录之差，调用方给）。 */
  durationMs: number;
  /** token 读数（null = 无读数，写诚实文案）。 */
  tokens: { prompt: number; output: number } | null;
  /** 用到的工具种数。 */
  toolCount: number;
  /** 主力模型名（null → 「模型未知」）。 */
  modelLabel: string | null;
  /** 会话首条记录时间（保留给界面层排版，本模块不输出它）。 */
  firstTimestamp: number;
  /** 生成时刻（footer 的日期）。 */
  generatedAt: number;
};

export type SessionCardData = {
  /** 卡面大标题：会话名（截断后）。 */
  headline: string;
  /** 统计行（项目 / 时长 / token / 工具与模型），顺序即展示顺序。 */
  lines: string[];
  /** 页脚署名 + 生成日期。 */
  footer: string;
};

/** 「YYYY-MM-DD」本地日期（补零）：分享卡要跨 locale 稳定，手动拼。 */
function ymdText(ms: number): string {
  const day = new Date(ms);
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${mm}-${dd}`;
}

export function sessionCardData(input: SessionCardInput): SessionCardData {
  // 截断只看字数（UTF-16 code unit），中文英文一视同仁；「…」不计入 24。
  const clipped = input.title.length > TITLE_LIMIT
    ? `${input.title.slice(0, TITLE_LIMIT)}…`
    : input.title;

  const lines: string[] = [
    // 隐私红线：cwd 只留最后一段（projectNameOfCwd 同口径，含兜底文案）。
    `项目 ${projectNameOfCwd(input.projectLabel ?? undefined)}`,
    `时长 ${formatDuration(input.durationMs)}`,
    input.tokens === null
      ? "token 无 token 读数"
      : `token ${formatTokenCount(input.tokens.prompt + input.tokens.output)}（输入 ${formatTokenCount(input.tokens.prompt)} · 输出 ${formatTokenCount(input.tokens.output)}）`,
    `工具 ${input.toolCount} 种 · 主力 ${input.modelLabel ?? "模型未知"}`
  ];

  return {
    headline: clipped,
    lines,
    footer: `CC Analyzer · 生成于 ${ymdText(input.generatedAt)}`
  };
}
