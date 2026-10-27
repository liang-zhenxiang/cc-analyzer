/**
 * 数据新鲜度徽章（E9）：把「最后一次记录」「最后一次文件系统扫描」两个
 * 时刻折成一句话 + 一个分级。纯函数，`now` 由调用方注入（页面用
 * `useBillingReadouts` 的 30 秒 tick——同屏所有时间读数共一个 now，绝不
 * 各自 Date.now()）。
 *
 * 口径：
 * - 无数据（lastRecordAt 为 null）→ staleness "unknown"、label「暂无数据」、
 *   minutesAgo null——「没数据」和「数据旧」是两种话，不混；
 * - staleness 只看 lastRecordAt：< 5 分钟 fresh，≥ 5 分钟 stale（5 分钟
 *   是「一轮正常扫描 + 缓冲」的量级，不是精妙的科学常数）；
 * - hint 按 staleness 与 lastScanAt 拼：stale 且扫描比记录新 →「正在变化
 *   或等待刷新」类；stale 且扫描也旧 →「可能已停止记录」类；fresh 时给
 *   轻提示或空串。null 的 lastScanAt 各自降级，不编造。
 * - HH:MM 用本地时区、`Date.getHours/getMinutes` 手动拼（formatClock 同款
 *   手法）而不是 Intl.DateTimeFormat：徽章要的是「运行机器的本地钟面」，
 *   getHours 天然就是本地时区，且与项目里 formatDayLabel/formatClock 的
 *   全部时间标签保持同一实现路线（无 locale 依赖、输出恒定，e2e 断言不漂）。
 */

export type FreshnessBadgeModel = {
  /** 「数据截至 HH:MM」或「暂无数据」。 */
  label: string;
  /** 距最后一条记录的分钟数（向下取整到分钟）；无数据 null。 */
  minutesAgo: number | null;
  staleness: "fresh" | "stale" | "unknown";
  /** 人话提示，随 staleness 与 lastScanAt 变化；fresh 时可为空串。 */
  hint: string;
};

/** fresh → stale 的分界（分钟）。 */
export const FRESH_WINDOW_MINUTES = 5;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地钟面 HH:MM（getHours/getMinutes 手动拼，与 formatClock 同一路线）。 */
function clockLabel(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function freshnessOf(
  now: number,
  lastRecordAt: number | null,
  lastScanAt: number | null
): FreshnessBadgeModel {
  if (lastRecordAt === null) {
    return {
      label: "暂无数据",
      minutesAgo: null,
      staleness: "unknown",
      hint: lastScanAt === null
        ? "还没有扫描过会话目录"
        : `上次扫描 ${minutesBetween(lastScanAt, now)} 分钟前，但没有读到任何记录`
    };
  }

  const minutesAgo = minutesBetween(lastRecordAt, now);
  const label = `数据截至 ${clockLabel(lastRecordAt)}`;

  if (minutesAgo < FRESH_WINDOW_MINUTES) {
    return {
      label,
      minutesAgo,
      staleness: "fresh",
      hint: lastScanAt === null
        ? ""
        : `上次扫描 ${minutesBetween(lastScanAt, now)} 分钟前`
    };
  }

  // stale：按扫描时刻与记录时刻的相对新旧拼提示。
  if (lastScanAt !== null && lastScanAt > lastRecordAt) {
    // 扫过但没读到新记录：目录在动（扫描在跑）而日志没长——要么真的没新会话，
    // 要么正在等下一轮扫描落盘。
    return {
      label,
      minutesAgo,
      staleness: "stale",
      hint: `上次扫描 ${minutesBetween(lastScanAt, now)} 分钟前，正在变化或等待刷新`
    };
  }
  // 扫描比记录还旧（或没有扫描时刻）：连扫描都没跟上，提示用户刷新。
  return {
    label,
    minutesAgo,
    staleness: "stale",
    hint: lastScanAt === null
      ? "记录已有一会儿了，建议重新扫描"
      : `上次扫描 ${minutesBetween(lastScanAt, now)} 分钟前，早于最后一条记录，建议重新扫描`
  };
}

/** 两个时刻之间的整分钟数（向下取整；59 秒 ≈ 0 分钟——「4.9 分钟」按 4 报）。 */
function minutesBetween(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
}
