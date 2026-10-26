import { useMemo } from "react";
import { Panel } from "../../components/Panel";
import { formatClock, formatShortStamp } from "../../lib/format";
import { API_CLUSTER_LABEL, buildErrorClusters, type ErrorCluster } from "./errorClusters";
import type { ErrorEvent } from "./errorStats";
import { dayStartOf } from "./usageAggregations";
import { ProvenanceBadge } from "./ProvenanceBadge";
import styles from "./ErrorClustersPanel.module.css";

/**
 * 「错误聚类」（Round CC F7）：把窗口内的失败按「工具 + 归一化首行」折成几行。
 *
 * 它替代不了下面的逐条事件列表，两者回答不同的问题：列表回答「刚才炸了什么」，
 * 聚类回答「我到底在跟几个问题打架」。所以这一块放在趋势图之后、分布之前——
 * 先给量级（趋势），再给问题清单（聚类），最后才是按工具/项目的分布。
 */

/**
 * 时间范围：同一天只写时刻（这一列每天都在今天，写日期是噪声），跨天才补日期。
 * 只发生一次（首末相同）时给一个时刻，而不是 `09:12–09:12`。
 */
function timeRangeText(cluster: ErrorCluster): string {
  if (cluster.firstAt === cluster.lastAt) return formatShortStamp(cluster.firstAt);
  if (dayStartOf(cluster.firstAt) === dayStartOf(cluster.lastAt)) {
    return `${formatClock(cluster.firstAt)}–${formatClock(cluster.lastAt)}`;
  }
  return `${formatShortStamp(cluster.firstAt)} – ${formatShortStamp(cluster.lastAt)}`;
}

export function ErrorClustersPanel({
  events,
  onRevealRecord
}: {
  /** 窗口内的错误事件（`stats.events`，时间倒序）。 */
  events: readonly ErrorEvent[];
  /** 点行 → 跳回会话分析定位；`recordId` 可能为 `null`（整簇都是 sidechain）。 */
  onRevealRecord?: (path: string, recordId: string | null) => void;
}) {
  const clusters = useMemo(() => buildErrorClusters(events), [events]);

  return (
    <div className={styles.root} data-probe="clusters-root">
      <Panel
        title="错误聚类"
        ariaLabel="错误聚类"
        actions={<ProvenanceBadge provenance="logged" />}
      >
        {clusters.length === 0 ? (
          <p className={styles.emptyFact}>窗口内没有错误</p>
        ) : (
          <ul className={styles.list}>
            {clusters.map((cluster) => {
              const times = timeRangeText(cluster);
              const reading = `${cluster.toolName} · ${cluster.firstLine} · ${cluster.count} 次 · ${times}`;
              return (
                <li key={cluster.key}>
                  <button
                    type="button"
                    className={styles.row}
                    data-probe="cluster-row"
                    /* 无障碍名带前缀：这一行的名字若以工具名打头，会与「按工具失败」
                       那一栏的行重名，读屏与测试都分不清这是哪一栏的按钮。 */
                    title={onRevealRecord ? `在会话中定位：${reading}` : `错误聚类：${reading}`}
                    aria-label={onRevealRecord ? `在会话中定位：${reading}` : `错误聚类：${reading}`}
                    onClick={
                      onRevealRecord
                        ? () => onRevealRecord(cluster.sampleSessionPath, cluster.sampleRecordId)
                        : undefined
                    }
                    disabled={onRevealRecord === undefined}
                  >
                    <span className={styles.tool} data-probe="cluster-tool">
                      <span
                        className={cluster.toolName === API_CLUSTER_LABEL ? styles.chipApi : styles.chipTool}
                        aria-hidden="true"
                      />
                      {cluster.toolName}
                    </span>
                    <span className={styles.message} title={cluster.firstLine}>
                      {cluster.firstLine}
                    </span>
                    <span className={styles.count} data-probe="cluster-count">
                      {`${cluster.count} 次`}
                    </span>
                    <span className={styles.times} data-probe="cluster-times">
                      {times}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {/* 口径常显：聚类键只有「工具 + 首行」，读者得知道什么会被合成一行。 */}
        <p className={styles.caption}>
          同工具、同一条报错首行的失败合并为一行；按次数降序，并列按首次出现排序。
        </p>
      </Panel>
    </div>
  );
}
