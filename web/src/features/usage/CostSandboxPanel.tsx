import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatUsd } from "../../lib/format";
import { useFontScale } from "../settings/fontScale";
import type { SessionMeta } from "../sessions/metadataCache";
import type { PlanSelection } from "./planLimits";
import {
  buildSandboxBaseline,
  cacheHitFloorPct,
  initialLevers,
  MAX_CACHE_HIT_PCT,
  MAX_OUTPUT_CUT_PCT,
  MAX_TAKEOVER_PCT,
  simulateSandbox
} from "./costSandbox";
import type { UsageSessionInput } from "./usageAggregations";
import { ProvenanceBadge } from "./ProvenanceBadge";
import primitives from "./charts/chartPrimitives.module.css";
import styles from "./CostSandboxPanel.module.css";

/**
 * 「成本沙盘」（F4）：三根推杆 + 一张瀑布图。
 *
 * 界面层的两条硬规则：
 * - **实测与假设必须两种画法**：现状柱中性（`--bg-inset` + 边框），推演柱
 *   一律 `--chart-1-soft`。不按「好/坏」上色——节约涂绿会让人以为那是承诺。
 * - **不持久化**：离开页面即回到初始假设。沙盘不是设置，不该悄悄带着上次的
 *   假设影响下一次阅读。
 */

const VIEW_WIDTH = 520;
const VIEW_HEIGHT = 180;
const BAR_WIDTH = 56;
const BAR_GAP = 24;
const PLOT_TOP = 10;
const PLOT_BOTTOM = 130;
const LABEL_Y = 148;
const BAR_COUNT = 5;
const START_X = (VIEW_WIDTH - (BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP)) / 2;

type Props = {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  plan?: PlanSelection;
  onOpenSession?: (session: SessionMeta) => void;
};

function clampedPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function deltaText(delta: number): string {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.005) return "0";
  return delta < 0 ? `−${formatUsd(-delta)}` : `+${formatUsd(delta)}`;
}

