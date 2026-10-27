import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModelMigrationBars } from "./ModelMigrationBars";
import type { ModelTimelineEntry } from "./modelTimeline";

const DAY = 86_400_000;
const START = new Date(2026, 9, 1).getTime();
const END = new Date(2026, 9, 8).getTime();

function entry(
  model: string,
  firstDay: number,
  lastDay: number,
  tokens = 1000
): ModelTimelineEntry {
  return {
    model,
    first: START + firstDay * DAY + 9 * 3_600_000,
    last: START + lastDay * DAY + 10 * 3_600_000,
    sessions: 1,
    tokens: { input: tokens, output: 0, cacheCreation: 0, cacheRead: 0 }
  };
}

describe("ModelMigrationBars（E6）", () => {
  it("空输入：如实说没有模型使用记录", () => {
    const { container } = render(
      <ModelMigrationBars entries={[]} gapFlags={[]} colors={new Map()} start={START} end={END} />
    );
    expect(container.textContent).toBe("所选范围内还没有模型使用记录");
  });

  it("只有一个模型：说明没有迁移可画，不画一条孤零零的条", () => {
    const { container } = render(
      <ModelMigrationBars
        entries={[entry("alpha", 0, 6)]}
        gapFlags={[]}
        colors={new Map([["alpha", 1]])}
        start={START}
        end={END}
      />
    );
    expect(container.textContent).toBe("所选范围内只有一个模型，没有迁移可画");
    expect(container.querySelector('[data-probe="migration-bar"]')).toBeNull();
  });

  it("多模型：按首次使用排序，换模处一条竖线，回归段画虚线", () => {
    const { container } = render(
      <ModelMigrationBars
        entries={[entry("beta", 4, 6), entry("alpha", 0, 2)]}
        gapFlags={[
          { model: "alpha", from: START + 1 * DAY, to: START + 5 * DAY }
        ]}
        colors={
          new Map([
            ["alpha", 1],
            ["beta", 2]
          ])
        }
        start={START}
        end={END}
      />
    );

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-probe="model-migration"] > div > div')
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("alpha");
    expect(rows[1].textContent).toContain("beta");
    expect(container.querySelectorAll('[data-probe="migration-bar"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-probe="migration-gap"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-probe="migration-handover"]')).toHaveLength(1);

    const label = container.querySelector('[role="img"]')?.getAttribute("aria-label") ?? "";
    expect(label).toBe("模型迁移：alpha 10/1 至 10/3；beta 10/5 至 10/7");
  });

  it("超过 6 个模型：尾部按 token 折进「其他」", () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      entry(`model-${index}`, index, index + 1, 100 * (index + 1))
    );
    const { container } = render(
      <ModelMigrationBars
        entries={entries}
        gapFlags={[]}
        colors={new Map()}
        start={START}
        end={END}
      />
    );
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-probe="model-migration"] > div > div')
    );
    expect(rows).toHaveLength(6);
    // 行序按首次使用（时间轴本身的顺序），所以「其他」落在折入尾部的最早起点，
    // 不一定在最后一行——这里只断言它存在且恰好占一行。
    expect(rows.filter((row) => row.textContent?.includes("其他"))).toHaveLength(1);
  });
});
