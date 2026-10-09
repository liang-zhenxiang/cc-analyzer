import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import { parseJsonlText } from "../sessions/parseJsonl";
import { dayStartOf, type UsageSessionInput } from "./usageAggregations";
import {
  ANOMALY_MIN_ERRORS,
  ANOMALY_MULTIPLIER,
  ANOMALY_RULE_TEXT,
  extractErrorEvents,
  mergeErrorStats,
  type ErrorDayFacts,
  type ErrorEvent
} from "./errorStats";

/**
 * 聚合纯函数的用例全部从夹具/合成数据计算期望值——实测语料的数字（825/65）
 * 是活数据，写死进测试只会让它过期就假红。
 *
 * 夹具 error-session.jsonl 的形状（两自然日，2026-10-02 / 10-03，UTC 正午——
 * 任意 |时区| ≤ 11 下本地日与 UTC 日一致）：
 * - API 错误 3（402 / 无 status / 500）；工具错误 4（Bash×2 主链 + Bash×1
 *   子链 + Edit×1）；AskUserQuestion 拒绝 1（被排除）；
 * - assistant 消息 12（主链 11 + 子链 1）；记录 21（主链 19 + 子链 2）；
 *   工具调用 7（Bash 4 / Read 1 / Edit 1 / Ask 1）。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const errorFixture = readFileSync(
  path.join(here, "../../../tests/fixtures/error-session.jsonl"),
  "utf8"
);
const FIXTURE_PATH = "/home/tester/.claude/projects/-repo-error-demo/error-session.jsonl";
const FIXTURE_NOW = Date.parse("2026-10-03T12:30:00.000Z");

const meta: SessionMeta = {
  path: FIXTURE_PATH,
  projectLabel: "-repo-error-demo",
  mtimeMs: 1,
  sizeBytes: 1,
  hasRecords: true
};

function parsedFixture() {
  return parseJsonlText(errorFixture, FIXTURE_PATH);
}

function fixtureInput(): UsageSessionInput {
  const parsed = parsedFixture();
  return {
    records: parsed.records,
    projectLabel: meta.projectLabel,
    errorExtract: extractErrorEvents(parsed, meta)
  };
}

/** 手造逐日事实（异常日口径用例不经过解析层，直接给数）。 */
function dayFacts(assistantMessages: number, records: number, toolCalls: Record<string, number> = {}) {
  return {
    assistantMessages,
    records,
    toolCalls: new Map(Object.entries(toolCalls))
  } satisfies ErrorDayFacts;
}

/**
 * 手造事实的日键必须是**本地日起点**（与 extractErrorEvents 的键同构），
 * 否则 merge 的零填充序列对不上键、分母静默丢失——这正是要守住的口径。
 */
const dayKey = (utcNoon: number) => dayStartOf(utcNoon);

function eventAt(timestamp: number, kind: "api" | "tool" = "tool"): ErrorEvent {
  return {
    kind,
    timestamp,
    toolName: kind === "tool" ? "Bash" : undefined,
    apiStatus: kind === "api" ? 500 : undefined,
    recordId: `id-${timestamp}`,
    path: FIXTURE_PATH,
    projectLabel: "-repo-error-demo",
    preview: "Exit code 1"
  };
}

