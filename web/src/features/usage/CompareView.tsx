import { useMemo, type CSSProperties, type ReactNode } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import {
  formatDuration,
  formatDurationCompact,
  formatModelId,
  formatProjectPath,
  formatTokenCount,
  formatUsd
} from "../../lib/format";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { cappedAxisTicks } from "./charts/BarChart";
import { GridLine, formatAxisValue, niceAxisMax } from "./charts/chartPrimitives";
import primitiveStyles from "./charts/chartPrimitives.module.css";
import { usageTokens } from "./projectArena";
import { estimateCost } from "./pricingSnapshot";
import {
  addLocalDays,
  dayStartOf,
  UNKNOWN_MODEL_LABEL,
  type UsageSessionInput
} from "./usageAggregations";
import {
  compareStats,
  modelDistribution,
  projectDistribution,
  rangesOverlap,
  statsForRange,
  type CompareMetric,
  type CompareRange,
  type DistributionRow,
  type RangeStats
} from "./compareRanges";
import styles from "./CompareView.module.css";

/**
 * 「对照」视图（Issue #377）：两个本地自然日区间并排比较。
 *
 * 纯数据全部来自 `compareRanges.ts`（区间数学、读数、差值、分布），这一层只做
 * 排版与呈现口径：
 * - 差值**逐项**声明方向：只有估算成本是「涨红跌绿」，其余指标上涨/下跌都不
 *   带褒贬（token 涨可能只是活干得多）。
 * - 重叠优先于空态：两段区间重叠时结果区只出提示，不出表格与图。
 * - 分布两段各算一次占比，颜色映射建在两段模型的**并集**上，两行共用。
 * - 日趋势的横轴是「区间内第 N 天」，不是日历日期——两段区间不重叠，按日期
 *   叠两条线会永远错开。
 */

/** A 的预设档位（字符串是为了直接喂给 `SegmentedControl`）。 */
export const COMPARE_A_OPTIONS = ["7", "30", "90"] as const;
export type CompareAPreset = (typeof COMPARE_A_OPTIONS)[number];

/** B 的预设档位：比 A 多一个「上一个等长区间」。 */
export const COMPARE_B_OPTIONS = ["7", "30", "90", "previous"] as const;
export type CompareBPreset = (typeof COMPARE_B_OPTIONS)[number];

const A_ITEMS: SegmentedItem<CompareAPreset>[] = COMPARE_A_OPTIONS.map((value) => ({
  value,
  label: `近 ${value} 天`
}));

