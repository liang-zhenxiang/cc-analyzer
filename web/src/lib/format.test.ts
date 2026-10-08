import { describe, expect, it } from "vitest";
import {
  dateBucketLabel,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatModelId,
  formatProjectPath,
  formatRelativeTime,
  formatTokenCount
} from "./format";

describe("format helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(250)).toBe("250ms");
    expect(formatDuration(1500)).toBe("1.50s");
    expect(formatDuration(90_000)).toBe("1m30s");
    expect(formatDuration(12_064_754)).toBe("3h21m4s");
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
