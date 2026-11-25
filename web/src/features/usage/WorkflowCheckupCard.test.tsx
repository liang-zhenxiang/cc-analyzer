import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { dayStartOf, type UsageSessionInput } from "./usageAggregations";
import type { CheckupItem, WorkflowCheckup } from "./workflowCheckup";
import { CHECKUP_THRESHOLDS, buildWorkflowCheckup } from "./workflowCheckup";
import { WorkflowCheckupCard } from "./WorkflowCheckupCard";

/**
 * 「工作流体检」卡片层（Issue #391，清单见 docs/design/workflow-checkup.md §7.2）。
 *
 * 判定、排序、级别与文案由 `workflowCheckup.test.ts` 钉住；这里只测界面契约：
 * - Panel 区域名、探针、条目与级别；
 * - quiet / empty / insufficient 整卡不渲染；insufficient 的事实留在数据层；
 * - 三档形状的 CSS、颜色纪律（零语义色、--warning 只出现在样本不足）；
 * - 证据手风琴、Escape、刻度条几何、动作链接的有无；
 * - 整行不可点、行高不写死、130% 字号下的换行约定。
 */

const CSS = readFileSync(
  resolve(process.cwd(), "src/features/usage/WorkflowCheckupCard.module.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`).exec(CSS);
  expect(match, `样式表里找不到 ${selector}`).not.toBeNull();
  return match![1];
}

/** 条目的证据区：五行 + 一条刻度（与逻辑层产出的形状一致）。 */
function evidenceRows(): CheckupItem["evidence"]["rows"] {
  return [
    { label: "计数", value: "7 / 12 个会话（有 usage 的会话）", numeric: false },
    { label: "读数", value: "58.3%", numeric: true },
    { label: "判定", value: "触发 > 25% · 关注 > 50%", numeric: false },
    { label: "样本", value: "12 个会话（下限 8）", numeric: false },
    { label: "窗口", value: "近 30 天 · 10/23–11/21", numeric: false }
  ];
}

let seq = 0;

function item(
  over: Partial<CheckupItem> & Pick<CheckupItem, "id" | "level" | "dimension" | "fact">
): CheckupItem {
  seq += 1;
  return {
    action: { kind: "advice", text: "把长任务拆成多次会话，每次带更少的历史" },
    note: null,
    intensity: 1 + seq / 100,
    evidence: {
      rows: evidenceRows(),
      meter: {
        value: 58.3,
        max: 100,
        threshold: 25,
        direction: "above",
        caption: "58.3% · 判定线 25% · 高于判定线才成立"
      }
    },
    ...over
  };
}

function itemsAll(): CheckupItem[] {
  return [
    item({
      id: "context-pressure",
      level: "focus",
      dimension: "上下文压力",
      fact: "7 / 12 个会话的上下文峰值不低于 170K（压缩阈值 200K 的 85%）"
    }),
    item({
      id: "error-focus",
      level: "notice",
      dimension: "错误集中",
      fact: "全部 18 次工具失败里有 16 次来自 Bash（89%），Bash 失败率 80%",
      action: {
        kind: "jump",
        text: "去看错误档案里 Bash 的前三个失败签名",
        linkLabel: "打开错误档",
        target: "errors"
      }
    }),
    item({
      id: "delegation",
      level: "observe",
      dimension: "委派使用",
      fact: "20 个会话里只有 1 个用过子 agent",
      action: null,
      note: "这一项只陈述事实，不给建议——是否适合委派取决于具体任务。",
      evidence: { rows: evidenceRows(), meter: null }
    })
  ];
}

function checkupOf(
  items: CheckupItem[],
  over: Partial<WorkflowCheckup> = {}
): WorkflowCheckup {
  const counts = { focus: 0, notice: 0, observe: 0 };
  for (const entry of items) counts[entry.level] += 1;
  return {
    status: items.length === 0 ? "quiet" : "ok",
    items,
    checked: CHECKUP_THRESHOLDS.totalRules - 1,
    total: CHECKUP_THRESHOLDS.totalRules,
    ineligible: 1,
    dropped: 0,
    counts,
    summary: "",
    insufficient: null,
    window: { startDay: 0, days: 30, label: "10/23–11/21" },
    ...over
  };
}

function renderCard(
  checkup: WorkflowCheckup,
  onOpenErrors?: () => void
) {
  return render(
    <WorkflowCheckupCard checkup={checkup} onOpenErrors={onOpenErrors} />
  );
}

function probe<T extends Element = HTMLElement>(
  container: HTMLElement,
  value: string
): T | null {
  return container.querySelector<T>(`[data-probe="${value}"]`);
}

describe("WorkflowCheckupCard: 卡片与条目", () => {
  it("渲染 region、清单探针与每条的 id / 级别", () => {
    const { container } = renderCard(checkupOf(itemsAll()));
    const region = screen.getByRole("region", { name: "工作流体检" });
    expect(region).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "工作流体检" })).toBeInTheDocument();
    expect(probe(region, "workflow-checkup")).not.toBeNull();

    const list = probe(region, "checkup-list")!;
    expect(list.tagName).toBe("OL");
    const rows = region.querySelectorAll<HTMLElement>('[data-probe="checkup-item"]');
    expect(rows).toHaveLength(3);
    expect([...rows].map((row) => row.getAttribute("data-checkup-id"))).toEqual([
      "context-pressure",
      "error-focus",
      "delegation"
    ]);
    expect([...rows].map((row) => row.getAttribute("data-checkup-level"))).toEqual([
      "focus",
      "notice",
      "observe"
    ]);
    // 维度名是 h3；级别词以 sr-only 前缀进入可访问名，读屏只念一遍。
    expect(
      screen.getByRole("heading", { level: 3, name: "关注：上下文压力" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "留意：错误集中" })
    ).toBeInTheDocument();
    expect(container.querySelector('[data-probe="checkup-summary"]')).not.toBeNull();
  });

  it("quiet / empty 时整卡返回 null", () => {
    for (const status of ["quiet", "empty"] as const) {
      const { container, unmount } = renderCard(
        checkupOf([], { status, checked: 0, ineligible: 5 })
      );
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole("region", { name: "工作流体检" })).toBeNull();
      unmount();
    }
  });

  it("insufficient 时组件同样返回 null，但数据层的状态与三个计数保留", () => {
    // 用真实数据层构造「有会话、但五项全部低于样本下限」：4 个会话 / 12 次
    // 工具调用 / 1.2M token。组件不渲染它，可测试的事实仍留在 status 与
    // insufficient 上（design §4 修订）。
    const now = Date.now();
    const at = now - 3_600_000;
    const inputs: UsageSessionInput[] = Array.from({ length: 4 }, (_, index) => {
      const record: SessionRecord = {
        id: `thin-${index}`,
        fullId: `thin-${index}`,
        kind: "assistant",
        timestamp: at,
        durationMs: 0,
        text: "",
        isError: false,
        raw: {},
        usage: {
          inputTokens: 250_000,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 50_000
        }
      };
      return {
        records: [record],
        projectLabel: "checkup-thin",
        toolCalls: [],
        compactEvents: [],
        errorExtract: {
          events: [],
          days: new Map([
            [
              dayStartOf(at),
              { assistantMessages: 1, records: 1, toolCalls: new Map([["Read", 3]]) }
            ]
          ])
        }
      };
    });
    const checkup = buildWorkflowCheckup(inputs, 30, now);
    expect(checkup.status).toBe("insufficient");
    expect(checkup.checked).toBe(0);
    expect(checkup.insufficient).toEqual({
      sessions: 4,
      toolCalls: 12,
      tokens: 1_200_000
    });

    const { container } = renderCard(checkup);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "工作流体检" })).toBeNull();
  });

  it("表头总述的分母是 checked，分子是所有 focus/notice", () => {
    renderCard(
      checkupOf(itemsAll(), {
        checked: 4,
        counts: { focus: 2, notice: 1, observe: 0 }
      })
    );
    const summary = screen.getByRole("region", { name: "工作流体检" }).querySelector<HTMLElement>(
      '[data-probe="checkup-summary"]'
    )!;
    expect(summary.textContent).toBe("4 项检查里 3 项值得看一眼");
    const numbers = summary.querySelectorAll("span");
    expect(numbers).toHaveLength(2);
    for (const number of numbers) expect(number.className).toContain("summaryNumber");
  });
});

