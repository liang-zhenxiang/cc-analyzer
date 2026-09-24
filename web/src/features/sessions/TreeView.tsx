import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button } from "../../components/Button";
import type { ParsedSession, ParsedSessionGraph, SessionRecord } from "./types";
import type { TimeRange } from "./filters";
import { buildDurationTree, type DurationNode, type DurationNodeKind } from "./durationTree";
import { formatDuration } from "../../lib/format";
import { useViewportCap } from "../../lib/useViewportCap";
import styles from "./TreeView.module.css";

const kindClasses: Record<DurationNodeKind, string> = {
  root: "root",
  waitUser: "wait",
  localTool: "group",
  direct: "direct",
  delegated: "group",
  agent: "delegated",
  workflow: "workflow",
  compute: "compute"
};

export function TreeView({
  session,
  graph,
  selection,
  selectedId,
  highlightId,
  onSelect,
  onAnalyze,
  onEnterChildSession,
  onLocateInLog,
  windowOnly = false,
  onWindowOnlyChange
}: {
  session: ParsedSession;
  graph: ParsedSessionGraph | null;
  selection: TimeRange | null;
  selectedId: string | null;
  highlightId?: string | null;
  onSelect: (record: SessionRecord) => void;
  onAnalyze: (node: DurationNode) => void;
  onEnterChildSession: (session: ParsedSession) => void;
  onLocateInLog?: (recordId: string) => void;
  windowOnly?: boolean;
  onWindowOnlyChange?: (value: boolean) => void;
}) {
  const tree = useMemo(
    () => buildDurationTree(session, graph, selection),
    [session, graph, selection]
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  // Same reason as the log table: an uncapped pane would grow the whole page
  // instead of scrolling its own content.
  useViewportCap(containerRef);

  useEffect(() => {
    if (!highlightId) return;
    // Revealing a node must not be blocked by a previously collapsed branch.
    setCollapsed(new Set());
  }, [highlightId]);

  useEffect(() => {
    if (!highlightId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ block: "center" });
  }, [highlightId]);

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className={styles.container} ref={containerRef}>
      <header className={styles.legend}>
        {(["wait", "direct", "delegated", "workflow", "compute"] as const).map((kind) => (
          <span key={kind} className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles[kind]}`} />
            {legendLabels[kind]}
          </span>
        ))}
        <span className={styles.legendHint}>窗口：{formatDuration(tree.wallMs)}</span>
        {onWindowOnlyChange ? (
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={windowOnly}
              onChange={(event) => onWindowOnlyChange(event.target.checked)}
            />
            仅分析所选时间块
          </label>
        ) : null}
      </header>
      <div role="tree" aria-label="耗时树" className={styles.tree}>
        <TreeRow
          node={tree}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          selectedId={selectedId}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          highlightId={highlightId ?? null}
          highlightRef={highlightRef}
          onSelect={onSelect}
          onAnalyze={onAnalyze}
          onEnterChildSession={onEnterChildSession}
          onLocateInLog={onLocateInLog}
        />
      </div>
      <NodeDetail node={findNode(tree, selectedNodeId)} />
    </section>
  );
}

const legendLabels = {
  wait: "等用户",
  direct: "直接工具",
  delegated: "委派 Agent",
  workflow: "workflow",
  compute: "LLM 计算"
};

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  selectedId,
  selectedNodeId,
  onSelectNode,
  highlightId,
  highlightRef,
  onSelect,
  onAnalyze,
  onEnterChildSession,
  onLocateInLog
}: {
  node: DurationNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  highlightId: string | null;
  highlightRef: RefObject<HTMLDivElement>;
  onSelect: (record: SessionRecord) => void;
  onAnalyze: (node: DurationNode) => void;
  onEnterChildSession: (session: ParsedSession) => void;
  onLocateInLog?: (recordId: string) => void;
}) {
  const children = node.children ?? [];
  const expandable = children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const selected = node.record != null && node.record.fullId === selectedId;
  const highlighted = node.record != null && node.record.fullId === highlightId;
  const nodeSelected = node.id === selectedNodeId;
  const analysable =
    node.record != null &&
    node.durationMs > 0 &&
    (node.kind === "agent" || node.kind === "workflow");

  return (
    <>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={expandable ? !isCollapsed : undefined}
        aria-selected={node.record ? selected : undefined}
        ref={highlighted ? highlightRef : undefined}
        className={[
          styles.row,
          styles[kindClasses[node.kind]],
          selected ? styles.selected : "",
          nodeSelected ? styles.nodeSelected : "",
          highlighted ? styles.highlight : ""
        ].filter(Boolean).join(" ")}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onSelectNode(node.id)}
      >
        {expandable ? (
          <button
            type="button"
            className={styles.toggle}
            aria-label={isCollapsed ? `展开 ${node.label}` : `收起 ${node.label}`}
            onClick={() => onToggle(node.id)}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
        ) : (
          <span className={styles.togglePlaceholder} />
        )}
        <span className={`${styles.swatch} ${styles[kindClasses[node.kind]]}`} />
        <button
          type="button"
          className={styles.label}
          title={node.label}
          onClick={() => {
            onSelectNode(node.id);
            if (node.record) onSelect(node.record);
          }}
        >
          {node.label}
        </button>
        <span className={styles.meta}>
          {node.count != null ? `${node.count} 次` : ""}
        </span>
        <span className={styles.duration}>{formatDuration(node.durationMs)}</span>
        <span className={styles.share}>{share(node)}</span>
        <span className={styles.bar}>
          <Segments node={node} />
        </span>
        <span className={styles.actions}>
          {analysable ? (
            <Button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAnalyze(node);
              }}
            >
              {node.kind === "agent" && node.childSession ? "用 claude 分析此子agent" : "分析"}
            </Button>
          ) : null}
          {node.childSession && node.kind === "agent" ? (
            <Button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEnterChildSession(node.childSession!);
              }}
            >
              进入子会话
            </Button>
          ) : null}
          {node.record && onLocateInLog ? (
            <Button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onLocateInLog(node.record!.fullId);
              }}
            >
              定位日志
            </Button>
          ) : null}
        </span>
      </div>
      {expandable && !isCollapsed ? (
        <div role="group">
          {children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              selectedId={selectedId}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              highlightId={highlightId}
              highlightRef={highlightRef}
              onSelect={onSelect}
              onAnalyze={onAnalyze}
              onEnterChildSession={onEnterChildSession}
              onLocateInLog={onLocateInLog}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function Segments({ node }: { node: DurationNode }) {
  const span = node.span;
  const total = span.end - span.start;
  if (total <= 0) return null;
  return (
    <>
      {(node.segments ?? []).map((segment, index) => {
        const left = ((segment.start - span.start) / total) * 100;
        const width = ((segment.end - segment.start) / total) * 100;
        return (
          <span
            key={`${segment.start}-${segment.end}-${index}`}
            className={styles.segment}
            style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%` }}
          />
        );
      })}
    </>
  );
}

