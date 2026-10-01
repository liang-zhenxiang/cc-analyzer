import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { useUsageOverview } from "./useUsageOverview";

/**
 * The hook sits on top of the real `useSessions` flow, so the fakes here serve
 * a whole virtual `~/.claude/projects` tree: readDir one level deep, stat with
 * content-derived sizes, full text via readText (the parse path under test).
 */

const PROJECTS_ROOT = "/home/tester/.claude/projects";

function userLine(id: string, timestamp: string): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    uuid: id,
    message: { role: "user", content: "hi" }
  });
}

function assistantLine(id: string, timestamp: string, model = "claude-sonnet-4-5-20250929"): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    uuid: id,
    message: {
      id: `msg-${id}`,
      role: "assistant",
      model,
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 3000,
        cache_read_input_tokens: 40000
      }
    }
  });
}

function createUsageBridges(
  files: Record<string, string>,
  opts: { failReads?: readonly string[] } = {}
): Bridges {
  const fail = new Set(opts.failReads ?? []);
  const byDir = new Map<string, string[]>();
  for (const path of Object.keys(files)) {
    const segments = path.split("/");
    const dir = segments.slice(0, -1).join("/");
    byDir.set(dir, [...(byDir.get(dir) ?? []), segments[segments.length - 1]]);
  }
  const projectDirs = [...byDir.keys()].filter((dir) => dir.startsWith(`${PROJECTS_ROOT}/`));

  return {
    fs: {
      homeDir: vi.fn(async () => "/home/tester"),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir: vi.fn(async (path: string) =>
        path === PROJECTS_ROOT
          ? projectDirs.map((dir) => ({
              name: dir.slice(PROJECTS_ROOT.length + 1),
              is_dir: true,
              is_file: false
            }))
          : (byDir.get(path) ?? []).map((name) => ({ name, is_dir: false, is_file: true }))
      ),
      readText: vi.fn(async (path: string) => {
        if (fail.has(path)) throw new Error(`读取失败 ${path}`);
        const content = files[path];
        if (content === undefined) throw new Error(`文件不存在 ${path}`);
        return content;
      }),
      readHead: vi.fn(async (path: string) => files[path] ?? ""),
      // Persisting keeps the metadata cache realistic across mounts; only the
      // .jsonl reads are counted in the cache test, so this stays invisible.
      writeText: vi.fn(async (path: string, contents: string) => {
        files[path] = contents;
      }),
      stat: vi.fn(async (path: string) => ({
        is_file: true,
        size: (files[path] ?? "").length,
        mtime_ms: 1_700_000_000_000
      }))
    },
    events: { onSessionImport: vi.fn(async () => () => undefined) }
  } as unknown as Bridges;
}

