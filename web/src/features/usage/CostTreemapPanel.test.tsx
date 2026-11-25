import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { resetFontScaleForTest, setFontScale } from "../settings/fontScale";
import type { UsageSessionInput } from "./usageAggregations";
import { CostTreemapPanel } from "./CostTreemapPanel";
import { fitLabel, textWidth } from "./charts/labels";

/**
 * Issue #359 的界面层：维度切换、标签阈值、合并块、空态、脚注、等价表格、
 * roving tabindex 与浮层。
 *
 * 布局本身（squarified）由 `treemap.test.ts` 覆盖；这里断言的是「界面把这些
 * 事实呈现对了没有」。
 */

const NOW = new Date(2026, 0, 15, 18, 0).getTime();
const DAYS = 7;

/** 窗口 = 1/9 00:00 → 1/16 00:00（本地自然日），下面所有记录都落在窗内。 */
function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 0, day, hour, minute, 0).getTime();
}

const SONNET = "claude-sonnet-4-5-20250929";
const MYSTERY = "mystery-model-1";

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

function usage(input: number, output = 0): SessionUsage {
  return { inputTokens: input, outputTokens: output };
}

function metaOf(path: string, projectLabel: string, title: string, cwd: string): SessionMeta {
  return {
    path,
    mtimeMs: NOW,
    sizeBytes: 0,
    projectLabel,
    hasRecords: true,
    customTitle: title,
    cwd
  };
}

function inputOf(
  projectLabel: string,
  cwd: string,
  session: SessionMeta,
  records: SessionRecord[]
): UsageSessionInput {
  return { projectLabel, projectPath: cwd, session, records };
}

/** 一个「一个项目一个会话」的已定价输入；`inputTokens` 决定面积。 */
function pricedProject(
  name: string,
  inputTokens: number,
  options: { day?: number; hour?: number; title?: string } = {}
): UsageSessionInput {
  const day = options.day ?? 15;
  const hour = options.hour ?? 10;
  const label = `-repo-${name}`;
  const cwd = `/repo/${name}`;
  const meta = metaOf(`/logs/${name}.jsonl`, label, options.title ?? `${name} 会话`, cwd);
  return inputOf(label, cwd, meta, [
    recordOf(`${name}-1`, at(day, hour), { model: SONNET, usage: usage(inputTokens) }),
    recordOf(`${name}-2`, at(day, hour, 30), { model: SONNET, usage: usage(inputTokens) })
  ]);
}

/** 基本夹具：两个已定价项目（alpha 0.60、beta 0.30），两个可点块。 */
function basicInputs(): UsageSessionInput[] {
  return [pricedProject("alpha", 100_000), pricedProject("beta", 50_000, { hour: 12 })];
}

/** 一个项目里的多个会话：面积由 `tokens` 决定，标题用于断言哪个块被标了。 */
function multiSessionProject(
  name: string,
  sessions: ReadonlyArray<{ title: string; tokens: number }>
): UsageSessionInput[] {
  const label = `-repo-${name}`;
  const cwd = `/repo/${name}`;
  return sessions.map((session, index) => {
    const meta = metaOf(`/logs/${name}-${index}.jsonl`, label, session.title, cwd);
    return inputOf(label, cwd, meta, [
      recordOf(`${name}-${index}`, at(15, 10, index), {
        model: SONNET,
        usage: usage(session.tokens)
      })
    ]);
  });
}

function renderPanel(
  inputs: UsageSessionInput[],
  onOpenSession?: (session: SessionMeta) => void
) {
  return render(
    <CostTreemapPanel inputs={inputs} days={DAYS} now={NOW} onOpenSession={onOpenSession} />
  );
}

beforeEach(() => {
  setFontScale(1);
});

afterEach(() => {
  resetFontScaleForTest(1);
});

