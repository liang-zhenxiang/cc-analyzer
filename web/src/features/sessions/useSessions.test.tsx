import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import type { ReactNode } from "react";
import type { SessionMeta } from "./metadataCache";
import { SessionRepository } from "./sessionRepository";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges, DirEntry } from "../../api/types";
import { useSessions } from "./useSessions";

function createBridges(): Bridges {
  return {
    fs: {
      homeDir: vi.fn(async () => "/home/tester"),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir: vi.fn(async () => []),
      readText: vi.fn(async () => "{}"),
      readHead: vi.fn(async () => "{}"),
      writeText: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ is_file: true, size: 1, mtime_ms: 1 }))
    },
    events: { onSessionImport: vi.fn(async () => () => undefined) }
  } as unknown as Bridges;
}

function renderSessionsHook(bridges: Bridges) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BridgesProvider bridges={bridges}>{children}</BridgesProvider>
  );
  return renderHook(() => useSessions(), { wrapper });
}

afterEach(() => {
  vi.restoreAllMocks();
});

function pendingSession(path: string, mtimeMs: number): SessionMeta {
  return {
    path,
    projectLabel: "repo-demo",
    mtimeMs,
    sizeBytes: 10,
    hasRecords: false,
    metadataStatus: "pending"
  };
}

function completeSession(path: string, mtimeMs: number, sessionId: string): SessionMeta {
  return {
    ...pendingSession(path, mtimeMs),
    sessionId,
    metadataStatus: "complete"
  };
}

test("loads sessions and exposes refresh state", async () => {
  const bridges = createBridges();
  const { result } = renderSessionsHook(bridges);

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.sessions).toEqual([]);
  expect(result.current.error).toBeNull();
  expect(bridges.events.onSessionImport).toHaveBeenCalledTimes(1);
});

test("imports an externally selected session", async () => {
  const bridges = createBridges();
  const { result } = renderSessionsHook(bridges);
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    await result.current.importPath("/tmp/imported.jsonl");
  });

  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.sessions[0].path).toBe("/tmp/imported.jsonl");
});

test("updates sessions as metadata batches complete", async () => {
  const bridges = createBridges();
  let resolveHead: (value: string) => void = () => undefined;
  bridges.fs.readDir = vi.fn(async (path: string) =>
    path.endsWith("projects")
      ? [{ name: "repo-demo", is_dir: true, is_file: false }]
      : [{ name: "session.jsonl", is_dir: false, is_file: true }]
  );
  bridges.fs.readHead = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveHead = resolve;
      })
  );

  const { result } = renderSessionsHook(bridges);

  await waitFor(() =>
    expect(result.current.sessions[0]).toMatchObject({
      metadataStatus: "pending"
    })
  );

  await act(async () => {
    resolveHead(JSON.stringify({ sessionId: "session-1", cwd: "/repo" }));
  });

  await waitFor(() =>
    expect(result.current.sessions[0]).toMatchObject({
      sessionId: "session-1",
      metadataStatus: "complete"
    })
  );
  expect(result.current.error).toBeNull();
});

test("applies metadata batches by path without reordering sessions", async () => {
  const sessions = [
    pendingSession("/session-2.jsonl", 2),
    pendingSession("/session-1.jsonl", 1)
  ];
  const firstBatch = [completeSession("/session-2.jsonl", 2, "session-2")];
  const secondBatch = [completeSession("/session-1.jsonl", 1, "session-1")];
  const finalResult = [firstBatch[0], { ...secondBatch[0], metadataStatus: "failed" as const }];
  let releaseFirstBatch: () => void = () => undefined;
  let releaseFinalResult: () => void = () => undefined;
  vi.spyOn(SessionRepository.prototype, "listSessions").mockResolvedValue(sessions);
  vi.spyOn(SessionRepository.prototype, "completeMetadata").mockImplementation(
    async (_sessions, onProgress) => {
      onProgress?.({ done: 1, total: 2, batch: firstBatch });
      await new Promise<void>((resolve) => {
        releaseFirstBatch = resolve;
      });
      onProgress?.({ done: 2, total: 2, batch: secondBatch });
      await new Promise<void>((resolve) => {
        releaseFinalResult = resolve;
      });
      return finalResult;
    }
  );

  const bridges = createBridges();
  const { result } = renderSessionsHook(bridges);

  await waitFor(() =>
    expect(result.current.sessions.map((session) => [session.path, session.metadataStatus])).toEqual([
      ["/session-2.jsonl", "complete"],
      ["/session-1.jsonl", "pending"]
    ])
  );

  await act(async () => {
    releaseFirstBatch();
  });
  await waitFor(() =>
    expect(result.current.sessions.map((session) => [session.path, session.metadataStatus])).toEqual([
      ["/session-2.jsonl", "complete"],
      ["/session-1.jsonl", "complete"]
    ])
  );
  expect(result.current.progress).toEqual({ done: 2, total: 2, batch: secondBatch });

  await act(async () => {
    releaseFinalResult();
  });
  await waitFor(() =>
    expect(result.current.sessions.map((session) => [session.path, session.metadataStatus])).toEqual([
      ["/session-2.jsonl", "complete"],
      ["/session-1.jsonl", "failed"]
    ])
  );
  expect(result.current.progress).toBeNull();
});

