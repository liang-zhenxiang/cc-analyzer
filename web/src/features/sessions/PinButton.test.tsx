import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PinButton } from "./PinButton";

describe("PinButton", () => {
  it("is an unpinned toggle by default, named after the action it performs", () => {
    render(<PinButton pinned={false} onToggle={() => undefined} />);

    const button = screen.getByRole("button", { name: "置顶会话" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("data-probe", "pin-toggle");
    expect(button).toHaveAttribute("title", "置顶会话");
  });

  it("reports the pinned state through aria-pressed and the cancel label", () => {
    render(<PinButton pinned onToggle={() => undefined} />);

    const button = screen.getByRole("button", { name: "取消置顶" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "取消置顶");
  });

  it("toggles once per click without bubbling into the session row", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onRow = vi.fn();
    render(
      <div onClick={onRow} role="presentation">
        <PinButton pinned={false} onToggle={onToggle} />
      </div>
    );

    await user.click(screen.getByRole("button", { name: "置顶会话" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });
});
