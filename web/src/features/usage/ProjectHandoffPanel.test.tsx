import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionMeta } from "../sessions/metadataCache";
import type {
  HandoffSession,
  HandoffTrack,
  ProjectHandoff
} from "./projectHandoff";
import { ProjectHandoffPanel } from "./ProjectHandoffPanel";

/**
 * 项目接续的组件用例：钉「排版与交互有没有按规格落地」。
 * 窗口裁剪、排序、回声分数、间距公式都由 `projectHandoff.test.ts` 负责，
 * 这里用**手造的 HandoffSession** 直接把状态摆到界面上，不重算模型。
 */

const BASE = new Date(2026, 10, 28, 9, 0).getTime();
const MINUTE = 60_000;
const HOUR = 3_600_000;

function meta(path: string): SessionMeta {
  return {
    path,
    mtimeMs: BASE,
    sizeBytes: 0,
    projectLabel: "-work-handoff",
    hasRecords: true
  };
}

function makeSession(
  patch: Partial<HandoffSession> & Pick<HandoffSession, "id" | "startTs">
): HandoffSession {
  return {
    endTs: patch.startTs + 30 * MINUTE,
    title: `会话 ${patch.id}`,
    lastAction: { kind: "none" },
    opening: { preview: "开头的一段交代", redacted: false },
    closing: { preview: "结尾的一段收束", redacted: false },
    previousClosing: null,
    echo: { status: "no-previous" },
    inProgress: false,
    gapMs: null,
    gapPx: null,
    gapLabel: null,
    ...patch
  };
}

function makeHandoff(
  sessions: HandoffSession[],
  options: {
    unknownSessions?: number;
    emptyReason?: HandoffTrack["emptyReason"];
    projects?: ProjectHandoff["projects"];
  } = {}
): ProjectHandoff {
  const track: HandoffTrack = {
    project: { key: "-work-handoff", name: "handoff" },
    sessions,
    emptyReason: options.emptyReason ?? null,
    unknownSessions: options.unknownSessions ?? 0
  };
  return {
    window: { startTs: BASE - 7 * 24 * HOUR, rightTs: BASE + 7 * 24 * HOUR, days: 7 },
    projects: options.projects ?? [
      { key: "-work-handoff", name: "handoff", sessions: sessions.length, lastStartTs: BASE, unknownSessions: 0 }
    ],
    activeKey: "-work-handoff",
    track
  };
}

const S1 = makeSession({
  id: "s1",
  startTs: BASE,
  title: "修复导出按钮的禁用态",
  lastAction: { kind: "file", verb: "改", name: "export-button.tsx", tool: "Edit" }
});

const S2 = makeSession({
  id: "s2",
  startTs: BASE + 2 * HOUR,
  title: "补测试与截图基线",
  lastAction: { kind: "command", command: "npm test", tool: "Bash" },
  closing: { preview: "本次会话的结尾", redacted: false },
  // 回声评分的左边那句话就是 S1 的结尾——读数区要能显示它。
  previousClosing: { preview: "结尾的一段收束", redacted: false },
  echo: { status: "scored", score: 0.68, percent: 68, hit: true },
  gapMs: 2 * HOUR,
  gapPx: 52,
  gapLabel: "同日 · 2 小时后"
});

const S3 = makeSession({
  id: "s3",
  startTs: BASE + 2 * HOUR + 26 * HOUR,
  title: "换个话题：侧栏折叠",
  lastAction: { kind: "none" },
  previousClosing: { preview: "本次会话的结尾", redacted: false },
  echo: { status: "scored", score: 0.31, percent: 31, hit: false },
  gapMs: 26 * HOUR,
  gapPx: 82,
  gapLabel: "次日 · 26 小时后",
  meta: meta("/work/handoff/s3.jsonl")
});

function threeSessions(): ProjectHandoff {
  return makeHandoff([S1, S2, S3]);
}

function selectedNode(): HTMLElement {
  const node = document.querySelector<HTMLElement>("[data-handoff-selected]");
  if (!node) throw new Error("没有选中节点");
  return node;
}

function detail(): HTMLElement {
  return screen.getByRole("group", { name: "接续读数" });
}

afterEach(cleanup);

