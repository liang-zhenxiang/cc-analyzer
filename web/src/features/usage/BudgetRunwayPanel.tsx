import { useMemo } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { addLocalDays, type UsageSessionInput } from "./usageAggregations";
import { formatTokenCount } from "../../lib/format";
import { useFontScale } from "../settings/fontScale";
import type { SessionMeta } from "../sessions/metadataCache";
import type { PlanSelection } from "./planLimits";
import {
  buildBudgetRunway,
  compactTokenLabel,
  runwayActualPoints,
  runwayAxisMax,
  RUNWAY_MIN_ACTIVE_DAYS
} from "./budgetRunway";
import { ProvenanceBadge } from "./ProvenanceBadge";
import primitives from "./charts/chartPrimitives.module.css";
import styles from "./BudgetRunwayPanel.module.css";

/**
 * 「每周预算跑道」（F9）：自然周（周一起）的累计消耗 + 自设预算天花板。
 *
 * 三条诚实性规则在界面上必须读得出来：
 * - 未设预算 → 不画预算线、不给百分比，但实际线与预测线照画；
 * - 活跃日不足 2 天 → 不画预测虚线（把一次冲刺乘七天不是预测）；
 * - 超预算不着红——用「线穿过预算线 + 文字」表达，颜色只区分实测与推算。
 * 页头的「近 N 天」对这张卡无效；脚注里说清楚自然周口径。
 */

const VIEW_WIDTH = 520;
const VIEW_HEIGHT = 180;
const PLOT_LEFT = 32;
const PLOT_RIGHT = 8;
const PLOT_TOP = 12;
const PLOT_BOTTOM = VIEW_HEIGHT - 28;

type Props = {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  plan?: PlanSelection;
  onOpenSession?: (session: SessionMeta) => void;
};

