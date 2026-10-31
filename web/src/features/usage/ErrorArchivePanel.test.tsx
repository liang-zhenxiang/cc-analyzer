import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorArchivePanel } from "./ErrorArchivePanel";
import type { ErrorEvent } from "./errorStats";

function toolError(
  timestamp: number,
  toolName: string,
  preview: string,
  path = "/repo/alpha/one.jsonl"
): ErrorEvent {
  return {
    kind: "tool",
    timestamp,
    toolName,
    recordId: `r-${timestamp}`,
    path,
    projectLabel: "/repo/alpha",
    preview
  };
}

const events: ErrorEvent[] = [
  toolError(1_000, "Bash", "ENOENT: /a/missing.ts", "/repo/alpha/one.jsonl"),
  toolError(2_000, "Bash", "ENOENT: /b/other.ts", "/repo/alpha/one.jsonl"),
  toolError(3_000, "Bash", "ENOENT: /c/third.ts", "/repo/beta/two.jsonl"),
  toolError(4_000, "Read", "EACCES: permission denied", "/repo/beta/two.jsonl"),
  toolError(5_000, "Grep", "ripgrep exited 2", "/repo/gamma/three.jsonl")
];

describe("ErrorArchivePanel", () => {
  it("零事件时出整行事实，不出表格", () => {
    render(<ErrorArchivePanel events={[]} />);
    expect(screen.getByText("窗口内没有错误")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("按次数降序、并列按签名升序；同类模板先合并再计数", () => {
    const many: ErrorEvent[] = [
      toolError(1, "Bash", "B 签名"),
      toolError(2, "Bash", "B 签名"),
      toolError(3, "Bash", "B 签名"),
      toolError(4, "Bash", "A 签名"),
      toolError(5, "Bash", "A 签名"),
      toolError(6, "Bash", "A 签名"),
      toolError(7, "Bash", "C 签名")
    ];
    render(<ErrorArchivePanel events={many} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("A 签名")).toBeInTheDocument();
    expect(within(rows[1]).getByText("B 签名")).toBeInTheDocument();
    expect(within(rows[2]).getByText("C 签名")).toBeInTheDocument();
  });

  it("括号里的模板合并同一类：三次 ENOENT 合成一行，会话数按路径去重", () => {
    render(<ErrorArchivePanel events={events} />);
    const rows = screen.getAllByRole("row").slice(1);
    const enoent = rows.find((row) => within(row).queryByText(/ENOENT/));
    expect(enoent).toBeDefined();
    expect(within(enoent as HTMLElement).getByText("ENOENT: <path>")).toBeInTheDocument();
    const cells = within(enoent as HTMLElement).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("3");
    expect(cells[3]).toHaveTextContent("2");
  });

  it("展开后给代表消息与最多 5 个会话，再点收起", async () => {
    const user = userEvent.setup();
    const onRevealRecord = vi.fn();
    render(<ErrorArchivePanel events={events} onRevealRecord={onRevealRecord} />);

    await user.click(screen.getByRole("button", { name: /展开 Bash ENOENT: <path> 的档案/ }));
    const detail = document.querySelector('[data-probe="archive-detail"]') as HTMLElement;
    expect(detail).not.toBeNull();
    expect(within(detail).getByText(/ENOENT: \/a\/missing\.ts/)).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "one.jsonl" })).toBeInTheDocument();

    await user.click(within(detail).getByRole("button", { name: "one.jsonl" }));
    expect(onRevealRecord).toHaveBeenCalledWith("/repo/alpha/one.jsonl", null);

    await user.click(screen.getByRole("button", { name: /收起 Bash ENOENT: <path> 的档案/ }));
    expect(document.querySelector('[data-probe="archive-detail"]')).toBeNull();
  });

  it("超过 5 个会话时尾巴写「另有 N 个会话」", async () => {
    const user = userEvent.setup();
    const wide = Array.from({ length: 7 }, (_, index) =>
      toolError(index, "Read", "EACCES: /x", `/repo/alpha/s${index}.jsonl`)
    );
    render(<ErrorArchivePanel events={wide} />);
    await user.click(screen.getByRole("button", { name: "展开 Read EACCES: /x 的档案" }));
    const detail = document.querySelector('[data-probe="archive-detail"]') as HTMLElement;
    expect(within(detail).getByText("另有 2 个会话")).toBeInTheDocument();
  });
});
