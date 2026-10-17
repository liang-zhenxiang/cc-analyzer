import type { MockScenario } from "../../e2e/tauri-mock";

/**
 * 「里程碑」的端到端场景（Issue #214 / Round Y）。
 *
 * 里程碑的口径是**全历史**，本身不随日历漂移；但「那一天」的下钻要落到消耗
 * 日历的滚动 365 天窗口里——**只有窗口内的天才有格子**。于是这份夹具与
 * `pulseScenario` / `calendarScenario` 同一条纪律：时间戳一律**相对今天现算**，
 * 一个写死的日期都不用。写死日期的话，过几天日期入口会点到一个没有格子的天，
 * 下钻静默失败，断言以「展开区没出现」这种毫无线索的方式假红。
 *
 * 只在自造会话上布景（不叠默认场景）：默认场景那批夹具既有固定日期、又会多出
 * 十几个会话，档位读数与会话计数都不确定。
 *
 * 五个会话**各贡献一枚「第一次」**（分散而不是挤在同一个会话里：挤在一起时五条
 * 证据行会写同一个名字，截图读起来像占位符——这正是 Issue #214 修掉的那处缺陷）：
 *  - alpha   —— 最早的那个：第一次会话（另有一次 Bash 调用，让工具种类数是 4 种）；
 *  - beta    —— 第一次压缩，也是单会话最多 token / 最多压缩次数的赢家；
 *  - gamma   —— 第一次用 skill，也是单会话最长时长的赢家（跨度 12 小时）；
 *  - delta   —— 第一次用子 agent；
 *  - epsilon —— 第一次用 MCP 工具（也是最近一次活动）。
 *
 * 账目（e2e 与截图断言逐条对着它）：
 *  token 合计 = 1,200,000 + 2,000,100 + 20,100 + 30,000 + 120,000 = 3,370,200（显示 3.4M）；
 *  消息 = 3 + 4 + 4 + 3 + 3 = 17（`countsAsMessage`）；会话 = 5；项目 = 5；模型 = 1；
 *  压缩 = 1；工具种类 = 4（Bash / skill:git-commit / subagent:trellis-research / mcp:docs）。
 *  档位读数因此是 token 1/4、会话 1/4、项目 2/4、模型 1/3、压缩 1/3、工具 1/3、
 *  消息 0/4——一条「刚起步但确实跨过了第一档」的诚实读数，两态都有样本。
 */

/** 家目录与 appData：与 `web/e2e/fixtures.ts` 的桩常量同值（虚拟 FS 只要求自洽）。 */
const HOME = "/Users/e2e";
const APP_DATA = "/Users/e2e/Library/Application Support/io.github.liang-zhenxiang.cc-analyzer";

const MODEL = "claude-sonnet-4";

/** 模块加载那一刻的本地零点：同一次运行里，夹具与断言共用同一个「今天」。 */
const TODAY = (() => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
})();

/** 夹具用到的天偏移（正数 = 过去）。断言侧也从这里取，避免两处各写一个魔法数。 */
export const MILESTONES_DAY = {
  /** alpha 的起始天：第一次会话（以及唯一一次 Bash 调用）落在这里。 */
  firstSession: 12,
  /** beta 的那一天：既是压缩边界，也是单会话最多 token 的会话——两条记录的赢家。 */
  heavy: 11,
  /** gamma：第一次 skill 调用（也是最长时长的会话）。 */
  firstSkill: 8,
  /** delta：第一次子 agent 调用。 */
  firstSubagent: 5,
  /** epsilon：第一次 MCP 调用（也是最近一次活动）。 */
  firstMcp: 1
} as const;

/** 某个偏移天的本地零点（用 `setDate` 而不是减 86400000：跨夏令时也落在当天零点）。 */
export function milestonesDayStart(offsetDays: number): number {
  const date = new Date(TODAY);
  date.setDate(date.getDate() - offsetDays);
  return date.getTime();
}