test("queues an import during a slow refresh and keeps it when the refresh finishes", async () => {
  const bridges = createBridges();
  let resolveProjects: (value: DirEntry[]) => void = () => undefined;
  let importListener: ((path: string) => void) | undefined;
  bridges.fs.readDir = vi.fn((path: string): Promise<DirEntry[]> => {
    if (path.endsWith("projects")) {
      return new Promise((resolve) => {
        resolveProjects = resolve;
      });
    }
    return Promise.resolve([{ name: "session.jsonl", is_dir: false, is_file: true }]);
  });
  bridges.events.onSessionImport = vi.fn(async (listener) => {
    importListener = listener;
    return () => undefined;
  });

  const { result } = renderSessionsHook(bridges);
  await waitFor(() => expect(importListener).toBeDefined());

  await act(async () => {
    importListener?.("/tmp/imported.jsonl");
    resolveProjects([{ name: "repo-demo", is_dir: true, is_file: false }]);
  });
  await waitFor(() => expect(result.current.sessions[0]?.path).toBe("/tmp/imported.jsonl"));

  await waitFor(() => {
    expect(result.current.sessions.map((session) => session.path)).toEqual([
      "/tmp/imported.jsonl",
      "/home/tester/.claude/projects/repo-demo/session.jsonl"
    ]);
  });
});

test("keeps the newest refresh authoritative", async () => {
  const staleSessions = [pendingSession("/stale.jsonl", 1)];
  const freshSessions = [pendingSession("/fresh.jsonl", 2)];
  let resolveStaleList: (value: SessionMeta[]) => void = () => undefined;
  const staleList = new Promise<SessionMeta[]>((resolve) => {
    resolveStaleList = resolve;
  });
  vi.spyOn(SessionRepository.prototype, "listSessions")
    .mockImplementationOnce(async () => staleList)
    .mockResolvedValueOnce(freshSessions);
  vi.spyOn(SessionRepository.prototype, "completeMetadata").mockImplementation(
    async (sessions) => sessions
  );

  const bridges = createBridges();
  const { result } = renderSessionsHook(bridges);
  const freshRefresh = result.current.refresh();
  await act(async () => {
    await freshRefresh;
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.sessions.map((session) => session.path)).toEqual(["/fresh.jsonl"]);

  await act(async () => {
    resolveStaleList(staleSessions);
    await freshRefresh;
  });
  await act(async () => {});

  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeNull();
  expect(result.current.sessions.map((session) => session.path)).toEqual(["/fresh.jsonl"]);
});

test("reports metadata completion failure and clears loading", async () => {
  vi.spyOn(SessionRepository.prototype, "listSessions").mockResolvedValue([
    pendingSession("/broken.jsonl", 1)
  ]);
  vi.spyOn(SessionRepository.prototype, "completeMetadata").mockRejectedValue(
    new Error("metadata failed")
  );

  const { result } = renderSessionsHook(createBridges());

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toContain("metadata failed");
});

test("facts 索引是懒加载的：列表先出现，展开筛选才读全量并补齐事实", async () => {
  const sessionPath = "/home/tester/.claude/projects/repo-demo/session.jsonl";
  const jsonl = [
    JSON.stringify({
      type: "user",
      timestamp: "2026-05-01T10:00:00.000Z",
      message: { role: "user", content: "hi" },
      sessionId: "s1",
      cwd: "/repo",
      uuid: "u1"
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-01T10:05:00.000Z",
      message: {
        id: "m1",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 100, output_tokens: 10 }
      },
      uuid: "a1"
    })
  ].join("\n");
  const bridges = createBridges();
  bridges.fs.readDir = vi.fn(async (path: string) =>
    path.endsWith("projects")
      ? [{ name: "repo-demo", is_dir: true, is_file: false }]
      : [{ name: "session.jsonl", is_dir: false, is_file: true }]
  ) as Bridges["fs"]["readDir"];
  bridges.fs.stat = vi.fn(async () => ({ is_file: true, size: 200, mtime_ms: 5 }));
  bridges.fs.readHead = vi.fn(async () => jsonl);
  bridges.fs.readText = vi.fn(async (path: string) =>
    path === sessionPath ? jsonl : "{}"
  ) as Bridges["fs"]["readText"];

  const { result } = renderSessionsHook(bridges);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.sessions[0].facts).toBeUndefined();
  expect(bridges.fs.readText).not.toHaveBeenCalledWith(sessionPath);

  await act(async () => {
    await result.current.indexFacts();
  });

  expect(bridges.fs.readText).toHaveBeenCalledWith(sessionPath);
  expect(result.current.sessions[0].facts).toEqual({
    models: ["claude-sonnet-4-5"],
    tools: [],
    ctxPeak: 100,
    errors: 0,
    durationMs: 5 * 60_000,
    messages: 2
  });

  // 第二次展开不再重复读：已有 facts 的会话跳过。
  const reads = vi.mocked(bridges.fs.readText).mock.calls.length;
  await act(async () => {
    await result.current.indexFacts();
  });
  expect(vi.mocked(bridges.fs.readText).mock.calls.length).toBe(reads);
});
