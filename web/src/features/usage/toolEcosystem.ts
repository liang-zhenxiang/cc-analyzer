import { censusKeyId, type ToolBucketKey } from "./toolCensus";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 工具生态网络（Round FF F6）的纯逻辑。
 *
 * - 节点 = 窗口内调用次数前 8 的工具；
 * - 边 = **同一会话里都出现过**的一对工具，权重 = 这样共现的会话数；
 * - 只画在 ≥2 个会话中重复出现的工具对（一次性的同现是噪声，不是结构）；
 * - 含子 agent 的调用（与工具普查同口径）；MCP 按 server 收口。
 *
 * 布局是**确定性圆环**（从 -90° 起等分），不做力导向——同一份数据每次打开
 * 必须落在同一位置，否则读者会把抖动读成结构变化。只有两种工具时退化成
 * 一条水平边，不硬套圆环。
 */

export const ECOSYSTEM_VIEW_WIDTH = 600;
export const ECOSYSTEM_VIEW_HEIGHT = 320;
export const ECOSYSTEM_CENTER_X = 300;
export const ECOSYSTEM_CENTER_Y = 160;
export const ECOSYSTEM_RADIUS = 110;
export const DEFAULT_MAX_NODES = 8;
export const DEFAULT_MAX_EDGES = 28;
/** 共现至少要发生在这么多个会话里，才画成一条边。 */
export const MIN_CO_OCCURRENCE_SESSIONS = 2;

export type EcosystemNode = {
  /** 与 `censusKeyId` 同一身份（MCP 按 server 合并）。 */
  id: string;
  label: string;
  calls: number;
  /** 出现过该工具的会话数。 */
  sessions: number;
  x: number;
  y: number;
  /** 6–14：调用次数越多越大。 */
  r: number;
  /** 调用最多的枢纽节点（描边加粗）。 */
  hub: boolean;
};

export type EcosystemEdge = {
  a: string;
  b: string;
  /** 共现会话数。 */
  sessions: number;
  /** 0.8–4：共现越多越粗。 */
  width: number;
};

export type EcosystemEmptyReason = "too-few-tools" | "no-co-occurrence";

export type ToolEcosystem = {
  nodes: EcosystemNode[];
  edges: EcosystemEdge[];
  /** 窗口内不同工具数（截断前）。 */
  toolCount: number;
  /** 窗口内有工具调用的会话数。 */
  sessionCount: number;
  /** 符合「≥2 个会话共现」但没画出的工具对数（节点截断 + 边截断）。 */
  hiddenEdges: number;
  emptyReason: EcosystemEmptyReason | null;
};

export type EcosystemLimits = {
  maxNodes?: number;
  maxEdges?: number;
};

/** 工具标签：类型写在名字里（`Skill: lint` / `mcp:fs` / `Agent: …`）。 */
export function toolLabel(key: ToolBucketKey): string {
  switch (key.kind) {
    case "builtin":
      return key.toolName;
    case "skill":
      return `Skill: ${key.skillName}`;
    case "mcp":
      return `mcp:${key.server}`;
    case "subagent":
      return `Agent: ${key.subagentType}`;
  }
}

/** 节点的稳定身份：MCP 按 server 合并（与工具普查同一裁决）。 */
export function toolId(key: ToolBucketKey): string {
  return censusKeyId(key);
}

type ToolAcc = { id: string; label: string; calls: number; sessions: Set<string> };

