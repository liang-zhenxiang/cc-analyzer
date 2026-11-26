import { describe, expect, it } from "vitest";
import {
  dateBucketLabel,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatDurationCompact,
  formatFullDate,
  formatModelId,
  formatProjectPath,
  formatRelativeTime,
  formatShortStamp,
  formatTokenCount
} from "./format";

describe("format helpers", () => {
  it("formats durations in Chinese for prose", () => {
    expect(formatDuration(250)).toBe("250 毫秒");
    expect(formatDuration(1_500)).toBe("1.5 秒");
    expect(formatDuration(12_000)).toBe("12 秒");
    expect(formatDuration(90_000)).toBe("1 分 30 秒");
    expect(formatDuration(12_064_754)).toBe("3 小时 21 分");
  });

  it("keeps only two levels of precision in Chinese", () => {
    // 每档边界：秒 → 分 → 时 → 天，跨过去就换单位并丢掉更细的位。
    expect(formatDuration(59_900)).toBe("59.9 秒");
    expect(formatDuration(60_000)).toBe("1 分");
    expect(formatDuration(59.9 * 60_000)).toBe("59 分 54 秒");
    expect(formatDuration(60 * 60_000)).toBe("1 小时");
    expect(formatDuration(23.9 * 3_600_000)).toBe("23 小时 54 分");
    expect(formatDuration(24 * 3_600_000)).toBe("1 天");
  });

  it("does not print a zero remainder in Chinese", () => {
    const hour = 3_600_000;
    expect(formatDuration(1_000)).toBe("1 秒");
    expect(formatDuration(8 * 60_000)).toBe("8 分");
    expect(formatDuration(2 * hour)).toBe("2 小时");
    // 24 小时整：一天就是一天，不印「1 天 0 小时」。
    expect(formatDuration(24 * hour)).toBe("1 天");
    // 25h30m：整天的部分先读，余下小时第二读；分钟/秒不再进入文案。
    expect(formatDuration(25.5 * hour)).toBe("1 天 1 小时");
    // 正好整天（审计里的 165h6m4s 归到 6 天 21 小时；72h 是纯整天）。
    expect(formatDuration(72 * hour)).toBe("3 天");
    expect(formatDuration((165 * 3600 + 6 * 60 + 4) * 1000)).toBe("6 天 21 小时");
  });

  it("falls back to zero for negative and non-finite durations", () => {
    expect(formatDuration(0)).toBe("0 毫秒");
    expect(formatDuration(-1)).toBe("0 毫秒");
    expect(formatDuration(Number.NaN)).toBe("0 毫秒");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0 毫秒");
    expect(formatDurationCompact(0)).toBe("0ms");
    expect(formatDurationCompact(-1)).toBe("0ms");
    expect(formatDurationCompact(Number.NaN)).toBe("0ms");
    expect(formatDurationCompact(Number.POSITIVE_INFINITY)).toBe("0ms");
  });

  it("formats compact durations with fixed decimals for table columns", () => {
    expect(formatDurationCompact(250)).toBe("250ms");
    // 紧凑列按位对齐：尾零是有意义的宽度，不裁掉。
    expect(formatDurationCompact(1_500)).toBe("1.50s");
    expect(formatDurationCompact(12_000)).toBe("12.0s");
    expect(formatDurationCompact(90_000)).toBe("1m30s");
    expect(formatDurationCompact(12_064_754)).toBe("3h21m4s");
  });

  it("keeps compact durations in one language above a day", () => {
    const hour = 3_600_000;
    expect(formatDurationCompact(59_900)).toBe("59.9s");
    expect(formatDurationCompact(60_000)).toBe("1m0s");
    expect(formatDurationCompact(59.9 * 60_000)).toBe("59m54s");
    expect(formatDurationCompact(60 * 60_000)).toBe("1h0m0s");
    expect(formatDurationCompact(23.9 * 3_600_000)).toBe("23h54m0s");
    // ≥24 小时不再借中文：这一档也改回紧凑单位。
    expect(formatDurationCompact(24 * hour)).toBe("1d");
    expect(formatDurationCompact(25.5 * hour)).toBe("1d1h");
    expect(formatDurationCompact(72 * hour)).toBe("3d");
    expect(formatDurationCompact((165 * 3600 + 6 * 60 + 4) * 1000)).toBe("6d21h");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(2048)).toBe("2KB");
    expect(formatBytes(1_572_864)).toBe("1.5MB");
  });

  it("formats token counts compactly without hiding small values", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(120)).toBe("120");
    expect(formatTokenCount(51_950)).toBe("51,950");
    expect(formatTokenCount(16_498_154)).toBe("16.5M");
    expect(formatTokenCount(5_784_080_022)).toBe("5.78B");
  });

  it("formats timestamps in Chinese", () => {
    expect(formatDateTime(Date.UTC(2026, 0, 2, 3, 4, 5))).toMatch(/2026\/1\/2/);
  });

  it("formats zero-padded short stamps for dense rows", () => {
    // 本地时区构造（压缩事件 chip / 改动文件行用的都是本地时刻）；补零让
    // mono 列里每位等宽，1 月 3 日 9:07 不会比 12 月 31 日短一截。
    expect(formatShortStamp(new Date(2026, 0, 3, 9, 7).getTime())).toBe("01-03 09:07");
    expect(formatShortStamp(new Date(2026, 11, 31, 23, 59).getTime())).toBe("12-31 23:59");
  });

  it("formats full dates as YYYY-MM-DD, zero-padded across the year", () => {
    // 单数字月份与日子都补零：全历史窗口没有年份表头，日期得自己带年份。
    expect(formatFullDate(new Date(2026, 0, 3).getTime())).toBe("2026-01-03");
    expect(formatFullDate(new Date(2026, 11, 31).getTime())).toBe("2026-12-31");
    expect(formatFullDate(new Date(2025, 11, 31).getTime())).toBe("2025-12-31");
    expect(formatFullDate(new Date(2026, 0, 1).getTime())).toBe("2026-01-01");
    // 与 formatDayLabel 的 `5/31` 是两种用途，不共享输出。
    expect(formatFullDate(new Date(2026, 4, 31).getTime())).toBe("2026-05-31");
  });

  it("formats relative time labels for the session list", () => {
    const now = Date.UTC(2026, 8, 23, 12, 0, 0);
    expect(formatRelativeTime(now - 30_000, now)).toBe("刚刚");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5分钟前");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3小时前");
    expect(formatRelativeTime(now - 26 * 3_600_000, now)).toBe("昨天");
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe("3天前");
  });

  it("buckets sessions by calendar day", () => {
    const now = Date.UTC(2026, 8, 23, 12, 0, 0);
    expect(dateBucketLabel(now - 3_600_000, now)).toBe("今天");
    expect(dateBucketLabel(now - 30 * 3_600_000, now)).toBe("昨天");
    expect(dateBucketLabel(now - 3 * 86_400_000, now)).toBe("本周");
    expect(dateBucketLabel(Date.UTC(2026, 8, 3, 12), now)).toBe("本月");
    expect(dateBucketLabel(Date.UTC(2026, 6, 3, 12), now)).toBe("更早");
  });

  it("shows a project's real name when the session's cwd is known", () => {
    // 目录名是编码过的绝对路径，末段必须取自 cwd——`-repo-usage-days` 拆连字符
    // 会把 `/repo/usage-days` 显示成 `days`。
    expect(formatProjectPath("-repo-usage-days", "/repo/usage-days")).toBe("usage-days");
    expect(formatProjectPath("-Users-me-my-project", "/Users/me/my-project")).toBe("my-project");
    expect(formatProjectPath("-repo-demo", "C:\\work\\demo")).toBe("demo");
    // 目录名是 cwd 时同样是末段（搜索浮层与侧栏都用这一条）。
    expect(formatProjectPath("/repo/usage-days", "/repo/usage-days")).toBe("usage-days");
  });

  it("falls back to the directory name when no cwd is known", () => {
    // 没有 cwd 就只去掉编码用的前导 `-`，不猜连字符是分隔符还是名字的一部分。
    expect(formatProjectPath("-repo-usage-days")).toBe("repo-usage-days");
    expect(formatProjectPath("repo")).toBe("repo");
    // 畸形输入原样返回，而不是变成空串。
    expect(formatProjectPath("-")).toBe("-");
    expect(formatProjectPath("")).toBe("");
    expect(formatProjectPath("-repo-demo", "/")).toBe("repo-demo");
  });

  it("shortens model ids to family and version", () => {
    expect(formatModelId("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(formatModelId("claude-opus-4-1-20250805")).toBe("Opus 4.1");
    expect(formatModelId("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    // 快照日期不能被吞进版本号（8 位段不属于 version）。
    expect(formatModelId("claude-sonnet-4-20250514")).toBe("Sonnet 4");
    // 旧格式 `claude-<版本>-<家族>-<日期>` 同样可读。
    expect(formatModelId("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
    expect(formatModelId("claude-3-opus-20240229")).toBe("Opus 3");
    // 认不出来的 id 原样返回——不发明日志里没有的名字。
    expect(formatModelId("gpt-unknown-9")).toBe("gpt-unknown-9");
    expect(formatModelId("未知模型")).toBe("未知模型");
  });
});
