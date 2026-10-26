import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import type { UsageSessionInput } from "./usageAggregations";
import { workHabits, MORNING_HOURS, EVENING_HOURS } from "./workHabits";
import styles from "./WorkHabitsPanel.module.css";

/**
 * 「工作习惯」（D8）：2×2 的四格读数，全部字段来自 `WorkHabits`。
 *
 * 四格都只有「值 + 一句口径」，不画图：这一块是给人对号入座的，不是趋势。
 */

const CHRONO_NOTE: Record<string, string> = {
  早鸟: `${MORNING_HOURS.start}–${MORNING_HOURS.end} 点更活跃`,
  夜猫: `${EVENING_HOURS.start}–${EVENING_HOURS.end} 点更活跃`,
  均衡: "早晚分布接近"
};

export function WorkHabitsPanel({
  inputs,
  now
}: {
  inputs: readonly UsageSessionInput[];
  now?: number;
}) {
  const [mountedNow] = useState(() => Date.now());
  const tick = now ?? mountedNow;
  const habits = useMemo(() => workHabits(inputs, tick), [inputs, tick]);

  const hasMessages = inputs.some((input) =>
    input.records.some((record) => record.kind === "user" || record.kind === "assistant")
  );

  if (!hasMessages) {
    return (
      <Panel title="工作习惯" ariaLabel="工作习惯">
        <p className={styles.empty}>本窗口没有消息</p>
      </Panel>
    );
  }

  const cells = [
    {
      key: "chrono",
      label: "昼夜型",
      value: habits.chronoType,
      note: CHRONO_NOTE[habits.chronoType] ?? ""
    },
    {
      key: "streak",
      label: "连击",
      value: `${habits.currentStreak} 天`,
      note:
        habits.currentStreak === 0
          ? "今天和昨天都没有记录"
          : `最长 ${habits.longestStreak} 天`
    },
    {
      key: "longest",
      label: "最长会话",
      value: `${Math.round(habits.longestSessionMinutes)} 分`,
      note: "单段会话的首尾跨度"
    },
    {
      key: "peak",
      label: "峰值小时",
      value: habits.peakHour === null ? "—" : `${String(habits.peakHour).padStart(2, "0")}:00`,
      note:
        habits.peakHour === null
          ? "本窗口没有消息"
          : `${(habits.peakHourShare * 100).toFixed(0)}% 的消息落在这一小时`
    }
  ];

  return (
    <Panel title="工作习惯" ariaLabel="工作习惯">
      <div className={styles.grid} data-probe="work-habits">
        {cells.map((cell) => (
          <div className={styles.cell} key={cell.key}>
            <span className={styles.label}>{cell.label}</span>
            <span className={styles.value}>{cell.value}</span>
            <span className={styles.note}>{cell.note}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
