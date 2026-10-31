import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { formatModelId } from "../../lib/format";
import type { SessionMeta } from "./metadataCache";
import {
  queryOptionsFromFacts,
  type QueryOption,
  type SessionQuery
} from "../usage/sessionQuery";
import styles from "./SessionQueryBar.module.css";

/**
 * 会话筛选栏（G2）——侧栏的第二层过滤器：上面是文字搜索，这里是六个结构化
 * 条件，两层 AND。
 *
 * 条件全部可枚举（原生下拉 + 两个多选浮层），不做自由输入：输入框只会制造
 * 「拼写不匹配」，而这里的值都来自本机数据。
 *
 * 数据来源是**已建立索引**的会话事实（`SessionMeta.facts`）。未索引会话不
 * 参与过滤，脚行常显「已索引 N/M」——不把「还没索引」伪装成「不匹配」。
 */

const CONTEXT_OPTIONS: { value: number; label: string }[] = [
  { value: 50_000, label: "≥ 50k" },
  { value: 100_000, label: "≥ 100k" },
  { value: 150_000, label: "≥ 150k" },
  { value: 200_000, label: "≥ 200k" }
];

const DURATION_OPTIONS: { value: number; label: string }[] = [
  { value: 10, label: "≥ 10 分钟" },
  { value: 30, label: "≥ 30 分钟" },
  { value: 60, label: "≥ 1 小时" }
];

/** 下拉里最多列多少项；更多的值用「更多…」截掉（design §G2 第 1 行）。 */
const OPTION_LIMIT = 40;

function visible(options: QueryOption[]): QueryOption[] {
  return options.slice(0, OPTION_LIMIT);
}

/** 工具桶身份 → 人能读的名字（`builtin:Bash` → `Bash`）。 */
function toolLabel(bucketId: string): string {
  const colon = bucketId.indexOf(":");
  return colon >= 0 ? bucketId.slice(colon + 1) : bucketId;
}

function activeCountOf(query: SessionQuery): number {
  let count = 0;
  if (query.projects && query.projects.length > 0) count += 1;
  if (query.models && query.models.length > 0) count += 1;
  if (query.toolKey !== undefined) count += 1;
  if (query.hasError !== undefined) count += 1;
  if (query.minContextPeak !== undefined) count += 1;
  if (query.minDurationMin !== undefined) count += 1;
  return count;
}

function MultiSelect({
  label,
  placeholder,
  options,
  selected,
  format,
  onChange
}: {
  label: string;
  placeholder: string;
  options: QueryOption[];
  selected: string[];
  format: (value: string) => string;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function toggle(value: string) {
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]
    );
  }

  const summary =
    selected.length === 0 ? placeholder : selected.map(format).join("、");

  return (
    <div className={styles.field} ref={rootRef}>
      <span className={styles.label}>{label}</span>
      <button
        type="button"
        className={styles.multi}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}：${summary}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.multiText}>{summary}</span>
      </button>
      {open ? (
        <div className={styles.pop} role="listbox" aria-multiselectable="true" aria-label={label}>
          {visible(options).map((option) => {
            const checked = selected.includes(option.label);
            return (
              <label key={option.label} className={styles.checkRow}>
                <input type="checkbox" checked={checked} onChange={() => toggle(option.label)} />
                <span className={styles.checkLabel}>{format(option.label)}</span>
                <span className={styles.checkCount}>{option.count}</span>
              </label>
            );
          })}
          {options.length === 0 ? <p className={styles.popEmpty}>没有可选项</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function SessionQueryBar({
  sessions,
  query,
  onChange,
  onExpand
}: {
  sessions: SessionMeta[];
  query: SessionQuery;
  onChange: (query: SessionQuery) => void;
  /** 第一次展开时通知上层懒补索引事实（G2）；可重复调用，上层自己幂等。 */
  onExpand?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(
    () =>
      sessions
        .filter((session): session is SessionMeta & { facts: NonNullable<SessionMeta["facts"]> } =>
          session.facts !== undefined
        )
        .map((session) => ({ projectLabel: session.projectLabel, facts: session.facts })),
    [sessions]
  );
  const options = useMemo(() => queryOptionsFromFacts(rows), [rows]);
  const activeCount = activeCountOf(query);
  const unindexed = sessions.length - rows.length;
  const failed = sessions.filter((session) => session.metadataStatus === "failed").length;
  const allUnindexed = sessions.length > 0 && rows.length === 0;

  const headLabel =
    activeCount > 0 ? `筛选：${activeCount} 个条件 · 编辑` : "筛选会话";

  return (
    <div className={styles.query} data-probe="session-query">
      <button
        type="button"
        className={styles.head}
        aria-expanded={expanded}
        aria-controls="session-query-body"
        data-probe="session-query-toggle"
        onClick={() => {
          if (!expanded) onExpand?.();
          setExpanded((current) => !current);
        }}
      >
        <span className={styles.headLabel}>{allUnindexed ? "筛选需要先建立索引…" : headLabel}</span>
        {activeCount > 0 ? (
          <span className={styles.count} aria-label={`已生效 ${activeCount} 个条件`}>
            {activeCount}
          </span>
        ) : null}
        <span className={styles.chev} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className={styles.body} id="session-query-body" data-probe="session-query-body">
          <div className={styles.grid}>
            <MultiSelect
              label="项目"
              placeholder="全部项目"
              options={options.projects}
              selected={query.projects ?? []}
              format={(value) => value}
              onChange={(projects) =>
                onChange({ ...query, projects: projects.length > 0 ? projects : undefined })
              }
            />
            <MultiSelect
              label="模型"
              placeholder="全部模型"
              options={options.models}
              selected={query.models ?? []}
              format={formatModelId}
              onChange={(models) =>
                onChange({ ...query, models: models.length > 0 ? models : undefined })
              }
            />
            <label className={styles.field}>
              <span className={styles.label}>上下文峰值</span>
              <select
                className={styles.select}
                value={query.minContextPeak ?? ""}
                onChange={(event) =>
                  onChange({
                    ...query,
                    minContextPeak: event.target.value ? Number(event.target.value) : undefined
                  })
                }
              >
                <option value="">不限</option>
                {CONTEXT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>工具</span>
              <select
                className={styles.select}
                value={query.toolKey ?? ""}
                onChange={(event) =>
                  onChange({ ...query, toolKey: event.target.value || undefined })
                }
              >
                <option value="">不限</option>
                {visible(options.tools).map((option) => (
                  <option key={option.label} value={option.label}>
                    {toolLabel(option.label)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>错误</span>
              <select
                className={styles.select}
                value={query.hasError === undefined ? "" : query.hasError ? "has" : "none"}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange({
                    ...query,
                    hasError: value === "" ? undefined : value === "has"
                  });
                }}
              >
                <option value="">不限</option>
                <option value="has">有失败</option>
                <option value="none">无失败</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>时长</span>
              <select
                className={styles.select}
                value={query.minDurationMin ?? ""}
                onChange={(event) =>
                  onChange({
                    ...query,
                    minDurationMin: event.target.value ? Number(event.target.value) : undefined
                  })
                }
              >
                <option value="">不限</option>
                {DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.foot}>
            {failed > 0 || unindexed > 0 ? (
              <span className={styles.indexNote} data-probe="session-query-index-note">
                {failed > 0
                  ? `索引中断，${failed} 个会话未参与筛选`
                  : `已索引 ${rows.length}/${sessions.length} 个会话`}
              </span>
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="ghost"
              className={styles.clear}
              data-probe="session-query-clear"
              disabled={activeCount === 0}
              onClick={() => onChange({})}
            >
              清空
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
