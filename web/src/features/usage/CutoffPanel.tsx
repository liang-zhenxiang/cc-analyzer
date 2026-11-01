import { useId, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatTokenCount } from "../../lib/format";
import type { HourlyTokens } from "./cutoffProjection";
import { projectCutoff } from "./cutoffProjection";
import { ProvenanceBadge } from "./ProvenanceBadge";
import styles from "./CutoffPanel.module.css";

/**
 * H2「收工推演」：一根 1–24 点的滑杆 + 三个读数。
 *
 * 三条硬规则（design §4.2）：
 * - 只吃 `hourlyTokens`（记录实际发生的小时）。字段缺失时显示空态，**不**
 *   退回「按消息条数折算」——那条换算没有任何依据。
 * - 滑杆范围 1–24：`projectCutoff` 把 `<= 0` 当「不砍」，给用户 0 会得到
 *   与意图相反的读数；24 才是「不收工」。
 * - 实测/推演两种画法：推演读数用 `--chart-1` 并挂 `estimated` 徽章，不涂绿
 *   ——省下来的量是假设，不是承诺。
 */

const DEFAULT_HOUR = 17;
const MIN_SAMPLE_DAYS = 3;

export function CutoffPanel({
  hourlyTokens,
  days,
  sampleDays,
  scanning = false
}: {
  hourlyTokens?: readonly HourlyTokens[];
  days: number;
  /** 窗口内有逐小时读数的天数：低于 3 天时不给滑杆（样本太少，推演会晃）。 */
  sampleDays: number;
  scanning?: boolean;
}) {
  const [hour, setHour] = useState(DEFAULT_HOUR);
  const sliderId = useId();

  const unavailable = hourlyTokens === undefined;
  const empty = hourlyTokens !== undefined && hourlyTokens.length === 0;
  const thin = !unavailable && !empty && sampleDays < MIN_SAMPLE_DAYS;
  const projection =
    unavailable || empty || thin ? null : projectCutoff(hourlyTokens, hour);

  const valueText = hour >= 24 ? "不收工" : `${hour}:00`;

  return (
    <Panel
      title="收工推演"
      ariaLabel="收工推演"
      actions={<ProvenanceBadge provenance="estimated" />}
    >
      <div className={styles.cutoff} data-probe="cutoff">
        {unavailable ? (
          <>
            <EmptyState size="inline" title="这条会话没有逐小时读数" />
            <p className={styles.note}>
              逐小时读数来自记录自身的 usage。缺了它就没有「几点之后不再工作」的分母，这里不会按消息条数折算。
            </p>
          </>
        ) : empty ? (
          <>
            <EmptyState size="inline" title="小时分布算不出来，先刷新试试" />
            <p className={styles.note}>扫描完成后会重新汇总；这一版没有缓存旧的分布。</p>
          </>
        ) : thin ? (
          <>
            <EmptyState
              size="inline"
              title={`过去 ${days} 天只有 ${sampleDays} 天有逐小时读数，先攒够 ${MIN_SAMPLE_DAYS} 天再看推演`}
            />
            <p className={styles.note}>
              少于 {MIN_SAMPLE_DAYS} 天的分布会把一次熬夜当成「每天都这样」。
            </p>
          </>
        ) : (
          <>
            <div className={styles.cutoffRow}>
              <label className={styles.cutoffLabel} htmlFor={sliderId}>
                每天几点收工
              </label>
              <input
                id={sliderId}
                className={styles.cutoffSlider}
                type="range"
                min={1}
                max={24}
                step={1}
                value={hour}
                disabled={scanning}
                data-probe="cutoff-slider"
                aria-valuetext={hour >= 24 ? "不收工" : `每天 ${hour} 点收工`}
                onChange={(event) => setHour(Number(event.target.value))}
              />
              <span className={styles.cutoffValue} data-probe="cutoff-hour">
                {/* 扫描中读数还没站稳：字先留在原位，滑杆禁用，避免「推演了一个旧数」。 */}
                {scanning ? "正在汇总小时分布" : valueText}
              </span>
            </div>

            {projection ? (
              <dl className={styles.cutoffResult} data-probe="cutoff-result">
                <div>
                  <dt>保留 tokens</dt>
                  <dd>{formatTokenCount(projection.keptTokens)}</dd>
                </div>
                <div>
                  <dt>会少用</dt>
                  <dd>{formatTokenCount(projection.cutTokens)}</dd>
                </div>
                <div>
                  <dt>占总用量</dt>
                  <dd>{(projection.cutShare * 100).toFixed(1)}%</dd>
                </div>
              </dl>
            ) : (
              <p className={styles.note}>这一档没有可推演的读数。</p>
            )}

            <p className={styles.note}>
              {`按过去 ${days} 天「每小时 token 分布」推演，不是预测；预测不到的时段按 0 计。`}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