describe("extractErrorEvents", () => {
  it("夹具可被解析且形状符合注释声明（冒烟：单测与 e2e 共用同一批数据）", () => {
    const parsed = parsedFixture();
    expect(parsed.records).toHaveLength(19);
    expect(parsed.sidechainMessages).toHaveLength(2);
    expect(parsed.warnings).toEqual([]);
  });

  it("API 错误按各 status 提取，无 status 的传输层失败也入列", () => {
    const { events } = extractErrorEvents(parsedFixture(), meta);
    const api = events.filter((event) => event.kind === "api");
    // null（传输层）按数值排序会掉队，先落成 0 再比。
    expect(api.map((event) => event.apiStatus ?? 0).sort((a, b) => a - b)).toEqual([0, 402, 500]);
    // 预览取平台固定文案首行，不带正文。
    expect(api.map((event) => event.preview)).toContain("API Error: Payment required");
  });

  it("工具错误可归属到工具名；sidechain 错误并入且 recordId 为 null", () => {
    const { events } = extractErrorEvents(parsedFixture(), meta);
    const tool = events.filter((event) => event.kind === "tool");
    expect(tool).toHaveLength(4);
    const byName = tool.map((event) => event.toolName).sort();
    expect(byName).toEqual(["Bash", "Bash", "Bash", "Edit"]);

    // 子链那条的首行恰是「Exit code 1」；startsWith 会误伤「Exit code 127」。
    const sidechain = tool.find((event) => event.preview === "Exit code 1");
    expect(sidechain).toBeDefined();
    expect(sidechain?.recordId).toBeNull();
    // 主链事件的 recordId 是记录 fullId（下钻定位用），不是短 id。
    const main = tool.find((event) => event.preview === "Exit code 3");
    expect(main?.recordId).toBe("err-bash-2");
  });

  it("AskUserQuestion 的「等用户输入」拒绝不算失败（白名单排除）", () => {
    const { events } = extractErrorEvents(parsedFixture(), meta);
    expect(events.some((event) => event.toolName === "AskUserQuestion")).toBe(false);
    // 依据是文本白名单：同工具的非拒绝错误仍要计入（回归保护——排除不许扩大）。
    expect(events.some((event) => event.toolName === "Edit")).toBe(true);
  });

  it("三条分母同域：assistant 消息与记录都含 sidechain，工具调用含成功", () => {
    const { days } = extractErrorEvents(parsedFixture(), meta);
    const totals = [...days.values()].reduce(
      (sum, facts) => ({
        assistantMessages: sum.assistantMessages + facts.assistantMessages,
        records: sum.records + facts.records
      }),
      { assistantMessages: 0, records: 0 }
    );
    expect(totals).toEqual({ assistantMessages: 12, records: 21 });

    const calls = new Map<string, number>();
    for (const facts of days.values()) {
      for (const [name, count] of facts.toolCalls) calls.set(name, (calls.get(name) ?? 0) + count);
    }
    expect(Object.fromEntries(calls)).toEqual({ Bash: 4, Read: 1, Edit: 1, AskUserQuestion: 1 });
  });

  it("preview 只取首行并截断到 200 字符", () => {
    const longLine = "Exit code 3 " + "x".repeat(600);
    const text = [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-10-02T12:00:10.000Z",
        uuid: "long-a",
        message: { id: "msg-long", role: "assistant", model: "claude-sonnet-4", content: [{ type: "tool_use", id: "long-tool", name: "Bash", input: {} }] }
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-10-02T12:00:12.000Z",
        uuid: "long-r",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "long-tool", content: longLine + "\nsecond line", is_error: true }] }
      })
    ].join("\n");
    const parsed = parseJsonlText(text, FIXTURE_PATH);
    const { events } = extractErrorEvents(parsed, meta);
    expect(events).toHaveLength(1);
    expect(events[0].preview).toHaveLength(200);
    expect(events[0].preview.startsWith("Exit code 3 ")).toBe(true);
    expect(events[0].preview).not.toContain("second line");
  });
});

