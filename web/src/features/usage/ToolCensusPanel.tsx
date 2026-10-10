import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import type { SessionMeta } from "../sessions/metadataCache";
import { ProvenanceBadge } from "./ProvenanceBadge";
import {
  censusKeyId,
  type CensusBucket,
  type CensusSessionSlice,
  type ToolCensus
} from "./toolCensus";
import styles from "./ToolCensusPanel.module.css";

/** 三区统一折尾规则（design 裁决 7）：与用量档 DEFAULT_TOP_N=6 同数。 */
const TOP_N = 6;

/** 口径脚注常显（design §3.6）；分桶口径由四栏栏头逐栏写明，不在这里复述。 */
const FOOTNOTE = "调用次数含子 agent 记录，主链单独计数见各行悬停；点击任一行可下钻使用最多的会话。";

type ColumnKind = "builtin" | "skill" | "subagent" | "mcp";

type CensusRow = {
  /** 选中态身份（桶 id 或折尾合成 id `tail:<column>`）。 */
  key: string;
  label: string;
  calls: number;
  callsMain: number;
  /** MCP 行的行尾读数（「N 次 · M 个工具」）；其余列不用。 */
  meta?: string;
  /** 会话数读数；null = 折尾行（同会话跨桶重复，加总即撒谎——宁缺毋假）。 */
  sessionsLabel: string | null;
  hint: string;
  /** 0..1 归一条长（分母 = 榜内最大次数，区内归一）；null = 无条区。 */
  bar: number | null;
  tail: boolean;
};

type Column = {
  kind: ColumnKind;
  title: string;
  /** 栏头右端的类数与合计——量级锚（design 裁决 4/9），兼防跨栏误读。 */
  meta: string;
  ariaLabel: string;
  rows: CensusRow[];
  /** 折尾集合（折尾行的下钻数据源）；未折尾为空。 */
  tailBuckets: CensusBucket[];
  emptyText: string;
};

/** 选中态只存身份，数据每次渲染从当前普查解析——区间切换/渐进扫描自动跟上。 */
type Selection = { kind: "bucket" | "tail"; id: string; column: ColumnKind };

const COLUMN_DEFS: { kind: ColumnKind; title: string; ariaLabel: string; emptyText: string }[] = [
  { kind: "builtin", title: "内置工具", ariaLabel: "内置工具调用排行", emptyText: "本区间没有内置工具调用" },
  { kind: "skill", title: "skill", ariaLabel: "skill 调用排行", emptyText: "本区间没有 skill 调用" },
  { kind: "subagent", title: "子 agent", ariaLabel: "子 agent 调用排行", emptyText: "本区间没有子 agent 调用" },
  { kind: "mcp", title: "MCP", ariaLabel: "MCP 服务器", emptyText: "本区间没有 MCP 调用" }
];

const fmt = (value: number) => value.toLocaleString("en-US");

/** 主读数的双口径 title（design §3.2 模板）：主链对照的行级落点（裁决 2）。 */
function calibreHint(label: string, calls: number, callsMain: number, tail: string): string {
  return `${label}：${fmt(calls)} 次（主链 ${fmt(callsMain)} · 子 agent ${fmt(calls - callsMain)}）${tail}`;
}

function rowOf(bucket: CensusBucket): CensusRow {
  return {
    key: censusKeyId(bucket.key),
    label: bucket.label,
    calls: bucket.callsWithSidechain,
    callsMain: bucket.callsMain,
    sessionsLabel: `${bucket.sessions} 会话`,
    hint: calibreHint(bucket.label, bucket.callsWithSidechain, bucket.callsMain, `· ${bucket.sessions} 个会话`),
    bar: null,
    tail: false
  };
}

function mcpRowOf(bucket: CensusBucket): CensusRow {
  const toolsDetail = bucket.tools.map((tool) => `${tool.toolName} ${fmt(tool.calls)} 次`).join(" · ");
  return {
    key: censusKeyId(bucket.key),
    label: bucket.label,
    calls: bucket.callsWithSidechain,
    callsMain: bucket.callsMain,
    meta: `${fmt(bucket.callsWithSidechain)} 次 · ${bucket.tools.length} 个工具`,
    sessionsLabel: `${bucket.sessions} 会话`,
    hint: calibreHint(
      bucket.label,
      bucket.callsWithSidechain,
      bucket.callsMain,
      `· ${bucket.tools.length} 个工具（${toolsDetail}）· ${bucket.sessions} 个会话`
    ),
    bar: null,
    tail: false
  };
}

/**
 * 折尾行：标签「其他 N 类/个」，条与标签走中性台阶，会话列 `—`（design §3.2/§3.3）。
 * 可点下钻——折尾集合的会话榜由 mergeTopSessions 合并（design 异议 ③）。
 */