/** 某一天的本地时刻。 */
function at(offsetDays: number, hour: number, minute = 0): number {
  const date = new Date(milestonesDayStart(offsetDays));
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

/** 与 `formatFullDate` 同形的 `YYYY-MM-DD`（断言侧的期望值，不 import 应用代码）。 */
export function milestonesFullDate(offsetDays: number): string {
  const date = new Date(milestonesDayStart(offsetDays));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function projectDir(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/** 会话文件在虚拟 FS 里的绝对路径（也是「打开会话」握手交回的 path）。 */
export function milestonesSessionPath(cwd: string, id: string): string {
  return `${HOME}/.claude/projects/${projectDir(cwd)}/${id}.jsonl`;
}

type Session = { id: string; cwd: string };

const ALPHA: Session = { id: "3d2a5442-9c65-4b28-9c30-bb3d1a1d0001", cwd: "/repo/config-loader" };
const BETA: Session = { id: "3d2a5442-9c65-4b28-9c30-bb3d1a1d0002", cwd: "/repo/export-pipeline" };
const GAMMA: Session = { id: "3d2a5442-9c65-4b28-9c30-bb3d1a1d0003", cwd: "/repo/release-tools" };
const DELTA: Session = { id: "3d2a5442-9c65-4b28-9c30-bb3d1a1d0004", cwd: "/repo/ci-gate" };
const EPSILON: Session = { id: "3d2a5442-9c65-4b28-9c30-bb3d1a1d0005", cwd: "/repo/docs-search" };

/**
 * 五个会话的首条用户消息（= 会话标题，`metadataScanner` 的口径）。
 * 刻意写成「某个项目里的一次真实任务名」：早先的「第一次会话的标题」是自指占位，
 * 拍进截图后读起来像没填的模板（Issue #214）。
 */
export const MILESTONES_FIRST_SESSION_TITLE = "把配置读取从手写解析换成 serde";
export const MILESTONES_COMPACTION_TITLE = "重构导出流程，上下文反复吃满";
export const MILESTONES_SKILL_SESSION_TITLE = "整理提交历史，把三处改动拆成三次提交";
export const MILESTONES_SUBAGENT_SESSION_TITLE = "排查门禁在 CI 上偶发假红";
export const MILESTONES_MCP_SESSION_TITLE = "查 MCP 文档确认 query 的入参";

/** 三个工具身份（证据行写的就是它们，断言不另抄一份字面量）。 */
export const MILESTONES_SKILL_NAME = "git-commit";
export const MILESTONES_SUBAGENT_TYPE = "trellis-research";
export const MILESTONES_MCP_TOOL = "mcp__docs__search";
/** 证据行上显示的 `server/tool`（§5.2 的口径；工具身份仍是 `mcp:docs`）。 */
export const MILESTONES_MCP_DETAIL = MILESTONES_MCP_TOOL.split("__").slice(1).join("/");

type Usage = { input?: number; output?: number; cacheCreation?: number; cacheRead?: number };

function usageOf(usage: Usage): Record<string, number> {
  return {
    input_tokens: usage.input ?? 0,
    output_tokens: usage.output ?? 0,
    cache_creation_input_tokens: usage.cacheCreation ?? 0,
    cache_read_input_tokens: usage.cacheRead ?? 0
  };
}

function userLine(
  session: Session,
  timestamp: number,
  uuid: string,
  parentUuid: string | null,
  text: string
): string {
  return JSON.stringify({
    type: "user",
    sessionId: session.id,
    cwd: session.cwd,
    timestamp: new Date(timestamp).toISOString(),
    uuid,
    parentUuid,
    isSidechain: false,
    message: { role: "user", content: text }
  });
}

function assistantLine(
  session: Session,
  timestamp: number,
  uuid: string,
  parentUuid: string | null,
  content: unknown,
  usage?: Usage
): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: session.id,
    cwd: session.cwd,
    timestamp: new Date(timestamp).toISOString(),
    uuid,
    parentUuid,
    isSidechain: false,
    message: {
      id: `msg-${uuid}`,
      role: "assistant",
      model: MODEL,
      content,
      ...(usage ? { usage: usageOf(usage) } : {})
    }
  });
}

/** 压缩边界（`type: "system"` / `subtype: "compact_boundary"`，与既有夹具同形）。 */
function compactBoundaryLine(
  session: Session,
  timestamp: number,
  uuid: string,
  logicalParentUuid: string
): string {
  return JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    sessionId: session.id,
    cwd: session.cwd,
    timestamp: new Date(timestamp).toISOString(),
    uuid,
    parentUuid: null,
    logicalParentUuid,
    isSidechain: false,
    level: "info",
    content: "Conversation compacted",
    compactMetadata: { trigger: "auto", preTokens: 180_000, postTokens: 24_000 }
  });
}

/** 一次工具调用（`message.content` 里的一条 `tool_use`）。 */
function toolUse(id: string, name: string, input: Record<string, unknown>): unknown {
  return [{ type: "tool_use", id, name, input }];
}

function textBlock(text: string): unknown {
  return [{ type: "text", text }];
}

/**
 * 里程碑场景。`overrides` 照既有场景的体例（`pulseScenario` / `calendarScenario`）：
 * 截图那侧用它补 `updater.currentVersion`。
 */