describe("标签截断", () => {
  it("完整放得下时原样返回", () => {
    expect(fitLabel("alpha", 200, 11)).toBe("alpha");
  });

  it("超出可用宽度时截断并加省略号", () => {
    const result = fitLabel("project-alpha-long", 66, 11);
    expect(result).not.toBeNull();
    expect(result!.endsWith("…")).toBe(true);
    expect(result!.length).toBeLessThan("project-alpha-long".length);
  });

  it("CJK 按 1.0em 计宽：同样的像素宽度能放下更少的汉字", () => {
    // 66px / 11px = 6 个汉字（含省略号占位后只剩 5 个）。
    const result = fitLabel("这是一个非常长的项目名称", 66, 11);
    expect(result).toBe("这是一个非…");
  });

  it("截断后少于 3 个字符就整条不画", () => {
    expect(fitLabel("项目名称", 30, 11)).toBeNull();
  });
});

describe("成本树图面板", () => {
  it("渲染两级块、项目名标签与等价表格，成本口径的摘要与脚注正确", async () => {
    renderPanel(basicInputs());

    expect(await screen.findByRole("region", { name: "成本树图" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^成本树图：/ })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-treemap-hit]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-treemap-project-label]")).toHaveLength(2);
    expect(document.querySelector("[data-treemap-project-label='alpha']")).not.toBeNull();

    expect(screen.getByText(/本窗口没有未定价模型/)).toBeInTheDocument();
    expect(screen.getByText(/面积是已定价会话的估算成本/)).toBeInTheDocument();

    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["项目", "会话", "估算成本", "占本窗口"]);
    expect(within(table).getByText("成本树图等价表格（估算成本口径）")).toBeInTheDocument();
    expect(within(table).getByText("alpha 会话")).toBeInTheDocument();
    expect(within(table).getByText("$0.60")).toBeInTheDocument();
    // alpha 0.60 / (0.60 + 0.30) = 66.7%
    expect(within(table).getByText("66.7%")).toBeInTheDocument();
  });

  it("维度切换：切到 token 后摘要、脚注、表格列与读数一起换口径", async () => {
    renderPanel(basicInputs());
    const user = userEvent.setup();

    expect(screen.getByRole("radio", { name: "成本" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "token" }));

    expect(screen.getByRole("radio", { name: "token" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "成本" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("group", { name: /四类 token 之和/ })).toBeInTheDocument();
    expect(screen.getByText(/定价未知的会话照常计入/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "token" })).toBeInTheDocument();
    // 200,000 + 100,000；两个会话各两条记录。
    expect(within(screen.getByRole("table")).getByText("200,000 token")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("100,000 token")).toBeInTheDocument();
  });

  it("单项目单会话照常渲染：不为「只有一块」加特例", async () => {
    renderPanel([pricedProject("solo", 100_000)]);

    await waitFor(() => {
      expect(document.querySelectorAll("[data-treemap-hit]")).toHaveLength(1);
    });
    expect(document.querySelectorAll("[data-treemap-project-label]")).toHaveLength(1);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText(/本窗口没有未定价模型/)).toBeInTheDocument();
  });

  it("每个可点块都带完整的 aria-label（项目、标题、读数、占比、模型、时间）", async () => {
    renderPanel(basicInputs());

    const hit = await screen.findByRole("button", { name: /alpha 会话/ });
    const label = hit.getAttribute("aria-label") ?? "";
    expect(label).toContain("alpha");
    expect(label).toContain("$0.60");
    expect(label).toContain("占本窗口 66.7%");
    expect(label).toContain("Sonnet 4.5");
    expect(label).toContain("01/15 10:00");
    expect(label).toContain("30 分钟");
  });

  it("点击块沿用 onOpenSession 握手，交回该会话的 SessionMeta", async () => {
    const onOpenSession = vi.fn();
    renderPanel(basicInputs(), onOpenSession);

    await screen.findByRole("button", { name: /alpha 会话/ });
    fireEvent.click(screen.getByRole("button", { name: /alpha 会话/ }));

    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession.mock.calls[0][0]).toMatchObject({ path: "/logs/alpha.jsonl" });
  });

  it("roving tabindex：整图只有一个 0，方向键移动焦点，Home/End 到两端", async () => {
    renderPanel(basicInputs());

    const hits = await waitFor(() => {
      const nodes = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-treemap-hit]"));
      expect(nodes).toHaveLength(2);
      return nodes;
    });

    expect(hits[0].tabIndex).toBe(0);
    expect(hits[1].tabIndex).toBe(-1);

    hits[0].focus();
    fireEvent.keyDown(hits[0], { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(hits[1]));
    expect(hits[1].tabIndex).toBe(0);
    expect(hits[0].tabIndex).toBe(-1);

    fireEvent.keyDown(hits[1], { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(hits[0]));

    fireEvent.keyDown(hits[0], { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(hits[1]));
  });
});

