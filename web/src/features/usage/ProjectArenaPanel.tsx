import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { Panel } from "../../components/Panel";
import { formatModelId, formatProjectPath, formatTokenCount } from "../../lib/format";
import { HBarChart } from "./charts/HBarChart";
import primitives from "./charts/chartPrimitives.module.css";
import { arenaSideOf, buildProjectDaily, mainModelOf } from "./projectArena";
import { formatDayLabel, OTHER_LABEL } from "./usageAggregations";
import type { UsageSessionInput, UsageSlice } from "./usageAggregations";
import styles from "./ProjectArenaPanel.module.css";

const SVG_WIDTH = 720;
const LABEL_WIDTH = 44;
const MAX_PLOT_HEIGHT = 320;

/**
 * 「按项目分布」的可切换面板：默认仍是原来的 HBarChart，点「对比」把面板体
 * 换成项目擂台（F2）。
 *
 * 为什么整块面板由这个组件渲染而不是只做一个内嵌块：`Panel` 的 actions 与
 * 内容是同一个视觉单元，切视图时标题和按钮必须一起换；把 HBarChart 留在页面
 * 里、只在它下面插一块，会出现「两个标题、一个按钮管两处」的错位。
 */
export function ProjectArenaPanel({
  inputs,
  days,
  data,
  projects,
  now
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  /** 已格式化的按项目分布（与页面里那张 HBarChart 完全同一份数据）。 */
  data: { label: string; value: number; hint?: string }[];
  /** 原始 Top-N 切片（编码后的项目名），擂台的选项与序列都按它取数。 */
  projects: readonly UsageSlice[];
  /** 挂载时刻的固定时钟（测试注入；缺省取挂载那一刻，与日历面板同一取舍）。 */
  now?: number;
}) {
  const [mountedNow] = useState(() => Date.now());
  const stamp = now ?? mountedNow;
  const [comparing, setComparing] = useState(false);
  // The folded 「其他」 bucket is not a project: it has no label to slice a
  // daily series out of, and an option that can only draw zeros would look
  // like a real project with no usage. The chart above may still show it.
  const choices = useMemo(
    () => projects.filter((project) => project.label !== OTHER_LABEL),
    [projects]
  );
  const [pickA, setPickA] = useState<string>(choices[0]?.label ?? "");
  const [pickB, setPickB] = useState<string>(choices[1]?.label ?? "");

  // 选项是 Top-N 的切片；区间切到更短的窗口后，旧选择可能已经不在榜上。
  // 这里只做「还能用就沿用、不能用就退回第一名」的派生，不写 effect 同步。
  const labelA = choices.some((project) => project.label === pickA)
    ? pickA
    : (choices[0]?.label ?? "");
  const labelB = choices.some((project) => project.label === pickB)
    ? pickB
    : (choices[1]?.label ?? "");

  const canCompare = choices.length >= 2;
  const showArena = comparing && canCompare;

  const projectPaths = useMemo(() => {
    const paths = new Map<string, string>();
    for (const input of inputs) {
      if (input.projectPath && !paths.has(input.projectLabel)) {
        paths.set(input.projectLabel, input.projectPath);
      }
    }
    return paths;
  }, [inputs]);

  const displayName = (label: string) => formatProjectPath(label, projectPaths.get(label));

  // 两个项目的显示名可能撞车（同一个仓库的不同 worktree 落进不同编码目录）。
  // 撞了就补上原始编码名，否则两个选项在界面上无法区分。
  const displayNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of choices) {
      const name = formatProjectPath(project.label, projectPaths.get(project.label));
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const names = new Map<string, string>();
    for (const project of choices) {
      const name = formatProjectPath(project.label, projectPaths.get(project.label));
      names.set(
        project.label,
        (counts.get(name) ?? 0) > 1 ? `${name} · ${project.label}` : name
      );
    }
    return names;
  }, [choices, projectPaths]);

  const daily = useMemo(
    () => buildProjectDaily(inputs, days, labelA, labelB, stamp),
    [inputs, days, labelA, labelB, stamp]
  );
  const modelA = useMemo(
    () => mainModelOf(inputs, days, labelA, stamp),
    [inputs, days, labelA, stamp]
  );
  const modelB = useMemo(
    () => mainModelOf(inputs, days, labelB, stamp),
    [inputs, days, labelB, stamp]
  );

  const sideA = arenaSideOf(daily.a);
  const sideB = arenaSideOf(daily.b);

  const nameA = displayNames.get(labelA) ?? displayName(labelA);
  const nameB = displayNames.get(labelB) ?? displayName(labelB);

  const averageWinsA = sideA.average > sideB.average;
  const averageWinsB = sideB.average > sideA.average;
  const peakWinsA = sideA.peak > sideB.peak;
  const peakWinsB = sideB.peak > sideA.peak;
  const modelWinsA = modelA.model !== null && modelA.tokens > modelB.tokens;
  const modelWinsB = modelB.model !== null && modelB.tokens > modelA.tokens;

  const backButton = (
    <div className={styles.actions}>
      <Button type="button" variant="secondary" onClick={() => setComparing(false)}>
        返回
      </Button>
    </div>
  );

  if (showArena) {
    const dayCount = daily.days.length;
    const rowHeight = Math.max(5, Math.min(18, Math.floor(MAX_PLOT_HEIGHT / Math.max(1, dayCount))));
    const barHeight = Math.max(2, rowHeight - 2);
    const plotWidth = SVG_WIDTH - LABEL_WIDTH * 2;
    const centerX = LABEL_WIDTH + plotWidth / 2;
    const halfWidth = plotWidth / 2;
    const maxValue = Math.max(...daily.a, ...daily.b, 1);
    const labelStride = Math.max(1, Math.ceil(dayCount / 12));
    const height = dayCount * rowHeight + 4;

    return (
      <Panel title="按项目分布" actions={backButton}>
        <div className={styles.arena} data-probe="arena-root">
          <div className={styles.pickers}>
            <label className={styles.picker}>
              <span className={styles.pickerLabel}>左侧项目</span>
              <select
                className={styles.select}
                value={labelA}
                onChange={(event) => setPickA(event.target.value)}
              >
                {choices.map((project) => (
                  <option
                    key={project.label}
                    value={project.label}
                    disabled={project.label === labelB}
                  >
                    {displayNames.get(project.label) ?? displayName(project.label)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.picker}>
              <span className={styles.pickerLabel}>右侧项目</span>
              <select
                className={styles.select}
                value={labelB}
                onChange={(event) => setPickB(event.target.value)}
              >
                {choices.map((project) => (
                  <option
                    key={project.label}
                    value={project.label}
                    disabled={project.label === labelA}
                  >
                    {displayNames.get(project.label) ?? displayName(project.label)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.readouts}>
            <div className={styles.side} data-probe="arena-side-a">
              <p className={styles.sideName} title={projectPaths.get(labelA) ?? labelA}>
                <span className={`${styles.swatch} ${styles.swatchA}`} aria-hidden="true" />
                {nameA}
              </p>
              <div className={styles.readout}>
                <span className={styles.readoutLabel}>日均 token</span>
                <span className={averageWinsA ? styles.winner : styles.readoutValue}>
                  {formatTokenCount(Math.round(sideA.average))}
                </span>
              </div>
              <div className={styles.readout}>
                <span className={styles.readoutLabel}>峰值日 token</span>
                <span className={peakWinsA ? styles.winner : styles.readoutValue}>
                  {formatTokenCount(sideA.peak)}
                </span>
              </div>
              <div className={styles.readout}>
                <span className={styles.readoutLabel}>主力模型</span>
                <span className={modelWinsA ? styles.winner : styles.readoutValue}>
                  {modelA.model === null ? "—" : formatModelId(modelA.model)}
                </span>
              </div>
            </div>

            <div className={`${styles.side} ${styles.sideRight}`} data-probe="arena-side-b">
              <p className={styles.sideName} title={projectPaths.get(labelB) ?? labelB}>
                <span className={`${styles.swatch} ${styles.swatchB}`} aria-hidden="true" />
                {nameB}
              </p>
              <div className={styles.readout}>
                <span className={styles.readoutLabel}>日均 token</span>
                <span className={averageWinsB ? styles.winner : styles.readoutValue}>
                  {formatTokenCount(Math.round(sideB.average))}
                </span>
              </div>
              <div className={styles.readout}>
                <span className={styles.readoutLabel}>峰值日 token</span>
                <span className={peakWinsB ? styles.winner : styles.readoutValue}>
                  {formatTokenCount(sideB.peak)}
                </span>
              </div>
              <div className={styles.readout}>
                <span className={styles.readoutLabel}>主力模型</span>
                <span className={modelWinsB ? styles.winner : styles.readoutValue}>
                  {modelB.model === null ? "—" : formatModelId(modelB.model)}
                </span>
              </div>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${SVG_WIDTH} ${height}`}
            className={primitives.chart}
            role="img"
            aria-label={`项目擂台：${nameA} 对 ${nameB}，按天对比 token 消耗`}
          >
            <line
              x1={centerX}
              x2={centerX}
              y1={0}
              y2={height}
              className={primitives.axisLine}
            />
            {daily.days.map((day, index) => {
              const y = index * rowHeight;
              const widthA = (daily.a[index] / maxValue) * halfWidth;
              const widthB = (daily.b[index] / maxValue) * halfWidth;
              const showLabel = index % labelStride === 0 || index === dayCount - 1;
              return (
                <g key={day.dayStart}>
                  {showLabel ? (
                    <text
                      x={LABEL_WIDTH - 6}
                      y={y + barHeight}
                      textAnchor="end"
                      className={primitives.tickText}
                    >
                      {formatDayLabel(day.dayStart)}
                    </text>
                  ) : null}
                  <rect
                    x={centerX - widthA}
                    y={y}
                    width={widthA}
                    height={barHeight}
                    className={styles.barA}
                    data-probe="arena-bar"
                  >
                    <title>{`${nameA} · ${formatDayLabel(day.dayStart)}：${formatTokenCount(daily.a[index])} token`}</title>
                  </rect>
                  <rect
                    x={centerX}
                    y={y}
                    width={widthB}
                    height={barHeight}
                    className={styles.barB}
                    data-probe="arena-bar"
                  >
                    <title>{`${nameB} · ${formatDayLabel(day.dayStart)}：${formatTokenCount(daily.b[index])} token`}</title>
                  </rect>
                </g>
              );
            })}
          </svg>
        </div>
      </Panel>
    );
  }

  const compareButton = (
    <div className={styles.actions}>
      <Button
        type="button"
        variant="secondary"
        disabled={!canCompare}
        title={canCompare ? "并排比较两个项目" : "需要至少两个项目"}
        onClick={() => setComparing(true)}
      >
        对比
      </Button>
    </div>
  );

  return (
    <Panel title="按项目分布" actions={compareButton}>
      <HBarChart
        data={data}
        ariaLabel="按项目分布"
        emptyText="所选范围内暂无项目消耗"
      />
    </Panel>
  );
}
