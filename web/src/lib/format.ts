import { basename } from "./path";

/**
 * 时长的人话写法。超过一天后分钟/秒不再帮助阅读（「165h6m4s」要心算才知道
 * 是七天），所以换成「6 天 21 小时」：整天的部分先读，余下的小时第二读，
 * 更细的两位直接丢弃。24 小时以内维持原有的 h/m/s 紧凑写法——那些时长常
 * 出现在工具调用行里，秒级精度仍是有用的信息。
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;

  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    // 正好整天时不印「0 小时」：零余量不是读数缺失。
    return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  }

  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;
  if (totalHours > 0) return `${totalHours}h${minutes}m${seconds}s`;
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
 * Token 单位的三档写法（P2-13）——按密度分档，同一屏里不要混用：
 * - 正文句子：`token`（计数名词不加 s，写成「12,345 token」）；
 * - 表头 / 列名：`Tokens`（标题位统一大写复数，如「Tokens 总量」）；
 * - 密集紧凑数字（Top 会话行、KPI 脚注）：`tok`，为列宽让路。
 * 本轮的统一范围只有 `BillingWindowCard`；其它面板按各自轮次跟进。
 */

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
 * Rates (tokens per hour) for readouts that sit next to exact integers.
 *
 * `formatTokenCount` keeps decimals because a token count *is* an integer
 * fact — a rate is not. `19,929.246/时` next to `63,050` reads as two
 * different measurement systems; rounding the rate to whole tokens keeps the
 * readout honest about its precision (the underlying value stays available in
 * the tooltip / model layer). Above a million the compact M/B form applies,
 * same as counts.
 */
export function formatRate(tokensPerHour: number): string {
  if (!Number.isFinite(tokensPerHour) || tokensPerHour <= 0) return "0/时";
  return `${formatTokenCount(Math.round(tokensPerHour))}/时`;
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

/**
 * `03-01 09:33` — 密集行里的短时间戳（压缩事件 chip、改动文件行）。
 * 日期与时间都补零成等长串：mono 列里宽度恒定，行间对齐不抖动。
 */
export function formatShortStamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(ms)}`;
}

/**
 * `2026-05-31` — a full calendar date that names its own year.
 *
 * Three date shapes already exist and they serve three different contexts, not
 * three author's moods: `formatDayLabel` (`5/31`) is a chart axis tick read
 * under a year header; `insightDateText` inside the calendar drops the year
 * within the current year because the sentence sits under that same header;
 * `formatDateTime` is the long `zh-CN` stamp including seconds. The milestones
 * window is **all history** — there is no year header to lean on, so the year
 * has to be part of the value itself (Round Y §5.3).
 */
export function formatFullDate(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

/**
 * Human label for a project. Claude Code encodes a project's absolute path into
 * its directory name by replacing every `/` with `-` (`/repo/usage-days` →
 * `-repo-usage-days`), and that encoding is **lossy** — the same label is what
 * `/repo/usage/days` would produce — so it cannot be decoded back into a path.
 * The honest source is therefore the session's own `cwd`; pass it whenever the
 * caller has one and the real last segment is shown. Without it, all that can
 * be said for certain is that the leading `-` is the encoded-path marker rather
 * than part of the name, so only that is dropped (`-` inside the rest may be a
 * separator or a real hyphen, and splitting there would print `days` for a
 * directory actually called `usage-days`). Unrecognisable input is returned
 * untouched.
 */
export function formatProjectPath(label: string, cwd?: string): string {
  const fromCwd = cwd ? basename(cwd) : "";
  if (fromCwd) return fromCwd;
  const stripped = label.startsWith("-") ? label.slice(1) : label;
  return stripped.length > 0 ? stripped : label;
}

const MODEL_FAMILY_LABELS = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" } as const;

function modelFamilyLabel(name: string): string | undefined {
  return name === "opus" || name === "sonnet" || name === "haiku"
    ? MODEL_FAMILY_LABELS[name]
    : undefined;
}

/**
 * Model ids are raw API identifiers (`claude-sonnet-4-5-20250929`). Three of
 * them share the `claude-` prefix and differ only in the tail, which is the
 * worst possible shape for a chart legend, so this prints the family and the
 * version (`Sonnet 4.5`). The dated snapshot is dropped from the label but
 * stays available to the caller as a tooltip — two snapshots of one version are
 * not the same thing. Ids that do not follow the pattern (another vendor's, a
 * future format) come back untouched rather than guessed at.
 *
 * Version numbers are matched as at most two digits per component so the
 * 8-digit snapshot date cannot be swallowed into the version.
 */
export function formatModelId(id: string): string {
  const match =
    /^claude-(?:(\d{1,2}(?:-\d{1,2})*)-)?(opus|sonnet|haiku)(?:-(\d{1,2}(?:-\d{1,2})*))?(?:-(\d{8}))?$/.exec(
      id
    );
  if (!match) return id;
  const family = modelFamilyLabel(match[2]);
  if (!family) return id;
  const version = match[3] ?? match[1];
  return version ? `${family} ${version.split("-").join(".")}` : family;
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
