import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TimeCapsule } from "./timeCapsule";
import { TimeCapsuleCard } from "./TimeCapsuleCard";

/**
 * 时间胶囊的组件用例：只钉「模型给的东西有没有原样出现在正确位置」。
 * 日期口径、token 缩写、句子怎么生成都由模型层负责，这里再算一遍会让
 * 回归报告指向错误的地方。
 */

afterEach(cleanup);

function capsule(patch: Partial<TimeCapsule> = {}): TimeCapsule {
  return {
    dayStart: new Date(2025, 10, 12).getTime(),
    label: "一年前的今天",
    sessions: 7,
    tokens: 2_400_000,
    project: "cc-analyzer",
    sentence: "那天的你第一次把用量拆成了可读的格子。",
    ...patch
  };
}

describe("TimeCapsuleCard · 排版", () => {
  it("日期、标签、句子、token 读数与会话数各就各位", () => {
    render(<TimeCapsuleCard capsule={capsule()} />);

    expect(screen.getByRole("region", { name: "时间胶囊" })).toBeInTheDocument();
    // 日期自带年份：胶囊跨年时不能靠上下文补年份。
    expect(screen.getByText("2025-11-12")).toBeInTheDocument();
    expect(screen.getByText("一年前的今天")).toBeInTheDocument();
    expect(
      screen.getByText("那天的你第一次把用量拆成了可读的格子。")
    ).toBeInTheDocument();
    // 2_400_000 → 2.4M（formatTokenCount 的既有口径）。
    expect(screen.getByText("2.4M")).toBeInTheDocument();
    expect(screen.getByText("7 个会话")).toBeInTheDocument();
  });

  it("project 为 null 时不崩溃，也不把 null 渲染成文字", () => {
    render(<TimeCapsuleCard capsule={capsule({ project: null })} />);

    expect(screen.getByText("那天的你第一次把用量拆成了可读的格子。")).toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("长句子在 DOM 里是完整文本，视觉截断不改变可读内容", () => {
    const long = "那天的你把一次跨越三个项目、持续到凌晨的调试拆成了三十七个会话，".repeat(3);
    const { container } = render(<TimeCapsuleCard capsule={capsule({ sentence: long })} />);

    const sentence = screen.getByText(long);
    expect(sentence).toBeInTheDocument();
    // 节点里就是整句，不是带省略号的截断串。
    expect(sentence.textContent).toBe(long);
    expect(container.textContent).not.toContain("…");
  });

  it("卡片不含交互控件：没有按钮就没有焦点环", () => {
    const { container } = render(<TimeCapsuleCard capsule={capsule()} />);

    expect(container.querySelectorAll("button, a, input, select, textarea, [tabindex]")).toHaveLength(
      0
    );
  });
});
