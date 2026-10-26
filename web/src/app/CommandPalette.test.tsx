import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";
import type { CommandAction } from "./commandRegistry";

const runLight = vi.fn();
const runDark = vi.fn();
const runSearch = vi.fn();

const actions: CommandAction[] = [
  { id: "nav-search", title: "全局搜索", group: "视图", shortcut: "⌘K", run: runSearch },
  { id: "theme-light", title: "主题：浅色", group: "外观", run: runLight },
  { id: "theme-dark", title: "主题：深色", group: "外观", run: runDark },
  {
    id: "export-usage",
    title: "导出用量快照",
    group: "动作",
    disabled: true,
    detail: "需在「用量总览」内导出"
  }
];

function setup(overrides: Partial<ComponentProps<typeof CommandPalette>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <CommandPalette open actions={actions} onClose={onClose} {...overrides} />
  );
  return { onClose, ...utils };
}

const itemTitles = () => screen.getAllByRole("option").map((item) => item.textContent ?? "");

beforeEach(() => {
  runLight.mockClear();
  runDark.mockClear();
  runSearch.mockClear();
});

describe("CommandPalette", () => {
  test("打开后焦点在输入框，全部命令按注册顺序列出", async () => {
    setup();
    const input = screen.getByLabelText("搜索命令");
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "命令面板" })).toBeInTheDocument();
    expect(itemTitles()).toHaveLength(actions.length);
    // 第一条可用命令默认高亮（不可用项不算）。
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", "command-palette-option-nav-search");
  });

  test("输入即过滤；不可用项仍列出并写明「不可用」", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("搜索命令"), "导出");
    expect(itemTitles()).toHaveLength(1);
    const option = screen.getAllByRole("option")[0];
    expect(option).toHaveTextContent("导出用量快照");
    expect(option).toHaveTextContent("不可用");
    // 一条可用命令都没有：没有可高亮项，aria-activedescendant 必须消失。
    expect(screen.getByLabelText("搜索命令")).not.toHaveAttribute("aria-activedescendant");
  });

  test("↓/↑ 移动高亮并跳过不可用项，两端绕回", async () => {
    const user = userEvent.setup();
    setup();
    const input = screen.getByLabelText("搜索命令");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "command-palette-option-theme-light");

    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ArrowUp}");
    // 第一条之上绕到末尾；末条是不可用的「导出用量快照」，于是落在「主题：深色」。
    expect(input).toHaveAttribute("aria-activedescendant", "command-palette-option-theme-dark");
  });

  test("Enter 执行高亮项并关闭面板", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(runLight).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("不可用项按 Enter 不执行、也不关闭", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    await user.type(screen.getByLabelText("搜索命令"), "导出");
    await user.keyboard("{Enter}");

    expect(onClose).not.toHaveBeenCalled();
  });

  test("Esc 关闭面板", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("点击某条命令即执行；点击不可用项什么也不做", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    await user.click(screen.getByRole("option", { name: /主题：深色/ }));
    expect(runDark).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.click(screen.getByRole("option", { name: /导出用量快照/ }));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("无匹配时给「没有匹配的命令」，不留空白列表", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText("搜索命令"), "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("没有匹配的命令")).toBeInTheDocument();
  });

  test("open=false 时不渲染任何浮层", () => {
    render(<CommandPalette open={false} actions={actions} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog", { name: "命令面板" })).toBeNull();
  });
});
