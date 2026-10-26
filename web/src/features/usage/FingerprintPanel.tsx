import { useMemo } from "react";
import { Panel } from "../../components/Panel";
import { formatTokenCount } from "../../lib/format";
import { sessionTitle } from "../sessions/metadataCache";
import { projectRadar, RADAR_AXES, type RadarPoint } from "./projectRadar";
import { aggregateSession, totalsSum, type UsageSessionInput } from "./usageAggregations";
import styles from "./FingerprintPanel.module.css";

/**
 * 「指纹雷达」（D4）：把本窗口最重的一段会话折成六轴画像。
 *
 * 模型层给的是**相对同批会话的 min/max 归一**（不是固定上限、也不是人群
 * 百分位），所以脚注必须写明刻度性质——读者会把它当绝对值来读。
 */

const SIZE = 176;
const CENTER = SIZE / 2;
const RADIUS = 64;
const AXES = RADAR_AXES.length;

function pointAt(index: number, distance: number): { x: number; y: number } {
  const angle = ((-90 + (360 / AXES) * index) * Math.PI) / 180;
  return {
    x: CENTER + distance * Math.cos(angle),
    y: CENTER + distance * Math.sin(angle)
  };
}

function polygon(distance: number): string {
  return Array.from({ length: AXES }, (_, index) => {
    const { x, y } = pointAt(index, distance);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function formatRaw(point: RadarPoint): string {
  switch (point.axis) {
    case "tokenIntensity":
      return `${formatTokenCount(Math.round(point.raw))}/日`;
    case "messageDensity":
      return `${point.raw.toFixed(1)}/日`;
    case "errorRate":
      return point.label.includes("无错误数据") ? "—" : `${(point.raw * 100).toFixed(1)}%`;
    case "toolDiversity":
      return `${point.raw} 种`;
    case "contextDepth":
      return formatTokenCount(Math.round(point.raw));
    case "persistence":
      return `${point.raw} 天`;
    default:
      return String(point.raw);
  }
}

export function FingerprintPanel({ inputs }: { inputs: readonly UsageSessionInput[] }) {
  const subject = useMemo(() => {
    return [...inputs]
      .sort(
        (left, right) =>
          totalsSum(aggregateSession(right.records).totals) -
            totalsSum(aggregateSession(left.records).totals) ||
          left.projectLabel.localeCompare(right.projectLabel)
      )[0];
  }, [inputs]);

  const points = useMemo(() => (subject ? projectRadar(subject, inputs) : []), [subject, inputs]);
  const subjectLabel = subject?.session ? sessionTitle(subject.session) : (subject?.projectLabel ?? "");

  if (!subject) {
    return (
      <Panel title="指纹雷达" ariaLabel="指纹雷达">
        <p className={styles.empty}>本窗口还没有可画像的会话</p>
      </Panel>
    );
  }

  const dataPoints = points
    .map((point, index) => {
      const { x, y } = pointAt(index, RADIUS * point.normalized);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const missing = points.filter((point) => point.label.includes("无错误数据"));

  return (
    <Panel
      title="指纹雷达"
      ariaLabel="指纹雷达"
      actions={<span className={styles.scope}>{subjectLabel}</span>}
    >
      <div className={styles.body} data-probe="fingerprint">
        <svg
          className={styles.radar}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`指纹雷达：${points.map((point) => `${point.label} ${formatRaw(point)}`).join("，")}`}
        >
          {[16, 32, 48, 64].map((distance) => (
            <polygon
              key={distance}
              className={styles.grid}
              points={polygon(distance)}
            />
          ))}
          {Array.from({ length: AXES }, (_, index) => {
            const { x, y } = pointAt(index, RADIUS);
            return <line key={index} className={styles.spoke} x1={CENTER} y1={CENTER} x2={x} y2={y} />;
          })}
          <polygon className={styles.shape} points={dataPoints} />
          {points.map((point, index) => {
            const { x, y } = pointAt(index, RADIUS * point.normalized);
            return <circle key={point.axis} className={styles.vertex} cx={x} cy={y} r={2.5} />;
          })}
        </svg>
        <table className={styles.values}>
          <caption className={styles.srOnly}>六轴原始读数</caption>
          <tbody>
            {points.map((point) => (
              <tr key={point.axis} data-probe="fingerprint-axis">
                <th scope="row">{point.label}</th>
                <td>{formatRaw(point)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.footnote}>
        六轴按本窗口全部会话的相对位置归一，不是人群百分位。
        {missing.length > 0 ? "标 — 的轴没有足够样本。" : ""}
      </p>
    </Panel>
  );
}
