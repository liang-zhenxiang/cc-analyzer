import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { formatProjectPath } from "../../lib/format";
import { dayStartOf, formatDayLabel } from "./usageAggregations";
import {
  ANOMALY_RULE_TEXT,
  type ErrorEvent,
  type ErrorProjectBucket,
  type ErrorStats
} from "./errorStats";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { ErrorTrendChart } from "./ErrorTrendChart";
import { ErrorRankList, type ErrorRankRow } from "./ErrorRankList";
import { ErrorEventList } from "./ErrorEventList";
import pageStyles from "./UsageOverviewPage.module.css";
import styles from "./ErrorOverviewSection.module.css";

/** 两个分布切面统一的折尾规则：Top-5 + 「其他 N 类」（design §1-8）。 */
const RANK_TOP_N = 5;

/**
 * 切面过滤态（design §8）：三个切面（工具 / 项目 / 日）+ 事件面板 + 清除按钮
 * 共享一份状态；v1 单选，再点取消。折尾行过滤的是整个折尾集合。
 */
export type ErrorFilter =
  | { kind: "tool"; label: string; toolNames: readonly string[] }
  | { kind: "project"; label: string; projectLabels: readonly string[] }
  | { kind: "day"; label: string; dayStart: number };

function sameFilter(a: ErrorFilter, b: ErrorFilter): boolean {
  return a.kind === b.kind && a.label === b.label;
}

function matchesFilter(event: ErrorEvent, filter: ErrorFilter): boolean {
  if (filter.kind === "tool") {
    return (
      event.kind === "tool" &&
      event.toolName !== undefined &&
      filter.toolNames.includes(event.toolName)
    );
  }
  if (filter.kind === "project") {
    return filter.projectLabels.includes(event.projectLabel);
  }
  return dayStartOf(event.timestamp) === filter.dayStart;
}

/** 率 / 密度格式（design §3.3）：≥0.1% 一位小数，正但更小给 `<0.1%`，非法分母 `—`。 */
function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const percent = value * 100;
  return percent >= 0.1 ? `${percent.toFixed(1)}%` : "<0.1%";
}

/** 按工具切面的行：单段条，条长 = 失败次数 / 窗口最大次数。 */
function toolRankRows(byTool: ErrorStats["byTool"]): {
  rows: ErrorRankRow[];
  tailNames: readonly string[];
} {
  const head = byTool.slice(0, RANK_TOP_N);
  const tail = byTool.slice(RANK_TOP_N);
  const max = head[0]?.errors ?? 1;
  const rows: ErrorRankRow[] = head.map((bucket) => ({
    key: bucket.toolName,
    label: bucket.toolName,
    ids: [bucket.toolName],
    hint: `${bucket.toolName}：${bucket.errors} 次失败 / ${bucket.calls.toLocaleString("en-US")} 次调用（失败率 ${formatRate(bucket.rate)}）`,
    value: bucket.errors / max,
    valueLabel: bucket.errors.toLocaleString("en-US"),
    secondaryLabel: formatRate(bucket.rate)
  }));
  if (tail.length > 0) {
    const tailErrors = tail.reduce((sum, bucket) => sum + bucket.errors, 0);
    const label = `其他 ${tail.length} 类`;
    rows.push({
      key: label,
      label,
      ids: tail.map((bucket) => bucket.toolName),
      hint: `其余 ${tail.length} 类工具合计 ${tailErrors} 次失败（混合桶不给失败率）`,
      value: tailErrors / max,
      valueLabel: tailErrors.toLocaleString("en-US"),
      tail: true
    });
  }
  return { rows, tailNames: tail.map((bucket) => bucket.toolName) };
}

/** 折尾桶合并（项目变体的「其他 N 个」：密度 = 合计失败 ÷ 合计记录）。 */
function mergeBuckets(buckets: readonly ErrorProjectBucket[]): ErrorProjectBucket {
  return buckets.reduce((acc, bucket) => {
    const toolErrors = acc.toolErrors + bucket.toolErrors;
    const apiErrors = acc.apiErrors + bucket.apiErrors;
    const records = acc.records + bucket.records;
    return {
      projectLabel: "其他",
      toolErrors,
      apiErrors,
      records,
      density: records > 0 ? (toolErrors + apiErrors) / records : 0
    };
  });
}

/**
 * 按项目切面的行（堆叠变体）：条总长 = 密度 / 窗口最大密度，段长 = 各通道
 * 自己的密度（errors ÷ records）同样归一——段长之和 = 条总长（design §3.4）。
 */
