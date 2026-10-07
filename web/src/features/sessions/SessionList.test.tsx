import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionList } from "./SessionList";
import type { SessionMeta } from "./metadataCache";
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

test("shows title completion progress", () => {
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

  const status = screen.getByRole("status", { name: "标题补全进度" });
  expect(status).toHaveTextContent("正在补全标题 3/10");
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
  // 徽标内联在标题行里：button > .titleLine > strong + .archiveTag。
  const titleLine = badge.parentElement!;
  expect(titleLine.classList.contains(styles.titleLine)).toBe(true);
  expect(titleLine.querySelector("strong")?.textContent).toBe("归档会话");

  const button = titleLine.parentElement!;
  expect(button.tagName).toBe("BUTTON");
  expect(button.children[0]).toBe(titleLine);
  // 不是行的直接 grid 子元素 —— 那会多出一行 grid row，把 54px 的行高撑坏。
  expect(Array.from(button.children)).not.toContain(badge);

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
    ([, selector]) => /\bbutton span\b/.test(selector) && !/\.meta|\.archiveTag/.test(selector)
  );
  expect(
    broadSpanRules.every(([, , body]) => !/color:\s*var\(--text-tertiary\)/.test(body))
  ).toBe(true);

  const metaRule = css.match(
    /\.groups \.sessionRow button \.meta,\s*\.groups \.sessionRowWithStatus button \.meta\s*\{([^}]*)\}/s
  );
  expect(metaRule?.[1]).toContain("color: var(--text-tertiary)");

  const badgeRule = css.match(
    /\.archiveTag,\s*\.groups \.sessionRowWithStatus button \.archiveTag\s*\{([^}]*)\}/s
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