describe("合并小块", () => {
  it("面积低于图幅 0.25% 的会话折成「其余 N 个」，不可点击也不进 Tab 序", async () => {
    // 20 个均衡项目让图幅有正常的二维格子；「crumbs」项目里的 30 条会话
    // 每条只占 0.23%——低于 0.25% 阈值，必须折成一块。
    const others = Array.from({ length: 20 }, (_, index) =>
      pricedProject(`p${index}`, 50, { day: 13, hour: index % 12 })
    );
    const label = "-repo-crumbs";
    const cwd = "/repo/crumbs";
    const crumbs = Array.from({ length: 30 }, (_, index) =>
      inputOf(label, cwd, metaOf(`/logs/crumbs-${index}.jsonl`, label, `crumb ${index}`, cwd), [
        recordOf(`crumb-${index}`, at(14, index % 12, index), {
          model: SONNET,
          usage: usage(5)
        })
      ])
    );
    renderPanel([...others, ...crumbs]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "token" }));

    await waitFor(() => {
      expect(document.querySelectorAll("[data-treemap-merged]")).toHaveLength(1);
    });
    // 合并块只有图形，没有按钮：它不是「某一条会话」。
    expect(document.querySelector('[data-treemap-hit="treemap:other"]')).toBeNull();
    expect(document.querySelectorAll("[data-treemap-hit]")).toHaveLength(20);
    // 等价表格里仍然列出来，读屏能读到。
    expect(within(screen.getByRole("table")).getByText("其余 30 个会话")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("合计 150 token")).toBeInTheDocument();
  });
});

describe("标签阈值", () => {
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    // jsdom 没有布局：把容器宽度钉成 240，让 9 个等面积项目各得 80×113 的格子，
    // 内容宽 74——正好落在「100% 显示、130% 隐藏」的夹缝里。
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 240;
      }
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
    // jsdom 把 clientWidth 定义在 Element.prototype 上，`original` 因此可能是
    // undefined——不删掉自己的覆盖层会把它漏给后面的用例（布局宽度悄悄变成 240）。
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  });

  it("100% 字号下 74px 宽的项目显示名称，130% 下阈值放大到约 94px 后整条不画", async () => {
    const inputs = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"].map((name) =>
      pricedProject(name, 10_000)
    );

    const { unmount } = renderPanel(inputs);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-treemap-project-label]")).toHaveLength(9);
    });
    unmount();

    setFontScale(1.3);
    renderPanel(inputs);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-treemap-project-label]")).toHaveLength(0);
    });
  });
});

