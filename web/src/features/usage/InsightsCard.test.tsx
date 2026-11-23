import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Insight } from "./insights";
import { InsightsCard } from "./InsightsCard";

/**
 * 「值得注意的变化」卡片层（Issue #383）。
 *
 * 判定与排序由 `insights.test.ts` 钉住；这里只测界面契约：
 * - 卡片头 / 空态 / 脚注；
 * - 每行展开 / 收起（手风琴）、Escape 收起且焦点留在行上；
 * - 中性行**没有**箭头，错误率行只有箭头着色；
 * - 依据区「变化」行的三种单位（百分点 / % / 次/会话）与 U+2212 真减号；
 * - 130% 字号下的行高不依赖固定 height。
 */

const NOW = new Date(2026, 10, 21, 18, 0, 0).getTime();
const DAYS = 30;

function insight(over: Partial<Insight> & Pick<Insight, "kind" | "text">): Insight {
  return {
    intensity: 1,
    evidence: [{ label: "指标", before: 10, after: 20 }],
    direction: "neutral",
    ...over
  };
}

function modelInsight(): Insight {
  return insight({
    kind: "model",
    text: "Opus 4.1 占比从 21% 升到 58%",
    evidence: [{ label: "Opus 4.1", before: 21.4, after: 58.2 }]
  });
}

function sessionLengthInsight(): Insight {
  return insight({
    kind: "sessionLength",
    text: "平均会话时长从 3 分钟升到 5 分钟",
    evidence: [{ label: "平均会话时长", before: 3, after: 5 }]
  });
}

function compactionInsight(): Insight {
  return insight({
    kind: "compaction",
    text: "平均每 10 个会话压缩次数从 3 次 升到 9 次",
    evidence: [{ label: "每 10 个会话压缩次数", before: 3, after: 9 }]
  });
}

function errorRateInsight(before: number, after: number): Insight {
  return insight({
    kind: "errorRate",
    text: `工具调用失败率从 ${Math.round(before)}% ${after > before ? "升" : "降"}到 ${Math.round(after)}%`,
    evidence: [{ label: "工具调用失败率", before, after }],
    direction: "up-bad"
  });
}

function renderCard(insights: Insight[]) {
  return render(<InsightsCard insights={insights} inputs={[]} days={DAYS} now={NOW} />);
}

function rowOf(card: HTMLElement, kind: string): HTMLElement {
  const row = card.querySelector<HTMLElement>(`[data-kind="${kind}"] [data-probe="insight-row"]`);
  expect(row, `找不到 ${kind} 行`).not.toBeNull();
  return row!;
}

function evidenceOf(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>('[data-probe="insight-evidence"]');
}