export function BudgetRunwayPanel({ inputs, now, plan }: Props) {
  const fontScale = useFontScale();
  const budget = plan?.weeklyLimitTokens ?? null;
  const runway = useMemo(() => buildBudgetRunway(inputs, now, budget), [inputs, now, budget]);
  const budgetTokens = runway.budget;

  if (!runway.hasData) {
    return (
      <Panel
        title="每周预算跑道"
        ariaLabel="每周预算跑道"
        titleAs="h3"
        actions={<ProvenanceBadge provenance="inferred" />}
      >
        <div data-probe="lab-runway">
          <EmptyState size="inline" title="本周还没有消耗" />
          <p className={styles.footnote}>自然周（周一起），与页头「近 N 天」无关。</p>
        </div>
      </Panel>
    );
  }

  const points = runwayActualPoints(runway, now);
  const last = points[points.length - 1];
  const axisMax = runwayAxisMax(runway);
  const span = Math.max(1, runway.weekEnd - runway.weekStart);
  const xOf = (timestamp: number) =>
    PLOT_LEFT + ((timestamp - runway.weekStart) / span) * (VIEW_WIDTH - PLOT_LEFT - PLOT_RIGHT);
  const yOf = (value: number) =>
    PLOT_BOTTOM - (Math.max(0, value) / axisMax) * (PLOT_BOTTOM - PLOT_TOP);

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xOf(point.t)} ${yOf(point.value)}`)
    .join(" ");
  const areaPath = `${linePath} L ${xOf(last.t)} ${PLOT_BOTTOM} L ${xOf(points[0].t)} ${PLOT_BOTTOM} Z`;

  const nowX = xOf(last.t);
  const nowY = yOf(last.value);
  const prediction = runway.prediction;
  const predictionX = xOf(runway.weekEnd);
  const predictionY = prediction ? yOf(prediction.total) : nowY;

  const status = (() => {
    if (budgetTokens === null) {
      return "在「设置 → 计费窗口」里填写周预算后，这里会出现预算线与落地判断。";
    }
    if (runway.used <= 0) {
      return "本周还没有消耗，不推算速度。";
    }
    if (runway.overNow) {
      return `已超出 ${compactTokenLabel(runway.used - budgetTokens)}`;
    }
    if (runway.projectedOver) {
      return `预计超出 ${compactTokenLabel(runway.overBy)}`;
    }
    if (runway.tokensPerDay === null) {
      return `活跃日不足 ${RUNWAY_MIN_ACTIVE_DAYS} 天，不推算落地速度。`;
    }
    return `预算内（按预测还有 ${compactTokenLabel(budgetTokens - (prediction?.total ?? runway.used))}）`;
  })();

  const summaryParts = [`预算跑道：本周已用 ${formatTokenCount(Math.round(runway.used))}`];
  if (budgetTokens !== null) {
    summaryParts.push(`预算 ${formatTokenCount(Math.round(budgetTokens))}`);
  }
  if (prediction) {
    summaryParts.push(`按当前速度周日约 ${formatTokenCount(Math.round(prediction.total))}`);
  }
  if (budgetTokens !== null && runway.overNow) {
    summaryParts.push(`已超出 ${formatTokenCount(Math.round(runway.used - budgetTokens))}`);
  } else if (runway.projectedOver) {
    summaryParts.push(`会超出 ${formatTokenCount(Math.round(runway.overBy))}`);
  } else if (prediction && budgetTokens !== null) {
    summaryParts.push("仍在预算内");
  }
  if (runway.used > 0 && runway.tokensPerDay === null) {
    summaryParts.push(`活跃日不足 ${RUNWAY_MIN_ACTIVE_DAYS} 天，不推算落地速度`);
  }

  const readouts = [
    { label: "已用", value: formatTokenCount(Math.round(runway.used)) },
    {
      label: "预算",
      value: budgetTokens === null ? "—" : formatTokenCount(Math.round(budgetTokens))
    },
    {
      label: "日均",
      value:
        runway.tokensPerDay === null
          ? "—"
          : formatTokenCount(Math.round(runway.tokensPerDay))
    },
    {
      label: "预计周日",
      value: prediction === null ? "—" : formatTokenCount(Math.round(prediction.total))
    }
  ];

  return (
    <Panel
      title="每周预算跑道"
      ariaLabel="每周预算跑道"
      titleAs="h3"
      actions={
        <div className={styles.actions}>
          <ProvenanceBadge provenance="inferred" />
          {budgetTokens === null ? (
            <span className={styles.chip}>未设周预算</span>
          ) : null}
        </div>
      }
    >
      <div className={styles.root} data-probe="lab-runway">
        <svg
          className={primitives.chart}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`${summaryParts.join("；")}。`}
        >
          <line
            x1={PLOT_LEFT}
            x2={VIEW_WIDTH - PLOT_RIGHT}
            y1={PLOT_BOTTOM}
            y2={PLOT_BOTTOM}
            className={primitives.axisLine}
          />

          {/* 未来日期的刻度（周一…周日）落在每日中点。 */}
          {runway.days.map((day, index) => {
            // 130%：日刻度改为隔天，星期序列本身仍固定。
            if (fontScale > 1.2 && index % 2 === 1) return null;
            const midday = day.dayStart + (addLocalDays(day.dayStart, 1) - day.dayStart) / 2;
            return (
              <text
                key={day.dayStart}
                x={xOf(midday)}
                y={VIEW_HEIGHT - 8}
                textAnchor="middle"
                className={primitives.tickText}
              >
                {day.label}
              </text>
            );
          })}

          <path d={areaPath} className={styles.area} />

          {budgetTokens !== null ? (
            <g>
              <line
                x1={PLOT_LEFT}
                x2={VIEW_WIDTH - PLOT_RIGHT}
                y1={yOf(budgetTokens)}
                y2={yOf(budgetTokens)}
                className={styles.budgetLine}
              >
                <title>{`预算 ${formatTokenCount(Math.round(budgetTokens))} token`}</title>
              </line>
              <text
                x={VIEW_WIDTH - PLOT_RIGHT}
                y={Math.max(10, yOf(budgetTokens) - 4)}
                textAnchor="end"
                className={styles.budgetLabel}
              >
                {`预算 ${compactTokenLabel(budgetTokens)}`}
              </text>
            </g>
          ) : null}

          {prediction ? (
            <g>
              <line
                x1={nowX}
                y1={nowY}
                x2={predictionX}
                y2={predictionY}
                className={styles.prediction}
              >
                <title>
                  {`按当前速度推算，周日约 ${formatTokenCount(Math.round(prediction.total))} token`}
                </title>
              </line>
              <circle
                cx={predictionX}
                cy={predictionY}
                r={3}
                className={styles.predictionEnd}
              />
            </g>
          ) : null}

          <path d={linePath} className={styles.actualLine}>
            <title>{`本周已用 ${formatTokenCount(Math.round(runway.used))} token`}</title>
          </path>

          {runway.tokensPerDay !== null ? (
            <g>
              <polygon
                points={`${nowX - 1},${nowY - 3} ${nowX + 4},${nowY} ${nowX - 1},${nowY + 3}`}
                className={styles.speedMarker}
              />
              <text
                x={nowX + (nowX > VIEW_WIDTH / 2 ? -6 : 6)}
                y={Math.max(10, nowY - 6)}
                textAnchor={nowX > VIEW_WIDTH / 2 ? "end" : "start"}
                className={styles.speedLabel}
              >
                {`${compactTokenLabel(runway.tokensPerDay)}/天`}
              </text>
            </g>
          ) : null}
        </svg>

        <div
          className={`${styles.readouts} ${fontScale > 1.2 ? styles.comfortable : ""}`}
          data-probe="runway-readouts"
        >
          {readouts.map((readout) => (
            <div key={readout.label} className={styles.readout}>
              <span className={styles.readoutLabel}>{readout.label}</span>
              <span className={styles.readoutValue}>{readout.value}</span>
            </div>
          ))}
        </div>

        <p className={styles.status} data-probe="runway-status">
          {status}
        </p>
        <p className={styles.footnote}>
          自然周（周一起），与页头「近 N 天」无关；预算取自「设置 → 计费窗口」的自设数字。
          预测按本周已有活跃日的日均外推，不是承诺。
        </p>
      </div>
    </Panel>
  );
}