function pairKey(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function windowStartOf(days: number, now: number): number {
  const windowDays = Math.max(1, Math.floor(days));
  return addLocalDays(dayStartOf(now), -(windowDays - 1));
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 圆环坐标：n === 2 时退化成左右两点；其余从正上方开始等分。所有坐标都
 * 是纯函数输出，测试直接锁住，组件不再参与布局。
 */
function placeNodes(
  nodes: ReadonlyArray<Omit<EcosystemNode, "x" | "y" | "r" | "hub">>
): EcosystemNode[] {
  const maxCalls = Math.max(1, ...nodes.map((node) => node.calls));
  return nodes.map((node, index) => {
    let x: number;
    let y: number;
    if (nodes.length === 2) {
      x = index === 0 ? ECOSYSTEM_CENTER_X - ECOSYSTEM_RADIUS : ECOSYSTEM_CENTER_X + ECOSYSTEM_RADIUS;
      y = ECOSYSTEM_CENTER_Y;
    } else {
      const angle = ((-90 + (360 / nodes.length) * index) * Math.PI) / 180;
      x = ECOSYSTEM_CENTER_X + ECOSYSTEM_RADIUS * Math.cos(angle);
      y = ECOSYSTEM_CENTER_Y + ECOSYSTEM_RADIUS * Math.sin(angle);
    }
    return {
      ...node,
      x: rounded(x),
      y: rounded(y),
      r: rounded(6 + 8 * Math.sqrt(node.calls / maxCalls)),
      hub: node.calls === maxCalls
    };
  });
}

export function buildToolEcosystem(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number,
  limits: EcosystemLimits = {}
): ToolEcosystem {
  const maxNodes = Math.max(2, limits.maxNodes ?? DEFAULT_MAX_NODES);
  const maxEdges = Math.max(1, limits.maxEdges ?? DEFAULT_MAX_EDGES);
  const startTs = windowStartOf(days, now);

  const tools = new Map<string, ToolAcc>();
  const sessionTools = new Map<string, Set<string>>();

  inputs.forEach((input, index) => {
    const facts = input.toolCalls;
    if (!facts || facts.length === 0) return;
    // 与 toolCensus 同一会话键规则：meta 的 path 优先，手造输入退回下标。
    const sessionKey = input.session?.path ?? `input-${index}`;

    for (const fact of facts) {
      if (fact.timestamp < startTs) continue;
      const id = toolId(fact.key);
      let tool = tools.get(id);
      if (!tool) {
        tool = { id, label: toolLabel(fact.key), calls: 0, sessions: new Set() };
        tools.set(id, tool);
      }
      tool.calls += 1;
      tool.sessions.add(sessionKey);
      let set = sessionTools.get(sessionKey);
      if (!set) {
        set = new Set();
        sessionTools.set(sessionKey, set);
      }
      set.add(id);
    }
  });

  // 只保留真正有调用的会话（时间窗外的会话不会进 sessionTools）。
  const toolCount = tools.size;
  const sessionCount = sessionTools.size;

  const pairSessions = new Map<string, number>();
  for (const set of sessionTools.values()) {
    const ids = [...set].sort();
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        const key = pairKey(ids[left], ids[right]);
        pairSessions.set(key, (pairSessions.get(key) ?? 0) + 1);
      }
    }
  }

  const qualifying = [...pairSessions.entries()]
    .filter(([, sessions]) => sessions >= MIN_CO_OCCURRENCE_SESSIONS)
    .map(([key, sessions]) => {
      const [a, b] = key.split("\u0000");
      return { a, b, sessions };
    })
    .sort(
      (left, right) =>
        right.sessions - left.sessions ||
        left.a.localeCompare(right.a) ||
        left.b.localeCompare(right.b)
    );

  if (toolCount < 2) {
    return {
      nodes: [],
      edges: [],
      toolCount,
      sessionCount,
      hiddenEdges: 0,
      emptyReason: "too-few-tools"
    };
  }

  const selectedTools = [...tools.values()]
    .sort((left, right) => right.calls - left.calls || left.label.localeCompare(right.label))
    .slice(0, maxNodes);
  const selectedIds = new Set(selectedTools.map((tool) => tool.id));

  const drawable = qualifying.filter(
    (edge) => selectedIds.has(edge.a) && selectedIds.has(edge.b)
  );
  if (drawable.length === 0) {
    return {
      nodes: [],
      edges: [],
      toolCount,
      sessionCount,
      hiddenEdges: qualifying.length,
      emptyReason: "no-co-occurrence"
    };
  }

  const drawn = drawable.slice(0, maxEdges);
  const maxPairSessions = Math.max(1, ...drawn.map((edge) => edge.sessions));
  const edges: EcosystemEdge[] = drawn.map((edge) => ({
    a: edge.a,
    b: edge.b,
    sessions: edge.sessions,
    width: rounded(0.8 + 3.2 * (edge.sessions / maxPairSessions))
  }));

  const nodes = placeNodes(
    selectedTools.map((tool) => ({
      id: tool.id,
      label: tool.label,
      calls: tool.calls,
      sessions: tool.sessions.size
    }))
  );

  return {
    nodes,
    edges,
    toolCount,
    sessionCount,
    hiddenEdges: qualifying.length - drawn.length,
    emptyReason: null
  };
}

/**
 * 最强共现对（图上悬停/点击的文本等价物）。选中某个工具时只留与它有关
 * 的对——「点击筛选」在列表层也必须成立。
 */
export function topCoOccurrences(
  ecosystem: ToolEcosystem,
  selected: string | null,
  limit = 3
): EcosystemEdge[] {
  const pool = selected
    ? ecosystem.edges.filter((edge) => edge.a === selected || edge.b === selected)
    : ecosystem.edges;
  return [...pool]
    .sort(
      (left, right) =>
        right.sessions - left.sessions ||
        left.a.localeCompare(right.a) ||
        left.b.localeCompare(right.b)
    )
    .slice(0, limit);
}

/** 节点 id → 标签的查找表（边只存 id）。 */
export function nodeLabelMap(ecosystem: ToolEcosystem): Map<string, string> {
  return new Map(ecosystem.nodes.map((node) => [node.id, node.label]));
}
