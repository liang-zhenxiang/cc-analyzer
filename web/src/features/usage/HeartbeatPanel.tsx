import { useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useFontScale } from "../settings/fontScale";
import type { SessionMeta } from "../sessions/metadataCache";
import type { UsageSessionInput } from "./usageAggregations";
import {
  buildHeartbeat,
  formatSilence,
  formatSilenceCompact,
  type HeartbeatChannelId,
  type HeartbeatScope
} from "./heartbeat";
import styles from "./HeartbeatPanel.module.css";
import primitives from "./charts/chartPrimitives.module.css";

/**
 * F8「对话心跳」：最近一个有活动的自然日，三条通道（用户 / 助手 / 工具）
 * 各画一排分钟脉冲；安静的时候只剩基线。
 *
 * 颜色借 `--cat-user` / `--cat-compute` / `--cat-direct`——这三个 token 的
 * 语义就是记录类别，与回放视图同一映射。wait / system 不画：它们不是对话
 * 节奏。竖线不做焦点目标，读数行承担读屏等价物。
 */

const WIDTH = 960;
const HEIGHT = 140;
const LEFT = 64;
const RIGHT = 16;
const TOP = 16;
const BOTTOM = 16;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const BASELINES = [38, 74, 110];
const BAR_WIDTH = 1.6;
const BAR_MIN_HEIGHT = 4;
const BAR_MAX_HEIGHT = 14;
const DAY_MINUTES = 24 * 60;

const BAR_CLASSES: Record<HeartbeatChannelId, string> = {
  user: styles.barUser,
  assistant: styles.barAssistant,
  tool: styles.barTool
};

function hourTicks(fontScale: number): number[] {
  const step = fontScale > 1.2 ? 6 : 3;
  const ticks: number[] = [];
  for (let hour = 0; hour < 24; hour += step) ticks.push(hour);
  return ticks;
}

function dayLabel(dayStart: number): string {
  const date = new Date(dayStart);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function HeartbeatPanel({
  inputs,
  days,
  now
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const fontScale = useFontScale();
  const [scope, setScope] = useState<HeartbeatScope>("day");
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const data = useMemo(
    () => buildHeartbeat(inputs, days, now, { scope, sessionKey: pickedKey ?? undefined }),
    [inputs, days, now, scope, pickedKey]
  );

  const ticks = hourTicks(fontScale);
  const user = data.channels[0];
  const assistant = data.channels[1];
  const tool = data.channels[2];

  const summary =
    data.dayStart === null
      ? ""
      : `对话心跳：${scope === "session" && data.selectedSessionLabel ? `${data.selectedSessionLabel}，` : ""}${dayLabel(data.dayStart)}，用户 ${user.total} 条、助手 ${assistant.total} 条、工具 ${tool.total} 次；${
          data.longestSilence
            ? `最长静默 ${formatSilence(data.longestSilence.durationMs)}。`
            : "当天没有可测的停顿。"
        }`;

  return (
    <Panel
      title="对话心跳"
      ariaLabel="对话心跳"
      titleAs="h3"
      actions={
        <SegmentedControl
          items={[
            { value: "day", label: "按天" },
            { value: "session", label: "单会话" }
          ]}
          value={scope}
          onChange={(next) => {
            setPickedKey(null);
            setScope(next);
          }}
          ariaLabel="心跳范围"
          role="radiogroup"
        />
      }
    >
      <div data-probe="lab-heartbeat">
        {data.dayStart === null ? (
          <>
            <EmptyState size="inline" title="所选范围内没有可画的一天" />
            <p className={styles.footnote}>
              只画 user / assistant / tool 三类记录；wait 与 system 不是对话节奏。
            </p>
          </>
        ) : (
          <>
            {scope === "session" && data.sessions.length > 0 ? (
              <label className={styles.picker}>
                会话
                <select
                  className={styles.select}
                  value={data.selectedSessionKey ?? ""}
                  onChange={(event) => setPickedKey(event.target.value)}
                >
                  {data.sessions.map((session) => (
                    <option key={session.key} value={session.key}>
                      {session.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <svg
              className={primitives.chart}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label={summary}
              data-probe="lab-heartbeat-chart"
            >
              {ticks.map((hour) => {
                const x = LEFT + (hour * 60 / DAY_MINUTES) * PLOT_WIDTH;
                return (
                  <text
                    key={hour}
                    x={x}
                    y={TOP - 2}
                    textAnchor="middle"
                    className={primitives.tickText}
                  >
                    {hour}
                  </text>
                );
              })}

              {data.channels.map((channel, index) => {
                const baseline = BASELINES[index];
                return (
                  <g key={channel.id}>
                    <line
                      x1={LEFT}
                      x2={WIDTH - RIGHT}
                      y1={baseline}
                      y2={baseline}
                      className={styles.baseline}
                    />
                    <text
                      x={LEFT - 8}
                      y={baseline + 4}
                      textAnchor="end"
                      className={styles.channelLabel}
                    >
                      {channel.label}
                    </text>
                    {channel.pulses.map((pulse) => {
                      const height =
                        channel.peak > 0
                          ? BAR_MIN_HEIGHT + (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT) * (pulse.count / channel.peak)
                          : 0;
                      if (height <= 0) return null;
                      const x = LEFT + (pulse.minute / DAY_MINUTES) * PLOT_WIDTH;
                      return (
                        <rect
                          key={pulse.minute}
                          x={x}
                          y={baseline - height}
                          width={BAR_WIDTH}
                          height={height}
                          className={`${styles.bar} ${BAR_CLASSES[channel.id]}`}
                          data-heartbeat-channel={channel.id}
                          data-heartbeat-minute={pulse.minute}
                        >
                          <title>
                            {`${String(Math.floor(pulse.minute / 60)).padStart(2, "0")}:${String(pulse.minute % 60).padStart(2, "0")} · ${channel.label} · ${pulse.count} 条`}
                          </title>
                        </rect>
                      );
                    })}
                  </g>
                );
              })}

              {data.longestSilence ? (
                <text
                  x={LEFT}
                  y={HEIGHT - BOTTOM + 10}
                  className={styles.silenceLabel}
                >
                  {`静默 ${formatSilence(data.longestSilence.durationMs)}`}
                </text>
              ) : null}
            </svg>

            <ul className={styles.readout} aria-label="心跳读数">
              {data.channels.map((channel) => (
                <li key={channel.id}>
                  {channel.label}{" "}
                  <span className={styles.readoutValue}>{channel.total}</span>
                </li>
              ))}
              <li>
                最长静默{" "}
                <span className={styles.readoutValue}>
                  {data.longestSilence
                    ? formatSilenceCompact(data.longestSilence.durationMs)
                    : "无"}
                </span>
              </li>
            </ul>

            <p className={styles.footnote}>
              {`取窗口内最近一个有活动的自然日（${dayLabel(data.dayStart)}）；只画 user / assistant / tool 三类，wait 与 system 不是对话节奏。竖线高度 = 该分钟内的记录条数。`}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
