import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionAnalyzerPage } from "./SessionAnalyzerPage";
import { enable, resetArchiveTask, runNow } from "../archive/archiveTask";
import { BridgesProvider } from "../../api/bridges";
import { NotificationProvider } from "../../app/NotificationProvider";
import type { Bridges } from "../../api/types";

import tokenFixture from "../../../tests/fixtures/session-token-usage.jsonl?raw";

function createBridges(): Bridges {
  return {
    fs: {
      homeDir: vi.fn(async () => "/home/tester"),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir: vi.fn(async (path: string) =>
        path.endsWith("projects")
          ? [{ name: "project-a", is_dir: true, is_file: false }]
          : [{ name: "session.jsonl", is_dir: false, is_file: true }]
      ),
      stat: vi.fn(async () => ({ is_file: true, size: 10, mtime_ms: 42 })),
      readHead: vi.fn(async () => JSON.stringify({ sessionId: "session-1", cwd: "/repo" })),
      readText: vi.fn(async () => JSON.stringify({
        type: "user",
        sessionId: "session-1",
        timestamp: "2026-01-02T03:04:05.000Z",
        message: { content: "hello" }
      })),
      writeText: vi.fn(async () => undefined)
    },
    proc: {
      execText: vi.fn(async () => ({ ok: true, out: "--output-format stream-json" })),
      runLines: vi.fn(async () => ({ ok: true, stderr: "" })),
      spawnDetached: vi.fn(async () => undefined)
    },
    events: { onSessionImport: vi.fn(async () => () => undefined) },
    clipboard: { writeText: vi.fn(async () => undefined) },
    system: { openFolder: vi.fn(async () => undefined), openClaudeTerminal: vi.fn(async () => undefined) },
    dialog: {
      saveMarkdown: vi.fn(async () => "/tmp/report.md"),
      saveText: vi.fn(async () => "/tmp/export.out")
    }
  } as unknown as Bridges;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function parentGraphJsonl(sessionId: string, prompt: string, childSessionPath: string) {
  return [
    JSON.stringify({
      type: "user",
      sessionId,
      timestamp: "1970-01-01T00:00:00.000Z",
      uuid: `${sessionId}-user`,
      message: { role: "user", content: prompt }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId,
      timestamp: "1970-01-01T00:00:01.000Z",
      uuid: `${sessionId}-agent-use`,
      message: {
        id: `${sessionId}-message`,
        model: "claude",
        content: [{ type: "tool_use", id: `${sessionId}-agent`, name: "Agent", input: {} }]
      }
    }),
    JSON.stringify({
      type: "user",
      sessionId,
      timestamp: "1970-01-01T00:00:02.000Z",
      uuid: `${sessionId}-agent-result`,
      childSessionPath,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `${sessionId}-agent`, content: "done" }]
      }
    })
  ].join("\n");
}

test("renders empty state before a session is selected", async () => {
  render(
    <BridgesProvider bridges={createBridges()}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  expect(screen.getByText("选择一个会话开始分析")).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText(/project-a/).length).toBeGreaterThan(0));
});

test("opens a session, filters records, and shows details", async () => {
  const user = userEvent.setup();
  render(
    <BridgesProvider bridges={createBridges()}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  expect(await screen.findByRole("application", { name: "时间轨道" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "记录筛选" })).toBeInTheDocument();
  expect(screen.getByText(/hello/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "展开" }));
  // 展开后记录内容面板也会出现同样的文本，点操作列选中该行。
  await user.click(screen.getByText("提问"));
  expect(await screen.findByRole("complementary", { name: "记录详情" })).toBeInTheDocument();
});

