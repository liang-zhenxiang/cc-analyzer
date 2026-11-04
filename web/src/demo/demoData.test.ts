import { describe, expect, test } from "vitest";
import { DEMO_HOME, demoFileEntries, demoFiles } from "./demoData";
import { installDemoBridges } from "./demoBridges";
import { parseJsonlText } from "../features/sessions/parseJsonl";
import { createSessionRepository } from "../features/sessions/sessionRepository";
import { extractErrorEvents } from "../features/usage/errorStats";
import { aggregateRange } from "../features/usage/usageAggregations";
import type { SessionMeta } from "../features/sessions/metadataCache";

/**
 * 演示数据的契约：必须覆盖产品的主要读数，而且不能把时间写死成一段陈年数据。
 * 这里直接走真实解析器——「看起来像 JSONL」不算数，能被应用解析出来才算。
 */

const projectsRoot = `${DEMO_HOME}/.claude/projects`;

function sessionPaths(files: Record<string, string>): string[] {
  return Object.keys(files).filter(
    (path) => path.startsWith(`${projectsRoot}/`) && path.endsWith(".jsonl")
  );
}

function sessionFiles(files: Record<string, string>): string[] {
  // 子 agent 文件在 `<project>/<sessionId>/subagents/` 下，深度比顶层会话多两层，
  // 会话列表不会扫描它们——测试也只数顶层会话。
  return sessionPaths(files).filter((path) => path.split("/").length === 6);
}

