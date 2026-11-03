import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FreshnessBadge } from "./FreshnessBadge";

const NOW = new Date(2026, 0, 5, 14, 32, 0, 0).getTime();
const MIN = 60_000;

function badgeOf(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>('[data-probe="data-freshness"]');
  if (!node) throw new Error("freshness badge not rendered");
  return node;
}

describe("FreshnessBadge（E9）", () => {
  it("3 分钟前：写「数据截至 HH:MM（3 分钟前）」，圆点是新鲜档", () => {
    const { container } = render(
      <FreshnessBadge now={NOW} lastRecordAt={NOW - 3 * MIN} lastScanAt={NOW - 1 * MIN} />
    );
    const badge = badgeOf(container);
    expect(badge.textContent).toBe("数据截至 14:29（3 分钟前）");
    expect(badge.dataset.state).toBe("fresh");
  });

  it("12 分钟前：仍是「数据截至」，圆点转陈旧档", () => {
    const { container } = render(
      <FreshnessBadge now={NOW} lastRecordAt={NOW - 12 * MIN} lastScanAt={NOW - 12 * MIN} />
    );
    const badge = badgeOf(container);
    expect(badge.textContent).toBe("数据截至 14:20（12 分钟前）");
    expect(badge.dataset.state).toBe("stale");
  });

  it("超过 1 小时：圆点用最重的一档", () => {
    const { container } = render(
      <FreshnessBadge now={NOW} lastRecordAt={NOW - 90 * MIN} lastScanAt={NOW - 90 * MIN} />
    );
    expect(badgeOf(container).dataset.state).toBe("old");
  });

  it("没有任何记录：写「暂无数据」，不编一个更新时间", () => {
    const { container } = render(
      <FreshnessBadge now={NOW} lastRecordAt={null} lastScanAt={null} />
    );
    const badge = badgeOf(container);
    expect(badge.textContent).toBe("暂无数据");
    expect(badge.dataset.state).toBe("unknown");
  });

  it("59 分钟 → 分钟；60 分钟 → 小时（分档边界不重复也不跳档）", () => {
    const at59 = render(
      <FreshnessBadge now={NOW} lastRecordAt={NOW - 59 * MIN} lastScanAt={NOW - 59 * MIN} />
    );
    expect(badgeOf(at59.container).textContent).toBe("数据截至 13:33（59 分钟前）");

    const at60 = render(
      <FreshnessBadge now={NOW} lastRecordAt={NOW - 60 * MIN} lastScanAt={NOW - 60 * MIN} />
    );
    expect(badgeOf(at60.container).textContent).toBe("数据截至 13:32（1 小时前）");
  });

  it("23 小时 → 小时；24 小时 → 天", () => {
    const at23 = render(
      <FreshnessBadge now={NOW} lastRecordAt={NOW - 23 * 60 * MIN} lastScanAt={NOW - 23 * 60 * MIN} />
    );
    expect(badgeOf(at23.container).textContent).toBe("数据截至 15:32（23 小时前）");

    const at24 = render(
      <FreshnessBadge now={NOW} lastRecordAt={NOW - 24 * 60 * MIN} lastScanAt={NOW - 24 * 60 * MIN} />
    );
    expect(badgeOf(at24.container).textContent).toBe("数据截至 14:32（1 天前）");
  });

  it("6 天 → 天；7 天 → 日期（同年只写 M-D）", () => {
    const at6 = render(
      <FreshnessBadge
        now={NOW}
        lastRecordAt={NOW - 6 * 24 * 60 * MIN}
        lastScanAt={NOW - 6 * 24 * 60 * MIN}
      />
    );
    expect(badgeOf(at6.container).textContent).toBe("数据截至 14:32（6 天前）");

    // 2026-01-05 往前 7 天 = 2025-12-29（跨年，补全年份）。
    const at7 = render(
      <FreshnessBadge
        now={NOW}
        lastRecordAt={NOW - 7 * 24 * 60 * MIN}
        lastScanAt={NOW - 7 * 24 * 60 * MIN}
      />
    );
    expect(badgeOf(at7.container).textContent).toBe("数据截至 14:32（2025-12-29）");
  });

  it("更旧但仍在同一年：只写 M-D，不再写分钟", () => {
    // 3 月 20 日看 2 月 1 日的数据：同年、超过 7 天，走日期分支。
    const laterNow = new Date(2026, 2, 20, 14, 32, 0, 0).getTime();
    const lastRecordAt = new Date(2026, 1, 1, 9, 0, 0, 0).getTime();
    const { container } = render(
      <FreshnessBadge now={laterNow} lastRecordAt={lastRecordAt} lastScanAt={lastRecordAt} />
    );
    expect(badgeOf(container).textContent).toBe("数据截至 09:00（2-1）");
  });

  it("扫描中：不显示假的「数据截至」，写刷新中与上次时刻", () => {
    const { container } = render(
      <FreshnessBadge
        now={NOW}
        lastRecordAt={NOW - 20 * MIN}
        lastScanAt={NOW - 1 * MIN}
        scanning
      />
    );
    const badge = badgeOf(container);
    expect(badge.textContent).toBe("刷新中…（上次 14:31）");
    expect(badge.dataset.state).toBe("scanning");
  });
});
