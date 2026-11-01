import { describe, expect, it } from "vitest";
import { countRestarts, type RestartSession } from "./restartCount";

/**
 * H5 重启计数：链长 1/2/3、窗口边界（>= windowMs 起新链）、多 project
 * 互不干扰、null startTimestamp 记 0、空输入。
 */

const MIN = 60_000;

function session(
  path: string,
  startTimestamp: number | null,
  projectLabel: string = "repo-demo"
): RestartSession {
  return { path, startTimestamp, projectLabel };
}

describe("countRestarts", () => {
  it("孤会话链长 1；连续重启链 2/3 递增", () => {
    const map = countRestarts([
      session("/a.jsonl", 0),
      session("/b.jsonl", 5 * MIN),
      session("/c.jsonl", 9 * MIN),
      // 窗口外（距 c 间隔 16min >= 15min）→ 新链。
      session("/d.jsonl", 25 * MIN)
    ]);
    expect(map.get("/a.jsonl")).toBe(1);
    expect(map.get("/b.jsonl")).toBe(2);
    expect(map.get("/c.jsonl")).toBe(3);
    expect(map.get("/d.jsonl")).toBe(1);
  });

  it("窗口边界：间隔正好 = windowMs 起新链（判据 >=），差 1ms 仍在链内", () => {
    const map = countRestarts([
      session("/a.jsonl", 0),
      session("/b.jsonl", 15 * MIN), // 正好 15 分钟 → 新链
      session("/c.jsonl", 30 * MIN - 1) // 距 b 14:59 → 同链
    ]);
    expect(map.get("/a.jsonl")).toBe(1);
    expect(map.get("/b.jsonl")).toBe(1);
    expect(map.get("/c.jsonl")).toBe(2);
  });

  it("多 project 互不干扰：时间交错也各算各的链", () => {
    const map = countRestarts([
      session("/p1-a.jsonl", 0, "proj-1"),
      session("/p2-a.jsonl", 2 * MIN, "proj-2"),
      session("/p1-b.jsonl", 5 * MIN, "proj-1"),
      session("/p2-b.jsonl", 40 * MIN, "proj-2") // proj-2 内距上一个 38min → 新链
    ]);
    expect(map.get("/p1-a.jsonl")).toBe(1);
    expect(map.get("/p2-a.jsonl")).toBe(1);
    expect(map.get("/p1-b.jsonl")).toBe(2); // proj-1 内 5min 在窗内
    expect(map.get("/p2-b.jsonl")).toBe(1); // proj-2 内窗口外
  });

  it("startTimestamp null 记 0，不并入任何链（时间未知不猜）", () => {
    const map = countRestarts([
      session("/known.jsonl", 0),
      session("/unknown.jsonl", null),
      session("/known2.jsonl", 5 * MIN)
    ]);
    expect(map.get("/unknown.jsonl")).toBe(0);
    // 已知两会话的链不受 null 夹在中间影响。
    expect(map.get("/known.jsonl")).toBe(1);
    expect(map.get("/known2.jsonl")).toBe(2);
  });

  it("projectLabel 为空字符串：合法分组键，同桶照常成链", () => {
    const map = countRestarts([
      session("/n1.jsonl", 0, ""),
      session("/n2.jsonl", 1 * MIN, "")
    ]);
    // 空字符串是调用方解析出的「无项目名」桶——同桶时间相近照常并链。
    expect(map.get("/n1.jsonl")).toBe(1);
    expect(map.get("/n2.jsonl")).toBe(2);
  });

  it("projectLabel null/undefined：不猜邻居，每个自成链 1", () => {
    const map = countRestarts([
      session("/x1.jsonl", 0, null as unknown as string),
      session("/x2.jsonl", 1 * MIN, undefined as unknown as string)
    ]);
    expect(map.get("/x1.jsonl")).toBe(1);
    expect(map.get("/x2.jsonl")).toBe(1);
  });

  it("空输入返回空 Map", () => {
    expect(countRestarts([]).size).toBe(0);
  });

  it("乱序传入：按 startTimestamp 升序归链，结果与传入顺序无关", () => {
    const map = countRestarts([
      session("/c.jsonl", 10 * MIN),
      session("/a.jsonl", 0),
      session("/b.jsonl", 5 * MIN)
    ]);
    expect(map.get("/a.jsonl")).toBe(1);
    expect(map.get("/b.jsonl")).toBe(2);
    expect(map.get("/c.jsonl")).toBe(3);
  });
});
