import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BleedView } from "./BleedView";
import { parseJsonlText } from "./parseJsonl";

import compactFixture from "../../../tests/fixtures/compact-session.jsonl?raw";
import noneFixture from "../../../tests/fixtures/pulse-compact-none.jsonl?raw";
import censusFixture from "../../../tests/fixtures/tool-census-session.jsonl?raw";

function parsedCompact() {
  return parseJsonlText(compactFixture, "/tmp/compact-session.jsonl");
}

function parsedNoCompaction() {
  return parseJsonlText(noneFixture, "/tmp/pulse-compact-none.jsonl");
}

/**
 * 工具类条目（`evidence === "countOnly"`）需要**同时**有 tool 记录与压缩事件
 * 才进得了清单——现有共享夹具里没有一个两者兼有（`tool-census-session.jsonl`
 * 有 13 条 tool 记录但 0 个压缩边界，会走空态）。这里给该夹具补一个压缩边界，
 * 让清单真的渲染出来；不新建夹具，避免与 X1/X3 争夹具文件。
 */
function parsedWithTools() {
  const parsed = parseJsonlText(censusFixture, "/tmp/tool-census-session.jsonl");
  return {
    ...parsed,
    compactEvents: [
      {
        id: "evt-tools-1",
        timestamp: (parsed.records[0]?.timestamp ?? Date.now()) + 1000,
        trigger: "auto",
        preTokens: 120000,
        postTokens: 9000,
        droppedTokens: 111000,
        durationMs: 40000,
        survivedUuids: [],
        summaryText: null,
        summaryUuid: null,
        logicalParentUuid: null
      }
    ]
  };
}

/** 清单本体：`<ul>` 带名字，避免与页面上别的 list 混淆。 */
function bleedList() {
  return screen.getByRole("list", { name: "出血清单" });
}

/** 按 `aria-label` 取某一条：条目顺序属于 `bleedModel`，测试不该依赖下标。 */
function rowByKind(kind: "压缩" | "工具" | "缓存重写", index = 0) {
  return within(bleedList()).getAllByRole("listitem", { name: kind })[index];
}

describe("BleedView 空态", () => {
  it("没有压缩事件 → 「本会话没有发生压缩」，不渲染清单", () => {
    render(<BleedView parsed={parsedNoCompaction()} />);

    expect(screen.getByText("本会话没有发生压缩")).toBeInTheDocument();
    // 另一个空态的文案**必须不出现**——两种空态是不同的两件事。
    expect(screen.queryByText("压缩了但没丢东西")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "出血清单" })).not.toBeInTheDocument();
  });

  it("两种空态文案确实不同", () => {
    // 没有压缩：这一页没有东西可讲。
    const first = render(<BleedView parsed={parsedNoCompaction()} />);
    const noCompaction = document.body.textContent ?? "";
    first.unmount();

    // 有压缩但一条消息都没丢：`bleedModel` 会产出一条「丢掉 0 条消息」的
    // compaction 条目（items 非空、recordIds 为空）。这时不能因为 items
    // 非空就假装有东西可看，也不能退回「没有发生压缩」。
    const second = render(
      <BleedView
        parsed={{
          ...parsedNoCompaction(),
          records: [],
          turns: [],
          compactEvents: [
            {
              id: "evt-1",
              timestamp: Date.now(),
              trigger: "auto",
              preTokens: 1000,
              postTokens: 900,
              droppedTokens: 100,
              durationMs: 10,
              survivedUuids: [],
              summaryText: null,
              summaryUuid: null,
              logicalParentUuid: null
            }
          ]
        }}
      />
    );
    const noLoss = document.body.textContent ?? "";
    second.unmount();

    expect(noCompaction).toContain("本会话没有发生压缩");
    expect(noCompaction).not.toContain("压缩了但没丢东西");
    expect(noLoss).toContain("压缩了但没丢东西");
    expect(noLoss).not.toContain("本会话没有发生压缩");
    // 「丢掉 0 条消息」不渲染——一个 0 的清单行不是信息，是一句噪音。
    expect(screen.queryByRole("list", { name: "出血清单" })).not.toBeInTheDocument();
  });
});

