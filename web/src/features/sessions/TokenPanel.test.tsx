import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokenPanel } from "./TokenPanel";
import { parseJsonlText } from "./parseJsonl";
import type { SessionRecord, SessionUsage } from "./types";

import tokenFixture from "../../../tests/fixtures/session-token-usage.jsonl?raw";

function usageRecord(usage: SessionUsage, id: string): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp: 0,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    usage
  };
}

function panelOf(records: SessionRecord[]) {
  render(<TokenPanel records={records} />);
  return screen.getByRole("region", { name: "Token 计数" });
}

describe("TokenPanel", () => {
  it("shows the four counters as four rows, never as one number", () => {
    const session = parseJsonlText(tokenFixture, "/tmp/session-token-usage.jsonl");
    const panel = panelOf(session.records);

    const rows = within(panel)
      .getAllByRole("row")
      .slice(1) // drop the header row
      .map((row) => row.textContent ?? "");

    expect(rows).toHaveLength(6);
    expect(rows[0]).toContain("输入");
    expect(rows[0]).toContain("usage.input_tokens");
    expect(rows[0]).toContain("330");
    expect(rows[1]).toContain("缓存写入");
    expect(rows[1]).toContain("usage.cache_creation_input_tokens");
    expect(rows[1]).toContain("1,500");
    expect(rows[4]).toContain("缓存读取");
    expect(rows[4]).toContain("50,000");
    expect(rows[5]).toContain("输出");
    expect(rows[5]).toContain("120");
    // The sum is the share denominator only; printing it would give a number
    // that means nothing (50,000 cache reads plus 120 output tokens).
    expect(within(panel).queryByText("51,950")).not.toBeInTheDocument();
  });

  it("splits cache creation into the two TTL tiers, indented under it", () => {
    const session = parseJsonlText(tokenFixture, "/tmp/session-token-usage.jsonl");
    const panel = panelOf(session.records);

    const fiveMinute = within(panel).getByText("5 分钟 TTL").closest("tr")!;
    const oneHour = within(panel).getByText("1 小时 TTL").closest("tr")!;

    expect(fiveMinute).toHaveTextContent("usage.cache_creation.ephemeral_5m_input_tokens");
    // 600 reported + the 500 the second call left unsplit.
    expect(fiveMinute).toHaveTextContent("1,100");
    expect(oneHour).toHaveTextContent("usage.cache_creation.ephemeral_1h_input_tokens");
    expect(oneHour).toHaveTextContent("400");
    // The sub-rows are a breakdown of the row above them, so they carry no share
    // of the session total — a second denominator would be silent and wrong.
    expect(fiveMinute.lastElementChild?.textContent).toBe("");
    expect(oneHour.lastElementChild?.textContent).toBe("");
  });

  it("hides the TTL tiers when the session wrote no cache", () => {
    const panel = panelOf([
      usageRecord({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 10 }, "no-cache")
    ]);

    expect(within(panel).queryByText("5 分钟 TTL")).not.toBeInTheDocument();
    expect(within(panel).queryByText("1 小时 TTL")).not.toBeInTheDocument();
    // Only the four counters remain, still separate.
    expect(within(panel).getAllByRole("row")).toHaveLength(5);
  });

  it("says the cost is unknown instead of showing a zero or a blank", () => {
    const panel = panelOf([usageRecord({ inputTokens: 5, outputTokens: 2 }, "small")]);

    expect(within(panel).getByText("成本未知 · 未收录该模型定价")).toBeInTheDocument();
    expect(within(panel).getByText("来源：日志 message.usage（读取，非估算）")).toBeInTheDocument();
  });

  it("distinguishes an empty session from an unlisted model", () => {
    const panel = panelOf([]);

    expect(within(panel).getByText("成本未知 · 本次会话没有 token 记录")).toBeInTheDocument();
  });

  it("states whether subagent sessions are counted", () => {
    const session = parseJsonlText(tokenFixture, "/tmp/session-token-usage.jsonl");
    const { unmount } = render(<TokenPanel records={session.records} />);
    // 整段比对：两句之间不该被 JSX 塞进一个空格。
    expect(screen.getByRole("region", { name: "Token 计数" }).querySelector("p")).toHaveTextContent(
      "口径：本会话主线程；子 agent 会话的用量不计入。数字直接读自日志，未做任何估算。"
    );
    unmount();

    render(<TokenPanel records={session.records} isSubagent />);
    expect(screen.getByRole("region", { name: "Token 计数" })).toHaveTextContent(
      "口径：本子 agent 会话的全部记录。"
    );
  });
});
