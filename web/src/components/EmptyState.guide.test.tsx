import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

/** H10：三步引导只在 page 档渲染，状态推进由 emptyGuide 模型层算。 */

describe("EmptyState · H10 三步引导", () => {
  it("全空：第一步 current（序号 1 高亮），其余 todo", () => {
    render(
      <EmptyState
        size="page"
        title="还没有会话"
        guide={{ hasDirectory: false, scanComplete: false, sessionCount: 0 }}
      />
    );
    const items = Array.from(document.querySelectorAll('[data-probe="guide-step"]'));
    expect(items).toHaveLength(3);
    expect(items.map((el) => el.getAttribute("data-state"))).toEqual(["current", "todo", "todo"]);
    expect(items[0].getAttribute("data-step-index")).toBe("1");
  });

  it("扫描完成且有会话：前两步 done，第三步 current 收尾", () => {
    render(
      <EmptyState
        size="page"
        title="还没有会话"
        guide={{ hasDirectory: true, scanComplete: true, sessionCount: 5 }}
      />
    );
    const items = Array.from(document.querySelectorAll('[data-probe="guide-step"]'));
    expect(items.map((el) => el.getAttribute("data-state"))).toEqual(["done", "done", "current"]);
    // done 步的序号位置画的是勾（✓），current 画的是序号 3。
    expect(items[0].querySelector('[aria-hidden="true"]')?.textContent).toBe("✓");
    expect(items[2].querySelector('[aria-hidden="true"]')?.textContent).toBe("3");
  });

  it("扫完零会话：第二步仍是 current 且换排查文案", () => {
    render(
      <EmptyState
        size="page"
        title="还没有会话"
        guide={{ hasDirectory: true, scanComplete: true, sessionCount: 0 }}
      />
    );
    const items = Array.from(document.querySelectorAll('[data-probe="guide-step"]'));
    expect(items[1].getAttribute("data-state")).toBe("current");
    expect(items[1].textContent).toContain("没找到会话文件，检查目录");
  });

  it("panel / inline 档传 guide 也不渲染（误用防线）", () => {
    const { container, rerender } = render(
      <EmptyState
        size="panel"
        title="没有匹配的会话"
        guide={{ hasDirectory: true, scanComplete: true, sessionCount: 3 }}
      />
    );
    expect(container.querySelector('[data-probe="empty-steps"]')).toBeNull();
    rerender(
      <EmptyState
        size="inline"
        title="没有数据"
        guide={{ hasDirectory: true, scanComplete: true, sessionCount: 3 }}
      />
    );
    expect(container.querySelector('[data-probe="empty-steps"]')).toBeNull();
  });

  it("page 档不传 guide：不渲染列表（既有调用零变化）", () => {
    render(<EmptyState size="page" title="正在扫描会话列表…" />);
    expect(document.querySelector('[data-probe="empty-steps"]')).toBeNull();
  });
});