test("ignores a stale session read after rapid switching", async () => {
  const resolvers = new Map<string, (value: string) => void>();
  const bridges = createBridges();
  bridges.fs.readDir = vi.fn(async (path: string) => {
    if (path.endsWith("projects")) {
      return [
        { name: "project-a", is_dir: true, is_file: false },
        { name: "project-b", is_dir: true, is_file: false }
      ];
    }
    return [{ name: "session.jsonl", is_dir: false, is_file: true }];
  });
  bridges.fs.readText = vi.fn((path: string) => {
    if (path.endsWith("meta-cache-v2.json")) {
      return Promise.resolve(JSON.stringify({ version: 1, entries: {} }));
    }
    // 归档索引：首次运行不存在，真实桥接是抛错；这里照做，免得它被当成
    // 会话文件挂进 resolvers —— 那会让会话列表永远等不到内容。
    if (path.endsWith("archive-index.json")) {
      return Promise.reject(new Error(`no such file or directory: ${path}`));
    }
    return new Promise<string>((resolve) => resolvers.set(path, resolve));
  }) as Bridges["fs"]["readText"];

  const user = userEvent.setup();
  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  await user.click(await screen.findByRole("button", { name: /project-b/ }));
  const newResolver = resolvers.get("/home/tester/.claude/projects/project-b/session.jsonl");
  const oldResolver = resolvers.get("/home/tester/.claude/projects/project-a/session.jsonl");
  expect(newResolver).toBeDefined();
  expect(oldResolver).toBeDefined();

  await act(async () => {
    newResolver?.(JSON.stringify({
      type: "user",
      sessionId: "session-b",
      timestamp: "2026-01-02T03:04:05.000Z",
      message: { content: "second content" }
    }));
  });
  expect(await screen.findByText(/second content/)).toBeInTheDocument();

  await act(async () => {
    oldResolver?.(JSON.stringify({
      type: "user",
      sessionId: "session-a",
      timestamp: "2026-01-02T03:04:05.000Z",
      message: { content: "first content" }
    }));
  });
  expect(screen.queryByText(/first content/)).not.toBeInTheDocument();
  expect(screen.getByText(/second content/)).toBeInTheDocument();
});

test("shows graph warnings when a child session cannot be resolved", async () => {
  const parentText = parentGraphJsonl(
    "parent-session",
    "分析子 agent",
    "/home/tester/.claude/projects/project-a/session/subagents/agent-child.jsonl"
  );
  const bridges = createBridges();
  bridges.fs.readText = vi.fn(async (path: string) => {
    if (path.endsWith("meta-cache-v2.json")) {
      return JSON.stringify({ version: 1, entries: {} });
    }
    if (path.endsWith("session.jsonl")) return parentText;
    if (path.endsWith("archive-index.json")) throw new Error(`no such file: ${path}`);
    throw new Error("子会话不可读");
  }) as Bridges["fs"]["readText"];

  const user = userEvent.setup();
  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  expect(await screen.findByRole("status", { name: "会话图状态" })).toHaveTextContent("1 个警告");
});

test("ignores a stale graph resolution after rapid session switching", async () => {
  const mainAPath = "/home/tester/.claude/projects/project-a/session.jsonl";
  const mainBPath = "/home/tester/.claude/projects/project-b/session.jsonl";
  const childAPath = "/home/tester/.claude/projects/project-a/session/subagents/agent-child-a.jsonl";
  const childBPath = "/home/tester/.claude/projects/project-b/session/subagents/agent-child-b.jsonl";
  const parentA = parentGraphJsonl("session-a", "分析子 agent A", childAPath);
  const parentB = parentGraphJsonl("session-b", "分析子 agent B", childBPath);
  const childA = JSON.stringify({
    type: "assistant",
    sessionId: "child-a",
    timestamp: "1970-01-01T00:00:01.000Z",
    uuid: "child-a-record",
    isSidechain: true,
    message: {
      id: "child-a-message",
      model: "claude",
      content: [{ type: "text", text: "stale child A" }]
    }
  });
  const childB = JSON.stringify({
    type: "assistant",
    sessionId: "child-b",
    timestamp: "1970-01-01T00:00:01.000Z",
    uuid: "child-b-record",
    isSidechain: true,
    message: {
      id: "child-b-message",
      model: "claude",
      content: [{ type: "text", text: "fresh child B" }]
    }
  });

  const deferred = new Map<string, Deferred<string>>();
  const deferRead = (path: string) => {
    const pending = createDeferred<string>();
    deferred.set(path, pending);
    return pending.promise;
  };
  const bridges = createBridges();
  bridges.fs.readDir = vi.fn(async (path: string) =>
    path.endsWith("projects")
      ? [
          { name: "project-a", is_dir: true, is_file: false },
          { name: "project-b", is_dir: true, is_file: false }
        ]
      : path.endsWith("project-a") || path.endsWith("project-b")
        ? [{ name: "session.jsonl", is_dir: false, is_file: true }]
        : []
  );
  bridges.fs.readText = vi.fn((path: string) => {
    if (path.endsWith("meta-cache-v2.json")) {
      return Promise.resolve(JSON.stringify({ version: 1, entries: {} }));
    }
    if (path.endsWith("archive-index.json")) {
      return Promise.reject(new Error(`no such file or directory: ${path}`));
    }
    return deferRead(path);
  }) as Bridges["fs"]["readText"];

  const user = userEvent.setup();
  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  await act(async () => {
    deferred.get(mainAPath)?.resolve(parentA);
  });
  await screen.findByText(/分析子 agent A/);
  await user.click(await screen.findByRole("button", { name: /project-b/ }));
  await act(async () => {
    deferred.get(mainBPath)?.resolve(parentB);
  });
  await screen.findByText(/分析子 agent B/);
  await user.click(within(screen.getByRole("table")).getByText("Agent"));

  await act(async () => {
    deferred.get(childBPath)?.resolve(childB);
  });
  expect(await screen.findByRole("status", { name: "会话图状态" })).toHaveTextContent("会话图已加载");
  expect(await screen.findByText("fresh child B")).toBeInTheDocument();

  await act(async () => {
    deferred.get(childAPath)?.resolve(childA);
  });
  expect(screen.queryByText("stale child A")).not.toBeInTheDocument();
  expect(screen.getByText("fresh child B")).toBeInTheDocument();
});