describe("WorkflowCheckupCard: 颜色纪律与形状", () => {
  it("三档标记只用形状 + 墨色，零语义色", () => {
    expect(ruleBody(".markerFocus")).toContain("background: var(--text)");
    expect(ruleBody(".markerNotice")).toContain(
      "border: 1.5px solid var(--text-secondary)"
    );
    expect(ruleBody(".markerObserve")).toContain("height: 2px");
    expect(ruleBody(".markerObserve")).toContain("background: var(--text-tertiary)");
    expect(ruleBody(".markerObserve")).toContain("width: var(--checkup-marker)");

    expect(CSS).not.toContain("--danger");
    expect(CSS).not.toContain("--success");
    // 样本不足态整卡不渲染（design §4 修订），模块 CSS 已无 --warning 的用武之地。
    expect(CSS).not.toContain("--warning");
    expect(CSS).not.toContain("--chart-");
    expect(CSS).not.toContain("--cat-");
    expect(CSS).not.toContain("color-mix");
    expect(CSS).not.toContain("opacity");
    // 十六进制颜色一个都不许出现（颜色只能来自令牌）。
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("事实里的数字是等宽 tabular，片段不另给颜色", () => {
    const { container } = renderCard(checkupOf(itemsAll()));
    const fact = probe(container, "checkup-fact")!;
    const numbers = fact.querySelectorAll<HTMLElement>("span");
    expect(numbers.length).toBeGreaterThan(0);
    for (const number of numbers) expect(number.className).toContain("number");
    // 「证据」按钮是行内控件，属于同一条事实行：句子本身仍是原文，不插字。
    expect(fact.textContent).toBe(
      "7 / 12 个会话的上下文峰值不低于 170K（压缩阈值 200K 的 85%）证据"
    );

    const numberRule = ruleBody(".number");
    expect(numberRule).toContain("var(--font-mono)");
    expect(numberRule).toContain("tabular-nums");
    expect(numberRule).not.toMatch(/(^|\s)color:/);
  });
});

describe("WorkflowCheckupCard: 证据手风琴", () => {
  function toggles(container: HTMLElement): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>(
      '[data-probe="checkup-evidence-toggle"]'
    )];
  }

  it("点开只展开一条；再点另一条自动收起上一条；Escape 收起且焦点留在按钮", async () => {
    const user = userEvent.setup();
    const { container } = renderCard(checkupOf(itemsAll()));
    const buttons = toggles(container);
    expect(buttons).toHaveLength(3);

    await user.click(buttons[0]);
    expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
    expect(buttons[0].textContent).toBe("收起");
    expect(buttons[0].getAttribute("aria-label")).toBe("收起证据：上下文压力");
    expect(container.querySelectorAll('[data-probe="checkup-evidence"]')).toHaveLength(1);
    expect(buttons[0]).toHaveFocus();

    await user.click(buttons[1]);
    expect(container.querySelectorAll('[data-probe="checkup-evidence"]')).toHaveLength(1);
    expect(
      container.querySelector(
        '[data-checkup-id="context-pressure"] [data-probe="checkup-evidence"]'
      )
    ).toBeNull();
    expect(buttons[0].getAttribute("aria-expanded")).toBe("false");

    await user.keyboard("{Escape}");
    expect(container.querySelectorAll('[data-probe="checkup-evidence"]')).toHaveLength(0);
    expect(buttons[1]).toHaveFocus();
  });

  it("证据区没有任何可聚焦元素，结构是 dl 而不是表格", async () => {
    const user = userEvent.setup();
    const { container } = renderCard(checkupOf(itemsAll()));
    await user.click(toggles(container)[0]);
    const evidence = probe(container, "checkup-evidence")!;
    expect(
      evidence.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")
    ).toHaveLength(0);
    const dl = evidence.querySelector("dl")!;
    expect(dl.getAttribute("aria-label")).toBe("上下文压力的判定依据");
    expect(dl.querySelectorAll("dt")).toHaveLength(5);
    expect(dl.querySelectorAll("dd")).toHaveLength(5);
    expect(evidence.querySelector("table")).toBeNull();
  });

  it("刻度条的填充宽度与判定线位置来自 meter；读数超过上限时截到 100%", async () => {
    const user = userEvent.setup();
    const { container } = renderCard(checkupOf(itemsAll()));
    await user.click(toggles(container)[0]);
    const meter = probe(container, "checkup-meter")!;
    const fill = meter.children[0] as HTMLElement;
    const threshold = meter.children[1] as HTMLElement;
    expect(fill.style.width).toBe("58.3%");
    expect(threshold.style.left).toBe("25%");
    expect(probe(container, "checkup-evidence")!.textContent).toContain(
      "58.3% · 判定线 25% · 高于判定线才成立"
    );

    // 超过 max：数值仍是真值，条只截到 100%。
    const overflowItem = item({
      id: "compaction-rate",
      level: "notice",
      dimension: "压缩频次",
      fact: "12 个会话里发生了 6 次压缩",
      evidence: {
        rows: evidenceRows(),
        meter: {
          value: 140,
          max: 100,
          threshold: 40,
          direction: "above",
          caption: "1.40 次/会话 · 判定线 0.40 次/会话 · 高于判定线才成立"
        }
      }
    });
    const { container: other } = renderCard(checkupOf([overflowItem]));
    await user.click(toggles(other)[0]);
    const otherFill = probe(other, "checkup-meter")!.children[0] as HTMLElement;
    expect(otherFill.style.width).toBe("100%");
  });

  it("observe 项没有刻度条", async () => {
    const user = userEvent.setup();
    const { container } = renderCard(checkupOf(itemsAll()));
    await user.click(toggles(container)[2]);
    expect(probe(container, "checkup-evidence")).not.toBeNull();
    expect(probe(container, "checkup-meter")).toBeNull();
  });
});