describe("demoData", () => {
  test("生成两个项目、六段顶层会话，全部位于伪造的 HOME 下", () => {
    const files = demoFiles();
    const sessions = sessionFiles(files);

    expect(sessions).toHaveLength(6);

    const projects = new Set(sessions.map((path) => path.split("/")[4]));
    expect([...projects].sort()).toEqual(["-demo-alpha", "-demo-beta"]);

    for (const path of Object.keys(files)) {
      expect(path.startsWith(`${DEMO_HOME}/`)).toBe(true);
    }
  });

  test("同一天内多次调用逐字相同——否则内存文件的 mtime/size 会漂", () => {
    expect(JSON.stringify(demoFiles())).toBe(JSON.stringify(demoFiles()));
    expect(demoFileEntries()).toEqual(demoFileEntries());
  });

  test("每段会话都能被真实解析器读出记录与 token 用量", () => {
    const files = demoFiles();

    for (const path of sessionFiles(files)) {
      const parsed = parseJsonlText(files[path], path);
      expect(parsed.records.length).toBeGreaterThan(0);
      expect(parsed.records.some((record) => record.usage !== undefined)).toBe(true);
      expect(parsed.warnings.filter((warning) => warning.includes("未匹配"))).toHaveLength(0);
    }
  });

  test("时间锚定在最近三天，且同一天内有多段会话", () => {
    const files = demoFiles();
    const dayKeys = new Set<string>();
    const sessionsPerDay = new Map<string, number>();

    for (const path of sessionFiles(files)) {
      const parsed = parseJsonlText(files[path], path);
      const first = Math.min(...parsed.records.map((record) => record.timestamp));
      const daysAgo = Math.floor(
        (new Date().setHours(0, 0, 0, 0) - new Date(first).setHours(0, 0, 0, 0)) / 86_400_000
      );
      expect(daysAgo).toBeGreaterThanOrEqual(0);
      expect(daysAgo).toBeLessThanOrEqual(2);

      const key = new Date(first).toDateString();
      dayKeys.add(key);
      sessionsPerDay.set(key, (sessionsPerDay.get(key) ?? 0) + 1);
    }

    expect(dayKeys.size).toBe(3);
    // 每天两段：单一会话的日柱/工作日志看不出「一天内多次开工」这种形态。
    for (const count of sessionsPerDay.values()) expect(count).toBe(2);
  });

  test("覆盖压缩事件、子 agent 与两类错误", () => {
    const files = demoFiles();
    const entries = Object.entries(files).filter(([path]) => path.endsWith(".jsonl"));

    let compactEvents = 0;
    let sidechainMessages = 0;
    let toolErrors = 0;
    let apiErrors = 0;
    let delegatedTools = 0;

    for (const [path, text] of entries) {
      const parsed = parseJsonlText(text, path, {
        isSubagent: path.includes("/subagents/")
      });
      compactEvents += parsed.compactEvents?.length ?? 0;
      sidechainMessages += parsed.sidechainMessages.length;
      delegatedTools += parsed.records.filter(
        (record) => record.toolCategory === "delegated"
      ).length;

      const meta: SessionMeta = {
        path,
        projectLabel: path.split("/")[4],
        mtimeMs: 0,
        sizeBytes: 0,
        hasRecords: true,
        metadataStatus: "complete"
      };
      for (const event of extractErrorEvents(parsed, meta).events) {
        if (event.kind === "tool") toolErrors += 1;
        else apiErrors += 1;
      }
    }

    expect(compactEvents).toBeGreaterThanOrEqual(1);
    expect(sidechainMessages).toBeGreaterThanOrEqual(1);
    expect(delegatedTools).toBeGreaterThanOrEqual(1);
    expect(toolErrors).toBeGreaterThanOrEqual(2);
    expect(apiErrors).toBeGreaterThanOrEqual(1);
  });

  test("用量总览在 30 天窗口里能看到 3 天趋势、2 个项目与 2 个模型", () => {
    const files = demoFiles();
    const inputs = sessionFiles(files).map((path) => ({
      records: parseJsonlText(files[path], path).records,
      projectLabel: path.split("/")[4]
    }));

    const range = aggregateRange(inputs, 30);
    expect(range.kpi.sessions).toBe(6);
    expect(range.kpi.messages).toBeGreaterThan(0);
    expect(range.kpi.tokens).toBeGreaterThan(0);
    expect(range.daily.size).toBe(3);
    expect(range.projects.size).toBe(2);
    expect(new Set([...range.models.keys()]).size).toBeGreaterThanOrEqual(2);
  });

  test("仓库层能完整扫描演示目录并补全元数据", async () => {
    const bridges = installDemoBridges();
    const repository = createSessionRepository(bridges);

    const sessions = await repository.listSessions();
    expect(sessions).toHaveLength(6);
    expect(sessions.every((session) => session.projectLabel.startsWith("-demo-"))).toBe(true);

    const completed = await repository.completeMetadata(sessions);
    expect(completed.every((session) => session.metadataStatus === "complete")).toBe(true);
    expect(completed.every((session) => session.sessionId && session.cwd)).toBe(true);
    expect(completed.every((session) => session.hasRecords)).toBe(true);
    // 标题取首条用户消息：会话列表不能出现一整列项目目录名。
    expect(completed.some((session) => (session.userPrompt ?? "").includes("缓存命中率"))).toBe(
      true
    );

    // 今天的会话要落在脉搏的 5 小时活跃窗口里，否则「实时监控」整天都是空的。
    const today = new Date().toDateString();
    const todaySessions = completed.filter(
      (session) => new Date(session.mtimeMs).toDateString() === today
    );
    expect(todaySessions).toHaveLength(2);
    for (const session of todaySessions) {
      expect(session.mtimeMs).toBeGreaterThanOrEqual(Date.now() - 5 * 60 * 60 * 1000);
    }
  });

  test("子 agent 文件位于会话目录内，能被图谱解析器信任", () => {
    const paths = Object.keys(demoFiles());
    const child = paths.find((path) => path.includes("/subagents/agent-"));
    expect(child).toBeDefined();
    // 越界的子会话路径会被 sessionGraph 明确忽略（isPathInsideAny），
    // 演示必须放在 `projects/<项目>/<sessionId>/subagents/` 里。
    expect(child).toMatch(
      new RegExp(`^${projectsRoot}/-demo-(alpha|beta)/[^/]+/subagents/agent-[^/]+\\.jsonl$`)
    );
  });
});