test("loads child session records as a subagent", async () => {
  const parentText = parentGraphJsonl(
    "parent-session",
    "分析子 agent",
    "/home/tester/.claude/projects/project-a/session/subagents/agent-child.jsonl"
  );
  const childText = JSON.stringify({
    type: "assistant",
    timestamp: "2026-01-02T03:04:08.000Z",
    uuid: "sidechain-1",
    isSidechain: true,
    message: {
      id: "sidechain-message",
      model: "claude",
      content: [{ type: "text", text: "sidechain child" }]
    }
  });
  const bridges = createBridges();
  bridges.fs.readText = vi.fn(async (path: string) => {
    if (path.endsWith("meta-cache-v2.json")) {
      return JSON.stringify({ version: 1, entries: {} });
    }
    if (path.endsWith("session.jsonl")) return parentText;
    if (path.endsWith("child.jsonl")) return childText;
    throw new Error("不可读");
  }) as Bridges["fs"]["readText"];
  const user = userEvent.setup();
  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  expect(await screen.findByRole("status", { name: "会话图状态" })).toHaveTextContent("会话图已加载");

  await user.click(within(await screen.findByRole("table")).getByText("Agent"));
  expect(await screen.findByRole("region", { name: "子 agent 记录" })).toContainElement(
    await screen.findByText("sidechain child")
  );
});

test("hands the resolved session graph to report generation", async () => {
  const parentText = [
    parentGraphJsonl(
      "parent-session",
      "分析子 agent",
      "/home/tester/.claude/projects/project-a/session/subagents/agent-child.jsonl"
    ),
    JSON.stringify({
      type: "assistant",
      sessionId: "parent-session",
      timestamp: "1970-01-01T00:00:10.000Z",
      uuid: "parent-tail",
      message: {
        id: "parent-tail-message",
        model: "claude",
        content: [{ type: "text", text: "done" }]
      }
    })
  ].join("\n");
  const childText = [
    JSON.stringify({
      type: "user",
      sessionId: "child",
      timestamp: "1970-01-01T00:00:01.000Z",
      uuid: "child-user",
      message: { role: "user", content: "child prompt" }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "child",
      timestamp: "1970-01-01T00:00:06.000Z",
      uuid: "child-done",
      message: {
        id: "child-message",
        model: "claude",
        content: [{ type: "text", text: "child done" }]
      }
    })
  ].join("\n");

  const bridges = createBridges();
  bridges.fs.readText = vi.fn(async (path: string) => {
    if (path.endsWith("meta-cache-v2.json")) {
      return JSON.stringify({ version: 1, entries: {} });
    }
    if (path.endsWith("session.jsonl")) return parentText;
    if (path.endsWith("child.jsonl")) return childText;
    throw new Error("不可读");
  }) as Bridges["fs"]["readText"];

  const user = userEvent.setup();
  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  await waitFor(() =>
    expect(screen.getByRole("status", { name: "会话图状态" })).toHaveTextContent("会话图已加载")
  );

  await user.click(screen.getByRole("button", { name: "生成整会话分析" }));

  await waitFor(() => expect(bridges.proc.runLines).toHaveBeenCalled());
  const stdinText = vi.mocked(bridges.proc.runLines).mock.calls[0]?.[2];
  // 委托记录本身只有 1s；5s 来自会话图解析出的子会话区间。
  expect(stdinText).toContain("- 子 agent: 5.00s");
});

