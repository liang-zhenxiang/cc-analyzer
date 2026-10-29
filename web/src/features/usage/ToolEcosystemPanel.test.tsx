import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { ToolBucketKey, ToolCallFact } from "./toolCensus";
import type { UsageSessionInput } from "./usageAggregations";
import { ToolEcosystemPanel } from "./ToolEcosystemPanel";

const NOW = new Date(2026, 9, 28, 12, 0).getTime();

let seq = 0;

function fact(key: ToolBucketKey): ToolCallFact {
  seq += 1;
  return { key, timestamp: NOW - 3_600_000, sidechain: false };
}

const bash = () => fact({ kind: "builtin", toolName: "Bash" });
const read = () => fact({ kind: "builtin", toolName: "Read" });

function metaOf(path: string): SessionMeta {
  return {
    path,
    projectLabel: "-repo-demo",
    mtimeMs: 1,
    sizeBytes: 1,
    hasRecords: true,
    userPrompt: "演示"
  };
}

function inputOf(session: SessionMeta, facts: ToolCallFact[]): UsageSessionInput {
  return { records: [], projectLabel: session.projectLabel, session, toolCalls: facts };
}

/** Bash 与 Read 在两个会话里都出现：一条边、两个节点。 */
const TWO_TOOLS: UsageSessionInput[] = [
  inputOf(metaOf("/a"), [bash(), bash(), read()]),
  inputOf(metaOf("/b"), [bash(), read(), read()])
];

describe("ToolEcosystemPanel", () => {
  it("画出两个节点与一条共现边，摘要与列表给出最强的一对", () => {
    const { container } = render(<ToolEcosystemPanel inputs={TWO_TOOLS} days={30} now={NOW} />);

    expect(container.querySelectorAll('[data-probe="ecosystem-node"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-probe="ecosystem-edge"]')).toHaveLength(1);
    expect(screen.getByRole("img", { name: /Bash 与 Read 在 2 个会话中共现/ })).toBeVisible();
    expect(screen.getByText("Bash ↔ Read")).toBeVisible();
    expect(screen.getByText("2 个会话")).toBeVisible();
    expect(screen.getByText("点击节点可筛选")).toBeVisible();
  });

  it("悬停节点高亮邻居；点击节点筛选列表，清除后恢复", () => {
    const { container } = render(<ToolEcosystemPanel inputs={TWO_TOOLS} days={30} now={NOW} />);

    const bashNode = container.querySelector('[data-tool="builtin:Bash"]')!;
    fireEvent.mouseEnter(bashNode);
    expect(bashNode).toHaveAttribute("data-active", "true");
    fireEvent.mouseLeave(bashNode);
    expect(bashNode).not.toHaveAttribute("data-active");

    fireEvent.click(bashNode);
    expect(bashNode).toHaveAttribute("data-active", "true");
    expect(screen.getByText(/已筛选：Bash/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.queryByText(/已筛选：/)).not.toBeInTheDocument();
    expect(bashNode).not.toHaveAttribute("data-active");
  });

  it("点击同一节点再点一次取消筛选", () => {
    const { container } = render(<ToolEcosystemPanel inputs={TWO_TOOLS} days={30} now={NOW} />);
    const readNode = container.querySelector('[data-tool="builtin:Read"]')!;

    fireEvent.click(readNode);
    expect(screen.getByText(/已筛选：Read/)).toBeVisible();
    fireEvent.click(readNode);
    expect(screen.queryByText(/已筛选：/)).not.toBeInTheDocument();
  });

  it("工具种类不足：空态说明需要至少两种工具", () => {
    render(
      <ToolEcosystemPanel
        inputs={[inputOf(metaOf("/a"), [bash(), bash()])]}
        days={30}
        now={NOW}
      />
    );
    expect(screen.getByText("工具之间还没有重复共现")).toBeVisible();
    expect(screen.getByText(/本窗口只有 1 种工具、1 个会话；共现需要至少两种工具/)).toBeVisible();
  });

  it("有工具但没有重复共现：空态给出会话数与门槛", () => {
    render(
      <ToolEcosystemPanel
        inputs={[inputOf(metaOf("/a"), [bash(), read()])]}
        days={30}
        now={NOW}
      />
    );
    expect(screen.getByText(/本窗口有 2 种工具、1 个会话；共现需要同一对工具在至少 2 个会话里同时出现/)).toBeVisible();
  });

  it("边被截断时脚注报出未画的对数", () => {
    const tools = Array.from({ length: 10 }, (_, index) => `Tool${index}`);
    const session = (path: string) =>
      inputOf(
        metaOf(path),
        tools.map((toolName) => fact({ kind: "builtin", toolName }))
      );
    render(<ToolEcosystemPanel inputs={[session("/a"), session("/b")]} days={30} now={NOW} />);
    expect(screen.getByText(/另有 17 对未画出/)).toBeVisible();
  });
});
