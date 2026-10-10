import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { BILLING_WINDOW_MS, clusterBillingBlocks, type BillingBlock } from "./billingWindow";
import { attributeQuota } from "./quotaAttribution";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 归因的契约（Issue #151 维护者评论）：窗口对象由 `clusterBillingBlocks` 给出，
 * 本模块只做「这份窗口里谁烧了额度」。用例里的块一律用真实的
 * `clusterBillingBlocks` 切出来（除非刻意要一个和输入不一致的块），
 * 否则「与表盘同一个数」这条恒等式就成了自说自话。
 */

const T0 = new Date(2026, 9, 6, 9, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 3_600_000;
const WINDOW = BILLING_WINDOW_MS;

let seq = 0;

/** 一条助手记录；`tokens` 落在 input 上，其余三类缺省即 0（`SessionUsage` 契约）。 */
function record(at: number, tokens = 0, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    usage: { inputTokens: tokens },
    ...patch
  };
}

function meta(path: string, patch: Partial<SessionMeta> = {}): SessionMeta {
  return { path, projectLabel: "p", hasRecords: true, mtimeMs: 0, sizeBytes: 0, ...patch };
}

function input(
  records: SessionRecord[],
  projectLabel: string,
  session?: SessionMeta,
  projectPath?: string
): UsageSessionInput {
  return { records, projectLabel, projectPath, session };
}

/** 与 BillingWindowCard 同一条路径：交织全部记录 → 排序 → 切窗口。 */
function blocksOf(inputs: readonly UsageSessionInput[]): BillingBlock[] {
  const all: SessionRecord[] = [];
  for (const session of inputs) all.push(...session.records);
  all.sort((a, b) => a.timestamp - b.timestamp);
  return clusterBillingBlocks(all);
}

/** 手写一个窗口块，只用于与记录流无关的用例（标题解析、分母口径）。 */
function windowBlock(tokens: number, messages = 1): BillingBlock {
  return {
    start: T0,
    end: T0 + WINDOW,
    totals: { input: tokens, output: 0, cacheCreation: 0, cacheRead: 0 },
    messages
  };
}

