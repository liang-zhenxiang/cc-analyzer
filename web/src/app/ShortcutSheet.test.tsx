import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SHORTCUT_GROUPS, ShortcutSheet } from "./ShortcutSheet";

describe("ShortcutSheet", () => {
  test("打开时是一个 aria-modal 对话框，标题可被读出", () => {
    render(<ShortcutSheet open onClose={() => undefined} />);

    const dialog = screen.getByRole("dialog", { name: "键盘速查卡" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-probe")).toBe("shortcut-sheet");
  });

  test("关闭状态不渲染任何东西", () => {
    render(<ShortcutSheet open={false} onClose={() => undefined} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Esc 关闭", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShortcutSheet open onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("点遮罩关闭，点卡片内部不关", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShortcutSheet open onClose={onClose} />);

    await user.click(screen.getByRole("heading", { name: "键盘速查卡" }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("dialog", { name: "键盘速查卡" }).parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Tab 在卡内循环：最后一个往后回到第一个，第一个往前回到最后一个", async () => {
    const user = userEvent.setup();
    render(<ShortcutSheet open onClose={() => undefined} />);

    // 卡内可聚焦的两个：滚动区（tabIndex=0，键盘滚动要有落点）与右上角关闭按钮。
    const scroller = screen.getByLabelText("快捷键分组");
    const closeButton = screen.getByRole("button", { name: "关闭" });

    closeButton.focus();
    await user.tab();
    expect(document.activeElement).toBe(scroller);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(closeButton);

    // 焦点在卡外（例如按钮被禁用后浏览器把它丢给 body）时也要接住：
    // 正向 Tab 落到卡内第一个（关闭按钮在 header 里，DOM 序在前），
    // 反向落到最后一个（滚动区）。与 ExportDialog 的写法逐字一致。
    (document.activeElement as HTMLElement).blur();
    document.body.focus();
    await user.tab();
    expect(document.activeElement).toBe(closeButton);

    (document.activeElement as HTMLElement).blur();
    document.body.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(scroller);
  });

  test("键位表里没有实现不了的东西：无 j/k、无数字键，每条都有代码出处", () => {
    const all = SHORTCUT_GROUPS.flatMap((group) => group.rows);
    expect(all.length).toBe(26);
    for (const row of all) {
      expect(row.keys.length).toBeGreaterThan(0);
      expect(row.description.length).toBeGreaterThan(0);
      // 出处必须是「文件:行号」或「文件:常量」——空字符串和不带冒号的都不行。
      expect(row.source).toMatch(/\.tsx?(:|$)/u);
      for (const key of row.keys) {
        expect(["j", "k", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]).not.toContain(
          key.toLowerCase()
        );
      }
    }
  });

  test("分组标题与行都可读（dl/dt/dd 语义）", () => {
    render(<ShortcutSheet open onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog", { name: "键盘速查卡" });

    expect(within(dialog).getByRole("heading", { name: "全局", level: 3 })).toBeTruthy();
    const groups = dialog.querySelectorAll("dl");
    expect(groups.length).toBe(SHORTCUT_GROUPS.length);
    expect(groups[0].querySelector("dt kbd")?.textContent).toBe("⌘K");
    expect(groups[0].querySelector("dd")?.textContent).toContain("命令面板");
  });
});