describe("ProjectHandoffPanel · 卡片与切换条", () => {
  it("渲染 region「项目接续」，探针与默认选中都在", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    expect(screen.getByRole("region", { name: "项目接续" })).toBeInTheDocument();
    expect(document.querySelector('[data-probe="project-handoff"]')).not.toBeNull();
    expect(document.querySelectorAll("[data-handoff-node]")).toHaveLength(3);
    // 默认选中**最右（最新）**节点。
    expect(selectedNode()).toHaveAttribute("data-handoff-node", "s3");
  });

  it("没有项目时整卡返回 null", () => {
    const { container } = render(
      <ProjectHandoffPanel
        handoff={{
          window: { startTs: BASE, rightTs: BASE, days: 7 },
          projects: [],
          activeKey: null,
          track: null
        }}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("单会话不画轨道，给出说明、事实行与打开入口", async () => {
    const user = userEvent.setup();
    const handoff = makeHandoff([S3], { emptyReason: "single-session" });
    const onOpen = vi.fn();
    render(<ProjectHandoffPanel handoff={handoff} onOpenSession={onOpen} />);

    expect(document.querySelector('[data-handoff-empty="single-session"]')).not.toBeNull();
    expect(document.querySelector('[data-probe="handoff-track"]')).toBeNull();
    expect(
      screen.getByText("这个项目在窗口内只有一次会话，没有接续可看。")
    ).toBeInTheDocument();
    expect(screen.getByText(/最后动作/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /打开会话/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toEqual(S3.meta);
  });

  it("全未知：不画空轨道，报出缺少时间戳的会话数", () => {
    const handoff = makeHandoff([], { emptyReason: "all-unknown", unknownSessions: 3 });
    render(<ProjectHandoffPanel handoff={handoff} />);

    expect(document.querySelector('[data-handoff-empty="all-unknown"]')).not.toBeNull();
    expect(document.querySelector('[data-probe="handoff-track"]')).toBeNull();
    expect(
      screen.getByText("这个项目在窗口内没有可定位时间的会话")
    ).toBeInTheDocument();
    expect(screen.getByText(/3 个会话缺少有效时间戳/)).toBeInTheDocument();
  });
});

describe("ProjectHandoffPanel · 轨道与截断", () => {
  it("节点数 = min(12, 总数)，hidden 探针与开关同步", async () => {
    const user = userEvent.setup();
    const sessions = Array.from({ length: 14 }, (_, index) =>
      makeSession({
        id: `s${index}`,
        startTs: BASE + index * HOUR,
        title: `第 ${index} 次会话`
      })
    );
    render(<ProjectHandoffPanel handoff={makeHandoff(sessions)} />);

    const root = document.querySelector<HTMLElement>('[data-probe="project-handoff"]');
    expect(document.querySelectorAll("[data-handoff-node]")).toHaveLength(12);
    expect(root).toHaveAttribute("data-handoff-hidden", "2");
    expect(document.querySelector('[data-probe="handoff-count"]')).toHaveTextContent("14 次会话");
    // 隐藏的是更早的 s0 / s1；最右仍是最新的 s13。
    expect(selectedNode()).toHaveAttribute("data-handoff-node", "s13");

    await user.click(screen.getByRole("button", { name: "显示全部" }));
    expect(document.querySelectorAll("[data-handoff-node]")).toHaveLength(14);
    expect(root).toHaveAttribute("data-handoff-hidden", "0");
    expect(screen.getByRole("button", { name: "只看最近 12 次" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "只看最近 12 次" }));
    expect(document.querySelectorAll("[data-handoff-node]")).toHaveLength(12);
  });

  it("间隔标签数 = 可见节点数 - 1，文案与夹具一致", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    const gaps = document.querySelectorAll("[data-handoff-gap]");
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toHaveTextContent("同日 · 2 小时后");
    expect(gaps[1]).toHaveTextContent("次日 · 26 小时后");
    expect(gaps[0]).toHaveAttribute("data-handoff-gap", String(2 * HOUR));
    expect(gaps[1]).toHaveAttribute("data-handoff-gap", String(26 * HOUR));
  });

  it("动作文案：改 / Bash · / 无工具调用", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    expect(screen.getByText("改", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("export-button.tsx")).toBeInTheDocument();
    expect(screen.getByText("Bash ·")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    // 没有工具调用是事实，不画「—」。
    expect(screen.getByText("无工具调用")).toBeInTheDocument();
    expect(screen.queryByText("—")).toBeNull();
  });
});

describe("ProjectHandoffPanel · 重复交代", () => {
  it("命中节点有空心圆与百分比探针，未命中没有", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    const rings = document.querySelectorAll("[data-handoff-echo]");
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveAttribute("data-handoff-echo", "68");
    expect(rings[0]?.closest("[data-handoff-node]")).toHaveAttribute("data-handoff-node", "s2");
  });

  it("选中命中节点：读数行给出百分比与阈值", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    fireEvent.click(screen.getByText("补测试与截图基线"));

    expect(selectedNode()).toHaveAttribute("data-handoff-node", "s2");
    expect(document.querySelector('[data-probe="handoff-echo-line"]')).toHaveTextContent(
      "本次开头与上次结尾重合 68%，达到阈值 55%。"
    );
  });

  it("未命中节点没有空心圆，但读数行仍报出真实分数", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    // 默认选中的 s3 就是未命中。
    expect(
      document.querySelector('[data-handoff-node="s3"] [data-handoff-echo]')
    ).toBeNull();
    expect(document.querySelector('[data-probe="handoff-echo-line"]')).toHaveTextContent(
      "本次开头与上次结尾重合 31%，低于阈值 55%。"
    );
  });

  it("no-previous 与样本不足各有整句", () => {
    const noPrev = makeSession({ id: "a", startTs: BASE });
    const short = makeSession({
      id: "b",
      startTs: BASE + HOUR,
      gapMs: HOUR,
      gapPx: 44,
      gapLabel: "同日 · 1 小时后",
      echo: { status: "insufficient", reason: "short-text" }
    });
    render(<ProjectHandoffPanel handoff={makeHandoff([noPrev, short])} />);

    expect(document.querySelector('[data-probe="handoff-echo-line"]')).toHaveTextContent(
      "样本不足：两条消息都太短（各需至少 4 个话题词）。"
    );

    fireEvent.click(screen.getByText("会话 a"));
    expect(document.querySelector('[data-probe="handoff-echo-line"]')).toHaveTextContent(
      "这是窗口内这个项目最早的一次会话。"
    );
  });
});

describe("ProjectHandoffPanel · 选中与读数", () => {
  it("默认读数是最近一次：时间范围、两段引文、打开会话", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ProjectHandoffPanel handoff={threeSessions()} onOpenSession={onOpen} />);

    const box = within(detail());
    expect(box.getByText("换个话题：侧栏折叠")).toBeInTheDocument();
    expect(box.getByText(/11-29 13:00 → 11-29 13:30 · 30 分/)).toBeInTheDocument();
    expect(document.querySelector('[data-probe="handoff-opening"]')).toHaveTextContent(
      "开头的一段交代"
    );
    expect(document.querySelector('[data-probe="handoff-closing"]')).toHaveTextContent(
      "结尾的一段收束"
    );

    await user.click(screen.getByRole("button", { name: "打开会话 →" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toEqual(S3.meta);
  });

  it("命中节点三行引文：开头 / 结尾 / 上次结尾；首节点没有上次结尾", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    fireEvent.click(screen.getByText("补测试与截图基线"));

    const box = within(detail());
    expect(box.getByText("上次结尾")).toBeInTheDocument();
    expect(document.querySelector('[data-probe="handoff-opening"]')).toHaveTextContent(
      "开头的一段交代"
    );
    expect(document.querySelector('[data-probe="handoff-closing"]')).toHaveTextContent(
      "本次会话的结尾"
    );
    // 打分时真正参与比较的那句话，等于**上一个节点**的结尾。
    expect(
      document.querySelector('[data-probe="handoff-previous-closing"]')
    ).toHaveTextContent("结尾的一段收束");

    // 窗口内第一条没有可对比的上一次：整行不渲染。
    fireEvent.click(screen.getByText("修复导出按钮的禁用态"));
    expect(
      document.querySelector('[data-probe="handoff-previous-closing"]')
    ).toBeNull();
    expect(within(detail()).queryByText("上次结尾")).toBeNull();
  });

  it("点击另一个节点：选中移动、读数更新，焦点不跳到节点上", async () => {
    const user = userEvent.setup();
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    await user.click(screen.getByText("修复导出按钮的禁用态"));

    expect(selectedNode()).toHaveAttribute("data-handoff-node", "s1");
    expect(within(detail()).getByText("修复导出按钮的禁用态")).toBeInTheDocument();
    expect(document.activeElement).not.toBe(selectedNode());
  });

  it("没有回调时「打开会话」整枚不渲染（不做 disabled 态）", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    expect(screen.queryByRole("button", { name: /打开会话/ })).toBeNull();
  });

  it("没有用户消息时引文位写「没有用户消息」", () => {
    const empty = makeSession({ id: "empty", startTs: BASE, opening: null, closing: null });
    const second = makeSession({
      id: "second",
      startTs: BASE + HOUR,
      gapMs: HOUR,
      gapPx: 44,
      gapLabel: "同日 · 1 小时后"
    });
    render(<ProjectHandoffPanel handoff={makeHandoff([empty, second])} />);

    fireEvent.click(screen.getByText("会话 empty"));
    expect(within(detail()).getAllByText("没有用户消息")).toHaveLength(2);
  });

  it("进行中徽标只出现在最后一条记录 2 分钟内的节点", () => {
    const live = makeSession({ id: "live", startTs: BASE + HOUR, inProgress: true });
    render(<ProjectHandoffPanel handoff={makeHandoff([S1, live])} />);

    const badges = document.querySelectorAll("[data-handoff-live]");
    expect(badges).toHaveLength(1);
    expect(badges[0]?.closest("[data-handoff-node]")).toHaveAttribute("data-handoff-node", "live");
    expect(within(detail()).getByText(/进行中/)).toBeInTheDocument();
  });
});

