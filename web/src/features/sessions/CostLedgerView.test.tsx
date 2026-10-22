import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ParsedSession, SessionRecord, SessionUsage } from "./types";
import { CostLedgerView } from "./CostLedgerView";

/** 固定墙钟：所有时刻断言都是可读的 10:42:0x，而不是「现在」。 */
const T0 = new Date(2026, 0, 1, 10, 42, 0).getTime();
const SONNET = "claude-sonnet-4-5-20250929";
const OPUS = "claude-opus-4-1-20250805";
const UNKNOWN = "gemini-3-pro";

function recordOf(spec: {
  id: string;
  at: number;
  model?: string;
  usage?: SessionUsage;
  kind?: SessionRecord["kind"];
}): SessionRecord {
  const record: SessionRecord = {
    id: spec.id,
    fullId: spec.id,
    kind: spec.kind ?? "assistant",
    timestamp: spec.at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {}
  };
  // 缺 model / 缺 usage 是两种不同的「未定价」，必须真的缺席。
  if (spec.model !== undefined) record.model = spec.model;
  if (spec.usage !== undefined) record.usage = spec.usage;
  return record;
}

function parsedOf(records: SessionRecord[]): ParsedSession {
  const timestamps = records.map((record) => record.timestamp);
  return {
    sessionId: "session-cost",
    path: "/tmp/session-cost.jsonl",
    startedAt: timestamps.length > 0 ? Math.min(...timestamps) : 0,
    endedAt: timestamps.length > 0 ? Math.max(...timestamps) : 0,
    records,
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    compactEvents: [],
    sidechainMessages: []
  };
}

/**
 * 混合会话：Sonnet 两次（其中一次只有缓存读取，制造一笔 $0.003 的「假零」风险）、
 * Opus 一次、未收录模型一次、缺 usage 一次。
 *
 * 账：输入 $6.00 / 输出 $2.25 / 缓存写入 $0.00 / 缓存读取 $0.003 → 合计 $8.25；
 * 未计入 2 次（gemini + 缺 usage）。
 */
function mixedRecords(): SessionRecord[] {
  return [
    recordOf({
      id: "a1",
      at: T0 + 1_000,
      model: SONNET,
      usage: { inputTokens: 1_000_000, outputTokens: 100_000 }
    }),
    recordOf({
      id: "a2",
      at: T0 + 2_000,
      model: OPUS,
      usage: { inputTokens: 200_000, outputTokens: 10_000 }
    }),
    recordOf({
      id: "a3",
      at: T0 + 3_000,
      model: SONNET,
      usage: { cacheReadTokens: 10_000 }
    }),
    recordOf({
      id: "a4",
      at: T0 + 4_000,
      model: UNKNOWN,
      usage: { inputTokens: 10_000, outputTokens: 1_000 }
    }),
    recordOf({ id: "a5", at: T0 + 5_000, model: SONNET })
  ];
}

function renderView(records: SessionRecord[], onLocateInLog = vi.fn()) {
  const utils = render(
    <CostLedgerView parsed={parsedOf(records)} onLocateInLog={onLocateInLog} />
  );
  return { ...utils, onLocateInLog };
}

function receiptTable(): HTMLElement {
  const table = document.querySelector('[data-probe="cost-receipt"]');
  if (!table) throw new Error("收据表不在场");
  return table as HTMLElement;
}

function receiptRow(key: string): HTMLElement {
  const row = document.querySelector(`[data-probe="cost-receipt-row"][data-class="${key}"]`);
  if (!row) throw new Error(`科目行 ${key} 不在场`);
  return row as HTMLElement;
}

function modelsTable(): HTMLElement {
  const table = document.querySelector('[data-probe="cost-models"]');
  if (!table) throw new Error("按模型表不在场");
  return table as HTMLElement;
}

function topTable(): HTMLElement {
  const table = document.querySelector('[data-probe="cost-top"]');
  if (!table) throw new Error("最贵五次表不在场");
  return table as HTMLElement;
}

