import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { EchoPanel, ECHO_MAX_DODGE, ECHO_TICK_WIDTH, echoTickPositions } from "./EchoPanel";

/**
 * Issue #371 的界面层：三类空态、总结句、组头读数、频率条刻度（含同一天
 * dodge）、展开/收起、会话行与「代表」标记、点击打开会话，以及 `days` 真的
 * 传进了 `buildEchoGroups`。
 *
 * 聚类本身由 `echoTopics.test.ts` 覆盖；这里只断言界面把事实呈现对了没有。
 */

const NOW = new Date(2026, 0, 15, 18, 0).getTime();
const DAYS = 30;
const SONNET = "claude-sonnet-4-5-20250929";
/** 定价快照里没有这个模型——整组金额必须是 `null`，不能编成 `$0.00`。 */
const MYSTERY = "mystery-model-1";

function at(day: number, hour = 10, minute = 0): number {
  return new Date(2026, 0, day, hour, minute, 0).getTime();
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

type InputOptions = {
  path: string;
  timestamp: number;
  /** `undefined` = 给一条没有 usage 的记录，金额因此是 0。 */
  tokens?: number;
  model?: string;
  customTitle?: string;
  userPrompt?: string;
  projectLabel?: string;
};

function inputOf(options: InputOptions): UsageSessionInput {
  const meta: SessionMeta = {
    path: options.path,
    mtimeMs: NOW,
    sizeBytes: 0,
    projectLabel: options.projectLabel ?? "repo",
    hasRecords: true,
    ...(options.customTitle !== undefined ? { customTitle: options.customTitle } : {}),
    ...(options.userPrompt !== undefined ? { userPrompt: options.userPrompt } : {})
  };
  const record = recordOf(`${options.path}-1`, options.timestamp, {
    ...(options.tokens !== undefined
      ? {
          model: options.model ?? SONNET,
          usage: { inputTokens: options.tokens }
        }
      : {})
  });
  return { projectLabel: meta.projectLabel, session: meta, records: [record] };
}

/** 两条标题与首条消息相同 = 同一话题；时间由调用方决定。 */
function twin(
  path: string,
  timestamp: number,
  title = "修复登录接口的超时问题",
  tokens?: number
): UsageSessionInput {
  return inputOf({ path, timestamp, customTitle: title, userPrompt: title, tokens });
}

function renderPanel(
  inputs: UsageSessionInput[],
  overrides: Partial<{ days: number; onOpenSession: (session: SessionMeta) => void }> = {}
) {
  return render(
    <EchoPanel
      inputs={inputs}
      days={overrides.days ?? DAYS}
      now={NOW}
      onOpenSession={overrides.onOpenSession}
    />
  );
}

describe("空态", () => {
  it("窗口里没有会话", () => {
    renderPanel([]);
    expect(screen.getByText("本窗口还没有会话")).toBeInTheDocument();
    expect(screen.queryByText(/组重复话题/)).toBeNull();
  });

  it("窗口里只有 1 个会话：重复至少需要 2 个", () => {
    renderPanel([twin("/logs/only.jsonl", at(15))]);
    expect(screen.getByText("本窗口只有 1 个会话，重复至少需要 2 个")).toBeInTheDocument();
  });

  it("有多个会话但没有重复话题，并给出描述", () => {
    renderPanel([
      inputOf({
        path: "/logs/a.jsonl",
        timestamp: at(14),
        customTitle: "alpha quartz",
        userPrompt: "alpha quartz"
      }),
      inputOf({
        path: "/logs/b.jsonl",
        timestamp: at(13),
        customTitle: "beta zircon",
        userPrompt: "beta zircon"
      })
    ]);
    expect(screen.getByText("没有发现重复话题")).toBeInTheDocument();
    expect(
      screen.getByText("窗口内没有两条会话的标题或首条消息相似到可以算作同一件事")
    ).toBeInTheDocument();
  });

  it("被排除的会话（缺标题与首条消息）补一句说明", () => {
    renderPanel([
      inputOf({
        path: "/logs/a.jsonl",
        timestamp: at(14),
        customTitle: "alpha quartz",
        userPrompt: "alpha quartz"
      }),
      inputOf({
        path: "/logs/b.jsonl",
        timestamp: at(13),
        customTitle: "beta zircon",
        userPrompt: "beta zircon"
      }),
      inputOf({
        path: "/logs/silent.jsonl",
        timestamp: at(12),
        customTitle: "",
        userPrompt: "",
        projectLabel: ""
      })
    ]);
    expect(screen.getByText("没有发现重复话题")).toBeInTheDocument();
    expect(
      screen.getByText("另有 1 个会话缺少标题与首条消息，未参与比较。")
    ).toBeInTheDocument();
  });
});

describe("总结句与组头", () => {
  it("总结句写出组数 / 会话数与金额", () => {
    renderPanel([
      twin("/logs/a.jsonl", at(15, 10), "修复登录接口的超时问题", 100_000),
      twin("/logs/b.jsonl", at(15, 12), "修复登录接口的超时问题", 50_000)
    ]);

    expect(screen.getByText(/发现/)).toHaveTextContent(
      /发现\s*1\s*组重复话题，共\s*2\s*个会话、\$[\d.]+。/
    );
    // 组头读数：会话数、金额、跨度各就各位。
    const head = screen.getByRole("button", { name: /^展开：修复登录接口的超时问题/ });
    expect(head).toHaveTextContent("2 个会话");
    expect(head).toHaveTextContent(/\$[\d.]+/);
    expect(head).toHaveTextContent("跨度 1 天");
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(head).toHaveAttribute("aria-controls", "echo-sessions-0");
  });

  it("按钮 aria-label 带全文标题，标题不被数据层裁短", () => {
    const longTitle =
      "把认证中间件的刷新令牌、设备指纹与并发会话这三条路径一次讲清楚并给出可以落地的改法";
    renderPanel([twin("/logs/a.jsonl", at(15, 10), longTitle), twin("/logs/b.jsonl", at(15, 12), longTitle)]);

    const head = screen.getByRole("button", {
      name: `展开：${longTitle}，2 个会话，估算 $0.00，跨度 1 天`
    });
    expect(head).toBeInTheDocument();
    expect(screen.getByTitle(longTitle)).toBeInTheDocument();
  });

  it("未定价模型：组头显示 —，总结句写金额未知", () => {
    renderPanel([
      twin("/logs/a.jsonl", at(15), "修复登录接口的超时问题", 1_000),
      inputOf({
        path: "/logs/b.jsonl",
        timestamp: at(14),
        customTitle: "修复登录接口的超时问题",
        userPrompt: "修复登录接口的超时问题",
        tokens: 2_000,
        model: MYSTERY
      })
    ]);

    const head = screen.getByRole("button", { name: /^展开：/ });
    expect(head).toHaveTextContent("—");
    expect(head.getAttribute("aria-label")).toContain("估算 金额未知");
    expect(screen.getByText(/发现/)).toHaveTextContent("金额未知");
  });

  it("组数不设上限：七组全部渲染", () => {
    const inputs: UsageSessionInput[] = [];
    for (let index = 0; index < 7; index += 1) {
      const title = `topic${index}quartz${index}`;
      inputs.push(twin(`/logs/${index}-a.jsonl`, at(15, 10 + index), title));
      inputs.push(twin(`/logs/${index}-b.jsonl`, at(15, 11 + index), title));
    }
    renderPanel(inputs);

    expect(screen.getAllByRole("button", { name: /^展开：/ })).toHaveLength(7);
    expect(screen.getByText(/发现/)).toHaveTextContent("7");
  });

  it("同一组超过 20 个会话也不截断、不折叠、不显示 +N", async () => {
    const user = userEvent.setup();
    const inputs = Array.from({ length: 21 }, (_, index) =>
      twin(`/logs/many-${index}.jsonl`, at(15, 10), "同一个问题的第二十一次追问", 1_000)
    );
    const { container } = renderPanel(inputs);

    const head = screen.getByRole("button", { name: /^展开：/ });
    expect(head).toHaveTextContent("21 个会话");
    expect(container.querySelectorAll("[data-echo-tick]")).toHaveLength(21);

    // 展开后 21 行都在；没有「+N」折行。
    expect(screen.queryAllByRole("button", { name: /打开会话：/ })).toHaveLength(0);
    await user.click(head);
    expect(screen.getAllByRole("button", { name: /打开会话：/ })).toHaveLength(21);
    expect(screen.queryByText(/^\+\d+/)).toBeNull();
  });
});

describe("频率条", () => {
  it("每个会话一个刻度，刻度与轴标签对读屏隐藏", () => {
    const { container } = renderPanel([
      twin("/logs/a.jsonl", at(15, 10), "修复登录接口的超时问题", 1_000),
      twin("/logs/b.jsonl", at(15, 12), "修复登录接口的超时问题", 1_000),
      twin("/logs/c.jsonl", at(15, 14), "修复登录接口的超时问题", 1_000)
    ]);

    expect(container.querySelectorAll("[data-echo-tick]")).toHaveLength(3);
    expect(container.querySelector("[data-echo-strip]")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-echo-axis]")).toHaveAttribute("aria-hidden", "true");
  });

  it("同一天连问三次：dodge 让三个刻度分别露出", () => {
    const day = at(15, 10);
    const sessions = [0, 1, 2].map((index) => ({
      id: `s${index}`,
      title: "同一句",
      usd: 0,
      at: day
    }));

    const xs = echoTickPositions(sessions, 960);
    // 同一时刻的 rawX 相同（10:00 落在一天 41.5% 处），dodge 依次推开 5px。
    expect(xs[1] - xs[0]).toBe(ECHO_MAX_DODGE);
    expect(xs[2] - xs[1]).toBe(ECHO_MAX_DODGE);
    expect(xs[0]).toBeCloseTo((10 / 24) * (960 - ECHO_TICK_WIDTH), 5);
    expect(ECHO_TICK_WIDTH).toBe(3);
  });

  it("不同时间的刻度按比例落位且保持升序", () => {
    const xs = echoTickPositions(
      [
        { id: "a", title: "a", usd: 0, at: new Date(2026, 0, 15, 0, 0).getTime() },
        { id: "b", title: "b", usd: 0, at: new Date(2026, 0, 15, 12, 0).getTime() },
        { id: "c", title: "c", usd: 0, at: new Date(2026, 0, 16, 0, 0).getTime() }
      ],
      100
    );

    expect(xs[0]).toBe(0);
    expect(xs[1]).toBeCloseTo(24.25, 5);
    expect(xs[2]).toBeCloseTo(48.5, 5);
  });

  it("窄轨道也不越界：最后一个刻度不超出 width - 3", () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      id: `s${index}`,
      title: "同一句",
      usd: 0,
      at: new Date(2026, 0, 15, 10, 0).getTime()
    }));

    const xs = echoTickPositions(sessions, 20);
    expect(xs[0]).toBeCloseTo((10 / 24) * (20 - ECHO_TICK_WIDTH), 5);
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]).toBeGreaterThanOrEqual(xs[index - 1]);
    }
    expect(xs.at(-1)).toBe(17);
  });

  it("同一本地日只显示左端日期；不同日两端都显示", () => {
    const { container: oneDay } = renderPanel([
      twin("/logs/a.jsonl", at(15, 10)),
      twin("/logs/b.jsonl", at(15, 14))
    ]);
    expect(oneDay.querySelectorAll("[data-echo-axis] span")).toHaveLength(1);
    expect(oneDay.querySelector("[data-echo-axis]")?.textContent).toBe("1/15");

    const { container: twoDays } = renderPanel([
      twin("/logs/a.jsonl", at(13, 10)),
      twin("/logs/b.jsonl", at(15, 14))
    ]);
    expect(twoDays.querySelectorAll("[data-echo-axis] span")).toHaveLength(2);
    expect(twoDays.querySelector("[data-echo-axis]")?.textContent).toBe("1/13" + "1/15");
  });

  it("跨年用完整日期", () => {
    const { container } = renderPanel(
      [
        twin("/logs/a.jsonl", new Date(2025, 11, 31, 10, 0).getTime()),
        twin("/logs/b.jsonl", new Date(2026, 0, 1, 14, 0).getTime())
      ],
      { days: 365 }
    );
    const axis = container.querySelector("[data-echo-axis]")?.textContent ?? "";
    expect(axis).toBe("2025-12-31" + "2026-01-01");
  });
});

