import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextView } from "./ContextView";
import { parseJsonlText } from "./parseJsonl";

import compactFixture from "../../../tests/fixtures/compact-session.jsonl?raw";
import basicFixture from "../../../tests/fixtures/session-basic.jsonl?raw";

function parsedCompact() {
  return parseJsonlText(compactFixture, "/tmp/compact-session.jsonl");
}

function chartRegion() {
  return screen.getByRole("img", { name: /上下文压力：120 条模型消息/ });
}

describe("ContextView 主流程", () => {
  it("画出压力曲线与事件条，未选中时显示引导行", () => {
    render(<ContextView parsed={parsedCompact()} onLocateInLog={vi.fn()} />);

    expect(chartRegion()).toBeInTheDocument();
    // 峰值读数（上面板 actions 的 span）与来源圆点同住；SVG 里另有直标 <text>，
    // 用 selector 限定到 span 只断言 actions 这一处。
    expect(screen.getByText(/峰值 167\.5K/, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("2 次 · 自动 1 / 手动 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /#1 .*· 自动 · / })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: /#2 .*· 手动 · / })).toBeInTheDocument();
    expect(screen.getByText("点击曲线上的 ◆ 或上方事件条查看取证")).toBeInTheDocument();
  });

  it("点击事件 chip 渲染取证卡与被丢清单，选中态在 chip 上联动", async () => {
    const user = userEvent.setup();
    render(<ContextView parsed={parsedCompact()} onLocateInLog={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /#2 / }));

    // 上下文规模：pre → post。
    expect(screen.getByText(/156,200/)).toBeInTheDocument();
    expect(screen.getByText(/9,600/)).toBeInTheDocument();
    // 曲线两侧读数是元数据与曲线的互证（pre 样本 156,284 / post 样本 8,200）。
    expect(screen.getByText(/156\.3K \/ 8\.2K/)).toBeInTheDocument();
    // 幸存消息分母 = 该边界前的全部消息。
    expect(screen.getByText("4 / 86 条")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /#2 / })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /#1 / })).toHaveAttribute("aria-pressed", "false");

    const list = screen.getByRole("region", { name: "被丢出上下文的内容" });
    expect(within(list).getByText("被丢出上下文的内容 · 82 条")).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(10);
  });

  it("键盘：聚焦图后 ←/→ roving 到压缩事件，Enter 选中，Esc 取消", async () => {
    const user = userEvent.setup();
    render(<ContextView parsed={parsedCompact()} onLocateInLog={vi.fn()} />);

    const chart = chartRegion();
    chart.focus();
    await user.keyboard("{ArrowRight}");
    // roving 高亮由朗读通道与 tooltip 承载：先读到第一个事件。
    expect(screen.getByRole("status")).toHaveTextContent("压缩 #1");
    await user.keyboard("{Enter}");
    // 取证卡标题（h3 内的 span；悬停 tooltip 的 <strong> 里也有同段文字）。
    expect(screen.getByText(/压缩 #1 · /, { selector: "h3 span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /#1 / })).toHaveAttribute("aria-pressed", "true");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("压缩 #2");
    await user.keyboard("{Enter}");
    expect(screen.getByText(/156,200/, { selector: "dd" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByText("点击曲线上的 ◆ 或上方事件条查看取证")).toBeInTheDocument();
  });

  it("被丢清单「仅用户」过滤收窄行集", async () => {
    const user = userEvent.setup();
    render(<ContextView parsed={parsedCompact()} onLocateInLog={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /#1 / }));
    const list = screen.getByRole("region", { name: "被丢出上下文的内容" });
    expect(within(list).getByText("被丢出上下文的内容 · 94 条")).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("radiogroup", { name: "被丢内容过滤" })).getByRole("radio", {
        name: "仅用户"
      })
    );
    // 边界 1 前有 50 条用户消息，幸存 3 条（cs-user-047..049）。
    expect(within(list).getByText("被丢出上下文的内容 · 47 条")).toBeInTheDocument();
    for (const badge of within(list).getAllByText("用户")) {
      expect(badge.tagName).toBe("SPAN");
    }
  });

  it("清单行点击回调定位到日志视图的记录", async () => {
    const onLocateInLog = vi.fn();
    const user = userEvent.setup();
    render(<ContextView parsed={parsedCompact()} onLocateInLog={onLocateInLog} />);

    await user.click(screen.getByRole("button", { name: /#1 / }));
    const list = screen.getByRole("region", { name: "被丢出上下文的内容" });
    await user.click(within(list).getAllByRole("listitem")[0]);

    expect(onLocateInLog).toHaveBeenCalledWith("cs-user-000");
  });
});

describe("ContextView 空态与降级（design §2.6）", () => {
  it("无压缩的会话：曲线照画，事件面板给出「有数据的零」", () => {
    render(
      <ContextView parsed={parseJsonlText(basicFixture, "/tmp/session-basic.jsonl")} onLocateInLog={vi.fn()} />
    );

    expect(screen.getByRole("img", { name: /未发生压缩/ })).toBeInTheDocument();
    expect(screen.getByText("本会话未发生压缩——上下文从未重置")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^#/ })).not.toBeInTheDocument();
    expect(screen.getByText(/峰值/, { selector: "span" })).toBeInTheDocument();
  });

  it("没有带用量的模型消息：上面板说明画不出曲线，事件面板不渲染", () => {
    const text = JSON.stringify({
      type: "user",
      sessionId: "s",
      timestamp: "2026-01-02T03:04:05.000Z",
      uuid: "u-1",
      message: { content: "hello" }
    });
    render(<ContextView parsed={parseJsonlText(text, "/tmp/no-usage.jsonl")} onLocateInLog={vi.fn()} />);

    expect(screen.getByText("没有可绘制的上下文数据")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "压缩事件" })).not.toBeInTheDocument();
  });

  it("旧日志缺压缩元数据：取证卡显示 — 并说明该字段未记录", async () => {
    const user = userEvent.setup();
    const minimal = [
      JSON.stringify({
        type: "user",
        sessionId: "m",
        timestamp: "2026-01-01T00:00:00.000Z",
        uuid: "mu-1",
        message: { role: "user", content: "先给一个约束" }
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "m",
        timestamp: "2026-01-01T00:00:05.000Z",
        uuid: "ma-1",
        message: {
          id: "mm-1",
          role: "assistant",
          model: "claude",
          content: [{ type: "text", text: "收到" }],
          usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 20 }
        }
      }),
      JSON.stringify({
        type: "system",
        subtype: "compact_boundary",
        sessionId: "m",
        timestamp: "2026-01-01T00:00:10.000Z",
        uuid: "mb-1",
        parentUuid: null,
        logicalParentUuid: "ma-1",
        content: "Conversation compacted",
        level: "info"
      })
    ].join("\n");

    render(<ContextView parsed={parseJsonlText(minimal, "/tmp/legacy.jsonl")} onLocateInLog={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /#1 / }));

    const missing = screen.getAllByText(/该字段此记录未记录/);
    expect(missing.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("0 / 2 条")).toBeInTheDocument();
  });
});

describe("选中态的生命周期（真机缺陷回归）", () => {
  it("同一会话的后台重解析不丢选中——清空只认会话身份，不认对象身份", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ContextView parsed={parsedCompact()} onLocateInLog={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: /#2 / }));
    expect(screen.getByRole("button", { name: /#2 / })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // 后台重解析：同一份日志重新 parse 产出**新对象**（缓存写回后会话刷新的真实路径）。
    // 真机上这个新对象在点击后数秒内到达，曾把刚选中的事件抹掉（gui-test 抓到）。
    rerender(<ContextView parsed={parsedCompact()} onLocateInLog={vi.fn()} />);

    expect(screen.getByRole("button", { name: /#2 / })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText(/压缩 #2/)).toBeInTheDocument();
  });

  it("切换到另一个会话才清空选中", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ContextView parsed={parsedCompact()} onLocateInLog={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: /#2 / }));

    rerender(
      <ContextView
        parsed={parseJsonlText(basicFixture, "/tmp/other-session.jsonl")}
        onLocateInLog={vi.fn()}
      />
    );

    // basic 夹具没有压缩事件：引导行回来、没有 #2 残留
    expect(screen.getByText(/未发生压缩/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /#2 / })).not.toBeInTheDocument();
  });
});
