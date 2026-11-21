import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatFullDate, formatShortStamp, formatUsd } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import { sessionTitle } from "../sessions/metadataCache";
import { labWindow } from "./constellation";
import {
  ECHO_THRESHOLD,
  buildEchoGroups,
  type EchoGroup,
  type EchoSession
} from "./echoTopics";
import { ProvenanceBadge } from "./ProvenanceBadge";
import {
  dayStartOf,
  formatDayLabel,
  type UsageSessionInput
} from "./usageAggregations";
import styles from "./EchoPanel.module.css";

/**
 * 「回声」（Issue #371）：把窗口内的会话按**内容**聚成话题组，只展示
 * 「同一件事被做了至少两次」的那些。
 *
 * 纯逻辑在 `echoTopics.ts`（`topicSignature` / `jaccard` / `buildEchoGroups`），
 * 这一层只负责呈现与交互：
 *
 * - **`days` 必须作为第 4 个参数传给 `buildEchoGroups`**。它的默认值是 30，
 *   不传会让 7 / 90 天档位读到错误的窗口，而面板上不会报错——只是安静地
 *   给出另一个区间的答案。
 * - 频率条的时间基准是**组内首末**（取整到本地日），不是窗口首末；同一天
 *   连问三次时三个刻度会叠成一根粗线，所以按时间升序做一次单车位 dodge，
 *   保证每个刻度至少露出 3px。这是本功能最想展示的形状（`echoTickPositions`）。
 * - 组头是整块 `<button>`，读数各列固定最小宽度 + `tabular-nums`，展开箭头
 *   用两段边框旋转而成；组与组之间只用一条发丝线分隔，不再套第二层卡片。
 * - 组数不设上限，会话数也不截断：每组的结论独立，藏起来会让总结句的 N 组
 *   和列表对不上。
 */

/** 频率条刻度宽 3px——dodge 的净宽度单位。 */
export const ECHO_TICK_WIDTH = 3;
/** 同一天多个会话时相邻刻度的最小位移。 */
export const ECHO_MAX_DODGE = 5;
/** jsdom 里 `clientWidth` 恒为 0；给一个与桌面列宽相称的兜底。 */
const FALLBACK_TRACK_WIDTH = 960;

/** 组的花费：未定价模型让整组记为 `null` 时显示破折号，不编造 `$0.00`。 */
function amountText(usd: number | null): string {
  return usd === null ? "—" : formatUsd(usd);
}

/** 读屏用的金额：`—` 单独读出来没有语义，换成一句话。 */
function amountSpoken(usd: number | null): string {
  return usd === null ? "金额未知" : formatUsd(usd);
}

/**
 * 频率条上每个刻度的左偏移（px）。
 *
 * 时间基准是组内首末，取整到本地日：
 * `rawX = (at - firstDay) / (lastDay - firstDay + 86400000) * (trackW - 3)`。
 * 然后按时间升序单遍 dodge：`x[i] = min(max(rawX, x[i-1] + gap), trackW - 3)`，
 * `gap = min(5, trackW / n)`。同一天连问三次时三个刻度仍各自可见。
 *
 * 导出是为了单测能直接钉住位移规则（组件本身不重复实现一遍）。
 */
export function echoTickPositions(
  sessions: readonly EchoSession[],
  trackWidth: number
): number[] {
  if (sessions.length === 0) return [];
  const maxX = Math.max(0, trackWidth - ECHO_TICK_WIDTH);
  const firstDay = dayStartOf(sessions[0].at);
  const lastDay = dayStartOf(sessions[sessions.length - 1].at);
  // 至少一个本地日：同一时刻的刻度 rawX 相同，交给 dodge 分开。
  const spanMs = lastDay - firstDay + 86_400_000;
  const gap = Math.min(ECHO_MAX_DODGE, trackWidth / sessions.length);

  let previous = Number.NEGATIVE_INFINITY;
  return sessions.map((session) => {
    const rawX = ((session.at - firstDay) / spanMs) * maxX;
    const x = Math.min(Math.max(rawX, previous + gap), maxX);
    const clamped = Math.max(0, x);
    previous = clamped;
    return clamped;
  });
}