function share(node: DurationNode): string {
  if (node.wallMs <= 0) return "0%";
  return `${Math.round((node.durationMs / node.wallMs) * 100)}%`;
}

function findNode(node: DurationNode, id: string | null): DurationNode | null {
  if (!id) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const match = findNode(child, id);
    if (match) return match;
  }
  return null;
}

const KIND_NOTES: Partial<Record<DurationNodeKind, string>> = {
  waitUser: "轮间间隙（等用户输入）+ AskUserQuestion 区间合计。",
  compute: "LLM 思考+输出（总耗时扣除工具/等待后的补集；含不可剥离的间隙）。",
  localTool: "直接工具 / 委派子 agent / workflow 三者区间并集，重叠部分只算一次。",
  delegated: "按记录逐条列出；点「用 claude 分析此子agent」可分析对应子会话。",
  workflow: "按 workflow 运行记录逐条列出，展开可看其子 agent。"
};

function NodeDetail({ node }: { node: DurationNode | null }) {
  if (!node) {
    return (
      <div className={styles.detailEmpty} role="note">
        点节点查看详情
      </div>
    );
  }
  const structured = node.record?.structuredResult;
  const agent = structured?.toolName === "Agent" ? structured : null;

  return (
    <section className={styles.detail} aria-label="节点详情">
      <h4>
        {node.label}
        <span className={styles.detailMeta}>
          · {formatDuration(node.durationMs)}
          {node.count ? ` · ×${node.count}` : ""}
        </span>
      </h4>
      {KIND_NOTES[node.kind] ? <p>{KIND_NOTES[node.kind]}</p> : null}
      {agent ? (
        <p className={styles.detailMeta}>
          {agent.isAsync ? "async" : "sync"}
          {agent.totalTokens == null ? "" : ` · ${agent.totalTokens} tokens`}
          {agent.totalToolUseCount == null ? "" : ` · ${agent.totalToolUseCount} tool calls`}
        </p>
      ) : null}
      {node.childSession ? (
        <p className={styles.detailMeta}>
          子会话 {node.childSession.sessionId} · {node.childSession.records.length} 条记录
        </p>
      ) : null}
    </section>
  );
}
