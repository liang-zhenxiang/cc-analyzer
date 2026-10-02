import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThresholdsPanel } from "./ThresholdsPanel";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";

/** 面板现在读 updater 桥（版本与检查），测试给个最简桩。 */
const stubBridges = {
  updater: {
    appVersion: async () => "0.0.0-test",
    checkUpdates: async () => ({ available: false, currentVersion: "0.0.0-test" }),
    relaunch: async () => undefined
  }
} as unknown as Bridges;

function renderPanel() {
  return render(
    <BridgesProvider bridges={stubBridges}>
      <ThresholdsPanel onClose={() => undefined} />
    </BridgesProvider>
  );
}
import { getThresholds, resetThresholds, setThreshold } from "./thresholds";

beforeEach(() => {
  localStorage.clear();
  resetThresholds();
  localStorage.clear();
});

describe("ThresholdsPanel", () => {
  test("shows every budget with its current value and unit", () => {
    renderPanel();

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
    renderPanel();

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
    renderPanel();

    const prompt = screen.getByLabelText("Prompt 上限");
    await user.clear(prompt);
    await user.type(prompt, "128");

    expect(getThresholds().promptBytes).toBe(128 * 1024);
  });

  test("restores the defaults and disables the reset button afterwards", async () => {
    const user = userEvent.setup();
    setThreshold("slowTools", 25);
    renderPanel();

    const reset = screen.getByRole("button", { name: "恢复默认" });
    await user.click(reset);

    expect(getThresholds().slowTools).toBe(10);
    expect(screen.getByLabelText("最慢工具条数")).toHaveValue(10);
    expect(reset).toBeDisabled();
  });

  test("keeps the value when the input is cleared", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.clear(screen.getByLabelText("子 agent 条数"));

    expect(getThresholds().subagents).toBe(30);
  });

  test("closes through the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <BridgesProvider bridges={stubBridges}>
        <ThresholdsPanel onClose={onClose} />
      </BridgesProvider>
    );

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