/** 轴端点的本地日标签：同一自然年内用 `9/28`，跨年才写完整日期。 */
function axisLabel(dayStart: number, crossYear: boolean): string {
  return crossYear ? formatFullDate(dayStart) : formatDayLabel(dayStart);
}

type WindowStats = {
  sessions: number;
  /** 缺标题与首条消息、因此没有参与比较的会话数。 */
  excluded: number;
};

/**
 * 窗口内的会话数与「无话题」会话数。
 *
 * `buildEchoGroups` 只返回聚类结果，不返回被排除的数量；总结句下方需要补
 * 一句「另有 N 个会话…未参与比较」，这个 N 必须和源数据同口径算。
 */
function windowStatsOf(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): WindowStats {
  const { startTs, endTs } = labWindow(days, now);
  let sessions = 0;
  let excluded = 0;

  for (const source of inputs) {
    let inWindow = false;
    for (const record of source.records) {
      if (record.timestamp >= startTs && record.timestamp < endTs) {
        inWindow = true;
        break;
      }
    }
    if (!inWindow) continue;
    sessions += 1;

    const meta = source.session;
    const title = meta ? sessionTitle(meta).trim() : "";
    const prompt = (meta?.userPrompt ?? "").trim();
    if (title === "" && prompt === "") excluded += 1;
  }

  return { sessions, excluded };
}

type EmptyCopy = { title: string; description?: string };

function emptyCopyOf(stats: WindowStats, groupCount: number): EmptyCopy | null {
  if (stats.sessions === 0) return { title: "本窗口还没有会话" };
  if (stats.sessions === 1) {
    return { title: "本窗口只有 1 个会话，重复至少需要 2 个" };
  }
  if (groupCount === 0) {
    return {
      title: "没有发现重复话题",
      description: "窗口内没有两条会话的标题或首条消息相似到可以算作同一件事"
    };
  }
  return null;
}