function renderUsageHook(bridges: Bridges) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BridgesProvider bridges={bridges}>{children}</BridgesProvider>
  );
  return renderHook(() => useUsageOverview(), { wrapper });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUsageOverview", () => {
  it("aggregates every session and finishes with done === total", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]:
        userLine("a1", "2026-05-01T10:00:00.000Z") + "\n" + assistantLine("a2", "2026-05-01T10:00:05.000Z"),
      [`${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`]:
        userLine("b1", "2026-05-02T10:00:00.000Z") + "\n" + assistantLine("b2", "2026-05-02T10:00:05.000Z")
    });

    const { result } = renderUsageHook(bridges);

    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(result.current.inputs).toHaveLength(2);
    expect(result.current.progress).toEqual({ done: 2, total: 2 });
    expect(result.current.skipped).toBe(0);
    expect(result.current.error).toBeNull();
    // Two sessions × one assistant record × (1000 + 200 + 3000 + 40000).
    expect(result.current.aggregate.totals).toEqual({
      input: 2000,
      output: 400,
      cacheCreation: 6000,
      cacheRead: 80000
    });
    expect(result.current.aggregate.sessionCount).toBe(2);
  });

  it("keeps each session's records for the page to re-crop by range", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-cache/ccc.jsonl`]:
        userLine("c1", "2026-05-01T10:00:00.000Z") + "\n" + assistantLine("c2", "2026-05-01T10:00:05.000Z")
    });

    const { result } = renderUsageHook(bridges);

    await waitFor(() => expect(result.current.scanning).toBe(false));
    const [input] = result.current.inputs;
    expect(input.projectLabel).toBe("-repo-cache");
    expect(input.records.map((record) => record.kind)).toEqual(["user", "assistant"]);
  });

  it("skips unreadable sessions instead of blanking the dashboard", async () => {
    const bridges = createUsageBridges(
      {
        [`${PROJECTS_ROOT}/-repo-good/ddd.jsonl`]:
          userLine("d1", "2026-05-01T10:00:00.000Z") + "\n" + assistantLine("d2", "2026-05-01T10:00:05.000Z"),
        [`${PROJECTS_ROOT}/-repo-bad/eee.jsonl`]:
          userLine("e1", "2026-05-01T11:00:00.000Z") + "\n" + assistantLine("e2", "2026-05-01T11:00:05.000Z")
      },
      { failReads: [`${PROJECTS_ROOT}/-repo-bad/eee.jsonl`] }
    );

    const { result } = renderUsageHook(bridges);

    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(result.current.inputs).toHaveLength(1);
    expect(result.current.progress).toEqual({ done: 2, total: 2 });
    expect(result.current.skipped).toBe(1);
    expect(result.current.aggregate.totals.input).toBe(1000);
  });

  it("serves the second mount from the parse cache without re-reading sessions", async () => {
    // Unique paths: the parse cache is a module singleton shared across mounts
    // (and therefore across tests in this file) — reusing another test's paths
    // would make the "first" mount a cache hit too.
    const path = `${PROJECTS_ROOT}/-repo-cached/fff.jsonl`;
    const bridges = createUsageBridges({
      [path]: userLine("f1", "2026-05-01T10:00:00.000Z") + "\n" + assistantLine("f2", "2026-05-01T10:00:05.000Z")
    });
    const sessionReads = () =>
      vi.mocked(bridges.fs.readText).mock.calls.filter(([read]) => read.endsWith(".jsonl")).length;

    const first = renderUsageHook(bridges);
    await waitFor(() => expect(first.result.current.scanning).toBe(false));
    first.unmount();
    expect(sessionReads()).toBe(1);

    const second = renderUsageHook(bridges);
    await waitFor(() => expect(second.result.current.scanning).toBe(false));
    expect(second.result.current.inputs).toHaveLength(1);
    expect(sessionReads()).toBe(1);
  });

  it("drops a superseded scan when the session list changes mid-flight", async () => {
    const goodPath = `${PROJECTS_ROOT}/-repo-race/ggg.jsonl`;
    const extraPath = `${PROJECTS_ROOT}/-repo-race/hhh.jsonl`;
    const files: Record<string, string> = {
      [goodPath]: userLine("g1", "2026-05-01T10:00:00.000Z") + "\n" + assistantLine("g2", "2026-05-01T10:00:05.000Z")
    };
    const bridges = createUsageBridges(files);

    // Gate only the first full read: scan #1 parks there while a newer scan
    // (started after an import event reshaped the list) runs to completion.
    let releaseFirst!: () => void;
    const gated = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstReadParked = false;
    const originalReadText = bridges.fs.readText;
    bridges.fs.readText = vi.fn(async (path: string) => {
      if (path === goodPath && !firstReadParked) {
        firstReadParked = true;
        await gated;
      }
      return originalReadText(path);
    });

    const { result } = renderUsageHook(bridges);
    await waitFor(() => expect(firstReadParked).toBe(true));

    files[extraPath] =
      userLine("h1", "2026-05-01T11:00:00.000Z") + "\n" + assistantLine("h2", "2026-05-01T11:00:05.000Z");
    const importHandler = vi.mocked(bridges.events.onSessionImport).mock.calls[0]?.[0];
    expect(importHandler).toBeTypeOf("function");
    await act(async () => {
      await importHandler?.(extraPath);
    });

    await waitFor(() => expect(result.current.scanning).toBe(false));
    // The fresh scan covered both sessions; the parked one must not land later.
    expect(result.current.progress).toEqual({ done: 2, total: 2 });
    expect(result.current.aggregate.messages).toBe(4);

    await act(async () => {
      releaseFirst();
    });
    expect(result.current.progress).toEqual({ done: 2, total: 2 });
    expect(result.current.aggregate.messages).toBe(4);
    expect(result.current.inputs).toHaveLength(2);
  });
});
