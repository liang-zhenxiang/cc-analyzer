import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionQueryBar } from "./SessionQueryBar";
import type { SessionMeta } from "./metadataCache";
import type { SessionQuery } from "../usage/sessionQuery";

function meta(overrides: Partial<SessionMeta> & Pick<SessionMeta, "path">): SessionMeta {
  return {
    projectLabel: "/repo/alpha",
    mtimeMs: 100,
    sizeBytes: 10,
    hasRecords: true,
    ...overrides
  };
}

const facts = {
  models: ["claude-sonnet-4-5"],
  tools: ["builtin:Bash", "builtin:Read"],
  ctxPeak: 120_000,
  errors: 2,
  durationMs: 30 * 60_000,
  messages: 8
};

const sessions: SessionMeta[] = [
  meta({
    path: "/repo/alpha/one.jsonl",
    metadataStatus: "complete",
    facts
  }),
  meta({ path: "/repo/beta/two.jsonl", metadataStatus: "pending" })
];

function renderBar(query: SessionQuery = {}, onChange = vi.fn(), list = sessions) {
  render(<SessionQueryBar sessions={list} query={query} onChange={onChange} />);
  return onChange;
}

describe("SessionQueryBar", () => {
  it("收起态只露一行，展开后 aria-expanded 与六个条件一起出现", async () => {
    const user = userEvent.setup();
    renderBar();

    const toggle = screen.getByRole("button", { name: /筛选会话/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const body = document.querySelector('[data-probe="session-query-body"]');
    expect(body).not.toBeNull();
    expect(within(body as HTMLElement).getByText("项目")).toBeInTheDocument();
    expect(within(body as HTMLElement).getByText("模型")).toBeInTheDocument();
    expect(within(body as HTMLElement).getByText("上下文峰值")).toBeInTheDocument();
    expect(within(body as HTMLElement).getByText("工具")).toBeInTheDocument();
    expect(within(body as HTMLElement).getByText("错误")).toBeInTheDocument();
    expect(within(body as HTMLElement).getByText("时长")).toBeInTheDocument();
  });

  it("勾选项目后把 projects 交给上层（多选，不清掉其它条件）", async () => {
    const user = userEvent.setup();
    const onChange = renderBar({ minContextPeak: 100_000 });

    await user.click(screen.getByRole("button", { name: /筛选/ }));
    await user.click(screen.getByRole("button", { name: /项目：全部项目/ }));
    await user.click(screen.getByRole("checkbox", { name: /\/repo\/alpha/ }));

    expect(onChange).toHaveBeenLastCalledWith({
      minContextPeak: 100_000,
      projects: ["/repo/alpha"]
    });
  });

  it("模型多选按 formatModelId 显示名字，不暴露原始 id", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: /筛选会话/ }));
    await user.click(screen.getByRole("button", { name: /模型：全部模型/ }));

    const box = screen.getByRole("listbox", { name: "模型" });
    expect(within(box).getByText("Sonnet 4.5")).toBeInTheDocument();
    expect(within(box).queryByText("claude-sonnet-4-5")).toBeNull();
  });

  it("有 N 个条件时标题带徽标，清空按钮可用并回传空条件", async () => {
    const user = userEvent.setup();
    const onChange = renderBar({ projects: ["/repo/alpha"], hasError: true });

    const head = screen.getByRole("button", { name: /筛选：2 个条件 · 编辑/ });
    expect(within(head).getByLabelText("已生效 2 个条件")).toHaveTextContent("2");

    await user.click(head);
    const clear = screen.getByRole("button", { name: "清空" });
    expect(clear).not.toBeDisabled();
    await user.click(clear);
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("无条件下清空禁用；未索引会话给「已索引 1/2」而不是假装不匹配", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: /筛选会话/ }));
    expect(screen.getByRole("button", { name: "清空" })).toBeDisabled();
    expect(screen.getByText("已索引 1/2 个会话")).toBeInTheDocument();
  });

  it("索引中断时按 failed 数报「未参与筛选」，全部未索引时标题直接说明", async () => {
    const user = userEvent.setup();
    const failed = [meta({ path: "/repo/beta/two.jsonl", metadataStatus: "failed" })];
    renderBar({}, vi.fn(), [sessions[0], ...failed]);

    await user.click(screen.getByRole("button", { name: /筛选会话/ }));
    expect(screen.getByText("索引中断，1 个会话未参与筛选")).toBeInTheDocument();
  });

  it("一个会话都没有事实时，收起态标题写「筛选需要先建立索引…」", () => {
    renderBar({}, vi.fn(), [
      meta({ path: "/repo/alpha/one.jsonl", metadataStatus: "pending" })
    ]);
    expect(
      screen.getByRole("button", { name: /筛选需要先建立索引…/ })
    ).toBeInTheDocument();
  });
});