describe("BleedView 出血清单", () => {
  it("渲染四类计数器，且**分开**成四个读数、没有被求和成一个数", () => {
    render(<BleedView parsed={parsedCompact()} />);

    const list = bleedList();
    const firstRow = within(list).getAllByRole("listitem")[0];
    // 夹具实测：压缩 #1 丢掉 94 条消息。
    expect(within(firstRow).getByText("压缩 #1 · 丢掉 94 条消息")).toBeInTheDocument();

    // 四类计数器各自有名字与读数，是四个配对，不是一个合计。
    for (const name of ["输入", "缓存写入", "缓存读取", "输出"]) {
      expect(within(firstRow).getByText(name)).toBeInTheDocument();
    }
    // 求和后的 total（3,845,108）**绝不出现在页面上**——total 只做分母。
    expect(within(firstRow).queryByText("3,845,108")).not.toBeInTheDocument();
    expect(within(firstRow).queryByText("3.8M")).not.toBeInTheDocument();
    // 四类里最大的一类读数在场（cacheRead 3,661,300 → 3.7M，formatTokenCount）。
    expect(within(firstRow).getByText("3.7M")).toBeInTheDocument();
  });

  it("四栏读数 = 日志事实，带精确值的 title", () => {
    render(<BleedView parsed={parsedCompact()} />);

    const list = bleedList();
    const firstRow = within(list).getAllByRole("listitem")[0];
    expect(within(firstRow).getByText("50,948")).toBeInTheDocument(); // input
    expect(within(firstRow).getByText("50,948")).toHaveAttribute("title", "50,948");
  });

  it("usd === null 走「定价未知」，**不是 $0.00**", () => {
    // toolOutput 类恒为 usd = null（工具记录不带 usage，无法定价）。
    // 这是本轮最重要的诚实性断言：未知不能冒充零。
    render(<BleedView parsed={parsedWithTools()} />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("定价未知");
    expect(text).not.toContain("$0.00");
  });

  it("countOnly 条目不渲染 token 四栏，改渲染说明", () => {
    render(<BleedView parsed={parsedWithTools()} />);

    // 工具类：没有可信的 token 量，不许把恒为 0 的 totals 画成读数。
    const toolRow = rowByKind("工具");
    expect(within(toolRow).getByText("本实现无法从日志得出这些调用的 token 量")).toBeInTheDocument();
    expect(within(toolRow).queryByText("输入")).not.toBeInTheDocument();
    expect(within(toolRow).queryByText("缓存读取")).not.toBeInTheDocument();
  });

  it("countOnly 条目的「未计入」写的是调用数，不是「0 次未计入」", () => {
    render(<BleedView parsed={parsedWithTools()} />);

    // Bash · 2 次调用 → 2 次未计入。
    const toolRow = rowByKind("工具");
    expect(within(toolRow).getByText("Bash · 2 次调用")).toBeInTheDocument();
    expect(within(toolRow).getByText(/2 次调用未计入/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("0 次调用未计入");
  });

  it("有已定价金额时显示金额，并注明未计入的调用数", () => {
    render(<BleedView parsed={parsedCompact()} />);

    const list = bleedList();
    const firstRow = within(list).getAllByRole("listitem")[0];
    // usd = 1.922259 → $1.92；另有 47 次调用定价未知。
    expect(within(firstRow).getByText("$1.92")).toBeInTheDocument();
    expect(within(firstRow).getByText(/另有 47 次调用定价未知，未计入/)).toBeInTheDocument();
  });
});

describe("BleedView 结论文案与来源", () => {
  it("结论行来自 bleedHeadline，配估算来源徽章与快照日期", () => {
    render(<BleedView parsed={parsedCompact()} />);

    expect(screen.getByText("2 次压缩丢掉了 176 条消息")).toBeInTheDocument();
    expect(
      screen.getByLabelText("数据来源：按定价快照估算，快照日期 2026-10-01")
    ).toBeInTheDocument();
  });

  it("没有已定价金额时信息来源降级为「读自日志」", () => {
    render(<BleedView parsed={parsedWithTools()} />);

    // 该夹具只有 countOnly 条目、无金额可用：来源不该自称「估算」。
    expect(screen.getByLabelText("数据来源：读自日志")).toBeInTheDocument();
  });
});

describe("BleedView 排序口径", () => {
  it("清单按 report.items 原序渲染，不重排；排序说明不写「按占用降序」", () => {
    render(<BleedView parsed={parsedCompact()} />);

    const list = bleedList();
    const rows = within(list).getAllByRole("listitem");
    // 压缩 #1 在 #2 之前（按时间）。
    expect(rows[0].textContent).toContain("压缩 #1");
    expect(rows[1].textContent).toContain("压缩 #2");

    const text = document.body.textContent ?? "";
    // 工具类没有可信的 token 量可排，不能声称「按占用降序」。
    expect(text).toContain("压缩按时间");
    expect(text).not.toContain("按占用降序");
  });
});
