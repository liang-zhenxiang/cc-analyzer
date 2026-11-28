import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HandoffProject } from "./projectHandoff";
import { ProjectSwitchStrip } from "./ProjectSwitchStrip";

/**
 * 切换条是项目档里唯一的项目选择器（Issue #397）：chip 数与项目数一致、
 * `aria-pressed` 正确、点击把 key 交回页面。两张卡共用这个 key 的行为由
 * 页面级测试覆盖。
 */

const PROJECTS: HandoffProject[] = [
  { key: "-work-cc", name: "cc-analyzer", sessions: 12, lastStartTs: 3, unknownSessions: 0 },
  { key: "-work-web", name: "web", sessions: 8, lastStartTs: 2, unknownSessions: 0 },
  { key: "-work-api", name: "api", sessions: 3, lastStartTs: 1, unknownSessions: 1 }
];

afterEach(cleanup);

describe("ProjectSwitchStrip", () => {
  it("渲染一个名为「项目」的组，chip 数与项目数一致", () => {
    render(
      <ProjectSwitchStrip projects={PROJECTS} activeKey="-work-web" onSelect={vi.fn()} />
    );

    const group = screen.getByRole("group", { name: "项目" });
    expect(group).toHaveAttribute("data-probe", "handoff-toolbar");
    expect(group.querySelectorAll("[data-handoff-project]")).toHaveLength(3);
    expect(group.querySelectorAll("button")).toHaveLength(3);
  });

  it("aria-pressed 标出当前项目，会话数是 chip 的第二读数", () => {
    render(
      <ProjectSwitchStrip projects={PROJECTS} activeKey="-work-web" onSelect={vi.fn()} />
    );

    const chips = [...document.querySelectorAll<HTMLButtonElement>("[data-handoff-project]")];
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false"
    ]);
    expect(chips[0]).toHaveTextContent("cc-analyzer");
    expect(chips[0]).toHaveTextContent("12");
    expect(chips[2]).toHaveTextContent("3");
  });

  it("点击 chip 把 project.key 交回页面（不是显示名）", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ProjectSwitchStrip projects={PROJECTS} activeKey="-work-cc" onSelect={onSelect} />
    );

    await user.click(screen.getByRole("button", { name: /web/ }));
    expect(onSelect).toHaveBeenCalledWith("-work-web");
  });

  it("title 只放显示名，不泄露编码目录名", () => {
    render(
      <ProjectSwitchStrip projects={PROJECTS} activeKey="-work-cc" onSelect={vi.fn()} />
    );

    for (const chip of document.querySelectorAll("[data-handoff-project]")) {
      expect(chip.getAttribute("title")).not.toContain("-work-");
    }
    expect(screen.getByRole("button", { name: /cc-analyzer/ })).toHaveAttribute(
      "title",
      "cc-analyzer"
    );
  });

  it("没有项目时整条不渲染", () => {
    const { container } = render(
      <ProjectSwitchStrip projects={[]} activeKey={null} onSelect={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
