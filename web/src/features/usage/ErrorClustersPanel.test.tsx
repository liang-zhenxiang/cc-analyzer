import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ErrorEvent } from "./errorStats";
import { ErrorClustersPanel } from "./ErrorClustersPanel";

const T0 = new Date(2026, 9, 3, 9, 0, 0).getTime();
const HOUR = 3_600_000;

function eventOf(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    kind: "tool",
    timestamp: T0,
    toolName: "Bash",
    apiStatus: null,
    recordId: "rec-1",
    path: "/logs/a.jsonl",
    projectLabel: "proj",
    preview: "Exit code 1",
    ...overrides
  };
}

function panelOf(events: ErrorEvent[], onRevealRecord?: (path: string, recordId: string | null) => void) {
  return render(<ErrorClustersPanel events={events} onRevealRecord={onRevealRecord} />);
}

describe("ErrorClustersPanel", () => {
  it("folds repeated failures into one row with a count and a time range", async () => {
    const user = userEvent.setup();
    const onRevealRecord = vi.fn();
    panelOf(
      [
        eventOf({ timestamp: T0 + 3 * HOUR, recordId: null, path: "/logs/sidechain.jsonl" }),
        eventOf({ timestamp: T0, recordId: "rec-first", path: "/logs/first.jsonl" }),
        eventOf({ timestamp: T0 + HOUR, recordId: "rec-2" })
      ],
      onRevealRecord
    );

    const rows = screen.getAllByRole("button", { name: /在会话中定位/ });
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Bash");
    expect(rows[0].textContent).toContain("Exit code 1");
    expect(rows[0].textContent).toContain("3 次");
    // 同一天只写时刻。
    expect(rows[0].textContent).toContain("09:00–12:00");

    // 点行回到**最早**那条能定位的事件，而不是最后一次发生的现场。
    await user.click(rows[0]);
    expect(onRevealRecord).toHaveBeenCalledWith("/logs/first.jsonl", "rec-first");
  });

  it("writes the date too once a cluster spans two days", () => {
    panelOf(
      [
        eventOf({ timestamp: T0 }),
        eventOf({ timestamp: T0 + 26 * HOUR, recordId: "rec-2" })
      ],
      vi.fn()
    );
    const row = screen.getByRole("button", { name: /在会话中定位/ });
    expect(row.textContent).toContain("10-03 09:00 – 10-04 11:00");
  });

  it("prints a single stamp for a one-off failure", () => {
    panelOf([eventOf({ timestamp: T0 })], vi.fn());
    const row = screen.getByRole("button", { name: /在会话中定位/ });
    expect(row.textContent).toContain("10-03 09:00");
    expect(row.textContent).not.toContain("–");
  });

  it("labels API failures and keeps them apart from tool failures", () => {
    panelOf(
      [
          eventOf({ timestamp: T0, kind: "api", toolName: undefined, preview: "API Error: 529" }),
        eventOf({ timestamp: T0, preview: "Exit code 1", recordId: "rec-2" })
      ],
      vi.fn()
    );
    const rows = screen.getAllByRole("button", { name: /在会话中定位/ });
    expect(rows).toHaveLength(2);
    const tools = rows.map((row) => row.querySelector('[data-probe="cluster-tool"]')?.textContent);
    expect(tools).toEqual(["API", "Bash"]);
  });

  it("marks a truncated first line with an ellipsis and keeps the full line in the title", () => {
    const longLine = "严重失败：" + "x".repeat(120);
    panelOf([eventOf({ preview: `${longLine}\n  at stack` })]);

    const message = document.querySelector('[data-probe="cluster-message"]') as HTMLElement | null;
    expect(message).not.toBeNull();
    // 80 码点硬切之后补「…」，CSS 的 ellipsis 不再是唯一提示。
    expect(Array.from(message!.textContent ?? "")).toHaveLength(81);
    expect(message!.textContent?.endsWith("…")).toBe(true);
    // 悬停读到的应是原始首行，而不是截断后的字符串。
    expect(message!.getAttribute("title")).toBe(longLine);
  });

  it("does not add an ellipsis when the first line fits", () => {
    panelOf([eventOf({ preview: "Exit code 1" })]);
    const message = document.querySelector('[data-probe="cluster-message"]') as HTMLElement | null;
    expect(message!.textContent).toBe("Exit code 1");
    expect(message!.getAttribute("title")).toBe("Exit code 1");
  });

  it("says so when the window has no errors", () => {
    panelOf([]);
    expect(screen.getByText("窗口内没有错误")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays readable but inert when there is nothing to reveal into", () => {
    panelOf([eventOf({})]);
    const row = screen.getByRole("button", { name: /^错误聚类/ });
    expect(row).toBeDisabled();
  });
});
