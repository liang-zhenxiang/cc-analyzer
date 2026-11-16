import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { ProjectCardsPanel } from "./ProjectCardsPanel";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * F6 项目卡片：每张卡一段读数 + 一条 14 天走势。断言的是卡片上真正写出来的
 * 数字与文案（token、成本、会话/消息、相对时间），不是「渲染了 3 个 div」。
 */

const NOW = new Date(2026, 0, 15, 18, 0).getTime();
const ALPHA = "-work-alpha";
const BETA = "-work-beta";
const ZETA = "-work-zeta";

function at(dayOffset: number, hour = 10): number {
  return new Date(2026, 0, 15 + dayOffset, hour).getTime();
}

function recordOf(
  id: string,
  timestamp: number,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...overrides
  };
}

function usageOf(input: number, output = 0): SessionUsage {
  return { inputTokens: input, outputTokens: output };
}

function inputOf(label: string, records: SessionRecord[], projectPath?: string): UsageSessionInput {
  const input: UsageSessionInput = { projectLabel: label, records };
  if (projectPath) input.projectPath = projectPath;
  return input;
}

function inputs(): UsageSessionInput[] {
  return [
    inputOf(
      ALPHA,
      [
        recordOf("a-user", at(0), { kind: "user" }),
        recordOf("a-llm", at(0) + 600_000, {
          model: "claude-sonnet-4-5-20250929",
          usage: usageOf(1_000_000, 100_000)
        })
      ],
      "/work/alpha"
    ),
    inputOf(
      BETA,
      [
        recordOf("b-llm", at(0), {
          model: "claude-sonnet-4-5-20250929",
          usage: usageOf(300_000)
        })
      ],
      "/work/beta"
    ),
    inputOf(ZETA, [
      recordOf("z-llm", at(0), { model: "gemini-3-pro", usage: usageOf(10_000) })
    ])
  ];
}

/** 卡可能是 `<button>`（传了 onOpenProject）或静态 `<article>`；两种容器
    都带同一份 aria-label，按它取卡，不把角色写死。 */