describe("WorkflowCheckupCard: 动作与交互边界", () => {
  it("只有 error-focus 渲染跳转按钮，点击调用一次 onOpenErrors", async () => {
    const user = userEvent.setup();
    const onOpenErrors = vi.fn();
    const { container } = renderCard(checkupOf(itemsAll()), onOpenErrors);
    const links = container.querySelectorAll<HTMLButtonElement>(
      '[data-probe="checkup-action-link"]'
    );
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("打开错误档 →");
    expect(links[0].getAttribute("aria-label")).toContain("打开错误档");
    expect(links[0].getAttribute("aria-label")).toContain("Bash");
    await user.click(links[0]);
    expect(onOpenErrors).toHaveBeenCalledTimes(1);
  });

  it("onOpenErrors 缺省时不渲染按钮（不是 disabled），处方文字仍在", () => {
    const { container } = renderCard(checkupOf(itemsAll()));
    expect(container.querySelector('[data-probe="checkup-action-link"]')).toBeNull();
    const errorRow = container.querySelector('[data-checkup-id="error-focus"]')!;
    expect(errorRow.textContent).toContain("去看错误档案里 Bash 的前三个失败签名");
    expect(errorRow.textContent).toContain("处方");
    expect(errorRow.querySelectorAll("button[disabled]")).toHaveLength(0);
  });

  it("delegation 的第二行标签是「说明」，没有链接", () => {
    const { container } = renderCard(checkupOf(itemsAll()));
    const row = container.querySelector('[data-checkup-id="delegation"]')!;
    expect(probe(row as HTMLElement, "checkup-action")!.textContent).toContain("说明");
    expect(probe(row as HTMLElement, "checkup-action")!.textContent).not.toContain("处方");
    expect(probe(row as HTMLElement, "checkup-note")!.textContent).toContain(
      "这一项只陈述事实，不给建议"
    );
    expect(row.querySelectorAll('[data-probe="checkup-action-link"]')).toHaveLength(0);
  });

  it("整行不是按钮：点击事实文字不展开，行不在 Tab 序", async () => {
    const user = userEvent.setup();
    const { container } = renderCard(checkupOf(itemsAll()));
    const row = container.querySelector<HTMLElement>('[data-checkup-id="context-pressure"]')!;
    expect(row.tagName).toBe("LI");
    expect(row.getAttribute("role")).toBeNull();
    expect(row.hasAttribute("tabindex")).toBe(false);
    // 行内唯一可聚焦的是「证据」按钮（error-focus 行还有动作链接）。
    const buttons = row.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("data-probe")).toBe("checkup-evidence-toggle");

    await user.click(probe(row, "checkup-fact")!);
    expect(container.querySelectorAll('[data-probe="checkup-evidence"]')).toHaveLength(0);
  });
});

