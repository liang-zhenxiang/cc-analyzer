import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { formatRelativeTime, formatTokenCount, formatUsd } from "../../lib/format";
import { buildProjectCards, CARD_LIMIT, SPARKLINE_DAYS } from "./projectCards";
import type { UsageSessionInput } from "./usageAggregations";
import styles from "./ProjectCardsPanel.module.css";

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 26;
const SPARK_PAD = 2;

/**
 * 14 点走势：只画形，不画刻度。数值在同一条卡片上以文字给出，图不重复承担
 * 「读数字」的职责（`aria-hidden`，屏幕阅读器不会听到一串无标签的坐标）。
 */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const span = values.length > 1 ? SPARK_WIDTH - SPARK_PAD * 2 : 0;
  const points = values
    .map((value, index) => {
      const x = SPARK_PAD + index * (span / Math.max(1, values.length - 1));
      const y = SPARK_HEIGHT - SPARK_PAD - (value / max) * (SPARK_HEIGHT - SPARK_PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="none"
    >
      <polyline className={styles.sparkLine} points={points} />
    </svg>
  );
}

/**
 * 项目卡片（Round CC / F6）：整行网格，一张卡一个项目。
 *
 * 卡片可点，但这一轮**没有**项目筛选视图可去——回调缺省时点击什么也不发生，
 * `title` 如实说明「后续版本提供」。不新造路由，也不假装已经跳转。
 *
 * 卡内不再套一层有底色的卡片：Panel 体里只有网格 gap 这一层语言（见
 * MilestonesPanel 的同款裁决），每格用一条上发丝线与上一行分开。
 */
export function ProjectCardsPanel({
  inputs,
  days,
  limit = CARD_LIMIT,
  onOpenProject,
  now
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  limit?: number;
  /** 后续版本的项目筛选入口；本轮缺省即「暂不可去」。 */
  onOpenProject?: (label: string) => void;
  /** 挂载时刻的固定时钟（测试注入；缺省取挂载那一刻）。 */
  now?: number;
}) {
  const [mountedNow] = useState(() => Date.now());
  const stamp = now ?? mountedNow;
  const cards = useMemo(
    () => buildProjectCards(inputs, days, limit, stamp),
    [inputs, days, limit, stamp]
  );

  return (
    <Panel
      title="项目卡片"
      ariaLabel="项目卡片"
      actions={<ProvenanceBadge provenance="estimated" />}
    >
      {cards.length === 0 ? (
        <p className={styles.empty}>近 {days} 天里还没有可展示的项目。</p>
      ) : (
        <div className={styles.grid} data-probe="cards-root">
          {cards.map((card) => {
            const costText = card.usd === null ? "定价未知" : formatUsd(card.usd);
            const activeText = formatRelativeTime(card.lastActive, stamp);
            return (
              <button
                key={card.label}
                type="button"
                className={styles.card}
                data-probe="card-item"
                title="项目筛选视图将在后续版本提供"
                aria-label={`${card.displayName}：${card.sessions} 个会话，${formatTokenCount(
                  card.tokens
                )} token，成本 ${costText}，最近活跃 ${activeText}`}
                onClick={() => onOpenProject?.(card.label)}
              >
                <span className={styles.name} title={card.path ?? card.label}>
                  {card.displayName}
                </span>
                <Sparkline values={card.sparkline} />
                <span className={styles.headline}>
                  <span className={styles.tokens}>{formatTokenCount(card.tokens)}</span>
                  <span className={styles.unit}>tok</span>
                  <span className={card.usd === null ? styles.unknownCost : styles.cost}>
                    {costText}
                  </span>
                </span>
                <span className={styles.meta}>
                  {card.sessions} 个会话 · {card.messages} 条消息
                </span>
                <span className={styles.meta}>最近活跃 {activeText}</span>
              </button>
            );
          })}
        </div>
      )}
      {cards.length > 0 ? (
        <p className={styles.footnote}>
          每张卡的走势是最近 {SPARKLINE_DAYS} 天的每日 token；会话数与成本只算所选时间范围。
        </p>
      ) : null}
    </Panel>
  );
}