describe("attributeQuota", () => {
  it("同一会话跨窗口被切开，两个窗口各拿一半", () => {
    const session = input(
      [record(T0 + HOUR, 1_000), record(T0 + 7 * HOUR, 2_000)],
      "-repo-demo",
      meta("/sessions/a.jsonl", { customTitle: "跨窗口会话", projectLabel: "-repo-demo" })
    );
    const blocks = blocksOf([session]);
    expect(blocks).toHaveLength(2);

    const first = attributeQuota([session], blocks[0]);
    const second = attributeQuota([session], blocks[1]);

    expect(first.windowTokens).toBe(1_000);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0].tokens).toBe(1_000);
    expect(first.rows[0].messages).toBe(1);
    expect(first.rows[0].share).toBeCloseTo(1);

    expect(second.windowTokens).toBe(2_000);
    expect(second.rows[0].tokens).toBe(2_000);
    // 没有任何一个窗口把整条会话吃掉（两半合计才是会话全量）。
    expect(first.rows[0].tokens + second.rows[0].tokens).toBe(3_000);
    // 变异验证：把整条会话（不按记录时间筛）计入时，两个窗口都会是 3_000，
    // 上面三条断言全部变红。
  });

  it("窗口是半开区间：恰好落在 end 的记录归下一个窗口", () => {
    const session = input(
      [record(T0, 1_000), record(T0 + WINDOW, 7_000)],
      "-repo-demo",
      meta("/sessions/b.jsonl", { customTitle: "压线会话" })
    );
    const blocks = blocksOf([session]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].end).toBe(T0 + WINDOW);
    expect(blocks[1].start).toBe(T0 + WINDOW);

    const first = attributeQuota([session], blocks[0]);
    const second = attributeQuota([session], blocks[1]);

    expect(first.windowTokens).toBe(1_000);
    expect(first.rows[0].tokens).toBe(1_000);
    expect(first.rows[0].messages).toBe(1);
    expect(second.windowTokens).toBe(7_000);
    expect(second.rows[0].tokens).toBe(7_000);
    // 变异验证：把边界判成 `timestamp <= block.end` 时，前后两个窗口、
    // 两次 messages 都会是 2，这里必红。
  });

  it("Top N 截断后余项补齐账目：行 + 余项 = 窗口总量，占比之和 = 100%", () => {
    const sessions = Array.from({ length: 8 }, (_, index) =>
      input(
        [record(T0 + index * MINUTE, (8 - index) * 1_000)],
        `-repo-s${index}`,
        meta(`/sessions/s${index}.jsonl`, { customTitle: `会话 ${index}` })
      )
    );
    const block = blocksOf(sessions)[0];
    expect(block.totals).toEqual({
      input: 36_000,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0
    });

    const result = attributeQuota(sessions, block);

    expect(result.windowTokens).toBe(36_000);
    expect(result.sessionsInWindow).toBe(8);
    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((row) => row.tokens)).toEqual([8_000, 7_000, 6_000, 5_000, 4_000]);
    expect(result.remainder).not.toBeNull();
    expect(result.remainder?.sessions).toBe(3);
    expect(result.remainder?.tokens).toBe(6_000);
    expect(result.remainder?.messages).toBe(3);

    const rowTokens = result.rows.reduce((sum, row) => sum + row.tokens, 0);
    expect(rowTokens + (result.remainder?.tokens ?? 0)).toBe(result.windowTokens);
    const shareSum =
      result.rows.reduce((sum, row) => sum + row.share, 0) + (result.remainder?.share ?? 0);
    expect(shareSum).toBeCloseTo(1, 10);
  });

  it("会话数不超过 Top N 时不出现余项", () => {
    const sessions = [0, 1, 2].map((index) =>
      input([record(T0 + index * MINUTE, 1_000)], `-repo-s${index}`, meta(`/sessions/t${index}.jsonl`))
    );

    const result = attributeQuota(sessions, blocksOf(sessions)[0]);

    expect(result.rows).toHaveLength(3);
    expect(result.remainder).toBeNull();
    expect(result.sessionsInWindow).toBe(3);
  });

  it("窗口内没有归属会话时不凭空造行，但窗口总量照旧", () => {
    const inWindow = input([record(T0 + HOUR, 5_000)], "-repo-in");
    const elsewhere = input([record(T0 + 30 * HOUR, 9_000)], "-repo-out");
    const block = blocksOf([inWindow])[0];

    const missing = attributeQuota([elsewhere], block);
    expect(missing).toEqual({
      windowTokens: 5_000,
      windowStart: block.start,
      windowEnd: block.end,
      rows: [],
      remainder: null,
      sessionsInWindow: 0
    });

    const empty = attributeQuota([], block);
    expect(empty.rows).toEqual([]);
    expect(empty.remainder).toBeNull();
    expect(empty.windowTokens).toBe(5_000);
  });

  it("占比分母是窗口总量（表盘数），不是行合计", () => {
    // 块里还有没有随 inputs 传进来的记录（上层裁掉过会话），分母仍然唯一。
    const block = windowBlock(800, 8);
    const sessions = [
      input([record(T0 + HOUR, 300)], "-repo-a", meta("/sessions/a.jsonl", { customTitle: "a" })),
      input([record(T0 + 2 * HOUR, 100)], "-repo-b", meta("/sessions/b.jsonl", { customTitle: "b" }))
    ];

    const result = attributeQuota(sessions, block);

    expect(result.windowTokens).toBe(800);
    expect(result.rows.map((row) => row.tokens)).toEqual([300, 100]);
    expect(result.rows[0].share).toBeCloseTo(300 / 800);
    expect(result.rows[1].share).toBeCloseTo(100 / 800);
  });

  it("输入顺序与记录顺序都不影响结果", () => {
    const a = input(
      [record(T0 + MINUTE, 1_000), record(T0 + 3 * HOUR, 2_000)],
      "-repo-a",
      meta("/sessions/a.jsonl", { customTitle: "a" })
    );
    const b = input(
      [record(T0 + 2 * MINUTE, 5_000), record(T0 + 4 * HOUR, 500)],
      "-repo-b",
      meta("/sessions/b.jsonl", { customTitle: "b" })
    );
    const block = blocksOf([a, b])[0];

    const baseline = attributeQuota([a, b], block);
    const shuffled = attributeQuota(
      [
        input([...b.records].reverse(), b.projectLabel, b.session),
        input([...a.records].reverse(), a.projectLabel, a.session)
      ],
      block
    );

    expect(shuffled.rows.map((row) => [row.path, row.tokens, row.messages])).toEqual(
      baseline.rows.map((row) => [row.path, row.tokens, row.messages])
    );
    shuffled.rows.forEach((row, index) => {
      expect(row.share).toBeCloseTo(baseline.rows[index].share, 10);
    });
    expect(shuffled.windowTokens).toBe(baseline.windowTokens);
    expect(shuffled.sessionsInWindow).toBe(baseline.sessionsInWindow);
  });

  it("同一会话在窗口内的多条记录只出现一行", () => {
    const session = input(
      [record(T0 + HOUR, 400), record(T0 + 2 * HOUR, 600), record(T0 + 3 * HOUR, 500)],
      "-repo-a",
      meta("/sessions/a.jsonl", { customTitle: "合并成一行" })
    );

    const result = attributeQuota([session], blocksOf([session])[0]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tokens).toBe(1_500);
    expect(result.rows[0].messages).toBe(3);
    expect(result.rows[0].path).toBe("/sessions/a.jsonl");
  });

  it("同一路径的两份输入合并成一行", () => {
    const shared = meta("/sessions/same.jsonl", { customTitle: "同一会话" });
    const first = input([record(T0 + HOUR, 400), record(T0 + 2 * HOUR, 100)], "-repo-a", shared);
    const second = input([record(T0 + 3 * HOUR, 500)], "-repo-a", shared);

    const result = attributeQuota([first, second], blocksOf([first, second])[0]);

    expect(result.rows).toHaveLength(1);
    expect(result.sessionsInWindow).toBe(1);
    expect(result.rows[0].tokens).toBe(1_000);
    expect(result.rows[0].messages).toBe(3);
  });

  it("没有元数据的输入不按项目名合并：同名项目的两个会话仍是两行", () => {
    const first = input([record(T0 + HOUR, 100)], "-repo-same");
    const second = input([record(T0 + 2 * HOUR, 200)], "-repo-same");

    const result = attributeQuota([first, second], blocksOf([first, second])[0]);

    expect(result.rows).toHaveLength(2);
    expect(result.sessionsInWindow).toBe(2);
    expect(result.rows.map((row) => row.tokens)).toEqual([200, 100]);
    expect(result.rows.every((row) => row.path === "")).toBe(true);
  });

  it("并列时按标题、再按路径稳定排序", () => {
    const sessions = [
      input([record(T0 + MINUTE, 500)], "-repo-b", meta("/sessions/beta.jsonl", { customTitle: "beta" })),
      input([record(T0 + 2 * MINUTE, 500)], "-repo-z", meta("/sessions/zeta.jsonl", { customTitle: "alpha" })),
      input([record(T0 + 3 * MINUTE, 500)], "-repo-a", meta("/sessions/alpha.jsonl", { customTitle: "alpha" }))
    ];

    const result = attributeQuota(sessions, blocksOf(sessions)[0]);

    expect(result.rows.map((row) => row.path)).toEqual([
      "/sessions/alpha.jsonl",
      "/sessions/zeta.jsonl",
      "/sessions/beta.jsonl"
    ]);
  });

  it("tokens 走四个计数器的既有口径", () => {
    const usage: SessionUsage = {
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 30,
      cacheReadTokens: 40
    };
    const session = input([record(T0 + HOUR, 0, { usage })], "-repo-a", meta("/sessions/a.jsonl"));

    const result = attributeQuota([session], windowBlock(100));

    expect(result.rows[0].tokens).toBe(100);
    expect(result.rows[0].share).toBeCloseTo(1);
  });

  it("messages 与 clusterBillingBlocks 同口径：逐条记录", () => {
    const session = input(
      [
        record(T0 + HOUR, 100, { kind: "user" }),
        record(T0 + 2 * HOUR, 200, { kind: "assistant" }),
        record(T0 + 3 * HOUR, 0, { kind: "tool" }),
        record(T0 + 4 * HOUR, 300, { kind: "user", compactSummary: true })
      ],
      "-repo-a",
      meta("/sessions/a.jsonl")
    );
    const block = blocksOf([session])[0];

    const result = attributeQuota([session], block);

    expect(block.messages).toBe(4);
    expect(result.rows[0].messages).toBe(4);
    const attributed =
      result.rows.reduce((sum, row) => sum + row.messages, 0) + (result.remainder?.messages ?? 0);
    expect(attributed).toBe(block.messages);
  });

  it("窗口总量为 0 时不产生 NaN", () => {
    const session = input(
      [record(T0 + HOUR, 0, { kind: "user", usage: undefined })],
      "-repo-a",
      meta("/sessions/a.jsonl")
    );

    const result = attributeQuota([session], blocksOf([session])[0]);

    expect(result.windowTokens).toBe(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tokens).toBe(0);
    expect(result.rows[0].share).toBe(0);
    expect(Number.isNaN(result.rows[0].share)).toBe(false);
  });

  it("标题取 SessionMeta 的会话标题字段（customTitle 优先）", () => {
    const session = input(
      [record(T0 + HOUR, 1_000)],
      "-repo-demo",
      meta("/sessions/noise.jsonl", {
        projectLabel: "-repo-demo",
        customTitle: "自定义标题",
        agentName: "agent-1",
        aiTitle: "AI 标题",
        userPrompt: "提问"
      }),
      "/repo/demo"
    );

    const result = attributeQuota([session], windowBlock(1_000));

    expect(result.rows[0]).toMatchObject({
      path: "/sessions/noise.jsonl",
      title: "自定义标题",
      projectLabel: "-repo-demo",
      projectPath: "/repo/demo"
    });
  });

  it("缺 customTitle 时按 agentName → aiTitle → userPrompt 依次回落", () => {
    const withAgent = input(
      [record(T0 + HOUR, 1_000, { id: "x1" })],
      "-repo-a",
      meta("/sessions/agent.jsonl", { agentName: "agent-1", aiTitle: "AI 标题", userPrompt: "提问" })
    );
    const withAi = input(
      [record(T0 + HOUR, 1_000, { id: "x2" })],
      "-repo-b",
      meta("/sessions/ai.jsonl", { aiTitle: "AI 标题", userPrompt: "提问" })
    );
    const withPrompt = input(
      [record(T0 + HOUR, 1_000, { id: "x3" })],
      "-repo-c",
      meta("/sessions/prompt.jsonl", { userPrompt: "提问" })
    );

    const rows = attributeQuota([withAgent], windowBlock(1_000, 1)).rows;
    expect(rows[0].title).toBe("agent-1");
    expect(attributeQuota([withAi], windowBlock(1_000, 1)).rows[0].title).toBe("AI 标题");
    expect(attributeQuota([withPrompt], windowBlock(1_000, 1)).rows[0].title).toBe("提问");
  });

  it("没有 SessionMeta 的输入退回项目标签，path 留空、projectPath 回落 cwd", () => {
    const withoutMeta = input([record(T0 + HOUR, 1_000)], "-repo-demo");
    const withCwd = input(
      [record(T0 + HOUR, 1_000, { id: "c1" })],
      "-repo-cwd",
      meta("/sessions/cwd.jsonl", { cwd: "/repo/cwd", projectLabel: "-repo-cwd" })
    );

    const rows = attributeQuota([withoutMeta], windowBlock(1_000, 1)).rows;
    expect(rows[0]).toMatchObject({ path: "", title: "-repo-demo", projectLabel: "-repo-demo" });
    expect(rows[0].projectPath).toBeUndefined();

    const cwdRows = attributeQuota([withCwd], windowBlock(1_000, 1)).rows;
    expect(cwdRows[0].projectPath).toBe("/repo/cwd");
  });

  it("top 为 0 或非有限值时都不漏账", () => {
    const sessions = Array.from({ length: 6 }, (_, index) =>
      input(
        [record(T0 + index * MINUTE, (6 - index) * 1_000)],
        `-repo-s${index}`,
        meta(`/sessions/z${index}.jsonl`)
      )
    );
    const block = blocksOf(sessions)[0];

    // 默认 Top 5：6 个会话 → 5 行 + 1 个余项会话。
    const fallback = attributeQuota(sessions, block, { top: Number.NaN });
    expect(fallback.rows).toHaveLength(5);
    expect(fallback.remainder?.sessions).toBe(1);

    // top = 0 是合法输入：全部会话进余项，账目依然对齐。
    const zero = attributeQuota(sessions, block, { top: 0 });
    expect(zero.rows).toEqual([]);
    expect(zero.remainder?.sessions).toBe(6);
    expect(zero.remainder?.tokens).toBe(zero.windowTokens);
    expect(zero.remainder?.share).toBeCloseTo(1);
  });
});
