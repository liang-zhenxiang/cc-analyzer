import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { HallOfFamePanel } from "./HallOfFamePanel";
import type { UsageSessionInput } from "./usageAggregations";

/** 本地周四中午：7 天窗口。 */
const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const HOUR = 3_600_000;

function meta(path: string, customTitle: string): SessionMeta {
  return {
    path,
    mtimeMs: NOW,
    sizeBytes: 1,
    projectLabel: "-repo-alpha",
    hasRecords: true,
    customTitle
  };
}

function call(id: string, timestamp: number, inputTokens: number): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    model: "claude-sonnet-4-5-20250929",
    usage: { inputTokens },
    raw: null
  };
}

const ALPHA = meta("/tmp/alpha.jsonl", "Alpha 会话");
const BETA = meta("/tmp/beta.jsonl", "Beta 会话");

function inputsFixture(): UsageSessionInput[] {
  return [
    {
      projectLabel: "-repo-alpha",
      projectPath: "/Users/tester/work/alpha",
      session: ALPHA,
      records: [
        call("a1", NOW - 5 * HOUR, 5_000_000),
        call("a2", NOW - 4 * HOUR, 4_000_000)
      ]
    },
    {
      projectLabel: "-repo-beta",
      projectPath: "/Users/tester/work/beta",
      session: BETA,
      records: [
        call("b1", NOW - 3 * HOUR, 3_000_000),
        call("b2", NOW - 2 * HOUR, 2_000_000),
        call("b3", NOW - HOUR, 1_000_000)
      ]
    }
  ];
}

function twoCallFixture(): UsageSessionInput[] {
  return [
    {
      projectLabel: "-repo-alpha",
      projectPath: "/Users/tester/work/alpha",
      session: ALPHA,
      records: [call("a1", NOW - 2 * HOUR, 2_000_000), call("a2", NOW - HOUR, 1_000_000)]
    }
  ];
}

describe("HallOfFamePanel", () => {
  it("renders the podium and the rest of the top ten", () => {
    const container = render(
      <HallOfFamePanel inputs={inputsFixture()} days={7} now={NOW} />
    ).container;

    expect(screen.getByRole("heading", { name: "最贵时刻", level: 3 })).toBeInTheDocument();
    expect(container.querySelector('[data-probe="lab-hall"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-hall-entry^="podium-"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-hall-entry^="rank-"]')).toHaveLength(2);
    expect(container.querySelector('[data-hall-entry="podium-1"]')?.textContent).toContain(
      "$15.00"
    );
    expect(container.querySelector('[data-hall-entry="rank-4"]')?.textContent).toContain(
      "Beta 会话"
    );
    expect(screen.getByText(/5 次调用/)).toBeInTheDocument();
  });

  it("exposes a full label on every entry and opens its session", () => {
    const onOpenSession = vi.fn();
    const container = render(
      <HallOfFamePanel
        inputs={inputsFixture()}
        days={7}
        now={NOW}
        onOpenSession={onOpenSession}
      />
    ).container;

    const first = container.querySelector<HTMLButtonElement>('[data-hall-entry="podium-1"]');
    expect(first?.getAttribute("aria-label")).toMatch(
      /^第 1 名：Alpha 会话，.+，Sonnet 4\.5，估算 \$15\.00$/
    );

    fireEvent.click(first as HTMLButtonElement);
    expect(onOpenSession).toHaveBeenCalledWith(ALPHA);
  });

  it("opens a runner-up from the list", () => {
    const onOpenSession = vi.fn();
    const container = render(
      <HallOfFamePanel
        inputs={inputsFixture()}
        days={7}
        now={NOW}
        onOpenSession={onOpenSession}
      />
    ).container;

    fireEvent.click(
      container.querySelector('[data-hall-entry="rank-5"]') as HTMLButtonElement
    );
    expect(onOpenSession).toHaveBeenCalledWith(BETA);
  });

  it("does not build a podium for fewer than three calls", () => {
    const container = render(
      <HallOfFamePanel inputs={twoCallFixture()} days={7} now={NOW} />
    ).container;

    expect(screen.getByText("不足 3 次调用，不设领奖台")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-hall-entry^="podium-"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-hall-entry^="rank-"]')).toHaveLength(2);
  });

  it("falls back to an inline empty state and counts unpriced calls", () => {
    const container = render(
      <HallOfFamePanel
        inputs={[
          {
            projectLabel: "-repo-alpha",
            records: [
              {
                ...call("unknown", NOW - HOUR, 0),
                model: "vendor-model",
                usage: { inputTokens: 1_000_000 }
              }
            ]
          }
        ]}
        days={7}
        now={NOW}
      />
    ).container;

    expect(screen.getByText("所选范围内没有可定价的调用")).toBeInTheDocument();
    expect(screen.getByText("另有 1 次调用因模型未定价，未参与排名。")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector('[data-probe="lab-hall"]')).not.toBeNull();
  });
});
