import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { WeeklyDigestPanel } from "./WeeklyDigestPanel";

/** 2026-10-19 是周一：本周 = 10/19 起，上周 = 10/12 起。 */
const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime();
const at = (month: number, day: number, hour = 9): number =>
  new Date(2026, month - 1, day, hour, 0, 0).getTime();

function recordOf(timestamp: number, model = "claude-sonnet-4-5", inputTokens = 1_000_000): SessionRecord {
  return {
    id: `r-${timestamp}`,
    fullId: `f-${timestamp}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    model,
    usage: { inputTokens },
    raw: {}
  } as unknown as SessionRecord;
}

function inputOf(...records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel: "-repo-demo" };
}

function rowOf(label: string): HTMLElement {
  const row = screen.getByRole("row", { name: new RegExp(`^${label}`) });
  return row;
}

function renderPanel(inputs: readonly UsageSessionInput[], now = NOW) {
  return render(<WeeklyDigestPanel inputs={inputs} now={now} />);
}

describe("WeeklyDigestPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reads four metrics as this week / last week / change", () => {
    renderPanel([
      inputOf(
        recordOf(at(10, 20), "claude-sonnet-4-5", 3_000_000),
        recordOf(at(10, 13), "claude-sonnet-4-5", 2_000_000)
      )
    ]);

    const tokens = rowOf("Tokens");
    // 3M 对 2M，$9 对 $6：token 与金额都是 +50%。
    expect(within(tokens).getByText("3.0M")).toBeTruthy();
    expect(within(tokens).getByText("2.0M")).toBeTruthy();
    expect(within(tokens).getByText("▲ +50%")).toBeTruthy();

    const usd = rowOf("估算成本");
    expect(within(usd).getByText("$9.00")).toBeTruthy();
    expect(within(usd).getByText("$6.00")).toBeTruthy();
    expect(within(usd).getByText("▲ +50%")).toBeTruthy();
  });

  it("colours a rise as bad news and a fall as good news", () => {
    renderPanel([
      inputOf(
        recordOf(at(10, 20), "claude-sonnet-4-5", 1_000_000),
        recordOf(at(10, 13), "claude-sonnet-4-5", 2_000_000)
      )
    ]);

    // 消耗降了 50% —— 对用户是好消息，用 success 色（不是 danger）。
    const delta = within(rowOf("Tokens")).getByText("▼ -50%");
    expect(delta.getAttribute("data-tone")).toBe("down");
    expect(delta.getAttribute("aria-label")).toContain("减少");
  });

  it("writes an em dash instead of a percentage when last week has no baseline", () => {
    renderPanel([inputOf(recordOf(at(10, 20)))]);
    const row = rowOf("Tokens");
    expect(within(row).getByText("—")).toBeTruthy();
    expect(within(row).getByText("0")).toBeTruthy();
  });

  it("says there is nothing to compare when both weeks are empty", () => {
    renderPanel([]);
    expect(screen.getByText("还没有可对比的周")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("copies the four rows as plain text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderPanel([
      inputOf(
        recordOf(at(10, 20), "claude-sonnet-4-5", 1_000_000),
        recordOf(at(10, 13), "claude-sonnet-4-5", 2_000_000)
      )
    ]);

    await userEvent.click(screen.getByRole("button", { name: "复制战报" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text.split("\n")).toHaveLength(5);
    expect(text.split("\n")[0]).toBe("周战报（10/19 起，本地自然周）");
    expect(text).toContain("Tokens：本周 1.0M · 上周 2.0M · ▼ -50%");
    expect(text).toContain("估算成本：本周 $3.00 · 上周 $6.00 · ▼ -50%");
    expect(await screen.findByText("已复制到剪贴板")).toBeTruthy();
  });

  it("falls back to a visible alert when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true
    });

    renderPanel([inputOf(recordOf(at(10, 20)))]);
    await userEvent.click(screen.getByRole("button", { name: "复制战报" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "复制失败：剪贴板不可用，请手动选中读数复制"
    );
  });

  it("states the week definition instead of leaving it to be guessed", () => {
    renderPanel([inputOf(recordOf(at(10, 20)))]);
    expect(screen.getByText("按本地自然周（周一起始）")).toBeTruthy();
  });
});
