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