function projectRankRows(
  byProject: readonly ErrorProjectBucket[],
  projectPaths: ReadonlyMap<string, string>
): {
  rows: ErrorRankRow[];
  tailLabels: readonly string[];
} {
  const head = byProject.slice(0, RANK_TOP_N);
  const tail = byProject.slice(RANK_TOP_N);
  const max = head[0]?.density ?? 1;

  const rowOf = (bucket: ErrorProjectBucket, label: string, ids: readonly string[], isTail: boolean): ErrorRankRow => {
    const total = bucket.toolErrors + bucket.apiErrors;
    return {
      key: label,
      label,
      ids,
      hint: isTail
        ? `其余 ${ids.length} 个项目合计 ${total.toLocaleString("en-US")} 次失败（密度 ${formatRate(bucket.density)}）`
        : `${label}：${total.toLocaleString("en-US")} 次失败 / ${bucket.records.toLocaleString("en-US")} 条记录（密度 ${formatRate(bucket.density)}）· 工具 ${bucket.toolErrors} / API ${bucket.apiErrors}`,
      value: bucket.density / max,
      valueLabel: formatRate(bucket.density),
      segments:
        bucket.records > 0
          ? { tool: bucket.toolErrors / bucket.records / max, api: bucket.apiErrors / bucket.records / max }
          : { tool: 0, api: 0 },
      tail: isTail || undefined
    };
  };

  const rows = head.map((bucket) => {
    const label = formatProjectPath(bucket.projectLabel, projectPaths.get(bucket.projectLabel));
    return rowOf(bucket, label, [bucket.projectLabel], false);
  });
  let tailLabels: readonly string[] = [];
  if (tail.length > 0) {
    tailLabels = tail.map((bucket) => bucket.projectLabel);
    rows.push(rowOf(mergeBuckets(tail), `其他 ${tail.length} 个`, tailLabels, true));
  }
  return { rows, tailLabels };
}

/**
 * 用量总览页的「错误」档（N1，design §2.2）：KPI 行 → 趋势面板（整行）→
 * 按工具 / 按项目两列 → 错误事件（整行下钻列表）。区间状态与扫描进度由
 * 页头两档共用，这里只吃窗口化好的 `ErrorStats`。
 *
 * KPI 行复用用量档的 `kpiRow` / `kpi` class——复用而不是复制，两档的读数
 * 语言才不会漂移（design §8）。
 */
