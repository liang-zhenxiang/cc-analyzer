import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { ConstellationPanel } from "./ConstellationPanel";
import type { UsageSessionInput } from "./usageAggregations";

/** 本地周四中午：7 天窗口。夹具在窗口内，组件测试不碰文件系统。 */
const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const HOUR = 3_600_000;

function record(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "r",
    fullId: "r",
    kind: "assistant",
    timestamp: NOW,
    durationMs: 0,
    text: "",
    isError: false,
    raw: null,
    ...partial
  };
}

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

const ALPHA = meta("/tmp/alpha.jsonl", "Alpha 会话");
const BETA = meta("/tmp/beta.jsonl", "Beta 会话");

function inputsFixture(): UsageSessionInput[] {
  return [
    {
      projectLabel: "-repo-alpha",
      projectPath: "/Users/tester/work/alpha",
      session: ALPHA,
      records: [
        record({ id: "a1", kind: "user", timestamp: NOW - 3 * HOUR }),
        record({
          id: "a2",
          timestamp: NOW - 3 * HOUR + 60_000,
          model: "claude-sonnet-4-5-20250929",
          usage: { inputTokens: 100 }
        })
      ]
    },
    {
      projectLabel: "-repo-beta",
      projectPath: "/Users/tester/work/beta",
      session: BETA,
      records: [
        record({
          id: "b1",
          timestamp: NOW - 2 * HOUR,
          model: "claude-haiku-4-5-20251001",
          usage: { inputTokens: 50 }
        })
      ]
    }
  ];
}

describe("ConstellationPanel", () => {
  it("renders the panel title and one descriptive image for the galaxy", () => {
    const container = render(
      <ConstellationPanel inputs={inputsFixture()} days={7} now={NOW} />
    ).container;

    expect(screen.getByRole("heading", { name: "会话星系", level: 3 })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /^会话星系：近 7 天 2 个会话、2 个项目/ })
    ).toBeInTheDocument();
    expect(container.querySelector('[data-probe="lab-galaxy"]')).not.toBeNull();
  });

  it("labels every lane, star and model legend", () => {
    const container = render(
      <ConstellationPanel inputs={inputsFixture()} days={7} now={NOW} />
    ).container;

    const svgTexts = Array.from(container.querySelectorAll("svg text")).map(
      (node) => node.textContent
    );
    expect(svgTexts).toContain("alpha");
    expect(svgTexts).toContain("beta");
    expect(screen.getByText("Sonnet 4.5")).toBeInTheDocument();
    expect(screen.getByText("Haiku 4.5")).toBeInTheDocument();

    const stars = container.querySelectorAll("[data-constellation-star]");
    expect(stars).toHaveLength(2);
    const alphaStar = container.querySelector('[data-constellation-star="path:/tmp/alpha.jsonl"]');
    expect(alphaStar?.querySelector("title")?.textContent).toContain(
      "alpha · Alpha 会话 · "
    );
    expect(alphaStar?.querySelector("title")?.textContent).toContain("100 token · Sonnet 4.5");
  });

  it("raises the hovered star and clears the state on leave", () => {
    const container = render(
      <ConstellationPanel inputs={inputsFixture()} days={7} now={NOW} />
    ).container;
    const star = container.querySelector<SVGCircleElement>(
      '[data-constellation-star="path:/tmp/alpha.jsonl"]'
    );
    expect(star).not.toBeNull();
    const radius = star?.getAttribute("r");

    fireEvent.mouseEnter(star as SVGCircleElement);
    expect(star?.getAttribute("data-constellation-hovered")).toBe("true");
    expect(Number(star?.getAttribute("r"))).toBeGreaterThan(Number(radius));

    fireEvent.mouseLeave(star as SVGCircleElement);
    expect(star?.getAttribute("data-constellation-hovered")).toBeNull();
  });

  it("opens a session from the heaviest list", () => {
    const onOpenSession = vi.fn();
    render(
      <ConstellationPanel
        inputs={inputsFixture()}
        days={7}
        now={NOW}
        onOpenSession={onOpenSession}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Alpha 会话/ }));
    expect(onOpenSession).toHaveBeenCalledWith(ALPHA);
  });

  it("says so when the window holds a single session", () => {
    render(
      <ConstellationPanel inputs={[inputsFixture()[0]]} days={7} now={NOW} />
    );
    expect(screen.getByText("本窗口只有 1 个会话")).toBeInTheDocument();
  });

  it("falls back to an inline empty state for an empty window", () => {
    const container = render(<ConstellationPanel inputs={[]} days={7} now={NOW} />).container;
    expect(screen.getByText("所选范围内没有会话")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /会话星系/ })).toBeNull();
    expect(container.querySelector('[data-probe="lab-galaxy"]')).not.toBeNull();
  });
});