function cardOf(name: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${name}：`));
}

describe("ProjectCardsPanel", () => {
  it("renders one card per project with the exact readings", () => {
    render(<ProjectCardsPanel inputs={inputs()} days={30} now={NOW} />);
    expect(screen.getByRole("region", { name: "项目卡片" })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-probe="card-item"]')).toHaveLength(3);

    const alpha = within(cardOf("alpha"));
    expect(alpha.getByText("alpha")).toBeInTheDocument();
    expect(alpha.getByText("1.1M")).toBeInTheDocument();
    // 单位与同屏其它读数的写法一致：完整写 token，不用缩写 tok（Issue #348）。
    expect(alpha.getByText("token")).toBeInTheDocument();
    expect(alpha.queryByText("tok")).toBeNull();
    expect(alpha.getByText("$4.50")).toBeInTheDocument();
    expect(alpha.getByText("1 个会话 · 2 条消息")).toBeInTheDocument();
    expect(alpha.getByText("最近活跃 7小时前")).toBeInTheDocument();

    const beta = within(cardOf("beta"));
    expect(beta.getByText("300,000")).toBeInTheDocument();
    expect(beta.getByText("$0.90")).toBeInTheDocument();
    expect(beta.getByText("1 个会话 · 1 条消息")).toBeInTheDocument();
  });

  it("writes 定价未知 instead of a fake $0.00 for an unpriced model", () => {
    render(<ProjectCardsPanel inputs={inputs()} days={30} now={NOW} />);
    const zeta = within(cardOf("work-zeta"));
    expect(zeta.getByText("定价未知")).toBeInTheDocument();
    expect(zeta.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("draws a 14-point sparkline per card", () => {
    render(<ProjectCardsPanel inputs={inputs()} days={30} now={NOW} />);
    const alpha = cardOf("alpha");
    const polyline = alpha.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("points")?.split(" ")).toHaveLength(14);
    expect(alpha.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders static containers instead of dead buttons when no opener is provided", () => {
    render(<ProjectCardsPanel inputs={inputs()} days={30} now={NOW} />);

    // 唯一调用方没有传 onOpenProject：卡片不能以按钮语义出现，
    // 否则用户会点一次「什么都没发生」（评审 P1-4）。
    expect(screen.queryByRole("button", { name: /^alpha：/ })).toBeNull();
    const alpha = cardOf("alpha");
    expect(alpha.tagName).toBe("ARTICLE");
    expect(alpha).toHaveAttribute("data-interactive", "false");
    expect(alpha).not.toHaveAttribute("title");
    // 读数与走势不受容器变化影响。
    expect(alpha.querySelector("polyline")).not.toBeNull();
  });

  it("calls back with the encoded label and explains that the view does not exist yet", async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();
    render(
      <ProjectCardsPanel
        inputs={inputs()}
        days={30}
        onOpenProject={onOpenProject}
        now={NOW}
      />
    );
    const alpha = cardOf("alpha");
    expect(alpha.tagName).toBe("BUTTON");
    expect(alpha).toHaveAttribute("data-interactive", "true");
    expect(alpha).toHaveAttribute("title", "项目筛选视图将在后续版本提供");
    await user.click(alpha);
    expect(onOpenProject).toHaveBeenCalledWith(ALPHA);
  });

  it("limits the number of cards", () => {
    render(<ProjectCardsPanel inputs={inputs()} days={30} limit={1} now={NOW} />);
    expect(document.querySelectorAll('[data-probe="card-item"]')).toHaveLength(1);
    expect(cardOf("alpha")).toBeInTheDocument();
  });

  it("states an empty range in one line", () => {
    render(<ProjectCardsPanel inputs={[]} days={30} now={NOW} />);
    expect(screen.getByText("近 30 天里还没有可展示的项目。")).toBeInTheDocument();
    expect(document.querySelector('[data-probe="cards-root"]')).not.toBeInTheDocument();
  });
});

/**
 * G8 项目季节：卡内 6px 四段条 + 一句话。断言五件事——四段等宽
 * （0 份季用轨道占位）、有数据段同一色阶、四季占比文字与空季补注、
 * aria-label 全量读数、无 token 卡整块不渲染。
 */
describe("ProjectCardsPanel 季节条（G8）", () => {
  /** 记录落在指定年/月（本地时区），带 usage。 */
  function seasonRecord(id: string, year: number, month: number, tokens: number): SessionRecord {
    return recordOf(id, new Date(year, month - 1, 15, 10).getTime(), {
      usage: usageOf(tokens)
    });
  }

  function seasonInputs(): UsageSessionInput[] {
    return [
      // alpha：Q1 100+100 + Q2 400 + Q4 100（跨 2025/2026 两年——2025-Q1 与
      // 2026-Q1 合并成同一段）→ 700 总量，Q1 29%、Q2 57%、Q4 14%。
      inputOf(
        ALPHA,
        [
          seasonRecord("a-q1-old", 2025, 2, 100),
          seasonRecord("a-q1-new", 2026, 1, 100),
          seasonRecord("a-q2", 2026, 5, 400),
          seasonRecord("a-q4", 2026, 11, 100)
        ],
        "/work/alpha"
      ),
      // zeta：只有一条无 usage 的记录 → total 0 → 整块不渲染（卡本身仍在）。
      inputOf(ZETA, [recordOf("z-none", at(0), { kind: "user" })])
    ];
  }

  it("渲染四段等宽条与四季占比文字：0 份季也占位，不退化成一条分隔线", () => {
    render(<ProjectCardsPanel inputs={seasonInputs()} days={400} now={NOW} />);

    const alpha = cardOf("alpha");
    const bar = alpha.querySelector('[data-probe="card-season"]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("data-quarters", "4");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");

    // 四段永远都在（0 份季用 --bg-inset 轨道占位），段定位用 data-q。
    const segs = bar?.querySelectorAll("span[data-q]");
    expect(segs).toHaveLength(4);
    for (const [index, seg] of [...segs!].entries()) {
      expect(seg).toHaveAttribute("data-q", String(index + 1));
    }
    // 四段等宽：宽度交给 CSS 的 flex: 1，不再按占比写内联 flex-grow——
    // 按占比写会让 0 份季宽度归零，整条退化成一条与分隔线混淆的横线。
    for (const seg of segs!) expect(seg).not.toHaveAttribute("style");

    // 0 份季用轨道类（--bg-inset），其余三季上色。CSS module 类名是构建期
    // 哈希，所以按 data-empty 断言语义，再断言有数据的段共用同一个类。
    expect(segs?.[2]).toHaveAttribute("data-empty", "true");
    const filled = [...segs!].filter((seg) => !seg.hasAttribute("data-empty"));
    expect(filled.map((seg) => seg.getAttribute("data-q"))).toEqual(["1", "2", "4"]);
    expect(new Set(filled.map((seg) => seg.className)).size).toBe(1);

    // 文字：四季占比全量可见，不只最重季；空季写「无记录」。
    expect(
      within(alpha).getByText("Q1 29% · Q2 57% · Q3 无记录 · Q4 14%")
    ).toBeInTheDocument();
  });

  it("aria-label 末尾带全量季节读数（颜色与形状不是唯一编码）", () => {
    render(<ProjectCardsPanel inputs={seasonInputs()} days={400} now={NOW} />);

    const alpha = cardOf("alpha");
    // 全量读数按 700 总量四舍五入：Q1 200/700=29%、Q2 400/700=57%、
    // Q3 0%、Q4 100/700=14%（token 计数按 records 的 usage 四计数之和）。
    expect(alpha.getAttribute("aria-label")).toMatch(/，季节性：Q1 29%、Q2 57%、Q3 0%、Q4 14%$/);
  });

  it("无 token 的卡整块不渲染季节条（卡本身仍在）", () => {
    render(<ProjectCardsPanel inputs={seasonInputs()} days={400} now={NOW} />);

    const zeta = cardOf("work-zeta");
    expect(within(zeta).queryByTestId("card-season")).toBeNull();
    expect(zeta.querySelector('[data-probe="card-season"]')).toBeNull();
    expect(zeta.querySelector('[data-probe="card-season-text"]')).toBeNull();
    // 无季节的卡 aria-label 不带季节尾巴。
    expect(zeta.getAttribute("aria-label")).not.toContain("季节性");
  });

  it("单季 100%：整条一段，其余三季写无记录", () => {
    const inputs = [
      inputOf(BETA, [seasonRecord("b-q1", 2026, 1, 300), seasonRecord("b-q1b", 2026, 3, 100)], "/work/beta")
    ];
    render(<ProjectCardsPanel inputs={inputs} days={90} now={NOW} />);

    const beta = cardOf("beta");
    const segs = beta.querySelectorAll("span[data-q]");
    // 单季 100% 也是完整四段：只有 Q1 上色，其余三季以轨道占位。
    expect(segs).toHaveLength(4);
    expect(segs[0]).toHaveAttribute("data-q", "1");
    expect(segs[0]).not.toHaveAttribute("data-empty");
    expect([...segs].slice(1).every((seg) => seg.hasAttribute("data-empty"))).toBe(true);
    // 单季 100%：Q2/Q3/Q4 全空 → 空季补注照样写明（诚实读数）。
    expect(
      within(beta).getByText("Q1 100% · Q2 无记录 · Q3 无记录 · Q4 无记录")
    ).toBeInTheDocument();
  });
});