describe("会话标题（Issue #367）", () => {
  function sessionLabels(): SVGTextElement[] {
    return Array.from(document.querySelectorAll<SVGTextElement>("[data-treemap-session-label]"));
  }

  function blockRectOf(label: SVGTextElement): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    const key = label.getAttribute("data-treemap-session-label")!;
    const rect = document.querySelector<SVGRectElement>(`[data-treemap-block="${key}"]`);
    expect(rect).not.toBeNull();
    return {
      x: Number(rect!.getAttribute("x")),
      y: Number(rect!.getAttribute("y")),
      w: Number(rect!.getAttribute("width")),
      h: Number(rect!.getAttribute("height"))
    };
  }

  it("面积最大的 6 个会话块各有一个标题，位置在块内左下角", async () => {
    // 同一个项目里 8 个会话，面积严格递减：前 6 个应当被标，后 2 个不标。
    const inputs = multiSessionProject(
      "many",
      [100_000, 90_000, 80_000, 70_000, 60_000, 50_000, 40_000, 30_000].map((tokens, index) => ({
        title: `会话 ${index}`,
        tokens
      }))
    );
    renderPanel(inputs);

    const labels = await waitFor(() => {
      const nodes = sessionLabels();
      expect(nodes).toHaveLength(6);
      return nodes;
    });
    expect(new Set(labels.map((node) => node.textContent))).toEqual(
      new Set(["会话 0", "会话 1", "会话 2", "会话 3", "会话 4", "会话 5"])
    );

    for (const label of labels) {
      const block = blockRectOf(label);
      const x = Number(label.getAttribute("x"));
      const y = Number(label.getAttribute("y"));
      const fontSize = 11; // 100% 下的 --fs-xs
      // 左下角：横向在块内且左对齐，纵向落在下半区。
      expect(x).toBeGreaterThan(block.x);
      expect(y).toBeGreaterThan(block.y + block.h / 2);
      expect(y).toBeLessThanOrEqual(block.y + block.h);
      // 截断后仍不越出块的右边缘。
      expect(x + textWidth(label.textContent ?? "", fontSize)).toBeLessThanOrEqual(
        block.x + block.w + 0.001
      );
    }
  });

  it("面积过小的会话块整条不画（不渲染半截省略号）", async () => {
    // 一个巨大会话 + 一个 1 token 的碎块。碎块仍在全局前 6 里，但放不下标题。
    const inputs = multiSessionProject("giant", [
      { title: "巨大 会话", tokens: 1_000_000 },
      { title: "极小 会话", tokens: 1 }
    ]);
    renderPanel(inputs);

    const labels = await waitFor(() => {
      const nodes = sessionLabels();
      expect(nodes).toHaveLength(1);
      return nodes;
    });
    expect(labels[0].textContent).toBe("巨大 会话");
  });

  it("130% 字号：标题跟着缩放，仍留在块内且压在项目名下方", async () => {
    setFontScale(1.3);
    renderPanel([
      pricedProject("alpha", 100_000),
      pricedProject("beta", 50_000, { hour: 12 }),
      pricedProject("gamma", 25_000, { hour: 13 }),
      pricedProject("delta", 12_000, { hour: 14 }),
      pricedProject("epsilon", 6_000, { hour: 11 })
    ]);

    const fontSize = 11 * 1.3;
    const labels = await waitFor(() => {
      const nodes = sessionLabels();
      expect(nodes.length).toBeGreaterThanOrEqual(3);
      return nodes;
    });

    for (const label of labels) {
      const block = blockRectOf(label);
      const project = label.getAttribute("data-treemap-session-project")!;
      const projectLabel = document.querySelector<SVGTextElement>(
        `[data-treemap-project-label="${project}"]`
      );
      expect(projectLabel).not.toBeNull();

      const x = Number(label.getAttribute("x"));
      const y = Number(label.getAttribute("y"));
      // 不溢出：左右与上下都在块内。
      expect(x).toBeGreaterThanOrEqual(block.x);
      expect(x + textWidth(label.textContent ?? "", fontSize)).toBeLessThanOrEqual(
        block.x + block.w + 0.001
      );
      expect(y - fontSize).toBeGreaterThanOrEqual(block.y);
      expect(y).toBeLessThanOrEqual(block.y + block.h);
      // 与项目名行不打架：整条标题（含字顶）都在项目名基线下方。
      expect(y - fontSize).toBeGreaterThan(Number(projectLabel!.getAttribute("y")));
    }
  });
});

describe("空态", () => {
  it("窗口内没有会话", async () => {
    renderPanel([]);
    expect(await screen.findByText("所选范围内没有会话")).toBeInTheDocument();
  });

  it("成本模式没有任何可定价会话：整块空态，但切到 token 能看", async () => {
    const label = "-repo-mystery";
    const meta = metaOf("/logs/mystery.jsonl", label, "mystery 会话", "/repo/mystery");
    renderPanel([
      inputOf(label, "/repo/mystery", meta, [
        recordOf("m1", at(15, 10), { model: MYSTERY, usage: usage(50_000) })
      ])
    ]);

    expect(
      await screen.findByText("所选范围的会话都没有收录定价，无法按成本排布")
    ).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("radio", { name: "token" }));
    expect(screen.queryByText("所选范围的会话都没有收录定价，无法按成本排布")).toBeNull();
    expect(document.querySelectorAll("[data-treemap-hit]")).toHaveLength(1);
  });

  it("token 模式总 token 为 0", async () => {
    const label = "-repo-quiet";
    const meta = metaOf("/logs/quiet.jsonl", label, "quiet 会话", "/repo/quiet");
    renderPanel([
      inputOf(label, "/repo/quiet", meta, [recordOf("q1", at(15, 10), { kind: "user" })])
    ]);

    await userEvent.setup().click(screen.getByRole("radio", { name: "token" }));
    expect(
      await screen.findByText("所选范围的会话没有 token 读数，无法按 token 排布")
    ).toBeInTheDocument();
  });
});