function tailRow(kind: ColumnKind, tailBuckets: CensusBucket[], maxCalls: number): CensusRow {
  const calls = tailBuckets.reduce((sum, bucket) => sum + bucket.callsWithSidechain, 0);
  const main = tailBuckets.reduce((sum, bucket) => sum + bucket.callsMain, 0);
  const unit = kind === "builtin" || kind === "subagent" ? "类" : "个";
  const label = `其他 ${tailBuckets.length} ${unit}`;
  return {
    key: `tail:${kind}`,
    label,
    calls,
    callsMain: main,
    sessionsLabel: null,
    hint: `其余 ${tailBuckets.length} ${unit}合计 ${fmt(calls)} 次（主链 ${fmt(main)} · 子 agent ${fmt(calls - main)}）`,
    bar: kind === "builtin" ? calls / maxCalls : null,
    tail: true
  };
}

/**
 * 折尾集合的会话榜（视图层纯函数，可单测）：同会话跨桶求和再取 Top-5。
 * 桶的 topSessions 已截 Top-5，合并因此是「可见切片」上的合并——长尾里
 * 每个桶都排不进自己前 5 的会话会缺席（v1 接受的近似，桶数极多时才可见）。
 */
export function mergeTopSessions(
  buckets: readonly CensusBucket[]
): { sessions: number; top: CensusSessionSlice[] } {
  const byKey = new Map<string, CensusSessionSlice>();
  for (const bucket of buckets) {
    for (const slice of bucket.topSessions) {
      const key = slice.session?.path ?? slice.label;
      const merged = byKey.get(key);
      if (merged) {
        merged.calls += slice.calls;
      } else {
        byKey.set(key, { ...slice });
      }
    }
  }
  return {
    sessions: byKey.size,
    top: [...byKey.values()]
      .sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label))
      .slice(0, 5)
  };
}

function buildColumns(census: ToolCensus): Column[] {
  return COLUMN_DEFS.map(({ kind, title, ariaLabel, emptyText }) => {
    const buckets = census.buckets.filter((bucket) => bucket.key.kind === kind);
    const calls = buckets.reduce((sum, bucket) => sum + bucket.callsWithSidechain, 0);
    const head = buckets.slice(0, TOP_N);
    const tail = buckets.slice(TOP_N);
    const max = head[0]?.callsWithSidechain ?? 1;

    const rows = head.map(kind === "mcp" ? mcpRowOf : rowOf);
    if (tail.length > 0) rows.push(tailRow(kind, tail, max));

    const countMeta =
      kind === "mcp" ? `${buckets.length} 个服务器` : `${buckets.length} ${kind === "skill" ? "个" : "类"}`;
    return {
      kind,
      title,
      meta: `${countMeta} · ${fmt(calls)} 次`,
      ariaLabel,
      rows,
      tailBuckets: tail,
      emptyText
    };
  });
}

/**
 * 用量总览「工具与 skill」面板（N3，design-tool-census-view.md）：分层四栏——
 * 主榜（内置工具，唯一条形区）＋ skill / 子 agent 紧凑清单＋ MCP 一行事实。
 * 量级差三个数量级，版式呈现差异而不是抹平（design §0）；桶身份只由栏头
 * 文字承载，数据墨水单色 --chart-1，零新增令牌、不消费 danger。
 */