/** 三格读数按标签取值，避免依赖 dl 的 DOM 顺序。 */
function statValue(name: string): string {
  const dl = document.querySelector('[data-probe="cost-cache"]');
  if (!dl) throw new Error("缓存读数不在场");
  const terms = [...dl.querySelectorAll("dt")];
  const term = terms.find((node) => node.textContent === name);
  if (!term) throw new Error(`读数额 ${name} 不在场`);
  return term.nextElementSibling?.textContent ?? "";
}

function moneyCells(scope: HTMLElement): string[] {
  return [...scope.querySelectorAll('[data-probe="cost-money"]')].map((node) =>
    (node.textContent ?? "").trim()
  );
}

describe("CostLedgerView · 空态与状态矩阵", () => {
  it("一次模型调用都没有时给出诚实空态，不画卡", () => {
    renderView([recordOf({ id: "u1", at: T0, kind: "user" })]);

    expect(screen.getByText("本会话没有模型调用")).toBeInTheDocument();
    expect(
      screen.getByText("日志里没有带 usage 的助手记录，没有可估算的账单。")
    ).toBeInTheDocument();
    expect(document.querySelector('[data-probe="cost-root"]')).toBeNull();
    expect(screen.queryByText("估算，不是账单 · 定价快照 2026-10-01")).toBeNull();
  });

  it("全部定价未知时不画收据，但保留真实的 token 量与如实说明", () => {
    renderView([
      recordOf({ id: "g1", at: T0 + 1_000, model: UNKNOWN, usage: { inputTokens: 9_000 } }),
      recordOf({ id: "g2", at: T0 + 2_000, model: UNKNOWN })
    ]);

    // 收据整块不渲染：没有可估算的金额。
    expect(document.querySelector('[data-probe="cost-receipt"]')).toBeNull();
    expect(
      screen.getByText("2 次调用无法计价：没有可用的 token 读数，或模型定价未知。")
    ).toBeInTheDocument();
    // 收据没渲染时不出现「另有 N 次」——那是收据的脚注，不是这句说明的重复。
    expect(screen.queryByText(/另有 2 次调用未计入/)).toBeNull();
    // token 量真实存在，所以按模型表照常画，只是金额为 —。
    const models = within(modelsTable());
    expect(models.getByText("gemini-3-pro")).toBeInTheDocument();
    expect(models.getByText("· 定价未知 · 1 次调用")).toBeInTheDocument();
    expect(moneyCells(modelsTable())).toEqual(["—"]);
    expect(screen.getByText("没有可比较的金额，无法排序。")).toBeInTheDocument();
    expect(screen.getByText("估算，不是账单 · 定价快照 2026-10-01")).toBeInTheDocument();
  });

  it("四类 token 全 0 时四行如实写 $0.00，并说明没有可排的先后", () => {
    renderView([
      recordOf({
        id: "z1",
        at: T0 + 1_000,
        model: SONNET,
        usage: { inputTokens: 0, outputTokens: 0 }
      })
    ]);

    const receipt = within(receiptTable());
    expect(receipt.getByText("合计")).toBeInTheDocument();
    expect(receipt.getAllByText("$0.00")).toHaveLength(5); // 四行小计 + 合计
    expect(receipt.getAllByText("0.0%")).toHaveLength(4);
    expect(receipt.getAllByText("—")).toHaveLength(6); // 四行单价 + 合计的 Token / 单价
    expect(receipt.getByText("100.0%")).toBeInTheDocument();
    expect(
      screen.getByText("本会话的调用金额都是 $0.00，没有可排的先后。")
    ).toBeInTheDocument();
    // 没有输入类 token：命中率是「无从谈起」，不是 0%。
    expect(statValue("缓存命中率")).toBe("—");
    expect(
      screen.getByText(/本会话没有输入类 token，命中率无从计算。/)
    ).toBeInTheDocument();
  });
});