export function milestonesScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const alpha = [
    userLine(ALPHA, at(MILESTONES_DAY.firstSession, 9, 0), "ms-a-user", null, MILESTONES_FIRST_SESSION_TITLE),
    assistantLine(
      ALPHA,
      at(MILESTONES_DAY.firstSession, 9, 5),
      "ms-a-answer",
      "ms-a-user",
      textBlock("先把配置读取摸一遍。"),
      { input: 1_200_000 }
    ),
    assistantLine(
      ALPHA,
      at(MILESTONES_DAY.firstSession, 9, 20),
      "ms-a-bash",
      "ms-a-answer",
      toolUse("ms-bash-1", "Bash", { command: "npm run lint" })
    )
  ].join("\n");

  const beta = [
    userLine(BETA, at(MILESTONES_DAY.heavy, 8, 0), "ms-b-user", null, MILESTONES_COMPACTION_TITLE),
    assistantLine(
      BETA,
      at(MILESTONES_DAY.heavy, 8, 10),
      "ms-b-first",
      "ms-b-user",
      textBlock("先把导出流程的现状读一遍。"),
      { input: 2_000_000 }
    ),
    userLine(BETA, at(MILESTONES_DAY.heavy, 8, 30), "ms-b-user-2", "ms-b-first", "顺手把两个重复分支合掉。"),
    assistantLine(
      BETA,
      at(MILESTONES_DAY.heavy, 8, 40),
      "ms-b-second",
      "ms-b-user-2",
      textBlock("合完了，再跑一次测试。"),
      { input: 100 }
    ),
    compactBoundaryLine(BETA, at(MILESTONES_DAY.heavy, 9, 0), "ms-b-boundary", "ms-b-second")
  ].join("\n");

  // gamma 跨 12 小时（08:00 → 20:00）：单会话最长时长的赢家。
  const gamma = [
    userLine(GAMMA, at(MILESTONES_DAY.firstSkill, 8, 0), "ms-g-user", null, MILESTONES_SKILL_SESSION_TITLE),
    assistantLine(
      GAMMA,
      at(MILESTONES_DAY.firstSkill, 8, 10),
      "ms-g-plan",
      "ms-g-user",
      textBlock("先梳理要拆成哪三次提交。"),
      { input: 20_000 }
    ),
    assistantLine(
      GAMMA,
      at(MILESTONES_DAY.firstSkill, 8, 30),
      "ms-g-skill",
      "ms-g-plan",
      toolUse("ms-skill-1", "Skill", { skill: MILESTONES_SKILL_NAME })
    ),
    assistantLine(
      GAMMA,
      at(MILESTONES_DAY.firstSkill, 20, 0),
      "ms-g-last",
      "ms-g-skill",
      textBlock("三次提交都推上去了。"),
      { input: 100 }
    )
  ].join("\n");

  const delta = [
    userLine(DELTA, at(MILESTONES_DAY.firstSubagent, 14, 0), "ms-d-user", null, MILESTONES_SUBAGENT_SESSION_TITLE),
    assistantLine(
      DELTA,
      at(MILESTONES_DAY.firstSubagent, 14, 10),
      "ms-d-brief",
      "ms-d-user",
      textBlock("先自己扫一遍，再派子 agent 复核。"),
      { input: 30_000 }
    ),
    assistantLine(
      DELTA,
      at(MILESTONES_DAY.firstSubagent, 14, 20),
      "ms-d-agent",
      "ms-d-brief",
      toolUse("ms-agent-1", "Agent", {
        prompt: "复核门禁的等待逻辑",
        subagent_type: MILESTONES_SUBAGENT_TYPE
      })
    )
  ].join("\n");

  const epsilon = [
    userLine(EPSILON, at(MILESTONES_DAY.firstMcp, 21, 0), "ms-e-user", null, MILESTONES_MCP_SESSION_TITLE),
    assistantLine(
      EPSILON,
      at(MILESTONES_DAY.firstMcp, 21, 5),
      "ms-e-answer",
      "ms-e-user",
      textBlock("查一下 query 的入参。"),
      { input: 120_000 }
    ),
    assistantLine(
      EPSILON,
      at(MILESTONES_DAY.firstMcp, 21, 10),
      "ms-e-mcp",
      "ms-e-answer",
      toolUse("ms-mcp-1", MILESTONES_MCP_TOOL, { q: "query 入参" })
    )
  ].join("\n");

  const files: Record<string, string> = {
    [milestonesSessionPath(ALPHA.cwd, ALPHA.id)]: `${alpha}\n`,
    [milestonesSessionPath(BETA.cwd, BETA.id)]: `${beta}\n`,
    [milestonesSessionPath(GAMMA.cwd, GAMMA.id)]: `${gamma}\n`,
    [milestonesSessionPath(DELTA.cwd, DELTA.id)]: `${delta}\n`,
    [milestonesSessionPath(EPSILON.cwd, EPSILON.id)]: `${epsilon}\n`
  };

  return {
    home: HOME,
    appData: APP_DATA,
    files,
    ...overrides
  };
}
