import { sessionTitle } from "../sessions/metadataCache";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import { censusKeyId, type ToolBucketKey, type ToolCallFact } from "./toolCensus";

/**
 * 工具火焰（F3）的数据层：把窗口内的工具调用按会话分组、按工具堆叠。
 *
 * 两条口径写死在这里，视图不再各算一遍：
 *
 * - **只累计配对了工具结果的耗时。** `ToolCallFact.durationMs` 只在
 *   `tool_use` 与 `tool_result` 配对后写入；没有该字段的调用是**耗时未知**，
 *   不是 0——它进右列的 `?N` 计数，不进条长（与 toolHealth 同一条诚实规则）。
 * - **全部调用都未知时降级为按次数。** 真实日志里整段会话没有配对结果很常见；
 *   此时 `mode` 变成 `"calls"`，条长改用调用次数，而不是画一排空条。
 *
 * 含 sidechain（子 agent）调用——那是真实耗时，与成本卡的主链口径不同，
 * 脚注会说明。工具按本卡内的总耗时排名取前 6，其余合并为「其他」。
 */

/** 本卡图例的工具数上限；第 7 名及以后归入「其他」。 */
export const FLAME_TOP_TOOLS = 6;

export type FlameMode = "duration" | "calls";

/** 一个进入图例的工具。`colorIndex` 为 0–5 时对应 `--chart-1..6`。 */
export type FlameTool = {
  id: string;
  label: string;
  colorIndex: number;
  durationMs: number;
  calls: number;
};

/** 一条会话里某工具的一段堆叠。未进入前 6 的工具 `colorIndex === null`。 */
export type FlameSegment = {
  toolId: string;
  label: string;
  durationMs: number;
  calls: number;
  colorIndex: number | null;
};

export type FlameRow = {
  /** 在 `inputs` 中的下标，组件用它找回 `session` meta 做下钻。 */
  sessionIndex: number;
  sessionKey: string;
  label: string;
  projectLabel: string;
  /** 条长依据：`duration` 模式下是已测耗时，`calls` 模式下是调用次数。 */
  value: number;
  totalDurationMs: number;
  calls: number;
  measuredCalls: number;
  /** 未配对结果的调用数——耗时未知，单独报数。 */
  unknownCalls: number;
  segments: FlameSegment[];
};

export type FlameData = {
  mode: FlameMode;
  /** 按条长降序；截断行数由组件按字号决定。 */
  rows: FlameRow[];
  /** 前 6 个工具（按耗时或次数排名），已带颜色序号。 */
  tools: FlameTool[];
  /** 是否存在归入「其他」的工具（图例据此决定是否画中性色块）。 */
  hasOther: boolean;
  totalDurationMs: number;
  totalCalls: number;
  measuredCalls: number;
  unknownCalls: number;
  maxValue: number;
};

type ToolAcc = { label: string; durationMs: number; calls: number };

/** 与 aggregateRange / toolCensus 同一份窗口边界；Lab 不另造实现。 */
function windowStartOf(days: number, now: number): number {
  return addLocalDays(dayStartOf(now), -(Math.max(1, Math.floor(days)) - 1));
}

/**
 * 工具名：沿用工具普查的四种分桶语义（内置 / 技能 / MCP / 子 agent），
 * 但这里按展示名写短句——图例空间只够一行。
 */
function labelOfTool(key: ToolBucketKey): string {
  switch (key.kind) {
    case "builtin":
      return key.toolName;
    case "skill":
      return `Skill: ${key.skillName}`;
    case "subagent":
      return `Agent: ${key.subagentType}`;
    case "mcp":
      return `mcp:${key.server}`;
  }
}