function graphBridges(): Bridges {
  const parentText = [
    parentGraphJsonl(
      "parent-session",
      "分析子 agent",
      "/home/tester/.claude/projects/project-a/session/subagents/agent-child.jsonl"
    ),
    JSON.stringify({
      type: "assistant",
      sessionId: "parent-session",
      timestamp: "1970-01-01T00:00:10.000Z",
      uuid: "parent-tail",
      message: {
        id: "parent-tail-message",
        model: "claude",
        content: [{ type: "text", text: "done" }]
      }
    })
  ].join("\n");
  const childText = [
    JSON.stringify({
      type: "user",
      sessionId: "child",
      timestamp: "1970-01-01T00:00:01.000Z",
      uuid: "child-user",
      message: { role: "user", content: "child prompt" }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "child",
      timestamp: "1970-01-01T00:00:06.000Z",
      uuid: "child-done",
      message: {
        id: "child-message",
        model: "claude",
        content: [{ type: "text", text: "child done" }]
      }
    })
  ].join("\n");

  const bridges = createBridges();
  bridges.fs.readText = vi.fn(async (path: string) => {
    if (path.endsWith("meta-cache-v2.json")) {
      return JSON.stringify({ version: 1, entries: {} });
    }
    if (path.endsWith("session.jsonl")) return parentText;
    if (path.endsWith("child.jsonl")) return childText;
    throw new Error("不可读");
  }) as Bridges["fs"]["readText"];
  return bridges;
}

test("switches between the log and tree views and remembers the choice", async () => {
  window.localStorage.clear();
  const user = userEvent.setup();
  render(
    <BridgesProvider bridges={createBridges()}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  expect(await screen.findByRole("table")).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "树视图" }));

  expect(await screen.findByRole("tree", { name: "耗时树" })).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(window.localStorage.getItem("cca-analyzer-view")).toBe("tree");

  await user.click(screen.getByRole("tab", { name: "日志视图" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
});

test("enters a child session from the tree view", async () => {
  window.localStorage.clear();
  const user = userEvent.setup();
  render(
    <BridgesProvider bridges={graphBridges()}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  await waitFor(() =>
    expect(screen.getByRole("status", { name: "会话图状态" })).toHaveTextContent("2 个会话")
  );

  await user.click(screen.getByRole("tab", { name: "树视图" }));
  await user.click(await screen.findByRole("button", { name: "进入子会话" }));

  await waitFor(() =>
    expect(screen.getByRole("status", { name: "会话图状态" })).toHaveTextContent("1 个会话")
  );
});

test("scopes report generation to the analysed tree node", async () => {
  window.localStorage.clear();
  const user = userEvent.setup();
  const bridges = graphBridges();
  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  await waitFor(() =>
    expect(screen.getByRole("status", { name: "会话图状态" })).toHaveTextContent("会话图已加载")
  );

  await user.click(screen.getByRole("tab", { name: "树视图" }));
  await user.click(await screen.findByRole("button", { name: "用 claude 分析此子agent" }));

  await waitFor(() => expect(bridges.proc.runLines).toHaveBeenCalled());
  const stdinText = vi.mocked(bridges.proc.runLines).mock.calls[0]?.[2];
  expect(stdinText).toContain("# 角色");
  expect(stdinText).toContain("- 报告模式: 节点分析");
  // The agent node's action analyses the child session itself.
  expect(stdinText).toContain("- 会话 ID: child");
  expect(screen.getByRole("tab", { name: /节点分析/ })).toHaveAttribute("aria-selected", "true");
});

test("locates a log row in the tree view and back", async () => {
  window.localStorage.clear();
  const user = userEvent.setup();
  render(
    <BridgesProvider bridges={graphBridges()}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  await waitFor(() =>
    expect(screen.getByRole("status", { name: "会话图状态" })).toHaveTextContent("会话图已加载")
  );

  await user.click(screen.getAllByRole("button", { name: "在树视图定位" })[0]);
  expect(await screen.findByRole("tree", { name: "耗时树" })).toBeInTheDocument();

  await user.click(screen.getAllByRole("button", { name: "定位日志" })[0]);
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.queryByRole("tree", { name: "耗时树" })).not.toBeInTheDocument();
});

test("shows the session header and opens the session folder", async () => {
  window.localStorage.clear();
  const user = userEvent.setup();
  const bridges = createBridges();
  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));

  const header = await screen.findByRole("banner", { name: "会话信息" });
  expect(header).toHaveTextContent("总耗时");
  expect(header).toHaveTextContent("项目 /repo");

  await user.click(within(header).getByRole("button", { name: "打开位置" }));
  expect(bridges.system.openFolder).toHaveBeenCalledWith(
    "/home/tester/.claude/projects/project-a"
  );
});

