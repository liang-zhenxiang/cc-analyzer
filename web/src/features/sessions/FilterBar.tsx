import { useState } from "react";
import { Button } from "../../components/Button";
import { TextInput } from "../../components/TextInput";
import type { DurationMode, RecordFilter, RowKindFilter, RowStatusFilter } from "./filters";
import styles from "./FilterBar.module.css";

const kindLabels: Array<[RowKindFilter, string]> = [
  ["user", "用户"],
  ["llm", "LLM"],
  ["tool", "工具"],
  ["subagent", "Agent"],
  ["workflow", "workflow"],
  ["wait", "等用户"]
];

const statusLabels: Array<[RowStatusFilter, string]> = [
  ["ok", "成功"],
  ["error", "失败"]
];

const durationModes: Array<[DurationMode, string]> = [
  ["gt", "高于"],
  ["lt", "低于"],
  ["between", "区间"]
];

const units = [
  ["ms", "毫秒"],
  ["s", "秒"],
  ["m", "分钟"]
] as const;

type Unit = (typeof units)[number][0];

const UNIT_MS: Record<Unit, number> = { ms: 1, s: 1000, m: 60_000 };

export function FilterBar({
  filter,
  onChange
}: {
  filter: RecordFilter;
  onChange: (filter: RecordFilter) => void;
}) {
  const [unit, setUnit] = useState<Unit>("s");

  function toggleKind(kind: RowKindFilter) {
    const kinds = new Set(filter.kinds);
    if (kinds.has(kind)) kinds.delete(kind);
    else kinds.add(kind);
    onChange({ ...filter, kinds });
  }

  function toggleStatus(status: RowStatusFilter) {
    const statuses = new Set(filter.statuses);
    if (statuses.has(status)) statuses.delete(status);
    else statuses.add(status);
    onChange({ ...filter, statuses });
  }

  function display(value: number | null) {
    if (value === null) return "";
    const scaled = value / UNIT_MS[unit];
    return String(Math.round(scaled * 1000) / 1000);
  }

  function toMs(value: string): number | null {
    if (value === "") return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed * UNIT_MS[unit]);
  }

  return (
    <section className={styles.bar} aria-label="记录筛选">
      <TextInput
        value={filter.search}
        placeholder="搜索命令 / 路径 / 摘要…"
        onChange={(event) => onChange({ ...filter, search: event.target.value })}
      />
      <fieldset>
        <legend>记录类型（可多选）</legend>
        {kindLabels.map(([kind, label]) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={filter.kinds.has(kind)}
              onChange={() => toggleKind(kind)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>状态</legend>
        {statusLabels.map(([status, label]) => (
          <button
            key={status}
            type="button"
            aria-pressed={filter.statuses.has(status)}
            onClick={() => toggleStatus(status)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <fieldset>
        <legend>耗时</legend>
        <label>
          比较方式
          <select
            aria-label="耗时比较方式"
            value={filter.durationMode}
            onChange={(event) =>
              onChange({ ...filter, durationMode: event.target.value as DurationMode })
            }
          >
            {durationModes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {filter.durationMode === "between" ? "下限" : "阈值"}
          <input
            type="number"
            min={0}
            value={display(filter.minDurationMs)}
            onChange={(event) =>
              onChange({ ...filter, minDurationMs: toMs(event.target.value) })
            }
          />
        </label>
        {filter.durationMode === "between" ? (
          <label>
            上限
            <input
              type="number"
              min={0}
              value={display(filter.maxDurationMs)}
              onChange={(event) =>
                onChange({ ...filter, maxDurationMs: toMs(event.target.value) })
              }
            />
          </label>
        ) : null}
        <label>
          单位
          <select
            aria-label="耗时单位"
            value={unit}
            onChange={(event) => setUnit(event.target.value as Unit)}
          >
            {units.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {filter.timeRange ? (
        <Button type="button" onClick={() => onChange({ ...filter, timeRange: null })}>
          清除时间选区
        </Button>
      ) : null}
    </section>
  );
}
