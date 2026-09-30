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
    const height = /height:\s*(\d+)px/.exec(match![1]);
    expect(height, `规则 .${selector} 没有字面量 height`).not.toBeNull();
    return Number(height![1]);
  };

  expect(constant("GROUP_ROW_HEIGHT")).toBe(ruleHeight("groupRow"));
  expect(constant("SESSION_ROW_HEIGHT")).toBe(ruleHeight("sessionRow"));
  expect(constant("SESSION_ROW_HEIGHT_WITH_STATUS")).toBe(ruleHeight("sessionRowWithStatus"));
});