describe("ProjectHandoffPanel · 键盘", () => {
  it("轨道是唯一 Tab 止点；方向键 / Home / End 移动选中并更新读数", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);
    const track = screen.getByRole("listbox", { name: "项目接续轨道（可交互）" });

    expect(track).toHaveAttribute("tabindex", "0");
    expect(track).toHaveAttribute("aria-orientation", "horizontal");
    expect(track).toHaveAttribute("aria-activedescendant", selectedNode().id);

    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(selectedNode()).toHaveAttribute("data-handoff-node", "s2");
    expect(track).toHaveAttribute("aria-activedescendant", selectedNode().id);

    fireEvent.keyDown(track, { key: "Home" });
    expect(selectedNode()).toHaveAttribute("data-handoff-node", "s1");

    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(selectedNode()).toHaveAttribute("data-handoff-node", "s2");

    fireEvent.keyDown(track, { key: "End" });
    expect(selectedNode()).toHaveAttribute("data-handoff-node", "s3");
  });

  it("Enter 调用 onOpenSession 一次；没有回调时不拦截", () => {
    const onOpen = vi.fn();
    const { unmount } = render(
      <ProjectHandoffPanel handoff={threeSessions()} onOpenSession={onOpen} />
    );
    const track = screen.getByRole("listbox", { name: "项目接续轨道（可交互）" });

    fireEvent.keyDown(track, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toEqual(S3.meta);

    unmount();
    render(<ProjectHandoffPanel handoff={threeSessions()} />);
    const noCallback = screen.getByRole("listbox", { name: "项目接续轨道（可交互）" });
    expect(fireEvent.keyDown(noCallback, { key: "Enter" })).toBe(true);
  });

  it("选中变化时 live region 播报一句，不与节点 aria-label 重复", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);
    const track = screen.getByRole("listbox", { name: "项目接续轨道（可交互）" });
    const live = document.querySelector('[data-probe="handoff-live-region"]');

    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(live).toHaveTextContent(
      "已选 11-28 11:00 的会话：补测试与截图基线；最后动作 Bash · npm test；本次开头与上次结尾重合 68%。"
    );
  });

  it("节点的 aria-label 含时刻、标题、动作，命中时追加百分比", () => {
    render(<ProjectHandoffPanel handoff={threeSessions()} />);

    const hit = document.querySelector('[data-handoff-node="s2"]');
    expect(hit).toHaveAttribute(
      "aria-label",
      "11-28 11:00，补测试与截图基线，最后动作 Bash · npm test，开头与上次结尾重合 68%"
    );
    expect(hit).toHaveAttribute(
      "title",
      "11-28 11:00 · 补测试与截图基线 · 最后动作 Bash · npm test · 开头与上次结尾重合 68%"
    );
  });
});