test("exports the session from the header, then closes and confirms", async () => {
  window.localStorage.clear();
  const user = userEvent.setup();
  const bridges = createBridges();
  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  expect(await screen.findByRole("application", { name: "时间轨道" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "导出" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "导出会话报告" })).toBeInTheDocument();
  expect(within(dialog).getByText(/将导出 \d+ 条记录/)).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "保存…" }));

  await waitFor(() => expect(bridges.dialog.saveText).toHaveBeenCalledTimes(1));
  const [name, contents] = vi.mocked(bridges.dialog.saveText).mock.calls[0];
  expect(name).toMatch(/^cc-analyzer-[a-z0-9]{1,8}-filtered\.html$/);
  expect(name).not.toMatch(/[^A-Za-z0-9._-]/);
  expect(contents.startsWith("<!doctype html>")).toBe(true);

  // 保存成功后浮层关闭，反馈交给全局 toast（浮层开着时它会被遮罩压住）。
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByText(/已导出 HTML 报告/)).toBeInTheDocument();
});

test("folds the token panel behind the session header chip", async () => {
  window.localStorage.clear();
  const user = userEvent.setup();
  const bridges = createBridges();
  bridges.fs.readText = vi.fn(async (path: string) => {
    if (path.endsWith("meta-cache-v2.json")) return JSON.stringify({ version: 1, entries: {} });
    return path.endsWith(".jsonl") ? tokenFixture : "{}";
  }) as Bridges["fs"]["readText"];

  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  await user.click(await screen.findByRole("button", { name: /project-a/ }));
  expect(await screen.findByRole("application", { name: "时间轨道" })).toBeInTheDocument();

  // 读数行（「会话读数」按钮）接管了原「Token 计数」chip 的展开职责。
  const chip = screen.getByRole("button", { name: "会话读数" });
  // 默认折叠：面板是会话级明细，不该挤占「时间线 + 筛选 + 视图」的主流程高度。
  expect(chip).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("region", { name: "Token 计数" })).not.toBeInTheDocument();

  await user.click(chip);
  const panel = screen.getByRole("region", { name: "Token 计数" });
  expect(chip).toHaveAttribute("aria-expanded", "true");
  expect(within(panel).getByText("缓存读取")).toBeInTheDocument();
  expect(within(panel).getByText("成本未知 · 未收录该模型定价")).toBeInTheDocument();

  await user.click(chip);
  expect(screen.queryByRole("region", { name: "Token 计数" })).not.toBeInTheDocument();
});

test("归档完成后自动刷新会话列表", async () => {
  window.localStorage.clear();
  resetArchiveTask();
  const bridges = createBridges();
  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <SessionAnalyzerPage />
      </NotificationProvider>
    </BridgesProvider>
  );

  // 先等首屏扫描落地，再数 readDir 的调用次数作为「有没有重扫」的判据。
  await screen.findByRole("button", { name: /project-a/ });
  const before = vi.mocked(bridges.fs.readDir).mock.calls.length;

  enable(bridges);
  await runNow(bridges);

  // 归档完成 → 列表必须自己重扫一次（否则用户点完「立即归档」看不到任何变化）。
  await waitFor(() =>
    expect(vi.mocked(bridges.fs.readDir).mock.calls.length).toBeGreaterThan(before)
  );
});
