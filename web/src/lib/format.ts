import { basename } from "./path";

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
