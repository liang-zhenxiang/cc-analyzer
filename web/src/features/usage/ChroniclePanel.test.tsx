import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Chronicle } from "./chronicle";
import { ChroniclePanel } from "./ChroniclePanel";

/**
 * 数据故事的组件用例：只钉「排版有没有把模型给的东西放到位」。
 * 数字、章节构成、summary 都是夹具直接给的——模型层的口径由 `chronicle.test.ts`
 * 负责，这里再算一遍只会让回归报告指向错误的地方。
 */

type Chapter = Chronicle["chapters"][number];

function chapter(patch: Partial<Chapter> & Pick<Chapter, "id" | "index">): Chapter {
  return {
    kicker: "第一章 · 起点",
    title: "从三月开始",
    stat: "1.2M",
    statUnit: "tokens",
    body: "这段时间的用量从三月开始爬坡。",
    ...patch
  };
}

function story(chapters: Chapter[], summary = "这就是这段时间的故事。"): Chronicle {
  return { chapters, summary, empty: chapters.length === 0 };
}

const THREE = [
  chapter({ id: "open", index: 1, kicker: "第一章 · 起点", title: "从三月开始" }),
  chapter({ id: "turn", index: 2, kicker: "第二章 · 转折", title: "切换了主力模型" }),
  chapter({ id: "close", index: 3, kicker: "第三章 · 收束", title: "在周五收尾" })
];

afterEach(cleanup);

describe("ChroniclePanel · 章节排版", () => {
  it("按 index 升序渲染三章，章节标题是 h3，section 有名字", () => {
    // 故意打乱数组顺序：故事的时间线由 index 决定，不由数据源顺序决定。
    const scrambled = [THREE[2], THREE[0], THREE[1]];
    render(<ChroniclePanel chronicle={story(scrambled)} />);

    expect(screen.getByRole("region", { name: "数据故事" })).toBeInTheDocument();
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(3);
    expect(
      articles.map((article) => within(article).getByRole("heading", { level: 3 }).textContent)
    ).toEqual(["从三月开始", "切换了主力模型", "在周五收尾"]);
    // 序号同时落在 DOM 上，e2e 不必靠标题文字判断顺序。
    expect(articles.map((article) => article.getAttribute("data-chapter-index"))).toEqual([
      "1",
      "2",
      "3"
    ]);
  });

  it("kicker、大数字、单位、正文、脚注各就各位", () => {
    const withFootnote = chapter({
      id: "open",
      index: 1,
      stat: "42.3M",
      statUnit: "tokens",
      body: "正文说的是这一段用量为什么涨。",
      footnote: "口径：四类 token 之和，按本机日志现算。"
    });
    render(<ChroniclePanel chronicle={story([withFootnote])} />);

    const article = screen.getByRole("article");
    expect(within(article).getByText("第一章 · 起点")).toBeInTheDocument();
    expect(within(article).getByText("从三月开始")).toBeInTheDocument();
    // 数字与单位是两个节点：单位降一档字号，但仍要能被分开读到。
    expect(within(article).getByText("42.3M")).toBeInTheDocument();
    expect(within(article).getByText("tokens")).toBeInTheDocument();
    expect(within(article).getByText("正文说的是这一段用量为什么涨。")).toBeInTheDocument();
    expect(within(article).getByText(/口径：四类 token 之和/)).toBeInTheDocument();
  });

  it("没有 footnote 的章节不硬塞一个空脚注", () => {
    render(<ChroniclePanel chronicle={story([chapter({ id: "a", index: 1 })])} />);
    expect(screen.getByRole("article").querySelectorAll("p")).toHaveLength(3);
  });
});

