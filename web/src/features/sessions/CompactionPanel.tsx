import { useEffect, useMemo, useState } from "react";
import { ProvenanceBadge } from "../usage/ProvenanceBadge";
import { formatAxisValue } from "../usage/charts/chartPrimitives";
import { toRow, triggerLabel } from "./logRows";
import { DroppedList } from "./DroppedList";
import { formatClock, formatDateTime, formatDuration, formatShortStamp } from "../../lib/format";
import type { DroppedBucket } from "./droppedMessages";
import type { CompactionAnchor } from "./contextSeries";
import type { CompactEvent, ContextSample } from "./types";
import styles from "./CompactionPanel.module.css";

// triggerLabel 已上移到 logRows.ts：带行、事件 chip、取证卡与详情面板必须把
// 同一个 trigger 叫成同一个名字（ROW_KIND_LABELS 的同款理由）。
// shortStamp 同理上移到 lib/format.ts（改动文件行与之同一格式，口径同一来源）。

/** 压缩占比：百分比 = (pre − post) / pre。 */
function dropPercent(event: CompactEvent): string | null {
  if (event.preTokens === null || event.postTokens === null || event.preTokens <= 0) return null;
  return `−${(((event.preTokens - event.postTokens) / event.preTokens) * 100).toFixed(1)}%`;
}

/** chip 上的紧凑读数：`167.4K→11.2K`；缺字段时只有 `—`。 */
function compactPair(event: CompactEvent): string {
  if (event.preTokens === null || event.postTokens === null) return "—";
  return `${formatAxisValue(event.preTokens)}→${formatAxisValue(event.postTokens)}`;
}

/** 旧日志缺字段时的降级：`—` 加一句说明，宁可说数据不足，不猜（design §2.6）。 */
function MissingValue() {
  return (
    <>
      —<span className={styles.missingNote}>（该字段此记录未记录）</span>
    </>
  );
}

/**
 * 压缩事件面板体（design §2.3）：一行事件 chip + 取证卡。取证卡左栏是
 * `<dl>` 数字（与 KPI 卡同构、降一级字号），右栏是「被丢出上下文的内容」
 * 清单；它就住在 Panel 里，两栏之间只有一条发丝线，不另套卡。
 */
export function CompactionPanel({
  events,
  anchors,
  samples,
  buckets,
  selectedEventId,
  onSelect,
  onLocateInLog
}: {
  events: CompactEvent[];
  anchors: CompactionAnchor[];
  samples: ContextSample[];
  buckets: Map<string, DroppedBucket>;
  selectedEventId: string | null;
  onSelect: (eventId: string | null) => void;
  onLocateInLog: (recordId: string) => void;
}) {
  const selected =
    selectedEventId === null
      ? null
      : (events.find((event) => event.id === selectedEventId) ?? null);
  const anchor =
    selected === null ? null : (anchors.find((item) => item.eventId === selected.id) ?? null);
  const bucket = selected === null ? null : (buckets.get(selected.id) ?? null);
  const [survivorsOpen, setSurvivorsOpen] = useState(false);

  // 切事件时收起幸存清单：展开态属于具体那次压缩，不跨事件携带。
  useEffect(() => {
    setSurvivorsOpen(false);
  }, [selectedEventId]);

  // 元数据与曲线互证的一致性检查（design §2.3「曲线两侧读数」）。
  const curveReading = useMemo(() => {
    if (!anchor) return null;
    if (anchor.beforeIndex < 0 || anchor.afterIndex >= samples.length) return null;
    return `${formatAxisValue(samples[anchor.beforeIndex].contextTokens)} / ${formatAxisValue(
      samples[anchor.afterIndex].contextTokens
    )}`;
  }, [anchor, samples]);

  const survivorRows = useMemo(
    () => (bucket ? bucket.survivors.map((record) => toRow(record)) : []),
    [bucket]
  );

  const percent = selected === null ? null : dropPercent(selected);
  const droppedThisTime =
    selected !== null && selected.preTokens !== null && selected.postTokens !== null
      ? selected.preTokens - selected.postTokens
      : null;

  return (
    <div className={styles.root}>
      <div className={styles.chipBar} role="group" aria-label="压缩事件选择">
        {events.map((event, index) => {
          const pressed = event.id === selectedEventId;
          return (
            <button
              key={event.id}
              type="button"
              aria-pressed={pressed}
              // data-probe 是仅用于探测的稳定属性（同 Gauge 的 data-probe="gauge"）：
              // chip 的可访问名带具体数字，真机门禁要「点第 k 枚」时靠它才不脆。
              data-probe={`compact-event-${index + 1}`}
              className={pressed ? styles.chipSelected : styles.chip}
              onClick={() => onSelect(pressed ? null : event.id)}
            >
              {`#${index + 1} ${formatShortStamp(event.timestamp)} · ${triggerLabel(event.trigger)} · ${compactPair(event)}`}
            </button>
          );
        })}
      </div>
      {selected ? (
        <div className={styles.card} data-probe="forensic-card">
          <div className={styles.numbers}>
            <h3 className={styles.cardTitle}>
              <span aria-hidden="true">◆</span>
              <span>
                压缩 #{events.indexOf(selected) + 1} · {formatDateTime(selected.timestamp)} ·{" "}
                {triggerLabel(selected.trigger)}
              </span>
              <ProvenanceBadge provenance="logged" />
            </h3>
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>上下文规模</dt>
                <dd>
                  {selected.preTokens !== null && selected.postTokens !== null ? (
                    <>
                      {selected.preTokens.toLocaleString("en-US")}
                      <span className={styles.arrow}> → </span>
                      {selected.postTokens.toLocaleString("en-US")}
                      {percent !== null ? (
                        <span className={styles.factNote}>（{percent}）</span>
                      ) : null}
                    </>
                  ) : (
                    <MissingValue />
                  )}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>曲线两侧读数</dt>
                <dd className={styles.factSub}>{curveReading ?? "—"}</dd>
              </div>
              <div className={styles.fact}>
                <dt>本次丢弃</dt>
                <dd>
                  {droppedThisTime !== null ? (
                    `${droppedThisTime.toLocaleString("en-US")} tok`
                  ) : (
                    <MissingValue />
                  )}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>累计丢弃</dt>
                <dd>
                  {selected.droppedTokens !== null
                    ? `${selected.droppedTokens.toLocaleString("en-US")} tok`
                    : <MissingValue />}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>压缩耗时</dt>
                <dd>
                  {selected.durationMs !== null ? formatDuration(selected.durationMs) : <MissingValue />}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>幸存消息</dt>
                <dd>
                  {selected.survivedUuids.length} / {bucket?.contextCount ?? "—"} 条
                  <button
                    type="button"
                    className={styles.survivorToggle}
                    aria-expanded={survivorsOpen}
                    onClick={() => setSurvivorsOpen((open) => !open)}
                  >
                    {survivorsOpen ? "收起" : "展开"}
                  </button>
                </dd>
              </div>
            </dl>
            {survivorsOpen ? (
              <ul className={styles.survivors}>
                {survivorRows.map((row) => (
                  <li key={row.id} title={`${row.action}${row.summary ? ` · ${row.summary}` : ""}`}>
                    <time>{formatClock(row.timestamp, true)}</time>
                    {row.action}
                    {row.summary ? ` · ${row.summary}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className={styles.listColumn}>
            <DroppedList records={bucket?.records ?? []} onLocateInLog={onLocateInLog} />
          </div>
        </div>
      ) : (
        <p className={styles.guidance}>点击曲线上的 ◆ 或上方事件条查看取证</p>
      )}
    </div>
  );
}
