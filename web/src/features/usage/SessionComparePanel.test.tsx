import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { SessionComparePanel } from "./SessionComparePanel";

const NOW = new Date(2026, 0, 15, 12, 0).getTime();

function recordOf(id: string, timestamp: number, usage?: SessionUsage): SessionRecord {
  return {
    id,
    fullId: id,
    kind: usage ? "assistant" : "user",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...(usage ? { usage, model: "claude-sonnet-4-5-20250929" } : {})
  };
}

function inputOf(label: string, tokens: { input: number; output: number }, minutes: number): UsageSessionInput {
  return {
    projectLabel: label,
    records: [
      recordOf(`${label}-u`, NOW - minutes * 60_000),
      recordOf(`${label}-a`, NOW, {
        inputTokens: tokens.input,
        outputTokens: tokens.output
      })
    ]
  };
}

const INPUTS: UsageSessionInput[] = [
  inputOf("alpha", { input: 1_000_000, output: 100_000 }, 60),
  inputOf("beta", { input: 200_000, output: 20_000 }, 30),
  inputOf("gamma", { input: 50_000, output: 0 }, 10)
];

describe("SessionComparePanel（D1 会话对比）", () => {
  it("默认比较 token 最多的两段会话，五项读数逐字落表", () => {
    render(<SessionComparePanel inputs={INPUTS} />);

    expect(screen.getByRole("region", { name: "会话对比" })).toBeInTheDocument();
    const selectA = screen.getByRole("combobox", { name: "会话 A" }) as HTMLSelectElement;
    const selectB = screen.getByRole("combobox", { name: "会话 B" }) as HTMLSelectElement;
    expect(selectA.value).toBe("0");
    expect(selectB.value).toBe("1");
    expect(within(selectA).getByRole("option", { name: "alpha · 1.1M tok" })).toBeInTheDocument();

    // 五行的标签与数值都在（左右各一份）。
    expect(screen.getAllByText("消息")).toHaveLength(2);
    expect(screen.getAllByText("输入 tokens")).toHaveLength(2);
    expect(screen.getAllByText("1.0M")).toHaveLength(1);
    expect(screen.getAllByText("200,000")).toHaveLength(1);
    expect(screen.getAllByText("100,000")).toHaveLength(1);
    expect(screen.getAllByText("60 分")).toHaveLength(1);

    // 差值最大的一维独占一句，且方向由原始读数决定。
    expect(screen.getByText(/tokens差得最多：A 比另一侧多 400%。/)).toBeInTheDocument();
  });

  it("换掉右侧会话后，读数跟着换（不是把两侧写成同一份）", async () => {
    const user = userEvent.setup();
    render(<SessionComparePanel inputs={INPUTS} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "会话 B" }), "2");

    expect(screen.queryByText("200,000")).not.toBeInTheDocument();
    expect(screen.getByText("50,000")).toBeInTheDocument();
    expect(screen.getByText(/tokens差得最多/)).toBeInTheDocument();
  });

  it("同一段会话不能自己跟自己比：对面已选的那一项被禁用", async () => {
    const user = userEvent.setup();
    render(<SessionComparePanel inputs={INPUTS} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "会话 A" }), "2");
    const selectB = screen.getByRole("combobox", { name: "会话 B" });
    expect(within(selectB).getByRole("option", { name: "gamma · 50,000 tok" })).toBeDisabled();
  });

  it("只有一个会话时如实说没有对手，不画空表", () => {
    render(<SessionComparePanel inputs={[INPUTS[0]]} />);

    expect(screen.getByText("本窗口只有 1 个会话，没有对手可比")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("SessionComparePanel · G9 相似会话", () => {
  /** 给会话补 session.path 身份——topKSimilar 靠它排除自身与稳定排序。 */
  function withPath(input: UsageSessionInput, path: string): UsageSessionInput {
    return {
      ...input,
      session: { ...(input.session ?? {}), path, projectLabel: input.projectLabel } as UsageSessionInput["session"]
    };
  }

  /** 同项目、同模型、同量级时长：与 target 相似的配方（展示名靠 customTitle 区分）。 */
  function twinOf(label: string, input: number): UsageSessionInput {
    const base = inputOf("alpha", { input, output: input / 10 }, 50);
    return {
      ...base,
      session: { ...(base.session ?? {}), path: `/logs/${label}.jsonl`, customTitle: label, projectLabel: "alpha" } as UsageSessionInput["session"]
    };
  }

  it("给出最多三条推荐：百分比 + 理由串接 + 会话名", () => {
    const target = withPath(inputOf("alpha", { input: 1_000_000, output: 100_000 }, 60), "/logs/alpha.jsonl");
    const pool = [
      target,
      twinOf("twin-1", 900_000),
      twinOf("twin-2", 800_000),
      twinOf("twin-3", 700_000)
    ];
    render(<SessionComparePanel inputs={pool} />);

    const section = screen.getByText(/相似会话/).closest("section");
    expect(section?.dataset.probe).toBe("compare-similar");
    const items = within(section as HTMLElement).getAllByRole("listitem");
    // pool 只有 3 个候选（自身已排除）→ 三条全列出。
    expect(items).toHaveLength(3);
    // 每条都有百分比读数与至少一条人话理由。
    for (const item of items) {
      expect(within(item).getByText(/^\d+%$/)).toBeInTheDocument();
    }
    // 同项目理由在场（twin 与 target 展示名不同，但 projectLabel 同为 alpha，project facet 相同）。
    expect(within(section as HTMLElement).getAllByText(/同项目/).length).toBeGreaterThan(0);
  });

  it("低分推荐挂「相似度低，仅供参考」角标，而不是被隐藏", () => {
    // 一条强推荐（同项目+同模型+同量级时长，≥0.3）撑起列表，
    // 一条弱推荐（不同项目+不同量级，0.2）留在列表里但挂角标。
    const target = withPath(inputOf("alpha", { input: 1_000_000, output: 100_000 }, 50), "/logs/alpha.jsonl");
    const strong = twinOf("twin-strong", 900_000);
    const weak = withPath(inputOf("omega", { input: 1_000, output: 10 }, 1), "/logs/omega.jsonl");
    render(<SessionComparePanel inputs={[target, strong, weak]} />);

    const section = screen.getByText(/相似会话/).closest("section") as HTMLElement;
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // 弱推荐在场（没被隐藏），只挂角标；角标全局只有一条。
    expect(within(section).getByText("相似度低，仅供参考")).toBeInTheDocument();
    expect(within(items[1]).getByText("相似度低，仅供参考")).toBeInTheDocument();
  });

  it("全部低于门槛时显示一句「没有足够相似的会话」", () => {
    // 项目、模型、工具、时长全部错开：两位候选与 target 的相似度必然为 0。
    const target = withPath(inputOf("alpha", { input: 1_000_000, output: 100_000 }, 600), "/logs/alpha.jsonl");
    const stranger1 = withPath(inputOf("omega", { input: 1_000, output: 10 }, 1), "/logs/o1.jsonl");
    const stranger2 = withPath(inputOf("zeta", { input: 2_000, output: 20 }, 2), "/logs/o2.jsonl");
    render(<SessionComparePanel inputs={[target, stranger1, stranger2]} />);

    // 相似区存在但让位给一句实话，列表一条都不画。
    const section = screen.getByText(/相似会话/).closest("section") as HTMLElement;
    expect(section.dataset.probe).toBe("compare-similar");
    expect(within(section).getByText("没有足够相似的会话")).toBeInTheDocument();
    expect(within(section).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("排除自身：推荐列表里不出现锚点会话 A 自己", async () => {
    const target = withPath(inputOf("alpha", { input: 1_000_000, output: 100_000 }, 60), "/logs/alpha.jsonl");
    const twin = twinOf("twin-1", 900_000);
    const stranger = withPath(inputOf("omega", { input: 1_000, output: 10 }, 1), "/logs/omega.jsonl");
    render(<SessionComparePanel inputs={[target, twin, stranger]} />);

    const section = screen.getByText(/相似会话/).closest("section") as HTMLElement;
    const names = within(section).getAllByRole("listitem").map((li) => li.textContent);
    expect(names.some((t) => t?.includes("alpha"))).toBe(false);

    // 换锚点：A 选 omega 后，推荐应围绕 omega，alpha 可入列但 omega 不在。
    // ranked 按 token 降序：twin 990k 第一、target 1.1M 第一…… omega 最小排最后。
    const selectA = screen.getByRole("combobox", { name: "会话 A" }) as HTMLSelectElement;
    const options = Array.from(selectA.options);
    const omegaIndex = String(options.findIndex((o) => o.textContent?.includes("omega")));
    const user = userEvent.setup();
    await user.selectOptions(selectA, omegaIndex);
    // 切锚点后区域重算：要么给出不含 omega 的推荐，要么诚实空态——
    // 两种都不能出现「omega 推荐它自己」。
    const section2 = screen.getByText(/相似会话/).closest("section") as HTMLElement;
    const items2 = within(section2).queryAllByRole("listitem");
    expect(items2.some((li) => li.textContent?.includes("omega"))).toBe(false);
  });
});
