import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { MultiComparePanel } from "./MultiComparePanel";

const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let seq = 0;
function record(at: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function input(label: string, records: SessionRecord[]): UsageSessionInput {
  return { projectLabel: label, records };
}

const alphaAndBeta: UsageSessionInput[] = [
  input("alpha", [
    record(NOW - HOUR, { kind: "user", text: "改一下" }),
    record(NOW - HOUR, { usage: { inputTokens: 200 } })
  ]),
  input("beta", [record(NOW - 2 * DAY, { usage: { inputTokens: 100 } })])
];

function renderPanel(inputs: readonly UsageSessionInput[] = alphaAndBeta) {
  return render(<MultiComparePanel inputs={inputs} days={7} now={NOW} />);
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-probe="multi-row"]')];
}

describe("MultiComparePanel（I4 多选对照）", () => {
  it("默认选中 token 最多的两个，表格给出原值、份额、冠标与组内差", () => {
    renderPanel();

    const table = document.querySelector('[data-probe="multi-table"]');
    expect(table).not.toBeNull();
    expect(within(table as HTMLElement).getByText("按 项目对照")).toBeInTheDocument();
    expect(rows()).toHaveLength(2);

    const [first, second] = rows();
    expect(within(first!).getByText("alpha")).toBeInTheDocument();
    expect(within(first!).getByText("200")).toBeInTheDocument();
    expect(within(first!).getByText("66.7%")).toBeInTheDocument();
    expect(within(second!).getByText("100")).toBeInTheDocument();
    expect(within(second!).getByText("33.3%")).toBeInTheDocument();

    // 冠标只有一枚，落在 token 更高的那行。
    expect(within(first!).getByText("本组最重")).toBeInTheDocument();
    expect(within(second!).queryByText("本组最重")).toBeNull();

    // spread = (200−100)/200 = 50%。
    expect(screen.getByText(/组内差 50%/)).toBeInTheDocument();
    expect(screen.getByText(/Token 最高：alpha/)).toBeInTheDocument();
  });

  it("取消到只剩一个实体时不出表，提示再选一个", async () => {
    const user = userEvent.setup();
    renderPanel();

    const chips = screen.getAllByRole("button", { name: "alpha" });
    await user.click(chips[0]!);

    expect(document.querySelector('[data-probe="multi-table"]')).toBeNull();
    expect(screen.getByText("再选 1 个就能对照")).toBeInTheDocument();
  });

  it("选到第 4 个后，其余 chip 直接 disabled 并写明上限", async () => {
    const user = userEvent.setup();
    const five = Array.from({ length: 5 }, (_, index) =>
      input(`p${index}`, [record(NOW - HOUR, { usage: { inputTokens: 500 - index * 100 } })])
    );
    renderPanel(five);

    const pick = () =>
      [...document.querySelectorAll<HTMLButtonElement>('[data-probe="multi-chip"]')];

    // 默认已选前两个（p0、p1），再点 p2、p3 补到 4 个。
    await user.click(pick().find((chip) => chip.dataset.entity === "p2")!);
    await user.click(pick().find((chip) => chip.dataset.entity === "p3")!);

    const fourthPlus = pick().filter((chip) => chip.dataset.entity === "p4")[0]!;
    expect(fourthPlus.disabled).toBe(true);
    expect(fourthPlus.getAttribute("title")).toBe("最多选 4 个");
    expect(rows()).toHaveLength(4);
  });

  it("切到模型维度重算；没有该维字段时说「这一维没有读数」", async () => {
    const user = userEvent.setup();
    const inputs = [
      input("alpha", [
        record(NOW - HOUR, { model: "claude-sonnet-4-5-20250929", usage: { inputTokens: 300 } }),
        record(NOW - 2 * HOUR, { model: "claude-opus-4-1-20250805", usage: { inputTokens: 300 } })
      ])
    ];
    renderPanel(inputs);

    await user.click(screen.getByRole("tab", { name: "模型" }));
    const table = document.querySelector('[data-probe="multi-table"]');
    expect(within(table as HTMLElement).getByText("按 模型对照")).toBeInTheDocument();
    expect(within(table as HTMLElement).getByText("claude-sonnet-4-5-20250929")).toBeInTheDocument();

    // 夹具里没有任何 toolName：工具维度应诚实说没有读数，而不是画空表。
    await user.click(screen.getByRole("tab", { name: "工具" }));
    expect(screen.getAllByText("这一维没有读数").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-probe="multi-table"]')).toBeNull();
  });

  it("工具维度不渲染 Token 与占比两列，只留诚实脚注", async () => {
    const user = userEvent.setup();
    renderPanel([
      input("alpha", [
        record(NOW - HOUR, { kind: "tool", toolName: "Bash" }),
        record(NOW - 2 * HOUR, { kind: "tool", toolName: "Read" })
      ]),
      input("beta", [record(NOW - 3 * HOUR, { kind: "tool", toolName: "Bash" })])
    ]);

    await user.click(screen.getByRole("tab", { name: "工具" }));
    const table = document.querySelector('[data-probe="multi-table"]') as HTMLElement;
    expect(table).not.toBeNull();
    expect(within(table).queryByRole("columnheader", { name: "Token" })).toBeNull();
    expect(within(table).queryByRole("columnheader", { name: "Token 占比" })).toBeNull();
    expect(within(table).getByRole("columnheader", { name: "会话" })).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(screen.getByText(/工具维度没有直接的 token 读数。/)).toBeInTheDocument();
    expect(screen.queryByText(/Token 最高：/)).toBeNull();
  });

  it("读数口径：压缩摘要不计消息，错误与活跃天各按记录归集", () => {
    renderPanel([
      input("alpha", [
        record(NOW - HOUR, { kind: "user", text: "问" }),
        record(NOW - HOUR, { kind: "user", compactSummary: true, text: "摘要" }),
        record(NOW - HOUR, { isError: true }), // tool 行也算错误
        record(NOW - 3 * DAY, {})
      ]),
      input("beta", [record(NOW - DAY, {})])
    ]);

    const [alphaRow, betaRow] = rows();
    // alpha：user 1 条（摘要不计）+ assistant 2 条 = 3 条消息；错误 1；活跃天 2。
    const cells = [...alphaRow!.querySelectorAll("td")].map((cell) => cell.textContent);
    expect(cells[2]).toBe("3"); // 消息
    expect(cells[3]).toBe("1"); // 错误
    expect(cells[4]).toBe("2"); // 活跃天
    // beta 五个读数：token 0 / 会话 1 / 消息 1 / 错误 0 / 活跃天 1。
    const betaCells = [...betaRow!.querySelectorAll("td")].map((cell) => cell.textContent);
    expect(betaCells.slice(0, 5)).toEqual(["0", "1", "1", "0", "1"]);
  });
});
