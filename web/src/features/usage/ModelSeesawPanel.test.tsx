import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsageSessionInput } from "./usageAggregations";
import type { SessionRecord } from "../sessions/types";
import { ModelSeesawPanel } from "./ModelSeesawPanel";

/* ── H6 模型跷跷板（Round HH，§4.6）─────────────────────────────
 *
 * 夹具：两个模型跨三个月的用量。NOW 锚 2026-01-15——所有记录月都
 * >= 锚月，末月由记录决定、不跟本机时钟漂（modelSeesaw.test 同款锚法）。
 * 总量并列 6k：`localeCompare` 下 'o' < 's'，所以默认 A=opus、B=sonnet。
 * 模型 A（opus）：  2025-11: 3k → 2025-12: 2k → 2026-01: 1k（回落）
 * 模型 B（sonnet）：2025-11: 1k → 2025-12: 2k → 2026-01: 3k（爬升）
 * 共刻度 max = 3k：A 三月 100%/67%/33%，B 33%/67%/100%。
 */

const NOW = Date.parse("2026-01-15T12:00:00.000Z");

function usageRecord(id: string, at: number, model: string, tokens: number): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    model,
    usage: { inputTokens: tokens }
  };
}

const NOV = Date.parse("2025-11-10T12:00:00.000Z");
const DEC = Date.parse("2025-12-10T12:00:00.000Z");
const JAN = Date.parse("2026-01-10T12:00:00.000Z");

const SONNET = "claude-sonnet-4-5-20250929";
const OPUS = "claude-opus-4-1-20250805";

const inputs: UsageSessionInput[] = [
  {
    projectLabel: "demo",
    records: [
      usageRecord("a1", NOV, SONNET, 1_000),
      usageRecord("a2", DEC, SONNET, 2_000),
      usageRecord("a3", JAN, SONNET, 3_000),
      usageRecord("b1", NOV, OPUS, 3_000),
      usageRecord("b2", DEC, OPUS, 2_000),
      usageRecord("b3", JAN, OPUS, 1_000)
    ]
  }
];

function renderPanel(sessions: readonly UsageSessionInput[] = inputs) {
  return render(
    <ModelSeesawPanel sessions={sessions} months={3} now={NOW} />
  );
}