export function CostSandboxPanel({ inputs, days, now }: Props) {
  const fontScale = useFontScale();
  const baseline = useMemo(() => buildSandboxBaseline(inputs, days, now), [inputs, days, now]);
  const defaults = useMemo(() => initialLevers(baseline), [baseline]);

  // 覆盖值是「用户推过这一杆」的唯一状态；区间变化时由钳制自动落回合法范围，
  // 不需要 effect 同步。重置 = 清空覆盖，回到初始假设（不是归零）。
  const [cacheOverride, setCacheOverride] = useState<number | null>(null);
  const [takeoverOverride, setTakeoverOverride] = useState<number | null>(null);
  const [outputOverride, setOutputOverride] = useState<number | null>(null);

  const cacheFloor = cacheHitFloorPct(baseline);
  const cacheDisabled = cacheFloor >= MAX_CACHE_HIT_PCT;
  const cachePct = clampedPct(
    cacheOverride ?? defaults.cacheHitPct,
    cacheFloor,
    MAX_CACHE_HIT_PCT
  );
  const takeoverPct = clampedPct(takeoverOverride ?? defaults.takeoverPct, 0, MAX_TAKEOVER_PCT);
  const outputPct = clampedPct(outputOverride ?? defaults.outputCutPct, 0, MAX_OUTPUT_CUT_PCT);

  const result = useMemo(
    () =>
      simulateSandbox(baseline, {
        cacheHitPct: cachePct,
        takeoverPct,
        outputCutPct: outputPct
      }),
    [baseline, cachePct, takeoverPct, outputPct]
  );

  const reset = () => {
    setCacheOverride(null);
    setTakeoverOverride(null);
    setOutputOverride(null);
  };

  const noModel = baseline.callsPriced === 0 || baseline.currentUsd <= 0;

  if (noModel) {
    return (
      <Panel
        title="成本沙盘"
        ariaLabel="成本沙盘"
        titleAs="h3"
        actions={<ProvenanceBadge provenance="estimated" />}
      >
        <div data-probe="lab-sandbox">
          <EmptyState size="inline" title="所选范围内没有可建模的消耗" />
          <p className={styles.footnote}>
            {baseline.callsUnpriced > 0
              ? `有 ${baseline.callsUnpriced} 次调用因模型未定价无法建模；未定价的调用不会被摊到别的调用上。`
              : "只有带 usage 且模型可定价的调用才能进入沙盘。"}
          </p>
        </div>
      </Panel>
    );
  }

  const maxUsd = Math.max(result.currentUsd, 1e-6);
  const yOf = (value: number) =>
    PLOT_BOTTOM - (Math.max(0, value) / maxUsd) * (PLOT_BOTTOM - PLOT_TOP);
  const centerOf = (index: number) => START_X + index * (BAR_WIDTH + BAR_GAP) + BAR_WIDTH / 2;

  const cheapestName = baseline.cheapestLabel ?? "最便宜的已定价模型";
  const summary = [
    `成本沙盘：当前 ${formatUsd(result.currentUsd)}`,
    cacheDisabled
      ? `缓存命中率保持 ${cachePct}%`
      : `把缓存命中率提到 ${cachePct}%`,
    `${takeoverPct}% 调用改用 ${cheapestName}`,
    `输出削减 ${outputPct}%`,
    `假设成本 ${formatUsd(result.hypotheticalUsd)}`
  ].join("；");
  const gapNote =
    baseline.callsUnpriced > 0
      ? `另有 ${baseline.callsUnpriced} 次调用因模型未定价未参与建模。`
      : "";

  return (
    <Panel
      title="成本沙盘"
      ariaLabel="成本沙盘"
      titleAs="h3"
      actions={
        <div className={styles.actions}>
          <ProvenanceBadge provenance="estimated" />
          <Button type="button" variant="secondary" onClick={reset}>
            重置
          </Button>
        </div>
      }
    >
      <div className={styles.root} data-probe="lab-sandbox">
        <div className={styles.readout} data-probe="sandbox-readout">
          <span className={styles.readoutItem}>
            <span className={styles.readoutLabel}>现状</span>
            <span className={styles.readoutValue} data-probe="sandbox-current">
              {formatUsd(result.currentUsd)}
            </span>
          </span>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          <span className={styles.readoutItem}>
            <span className={styles.readoutLabel}>假设</span>
            <span className={styles.readoutValue} data-probe="sandbox-hypothetical">
              {formatUsd(result.hypotheticalUsd)}
            </span>
          </span>
          <span className={styles.assumptionTag}>假设推演 · 不写回设置</span>
        </div>

        <div
          className={`${styles.sliders} ${fontScale > 1.2 ? styles.comfortable : ""}`}
        >
          <label className={styles.sliderRow}>
            <span className={styles.sliderLabel}>目标缓存命中率</span>
            <input
              className={styles.range}
              type="range"
              min={cacheFloor}
              max={MAX_CACHE_HIT_PCT}
              step={1}
              value={cachePct}
              disabled={cacheDisabled}
              aria-label="目标缓存命中率"
              aria-valuetext={`目标缓存命中率 ${cachePct}%`}
              onChange={(event) => setCacheOverride(Number(event.target.value))}
            />
            <span className={styles.sliderValue}>
              {cacheDisabled ? "已在上限" : `${cachePct}%`}
            </span>
          </label>

          <label className={styles.sliderRow}>
            <span className={styles.sliderLabel}>便宜模型接管</span>
            <input
              className={styles.range}
              type="range"
              min={0}
              max={MAX_TAKEOVER_PCT}
              step={1}
              value={takeoverPct}
              aria-label="便宜模型接管比例"
              aria-valuetext={`便宜模型接管比例 ${takeoverPct}%`}
              onChange={(event) => setTakeoverOverride(Number(event.target.value))}
            />
            <span className={styles.sliderValue}>{takeoverPct}%</span>
          </label>

          <label className={styles.sliderRow}>
            <span className={styles.sliderLabel}>输出削减</span>
            <input
              className={styles.range}
              type="range"
              min={0}
              max={MAX_OUTPUT_CUT_PCT}
              step={1}
              value={outputPct}
              aria-label="输出削减比例"
              aria-valuetext={`输出削减比例 ${outputPct}%`}
              onChange={(event) => setOutputOverride(Number(event.target.value))}
            />
            <span className={styles.sliderValue}>{outputPct}%</span>
          </label>
        </div>

        <svg
          className={primitives.chart}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`${summary}。${gapNote}`}
          data-probe="sandbox-waterfall"
        >
          {result.steps.map((step, index) => {
            const center = centerOf(index);
            const x = center - BAR_WIDTH / 2;
            if (index === 0 || index === 4) {
              // 现状与假设都是「落地的柱」：从基线长到读数。
              const top = yOf(step.usd);
              const height = Math.max(1, PLOT_BOTTOM - top);
              return (
                <g key={step.key} data-probe={`sandbox-bar-${step.key}`}>
                  <rect
                    x={x}
                    y={top}
                    width={BAR_WIDTH}
                    height={height}
                    className={index === 0 ? styles.baselineBar : styles.hypotheticalBar}
                  />
                  <text x={center} y={Math.max(10, top - 4)} textAnchor="middle" className={styles.valueText}>
                    {formatUsd(step.usd)}
                  </text>
                  <text x={center} y={LABEL_Y} textAnchor="middle" className={primitives.tickText}>
                    {step.label}
                  </text>
                </g>
              );
            }
            const previous = result.steps[index - 1];
            const previousTop = yOf(previous.usd);
            const top = yOf(step.usd);
            const height = Math.max(1, previousTop - top);
            return (
              <g key={step.key} data-probe={`sandbox-bar-${step.key}`}>
                <rect
                  x={x}
                  y={top}
                  width={BAR_WIDTH}
                  height={height}
                  className={styles.hypotheticalBar}
                />
                <text
                  x={center}
                  y={Math.max(10, previousTop - 4)}
                  textAnchor="middle"
                  className={styles.valueText}
                >
                  {deltaText(step.delta)}
                </text>
                <text x={center} y={LABEL_Y} textAnchor="middle" className={primitives.tickText}>
                  {step.label}
                </text>
              </g>
            );
          })}
        </svg>

        <p className={styles.footnote}>
          全部是假设推演，不写回任何设置；顺序为缓存 → 换模 → 输出。缓存增益按目标命中率重算
          cacheRead 与 cacheCreation，换模按本窗口最便宜的已定价模型折算，结果仍是估算。
          {baseline.callsUnpriced > 0
            ? `另有 ${baseline.callsUnpriced} 次调用因模型未定价不参与建模。`
            : ""}
        </p>
      </div>
    </Panel>
  );
}