const B_ITEMS: SegmentedItem<CompareBPreset>[] = [
  ...COMPARE_A_OPTIONS.map((value) => ({ value: value as CompareBPreset, label: `近 ${value} 天` })),
  { value: "previous", label: "上一个等长区间" }
];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `11-16`（表头第二行 / 重叠提示用，不带年份）。 */
function monthDay(ms: number): string {
  const date = new Date(ms);
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** `2026-11-16`（完整年月日，进 title 与图例）。 */
function isoDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function rangeStartOf(range: CompareRange): number {
  return dayStartOf(range.startDay);
}

function rangeDaysOf(range: CompareRange): number {
  return Math.max(1, Math.floor(range.days));
}

/** 表头第二行：`11-16 ~ 11-22`。 */
function shortRangeLabel(range: CompareRange): string {
  const start = rangeStartOf(range);
  return `${monthDay(start)} ~ ${monthDay(addLocalDays(start, rangeDaysOf(range) - 1))}`;
}

/** 图例 / 区间结果：`2026-11-16 ~ 2026-11-22`。 */
function fullRangeLabel(range: CompareRange): string {
  const start = rangeStartOf(range);
  return `${isoDate(start)} ~ ${isoDate(addLocalDays(start, rangeDaysOf(range) - 1))}`;
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function signedNumber(value: number, format: (magnitude: number) => string): string {
  return `${value >= 0 ? "+" : "−"}${format(Math.abs(value))}`;
}

/**
 * 一段区间里「已定价金额 + 未定价会话数 + 未定价 token」。
 *
 * `statsForRange` 在出现未定价会话时把整段金额记为 `null`（不做部分求和），
 * 但并排读数需要在成本值后挂 `†` 并在脚注里写清排除了多少 token。这里按同一
 * 口径（整条会话要么全部计价、要么整体退出）重新折一次，只用于展示。
 */
function costDetailForRange(
  inputs: readonly UsageSessionInput[],
  range: CompareRange,
  now: number
): { usd: number; unpricedSessions: number; unpricedTokens: number } {
  const start = rangeStartOf(range);
  const end = Math.min(
    addLocalDays(start, rangeDaysOf(range)),
    addLocalDays(dayStartOf(now), 1)
  );
  let usd = 0;
  let unpricedSessions = 0;
  let unpricedTokens = 0;

  for (const input of inputs) {
    const records = input.records.filter(
      (record) => record.timestamp >= start && record.timestamp < end
    );
    if (records.length === 0) continue;

    let sessionUsd = 0;
    let sessionTokens = 0;
    let unpriced = false;
    for (const record of records) {
      const usage = record.usage;
      if (!usage) continue;
      sessionTokens += usageTokens(usage);
      const estimate = estimateCost(
        {
          input: usage.inputTokens ?? 0,
          output: usage.outputTokens ?? 0,
          cacheCreation: usage.cacheCreationTokens ?? 0,
          cacheRead: usage.cacheReadTokens ?? 0
        },
        record.model ?? UNKNOWN_MODEL_LABEL
      );
      if ("unknownModel" in estimate) unpriced = true;
      else sessionUsd += estimate.usd;
    }
    if (unpriced) {
      unpricedSessions += 1;
      unpricedTokens += sessionTokens;
    } else {
      usd += sessionUsd;
    }
  }

  return { usd, unpricedSessions, unpricedTokens };
}

/** 每天的「四类 token 之和」，长度 = 区间天数，按本地自然日下标对齐。 */
function dailyTokensForRange(
  inputs: readonly UsageSessionInput[],
  range: CompareRange,
  now: number
): number[] {
  const days = rangeDaysOf(range);
  const start = rangeStartOf(range);
  const todayEnd = addLocalDays(dayStartOf(now), 1);
  const totals = new Array<number>(days).fill(0);

  for (const input of inputs) {
    for (const record of input.records) {
      if (!record.usage) continue;
      if (record.timestamp < start || record.timestamp >= todayEnd) continue;
      const index = Math.round((dayStartOf(record.timestamp) - start) / 86_400_000);
      if (index >= 0 && index < days) totals[index] += usageTokens(record.usage);
    }
  }
  return totals;
}

/** 差值的呈现语义：`up-bad` 只有估算成本。 */
type DeltaTone = "up" | "down" | "flat" | "none";

function deltaTone(deltaPct: number | null): { text: string; tone: DeltaTone } {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return { text: "—", tone: "none" };
  const rounded = Math.round(deltaPct);
  if (rounded === 0) return { text: "持平", tone: "flat" };
  if (rounded > 0) return { text: `+${rounded}%`, tone: "up" };
  // U+2212 真减号：连字符在等宽表里比数字短一截，读起来像两个记号。
  return { text: `−${Math.abs(rounded)}%`, tone: "down" };
}

function deltaVerb(tone: DeltaTone): string {
  switch (tone) {
    case "up":
      return "增加";
    case "down":
      return "减少";
    case "flat":
      return "持平";
    default:
      return "无法计算";
  }
}

function arrowOf(tone: DeltaTone): ReactNode {
  if (tone !== "up" && tone !== "down") return null;
  return (
    <span className={styles.arrow} aria-hidden="true">
      {tone === "up" ? "▲" : "▼"}
    </span>
  );
}

/** 差值格：逐项声明 `direction`，中性行不染色。 */
function DeltaCell({
  deltaPct,
  direction,
  title
}: {
  deltaPct: number | null;
  direction: CompareMetric["direction"];
  title: string;
}) {
  const { text, tone } = deltaTone(deltaPct);
  const accessible =
    deltaPct === null
      ? `A 比 B ${deltaVerb(tone)}`
      : `A 比 B ${deltaVerb(tone)} ${Math.abs(Math.round(deltaPct))}%`;
  return (
    <td
      className={styles.deltaCell}
      data-direction={direction}
      data-tone={tone}
      title={title}
      aria-label={accessible}
    >
      {arrowOf(tone)}
      <span className={styles.deltaValue}>{text}</span>
    </td>
  );
}

function RangePicker<T extends string>({
  label,
  range,
  preset,
  items,
  onChange,
  ariaLabel
}: {
  label: string;
  range: CompareRange;
  preset: T;
  items: SegmentedItem<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className={styles.rangeColumn}>
      <span className={styles.rangeLabel}>{label}</span>
      <SegmentedControl
        items={items}
        value={preset}
        onChange={onChange}
        ariaLabel={ariaLabel}
        role="radiogroup"
      />
      <span className={styles.rangeResult}>
        {fullRangeLabel(range)} · {rangeDaysOf(range)} 天
      </span>
    </div>
  );
}

function RangePanel({
  rangeA,
  rangeB,
  presetA,
  presetB,
  onChangeA,
  onChangeB
}: {
  rangeA: CompareRange;
  rangeB: CompareRange;
  presetA: CompareAPreset;
  presetB: CompareBPreset;
  onChangeA: (preset: CompareAPreset) => void;
  onChangeB: (preset: CompareBPreset) => void;
}) {
  return (
    <Panel title="对照区间" ariaLabel="对照区间">
      <div className={styles.rangeGrid} data-probe="compare-ranges">
        <RangePicker
          label="区间 A"
          range={rangeA}
          preset={presetA}
          items={A_ITEMS}
          onChange={onChangeA}
          ariaLabel="区间 A 的预设"
        />
        <RangePicker
          label="区间 B"
          range={rangeB}
          preset={presetB}
          items={B_ITEMS}
          onChange={onChangeB}
          ariaLabel="区间 B 的预设"
        />
      </div>
    </Panel>
  );
}

function OverlapNotice({ rangeA, rangeB }: { rangeA: CompareRange; rangeB: CompareRange }) {
  const startA = rangeStartOf(rangeA);
  const endA = addLocalDays(startA, rangeDaysOf(rangeA));
  const startB = rangeStartOf(rangeB);
  const endB = addLocalDays(startB, rangeDaysOf(rangeB));
  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endA, endB);
  const overlapDays = Math.max(0, Math.round((overlapEnd - overlapStart) / 86_400_000));
  const identical =
    overlapDays === rangeDaysOf(rangeA) && rangeDaysOf(rangeA) === rangeDaysOf(rangeB);
  const overlapLabel = `${monthDay(overlapStart)} ~ ${monthDay(addLocalDays(overlapEnd, -1))}`;

  return (
    <div className={styles.overlapNotice} data-probe="compare-overlap" role="status">
      <p className={styles.overlapTitle}>两段区间重叠，无法对照</p>
      <p className={styles.overlapBody}>
        {identical
          ? "两个区间完全重合——同一段时间跟自己比没有意义。换一个区间再比。"
          : `对照的是两段不同的时间：把 B 移到 A 之外，或改短其中一个区间。当前重叠 ${overlapDays} 天（${overlapLabel}）。`}
      </p>
    </div>
  );
}

function ReadoutsTable({
  statsA,
  statsB,
  costA,
  costB,
  rangeA,
  rangeB
}: {
  statsA: RangeStats;
  statsB: RangeStats;
  costA: ReturnType<typeof costDetailForRange>;
  costB: ReturnType<typeof costDetailForRange>;
  rangeA: CompareRange;
  rangeB: CompareRange;
}) {
  const metrics = useMemo(() => compareStats(statsA, statsB), [statsA, statsB]);
  const lengthsDiffer = rangeDaysOf(rangeA) !== rangeDaysOf(rangeB);
  const aEmpty = statsA.sessions === 0;
  const bEmpty = statsB.sessions === 0;

  return (
    <Panel
      title="并排读数"
      ariaLabel="并排读数"
      actions={<ProvenanceBadge provenance="estimated" detail="成本按定价快照估算" />}
    >
      {lengthsDiffer ? (
        <p className={styles.lengthHint} data-probe="compare-length-hint">
          两段区间长度不同（A {rangeDaysOf(rangeA)} 天 / B {rangeDaysOf(rangeB)}{" "}
          天）：计数类指标比的是区间总量，不是日均。
        </p>
      ) : null}
      <table className={styles.readoutTable} data-probe="compare-readouts">
        <thead>
          <tr>
            <th scope="col" className={styles.metricHead}>
              <span className={styles.srOnly}>指标</span>
            </th>
            <th scope="col" className={styles.valueHead}>
              区间 A
            </th>
            <th scope="col" className={styles.valueHead}>
              区间 B
            </th>
            <th scope="col" className={styles.deltaHead} title="（A − B）÷ B">
              差值
            </th>
          </tr>
          <tr>
            <td className={styles.metricHead} aria-hidden="true" />
            <td className={styles.dateCell} title={fullRangeLabel(rangeA)}>
              {shortRangeLabel(rangeA)}
            </td>
            <td className={styles.dateCell} title={fullRangeLabel(rangeB)}>
              {shortRangeLabel(rangeB)}
            </td>
            <td className={styles.metricHead} aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {READOUT_ROWS.map((row) => {
            const metric = metrics.find((candidate) => candidate.key === row.key)!;
            // 估算成本：未定价会话整条退出成本，值后挂 †（脚注见下）；其余行照常。
            const valueFor = (side: "a" | "b") => {
              if (row.key !== "usd") return row.format(metric[side]);
              const cost = side === "a" ? costA : costB;
              return (
                <>
                  {formatUsd(cost.usd)}
                  {cost.unpricedSessions > 0 ? <span className={styles.dagger}> †</span> : null}
                </>
              );
            };
            const diffTitle =
              row.key === "usd"
                ? `绝对差 ${
                    metric.a === null || metric.b === null
                      ? "—"
                      : signedNumber(metric.a - metric.b, (magnitude) => `$${magnitude.toFixed(2)}`)
                  }`
                : row.key === "avgSessionMs"
                  ? `绝对差 ${
                      metric.a === null || metric.b === null
                        ? "—"
                        : signedNumber(metric.a - metric.b, formatDuration)
                    }`
                  : `绝对差 ${
                      metric.a === null || metric.b === null
                        ? "—"
                        : signedNumber(metric.a - metric.b, (magnitude) =>
                            magnitude.toLocaleString("en-US")
                          )
                    }`;
            return (
              <tr key={row.key} data-probe="compare-readout-row" data-metric={row.key}>
                <th scope="row" className={styles.metric}>
                  {row.label}
                </th>
                <td className={`${styles.value} ${styles.valuePrimary}`}>{valueFor("a")}</td>
                <td className={`${styles.value} ${styles.valueMuted}`}>{valueFor("b")}</td>
                <DeltaCell
                  deltaPct={metric.deltaPct}
                  direction={metric.direction}
                  title={diffTitle}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
      {aEmpty && !bEmpty ? (
        <p className={styles.note} data-probe="compare-empty-a">
          区间 A 内没有记录：读数按 0 计，差值以 B 为基线。
        </p>
      ) : null}
      {!aEmpty && bEmpty ? (
        <p className={styles.note} data-probe="compare-empty-b">
          区间 B 内没有记录，差值没有基线；只显示 A 的读数。
        </p>
      ) : null}
      {costA.unpricedSessions > 0 ? (
        <p className={styles.footnote} data-probe="compare-unpriced-a">
          † 区间 A 另有 {costA.unpricedSessions} 个会话未定价（
          {formatTokenCount(costA.unpricedTokens)} token），未计入成本。
        </p>
      ) : null}
      {costB.unpricedSessions > 0 ? (
        <p className={styles.footnote} data-probe="compare-unpriced-b">
          † 区间 B 另有 {costB.unpricedSessions} 个会话未定价（
          {formatTokenCount(costB.unpricedTokens)} token），未计入成本。
        </p>
      ) : null}
      <p className={styles.footnote}>
        差值 =（A − B）÷ B；B 为 0 时只给绝对差，两侧都缺失写「—」。Token 总量 = 输入 +
        输出 + 缓存写入 + 缓存读取；消息数只数 user / assistant（压缩摘要不算）。
      </p>
    </Panel>
  );
}

/** 读数的顺序与格式化。`null` 是「没有样本」，绝不印成 0。 */
const READOUT_ROWS: ReadonlyArray<{
  key: CompareMetric["key"];
  label: string;
  format: (value: number | null) => string;
}> = [
  { key: "sessions", label: "会话数", format: (value) => (value ?? 0).toLocaleString("en-US") },
  { key: "messages", label: "消息数", format: (value) => (value ?? 0).toLocaleString("en-US") },
  { key: "tokens", label: "Token 总量", format: (value) => formatTokenCount(value ?? 0) },
  { key: "usd", label: "估算成本", format: (value) => (value === null ? "—" : formatUsd(value)) },
  { key: "activeDays", label: "活跃天数", format: (value) => (value ?? 0).toLocaleString("en-US") },
  {
    key: "avgSessionMs",
    label: "平均会话时长",
    format: (value) => (value === null ? "—" : formatDurationCompact(value))
  }
];

function ShareCell({ share, side }: { share: number; side: "a" | "b" }) {
  if (share <= 0) return <span className={styles.missing}>—</span>;
  return (
    <span className={styles.shareCellInner}>
      <span className={styles.shareTrack} aria-hidden="true">
        <span className={styles.shareFill} data-side={side} style={{ width: `${share * 100}%` }} />
      </span>
      <span className={styles.shareValue}>{percent(share)}</span>
    </span>
  );
}

function ProjectComparePanel({
  rows,
  projectPaths
}: {
  rows: DistributionRow[];
  projectPaths: ReadonlyMap<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <Panel title="按项目对照" ariaLabel="按项目对照">
        <EmptyState size="panel" title="所选区间内没有可归因到项目的 token" />
      </Panel>
    );
  }

  return (
    <Panel title="按项目对照" ariaLabel="按项目对照">
      <table className={styles.projectTable} data-probe="compare-projects">
        <thead>
          <tr>
            <th scope="col" className={styles.projectNameHead}>
              <span className={styles.srOnly}>项目</span>
            </th>
            <th scope="col" className={styles.shareHead}>
              A 占比
            </th>
            <th scope="col" className={styles.shareHead}>
              B 占比
            </th>
            <th scope="col" className={styles.projectDeltaHead}>
              差值
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const shareDelta =
              row.bShare === 0 ? null : ((row.aShare - row.bShare) / row.bShare) * 100;
            const path = projectPaths.get(row.key);
            const label = formatProjectPath(row.key, path);
            return (
              <tr key={row.key} data-probe="compare-project-row">
                <th scope="row" className={styles.projectName} title={path ?? row.label}>
                  <span className={styles.projectNameInner}>
                    <span className={styles.projectNameText}>{label}</span>
                    {row.onlyIn ? (
                      <span className={styles.onlyBadge}>
                        {row.onlyIn === "a" ? "仅 A" : "仅 B"}
                      </span>
                    ) : null}
                  </span>
                </th>
                <td className={styles.shareCell}>
                  <ShareCell share={row.aShare} side="a" />
                </td>
                <td className={styles.shareCell}>
                  <ShareCell share={row.bShare} side="b" />
                </td>
                <DeltaCell
                  deltaPct={shareDelta}
                  direction="neutral"
                  title={`占比绝对差 ${signedNumber(
                    (row.aShare - row.bShare) * 100,
                    (magnitude) => `${magnitude.toFixed(1)}pp`
                  )}`}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.footnote}>
        占比的分母是各自区间的 token 总量；只在一边出现时另一侧写「—」。
      </p>
    </Panel>
  );
}

/** 模型堆叠条的一段：颜色映射建在两段并集上，两行共用。 */
type ModelSegment = {
  key: string;
  label: string;
  aShare: number;
  bShare: number;
  index: number | "other";
};

function ModelComparePanel({ rows }: { rows: DistributionRow[] }) {
  const segments = useMemo<ModelSegment[]>(() => {
    const top: ModelSegment[] = rows.slice(0, 5).map((row, index) => ({
      key: row.key,
      label: row.label,
      aShare: row.aShare,
      bShare: row.bShare,
      index: index + 1
    }));
    const rest = rows.slice(5);
    if (rest.length > 0) {
      const aShare = rest.reduce((sum, row) => sum + row.aShare, 0);
      const bShare = rest.reduce((sum, row) => sum + row.bShare, 0);
      if (aShare + bShare > 0) {
        top.push({ key: "其他", label: "其他", aShare, bShare, index: "other" });
      }
    }
    return top;
  }, [rows]);

  if (segments.length === 0) {
    return (
      <Panel title="按模型对照" ariaLabel="按模型对照">
        <EmptyState size="panel" title="所选区间内没有模型读数" />
      </Panel>
    );
  }

  const totalA = segments.reduce((sum, segment) => sum + segment.aShare, 0);
  const totalB = segments.reduce((sum, segment) => sum + segment.bShare, 0);

  // 颜色映射在建 segments 时排一次，两行与图例共用同一份 `--segment-*`。
  const styleOf = (index: number | "other"): CSSProperties =>
    index === "other"
      ? ({ "--segment-fill": "var(--bg-active)", "--segment-stroke": "var(--border-strong)" } as CSSProperties)
      : ({
          "--segment-fill": `var(--chart-${index}-soft)`,
          "--segment-stroke": `var(--chart-${index})`
        } as CSSProperties);

  return (
    <Panel title="按模型对照" ariaLabel="按模型对照">
      <div className={styles.modelRows} data-probe="compare-models">
        {(["a", "b"] as const).map((side) => {
          const total = side === "a" ? totalA : totalB;
          return (
            <div className={styles.modelRow} key={side} data-side={side} data-probe="compare-model-row">
              <span className={styles.modelRowLabel}>区间 {side.toUpperCase()}</span>
              {total > 0 ? (
                <div
                  className={styles.modelBar}
                  role="img"
                  aria-label={`区间 ${side.toUpperCase()} 的模型构成`}
                >
                  {segments.map((segment) => (
                    <span
                      key={segment.key}
                      className={styles.modelSegment}
                      data-model={segment.key}
                      data-color={segment.index}
                      style={{
                        ...styleOf(segment.index),
                        width: `${(side === "a" ? segment.aShare : segment.bShare) * 100}%`
                      }}
                      title={`${formatModelId(segment.label)}：${percent(
                        side === "a" ? segment.aShare : segment.bShare
                      )}`}
                    />
                  ))}
                </div>
              ) : (
                <span className={styles.modelEmpty}>区间 {side.toUpperCase()} 没有模型读数</span>
              )}
            </div>
          );
        })}
      </div>
      <ul className={styles.modelLegend}>
        {segments.map((segment) => (
          <li key={segment.key} data-probe="compare-model-legend">
            <span
              className={styles.modelSwatch}
              data-color={segment.index}
              style={styleOf(segment.index)}
            />
            <span className={styles.modelName} title={segment.label}>
              {formatModelId(segment.label)}
            </span>
            <span className={styles.modelShare}>
              A {percent(segment.aShare)} · B {percent(segment.bShare)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const TREND_WIDTH = 720;
const TREND_HEIGHT = 170;
const TREND_PAD_LEFT = 56;
const TREND_PAD_RIGHT = 10;
const TREND_PAD_TOP = 12;
const TREND_PAD_BOTTOM = 26;
const TREND_PLOT_WIDTH = TREND_WIDTH - TREND_PAD_LEFT - TREND_PAD_RIGHT;
const TREND_PLOT_HEIGHT = TREND_HEIGHT - TREND_PAD_TOP - TREND_PAD_BOTTOM;

/** 横轴最多 7 个「第 N 天」刻度。 */
function xTickIndices(domain: number): number[] {
  if (domain <= 7) return Array.from({ length: domain }, (_, index) => index);
  const indices = new Set<number>();
  for (let step = 0; step < 7; step += 1) {
    indices.add(Math.round((step * (domain - 1)) / 6));
  }
  return [...indices];
}

function TrendComparePanel({
  rangeA,
  rangeB,
  dailyA,
  dailyB,
  statsA,
  statsB
}: {
  rangeA: CompareRange;
  rangeB: CompareRange;
  dailyA: number[];
  dailyB: number[];
  statsA: RangeStats;
  statsB: RangeStats;
}) {
  const domain = Math.max(dailyA.length, dailyB.length);
  const maxValue = niceAxisMax(Math.max(1, ...dailyA, ...dailyB));
  const ticks = cappedAxisTicks(maxValue, 3);
  const slot = domain > 0 ? TREND_PLOT_WIDTH / domain : TREND_PLOT_WIDTH;
  const xAt = (index: number) => TREND_PAD_LEFT + index * slot + slot / 2;
  const yAt = (value: number) =>
    TREND_PAD_TOP + (1 - Math.min(1, Math.max(0, value / maxValue))) * TREND_PLOT_HEIGHT;
  const startA = rangeStartOf(rangeA);
  const startB = rangeStartOf(rangeB);

  const linePoints = (series: number[]) =>
    series.map((value, index) => `${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ");

  return (
    <Panel title="每日趋势对照" ariaLabel="每日趋势对照">
      <ul className={styles.trendLegend} data-probe="compare-trend-legend">
        <li data-side="a">
          <span className={styles.trendLegendMarker} data-side="a" aria-hidden="true">
            ■
          </span>
          <span>
            A · {fullRangeLabel(rangeA)}（{rangeDaysOf(rangeA)} 天）
            {statsA.sessions === 0 ? " · 区间内没有记录（0 token）" : ""}
          </span>
        </li>
        <li data-side="b">
          <span className={styles.trendLegendMarker} data-side="b" aria-hidden="true">
            ┄
          </span>
          <span>
            B · {fullRangeLabel(rangeB)}（{rangeDaysOf(rangeB)} 天）
            {statsB.sessions === 0 ? " · 区间内没有记录（0 token）" : ""}
          </span>
        </li>
      </ul>
      <svg
        viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
        role="img"
        aria-label="每日趋势对照图"
        className={primitiveStyles.chart}
        data-probe="compare-trend"
      >
        {ticks.map((tick) => (
          <GridLine
            key={tick}
            x1={TREND_PAD_LEFT}
            x2={TREND_WIDTH - TREND_PAD_RIGHT}
            y={yAt(tick)}
            label={formatAxisValue(tick)}
            strong={tick === 0}
          />
        ))}
        {xTickIndices(domain).map((index) => (
          <text
            key={`x-${index}`}
            x={xAt(index)}
            y={TREND_HEIGHT - 6}
            textAnchor="middle"
            className={primitiveStyles.tickText}
          >
            {`第 ${index + 1} 天`}
          </text>
        ))}
        {Array.from({ length: domain }, (_, index) => {
          const aText =
            index < dailyA.length
              ? `A ${monthDay(addLocalDays(startA, index))}：${formatTokenCount(dailyA[index])} token`
              : "A 不在区间内";
          const bText =
            index < dailyB.length
              ? `B ${monthDay(addLocalDays(startB, index))}：${formatTokenCount(dailyB[index])} token`
              : "B 不在区间内";
          return (
            <rect
              key={`hit-${index}`}
              x={TREND_PAD_LEFT + index * slot}
              y={TREND_PAD_TOP}
              width={slot}
              height={TREND_PLOT_HEIGHT}
              className={styles.trendHit}
              data-probe="compare-trend-hit"
            >
              <title>{`第 ${index + 1} 天 · ${aText} / ${bText}`}</title>
            </rect>
          );
        })}
        <polyline
          className={styles.trendLineA}
          points={linePoints(dailyA)}
          data-probe="compare-trend-a"
        />
        <polyline
          className={styles.trendLineB}
          points={linePoints(dailyB)}
          data-probe="compare-trend-b"
        />
      </svg>
      <p className={styles.footnote}>
        横轴是各区间内的第 N 天，不是同一天；纵轴是四类 token 之和。
      </p>
    </Panel>
  );
}

export function CompareView({
  inputs,
  now,
  rangeA,
  rangeB,
  presetA,
  presetB,
  onChangeA,
  onChangeB,
  projectPaths
}: {
  inputs: readonly UsageSessionInput[];
  now: number;
  rangeA: CompareRange;
  rangeB: CompareRange;
  presetA: CompareAPreset;
  presetB: CompareBPreset;
  onChangeA: (preset: CompareAPreset) => void;
  onChangeB: (preset: CompareBPreset) => void;
  projectPaths: ReadonlyMap<string, string>;
}) {
  const statsA = useMemo(() => statsForRange(inputs, rangeA, now), [inputs, rangeA, now]);
  const statsB = useMemo(() => statsForRange(inputs, rangeB, now), [inputs, rangeB, now]);
  const costA = useMemo(() => costDetailForRange(inputs, rangeA, now), [inputs, rangeA, now]);
  const costB = useMemo(() => costDetailForRange(inputs, rangeB, now), [inputs, rangeB, now]);
  const dailyA = useMemo(() => dailyTokensForRange(inputs, rangeA, now), [inputs, rangeA, now]);
  const dailyB = useMemo(() => dailyTokensForRange(inputs, rangeB, now), [inputs, rangeB, now]);
  const modelRows = useMemo(
    () => modelDistribution(inputs, rangeA, rangeB, now),
    [inputs, rangeA, rangeB, now]
  );

  // 并集：A 的 Top5 ∪ B 的 Top5。占比用完整分布（limit=Infinity），不是
  // `projectDistribution` 默认的「按合计取前 5」——两个口径在长尾处分叉。
  const projectRows = useMemo(() => {
    const all = projectDistribution(inputs, rangeA, rangeB, now, Number.POSITIVE_INFINITY);
    const topA = [...all].sort((x, y) => y.a - x.a || x.label.localeCompare(y.label)).slice(0, 5);
    const topB = [...all].sort((x, y) => y.b - x.b || x.label.localeCompare(y.label)).slice(0, 5);
    const union = new Set([...topA.map((row) => row.key), ...topB.map((row) => row.key)]);
    return all.filter((row) => union.has(row.key));
  }, [inputs, rangeA, rangeB, now]);

  const overlap = rangesOverlap(rangeA, rangeB);
  const bothEmpty = statsA.sessions === 0 && statsB.sessions === 0;

  return (
    <>
      <RangePanel
        rangeA={rangeA}
        rangeB={rangeB}
        presetA={presetA}
        presetB={presetB}
        onChangeA={onChangeA}
        onChangeB={onChangeB}
      />
      {overlap ? (
        <OverlapNotice rangeA={rangeA} rangeB={rangeB} />
      ) : bothEmpty ? (
        <Panel title="并排读数" ariaLabel="并排读数">
          <EmptyState
            size="panel"
            title="这两个区间都没有记录"
            description="换两个有记录的时间段再对照。A 与 B 不能重叠。"
          />
        </Panel>
      ) : (
        <>
          <ReadoutsTable
            statsA={statsA}
            statsB={statsB}
            costA={costA}
            costB={costB}
            rangeA={rangeA}
            rangeB={rangeB}
          />
          <ProjectComparePanel rows={projectRows} projectPaths={projectPaths} />
          <ModelComparePanel rows={modelRows} />
          <TrendComparePanel
            rangeA={rangeA}
            rangeB={rangeB}
            dailyA={dailyA}
            dailyB={dailyB}
            statsA={statsA}
            statsB={statsB}
          />
        </>
      )}
    </>
  );
}