describe("ModelSeesawPanel（H6 模型跷跷板）", () => {
  it("正常态：三月行按序渲染，条宽按共刻度，月份读数齐全", () => {
    renderPanel();

    const wrap = document.querySelector<HTMLElement>('[data-probe="model-seesaw"]');
    expect(wrap).not.toBeNull();
    const rows = document.querySelectorAll('[data-probe="seesaw-row"]');
    expect(rows.length).toBe(3);
    expect(rows[0].getAttribute("data-month")).toBe("2025-11");
    expect(rows[2].getAttribute("data-month")).toBe("2026-1");

    // 共刻度 3k：2026-1 的 A（opus，1k）33%、B（sonnet，3k）100%——两侧同一分母。
    // 选择器必须避开外层 `.bars`（也含 "bar" 子串），否则拿到的是容器。
    const jan = rows[2];
    expect(jan.querySelector<HTMLElement>("[class*='barA']")?.style.width).toBe(
      "33.33333333333333%"
    );
    expect(jan.querySelector<HTMLElement>("[class*='barB']")?.style.width).toBe("100%");
    expect(within(jan as HTMLElement).getByText("1,000 / 3,000")).toBeInTheDocument();

    // 脚注：口径句 + overlap 样本量（三月双侧都有 → 3）。
    expect(screen.getByText(/两模型同月都有用量的月数：3/)).toBeInTheDocument();
  });

  it("单侧归零月照列：迁移形状是读数，不是残缺", () => {
    // 只有 sonnet 的会话：opus 侧全 0，但它仍是候选（带 usage 记录的模型）。
    const sonnetOnly: UsageSessionInput[] = [
      {
        projectLabel: "demo",
        records: [usageRecord("a1", NOV, SONNET, 1_000), usageRecord("a2", JAN, SONNET, 2_000)]
      },
      {
        projectLabel: "demo2",
        records: [usageRecord("z1", JAN, OPUS, 500)]
      }
    ];
    render(
      <ModelSeesawPanel sessions={sonnetOnly} months={3} now={NOW} />
    );

    const rows = document.querySelectorAll('[data-probe="seesaw-row"]');
    expect(rows.length).toBe(3); // 2025-11、2025-12（空）、2026-1
    // 2025-12 空月也有一行：两侧都是 0。
    const dec = rows[1];
    expect(within(dec as HTMLElement).getByText("0 / 0")).toBeInTheDocument();
  });

  it("空态：不足两个模型给诚实句，不画空架子", () => {
    const single: UsageSessionInput[] = [
      { projectLabel: "demo", records: [usageRecord("a1", NOV, SONNET, 1_000)] }
    ];
    render(<ModelSeesawPanel sessions={single} months={3} now={NOW} />);

    expect(screen.getByText("窗口内不足两个模型，无法对比")).toBeInTheDocument();
    expect(document.querySelector('[data-probe="model-seesaw"]')).toBeNull();
  });

  it("选择同一模型：提示与自身比较无意义，picker 仍可改选", async () => {
    const user = userEvent.setup();
    renderPanel();

    const selectB = screen.getByRole("combobox", { name: "模型 B" });
    // 默认 A=opus、B=sonnet：把 B 选成 opus 即同模型。
    await user.selectOptions(selectB, OPUS);

    expect(screen.getByText("两个选择是同一个模型，与自身比较没有意义")).toBeInTheDocument();
    expect(document.querySelector('[data-probe="seesaw-row"]')).toBeNull();
    // 同模型态整个子树被替换，旧句柄已脱离文档——重新取一次再改回来。
    await user.selectOptions(screen.getByRole("combobox", { name: "模型 B" }), SONNET);
    expect(document.querySelectorAll('[data-probe="seesaw-row"]').length).toBe(3);
  });

  it("双 picker 默认选 token 最多的两个模型，切换即重算", async () => {
    const user = userEvent.setup();
    renderPanel();

    // 默认 A=opus（6k 并列，字典序 'o' < 's' 排前）B=sonnet（6k）。
    expect(screen.getByRole("combobox", { name: "模型 A" })).toHaveValue(OPUS);
    expect(screen.getByRole("combobox", { name: "模型 B" })).toHaveValue(SONNET);

    // 交换两侧：B 先选到 opus（进同模型态，行消失），A 再选 sonnet 完成交换。
    await user.selectOptions(screen.getByRole("combobox", { name: "模型 B" }), OPUS);
    expect(document.querySelector('[data-probe="seesaw-row"]')).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "模型 A" }), SONNET);

    const jan = document.querySelectorAll('[data-probe="seesaw-row"]')[2];
    expect(within(jan as HTMLElement).getByText("3,000 / 1,000")).toBeInTheDocument();
    expect(jan.querySelector<HTMLElement>("[class*='barA']")?.style.width).toBe("100%");
    expect(jan.querySelector<HTMLElement>("[class*='barB']")?.style.width).toBe(
      "33.33333333333333%"
    );
  });

  it("窗口内两模型都无记录：给「都没有用量记录」不空转", () => {
    // 记录都在，但选不出候选之外的——这里直接喂空 records 的会话。
    const empty: UsageSessionInput[] = [{ projectLabel: "demo", records: [] }];
    const { rerender } = render(<ModelSeesawPanel sessions={empty} months={3} now={NOW} />);
    expect(screen.getByText("窗口内不足两个模型，无法对比")).toBeInTheDocument();

    // 边界：三个月窗口、只有一条 user 记录（无 usage/model）也不够两模型。
    const noUsage: UsageSessionInput[] = [
      {
        projectLabel: "demo",
        records: [
          {
            id: "u1",
            fullId: "u1",
            kind: "user",
            timestamp: NOV,
            durationMs: 0,
            text: "hi",
            isError: false,
            raw: {}
          }
        ]
      }
    ];
    rerender(<ModelSeesawPanel sessions={noUsage} months={3} now={NOW} />);
    expect(screen.getByText("窗口内不足两个模型，无法对比")).toBeInTheDocument();
  });
});