/** 配对了结果的调用才有可用的耗时；`undefined` / 非有限值 / 负数都算未知。 */
function measuredDuration(fact: ToolCallFact): number | null {
  const value = fact.durationMs;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function buildFlameGraph(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): FlameData {
  const startTs = windowStartOf(days, now);

  type SessionAcc = {
    sessionIndex: number;
    sessionKey: string;
    label: string;
    projectLabel: string;
    tools: Map<string, ToolAcc>;
    totalDurationMs: number;
    calls: number;
    measuredCalls: number;
    unknownCalls: number;
  };

  const sessions: SessionAcc[] = [];
  const toolTotals = new Map<string, ToolAcc>();
  let totalDurationMs = 0;
  let totalCalls = 0;
  let measuredCalls = 0;

  inputs.forEach((input, sessionIndex) => {
    const facts = input.toolCalls;
    if (!facts || facts.length === 0) return;

    const inWindow = facts.filter((fact) => fact.timestamp >= startTs);
    if (inWindow.length === 0) return;

    const acc: SessionAcc = {
      sessionIndex,
      sessionKey: input.session?.path ?? `input-${sessionIndex}`,
      label: input.session ? sessionTitle(input.session) : input.projectLabel,
      projectLabel: input.projectLabel,
      tools: new Map(),
      totalDurationMs: 0,
      calls: 0,
      measuredCalls: 0,
      unknownCalls: 0
    };

    for (const fact of inWindow) {
      const id = censusKeyId(fact.key);
      const label = labelOfTool(fact.key);
      const duration = measuredDuration(fact);

      const sessionTool = acc.tools.get(id) ?? { label, durationMs: 0, calls: 0 };
      sessionTool.calls += 1;
      const globalTool = toolTotals.get(id) ?? { label, durationMs: 0, calls: 0 };
      globalTool.calls += 1;

      acc.calls += 1;
      totalCalls += 1;

      if (duration === null) {
        acc.unknownCalls += 1;
      } else {
        sessionTool.durationMs += duration;
        globalTool.durationMs += duration;
        acc.totalDurationMs += duration;
        acc.measuredCalls += 1;
        totalDurationMs += duration;
        measuredCalls += 1;
      }

      acc.tools.set(id, sessionTool);
      toolTotals.set(id, globalTool);
    }

    sessions.push(acc);
  });

  // 全部调用都没有配对耗时：按次数画。`measuredCalls === 0` 时总耗时必然是 0，
  // 这时画耗时条只会得到一排空条——降级比假装「耗时为零」诚实。
  // 完全没有调用时保持 `"duration"`（空态由视图处理，不该显示「按次数」）。
  const mode: FlameMode = totalCalls === 0 || measuredCalls > 0 ? "duration" : "calls";
  const weightOf = (tool: ToolAcc) => (mode === "duration" ? tool.durationMs : tool.calls);

  const ranked = [...toolTotals.entries()]
    .map(([id, tool]) => ({ id, ...tool }))
    .sort(
      (a, b) =>
        weightOf(b) - weightOf(a) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
    );

  const topTools = ranked.slice(0, FLAME_TOP_TOOLS);
  const colorById = new Map<string, number>();
  topTools.forEach((tool, index) => colorById.set(tool.id, index));
  const rankById = new Map<string, number>();
  ranked.forEach((tool, index) => rankById.set(tool.id, index));

  const rows: FlameRow[] = sessions.map((session) => {
    const segments: FlameSegment[] = [...session.tools.entries()]
      .map(([toolId, tool]) => ({
        toolId,
        label: tool.label,
        durationMs: tool.durationMs,
        calls: tool.calls,
        colorIndex: colorById.get(toolId) ?? null
      }))
      // 空段不画（耗时模式下未知工具耗时就是 0）；堆叠顺序跟全局排名走，
      // 同一工具在每一行落在同一位置，跨行才比得出「哪一段最长」。
      .filter((segment) => (mode === "duration" ? segment.durationMs > 0 : segment.calls > 0))
      .sort(
        (a, b) =>
          (rankById.get(a.toolId) ?? Number.MAX_SAFE_INTEGER) -
            (rankById.get(b.toolId) ?? Number.MAX_SAFE_INTEGER) ||
          a.label.localeCompare(b.label)
      );

    return {
      sessionIndex: session.sessionIndex,
      sessionKey: session.sessionKey,
      label: session.label,
      projectLabel: session.projectLabel,
      value: mode === "duration" ? session.totalDurationMs : session.calls,
      totalDurationMs: session.totalDurationMs,
      calls: session.calls,
      measuredCalls: session.measuredCalls,
      unknownCalls: session.unknownCalls,
      segments
    };
  });

  rows.sort(
    (a, b) =>
      b.value - a.value || a.label.localeCompare(b.label) || a.sessionKey.localeCompare(b.sessionKey)
  );

  const maxValue = rows.reduce((max, row) => Math.max(max, row.value), 0);

  return {
    mode,
    rows,
    tools: topTools.map((tool, index) => ({
      id: tool.id,
      label: tool.label,
      colorIndex: index,
      durationMs: tool.durationMs,
      calls: tool.calls
    })),
    hasOther:
      mode === "duration"
        ? ranked.slice(FLAME_TOP_TOOLS).some((tool) => tool.durationMs > 0)
        : ranked.length > FLAME_TOP_TOOLS,
    totalDurationMs,
    totalCalls,
    measuredCalls,
    unknownCalls: totalCalls - measuredCalls,
    maxValue
  };
}