describe("CostLedgerView · 收据", () => {
  it("四行按固定顺序渲染，金额与占比逐位可读", () => {
    renderView(mixedRecords());

    const rows = [...document.querySelectorAll('[data-probe="cost-receipt-row"]')];
    expect(rows.map((row) => row.getAttribute("data-class"))).toEqual([
      "input",
      "output",
      "cacheWrite",
      "cacheRead"
    ]);

    expect(receiptRow("input").textContent).toContain("输入");
    expect(receiptRow("input").textContent).toContain("1,200,000");
    expect(receiptRow("input").textContent).toContain("≈$5.00");
    expect(receiptRow("input").textContent).toContain("72.7%");
    expect(receiptRow("input").textContent).toContain("$6.00");

    expect(receiptRow("output").textContent).toContain("110,000");
    expect(receiptRow("output").textContent).toContain("≈$20.45");
    expect(receiptRow("output").textContent).toContain("27.3%");
    expect(receiptRow("output").textContent).toContain("$2.25");

    // 0 token 的科目：单价是无用量、占比是真零。
    expect(receiptRow("cacheWrite").textContent).toContain("0.0%");
    expect(receiptRow("cacheWrite").textContent).toContain("$0.00");

    // 假零风险行：$0.003 必须原样出现，既不是 $0.00 也不是 —。
    expect(receiptRow("cacheRead").textContent).toContain("10,000");
    expect(receiptRow("cacheRead").textContent).toContain("$0.30");
    expect(receiptRow("cacheRead").textContent).toContain("<0.1%");
    expect(receiptRow("cacheRead").textContent).toContain("$0.003");

    // 未计入提示必须同时覆盖两种原因：模型没收录、以及根本没有 usage 读数。
    expect(
      screen.getByText("另有 2 次调用未计入（没有可用的 token 读数，或模型定价未知）")
    ).toBeInTheDocument();

    const total = document.querySelector('[data-probe="cost-receipt-total"]') as HTMLElement;
    expect(total.textContent).toContain("合计");
    expect(total.textContent).toContain("$8.25");
    expect(within(total).getAllByText("—")).toHaveLength(2);

    // 合计 = 四行之和（8.25 = 6 + 2.25 + 0 + 0.003，显示值再相加）。
    expect(
      moneyCells(receiptTable()).map((text) => Number.parseFloat(text.replace(/[^0-9.]/g, "")))
    ).toEqual([6, 2.25, 0, 0.003, 8.25]);
  });

  it("金额格带「美元」读屏句，未知金额读作「定价未知」", () => {
    renderView(mixedRecords());

    const inputSum = receiptRow("input").querySelector('[data-col="sum"]');
    expect(inputSum).toHaveAttribute("aria-label", "小计 6.00 美元");
    const totalSum = document
      .querySelector('[data-probe="cost-receipt-total"]')
      ?.querySelector('[data-col="sum"]');
    expect(totalSum).toHaveAttribute("aria-label", "合计 8.25 美元");

    const unknownRow = [...document.querySelectorAll('[data-probe="cost-model-row"]')].find(
      (row) => row.textContent?.includes("gemini-3-pro")
    ) as HTMLElement;
    expect(unknownRow.querySelector('[data-col="sum"]')).toHaveAttribute(
      "aria-label",
      "小计 定价未知"
    );

    // 占比条只是装饰：读屏读百分比文字，不读轨道。
    const bars = [...document.querySelectorAll('[data-probe="cost-bar"]')];
    expect(bars).toHaveLength(4);
    for (const bar of bars) expect(bar).toHaveAttribute("aria-hidden", "true");
    const fill = receiptRow("input").querySelector('[data-probe="cost-bar"]')
      ?.firstElementChild as HTMLElement;
    expect(fill.style.width.startsWith("72.7")).toBe(true);
  });

  it("只有一档价目时单价是价目本身，不带 ≈", () => {
    renderView([
      recordOf({
        id: "s1",
        at: T0 + 1_000,
        model: SONNET,
        usage: { inputTokens: 100_000 }
      })
    ]);

    const input = receiptRow("input");
    expect(input.textContent).toContain("$0.30"); // 100,000 × $3/M
    expect(input.children[2].textContent).toBe("$3.00");
    expect(input.textContent).not.toContain("≈");
    // 没有用量的科目单价是 —，不是 $0.00。
    expect(receiptRow("output").children[2].textContent).toBe("—");
  });

  it("跨档时该科目的单价带 ≈，只有一档的科目不带", () => {
    renderView(mixedRecords());

    expect(receiptRow("input").children[2].textContent).toBe("≈$5.00");
    expect(receiptRow("output").children[2].textContent).toBe("≈$20.45");
    // 缓存读取只有 Sonnet 一档：不是加权均价。
    expect(receiptRow("cacheRead").children[2].textContent).toBe("$0.30");
  });
});

