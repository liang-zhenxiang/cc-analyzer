import { useCallback, useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { focusRowIn, useRowNavigation } from "./useRowNavigation";

function Probe({ count, onActivate }: { count: number; onActivate: (index: number) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusRow = useCallback((index: number) => {
    focusRowIn(containerRef.current, "[data-testid='row']", index);
  }, []);
  const { activeIndex, setActiveIndex, onKeyDown } = useRowNavigation({ count, onActivate, focusRow });
  return (
    <div ref={containerRef} onKeyDown={onKeyDown} data-testid="root">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          data-testid="row"
          data-row-index={index}
          tabIndex={index === activeIndex ? 0 : -1}
          onFocus={() => setActiveIndex(index)}
        >
          行 {index}
        </div>
      ))}
    </div>
  );
}

function keys(target: Element, key: string) {
  return fireEvent.keyDown(target, { key });
}

describe("useRowNavigation", () => {
  it("↓ 与 ↑ 移动焦点行，Enter 激活当前行", () => {
    const activate = vi.fn();
    render(<Probe count={3} onActivate={activate} />);
    const root = screen.getByTestId("root");
    const rows = screen.getAllByTestId("row");

    keys(root, "ArrowDown");
    expect(rows[0]).not.toHaveFocus();
    expect(document.activeElement).toBe(rows[1]);

    keys(root, "ArrowUp");
    expect(document.activeElement).toBe(rows[0]);

    keys(root, "Enter");
    expect(activate).toHaveBeenCalledWith(0);
  });

  it("Home/End 跳到首末行，边界处 ↓/↑ 不越界", () => {
    const activate = vi.fn();
    render(<Probe count={3} onActivate={activate} />);
    const root = screen.getByTestId("root");
    const rows = screen.getAllByTestId("row");

    keys(root, "End");
    expect(document.activeElement).toBe(rows[2]);
    keys(root, "ArrowDown");
    expect(document.activeElement).toBe(rows[2]);

    keys(root, "Home");
    expect(document.activeElement).toBe(rows[0]);
    keys(root, "ArrowUp");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("Space 也激活（并阻止页面滚动）", () => {
    const activate = vi.fn();
    render(<Probe count={1} onActivate={activate} />);
    const root = screen.getByTestId("root");
    // fireEvent 对可取消事件返回「是否未被取消」：preventDefault 生效时为 false。
    const notCancelled = keys(root, " ");
    expect(activate).toHaveBeenCalledWith(0);
    expect(notCancelled).toBe(false);
  });

  it("count 为 0 时不响应任何键", () => {
    const activate = vi.fn();
    render(<Probe count={0} onActivate={activate} />);
    const root = screen.getByTestId("root");
    keys(root, "ArrowDown");
    keys(root, "Enter");
    expect(activate).not.toHaveBeenCalled();
  });
});
