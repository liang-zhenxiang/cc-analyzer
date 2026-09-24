import { describe, expect, it } from "vitest";
import {
  dateBucketLabel,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatRelativeTime
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
});
