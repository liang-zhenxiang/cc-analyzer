import { useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatShortStamp, formatTokenCount } from "../../lib/format";
import { useFontScale } from "../settings/fontScale";
import type { SessionMeta } from "../sessions/metadataCache";
import {
  CONSTELLATION_HEIGHT,
  CONSTELLATION_PLOT_BOTTOM,
  CONSTELLATION_PLOT_LEFT,
  CONSTELLATION_PLOT_RIGHT,
  CONSTELLATION_PLOT_TOP,
  CONSTELLATION_WIDTH,
  buildConstellation
} from "./constellation";
import type { UsageSessionInput } from "./usageAggregations";
import styles from "./ConstellationPanel.module.css";

/**
 * 「会话星系」（F1）：一条水平泳道一个项目，时间从左往右，一颗星一个会话。
 *
 * 纯 SVG、零依赖。星本身不做焦点目标（几十个 Tab 停靠点比读不到更糟）：
 * 图形用 `role="img"` + 一句话摘要承担读屏，卡片下方的「最重的 5 个会话」
 * 行按钮才是可操作层。重叠星用卡片底 1px 描边分隔，**不做抖动**——抖动
 * 会伪造时间。
 */

const LANE_LABEL_LIMIT = 14;
const TICK_LABEL_Y = 13;

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export function ConstellationPanel({
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
  // 130% 字号下泳道从 8 降到 5：字号只改字，放不下就减少样本数（设计 §5.3）。
  const maxLanes = fontScale >= 1.3 ? 5 : 8;
  const constellation = useMemo(
    () => buildConstellation(inputs, days, now, { maxLanes }),
    [inputs, days, now, maxLanes]
  );
  const [hovered, setHovered] = useState<string | null>(null);

  if (constellation.sessions.length === 0) {
    return (
      <div data-probe="lab-galaxy">
        <Panel title="会话星系" ariaLabel="会话星系" titleAs="h3">
          <EmptyState size="inline" title="所选范围内没有会话" />
        </Panel>
      </div>
    );
  }

  const plotBottom = CONSTELLATION_HEIGHT - CONSTELLATION_PLOT_BOTTOM;
  const plotRight = CONSTELLATION_WIDTH - CONSTELLATION_PLOT_RIGHT;
  const allWithoutUsage = constellation.noUsageCount === constellation.sessions.length;
  // 悬停的星提到最后绘制（SVG 没有 z-index，绘制顺序就是层级）。
  const stars = hovered
    ? [
        ...constellation.sessions.filter((session) => session.id !== hovered),
        ...constellation.sessions.filter((session) => session.id === hovered)
      ]
    : constellation.sessions;

  const footnote = [
    "横轴是开始时间，纵向是项目泳道；星的大小按 token，颜色按模型（与「按模型分布」同一顺序）。同一小时内的相邻会话用细线相连。",
    constellation.hiddenProjects > 0
      ? `另有 ${constellation.hiddenProjects} 个项目并入「其他」泳道。`
      : "",
    constellation.hiddenLinks > 0
      ? `同小时连线超过 60 段，另有 ${constellation.hiddenLinks} 段未画出。`
      : "",
    constellation.noUsageCount > 0 && !allWithoutUsage
      ? `${constellation.noUsageCount} 个会话没有用量读数，按最小半径画成空心环。`
      : ""
  ]
    .filter(Boolean)
    .join("");

  return (
    <div data-probe="lab-galaxy">
      <Panel
        title="会话星系"
        ariaLabel="会话星系"
        titleAs="h3"
        actions={
          <span className={styles.scope}>{`${constellation.sessions.length} 个会话`}</span>
        }
      >
        <svg
          className={styles.chart}
          viewBox={`0 0 ${CONSTELLATION_WIDTH} ${CONSTELLATION_HEIGHT}`}
          role="img"
          aria-label={constellation.summary}
        >
          {/* 高对比度才出现的泳道分隔线：普通档靠 y 位置区分，不抢注意力。 */}
          {constellation.lanes.slice(1).map((lane, index) => {
            const boundary =
              CONSTELLATION_PLOT_TOP +
              ((index + 1) *
                (CONSTELLATION_HEIGHT - CONSTELLATION_PLOT_TOP - CONSTELLATION_PLOT_BOTTOM)) /
                constellation.lanes.length;
            return (
              <line
                key={`lane-rule-${lane.key}`}
                x1={CONSTELLATION_PLOT_LEFT}
                x2={plotRight}
                y1={boundary}
                y2={boundary}
                className={styles.laneRule}
              />
            );
          })}

          {constellation.ticks.map((tick) => {
            const ratio = Math.min(
              1,
              Math.max(
                0,
                (tick.ts - constellation.windowStart) /
                  Math.max(1, constellation.windowEnd - constellation.windowStart)
              )
            );
            const x = CONSTELLATION_PLOT_LEFT + ratio * (plotRight - CONSTELLATION_PLOT_LEFT);
            return (
              <g key={tick.ts}>
                <line
                  x1={x}
                  x2={x}
                  y1={CONSTELLATION_PLOT_TOP}
                  y2={plotBottom}
                  className={styles.tickLine}
                />
                <text
                  x={x}
                  y={TICK_LABEL_Y}
                  textAnchor={ratio <= 0.02 ? "start" : ratio >= 0.98 ? "end" : "middle"}
                  className={styles.tickLabel}
                >
                  {tick.label}
                </text>
              </g>
            );
          })}

          {constellation.links.map((link) => {
            const from = constellation.sessions.find((session) => session.id === link.from);
            const to = constellation.sessions.find((session) => session.id === link.to);
            if (!from || !to) return null;
            return (
              <line
                key={link.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={styles.link}
              />
            );
          })}

          {stars.map((session) => {
            const isHovered = hovered === session.id;
            const title = [
              session.projectName,
              session.title,
              formatShortStamp(session.start),
              `${formatTokenCount(session.tokens)} token`,
              session.modelLabel ?? "无用量读数"
            ].join(" · ");
            return (
              <circle
                key={session.id}
                cx={session.x}
                cy={session.y}
                r={isHovered ? session.r + 1 : session.r}
                className={[
                  styles.star,
                  session.hollow ? styles.hollow : null,
                  isHovered ? styles.hovered : null
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={session.tone ? { fill: `var(--chart-${session.tone})` } : undefined}
                data-constellation-star={session.id}
                data-constellation-hovered={isHovered ? "true" : undefined}
                onMouseEnter={() => setHovered(session.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{title}</title>
              </circle>
            );
          })}

          {constellation.lanes.map((lane) => (
            <g key={`lane-${lane.key}`}>
              <title>{lane.fullLabel}</title>
              <text
                x={CONSTELLATION_PLOT_LEFT - 8}
                y={lane.y + 4}
                textAnchor="end"
                className={styles.laneLabel}
              >
                {truncate(lane.label, LANE_LABEL_LIMIT)}
              </text>
            </g>
          ))}
        </svg>

        {constellation.sessions.length === 1 ? (
          <p className={styles.note}>本窗口只有 1 个会话</p>
        ) : null}

        {allWithoutUsage ? (
          <p className={styles.note}>这些会话没有用量读数，大小按最小半径画。</p>
        ) : null}

        {constellation.models.length > 0 ? (
          <ul className={styles.legend}>
            {constellation.models.map((model) => (
              <li key={model.model} className={styles.legendItem}>
                <span
                  className={styles.swatch}
                  style={{ background: `var(--chart-${model.tone})` }}
                  aria-hidden="true"
                />
                {model.label}
              </li>
            ))}
            {constellation.otherModelCount > 0 ? (
              <li className={styles.legendItem}>
                <span
                  className={`${styles.swatch} ${styles.swatchFaint}`}
                  aria-hidden="true"
                />
                其他 / 未知模型
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className={styles.heaviest}>
          <p className={styles.listTitle}>最重的 5 个会话</p>
          <ul className={styles.list}>
            {constellation.heaviest.map((session) => {
              const meta = session.session;
              const canOpen = Boolean(meta && onOpenSession);
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    className={styles.row}
                    data-constellation-row={session.id}
                    aria-label={`${session.projectName} · ${session.title}：${formatTokenCount(session.tokens)} token，${formatShortStamp(session.start)}`}
                    disabled={!canOpen}
                    onClick={meta && onOpenSession ? () => onOpenSession(meta) : undefined}
                  >
                    <span className={styles.rowProject} title={session.projectName}>
                      {session.projectName}
                    </span>
                    <span className={styles.rowTitle} title={session.title}>
                      {session.title}
                    </span>
                    <span className={styles.rowValue}>{formatTokenCount(session.tokens)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <p className={styles.footnote}>{footnote}</p>
      </Panel>
    </div>
  );
}