describe("mergeErrorStats", () => {
  it("全量聚合：总数、排序、事件倒序与三分母口径", () => {
    const stats = mergeErrorStats([fixtureInput()], 7, FIXTURE_NOW);

    expect(stats.total).toEqual({ api: 3, tool: 4 });
    expect(stats.events).toHaveLength(7);
    // 时间倒序：最早的事件（10-02 的 Bash 失败）排最后。
    expect(stats.events.at(-1)?.preview).toBe("Exit code 3");
    for (let index = 1; index < stats.events.length; index += 1) {
      expect(stats.events[index - 1].timestamp).toBeGreaterThanOrEqual(stats.events[index].timestamp);
    }

    // 按工具：失败次数降序；率 = 失败 ÷ 该工具总调用（Bash 3/4）。
    expect(stats.byTool).toEqual([
      { toolName: "Bash", errors: 3, calls: 4, rate: 0.75 },
      { toolName: "Edit", errors: 1, calls: 1, rate: 1 }
    ]);

    // 按项目：密度 = 失败 ÷ 该项目记录总数（7/21），通道拆分可派生合计。
    expect(stats.byProject).toEqual([
      { projectLabel: "-repo-error-demo", toolErrors: 4, apiErrors: 3, records: 21, density: 7 / 21 }
    ]);

    // 日趋势：零填充到窗口长度，分母含 sidechain。
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.reduce((sum, point) => sum + point.assistantMessages, 0)).toBe(12);
    const day1 = stats.daily.find((point) => point.assistantMessages === 5);
    expect(day1).toMatchObject({ api: 1, tool: 1 });
    const day2 = stats.daily.find((point) => point.assistantMessages === 7);
    expect(day2).toMatchObject({ api: 2, tool: 3 });

    // 全部按工具调用的合计（含成功）：7。
    expect(stats.toolCalls).toBe(7);
  });

  it("窗口裁剪：跨边缘的会话只贡献窗口内的日与事件", () => {
    const stats = mergeErrorStats([fixtureInput()], 1, FIXTURE_NOW);
    // 1 天窗口只含最后一天：5 个事件（工具 3 / API 2），分母只剩该日。
    expect(stats.total).toEqual({ api: 2, tool: 3 });
    expect(stats.events.every((event) => event.timestamp >= Date.parse("2026-10-03T00:00:00.000Z") - 1)).toBe(true);
    expect(stats.daily.reduce((sum, point) => sum + point.assistantMessages, 0)).toBe(7);
    expect(stats.byProject[0].records).toBe(12);
    // 窗口外那天的 Bash 成功调用不进失败率分母：Bash 2 错 / 2 调用。
    expect(stats.byTool[0]).toEqual({ toolName: "Bash", errors: 2, calls: 2, rate: 1 });
  });

  it("空输入与无 errorExtract 的输入都得到零计数、逐日零填充的窗口", () => {
    const empty = mergeErrorStats([], 7, FIXTURE_NOW);
    expect(empty.total).toEqual({ api: 0, tool: 0 });
    expect(empty.events).toEqual([]);
    expect(empty.daily).toHaveLength(7);
    expect(empty.daily.every((point) => point.api === 0 && point.tool === 0 && point.assistantMessages === 0)).toBe(true);
    expect(empty.anomalyThreshold).toBeNull();

    // 手造测试数据不带 errorExtract：对错误聚合不可见（分子分母必须同源）。
    const bare = mergeErrorStats([{ records: [], projectLabel: "-repo-x" }], 7, FIXTURE_NOW);
    expect(bare.total).toEqual({ api: 0, tool: 0 });
  });

  it("全零区间：有分母、无错误——byTool/byProject 为空但 toolCalls 仍如实", () => {
    const day = dayKey(Date.UTC(2026, 9, 2, 12));
    const facts = new Map([[day, dayFacts(5, 9, { Bash: 4, Read: 1 })]]);
    const stats = mergeErrorStats(
      [{ records: [], projectLabel: "-repo-clean", errorExtract: { events: [], days: facts } }],
      7,
      FIXTURE_NOW
    );
    expect(stats.total).toEqual({ api: 0, tool: 0 });
    expect(stats.byTool).toEqual([]);
    expect(stats.byProject).toEqual([]);
    expect(stats.toolCalls).toBe(5);
    expect(stats.anomalyThreshold).toBeNull();
  });

  it("同项目的多个会话并入同一个桶", () => {
    const day = dayKey(Date.UTC(2026, 9, 2, 12));
    const first: UsageSessionInput = {
      records: [],
      projectLabel: "-repo-shared",
      errorExtract: { events: [eventAt(day)], days: new Map([[day, dayFacts(3, 5, { Bash: 2 })]]) }
    };
    const second: UsageSessionInput = {
      records: [],
      projectLabel: "-repo-shared",
      errorExtract: { events: [eventAt(day + 1000)], days: new Map([[day, dayFacts(2, 4, { Bash: 1 })]]) }
    };
    const stats = mergeErrorStats([first, second], 7, FIXTURE_NOW);
    expect(stats.byProject).toEqual([
      { projectLabel: "-repo-shared", toolErrors: 2, apiErrors: 0, records: 9, density: 2 / 9 }
    ]);
    expect(stats.byTool).toEqual([{ toolName: "Bash", errors: 2, calls: 3, rate: 2 / 3 }]);
  });

  it("异常日：中位数 × 2 且当日 ≥ 10 条；小样本高 per1k 被下限挡住", () => {
    // 四个非零日 per1k = [10, 11, 130, 100] → 中位数 55.5 → 阈值 111。
    // 130 那天过线且原始数够（异常）；100 那天 per1k 过不了线、原始数也只有 1（双挡）。
    const days = new Map<number, ErrorDayFacts>([
      [dayKey(Date.UTC(2026, 8, 20, 12)), dayFacts(1000, 1010, { Bash: 100 })],
      [dayKey(Date.UTC(2026, 8, 21, 12)), dayFacts(1000, 1011, { Bash: 100 })],
      [dayKey(Date.UTC(2026, 8, 22, 12)), dayFacts(1000, 1130, { Bash: 100 })],
      [dayKey(Date.UTC(2026, 8, 23, 12)), dayFacts(10, 11, { Bash: 1 })]
    ]);
    const events: ErrorEvent[] = [
      ...Array.from({ length: 10 }, (_, i) => eventAt(Date.UTC(2026, 8, 20, 12) + i)),
      ...Array.from({ length: 11 }, (_, i) => eventAt(Date.UTC(2026, 8, 21, 12) + i)),
      ...Array.from({ length: 130 }, (_, i) => eventAt(Date.UTC(2026, 8, 22, 12) + i)),
      eventAt(Date.UTC(2026, 8, 23, 12))
    ];
    const stats = mergeErrorStats(
      [{ records: [], projectLabel: "-repo-anom", errorExtract: { events, days } }],
      7,
      Date.UTC(2026, 8, 23, 15)
    );
    expect(stats.anomalyThreshold).toBeCloseTo(111, 5);
    const anomalous = stats.daily.filter((point) => point.anomalous);
    expect(anomalous).toHaveLength(1);
    expect(anomalous[0].tool).toBe(130);
  });

  it("「忙一天」不是异常：原始数过百但归一后仍在阈值内（09-30 形态）", () => {
    // per1k = [8.4, 9, 8.44] → 中位数 8.44 → 阈值 ≈16.9；100 条 / 11845 消息
    // 的那天归一后 8.44，不过线。
    const days = new Map<number, ErrorDayFacts>([
      [dayKey(Date.UTC(2026, 8, 20, 12)), dayFacts(10000, 10084, { Bash: 84 })],
      [dayKey(Date.UTC(2026, 8, 21, 12)), dayFacts(10000, 10090, { Bash: 90 })],
      [dayKey(Date.UTC(2026, 8, 22, 12)), dayFacts(11845, 11945, { Bash: 100 })]
    ]);
    const events: ErrorEvent[] = [
      ...Array.from({ length: 84 }, (_, i) => eventAt(Date.UTC(2026, 8, 20, 12) + i)),
      ...Array.from({ length: 90 }, (_, i) => eventAt(Date.UTC(2026, 8, 21, 12) + i)),
      ...Array.from({ length: 100 }, (_, i) => eventAt(Date.UTC(2026, 8, 22, 12) + i))
    ];
    const stats = mergeErrorStats(
      [{ records: [], projectLabel: "-repo-busy", errorExtract: { events, days } }],
      7,
      Date.UTC(2026, 8, 22, 15)
    );
    expect(stats.daily.every((point) => !point.anomalous)).toBe(true);
  });

  it("非零日不足 2 天时阈值为 null、异常日恒 false", () => {
    const day = dayKey(Date.UTC(2026, 9, 2, 12));
    const facts = new Map([[day, dayFacts(10, 30, { Bash: 30 })]]);
    const events = Array.from({ length: 30 }, (_, i) => eventAt(day + i));
    const stats = mergeErrorStats(
      [{ records: [], projectLabel: "-repo-lonely", errorExtract: { events, days: facts } }],
      7,
      FIXTURE_NOW
    );
    expect(stats.anomalyThreshold).toBeNull();
    expect(stats.daily.every((point) => !point.anomalous)).toBe(true);
  });

  it("口径常量与文案同源（caption 不许两处手写）", () => {
    expect(ANOMALY_MULTIPLIER).toBe(2);
    expect(ANOMALY_MIN_ERRORS).toBe(10);
    expect(ANOMALY_RULE_TEXT).toContain(`${ANOMALY_MULTIPLIER} 倍`);
    expect(ANOMALY_RULE_TEXT).toContain(`≥ ${ANOMALY_MIN_ERRORS} 条`);
  });
});