describe("展开与打开会话", () => {
  it("点击组头展开 / 收起；行按时间升序，代表行带纯文本标记", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = renderPanel(
      [
        twin("/logs/late.jsonl", at(15, 14), "修复登录接口的超时问题", 1_000),
        twin("/logs/early.jsonl", at(10, 9), "修复登录接口的超时问题", 1_000),
        twin("/logs/mid.jsonl", at(12, 9), "修复登录接口的超时问题", 1_000)
      ],
      { onOpenSession: onOpen }
    );

    const head = screen.getByRole("button", { name: /^展开：/ });
    await user.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");

    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-echo-session]"));
    expect(rows).toHaveLength(3);
    // 第一次问在前。
    expect(rows[0].getAttribute("data-echo-session")).toBe("path:/logs/early.jsonl");
    // 代表 = 逻辑层选出的那条（group.key）；这一组里最早的那条胜出（token 全同）。
    expect(within(rows[0]).getByText("代表")).toBeInTheDocument();
    expect(within(rows[1]).queryByText("代表")).toBeNull();
    expect(rows[0].getAttribute("aria-label")).toContain("代表会话，打开会话：");
    expect(rows[1].getAttribute("aria-label")).not.toContain("代表会话，");

    // 点击一行真的把 SessionMeta 交给调用方。
    await user.click(rows[1]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ path: "/logs/mid.jsonl" });

    // 再点组头收起：列表不预留高度，直接卸载。
    await user.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelectorAll("[data-echo-session]")).toHaveLength(0);
  });

  it("键盘：组头可聚焦，Enter / 空格切换展开", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel([
      twin("/logs/a.jsonl", at(15, 10)),
      twin("/logs/b.jsonl", at(15, 12))
    ]);

    const head = screen.getByRole("button", { name: /^展开：/ });
    head.focus();
    expect(head).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelectorAll("[data-echo-session]")).toHaveLength(2);

    await user.keyboard(" ");
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelectorAll("[data-echo-session]")).toHaveLength(0);
  });

  it("展开行显示 formatShortStamp 时间、标题、代表标记与单条花费", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel(
      [
        twin("/logs/a.jsonl", at(15, 10), "修复登录接口的超时问题", 10_000),
        twin("/logs/b.jsonl", at(15, 12), "修复登录接口的超时问题", 20_000)
      ],
      { onOpenSession: vi.fn() }
    );

    await user.click(screen.getByRole("button", { name: /^展开：/ }));
    const row = container.querySelector<HTMLElement>("[data-echo-session]");
    expect(row).not.toBeNull();
    // `1-15 10:00`
    expect(row).toHaveTextContent("01-15 10:00");
    expect(row).toHaveTextContent("修复登录接口的超时问题");
    expect(row).toHaveTextContent(/\$\d/);
    expect(row).not.toBeDisabled();
  });
});

describe("days 传递", () => {
  it("7 天档位看不到 14 天前的重复；30 天档位能看到", () => {
    const inputs = [
      twin("/logs/a.jsonl", at(1, 10)),
      twin("/logs/b.jsonl", at(2, 10))
    ];

    const { unmount } = renderPanel(inputs, { days: 7 });
    expect(screen.getByText("本窗口还没有会话")).toBeInTheDocument();
    unmount();

    renderPanel(inputs, { days: 30 });
    expect(screen.getByText(/发现/)).toHaveTextContent("1 组重复话题");
  });
});
