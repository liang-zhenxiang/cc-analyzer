import { gaugeNeedleAngle, type GaugeBand } from "./burnGauge";
import styles from "./BurnGaugeDial.module.css";

/**
 * 「燃烧速度表」（D6）：forecast 行内的一枚 72×40 微表。
 *
 * 两根轴必须分清——模型层的 `gaugeBand` 判的是**每小时速率占限额的比例**，
 * `gaugeNeedleAngle` 指的是**窗口末的预计用量百分比**。两者不是同一根轴，
 * 所以表盘只画一根 0–100% 的填充弧，颜色取速率档，档名写在行文里。
 */

const BAND_LABEL: Record<GaugeBand, string> = {
  quiet: "安静",
  cruising: "巡航",
  warm: "偏热",
  hot: "烧穿"
};

const BAND_CLASS: Record<GaugeBand, string> = {
  quiet: styles.quiet,
  cruising: styles.cruising,
  warm: styles.warm,
  hot: styles.hot
};

export const GAUGE_BAND_LABEL = BAND_LABEL;

const TRACK = "M 8 36 A 28 28 0 0 1 64 36";
const RADIUS = 28;
const CENTER = 36;

export function BurnGaugeDial({
  projectedPct,
  band
}: {
  projectedPct: number;
  band: GaugeBand;
}) {
  const clamped = Number.isFinite(projectedPct) ? Math.min(100, Math.max(0, projectedPct)) : 0;
  const angle = gaugeNeedleAngle(clamped);
  const radians = (angle * Math.PI) / 180;
  const needleX = CENTER + 24 * Math.cos(radians);
  const needleY = CENTER - 24 * Math.sin(radians);
  const arcX = CENTER + RADIUS * Math.cos(radians);
  const arcY = CENTER - RADIUS * Math.sin(radians);
  const largeArc = angle > 0 ? 1 : 0;

  return (
    <svg
      className={styles.gauge}
      viewBox="0 0 72 40"
      aria-hidden="true"
      data-probe="burn-gauge"
    >
      <path className={styles.track} d={TRACK} />
      {clamped > 0 ? (
        <path
          className={`${styles.fill} ${BAND_CLASS[band]}`}
          d={`M 8 36 A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${arcX} ${arcY}`}
        />
      ) : null}
      <line
        className={styles.needle}
        x1={CENTER}
        y1={CENTER}
        x2={needleX}
        y2={needleY}
      />
      <circle className={styles.hub} cx={CENTER} cy={CENTER} r={2} />
    </svg>
  );
}
