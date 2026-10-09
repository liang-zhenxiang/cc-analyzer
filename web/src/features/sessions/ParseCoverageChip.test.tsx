import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { NotificationProvider } from "../../app/NotificationProvider";
import { ParseCoverageChip, buildCoverageReport, unrecognizedLineCount } from "./ParseCoverageChip";
import type { ParseCoverage } from "./types";

function coverage(over: Partial<ParseCoverage> = {}): ParseCoverage {
  return {
    totalLines: 12_431,
    unparsableLines: 0,
    unknownTypeCounts: {},
    ...over
  };
}

/** Esc / 外点关闭是窗口级监听，chip 必须真的挂在树上才测得到。 */
function Host({ data }: { data: ParseCoverage }) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    // notify 走 NotificationProvider——组件里复制成功/失败的反馈都从它出。
    <NotificationProvider>
      <ParseCoverageChip
        coverage={data}
        sessionLabel="compact-demo"
        clipboard={{
          writeText: (text) => {
            setCopied(text);
            return Promise.resolve();
          }
        }}
      />
      {copied !== null ? <output aria-label="剪贴板结果">{copied}</output> : null}
    </NotificationProvider>
  );
}

describe("unrecognizedLineCount", () => {
  it("sums unknown type counts plus unparsable lines", () => {
    expect(
      unrecognizedLineCount(coverage({ unknownTypeCounts: { "atis-latch": 8, mode: 2 }, unparsableLines: 3 }))
    ).toBe(13);
  });
});

describe("buildCoverageReport", () => {
  it("lists every type with its count under the session's short label", () => {
    const report = buildCoverageReport(
      coverage({ unknownTypeCounts: { "future-widget": 2, "quantum-latch": 1 }, unparsableLines: 1 }),
      "compact-demo"
    );
    expect(report).toContain("会话: compact-demo");
    expect(report).toContain("future-widget: 2");
    expect(report).toContain("quantum-latch: 1");
    expect(report).toContain("无法解析的行数: 1");
  });

  it("carries no absolute paths (privacy red line)", () => {
    const report = buildCoverageReport(
      coverage({ unknownTypeCounts: { "atis-latch": 8 } }),
      "compact-demo"
    );
    // 报告只进剪贴板、不上传、不落盘；绝对路径（用户目录）一律不得出现。
    expect(report).not.toContain("/Users/");
    expect(report).not.toContain("/home/");
    expect(report).not.toContain(".jsonl");
  });
});

describe("ParseCoverageChip", () => {
  it("renders nothing when every line was understood (M = 0)", () => {
    const { container } = render(
      <Host data={coverage({ totalLines: 100, unparsableLines: 0, unknownTypeCounts: {} })} />
    );
    expect(container.textContent).toBe("");
  });

  it("shows the amber-dot chip and opens the distribution popover", async () => {
    const user = userEvent.setup();
    render(
      <Host
        data={coverage({
          unknownTypeCounts: { "future-widget": 2, "quantum-latch": 1 },
          unparsableLines: 1
        })}
      />
    );

    const chip = screen.getByRole("button", { name: "4 行未识别" });
    expect(chip).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(chip);

    const popover = screen.getByRole("dialog", { name: "解析覆盖率" });
    expect(popover).toHaveTextContent("本会话 12,431 行中 4 行");
    expect(popover).toHaveTextContent("future-widget");
    expect(popover).toHaveTextContent("2");
    expect(popover).toHaveTextContent("（无法解析的行）");
  });

  it("copies the report to the clipboard and nothing else", async () => {
    const user = userEvent.setup();
    render(
      <Host data={coverage({ unknownTypeCounts: { "future-widget": 2 }, unparsableLines: 0 })} />
    );

    await user.click(screen.getByRole("button", { name: "2 行未识别" }));
    await user.click(screen.getByRole("button", { name: "复制报告" }));

    const clipboard = await screen.findByLabelText("剪贴板结果");
    expect(clipboard.textContent).toContain("future-widget: 2");
    expect(clipboard.textContent).not.toContain("/Users/");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Host data={coverage({ unknownTypeCounts: { "future-widget": 2 } })} />);

    const chip = screen.getByRole("button", { name: "2 行未识别" });
    await user.click(chip);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chip).toHaveFocus();
  });
});
