import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionList } from "./SessionList";
import type { SessionMeta } from "./metadataCache";
import { parseJsonlText } from "./parseJsonl";
import { buildBleedReport } from "./bleedModel";
import styles from "./SessionList.module.css";

const sessions: SessionMeta[] = [
  {
    path: "/repo/one.jsonl",
    sessionId: "one-session",
    cwd: "/repo/project-a",
    projectLabel: "project-a",
    mtimeMs: 100,
    sizeBytes: 10,
    hasRecords: true
  },
  {
    path: "/repo/two.jsonl",
    sessionId: "two-session",
    cwd: "/repo/project-b",
    projectLabel: "project-b",
    mtimeMs: 200,
    sizeBytes: 20,
    hasRecords: true
  }
];

function renderList(onSelect = vi.fn()) {
  return render(
    <SessionList
      sessions={sessions}
      selected={null}
      loading={false}
      error={null}
      onSelect={onSelect}
      onRefresh={() => undefined}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

test("filters sessions by id and directory", async () => {
  const user = userEvent.setup();
  renderList();

  await user.type(screen.getByPlaceholderText("搜会话 ID 或目录…"), "one-session");
  expect(screen.getByRole("button", { name: /project-a/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /project-b/ })).not.toBeInTheDocument();
});

test("groups sessions by project directory", async () => {
  const user = userEvent.setup();
  renderList();

  await user.click(screen.getByRole("tab", { name: "项目" }));
  expect(screen.getByRole("button", { name: /\/repo\/project-a/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /\/repo\/project-b/ })).toBeInTheDocument();
});

test("selects a session", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  renderList(onSelect);

  await user.click(screen.getAllByRole("button", { name: /project-a/ })[0]);
  expect(onSelect).toHaveBeenCalledWith(sessions[0]);
});

test("shows extracted titles and pending metadata status", async () => {
  render(
    <SessionList
      sessions={[
        {
          path: "/sessions/a.jsonl",
          projectLabel: "a-project",
          mtimeMs: 1,
          sizeBytes: 1,
          hasRecords: true,
          metadataStatus: "pending"
        },
        {
          path: "/sessions/b.jsonl",
          projectLabel: "b-project",
          customTitle: "Custom title",
          mtimeMs: 2,
          sizeBytes: 2,
          hasRecords: true,
          metadataStatus: "complete"
        }
      ]}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  expect(screen.getByText("补全标题中")).toBeInTheDocument();
  expect(screen.getByText("Custom title")).toBeInTheDocument();
});

test("shows fallback titles and failed metadata status in project view", async () => {
  const user = userEvent.setup();
  render(
    <SessionList
      sessions={[
        {
          path: "/sessions/c.jsonl",
          projectLabel: "c-project",
          agentName: "Agent title",
          aiTitle: "AI title",
          userPrompt: "User prompt",
          mtimeMs: 3,
          sizeBytes: 3,
          hasRecords: true,
          metadataStatus: "failed"
        },
        {
          path: "/sessions/d.jsonl",
          projectLabel: "d-project",
          aiTitle: "AI title",
          userPrompt: "User prompt",
          mtimeMs: 4,
          sizeBytes: 4,
          hasRecords: true,
          metadataStatus: "complete"
        },
        {
          path: "/sessions/e.jsonl",
          projectLabel: "e-project",
          userPrompt: "User prompt",
          mtimeMs: 5,
          sizeBytes: 5,
          hasRecords: true,
          metadataStatus: "complete"
        }
      ]}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  await user.click(screen.getByRole("tab", { name: "项目" }));
  expect(screen.getByText("Agent title")).toBeInTheDocument();
  expect(screen.getByText("AI title")).toBeInTheDocument();
  expect(screen.getByText("User prompt")).toBeInTheDocument();
  expect(screen.getByText("标题提取失败")).toBeInTheDocument();
});

test("remembers the list view in localStorage", async () => {
  const user = userEvent.setup();
  const first = renderList();

  await user.click(screen.getByRole("tab", { name: "项目" }));
  expect(window.localStorage.getItem("cca-session-view")).toBe("project");
  first.unmount();

  renderList();
  expect(screen.getByRole("tab", { name: "项目" })).toHaveAttribute("aria-selected", "true");
});

test("collapses and expands project groups", async () => {
  const user = userEvent.setup();
  const { container } = renderList();
  const sessionRows = () => container.querySelectorAll(`.${styles.sessionRow}`);

  await user.click(screen.getByRole("tab", { name: "项目" }));
  const toggle = screen.getByRole("button", { name: /\/repo\/project-a/ });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(sessionRows()).toHaveLength(2);

  await user.click(toggle);
  const collapsedToggle = screen.getByRole("button", { name: /\/repo\/project-a/ });
  expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");
  expect(sessionRows()).toHaveLength(1);
  expect(JSON.parse(window.localStorage.getItem("cca-session-collapsed") ?? "[]")).toEqual([
    "/repo/project-a"
  ]);

  await user.click(collapsedToggle);
  expect(sessionRows()).toHaveLength(2);
});

function manySessions(count: number): SessionMeta[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/repo/gen/session-${index}.jsonl`,
    sessionId: `session-${index}`,
    cwd: "/repo/gen",
    projectLabel: "gen",
    customTitle: `会话 ${index}`,
    mtimeMs: 1000 + index,
    sizeBytes: index,
    hasRecords: true,
    metadataStatus: "complete" as const
  }));
}

test("windows a long session list instead of rendering every row", () => {
  const sessions = manySessions(400);
  const { container } = render(
    <SessionList
      sessions={sessions}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  const rendered = container.querySelectorAll(`.${styles.sessionRow}`);
  expect(rendered.length).toBeGreaterThan(0);
  expect(rendered.length).toBeLessThan(100);
  // Newest first: session 399 has the newest mtime in the fixture.
  // No trailing space in the patterns: the accessible name is built by
  // concatenating inline elements and carries no separator between them.
  expect(screen.getByRole("button", { name: /会话 399/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /会话 0/ })).toBeNull();
});

test("renders every session while the list is short", () => {
  const sessions = manySessions(20);
  const { container } = render(
    <SessionList
      sessions={sessions}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  expect(container.querySelectorAll(`.${styles.sessionRow}`)).toHaveLength(20);
});

function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll(`.${styles.sessionRow} strong`)].map(
    (element) => element.textContent ?? ""
  );
}

test("sorts sessions inside a group newest first, whatever the input order", () => {
  const unsorted: SessionMeta[] = [
    { path: "/repo/old.jsonl", projectLabel: "p", customTitle: "旧会话", mtimeMs: 10, sizeBytes: 1, hasRecords: true },
    { path: "/repo/new.jsonl", projectLabel: "p", customTitle: "新会话", mtimeMs: 30, sizeBytes: 1, hasRecords: true },
    { path: "/repo/mid.jsonl", projectLabel: "p", customTitle: "中间会话", mtimeMs: 20, sizeBytes: 1, hasRecords: true }
  ];
  const { container } = render(
    <SessionList
      sessions={unsorted}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  expect(titles(container)).toEqual(["新会话", "中间会话", "旧会话"]);
});

test("orders date groups by their newest session", () => {
  const now = new Date(2026, 8, 24, 12).getTime();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  try {
    const grouped: SessionMeta[] = [
      { path: "/repo/older.jsonl", projectLabel: "p", customTitle: "上个月", mtimeMs: new Date(2026, 7, 2, 9).getTime(), sizeBytes: 1, hasRecords: true },
      { path: "/repo/today.jsonl", projectLabel: "p", customTitle: "今天", mtimeMs: new Date(2026, 8, 24, 9).getTime(), sizeBytes: 1, hasRecords: true },
      { path: "/repo/yesterday.jsonl", projectLabel: "p", customTitle: "昨天", mtimeMs: new Date(2026, 8, 23, 9).getTime(), sizeBytes: 1, hasRecords: true }
    ];
    const { container } = render(
      <SessionList
        sessions={grouped}
        selected={null}
        loading={false}
        error={null}
        onSelect={() => undefined}
        onRefresh={() => undefined}
      />
    );

    const labels = [...container.querySelectorAll(`.${styles.groupToggle} strong`)].map(
      (element) => element.textContent
    );
    expect(labels).toEqual(["今天", "昨天", "更早"]);
    expect(titles(container)).toEqual(["今天", "昨天", "上个月"]);
  } finally {
    vi.useRealTimers();
  }
});

test("prunes collapsed groups that no longer exist", async () => {
  window.localStorage.setItem(
    "cca-session-collapsed",
    JSON.stringify(["/repo/gone", "/repo/project-a"])
  );
  renderList();

  await waitFor(() =>
    expect(JSON.parse(window.localStorage.getItem("cca-session-collapsed") ?? "[]")).toEqual([
      "/repo/project-a"
    ])
  );
});

test("keeps collapse state for groups hidden by a search", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("cca-session-collapsed", JSON.stringify(["/repo/project-a"]));
  renderList();

  await user.type(screen.getByPlaceholderText("搜会话 ID 或目录…"), "project-b");

  expect(JSON.parse(window.localStorage.getItem("cca-session-collapsed") ?? "[]")).toEqual([
    "/repo/project-a"
  ]);
});

test("shows index progress", () => {
  render(
    <SessionList
      sessions={sessions}
      selected={null}
      loading={false}
      error={null}
      progress={{ done: 3, total: 10 }}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  const status = screen.getByRole("status", { name: "建立索引进度" });
  expect(status).toHaveTextContent("正在建立索引 3/10");
  expect(status.querySelector("progress")).toHaveAttribute("value", "3");
});

test("groups the timeline by date and shows relative time, size and project", async () => {
  const user = userEvent.setup();
  const now = Date.now();
  render(
    <SessionList
      sessions={[
        {
          path: "/repo/fresh.jsonl",
          projectLabel: "repo-demo",
          mtimeMs: now - 1_000,
          sizeBytes: 2048,
          hasRecords: true,
          metadataStatus: "complete"
        },
        {
          path: "/repo/old.jsonl",
          projectLabel: "demo-project",
          mtimeMs: now - 40 * 86_400_000,
          sizeBytes: 10,
          hasRecords: true,
          metadataStatus: "complete"
        }
      ]}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  expect(screen.getByRole("button", { name: /今天/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /更早/ })).toBeInTheDocument();
  expect(screen.getByText(/刚刚 · 2KB · repo-demo/)).toBeInTheDocument();
  expect(screen.getByText(/· 10B · demo-project/)).toBeInTheDocument();

  const today = screen.getByRole("button", { name: /今天/ });
  await user.click(today);
  expect(screen.queryByText(/刚刚 · 2KB · repo-demo/)).not.toBeInTheDocument();
  expect(screen.getByText(/· 10B · demo-project/)).toBeInTheDocument();
});

/**
 * 行高是 CSS 与 TS 常量之间的一份隐式契约：虚拟滚动用常量算偏移，
 * 用 CSS 画盒子。两边一旦不一致，滚动位置会随列表变长而累积偏移，
 * 表现为「滚到底部时空一截」或「最后几条被吞掉」——都很难一眼归因。
 * CSS 侧写成 `calc(<N>px * var(--font-scale))`，所以这里比对的是括号里的 N
 * 与常量——常量仍是 100% 下的基准值。
 */
test("keeps the row heights in sync with the virtualised CSS", () => {
  const source = readFileSync(resolve(process.cwd(), "src/features/sessions/SessionList.tsx"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "src/features/sessions/SessionList.module.css"), "utf8");

  const constant = (name: string) => {
    const match = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(source);
    expect(match, `常量 ${name} 不存在`).not.toBeNull();
    return Number(match![1]);
  };
  const ruleHeight = (selector: string) => {
    const match = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, "s").exec(css);
    expect(match, `规则 .${selector} 不存在`).not.toBeNull();
    const height = /height:\s*calc\((\d+)px\s*\*\s*var\(--font-scale\)\)/.exec(match![1]);
    expect(height, `规则 .${selector} 没有 calc(<N>px * var(--font-scale)) 形式的 height`).not.toBeNull();
    return Number(height![1]);
  };

  expect(constant("GROUP_ROW_HEIGHT")).toBe(ruleHeight("groupRow"));
  expect(constant("SESSION_ROW_HEIGHT")).toBe(ruleHeight("sessionRow"));
  expect(constant("SESSION_ROW_HEIGHT_WITH_STATUS")).toBe(ruleHeight("sessionRowWithStatus"));
});

test("marks an archived session with an inline badge in the title line", () => {
  const archived: SessionMeta = {
    path: "/app-data/archive/-repo-old/gone.jsonl",
    projectLabel: "repo-old",
    customTitle: "归档会话",
    mtimeMs: 10,
    sizeBytes: 5,
    hasRecords: true,
    archived: true
  };
  const live: SessionMeta = {
    path: "/repo/live.jsonl",
    projectLabel: "repo",
    customTitle: "在源会话",
    mtimeMs: 20,
    sizeBytes: 5,
    hasRecords: true
  };
  const { container } = render(
    <SessionList
      sessions={[archived, live]}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  const badges = container.querySelectorAll(`.${styles.archiveTag}`);
  expect(badges).toHaveLength(1);

  const badge = badges[0];
  // 徽标内联在标题行里：.sessionButton > .titleLine > strong + .archiveTag。
  const titleLine = badge.parentElement!;
  expect(titleLine.classList.contains(styles.titleLine)).toBe(true);
  expect(titleLine.querySelector("strong")?.textContent).toBe("归档会话");

  // 行的本体是 role="button" 的 div（不是 <button>：出血点徽章是真按钮，
  // 按钮不能嵌按钮），所以这里断的是 role 与类名，不是 tagName。
  const row = titleLine.parentElement!;
  expect(row.tagName).toBe("DIV");
  expect(row.getAttribute("role")).toBe("button");
  expect(row.classList.contains(styles.sessionButton)).toBe(true);
  expect(row.children[0]).toBe(titleLine);
  // 不是行的直接 grid 子元素 —— 那会多出一行 grid row，把 54px 的行高撑坏。
  expect(Array.from(row.children)).not.toContain(badge);

  // 非归档会话不显示徽标。
  expect(
    screen.getByRole("button", { name: /在源会话/ }).querySelector(`.${styles.archiveTag}`)
  ).toBeNull();
});

/**
 * SessionList.module.css 里有一条把行内所有 span 染成灰色小字的通配规则。
 * 标题行现在多了一层 `.titleLine` 包装 span，通配会把标题也连带染灰；
 * 这条用例把「着色规则已收窄到 .meta」和「徽标自带中性牌样式」一起锁住。
 */
test("keeps the archive badge out of the inline-span colour rule", () => {
  const css = readFileSync(resolve(process.cwd(), "src/features/sessions/SessionList.module.css"), "utf8");

  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  const broadSpanRules = rules.filter(
    ([, selector]) =>
      /(button|\.sessionButton) span\b/.test(selector) && !/\.meta|\.archiveTag/.test(selector)
  );
  expect(
    broadSpanRules.every(([, , body]) => !/color:\s*var\(--text-tertiary\)/.test(body))
  ).toBe(true);

  const metaRule = css.match(
    /\.groups \.sessionRow \.sessionButton \.meta,\s*\.groups \.sessionRowWithStatus \.sessionButton \.meta\s*\{([^}]*)\}/s
  );
  expect(metaRule?.[1]).toContain("color: var(--text-tertiary)");

  const badgeRule = css.match(
    /\.archiveTag,\s*\.groups \.sessionRowWithStatus \.sessionButton \.archiveTag\s*\{([^}]*)\}/s
  );
  expect(badgeRule?.[1]).toContain("color: var(--text-secondary)");
  expect(badgeRule?.[1]).toContain("border: 1px solid var(--border)");
  expect(badgeRule?.[1]).toContain("height: var(--lh-xs)");
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
});

/**
 * 侧栏错误态。它过去把原始错误串直接当正文渲染，于是 `/Users/…` 这类绝对路径
 * 与「夹具 / 静默返回空数组」这类写给维护者的话一起端到了用户面前——
 * 前者是项目红线（用户路径视同敏感数据），后者是内部信息。
 */
const RAW_SCAN_ERROR =
  "扫描会话列表失败: Error: E2E 虚拟文件系统: readDir 遇到未声明的路径 " +
  "/Users/e2e/.claude/projects。请在夹具里声明它——静默返回空数组会把夹具错误伪装成成功缺陷。";

function renderBrokenList(onRefresh = vi.fn()) {
  return render(
    <SessionList
      sessions={[]}
      selected={null}
      loading={false}
      error={RAW_SCAN_ERROR}
      onSelect={() => undefined}
      onRefresh={onRefresh}
    />
  );
}

test("扫描失败时只说失败，不再同时说「没有匹配的会话」", () => {
  renderBrokenList();

  expect(screen.getByRole("alert")).toHaveTextContent("会话列表读取失败");
  // 扫描失败时列表本来就是空的，此时再说「调整搜索词后重试」是在给一个错的建议。
  expect(screen.queryByText("没有匹配的会话")).toBeNull();
});

test("侧栏错误态的正文不含绝对路径，也不含写给维护者的话", async () => {
  const user = userEvent.setup();
  renderBrokenList();

  const box = screen.getByRole("alert");
  expect(box.textContent).not.toContain("/Users/");
  expect(box.textContent).not.toContain("夹具");
  expect(box.textContent).not.toContain("静默返回空数组");
  expect(box.innerHTML).not.toContain("/Users/");

  // 反向：原文仍然拿得到（存放在折叠的「详情」里），只是不再糊在脸上。
  await user.click(screen.getByText("详情"));
  expect(box.textContent).toContain("/Users/e2e/.claude/projects");
});

test("侧栏错误态的「重试」重新发起扫描", async () => {
  const user = userEvent.setup();
  const onRefresh = vi.fn();
  renderBrokenList(onRefresh);

  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test("没有错误时不出现错误态——它不该常驻在侧栏里", () => {
  renderList();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("会话列表读取失败")).toBeNull();
});

/**
 * 出血点徽章。核心验收点是**同源**：徽章上的数字必须和进入「出血点」标签后
 * 看到的 `compactionCount` 是同一个数——两边都来自 `buildBleedReport`。
 *
 * 所以下面的期望值一律**从模型侧取**（`buildBleedReport(parsed).compactionCount`），
 * 绝不在测试里另写一个数字：手写两遍的「2」只能证明我抄得对，证明不了同源。
 * 真出现第二套口径（比如列表自己 grep `compact_boundary`），这两边就会分叉。
 */
const COMPACT_FIXTURE = readFileSync(
  resolve(process.cwd(), "tests/fixtures/compact-session.jsonl"),
  "utf8"
);
const NO_COMPACT_FIXTURE = readFileSync(
  resolve(process.cwd(), "tests/fixtures/pulse-compact-none.jsonl"),
  "utf8"
);

function bleedSession(path: string, customTitle: string, mtimeMs: number): SessionMeta {
  return {
    path,
    projectLabel: customTitle,
    customTitle,
    mtimeMs,
    sizeBytes: 1,
    hasRecords: true
  };
}

function renderWithBleed(
  list: SessionMeta[],
  bleedCounts: ReadonlyMap<string, number | undefined>,
  onOpenBleed = vi.fn(),
  onSelect = vi.fn()
) {
  return render(
    <SessionList
      sessions={list}
      selected={null}
      loading={false}
      error={null}
      bleedCounts={bleedCounts}
      onSelect={onSelect}
      onOpenBleed={onOpenBleed}
      onRefresh={() => undefined}
    />
  );
}

test("徽章数字与 buildBleedReport 同源：模型说几次就显示几次", () => {
  const fixturePath = "/repo/compact.jsonl";
  const parsed = parseJsonlText(COMPACT_FIXTURE, fixturePath);
  // 唯一的真值来源。夹具本身非空，避免「同源」退化成一个 0 === 0 的空断言。
  const expected = buildBleedReport(parsed).compactionCount;
  expect(expected).toBeGreaterThan(0);

  renderWithBleed(
    [bleedSession(fixturePath, "压缩过的会话", 1)],
    new Map([[fixturePath, expected]])
  );

  const badge = document.querySelector(`[data-bleed-badge]`);
  expect(badge).not.toBeNull();
  expect(badge!.textContent).toContain(String(expected));
  expect(badge!.getAttribute("aria-label")).toContain(`${expected} 次压缩`);
});

test("徽章跟着模型走：同一个组件在两个夹具上显示各自的 compactionCount", () => {
  // 上一条只在一个夹具上比了一次数字，理论上「写死一个常量」也能骗过它。
  // 这条把两个**压缩次数不同**的夹具并排放进同一个列表：如果组件里藏着第二套
  // 口径（或写死的数字），两行就不可能同时对上模型。
  const compactPath = "/repo/compact.jsonl";
  const plainPath = "/repo/plain.jsonl";
  const compactCount = buildBleedReport(parseJsonlText(COMPACT_FIXTURE, compactPath))
    .compactionCount;
  const plainCount = buildBleedReport(parseJsonlText(NO_COMPACT_FIXTURE, plainPath))
    .compactionCount;
  expect(compactCount).toBeGreaterThan(0);
  expect(plainCount).toBe(0);
  // 两个夹具确实不同，否则这条测试退化成上一条的复制品。
  expect(compactCount).not.toBe(plainCount);

  renderWithBleed(
    [bleedSession(compactPath, "压缩过的会话", 2), bleedSession(plainPath, "没压缩的会话", 1)],
    new Map([
      [compactPath, compactCount],
      [plainPath, plainCount]
    ])
  );

  const badges = document.querySelectorAll(`[data-bleed-badge]`);
  expect(badges).toHaveLength(1);
  expect(badges[0].textContent).toContain(`${compactCount} 次压缩`);
});

test("0 次压缩不渲染徽章——「不知道」与「确认没有」在数据层是两个值", () => {
  const fixturePath = "/repo/plain.jsonl";
  const parsed = parseJsonlText(NO_COMPACT_FIXTURE, fixturePath);
  expect(buildBleedReport(parsed).compactionCount).toBe(0);

  const unknownPath = "/repo/unknown.jsonl";
  // `undefined` = 还没算出来 / 读取失败；`0` = 算出来确认没有压缩。
  // 两者都不画徽章，但在数据层必须仍是不同的值（下面断言）。
  const counts = new Map<string, number | undefined>([
    [fixturePath, 0],
    [unknownPath, undefined]
  ]);

  expect(counts.get(fixturePath)).toBe(0);
  expect(counts.get(fixturePath)).not.toBe(counts.get(unknownPath));
  expect(Number.isNaN(counts.get(unknownPath))).toBe(false);

  renderWithBleed(
    [bleedSession(fixturePath, "没压缩的会话", 1), bleedSession(unknownPath, "未知的会话", 2)],
    counts
  );

  expect(document.querySelectorAll(`[data-bleed-badge]`)).toHaveLength(0);
  expect(screen.getByRole("button", { name: /没压缩的会话/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /未知的会话/ })).toBeInTheDocument();
});

test("点击徽章走出血点入口，点击行的其余部分仍走普通选中", async () => {
  const user = userEvent.setup();
  const path = "/repo/compact.jsonl";
  const parsed = parseJsonlText(COMPACT_FIXTURE, path);
  const count = buildBleedReport(parsed).compactionCount;
  const onOpenBleed = vi.fn();
  const onSelect = vi.fn();
  renderWithBleed(
    [bleedSession(path, "压缩过的会话", 1)],
    new Map([[path, count]]),
    onOpenBleed,
    onSelect
  );

  await user.click(document.querySelector(`[data-bleed-badge]`)!);
  // 徽章在会话按钮**内部**，所以这条同时证明 stopPropagation 生效：
  // 点徽章不该顺带触发外层的「打开会话并留在当前标签」。
  expect(onOpenBleed).toHaveBeenCalledTimes(1);
  expect(onOpenBleed.mock.calls[0][0].path).toBe(path);
  expect(onSelect).not.toHaveBeenCalled();

  // 反向：点行的其余部分不触发出血点入口。
  await user.click(screen.getByRole("button", { name: /压缩过的会话/ }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onOpenBleed).toHaveBeenCalledTimes(1);
});

test("fail-safe：没给出血点入口时，徽章仍可点且退化为普通选中", async () => {
  const user = userEvent.setup();
  const path = "/repo/compact.jsonl";
  const count = buildBleedReport(parseJsonlText(COMPACT_FIXTURE, path)).compactionCount;
  const onSelect = vi.fn();
  render(
    <SessionList
      sessions={[bleedSession(path, "压缩过的会话", 1)]}
      selected={null}
      loading={false}
      error={null}
      bleedCounts={new Map([[path, count]])}
      onSelect={onSelect}
      onRefresh={() => undefined}
    />
  );

  await user.click(document.querySelector(`[data-bleed-badge]`)!);
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect.mock.calls[0][0].path).toBe(path);
});

test("不传 bleedCounts 时不渲染任何徽章——旧调用方不受影响", () => {
  renderList();
  expect(document.querySelectorAll(`[data-bleed-badge]`)).toHaveLength(0);
});

/**
 * 徽章是嵌套在会话按钮里的**独立按钮**，样式必须自带颜色与背景：
 * `.groups .sessionRow button span`（0,2,2）那条通配规则会把行内 span 染成
 * 灰色小字，徽章若不自证更具体，就会连同它的警示色一起被吞掉。
 */
test("出血点徽章不被行内 span 通配规则染色", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/features/sessions/SessionList.module.css"),
    "utf8"
  );

  const badgeRule = css.match(
    /\.groups \.sessionRow \.sessionButton \.bleedTag,\s*\.groups \.sessionRowWithStatus \.sessionButton \.bleedTag\s*\{([^}]*)\}/s
  );
  expect(badgeRule?.[1]).toContain("color: var(--warning)");
  expect(badgeRule?.[1]).toContain("background: var(--warning-soft)");
  // 与归档徽标同一高度契约：不撑高 54px 的标题行。
  expect(badgeRule?.[1]).toContain("height: var(--lh-xs)");
  // 颜色一律走令牌，不硬编码色值。
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
});

function groupLabels(container: HTMLElement): Array<string | null> {
  return [...container.querySelectorAll(`.${styles.groupToggle} strong`)].map(
    (element) => element.textContent
  );
}

function pinButtonOf(name: RegExp, label: string) {
  return within(screen.getByRole("button", { name })).getByRole("button", { name: label });
}

test("置顶：把会话提到最前的「置顶」组，并记住路径", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const { container } = renderList(onSelect);

  await user.click(pinButtonOf(/project-b/, "置顶会话"));

  // 置顶组合成在最前；顶部图钉没有顺带打开会话。
  expect(groupLabels(container)).toEqual(["置顶", "更早"]);
  expect(titles(container)).toEqual(["project-b", "project-a"]);
  expect(onSelect).not.toHaveBeenCalled();

  const pinnedRow = screen.getByRole("button", { name: /project-b/ });
  expect(within(pinnedRow).getByRole("button", { name: "取消置顶" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await waitFor(() =>
    expect(JSON.parse(window.localStorage.getItem("cca-pinned-sessions") ?? "[]")).toEqual([
      "/repo/two.jsonl"
    ])
  );
});

test("置顶：取消后回到原来的日期组，存储里的路径也清空", async () => {
  const user = userEvent.setup();
  const { container } = renderList();

  await user.click(pinButtonOf(/project-b/, "置顶会话"));
  await user.click(pinButtonOf(/project-b/, "取消置顶"));

  expect(groupLabels(container)).toEqual(["更早"]);
  expect(titles(container)).toEqual(["project-b", "project-a"]);
  await waitFor(() =>
    expect(JSON.parse(window.localStorage.getItem("cca-pinned-sessions") ?? "[]")).toEqual([])
  );
});

test("置顶：多条置顶按最近活跃降序排列，且不再出现在日期组里", async () => {
  const user = userEvent.setup();
  const { container } = renderList();

  await user.click(pinButtonOf(/project-a/, "置顶会话"));
  await user.click(pinButtonOf(/project-b/, "置顶会话"));

  expect(groupLabels(container)).toEqual(["置顶"]);
  expect(titles(container)).toEqual(["project-b", "project-a"]);
  expect(container.querySelector(`.${styles.groupCount}`)?.textContent).toBe("2");
});

test("置顶：扫描结果里已不存在的路径会被清掉，置顶状态仍从存储恢复", async () => {
  window.localStorage.setItem(
    "cca-pinned-sessions",
    JSON.stringify(["/repo/ghost.jsonl", "/repo/one.jsonl"])
  );
  const { container } = renderList();

  expect(screen.getByText("置顶")).toBeInTheDocument();
  expect(titles(container)).toEqual(["project-a", "project-b"]);
  expect(
    within(screen.getByRole("button", { name: /project-a/ })).getByRole("button", {
      name: "取消置顶"
    })
  ).toHaveAttribute("aria-pressed", "true");
  await waitFor(() =>
    expect(JSON.parse(window.localStorage.getItem("cca-pinned-sessions") ?? "[]")).toEqual([
      "/repo/one.jsonl"
    ])
  );
});

const withFacts: SessionMeta[] = [
  {
    ...sessions[0],
    metadataStatus: "complete",
    facts: {
      models: ["claude-sonnet-4-5"],
      tools: ["builtin:Bash"],
      ctxPeak: 120_000,
      errors: 2,
      durationMs: 30 * 60_000,
      messages: 8
    }
  },
  {
    ...sessions[1],
    metadataStatus: "complete",
    facts: {
      models: ["claude-opus-4-1"],
      tools: ["builtin:Read"],
      ctxPeak: 40_000,
      errors: 0,
      durationMs: 5 * 60_000,
      messages: 3
    }
  }
];

function renderFactsList(onEnsureFacts = vi.fn()) {
  return render(
    <SessionList
      sessions={withFacts}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
      onEnsureFacts={onEnsureFacts}
    />
  );
}

test("首次展开筛选栏时才补索引事实，收起不触发", async () => {
  const user = userEvent.setup();
  const onEnsureFacts = vi.fn();
  renderFactsList(onEnsureFacts);

  expect(onEnsureFacts).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /筛选会话/ }));
  expect(onEnsureFacts).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: /筛选会话/ }));
  expect(onEnsureFacts).toHaveBeenCalledTimes(1);
});

test("条件过滤是 AND：项目 + 有失败只留下同时命中的那条", async () => {
  const user = userEvent.setup();
  renderFactsList();

  await user.click(screen.getByRole("button", { name: /筛选会话/ }));
  await user.click(screen.getByRole("button", { name: /项目：全部项目/ }));
  await user.click(screen.getByRole("checkbox", { name: /project-a/ }));
  await user.click(screen.getByRole("combobox", { name: "错误" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "错误" }), "has");

  expect(screen.getAllByRole("button", { name: /project-a/ }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /project-b/ })).toBeNull();
});

test("条件全不命中时给可挽回的空态，清空后列表回来", async () => {
  const user = userEvent.setup();
  renderFactsList();

  await user.click(screen.getByRole("button", { name: /筛选会话/ }));
  await user.selectOptions(screen.getByRole("combobox", { name: "上下文峰值" }), "200000");

  expect(screen.getByText("没有符合全部条件的会话")).toBeInTheDocument();
  const clear = screen.getByRole("button", { name: /清空 1 个条件/ });
  await user.click(clear);

  expect(screen.getByRole("button", { name: /project-a/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /project-b/ })).toBeInTheDocument();
});

/* ---------- H3 排序（§4.3）：sortSelect 六键 + 组内维度排序 + 持久化 ---------- */

/** H3 专用夹具：三条会话，ctxPeak/messages/errors/durationMs 各维度名次不同，
 *  才能断言「按谁排谁在前」不是靠 mtime 撞出来的。mtime：a=300 > b=200 > c=100。 */
const sortFixture: SessionMeta[] = [
  {
    ...sessions[0],
    path: "/repo/sort-a.jsonl",
    projectLabel: "sort-a",
    cwd: "/repo/project-a",
    mtimeMs: 300,
    metadataStatus: "complete",
    facts: {
      models: ["m-a"],
      tools: ["builtin:Bash", "builtin:Read"],
      ctxPeak: 50_000,
      errors: 0,
      durationMs: 10 * 60_000,
      messages: 2
    }
  },
  {
    ...sessions[1],
    path: "/repo/sort-b.jsonl",
    projectLabel: "sort-b",
    cwd: "/repo/project-b",
    mtimeMs: 200,
    metadataStatus: "complete",
    facts: {
      models: ["m-b"],
      tools: ["builtin:Bash"],
      ctxPeak: 120_000,
      errors: 5,
      durationMs: 5 * 60_000,
      messages: 8
    }
  },
  {
    ...sessions[0],
    path: "/repo/sort-c.jsonl",
    projectLabel: "sort-c",
    cwd: "/repo/project-a",
    mtimeMs: 100,
    metadataStatus: "complete",
    facts: {
      models: ["m-c"],
      tools: [],
      ctxPeak: 80_000,
      errors: 2,
      durationMs: 30 * 60_000,
      messages: 5
    }
  }
];

function renderSortList() {
  return render(
    <SessionList
      sessions={sortFixture}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );
}

/** 时间线视图下的可见顺序（按钮 name 含 projectLabel）。 */
function visibleOrder() {
  return screen
    .getAllByRole("button", { name: /sort-[abc]/ })
    .map((button) => (button.textContent ?? "").match(/sort-[abc]/)?.[0])
    .filter((value): value is string => value !== undefined);
}

test("H3：排序下拉在工具行，六键逐字，默认最近时间", () => {
  renderSortList();

  const select = screen.getByRole("combobox", { name: "排序" });
  expect(select).toHaveAttribute("data-probe", "session-sort");
  const options = within(select).getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    "最近时间",
    "Token 最多",
    "时长最长",
    "消息最多",
    "工具调用最多",
    "错误最多"
  ]);
  expect(select).toHaveValue("recent");
  // 默认（recent）= 原 mtime 降序链，顺序与没加排序时一致。
  expect(visibleOrder()).toEqual(["sort-a", "sort-b", "sort-c"]);
});

test("H3：按 Token/messages 排组内顺序，组间仍按时间", async () => {
  const user = userEvent.setup();
  renderSortList();

  // 项目视图：a/c 同组（project-a）、b 独组。
  await user.click(screen.getByRole("tab", { name: "项目" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "tokens");
  // tokens=ctxPeak：组内 c(80k) 反超 a(50k)；组间按组内首条时间——
  // 排序后 project-a 组首条是 c（mtime 100）< b（200），组 b 到前面。
  expect(visibleOrder()).toEqual(["sort-b", "sort-c", "sort-a"]);

  await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "messages");
  // messages：b(8) > c(5) > a(2)——组间仍按首条时间（c 100 < b 200），b 组在前。
  expect(visibleOrder()).toEqual(["sort-b", "sort-c", "sort-a"]);

  // 切回最近时间：组内回 mtime 序（a 前 c），组间仍按首条（a 300 > b 200）。
  await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "recent");
  expect(visibleOrder()).toEqual(["sort-a", "sort-c", "sort-b"]);
});

test("H3：排序键写进 cca-session-sort，重挂载恢复；非法值回落 recent", async () => {
  const user = userEvent.setup();
  const first = renderSortList();
  await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "errors");
  await waitFor(() =>
    expect(window.localStorage.getItem("cca-session-sort")).toBe("errors")
  );
  first.unmount();

  window.localStorage.setItem("cca-session-sort", "not-a-key");
  const second = renderSortList();
  // 非法值不抛、回落 recent（readStoredView 同款白名单读）。
  expect(screen.getByRole("combobox", { name: "排序" })).toHaveValue("recent");
  second.unmount();

  window.localStorage.setItem("cca-session-sort", "messages");
  renderSortList();
  expect(screen.getByRole("combobox", { name: "排序" })).toHaveValue("messages");
});

test("H3：全部会话缺该维度读数时给「先按时间排」提示，列表不空白", async () => {
  const user = userEvent.setup();
  // 夹具整体不带 facts（未索引）——任何维度都取不出读数。
  const noFacts = sortFixture.map(({ facts: _facts, metadataStatus: _status, ...rest }) => rest);
  render(
    <SessionList
      sessions={noFacts}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "messages");
  expect(screen.getByText("这批会话还没有消息读数，先按时间排")).toBeInTheDocument();
  // 列表本体照常渲染（时间序），不空白。
  expect(visibleOrder()).toEqual(["sort-a", "sort-b", "sort-c"]);
  // recent 键不提示（时间永远有）。
  await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "recent");
  expect(screen.queryByText(/先按时间排/)).not.toBeInTheDocument();
});

test("H3：缺读数的会话垫底，有读数的照常排", async () => {
  const user = userEvent.setup();
  // b 有读数（messages 8 最大），a/c 缺 facts——两者都在 b 后。
  const mixed: SessionMeta[] = [
    sortFixture[1],
    ...sortFixture.slice(0, 1).map(({ facts: _f, metadataStatus: _s, ...rest }) => rest),
    ...sortFixture.slice(2).map(({ facts: _f2, metadataStatus: _s2, ...rest }) => rest)
  ];
  render(
    <SessionList
      sessions={mixed}
      selected={null}
      loading={false}
      error={null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />
  );

  await user.click(screen.getByRole("tab", { name: "时间线" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "messages");
  const order = visibleOrder();
  expect(order[0]).toBe("sort-b");
  expect(new Set(order.slice(1))).toEqual(new Set(["sort-a", "sort-c"]));
});