describe("CostLedgerView · 按模型与缓存", () => {
  it("模型行按金额降序，未知模型排最后且金额为 —", () => {
    renderView(mixedRecords());

    const rows = [...modelsTable().querySelectorAll('[data-probe="cost-model-row"]')];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Sonnet 4.5"),
      expect.stringContaining("Opus 4.1"),
      expect.stringContaining("gemini-3-pro")
    ]);
    expect(rows[0].textContent).toContain("· Sonnet 档 · 2 次调用");
    expect(rows[1].textContent).toContain("· Opus 档 · 1 次调用");
    expect(rows[2].textContent).toContain("· 定价未知 · 1 次调用");

    // 紧凑读数：1M 显示 1.0M，title/aria 保留逐位数字。
    expect(rows[0].textContent).toContain("1.0M");
    expect(rows[0].querySelectorAll("td")[0]).toHaveAttribute(
      "aria-label",
      "输入 1,000,000 token"
    );
    expect(rows[0].querySelectorAll("td")[0]).toHaveAttribute("title", "1,000,000 token");

    // 模型名可截断但完整 id 在 title 里。
    const name = rows[0].querySelector("strong");
    expect(name).toHaveAttribute("title", SONNET);

    expect(moneyCells(modelsTable())).toEqual(["$4.50", "$3.75", "—"]);
    expect(screen.getByText("3 个模型 · 1 个定价未知")).toBeInTheDocument();
    expect(
      screen.getByText(
        "分项为紧凑读数；逐位合计见上方收据。≈ 为按各模型实际用量加权的均价，各模型自己的确定单价见本表。"
      )
    ).toBeInTheDocument();
  });

  it("缺 model 的调用显示（未记录模型），不伪造模型名", () => {
    renderView([
      recordOf({
        id: "m1",
        at: T0 + 1_000,
        model: "claude-haiku-4-5-20251001",
        usage: { inputTokens: 1_000 }
      }),
      // 有 usage、没有 model：能被计入账，但归不到任何模型名下。
      recordOf({ id: "m2", at: T0 + 2_000, usage: { outputTokens: 500 } })
    ]);

    expect(screen.getByText("（未记录模型）")).toBeInTheDocument();
    expect(screen.getByText("· 定价未知 · 1 次调用")).toBeInTheDocument();
  });

  it("缓存三格：命中率、读取量、省下的估算值", () => {
    renderView(mixedRecords());

    expect(statValue("缓存命中率")).toBe("0.8%");
    expect(statValue("缓存读取（token）")).toBe("10,000");
    expect(statValue("省下（估算）")).toBe("$0.03");
    expect(screen.getByText(/^按可定价调用计算。/)).toBeInTheDocument();
    expect(screen.getByText("按可定价调用计算")).toBeInTheDocument();
  });
});