export function ErrorOverviewSection({
  stats,
  days,
  sessionsInWindow,
  projectPaths,
  onRevealRecord
}: {
  stats: ErrorStats;
  days: number;
  /** 空态事实行的「检查了 N 个会话」——与用量档 KPI 同源。 */
  sessionsInWindow: number;
  /** projectLabel → 真实 cwd：项目行的标签印末段，编码目录名进 title。 */
  projectPaths: ReadonlyMap<string, string>;
  /** 事件行点击 → 跳回会话分析定位（recordId=null 落到会话本身）。 */
  onRevealRecord?: (path: string, recordId: string | null) => void;
}) {
  const [filter, setFilter] = useState<ErrorFilter | null>(null);
  const [everFiltered, setEverFiltered] = useState(false);

  const toggleFilter = (next: ErrorFilter) => {
    setFilter((current) => (current && sameFilter(current, next) ? null : next));
    setEverFiltered(true);
  };

  const clearFilter = () => setFilter(null);

  const filteredEvents = useMemo(
    () => (filter ? stats.events.filter((event) => matchesFilter(event, filter)) : stats.events),
    [stats.events, filter]
  );

  const anomalyDays = useMemo(() => stats.daily.filter((point) => point.anomalous), [stats.daily]);
  const topTool = stats.byTool[0];
  const assistantTotal = useMemo(
    () => stats.daily.reduce((sum, point) => sum + point.assistantMessages, 0),
    [stats.daily]
  );
  const hasErrors = stats.total.api + stats.total.tool > 0;

  const toolRows = useMemo(() => toolRankRows(stats.byTool), [stats.byTool]);
  const projectRows = useMemo(
    () => projectRankRows(stats.byProject, projectPaths),
    [stats.byProject, projectPaths]
  );

  return (
    <section className={styles.section} aria-label="跨会话错误分析" data-error-view>
      <div className={pageStyles.kpiRow}>
        <div className={pageStyles.kpi}>
          <span className={pageStyles.kpiLabel}>
            <span className={styles.chipApi} aria-hidden="true" />
            API 错误
          </span>
          <span className={pageStyles.kpiValue}>{stats.total.api.toLocaleString("en-US")}</span>
          <ProvenanceBadge provenance="logged" />
        </div>
        <div className={pageStyles.kpi}>
          <span className={pageStyles.kpiLabel}>
            <span className={styles.chipTool} aria-hidden="true" />
            工具错误
          </span>
          <span className={pageStyles.kpiValue}>{stats.total.tool.toLocaleString("en-US")}</span>
          <ProvenanceBadge provenance="logged" />
        </div>
        <div className={pageStyles.kpi}>
          <span className={pageStyles.kpiLabel}>最常见失败工具</span>
          <span className={pageStyles.kpiValue}>
            {topTool ? topTool.toolName : "—"}
            {topTool ? (
              <span className={styles.kpiSub}>{`${topTool.errors.toLocaleString("en-US")} 次`}</span>
            ) : null}
          </span>
          <ProvenanceBadge provenance="logged" />
        </div>
        <div className={pageStyles.kpi}>
          <span className={pageStyles.kpiLabel}>异常日</span>
          <span
            className={`${pageStyles.kpiValue} ${anomalyDays.length > 0 ? styles.kpiDanger : ""}`}
          >
            {`${anomalyDays.length} 天`}
            {anomalyDays.length > 0 && anomalyDays.length <= 2 ? (
              <span className={styles.kpiSub}>
                {anomalyDays.map((point) => formatDayLabel(point.dayStart)).join("、")}
              </span>
            ) : null}
          </span>
          <ProvenanceBadge provenance="logged" />
        </div>
        {/* 口径常显、不藏进浮层（design §3.1）：三句口径是本视图立身之本。 */}
        <p className={pageStyles.kpiFootnote}>
          失败 = 工具结果被标记为错误，或 API 返回错误消息（不含「等用户输入」的拒绝）；
          含子 agent 记录。分母——趋势：每千条模型消息；按工具：该工具总调用次数；
          按项目：该项目记录总数。{ANOMALY_RULE_TEXT}。
        </p>
      </div>

      {!hasErrors ? (
        <div className={styles.fullRow}>
          <Panel title="错误" ariaLabel="错误">
            <p className={styles.emptyFact}>{`近 ${days} 天检查了 ${sessionsInWindow.toLocaleString("en-US")} 个会话的 ${assistantTotal.toLocaleString("en-US")} 条模型消息与 ${stats.toolCalls.toLocaleString("en-US")} 次工具调用，没有发现失败记录——0 是检查后的结果，不是没有数据。`}</p>
          </Panel>
        </div>
      ) : (
        <>
          <ErrorTrendChart
            daily={stats.daily}
            threshold={stats.anomalyThreshold}
            totalTool={stats.total.tool}
            totalApi={stats.total.api}
            days={days}
            selectedDay={filter?.kind === "day" ? filter.dayStart : null}
            onToggleDay={(dayStart) => {
              if (dayStart !== null) {
                toggleFilter({ kind: "day", label: formatDayLabel(dayStart), dayStart });
              }
            }}
            onClearFilter={clearFilter}
          />
          <div className={styles.twoCol}>
            <Panel
              title="按工具失败"
              ariaLabel="按工具失败"
              actions={<ProvenanceBadge provenance="logged" />}
            >
              <ErrorRankList
                rows={toolRows.rows}
                ariaLabel="按工具失败的分布"
                selectedKey={filter?.kind === "tool" ? filter.label : null}
                onSelect={(row) =>
                  toggleFilter({ kind: "tool", label: row.key, toolNames: row.ids })
                }
              />
              <p className={styles.caption}>
                条长 = 失败次数（排序同此）；右列 = 失败率（失败 ÷ 该工具总调用次数）。
              </p>
            </Panel>
            <Panel
              title="按项目失败密度"
              ariaLabel="按项目失败密度"
              actions={<ProvenanceBadge provenance="logged" />}
            >
              <ErrorRankList
                rows={projectRows.rows}
                ariaLabel="按项目失败密度的分布"
                selectedKey={filter?.kind === "project" ? filter.label : null}
                onSelect={(row) =>
                  toggleFilter({ kind: "project", label: row.key, projectLabels: row.ids })
                }
              />
              <p className={styles.caption}>
                条长 = 失败密度（失败记录 ÷ 该项目记录总数）；分段 = 工具 / API 两通道。
              </p>
            </Panel>
          </div>
          <ErrorEventList
            events={filteredEvents}
            filter={filter}
            everFiltered={everFiltered}
            onClearFilter={clearFilter}
            onRevealRecord={onRevealRecord}
          />
        </>
      )}
    </section>
  );
}
