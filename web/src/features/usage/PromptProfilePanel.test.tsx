import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { PromptProfilePanel } from "./PromptProfilePanel";

const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime();
const MIN = 60_000;

let seq = 0;
function userMessage(
  text: string,
  at = NOW - 30 * MIN,
  patch: Partial<SessionRecord> = {}
): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "user",
    timestamp: at,
    durationMs: 0,
    text,
    isError: false,
    raw: {},
    ...patch
  };
}

function input(records: SessionRecord[]): UsageSessionInput {
  return { projectLabel: "p", records };
}

describe("PromptProfilePanel（I5 提问画像）", () => {
  it("三个指标与长度示意条都按模型读数渲染", () => {
    render(
      <PromptProfilePanel
        inputs={[
          input([
            userMessage("一二三"),
            userMessage("四五六七"),
            userMessage("八九十十一"),
            userMessage("```ts\nconst a = 1;\n```")
          ])
        ]}
        days={7}
        now={NOW}
      />
    );

    // 长度 3/4/5/20 码位 → 中位 (4+5)/2 = 4.5，四舍五入 5。
    expect(screen.getByText("提问长度中位 5 字")).toBeInTheDocument();
    expect(screen.getByText("含代码块 25.0%")).toBeInTheDocument();
    // 代码围栏整体剔除后只剩下汉字 → 中文占比 100%。
    expect(screen.getByText("中文汉字占 100.0%")).toBeInTheDocument();

    const mini = document.querySelector('[role="img"][aria-label="提问长度分布"]');
    expect(mini).not.toBeNull();
    expect(mini?.children).toHaveLength(5);
    expect(screen.getByText(/只统计用户消息/)).toBeInTheDocument();
  });

  it("少于 3 条只给三指标并写明「先看个大概」，不画迷你条", () => {
    render(
      <PromptProfilePanel
        inputs={[input([userMessage("你好"), userMessage("在吗")])]}
        days={7}
        now={NOW}
      />
    );

    expect(screen.getByText("只有 2 条提问，先看个大概")).toBeInTheDocument();
    expect(document.querySelector('[role="img"][aria-label="提问长度分布"]')).toBeNull();
  });

  it("窗口里没有用户消息时整卡一句空态", () => {
    render(<PromptProfilePanel inputs={[]} days={7} now={NOW} />);
    expect(screen.getByText("这个窗口里没有用户消息")).toBeInTheDocument();
  });

  it("压缩摘要不是用户提问，助手消息也不计入", () => {
    render(
      <PromptProfilePanel
        inputs={[
          input([
            userMessage("一"),
            userMessage("二"),
            userMessage("三"),
            userMessage("摘要", NOW - 30 * MIN, { compactSummary: true }),
            { ...userMessage("assistant 的话"), kind: "assistant" }
          ])
        ]}
        days={7}
        now={NOW}
      />
    );

    expect(screen.getByText(/共 3 条。/)).toBeInTheDocument();
  });
});