describe("WorkflowCheckupCard: 版式与 130% 字号", () => {
  it("行几何固定在模块局部变量里，行高不写死，事实允许折行", () => {
    const list = ruleBody(".list");
    expect(list).toContain("--checkup-rail: 2px");
    expect(list).toContain("--checkup-dim: 92px");
    expect(list).toContain("--checkup-marker: 8px");
    expect(list).toContain("--checkup-meter: 4px");

    const itemRule = ruleBody(".item");
    expect(itemRule).toContain(
      "grid-template-columns: 16px var(--checkup-dim) minmax(0, 1fr)"
    );
    expect(itemRule).not.toMatch(/(^|[;\s])height\s*:/);
    expect(ruleBody(".item + .item")).toContain("border-top: 1px solid var(--border)");

    expect(ruleBody(".fact")).toContain("overflow-wrap: anywhere");
    expect(ruleBody(".fact")).not.toContain("line-clamp");
    expect(ruleBody(".fact")).not.toContain("text-overflow");
    expect(ruleBody(".action")).not.toContain("line-clamp");
    expect(ruleBody(".action")).not.toContain("text-overflow");

    // 证据从内容列（第 3 列）开始，不靠 magic left margin。
    expect(ruleBody(".content")).toContain("grid-column: 3");
    expect(ruleBody(".evidence")).not.toContain("margin-left");
    expect(ruleBody(".evidence")).toContain("background: var(--bg-inset)");
    expect(ruleBody(".evidence")).not.toContain("border-top");
  });

  it("130% 字号：维度列不缩放、维度名与总述不换行、事实仍可折行", () => {
    document.documentElement.style.setProperty("--font-scale", "1.3");
    try {
      renderCard(checkupOf(itemsAll()));
      expect(ruleBody(".summary")).toContain("white-space: nowrap");
      expect(ruleBody(".summary")).toContain("font-size: var(--fs-xs)");
      expect(ruleBody(".dimensionName")).toContain("white-space: nowrap");
      expect(ruleBody(".dimensionName")).toContain("font-size: var(--fs-sm)");
      // 列宽是版式常量：不随字号缩放，也不再吃第 6 个汉字。
      expect(ruleBody(".list")).toContain("--checkup-dim: 92px");
      // 事实与处方允许折行，只在字段内部换行。
      expect(ruleBody(".fact")).toContain("font-size: var(--fs-sm)");
      expect(ruleBody(".action")).toContain("font-size: var(--fs-xs)");
    } finally {
      document.documentElement.style.removeProperty("--font-scale");
    }
  });
});
