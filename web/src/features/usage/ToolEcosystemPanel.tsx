import { useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { useFontScale } from "../settings/fontScale";
import type { SessionMeta } from "../sessions/metadataCache";
import type { PlanSelection } from "./planLimits";
import {
  buildToolEcosystem,
  ECOSYSTEM_CENTER_X,
  ECOSYSTEM_VIEW_HEIGHT,
  ECOSYSTEM_VIEW_WIDTH,
  nodeLabelMap,
  topCoOccurrences,
  type EcosystemEdge,
  type EcosystemNode
} from "./toolEcosystem";
import type { UsageSessionInput } from "./usageAggregations";
import primitives from "./charts/chartPrimitives.module.css";
import styles from "./ToolEcosystemPanel.module.css";

/**
 * 「工具生态网络」（F6）：节点 = 工具，边 = 同一会话里共现的会话数。
 *
 * 图形用 `role="img"` 承担“这一屏最值得读的 2–3 个事实”，下方「最强共现」
 * 列表才是键盘与读屏的等价物；节点不做 Tab 停靠点（一轮 8 个 SVG 焦点会把
 * 卡片变成 tab 陷阱）。点击节点是鼠标侧的额外便利：筛选下方列表并压暗无关
 * 边，选中态旁边提供一个可键盘触达的「清除筛选」。
 */

const LABEL_LIMIT = 10;

type Props = {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  plan?: PlanSelection;
  onOpenSession?: (session: SessionMeta) => void;
};

function ribbon(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(28, Math.abs(x2 - x1) * 0.35);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function truncateLabel(label: string, limit: number): string {
  const chars = Array.from(label);
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : label;
}

export function ToolEcosystemPanel({ inputs, days, now }: Props) {
  const fontScale = useFontScale();
  // 130% 只减样本数，不缩字号、不缩点径（与规格 §5.3 同一原则）。
  const maxNodes = fontScale > 1.2 ? 6 : 8;
  const labelLimit = fontScale > 1.2 ? 8 : LABEL_LIMIT;
  const ecosystem = useMemo(
    () => buildToolEcosystem(inputs, days, now, { maxNodes }),
    [inputs, days, now, maxNodes]
  );
  const labels = useMemo(() => nodeLabelMap(ecosystem), [ecosystem]);
  const nodeById = useMemo(
    () => new Map(ecosystem.nodes.map((node) => [node.id, node])),
    [ecosystem.nodes]
  );

  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // 窗口切换后旧的选中/悬停 id 可能已不在图上：派生一层「还能用才生效」，
  // 不写 effect 清理。
  const activeId =
    (selected !== null && nodeById.has(selected) ? selected : null) ??
    (hovered !== null && nodeById.has(hovered) ? hovered : null);

  const neighbors = useMemo(() => {
    const ids = new Set<string>();
    if (activeId === null) return ids;
    for (const edge of ecosystem.edges) {
      if (edge.a === activeId) ids.add(edge.b);
      if (edge.b === activeId) ids.add(edge.a);
    }
    return ids;
  }, [activeId, ecosystem.edges]);

  const pairs = useMemo(
    () => topCoOccurrences(ecosystem, activeId, 3),
    [ecosystem, activeId]
  );
  const neighborCount = (nodeId: string) => {
    let count = 0;
    for (const edge of ecosystem.edges) {
      if (edge.a === nodeId || edge.b === nodeId) count += 1;
    }
    return count;
  };

  if (ecosystem.emptyReason !== null) {
    const detail =
      ecosystem.emptyReason === "too-few-tools"
        ? `本窗口只有 ${ecosystem.toolCount} 种工具、${ecosystem.sessionCount} 个会话；共现需要至少两种工具。`
        : `本窗口有 ${ecosystem.toolCount} 种工具、${ecosystem.sessionCount} 个会话；共现需要同一对工具在至少 2 个会话里同时出现。`;
    return (
      <Panel
        title="工具生态网络"
        ariaLabel="工具生态网络"
        titleAs="h3"
        actions={<span className={styles.scope}>{`${ecosystem.toolCount} 种工具`}</span>}
      >
        <div data-probe="lab-network">
          <EmptyState size="inline" title="工具之间还没有重复共现" />
          <p className={styles.emptyNote}>{detail}</p>
        </div>
      </Panel>
    );
  }

  const strongest = ecosystem.edges[0];
  const summaryParts = [`工具生态：本窗口 ${ecosystem.toolCount} 种工具`];
  if (strongest) {
    summaryParts.push(
      `${labels.get(strongest.a) ?? strongest.a} 与 ${labels.get(strongest.b) ?? strongest.b} 在 ${strongest.sessions} 个会话中共现，是最强的一对`
    );
  }
  if (ecosystem.hiddenEdges > 0) {
    summaryParts.push(`另有 ${ecosystem.hiddenEdges} 对未画出`);
  }

  const edgeClass = (edge: EcosystemEdge): string => {
    if (activeId === null) return styles.edge;
    return edge.a === activeId || edge.b === activeId
      ? `${styles.edge} ${styles.edgeActive}`
      : `${styles.edge} ${styles.edgeDim}`;
  };

  const nodeClass = (node: EcosystemNode): string => {
    const classes = [styles.node];
    if (node.hub) classes.push(styles.hub);
    if (activeId !== null) {
      if (node.id === activeId) classes.push(styles.nodeActive);
      else if (neighbors.has(node.id)) classes.push(styles.nodeNeighbor);
      else classes.push(styles.nodeDim);
    }
    if (selected === node.id) classes.push(styles.nodeSelected);
    return classes.join(" ");
  };

  const activeLabel = activeId === null ? null : labels.get(activeId) ?? activeId;

  return (
    <Panel
      title="工具生态网络"
      ariaLabel="工具生态网络"
      titleAs="h3"
      actions={<span className={styles.scope}>{`${ecosystem.toolCount} 种工具`}</span>}
    >
      <div className={styles.root} data-probe="lab-network">
        <svg
          className={primitives.chart}
          viewBox={`0 0 ${ECOSYSTEM_VIEW_WIDTH} ${ECOSYSTEM_VIEW_HEIGHT}`}
          role="img"
          aria-label={`${summaryParts.join("；")}。`}
        >
          {ecosystem.edges.map((edge) => {
            const from = nodeById.get(edge.a);
            const to = nodeById.get(edge.b);
            if (!from || !to) return null;
            const isActive = activeId !== null && (edge.a === activeId || edge.b === activeId);
            return (
              <path
                key={`${edge.a}|${edge.b}`}
                d={ribbon(from.x, from.y, to.x, to.y)}
                fill="none"
                strokeWidth={isActive ? Math.max(edge.width * 1.8, 2) : edge.width}
                className={edgeClass(edge)}
                data-probe="ecosystem-edge"
                data-edge={`${edge.a}|${edge.b}`}
              >
                <title>{`${labels.get(edge.a) ?? edge.a} ↔ ${labels.get(edge.b) ?? edge.b} · ${edge.sessions} 个会话`}</title>
              </path>
            );
          })}

          {ecosystem.nodes.map((node) => {
            const onRight = node.x >= ECOSYSTEM_CENTER_X;
            const labelX = node.x + (onRight ? node.r + 6 : -(node.r + 6));
            return (
              <g
                key={node.id}
                className={nodeClass(node)}
                data-probe="ecosystem-node"
                data-tool={node.id}
                data-active={activeId === node.id ? "true" : undefined}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelected((current) => (current === node.id ? null : node.id))}
              >
                <title>
                  {`${node.label} · ${node.calls} 次 · 与 ${neighborCount(node.id)} 种工具共现`}
                </title>
                <circle cx={node.x} cy={node.y} r={node.r} className={styles.nodeCircle} />
                <text
                  x={labelX}
                  y={node.y + 4}
                  textAnchor={onRight ? "start" : "end"}
                  className={styles.nodeLabel}
                >
                  {truncateLabel(node.label, labelLimit)}
                </text>
              </g>
            );
          })}
        </svg>

        <div className={styles.listHeader}>
          <span className={styles.listTitle}>最强共现</span>
          {activeLabel !== null ? (
            <span className={styles.filterStatus} data-probe="ecosystem-filter">
              {`已筛选：${activeLabel}`}
              {selected !== null ? (
                <button
                  type="button"
                  className={styles.clear}
                  onClick={() => setSelected(null)}
                >
                  清除筛选
                </button>
              ) : null}
            </span>
          ) : (
            <span className={styles.filterHint}>点击节点可筛选</span>
          )}
        </div>
        {pairs.length > 0 ? (
          <ul className={styles.pairs} aria-label="最强共现">
            {pairs.map((edge) => (
              <li key={`${edge.a}|${edge.b}`} className={styles.pair}>
                <span className={styles.pairTools}>
                  {`${labels.get(edge.a) ?? edge.a} ↔ ${labels.get(edge.b) ?? edge.b}`}
                </span>
                <span className={styles.pairCount}>{`${edge.sessions} 个会话`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyNote}>这个工具还没有重复共现的伙伴。</p>
        )}

        <p className={styles.footnote}>
          共现 = 同一会话里都出现过，不代表因果；只画在 ≥2 个会话中重复出现的工具对。
          MCP 工具按 server 收口，子 agent 的调用计入本会话。
          {ecosystem.hiddenEdges > 0 ? `另有 ${ecosystem.hiddenEdges} 对未画出。` : ""}
        </p>
      </div>
    </Panel>
  );
}
