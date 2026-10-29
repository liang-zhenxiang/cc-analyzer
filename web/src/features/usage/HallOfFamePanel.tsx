import { useMemo } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatShortStamp, formatUsd } from "../../lib/format";
import { useFontScale } from "../settings/fontScale";
import type { SessionMeta } from "../sessions/metadataCache";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { buildHallOfFame, type HallEntry } from "./hallOfFame";
import type { UsageSessionInput } from "./usageAggregations";
import styles from "./HallOfFamePanel.module.css";

/**
 * 「最贵时刻名人堂」（F5）：领奖台（前三）+ 榜单（前十的其余名次）。
 *
 * 纯 DOM，不用 SVG：标题、名次与金额都是要按真实字号读的字，不该被 viewBox
 * 缩小。柱高 88/64/52 是「形」，不随字号缩放；颜色只用 --chart-1 与
 * -soft 表达「这是同一套估算」，不用金银铜——色板里没有秩次语义。
 */

const PODIUM_HEIGHTS = [88, 64, 52];
const PODIUM_AREAS = ["first", "second", "third"] as const;

function ariaLabelOf(entry: HallEntry): string {
  return `第 ${entry.rank} 名：${entry.title}，${formatShortStamp(entry.timestamp)}，${entry.modelLabel}，估算 ${formatUsd(entry.usd)}`;
}

export function HallOfFamePanel({
  inputs,
  days,
  now,
  onOpenSession
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const fontScale = useFontScale();
  // 130% 字号下前十缩到前七：榜单行折行会破坏「10 行」的读法。
  const limit = fontScale >= 1.3 ? 7 : 10;
  const hall = useMemo(
    () => buildHallOfFame(inputs, days, now, { limit }),
    [inputs, days, now, limit]
  );

  const actions = (
    <span className={styles.actions}>
      <span className={styles.scope}>{`${hall.pricedCalls} 次调用`}</span>
      <ProvenanceBadge provenance="estimated" />
    </span>
  );

  if (hall.entries.length === 0) {
    return (
      <div data-probe="lab-hall">
        <Panel title="最贵时刻" ariaLabel="最贵时刻" titleAs="h3" actions={actions}>
          <EmptyState size="inline" title="所选范围内没有可定价的调用" />
          {hall.unpricedCalls > 0 ? (
            <p className={styles.note}>
              另有 {hall.unpricedCalls} 次调用因模型未定价，未参与排名。
            </p>
          ) : null}
        </Panel>
      </div>
    );
  }

  const unpricedNote =
    hall.unpricedCalls > 0
      ? `无定价模型的 ${hall.unpricedCalls} 次调用未参与排名。`
      : "本窗口没有未定价模型的调用。";
  const hiddenNote =
    hall.hiddenCalls > 0 ? `另有 ${hall.hiddenCalls} 次已定价调用未列入前 ${limit}。` : "";
  const footnote = `单次调用成本 = 该条记录的 usage × 定价快照；与页面成本读数同一口径（主链记录，不含子 agent 账单）。${unpricedNote}${hiddenNote}`;

  return (
    <div data-probe="lab-hall">
      <Panel title="最贵时刻" ariaLabel="最贵时刻" titleAs="h3" actions={actions}>
        {hall.hasPodium ? (
          <div className={styles.podium}>
            {hall.podium.map((entry, index) => {
              const meta = entry.session;
              const canOpen = Boolean(meta && onOpenSession);
              return (
                <button
                  type="button"
                  key={entry.id}
                  className={`${styles.podiumColumn} ${styles[PODIUM_AREAS[index]]}`}
                  data-hall-entry={`podium-${entry.rank}`}
                  aria-label={ariaLabelOf(entry)}
                  disabled={!canOpen}
                  onClick={meta && onOpenSession ? () => onOpenSession(meta) : undefined}
                >
                  <span className={styles.podiumCost}>{formatUsd(entry.usd)}</span>
                  <span className={styles.podiumRank}>第 {entry.rank} 名</span>
                  <span className={styles.podiumTitle} title={entry.title}>
                    {entry.title}
                  </span>
                  <span className={styles.podiumMeta}>
                    {entry.modelLabel} · {formatShortStamp(entry.timestamp)}
                  </span>
                  <span
                    className={styles.pedestal}
                    style={{ height: PODIUM_HEIGHTS[index] }}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <p className={styles.note}>不足 3 次调用，不设领奖台</p>
        )}

        <ol className={styles.list} start={hall.podium.length + 1}>
          {hall.runnersUp.map((entry) => {
            const meta = entry.session;
            const canOpen = Boolean(meta && onOpenSession);
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={styles.row}
                  data-hall-entry={`rank-${entry.rank}`}
                  aria-label={ariaLabelOf(entry)}
                  disabled={!canOpen}
                  onClick={meta && onOpenSession ? () => onOpenSession(meta) : undefined}
                >
                  <span className={styles.rank}>{entry.rank}</span>
                  <span className={styles.title} title={entry.title}>
                    {entry.title}
                  </span>
                  <span className={styles.cost}>{formatUsd(entry.usd)}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <p className={styles.footnote}>{footnote}</p>
      </Panel>
    </div>
  );
}