function GroupHead({
  group,
  index,
  open,
  onToggle
}: {
  group: EchoGroup;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const count = group.sessions.length;
  const ariaLabel = `展开：${group.label}，${count} 个会话，估算 ${amountSpoken(
    group.usd
  )}，跨度 ${group.spanDays} 天`;

  return (
    <button
      type="button"
      className={styles.head}
      aria-expanded={open}
      aria-controls={`echo-sessions-${index}`}
      aria-label={ariaLabel}
      onClick={onToggle}
      data-echo-head={index}
    >
      <span className={styles.headMain}>
        <span className={styles.headTitle} title={group.label}>
          {group.label}
        </span>
        <span className={styles.readings}>
          <span className={`${styles.reading} ${styles.sessions}`}>{count} 个会话</span>
          <span className={`${styles.reading} ${styles.cost}`}>{amountText(group.usd)}</span>
          <span className={`${styles.reading} ${styles.span}`}>跨度 {group.spanDays} 天</span>
        </span>
        <span className={styles.chev} aria-hidden="true" />
      </span>
    </button>
  );
}

function FrequencyStrip({
  group,
  index,
  trackWidth
}: {
  group: EchoGroup;
  index: number;
  trackWidth: number;
}) {
  const positions = echoTickPositions(group.sessions, trackWidth);
  const firstDay = dayStartOf(group.sessions[0].at);
  const lastDay = dayStartOf(group.sessions[group.sessions.length - 1].at);
  const sameDay = firstDay === lastDay;
  const crossYear =
    new Date(firstDay).getFullYear() !== new Date(lastDay).getFullYear();

  return (
    <>
      <span className={styles.strip} aria-hidden="true" data-echo-strip={index}>
        {positions.map((left, tickIndex) => (
          <span
            // 位置只由会话顺序决定；同一份输入每次渲染出同一组坐标。
            key={`${tickIndex}-${left}`}
            className={styles.tick}
            style={{ left: `${left}px` }}
            data-echo-tick=""
          />
        ))}
      </span>
      <span className={styles.axisRow} aria-hidden="true" data-echo-axis={index}>
        <span>{axisLabel(firstDay, crossYear)}</span>
        {sameDay ? null : <span>{axisLabel(lastDay, crossYear)}</span>}
      </span>
    </>
  );
}

function SessionRows({
  group,
  index,
  onOpenSession
}: {
  group: EchoGroup;
  index: number;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  return (
    <ul className={styles.expanded} id={`echo-sessions-${index}`} data-echo-sessions={index}>
      {group.sessions.map((session) => {
        const meta = session.meta;
        const canOpen = Boolean(meta && onOpenSession);
        // 代表会话 = 逻辑层选出的那条；`group.key` 就是它的会话 id。
        const representative = session.id === group.key;
        const stamp = formatShortStamp(session.at);

        return (
          <li key={session.id}>
            <button
              type="button"
              className={styles.row}
              disabled={!canOpen}
              aria-label={`${representative ? "代表会话，" : ""}打开会话：${
                session.title
              }，${stamp}，估算 ${amountSpoken(session.usd)}`}
              onClick={canOpen ? () => onOpenSession?.(meta as SessionMeta) : undefined}
              data-echo-session={session.id}
            >
              <span className={styles.rowTime}>{stamp}</span>
              <span className={styles.rowTitle} title={session.title}>
                {session.title}
              </span>
              <span className={styles.rowFlag}>{representative ? "代表" : ""}</span>
              <span className={styles.rowCost}>{amountText(session.usd)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type Props = {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  onOpenSession?: (session: SessionMeta) => void;
};

export function EchoPanel({ inputs, days, now, onOpenSession }: Props) {
  const echo = useMemo(
    // 第 4 个参数必须是面板自己的 `days`——默认 30 会让 7/90 天档位失效。
    () => buildEchoGroups(inputs, now, ECHO_THRESHOLD, days),
    [inputs, days, now]
  );
  const stats = useMemo(() => windowStatsOf(inputs, days, now), [inputs, days, now]);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(FALLBACK_TRACK_WIDTH);

  // 容器实测宽度：刻度位置是像素事实，不能靠百分比猜。jsdom / 首帧用兜底值。
  useEffect(() => {
    if (!hostEl) return;
    const measure = () => {
      const width = hostEl.clientWidth;
      if (width > 0) setTrackWidth(width);
    };
    measure();
    // 最低系统版本 10.13 的 WKWebView 没有 ResizeObserver；没有它时退回
    // 「挂载时量一次」，图仍然能画，只是不跟随窗口实时重排。
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(hostEl);
    return () => observer.disconnect();
  }, [hostEl]);

  const empty = emptyCopyOf(stats, echo.groups.length);

  function toggle(key: string) {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const excludedNote =
    stats.excluded > 0
      ? `另有 ${stats.excluded} 个会话缺少标题与首条消息，未参与比较。`
      : null;

  const summaryAmount =
    echo.totalUsd === null ? "金额未知" : formatUsd(echo.totalUsd);

  return (
    <div data-probe="lab-echo">
      <Panel
        title="回声"
        ariaLabel="回声"
        titleAs="h3"
        actions={<ProvenanceBadge provenance="estimated" />}
      >
        {empty ? (
          <>
            <EmptyState size="inline" title={empty.title} />
            {empty.description ? (
              <p className={styles.emptyDescription}>{empty.description}</p>
            ) : null}
            {excludedNote ? <p className={styles.note}>{excludedNote}</p> : null}
          </>
        ) : (
          <>
            <p className={styles.summary}>
              发现 <strong>{echo.groups.length}</strong> 组重复话题，共{" "}
              <strong>{echo.totalSessions}</strong> 个会话、
              <strong>{summaryAmount}</strong>。
            </p>
            {excludedNote ? <p className={styles.note}>{excludedNote}</p> : null}

            <div className={styles.groups} ref={setHostEl}>
              {echo.groups.map((group, index) => {
                const open = openKeys.has(group.key);
                return (
                  <div className={styles.group} key={group.key} data-echo-group={index}>
                    <GroupHead
                      group={group}
                      index={index}
                      open={open}
                      onToggle={() => toggle(group.key)}
                    />
                    <FrequencyStrip group={group} index={index} trackWidth={trackWidth} />
                    {open ? (
                      <SessionRows
                        group={group}
                        index={index}
                        onOpenSession={onOpenSession}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>

            <p className={styles.footnote}>
              {`同组会话按标题与首条用户消息的相似度聚类（阈值 ${ECHO_THRESHOLD.toFixed(
                2
              )}），每组至少 2 个会话；代表标题逐字取自组内真实会话，未做改写。未进入任何组的会话不计入上方读数。花费为按定价快照的估算值。`}
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