export function ToolCensusPanel({
  census,
  days,
  sessionsInWindow,
  onOpenSession
}: {
  census: ToolCensus;
  days: number;
  /** 全空态事实行的「检查了 N 个会话」——与用量档 KPI 同源。 */
  sessionsInWindow: number;
  /** 下钻会话行的「打开会话」回调；缺省（单测直挂组件）时行仍列出，只是不可点。 */
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const columns = useMemo(() => buildColumns(census), [census]);

  // 区间切换 / 渐进扫描后选中桶可能消失：解析不出就整段下钻区离场。
  const drilldown = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "bucket") {
      const bucket = census.buckets.find((item) => censusKeyId(item.key) === selection.id);
      if (!bucket) return null;
      return { label: bucket.label, sessions: bucket.sessions, top: bucket.topSessions };
    }
    const column = columns.find((item) => item.kind === selection.column);
    if (!column || column.tailBuckets.length === 0) return null;
    const merged = mergeTopSessions(column.tailBuckets);
    const unit = column.kind === "builtin" || column.kind === "subagent" ? "类" : "个";
    return {
      label: `其他 ${column.tailBuckets.length} ${unit}`,
      sessions: merged.sessions,
      top: merged.top
    };
  }, [selection, columns, census.buckets]);

  const toggle = (row: CensusRow, kind: ColumnKind) => {
    setSelection((current) =>
      current && current.column === kind && current.id === row.key
        ? null
        : { kind: row.tail ? "tail" : "bucket", id: row.key, column: kind }
    );
  };

  const total = census.totalCalls;
  const pct = total.withSidechain > 0 ? ((total.withSidechain - total.main) / total.withSidechain) * 100 : 0;

  return (
    <div data-tool-census>
      <Panel
        title="工具与 skill"
        ariaLabel="工具与 skill"
        actions={<ProvenanceBadge provenance="logged" />}
      >
        {total.withSidechain === 0 ? (
          <p className={styles.zeroState}>
            {`近 ${days} 天检查了 ${fmt(sessionsInWindow)} 个会话，没有工具调用记录`}
          </p>
        ) : (
          <>
            <p className={styles.total} data-tool-census-total>
              {`共 ${fmt(total.withSidechain)} 次调用 · 主链 ${fmt(total.main)} · 子 agent 占 ${pct.toFixed(1)}%`}
            </p>
            <div className={styles.columns}>
              {columns.map((column) => (
                <section key={column.kind} className={styles.column} aria-label={column.title}>
                  <div className={styles.columnHead}>
                    <span className={styles.columnTitle}>{column.title}</span>
                    <span className={styles.columnMeta}>{column.meta}</span>
                  </div>
                  {column.rows.length === 0 ? (
                    <p className={styles.columnEmpty}>{column.emptyText}</p>
                  ) : (
                    <ul
                      className={styles.list}
                      aria-label={column.ariaLabel}
                      /* data-tool-census-list：真机门禁取各栏清单滚动几何的稳定锚点。 */
                      data-tool-census-list
                    >
                      {column.rows.map((row) => {
                        const selected =
                          selection !== null &&
                          selection.column === column.kind &&
                          selection.id === row.key;
                        const rowClass = [
                          styles.row,
                          column.kind === "builtin" ? styles.rank : "",
                          column.kind === "mcp" ? styles.mcp : "",
                          row.tail ? styles.tail : "",
                          selected ? styles.selected : ""
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <li key={row.key}>
                            <button
                              type="button"
                              className={rowClass}
                              title={row.hint}
                              aria-pressed={selected}
                              /* data-tool-census-row：真机门禁按标签点选的稳定锚点。 */
                              data-tool-census-row={row.label}
                              onClick={() => toggle(row, column.kind)}
                            >
                              {column.kind === "mcp" ? (
                                <>
                                  <span className={styles.mcpName} title={row.hint}>
                                    {row.label}
                                  </span>
                                  <span className={styles.mcpMeta}>{row.meta}</span>
                                </>
                              ) : (
                                <>
                                  <span className={column.kind === "builtin" ? styles.rankLabel : styles.compactLabel}>
                                    {row.label}
                                  </span>
                                  {column.kind === "builtin" ? (
                                    <span className={styles.track} aria-hidden="true">
                                      <span
                                        className={styles.bar}
                                        style={{ width: `${Math.max(0, Math.min(1, row.bar ?? 0)) * 100}%` }}
                                      />
                                    </span>
                                  ) : null}
                                  <span className={styles.value}>{fmt(row.calls)}</span>
                                  <span className={styles.secondary}>{row.sessionsLabel ?? "—"}</span>
                                </>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ))}
            </div>
            {drilldown ? (
              <div className={styles.drilldown}>
                <div className={styles.drillHead} data-tool-census-filter={drilldown.label}>
                  <span className={styles.drillTitle}>
                    {`使用「${drilldown.label}」最多的会话 · 共 ${drilldown.sessions} 个`}
                  </span>
                  <button type="button" className={styles.clear} onClick={() => setSelection(null)}>
                    × 清除
                  </button>
                </div>
                <ul
                  className={styles.sessionList}
                  aria-label={`使用${drilldown.label}最多的会话`}
                  data-tool-census-sessions
                >
                  {drilldown.top.map((slice, index) => {
                    const reading = `${fmt(slice.calls)} 次`;
                    return (
                      <li key={`${slice.session?.path ?? slice.label}-${index}`}>
                        {slice.session && onOpenSession ? (
                          <button
                            type="button"
                            className={styles.sessionRow}
                            title={`打开会话分析：${slice.label}`}
                            onClick={() => onOpenSession(slice.session!)}
                          >
                            <span className={styles.diamond} aria-hidden="true">
                              ◆
                            </span>
                            <span className={styles.sessionName}>{slice.label}</span>
                            <span className={styles.sessionValue}>{reading}</span>
                          </button>
                        ) : (
                          <span className={styles.sessionRowStatic}>
                            <span className={styles.diamond} aria-hidden="true">
                              ◆
                            </span>
                            <span className={styles.sessionName}>{slice.label}</span>
                            <span className={styles.sessionValue}>{reading}</span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <p className={styles.caption}>{FOOTNOTE}</p>
          </>
        )}
      </Panel>
    </div>
  );
}
