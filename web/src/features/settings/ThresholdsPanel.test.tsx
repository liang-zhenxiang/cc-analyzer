import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThresholdsPanel } from "./ThresholdsPanel";
import { getThresholds, resetThresholds, setThreshold } from "./thresholds";

beforeEach(() => {
  localStorage.clear();
  resetThresholds();
  localStorage.clear();
});

describe("ThresholdsPanel", () => {
  test("shows every budget with its current value and unit", () => {
    render(<ThresholdsPanel onClose={() => undefined} />);

    expect(screen.getByRole("heading", { name: "阈值设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("Prompt 上限")).toHaveValue(96);
    expect(screen.getByLabelText("记录明细行数")).toHaveValue(300);
    expect(screen.getByLabelText("最慢工具条数")).toHaveValue(10);
    expect(screen.getByLabelText("子 agent 条数")).toHaveValue(30);
    expect(screen.getByLabelText("解析分块行数")).toHaveValue(2000);
    expect(screen.getByLabelText("列表窗口行数")).toHaveValue(120);
  });

  test("writes edits through to the store and to storage", async () => {
    const user = userEvent.setup();
    render(<ThresholdsPanel onClose={() => undefined} />);

    const rows = screen.getByLabelText("记录明细行数");
    await user.clear(rows);
    await user.type(rows, "600");

    expect(getThresholds().detailRows).toBe(600);
    expect(JSON.parse(localStorage.getItem("cca-thresholds") ?? "{}")).toMatchObject({
      detailRows: 600
    });
  });

  test("converts the prompt budget between KB and bytes", async () => {
    const user = userEvent.setup();
    render(<ThresholdsPanel onClose={() => undefined} />);

    const prompt = screen.getByLabelText("Prompt 上限");
    await user.clear(prompt);
    await user.type(prompt, "128");

    expect(getThresholds().promptBytes).toBe(128 * 1024);
  });

  test("restores the defaults and disables the reset button afterwards", async () => {
    const user = userEvent.setup();
    setThreshold("slowTools", 25);
    render(<ThresholdsPanel onClose={() => undefined} />);

    const reset = screen.getByRole("button", { name: "恢复默认" });
    await user.click(reset);

    expect(getThresholds().slowTools).toBe(10);
    expect(screen.getByLabelText("最慢工具条数")).toHaveValue(10);
    expect(reset).toBeDisabled();
  });

  test("keeps the value when the input is cleared", async () => {
    const user = userEvent.setup();
    render(<ThresholdsPanel onClose={() => undefined} />);

    await user.clear(screen.getByLabelText("子 agent 条数"));

    expect(getThresholds().subagents).toBe(30);
  });

  test("closes through the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ThresholdsPanel onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
