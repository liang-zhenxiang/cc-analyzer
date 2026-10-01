export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/**
 * Compact token counts for dense tables, where four counters sit in one column
 * and their magnitudes differ by three orders. Below a million the exact value
 * is kept — those sessions are small enough to read, and the whole point of the
 * counter is that it is a fact rather than an estimate. The exact value also
 * goes in the cell's `title` either way; rounding is for scanning, not for the
 * record.
 */
export function formatTokenCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(2)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return count.toLocaleString("en-US");
}

/**
 * USD amounts for the dashboard's cost estimate. Always two decimals below a
 * thousand (the figure is an estimate read next to a badge saying so — extra
 * precision would fake accuracy), and grouping only above it.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${value.toFixed(2)}`;
}

/** Wall-clock labels for the timeline scale (HH:mm) and probe (HH:mm:ss). */
export function formatClock(ms: number, withSeconds = false): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  const base = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base;
}

/** Relative time labels for the session list (刚刚 / N 分钟前 / 更早). */
export function formatRelativeTime(ms: number, now = Date.now()): string {
  if (!ms || ms < 0) return "-";
  const diff = now - ms;
  if (diff < 0 || diff < 60_000) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;
  const date = new Date(ms);
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

/** Calendar-day bucket used to group the timeline view. */
export function dateBucketLabel(ms: number, now = Date.now()): string {
  const dayStart = (value: number) => {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const days = Math.round((dayStart(now) - dayStart(ms)) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return "本周";
  const left = new Date(ms);
  const right = new Date(now);
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
    ? "本月"
    : "更早";
}