describe("ProjectHandoffPanel · CSS 纪律", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/features/usage/ProjectHandoffPanel.module.css"),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  function ruleBody(selector: string): string {
    const match = new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(
      css
    );
    if (!match) throw new Error(`找不到规则 ${selector}`);
    return match[1];
  }

  it("没有第二套色板、夸主题的语义色或十六进制颜色", () => {
    expect(css).not.toMatch(/--danger|--success|--chart-|--cat-|color-mix|fill-opacity/);
    expect(css).not.toMatch(/(^|[\s:(])opacity\s*:/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("box-shadow");
    // --warning 只染「样本不足」四个字。
    const warningRules = [...css.matchAll(/([^{}]+)\{[^}]*--warning[^}]*\}/g)].map((m) =>
      m[1].trim()
    );
    expect(warningRules).toEqual([".sampleWarning"]);
  });

  it("节点不写死高度，只给 min-height；CSS 不重算间距", () => {
    const node = ruleBody(".node");
    expect(node).toContain("min-height: 72px");
    expect(node).not.toMatch(/(^|[;\s])height\s*:/);
    expect(node).toContain("width: 176px");
    // 间隔由模型层的 gapPx（inline style）决定，CSS 不映射毫秒到像素。
    const spacer = ruleBody(".gapSpacer");
    expect(spacer).toContain("flex: 0 0 auto");
    expect(spacer).not.toMatch(/(^|[;\s])width\s*:/);
    expect(css).not.toMatch(/\blog2\b/);
  });

  it("悬停不盖掉选中态：hover 只作用于未选中节点，选中左缘仍是 accent", () => {
    // 「选中且悬停」与「仅悬停」底色相同，唯一区别是左缘 2px 竖条；
    // 若 hover 的 border-color 作用到选中节点，指针停在自己刚点的节点上，
    // 用户就看不到自己选中了哪个。
    const hover = ruleBody(".node:hover:not(.nodeSelected)");
    expect(hover).toContain("border-color: var(--border-strong)");
    expect(hover).toContain("background: var(--bg-hover)");

    const selected = ruleBody(".node.nodeSelected");
    expect(selected).toContain("border-left-color: var(--accent)");
    expect(selected).toContain("background: var(--bg-hover)");

    // 选中规则写在 hover 之后：即使有人去掉 :not()，同权重下仍是选中胜。
    expect(css.indexOf(".node.nodeSelected {")).toBeGreaterThan(
      css.indexOf(".node:hover:not(.nodeSelected) {")
    );
  });

  it("卡内只有一个横向滚动容器，没有纵向滚动", () => {
    const scroller = ruleBody(".scroller");
    expect(scroller).toContain("overflow-x: auto");
    expect(scroller).not.toContain("overflow-y: auto");
    expect(css).not.toContain("overflow-y: scroll");
  });

  it("130% 字号：节点几何不缩放，文字截断而轨道随节点长高", () => {
    // 节点宽是绝对 px，不乘 --font-scale；字号的缩放只影响行盒。
    expect(ruleBody(".node")).toContain("width: 176px");
    expect(ruleBody(".nodeTitle")).toContain("text-overflow: ellipsis");
    expect(ruleBody(".nodeAction")).toContain("text-overflow: ellipsis");
    // 标签带高度跟 --lh-xs，130% 下节点顶到基线的距离随字号增长。
    expect(ruleBody(".track")).toContain("calc(var(--lh-xs) + 10px)");
    expect(ruleBody(".labels")).toContain("height: calc(var(--lh-xs) + 4px)");
    // 引文不设行夹。
    expect(ruleBody(".quoteValue")).not.toContain("line-clamp");
    expect(ruleBody(".quoteValue")).toContain("overflow-wrap: anywhere");
  });
});
