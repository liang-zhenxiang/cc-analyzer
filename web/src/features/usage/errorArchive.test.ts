import { describe, expect, it } from "vitest";
import { buildErrorArchive, errorSignature, SIGNATURE_MAX_CHARS } from "./errorArchive";
import type { ErrorEvent } from "./errorStats";

function event(extra: Partial<ErrorEvent> & Pick<ErrorEvent, "kind" | "timestamp" | "path">): ErrorEvent {
  return {
    projectLabel: "alpha",
    preview: "错误",
    recordId: null,
    ...extra
  };
}

describe("errorSignature", () => {
  it("数字、路径、引号内容折成占位符", () => {
    expect(errorSignature("Command failed: timeout after 30000ms at /repo/alpha/src/index.ts")).toBe(
      "Command failed: timeout after <n>ms at <path>"
    );
    expect(errorSignature("ENOENT: no such file, open '/repo/alpha/x.ts'")).toBe(
      "ENOENT: no such file, open <…>"
    );
    expect(errorSignature('bash: "npm run build" exited with 2')).toBe(
      "bash: <…> exited with <n>"
    );
  });

  it("只处理整段路径与独立数字，不碰连字符里的数字", () => {
    expect(errorSignature("model gpt-5 is not supported")).toBe("model gpt-5 is not supported");
    expect(errorSignature("see a/b")).toBe("see a/b");
  });

  it("取首行、截 60 个码点、空串给占位词", () => {
    const long = `${"错".repeat(80)}\n第二行`;
    expect(Array.from(errorSignature(long))).toHaveLength(SIGNATURE_MAX_CHARS);
    expect(errorSignature("   ")).toBe("（无摘要）");
    expect(errorSignature("first\nsecond")).toBe("first");
  });
});

describe("buildErrorArchive", () => {
  const events: ErrorEvent[] = [
    event({
      kind: "tool",
      toolName: "Bash",
      timestamp: 1000,
      path: "/repo/alpha/a.jsonl",
      preview: "Command failed: timeout after 30000ms"
    }),
    event({
      kind: "tool",
      toolName: "Bash",
      timestamp: 3000,
      path: "/repo/alpha/b.jsonl",
      preview: "Command failed: timeout after 45000ms"
    }),
    event({
      kind: "tool",
      toolName: "Read",
      timestamp: 2000,
      path: "/repo/alpha/a.jsonl",
      preview: "ENOENT: no such file, open '/repo/alpha/x.ts'"
    }),
    event({
      kind: "api",
      timestamp: 4000,
      path: "/repo/alpha/c.jsonl",
      preview: "API Error: 529 overloaded"
    })
  ];

  it("按（工具, 签名）聚类并给出首末时间与会话集合", () => {
    const groups = buildErrorArchive(events);
    expect(groups).toHaveLength(3);

    const bash = groups[0];
    expect(bash.tool).toBe("Bash");
    expect(bash.signature).toBe("Command failed: timeout after <n>ms");
    expect(bash.count).toBe(2);
    expect(bash.firstAt).toBe(1000);
    expect(bash.lastAt).toBe(3000);
    expect(bash.sessionIds).toEqual(["/repo/alpha/a.jsonl", "/repo/alpha/b.jsonl"]);
    // 样本取最早一条，保留原文（不归一化）——用户要看到当时的原话。
    expect(bash.sample).toBe("Command failed: timeout after 30000ms");

    expect(groups[1].tool).toBe("API");
    expect(groups[2].tool).toBe("Read");
    expect(groups.map((group) => group.count)).toEqual([2, 1, 1]);
  });

  it("并列时按签名升序，输出与输入顺序无关", () => {
    const forward = buildErrorArchive(events).map((group) => group.signature);
    const reversed = buildErrorArchive([...events].reverse()).map((group) => group.signature);
    expect(reversed).toEqual(forward);
    const ties = forward.slice(1);
    const sorted = [...ties].sort((a, b) => a.localeCompare(b));
    expect(ties).toEqual(sorted);
  });

  it("工具错误缺 toolName 时落到「未知工具」，不冒充 API", () => {
    const groups = buildErrorArchive([
      event({ kind: "tool", timestamp: 1, path: "/repo/a.jsonl", preview: "boom" })
    ]);
    expect(groups[0].tool).toBe("未知工具");
  });

  it("样本只保留 200 个码点", () => {
    const groups = buildErrorArchive([
      event({ kind: "tool", toolName: "Bash", timestamp: 1, path: "/repo/a.jsonl", preview: "x".repeat(300) })
    ]);
    expect(Array.from(groups[0].sample)).toHaveLength(200);
  });

  it("空输入与全非法时间戳不产生分组", () => {
    expect(buildErrorArchive([])).toEqual([]);
    expect(
      buildErrorArchive([
        event({ kind: "tool", toolName: "Bash", timestamp: Number.NaN, path: "/repo/a.jsonl" })
      ])
    ).toEqual([]);
  });
});
