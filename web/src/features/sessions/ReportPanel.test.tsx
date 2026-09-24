import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportPanel } from "./ReportPanel";
import type { Bridges } from "../../api/types";

test("switches report modes and shows stale warning", async () => {
  const user = userEvent.setup();
  const onModeChange = vi.fn();
  render(
    <ReportPanel
      text="已有报告"
      loading={false}
      error={null}
      stale
      mode="whole"
      onModeChange={onModeChange}
      onGenerate={() => undefined}
      onCancel={() => undefined}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown: vi.fn() } } as unknown as Bridges}
      defaultName="report.md"
    />
  );

  await user.click(screen.getByRole("tab", { name: "筛选后分析" }));
  expect(onModeChange).toHaveBeenCalledWith("filtered");
  expect(screen.getByText("筛选或窗口已变化，建议重新生成")).toBeInTheDocument();
});

test("exports markdown through the dialog bridge", async () => {
  const user = userEvent.setup();
  const saveMarkdown = vi.fn(async () => "/tmp/report.md");
  render(
    <ReportPanel
      text="报告内容"
      loading={false}
      error={null}
      stale={false}
      mode="whole"
      onModeChange={() => undefined}
      onGenerate={() => undefined}
      onCancel={() => undefined}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown } } as unknown as Bridges}
      defaultName="report.md"
    />
  );

  await user.click(screen.getByRole("button", { name: "导出 .md" }));
  expect(saveMarkdown).toHaveBeenCalledWith("report.md", "报告内容");
});

test("shows a visible error when report export fails", async () => {
  const user = userEvent.setup();
  render(
    <ReportPanel
      text="报告内容"
      loading={false}
      error={null}
      stale={false}
      mode="whole"
      onModeChange={() => undefined}
      onGenerate={() => undefined}
      onCancel={() => undefined}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown: vi.fn(async () => { throw new Error("磁盘已满"); }) } } as unknown as Bridges}
      defaultName="report.md"
    />
  );

  await user.click(screen.getByRole("button", { name: "导出 .md" }));

  expect(screen.getByRole("alert")).toHaveTextContent("导出失败: 磁盘已满");
});

test("offers 停止分析 while a report is running", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  render(
    <ReportPanel
      text=""
      loading
      error={null}
      stale={false}
      mode="whole"
      onModeChange={() => undefined}
      onGenerate={() => undefined}
      onCancel={onCancel}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown: vi.fn() } } as unknown as Bridges}
      defaultName="report.md"
    />
  );

  await user.click(screen.getByRole("button", { name: "停止分析" }));
  expect(onCancel).toHaveBeenCalled();
});

test("disables node analysis until a node is selected", () => {
  render(
    <ReportPanel
      text=""
      loading={false}
      error={null}
      stale={false}
      mode="whole"
      onModeChange={() => undefined}
      onGenerate={() => undefined}
      onCancel={() => undefined}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown: vi.fn() } } as unknown as Bridges}
      defaultName="report.md"
      nodeLabel={null}
    />
  );

  expect(screen.getByRole("tab", { name: "节点分析" })).toBeDisabled();
});

test("shows claude session, duration, and cost metadata", () => {
  render(
    <ReportPanel
      text="报告内容"
      loading={false}
      error={null}
      stale={false}
      mode="whole"
      onModeChange={() => undefined}
      onGenerate={() => undefined}
      onCancel={() => undefined}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown: vi.fn() } } as unknown as Bridges}
      defaultName="report.md"
      meta={{ claudeId: "abc-123", durationMs: 12_340, costUsd: 0.0123 }}
    />
  );

  expect(screen.getByText("Claude 会话 abc-123 · 耗时 12.3s · 成本 $0.0123")).toBeInTheDocument();
});

test("renders the report as markdown and shows a placeholder when empty", () => {
  const { unmount } = render(
    <ReportPanel
      text={"## 结论\n\n| 项 | 值 |\n|---|---|\n| 子 agent | 5.00s |"}
      loading={false}
      error={null}
      stale={false}
      mode="whole"
      onModeChange={() => undefined}
      onGenerate={() => undefined}
      onCancel={() => undefined}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown: vi.fn() } } as unknown as Bridges}
      defaultName="report.md"
    />
  );

  expect(screen.getByRole("heading", { name: "结论", level: 2 })).toBeInTheDocument();
  expect(screen.getByRole("table")).toBeInTheDocument();
  unmount();

  render(
    <ReportPanel
      text=""
      loading={false}
      error={null}
      stale={false}
      mode="whole"
      onModeChange={() => undefined}
      onGenerate={() => undefined}
      onCancel={() => undefined}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown: vi.fn() } } as unknown as Bridges}
      defaultName="report.md"
    />
  );

  expect(screen.getByText("选择报告范围后点击生成。")).toBeInTheDocument();
});

test("warns when only the slowest rows are analysed", () => {
  render(
    <ReportPanel
      text=""
      loading={false}
      error={null}
      stale={false}
      mode="filtered"
      onModeChange={() => undefined}
      onGenerate={() => undefined}
      onCancel={() => undefined}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown: vi.fn() } } as unknown as Bridges}
      defaultName="report.md"
      truncated={{ shown: 300, total: 412, limit: 300 }}
    />
  );

  expect(screen.getByText("只分析最慢的 300 条（共 412 条）")).toBeInTheDocument();
});

test("offers continuing the conversation in a claude terminal", async () => {
  const user = userEvent.setup();
  const onOpenTerminal = vi.fn();
  render(
    <ReportPanel
      text=""
      loading={false}
      error={null}
      stale={false}
      mode="whole"
      onModeChange={() => undefined}
      onGenerate={() => undefined}
      onCancel={() => undefined}
      onClear={() => undefined}
      bridges={{ dialog: { saveMarkdown: vi.fn() } } as unknown as Bridges}
      defaultName="report.md"
      onOpenTerminal={onOpenTerminal}
    />
  );

  await user.click(screen.getByRole("button", { name: "打开 claude 终端继续追问" }));
  expect(onOpenTerminal).toHaveBeenCalled();
});

describe("report panel button styling", () => {
  it("keeps primary buttons readable instead of overriding their colours", () => {
    // An enabled-state background override beats the .primary variant on
    // specificity, which left the generate button white-on-white (the label
    // vanished) while the disabled state looked fine.
    const css = readFileSync("src/features/sessions/ReportPanel.module.css", "utf8");
    const rules = css
      .split("}")
      .map((chunk) => chunk.split("{").map((part) => part.trim()))
      .filter(([selector]) => selector.includes("header") && selector.includes("button"));

    expect(rules.length).toBeGreaterThan(0);
    for (const [selector, body = ""] of rules) {
      expect(body).not.toMatch(/(^|[;{\s])background\s*:/);
      expect(body).not.toMatch(/(^|[;{\s])color\s*:/);
      expect(selector).toBeTruthy();
    }
  });
});
