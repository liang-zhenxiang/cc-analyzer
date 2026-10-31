import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { formatRelativeTime, formatTokenCount, formatUsd } from "../../lib/format";
import { buildProjectCards, CARD_LIMIT, SPARKLINE_DAYS } from "./projectCards";
import { projectSeasons, type ProjectSeasonRow } from "./projectSeasons";
import type { UsageSessionInput } from "./usageAggregations";
import styles from "./ProjectCardsPanel.module.css";

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 26;
const SPARK_PAD = 2;

/** 模型层的行 → 按项目名索引（卡片 label 与行的 project 同为 encoded label）。 */
function seasonIndex(rows: readonly ProjectSeasonRow[]): Map<string, ProjectSeasonRow> {
  return new Map(rows.map((row) => [row.project, row]));
}

/**
 * 一张卡的季节读数：模型行（含跨年多格）合并成 Q1–Q4 四段。
 *
 * - share 合并 = 各年同季 token 相加 ÷ 项目总 token（分母仍是项目自身，
 *   与模型层「桶内自比」口径一致——重算而非把 share 相加，share 之和
 *   恒 ≤1 但跨年直接相加不是任何合法比例）；
 * - total 0（模型层诚实保留的无 usage 行）→ null，整块不渲染；
 * - 最重季并列取更早的季（Q 序号小者），读法稳定。
 */
function seasonOf(row: ProjectSeasonRow | undefined): {
  shares: [number, number, number, number];
  total: number;
} | null {
  if (!row) return null;
  const tokens = [0, 0, 0, 0];
  for (const cell of row.quarters) tokens[cell.q - 1] += cell.tokens;
  const total = tokens.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return null;
  return { shares: tokens.map((n) => n / total) as [number, number, number, number], total };
}

/** 最重季（1–4）；并列取更早的季。 */
function heaviestQuarter(shares: readonly number[]): number {
  let best = 0;
  for (let q = 1; q < shares.length; q += 1) {
    if (shares[q] > shares[best]) best = q; // 严格大于才换 → 并列留更早的季
  }
  return best + 1;
}

/** 季节文字：`Q2 最重（41%）` + 空季补「· Q1 无记录」（按 Q 序升序）。 */
function seasonText(shares: readonly number[]): string {
  const heaviest = heaviestQuarter(shares);
  const parts = [`Q${heaviest} 最重（${Math.round(shares[heaviest - 1] * 100)}%）`];
  const empty = shares
    .map((share, i) => (share <= 0 ? `Q${i + 1} 无记录` : null))
    .filter((s): s is string => s !== null);
  if (empty.length > 0) parts.push(empty.join(" · "));
  return parts.join(" · ");
}

/** aria-label 末尾的全量读数：`，季节性：Q1 32%、Q2 41%、Q3 19%、Q4 8%`。 */
function seasonAria(shares: readonly number[]): string {
  return shares.map((share, i) => `Q${i + 1} ${Math.round(share * 100)}%`).join("、");
}

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
 *
 * G8 季节条（Round GG）挂在每张卡 meta 两行之后：模型层 `projectSeasons`
 * 的行按项目名对回卡片；条按**日历季**（Q1–Q4）合并——跨年窗口里 2025-Q1 与
 * 2026-Q1 同段呈现，季节形状关心的是「一年里的节律」而非年份（四段配色是
 * 时间序号，不是年份类别）。
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
  // G8 季节：模型口径是 monthSpanOf 全历史窗口（与 G4/G6 同一条月几何），
  // 与卡片 30/90 天窗口正交——季节是项目的生命周期，不该跟着区间选择伸缩。
  const seasons = useMemo(() => seasonIndex(projectSeasons(inputs, stamp)), [inputs, stamp]);

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
            // G8 季节条：模型行按项目名对回卡片；total 0 → null 整块不渲染。
            // 图形 aria-hidden（卡是 button，季节是装饰不是可聚焦控件），
            // 文字以两个通道补读：可见的 seasonText + 卡 aria-label 末尾全量。
            const season = seasonOf(seasons.get(card.label));
            return (
              <button
                key={card.label}
                type="button"
                className={styles.card}
                data-probe="card-item"
                title="项目筛选视图将在后续版本提供"
                aria-label={`${card.displayName}：${card.sessions} 个会话，${formatTokenCount(
                  card.tokens
                )} token，成本 ${costText}，最近活跃 ${activeText}${season ? `，季节性：${seasonAria(season.shares)}` : ""}`}
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
                {season ? (
                  <>
                    {/* 段宽走 flex 比例（flex:32 → 32/100）；某季 0 时不渲染该段：
                        gap 缝是按段数出的，0 宽段会多出一条假缝（design §G8）。 */}
                    <span className={styles.season} data-probe="card-season" data-quarters="4" aria-hidden="true">
                      {season.shares.map((share, i) =>
                        share > 0 ? (
                          <span
                            key={i}
                            className={styles.seg}
                            data-q={i + 1}
                            style={{ flexGrow: Math.round(share * 100) }}
                          />
                        ) : null
                      )}
                    </span>
                    <span className={styles.seasonText} data-probe="card-season-text">
                      {seasonText(season.shares)}
                    </span>
                  </>
                ) : null}
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