describe("CostLedgerView · 最贵五次与跳转", () => {
  it("按小计降序最多五笔，点时刻回到日志并定位该记录", async () => {
    const user = userEvent.setup();
    const onLocateInLog = vi.fn();
    renderView(mixedRecords(), onLocateInLog);

    const rows = [...topTable().querySelectorAll('[data-probe="cost-top-row"]')];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("10:42:01");
    expect(rows[0].textContent).toContain("$4.50");
    expect(rows[1].textContent).toContain("$3.75");
    expect(rows[2].textContent).toContain("$0.003");

    const button = within(rows[0] as HTMLElement).getByRole("button", {
      name: "跳到日志：10:42:01 的模型调用（Sonnet 4.5，小计 4.50 美元）"
    });
    await user.click(button);
    expect(onLocateInLog).toHaveBeenCalledWith("a1");
  });

  it("收据/按模型/最贵五次共用同一套 money 锚点，合计也在其中", () => {
    renderView(mixedRecords());

    const receiptMoney = moneyCells(receiptTable());
    expect(receiptMoney).toEqual(["$6.00", "$2.25", "$0.00", "$0.003", "$8.25"]);
    expect(document.querySelectorAll('[data-probe="cost-money"]').length).toBe(5 + 3 + 3);
  });
});

describe("CostLedgerView · 结构与无障碍", () => {
  it("内容确实溢出时出现静态滚动提示，滚到底就消失", () => {
    renderView(mixedRecords());
    const scroll = document.querySelector('[data-probe="cost-scroll"]') as HTMLElement;
    expect(document.querySelector('[data-probe="cost-fade"]')).toBeNull();

    // jsdom 没有排版：显式给出视口 / 内容高度，再走一遍真实的 scroll 事件。
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 800 });
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 400 });
    fireEvent.scroll(scroll);
    expect(document.querySelector('[data-probe="cost-fade"]')).not.toBeNull();

    Object.defineProperty(scroll, "scrollTop", { configurable: true, value: 400 });
    fireEvent.scroll(scroll);
    expect(document.querySelector('[data-probe="cost-fade"]')).toBeNull();
  });

  it("内容不溢出时滚动提示从不出现", () => {
    renderView(mixedRecords());
    const scroll = document.querySelector('[data-probe="cost-scroll"]') as HTMLElement;
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 300 });
    fireEvent.scroll(scroll);
    expect(document.querySelector('[data-probe="cost-fade"]')).toBeNull();
  });

  it("滚动提示只是装饰：aria-hidden、无文案、无焦点目标，且在滚动区外", () => {
    renderView(mixedRecords());
    const scroll = document.querySelector('[data-probe="cost-scroll"]') as HTMLElement;
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 800 });
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 400 });
    fireEvent.scroll(scroll);

    const fade = document.querySelector('[data-probe="cost-fade"]') as HTMLElement;
    expect(fade).toHaveAttribute("aria-hidden", "true");
    expect(fade.textContent).toBe("");
    expect(fade.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
    // 覆盖层不能跟着内容滚走，所以它在 .scroll 外面。
    expect(scroll.contains(fade)).toBe(false);
    expect(fade.parentElement).toBe(scroll.parentElement);
  });

  it("卡内只有一个滚动容器，脚注在滚动区外", () => {
    renderView(mixedRecords());

    expect(document.querySelector('[data-probe="cost-root"]')).not.toBeNull();
    const scroll = document.querySelector('[data-probe="cost-scroll"]') as HTMLElement;
    expect(scroll).toHaveAttribute("tabindex", "0");
    expect(scroll).toHaveAttribute("aria-label", "账单内容");
    expect(scroll.contains(document.querySelector('[data-probe="cost-footnote"]'))).toBe(false);

    // 收据有 caption 与 scope="row" 的科目格，金额列在最右。
    const receipt = receiptTable();
    expect(receipt.querySelector("caption")?.textContent).toBe(
      "会话账单：四类 token 的用量、单价、占比与小计，最后一行是合计"
    );
    expect(receipt.querySelectorAll('th[scope="row"]')).toHaveLength(5); // 四行 + 合计
    expect(
      screen.getByRole("region", { name: "费用收据" })
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "会话账单" })).toBeInTheDocument();
  });

  it("脚注常驻且含快照日期", () => {
    renderView(mixedRecords());

    const footnote = document.querySelector('[data-probe="cost-footnote"]');
    expect(footnote?.textContent).toBe("估算，不是账单 · 定价快照 2026-10-01");
  });
});