describe("脚注四种形态", () => {
  it("成本模式：有未定价会话时报出数量", async () => {
    const priced = pricedProject("alpha", 100_000);
    const label = "-repo-mystery";
    const meta = metaOf("/logs/mystery.jsonl", label, "mystery 会话", "/repo/mystery");
    renderPanel([
      priced,
      inputOf(label, "/repo/mystery", meta, [
        recordOf("m1", at(15, 11), { model: MYSTERY, usage: usage(50_000) })
      ])
    ]);

    expect(
      await screen.findByText(/1 个会话使用未收录定价的模型，未计入。/)
    ).toBeInTheDocument();
  });

  it("成本模式：没有未定价会话时明确说出来", async () => {
    renderPanel(basicInputs());
    expect(await screen.findByText(/本窗口没有未定价模型。/)).toBeInTheDocument();
  });

  it("token 模式：说明定价未知照常计入，且不报未定价数量", async () => {
    renderPanel(basicInputs());
    await userEvent.setup().click(screen.getByRole("radio", { name: "token" }));

    expect(screen.getByText(/定价未知的会话照常计入/)).toBeInTheDocument();
    expect(screen.queryByText(/使用未收录定价的模型/)).toBeNull();
  });

  it("token 模式：存在 0 token 会话时补一句未计入", async () => {
    const priced = pricedProject("alpha", 100_000);
    const label = "-repo-quiet";
    const meta = metaOf("/logs/quiet.jsonl", label, "quiet 会话", "/repo/quiet");
    renderPanel([
      priced,
      inputOf(label, "/repo/quiet", meta, [recordOf("q1", at(15, 11), { kind: "user" })])
    ]);
    await userEvent.setup().click(screen.getByRole("radio", { name: "token" }));

    expect(await screen.findByText(/1 个会话没有 token 读数，未计入。/)).toBeInTheDocument();
  });
});

describe("悬停浮层", () => {
  it("指针进入块时在 body 下渲染浮层，Escape 关闭", async () => {
    renderPanel(basicInputs());
    const hit = await screen.findByRole("button", { name: /alpha 会话/ });

    fireEvent.pointerOver(hit, { clientX: 120, clientY: 140 });

    const tip = await waitFor(() => {
      const node = document.querySelector<HTMLElement>("[data-treemap-tooltip]");
      expect(node).not.toBeNull();
      return node!;
    });
    expect(tip).toHaveAttribute("aria-hidden", "true");
    expect(tip).toHaveTextContent("alpha");
    expect(tip).toHaveTextContent("alpha 会话");
    expect(tip).toHaveTextContent("$0.60 · 占本窗口 66.7%");
    expect(tip).toHaveTextContent("Sonnet 4.5 · 01/15 10:00 · 30 分钟");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(document.querySelector("[data-treemap-tooltip]")).toBeNull();
    });
  });

  it("悬停 / 焦点只叠一个独立描边矩形，不改块的 fill", async () => {
    renderPanel(basicInputs());
    const hit = await screen.findByRole("button", { name: /alpha 会话/ });
    const fill = document.querySelector<SVGRectElement>("[data-treemap-block]")!;
    const before = fill.getAttribute("fill");

    fireEvent.pointerOver(hit, { clientX: 10, clientY: 10 });
    await waitFor(() => {
      expect(document.querySelector("[data-treemap-ring='hover']")).not.toBeNull();
    });
    expect(fill.getAttribute("fill")).toBe(before);
    expect(fill.getAttribute("opacity")).toBeNull();
    expect(fill.getAttribute("fill-opacity")).toBeNull();
  });
});