/** 注释会讨论「固定 height 会裁字」，判断样式规则前先剥掉注释。 */
const cardCss = readFileSync(
  resolve(process.cwd(), "src/features/usage/InsightsCard.module.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`).exec(cardCss);
  expect(match, `样式表里找不到 ${selector}`).not.toBeNull();
  return match![1];
}

describe("InsightsCard: 卡片与行", () => {
  it("渲染 Panel 头、每行句子、右侧范围与脚注", () => {
    const card = renderCard([modelInsight()]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    );
    expect(card).not.toBeNull();
    expect(screen.getByRole("heading", { name: "值得注意的变化" })).toBeInTheDocument();
    expect(
      card!.querySelector('[data-probe="insight-sentence"]')!.textContent
    ).toBe("Opus 4.1 占比从 21% 升到 58%");
    expect(card!.textContent).toContain("近 30 天 vs 上一个 30 天");
    expect(card!.textContent).toContain(
      "与上一个等长区间比较；只列出达到阈值的项，未达阈值的不会出现。全部数字可从上方的区间控件复算。"
    );
    // 范围 title 是两段精确日期，不能出现项目名 / 绝对路径。
    const range = card!.querySelector<HTMLElement>("[data-probe='insight-row']")!.children[1];
    expect(range.getAttribute("title")).toMatch(/^当前 \d+\/\d+–/);
    expect(range.getAttribute("title")).not.toContain("/repo");
  });

  it("句子里的数字包在等宽 tabular-nums 片段里，且片段不另给颜色", () => {
    const card = renderCard([modelInsight()]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    const sentence = card.querySelector<HTMLElement>('[data-probe="insight-sentence"]')!;
    const numbers = sentence.querySelectorAll("span");
    expect(numbers.length).toBeGreaterThan(0);
    for (const number of numbers) {
      expect(number.className).toContain("number");
    }
    // 片段文本仍是原句的一部分（不插空格、不改字）。
    expect(sentence.textContent).toBe("Opus 4.1 占比从 21% 升到 58%");

    const numberRule = ruleBody(".number");
    expect(numberRule).toContain("var(--font-mono)");
    expect(numberRule).toContain("tabular-nums");
    expect(numberRule).not.toMatch(/(^|\s)color:/);
  });

  it("最多五条时逐行渲染，行与行之间有一条分隔线（首尾没有）", () => {
    const insights = [
      modelInsight(),
      insight({ kind: "project", text: "demo 的用量占比从 10% 升到 40%" }),
      errorRateInsight(0, 8),
      compactionInsight(),
      sessionLengthInsight()
    ];
    const card = renderCard(insights).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    expect(card.querySelectorAll('[data-probe="insight-row"]')).toHaveLength(5);
    // 分隔线由 `.item + .item` 承担：首行没有上边线，末行也没有下边线。
    expect(ruleBody(".item + .item")).toContain("border-top: 1px solid var(--border)");
  });
});

describe("InsightsCard: 手风琴与 Escape", () => {
  it("点一行展开依据，再点另一条自动收起上一条", async () => {
    const user = userEvent.setup();
    const card = renderCard([modelInsight(), compactionInsight()]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    expect(evidenceOf(card)).toBeNull();

    await user.click(rowOf(card, "model"));
    expect(rowOf(card, "model").getAttribute("aria-expanded")).toBe("true");
    expect(evidenceOf(card)).not.toBeNull();
    expect(evidenceOf(card)!.textContent).toContain("Opus 4.1");

    await user.click(rowOf(card, "compaction"));
    expect(rowOf(card, "model").getAttribute("aria-expanded")).toBe("false");
    expect(rowOf(card, "compaction").getAttribute("aria-expanded")).toBe("true");
    expect(card.querySelectorAll('[data-probe="insight-evidence"]')).toHaveLength(1);
    expect(evidenceOf(card)!.textContent).toContain("每 10 个会话压缩次数");
  });

  it("再次点击同一行收起；Escape 收起且焦点留在行上", async () => {
    const user = userEvent.setup();
    const card = renderCard([modelInsight()]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    const row = rowOf(card, "model");

    await user.click(row);
    expect(evidenceOf(card)).not.toBeNull();
    await user.click(row);
    expect(evidenceOf(card)).toBeNull();

    await user.click(row);
    expect(evidenceOf(card)).not.toBeNull();
    expect(row).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(evidenceOf(card)).toBeNull();
    // 依据区没有可聚焦元素：收起后焦点仍停在整行按钮上。
    expect(row).toHaveFocus();
  });

  it("依据区没有任何可聚焦元素", async () => {
    const user = userEvent.setup();
    const card = renderCard([modelInsight()]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    await user.click(rowOf(card, "model"));
    const evidence = evidenceOf(card)!;
    expect(
      evidence.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")
    ).toHaveLength(0);
  });
});

describe("InsightsCard: 空态", () => {
  it("没有达到阈值的变化时陈述事实，不写「一切正常」", () => {
    renderCard([]);
    expect(screen.getByText("最近没有达到阈值的变化")).toBeInTheDocument();
    expect(
      screen.getByText("与上一个 30 天相比，没有指标同时满足变化幅度与样本量要求。")
    ).toBeInTheDocument();
    // 只扫描卡片正文：标题里的「值得注意」是功能名，不是判断词。
    const empty = document.querySelector<HTMLElement>('[data-probe="insights-empty"]')!;
    expect(empty.textContent).not.toMatch(/一切正常|波动范围|建议|应该|可能|注意/);
    // 卡片仍然渲染 Panel 头与口径脚注，不整卡消失。
    expect(screen.getByRole("heading", { name: "值得注意的变化" })).toBeInTheDocument();
    expect(screen.getByText(/未达阈值的不会出现/)).toBeInTheDocument();
  });
});

describe("InsightsCard: 方向与颜色", () => {
  it("中性行没有箭头", () => {
    const card = renderCard([modelInsight(), sessionLengthInsight(), compactionInsight()])
      .container.querySelector<HTMLElement>('[aria-label="值得注意的变化"]')!;
    expect(card.querySelectorAll('[data-probe="insight-arrow"]')).toHaveLength(0);
  });

  it("错误率上升：句首 ▲，只有箭头是 --danger", () => {
    const card = renderCard([errorRateInsight(4, 12)]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    const arrow = card.querySelector<HTMLElement>('[data-probe="insight-arrow"]')!;
    expect(arrow.textContent).toBe("▲");
    expect(arrow.className).toContain("arrowUp");
    expect(ruleBody(".arrowUp")).toContain("color: var(--danger)");
    // 数字仍是正文色：句子容器不带语义色类。
    expect(card.querySelector('[data-probe="insight-sentence"]')!.className).not.toMatch(
      /arrowUp|arrowDown/
    );
  });

  it("错误率下降：句首 ▼，箭头是 --success", () => {
    const card = renderCard([errorRateInsight(12, 4)]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    const arrow = card.querySelector<HTMLElement>('[data-probe="insight-arrow"]')!;
    expect(arrow.textContent).toBe("▼");
    expect(arrow.className).toContain("arrowDown");
    expect(ruleBody(".arrowDown")).toContain("color: var(--success)");
  });

  it("不使用 --warning（错误率是确定事实，不是「非确定信息」）", () => {
    expect(cardCss).not.toContain("--warning");
  });
});

describe("InsightsCard: 依据区", () => {
  it("百分比类变化行用百分点（含 U+2212 真减号）", async () => {
    const user = userEvent.setup();
    const card = renderCard([modelInsight(), errorRateInsight(30, 10)]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;

    await user.click(rowOf(card, "model"));
    let change = card.querySelector<HTMLElement>('[data-probe="insight-change"]')!;
    expect(change.textContent).toContain("+36.8 个百分点");
    // 当前列 58.2% / 上一个列 21.4%（原始读数各多一位小数）。
    expect(change.closest("table")!.textContent).toContain("58.2%");
    expect(change.closest("table")!.textContent).toContain("21.4%");

    await user.click(rowOf(card, "errorRate"));
    change = card.querySelector<HTMLElement>('[data-probe="insight-change"]')!;
    expect(change.textContent).toContain("−20.0 个百分点");
    expect(change.textContent).not.toContain("-20.0");
  });

  it("会话时长变化行用相对百分比", async () => {
    const user = userEvent.setup();
    const card = renderCard([sessionLengthInsight()]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    await user.click(rowOf(card, "sessionLength"));
    const change = card.querySelector<HTMLElement>('[data-probe="insight-change"]')!;
    // (5 − 3) / 3 × 100 = 66.7%
    expect(change.textContent).toContain("+66.7%");
    expect(change.textContent).not.toContain("个百分点");
  });

  it("压缩频率变化行用次/会话（证据按每 10 个会话展示）", async () => {
    const user = userEvent.setup();
    const card = renderCard([compactionInsight()]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    await user.click(rowOf(card, "compaction"));
    const change = card.querySelector<HTMLElement>('[data-probe="insight-change"]')!;
    // (9 − 3) / 10 = +0.6 次/会话
    expect(change.textContent).toContain("+0.6 次/会话");
    expect(change.closest("table")!.textContent).toContain("每 10 个会话压缩次数");
  });

  it("样本量行两列都填（当前与上一个各自的样本）", async () => {
    const user = userEvent.setup();
    const card = renderCard([modelInsight()]).container.querySelector<HTMLElement>(
      '[aria-label="值得注意的变化"]'
    )!;
    await user.click(rowOf(card, "model"));
    const sample = card.querySelector<HTMLElement>('[data-probe="insight-sample"]')!;
    const cells = sample.querySelectorAll("td");
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).not.toBe("");
    expect(cells[1].textContent).not.toBe("");
    expect(sample.textContent).not.toContain("—");
    // 表头带 scope，表格有 sr-only caption。
    expect(sample.closest("table")!.querySelector("caption")!.className).toContain("srOnly");
    for (const th of sample.closest("table")!.querySelectorAll("thead th")) {
      expect(th.getAttribute("scope")).toBe("col");
    }
  });

  it("依据区的列宽固定为 120 / 140 / 140", () => {
    expect(ruleBody(".table")).toContain("table-layout: fixed");
    expect(ruleBody(".table thead th.metricHead")).toContain("width: 120px");
    expect(ruleBody(".table thead th:not(.metricHead)")).toContain("width: 140px");
    expect(ruleBody(".evidence")).toContain("padding: var(--sp-2) var(--sp-3)");
    expect(ruleBody(".evidence")).toContain("border-top: 1px solid var(--border)");
  });
});

describe("InsightsCard: 130% 字号不裁字", () => {
  it("行高由 --lh-base 派生，不写固定 height", () => {
    const row = ruleBody(".row");
    expect(row).toContain("min-height: calc(var(--sp-1) * 2 + var(--lh-base))");
    // `min-height` 不能冒充固定高度：规则里不得出现独立的 height 声明。
    expect(row).not.toMatch(/(^|[;\s])height\s*:/);
    expect(ruleBody(".sentence")).toContain("overflow-wrap: anywhere");
    // 句子允许折行，不截断：没有 line-clamp / text-overflow。
    expect(ruleBody(".sentence")).not.toContain("line-clamp");
    expect(ruleBody(".sentence")).not.toContain("text-overflow");
  });

  it("焦点环向内偏移（Panel overflow: hidden 会裁掉外偏移的环）", () => {
    const focus = ruleBody(".row:focus-visible");
    expect(focus).toContain("outline: var(--focus-ring-width) solid var(--ring)");
    expect(focus).toContain("outline-offset: var(--focus-ring-inset)");
  });
});