describe("ChroniclePanel · 可选图", () => {
  it("sparkline 与 bars 都挂在 aria-hidden 容器里，读数为零的柱仍占位", () => {
    const { container } = render(
      <ChroniclePanel
        chronicle={story([
          chapter({
            id: "spark",
            index: 1,
            chart: { kind: "sparkline", values: [1, 4, 2, 8, 5] }
          }),
          chapter({
            id: "bars",
            index: 2,
            chart: { kind: "bars", values: [3, 0, 5], labels: ["一", "二", "三"] }
          })
        ])}
      />
    );

    const sparkline = container.querySelector('[data-probe="chronicle-sparkline"]');
    expect(sparkline).not.toBeNull();
    expect(sparkline).toHaveAttribute("aria-hidden", "true");
    expect(sparkline?.querySelector("polyline")).not.toBeNull();

    const bars = container.querySelector('[data-probe="chronicle-bars"]');
    expect(bars).not.toBeNull();
    expect(bars).toHaveAttribute("aria-hidden", "true");
    // 三根柱（含 0 值那根）都在：0 是事实，不是缺格。
    expect(container.querySelectorAll('[data-probe="chronicle-bar"]')).toHaveLength(3);
    // 标签按步长稀释也不会丢列——每一列都有一个标签槽位。
    expect(container.querySelectorAll('[data-probe="chronicle-bar-label"]')).toHaveLength(3);
  });

  it("单点 sparkline 不画图：少于两点不是趋势", () => {
    const { container } = render(
      <ChroniclePanel
        chronicle={story([
          chapter({ id: "one", index: 1, chart: { kind: "sparkline", values: [7] } })
        ])}
      />
    );
    expect(container.querySelector('[data-probe="chronicle-sparkline"]')).toBeNull();
  });
});

describe("ChroniclePanel · 结尾与导出", () => {
  it("summary 之后是导出按钮；点击回调一次", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<ChroniclePanel chronicle={story(THREE)} onExport={onExport} />);

    const region = screen.getByRole("region", { name: "数据故事" });
    const summary = screen.getByText("这就是这段时间的故事。");
    // summary 住在最后一个 footer 里：章节全部在前，结尾在最后。
    const footer = region.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain("这就是这段时间的故事。");
    expect(summary).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "导出这篇故事（Markdown）" });
    expect(button).toHaveAttribute("data-probe", "chronicle-export");
    await user.click(button);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("onExport 未接入时按钮留在原位但禁用，不假装已可导出", () => {
    render(<ChroniclePanel chronicle={story(THREE)} />);
    const button = screen.getByRole("button", { name: "导出这篇故事（Markdown）" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "导出功能尚未接入");
  });

  it("exporting 时按钮禁用并改写文案，不重复触发", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<ChroniclePanel chronicle={story(THREE)} onExport={onExport} exporting />);

    const button = screen.getByRole("button", { name: "正在导出…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(onExport).not.toHaveBeenCalled();
  });

  it("长图按钮与 Markdown 并列，点击各自回调一次", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const onExportCard = vi.fn();
    render(
      <ChroniclePanel
        chronicle={story(THREE)}
        onExport={onExport}
        onExportCard={onExportCard}
      />
    );

    const cardButton = screen.getByRole("button", { name: "导出长图（PNG）" });
    expect(cardButton).toHaveAttribute("data-probe", "chronicle-export-card");
    // 两个出口同在一行结尾，顺序固定：Markdown 在前，长图在后。
    const markdownButton = screen.getByRole("button", { name: "导出这篇故事（Markdown）" });
    expect(markdownButton.compareDocumentPosition(cardButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );

    await user.click(cardButton);
    expect(onExportCard).toHaveBeenCalledTimes(1);
    expect(onExport).not.toHaveBeenCalled();
  });

  it("onExportCard 未接入时按钮留在原位但禁用", () => {
    render(<ChroniclePanel chronicle={story(THREE)} />);
    const cardButton = screen.getByRole("button", { name: "导出长图（PNG）" });
    expect(cardButton).toBeDisabled();
    expect(cardButton).toHaveAttribute("title", "导出功能尚未接入");
  });

  it("长图导出中改写文案并禁用，Markdown 同时避让", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const onExportCard = vi.fn();
    render(
      <ChroniclePanel
        chronicle={story(THREE)}
        onExport={onExport}
        onExportCard={onExportCard}
        exportingCard
      />
    );

    const cardButton = screen.getByRole("button", { name: "正在导出长图…" });
    expect(cardButton).toBeDisabled();
    expect(cardButton).toHaveAttribute("aria-busy", "true");
    // Markdown 按钮文案不变，但同一次导出期间不可再点。
    expect(screen.getByRole("button", { name: "导出这篇故事（Markdown）" })).toBeDisabled();
    await user.click(cardButton);
    expect(onExportCard).not.toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();
  });
});

describe("ChroniclePanel · 空态", () => {
  it("没有故事时只给一句实话，不画空章节也不给导出按钮", () => {
    render(<ChroniclePanel chronicle={{ chapters: [], summary: "", empty: true }} />);

    expect(screen.getByRole("region", { name: "数据故事" })).toBeInTheDocument();
    expect(screen.getByText("这个窗口还没有足够的故事")).toBeInTheDocument();
    expect(screen.getByText(/换一个更长的时间范围/)).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /导出/ })).toBeNull();
  });
});
