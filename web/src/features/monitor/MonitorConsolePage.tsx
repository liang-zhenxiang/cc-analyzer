import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Panel } from "../../components/Panel";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { SkeletonBar } from "../../components/Skeleton";
import {
  formatClock,
  formatDuration,
  formatFullDate,
  formatProjectPath,
  formatTokenCount
} from "../../lib/format";
import { billingReadoutsOf, type BillingWindowReadouts } from "../usage/billingReadouts";
import { usePlan } from "../usage/planLimits";
import { totalsSum } from "../usage/usageAggregations";
import {
  consoleModelOf,
  type ConsoleEvent,
  type ConsoleEventKind,
  type ConsoleHour,
  type ConsoleProject,
  type ConsoleReport
} from "./consoleModel";
import type { SessionRow } from "./pulseModel";
import styles from "./MonitorConsolePage.module.css";
import { usePulseFeed, type PulseSnapshot } from "./usePulseFeed";

type ConsoleState = "loading" | "empty" | "error" | "stale" | "fresh";
type EventFilter = "all" | ConsoleEventKind;

const EVENT_FILTERS: SegmentedItem<EventFilter>[] = [
  { value: "all", label: "全部" },
  { value: "compaction", label: "压缩" },
  { value: "error", label: "错误" },
  { value: "session", label: "会话开始" }
];

const EVENT_KIND_LABEL: Record<ConsoleEventKind, string> = {
  compaction: "压缩",
  error: "错误",
  session: "会话开始"
};

/**
 * 原生「监控台」视图（Issue #225）。
 *
 * 数据只来自 `usePulseFeed` 与既有的 `billingReadoutsOf` / `consoleModelOf`。
 * 这里不重新解释时间窗口，不重算项目速率；项目与事件筛选只过滤已经算好的
 * `ConsoleReport.events`，不会扩大最近 12 条的事实窗口。
 */
export function MonitorConsolePage({
  onOpenSession
}: {
  onOpenSession?: (path: string) => void;
} = {}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ConsoleFeedView
      key={attempt}
      onOpenSession={onOpenSession}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function ConsoleFeedView({
  onOpenSession,
  onRetry
}: {
  onOpenSession?: (path: string) => void;
  onRetry: () => void;
}) {
  const { snapshot, error, stale } = usePulseFeed();
  const plan = usePlan();

  const state: ConsoleState = !snapshot
    ? error
      ? "error"
      : "loading"
    : snapshot.inputs.length === 0
      ? "empty"
      : stale
        ? "stale"
        : "fresh";

  const report = useMemo(
    () => (snapshot ? consoleModelOf(snapshot.inputs, snapshot.rows, snapshot.now) : null),
    [snapshot]
  );
  const readouts = useMemo(
    () =>
      snapshot
        ? billingReadoutsOf(snapshot.inputs, snapshot.now, plan.weeklyLimitTokens)
        : null,
    [plan.weeklyLimitTokens, snapshot]
  );

  const refreshText = !snapshot
    ? error
      ? "读取本地日志失败"
      : "正在读取本地日志…"
    : `上次更新 ${formatClock(snapshot.now, true)}${state === "stale" ? " · 本次读取失败" : ""}`;

  return (
    <div
      className={styles.consolePage}
      data-probe="monitor-console-page"
      data-state={state}
    >
      <div className={styles.consoleInner}>
        <div className={styles.consoleHead}>
          <span className={styles.todayFact}>
            {snapshot
              ? `今天 · ${formatFullDate(snapshot.now)} · 本地自然日`
              : "今天 · 本地自然日"}
          </span>
          <span
            className={styles.refreshState}
            data-probe="monitor-console-refresh"
            {...(state === "stale" ? { "data-stale": "true" } : {})}
          >
            {refreshText}
          </span>
          {state === "stale" ? (
            <Button type="button" onClick={onRetry}>
              重试
            </Button>
          ) : null}
        </div>

        {state === "loading" ? <LoadingSkeleton /> : null}

        {state === "error" ? (
          <div className={styles.stage} data-probe="monitor-console-error">
            <ErrorState
              size="page"
              title="读取本地日志失败"
              hint="没能读到会话目录（文件可能正在被写入或被移动）。确认目录可读后重试。"
              detail={error ?? undefined}
              onRetry={onRetry}
            />
          </div>
        ) : null}

        {state === "empty" ? (
          <div className={styles.stage} data-probe="monitor-console-empty">
            <EmptyState
              size="page"
              title="本机还没有会话日志"
              description="有记录后这里会按今天汇总项目热度、小时活动与事件。"
            />
          </div>
        ) : null}

        {snapshot && report && readouts && state !== "empty" ? (
          <ConsoleReportView
            snapshot={snapshot}
            report={report}
            readouts={readouts}
            onOpenSession={onOpenSession}
          />
        ) : null}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div
      className={styles.skeletonStack}
      data-probe="monitor-console-skeleton"
      data-probe-pending
    >
      <span role="status" aria-label="正在读取监控台" className={styles.statusOnly} />
      <div className={styles.skeletonReadouts} aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className={styles.skeletonReadout} data-probe-pending>
            <SkeletonBar width="value" />
          </div>
        ))}
      </div>
      <div className={styles.skeletonChart} aria-hidden="true" data-probe-pending />
      <div className={styles.skeletonBoard} aria-hidden="true">
        <div className={styles.skeletonPanel} data-probe-pending />
        <div className={styles.skeletonPanel} data-probe-pending />
      </div>
    </div>
  );
}

function ConsoleReportView({
  snapshot,
  report,
  readouts,
  onOpenSession
}: {
  snapshot: PulseSnapshot;
  report: ConsoleReport;
  readouts: BillingWindowReadouts;
  onOpenSession?: (path: string) => void;
}) {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");

  const selected = useMemo(
    () => report.projects.find((project) => project.projectLabel === selectedProject) ?? null,
    [report.projects, selectedProject]
  );
  const shownEvents = useMemo(
    () =>
      report.events.filter(
        (event) =>
          (eventFilter === "all" || event.kind === eventFilter) &&
          (selected === null || event.projectLabel === selected.projectLabel)
      ),
    [eventFilter, report.events, selected]
  );
  const titleByPath = useMemo(
    () => new Map(snapshot.rows.map((row) => [row.path, row.title])),
    [snapshot.rows]
  );

  return (
    <>
      <ReadoutStrip readouts={readouts} rows={snapshot.rows} report={report} />
      <ActivityPanel hours={report.hourly} />
      <div className={styles.board}>
        <ProjectPanel
          projects={report.projects}
          selected={selected?.projectLabel ?? null}
          onSelect={(projectLabel) =>
            setSelectedProject((current) => (current === projectLabel ? null : projectLabel))
          }
        />
        <EventPanel
          events={shownEvents}
          selectedProject={selected}
          filter={eventFilter}
          titleByPath={titleByPath}
          onFilterChange={setEventFilter}
          onClearProject={() => setSelectedProject(null)}
          onOpenSession={onOpenSession}
        />
      </div>
    </>
  );
}

function ReadoutStrip({
  readouts,
  rows,
  report
}: {
  readouts: BillingWindowReadouts;
  rows: readonly SessionRow[];
  report: ConsoleReport;
}) {
  const active = readouts.active;
  const used = active ? totalsSum(active.totals) : null;
  const remaining =
    active && active.end > report.now ? `距关闭还剩 ${formatDuration(active.end - report.now)}` : "窗口已关闭";

  return (
    <dl className={styles.readoutStrip}>
      <Readout
        id="window"
        label="本窗口已用"
        value={used === null ? "暂无活动窗口" : formatTokenCount(used)}
        title={used === null ? undefined : String(used)}
        sub={used === null ? "最近 5 小时没有计费窗口" : remaining}
        muted={used === null}
      />
      <Readout
        id="today"
        label="今天"
        value={formatTokenCount(report.todayTokens)}
        title={String(report.todayTokens)}
        sub="本地自然日 · 00:00 至今"
      />
      <Readout
        id="active-sessions"
        label="活跃会话"
        value={String(rows.length)}
        sub="最近 5 小时有新记录"
      />
      <Readout
        id="today-compactions"
        label="今天压缩"
        value={String(report.todayCompactions)}
        sub="自动 + 手动"
      />
    </dl>
  );
}

function Readout({
  id,
  label,
  value,
  title,
  sub,
  muted = false
}: {
  id: string;
  label: string;
  value: string;
  title?: string;
  sub: string;
  muted?: boolean;
}) {
  return (
    <div className={styles.readoutCell} data-probe="monitor-console-readout" data-readout={id}>
      <dt className={styles.readoutLabel}>{label}</dt>
      <dd>
        <b
          className={muted ? styles.readoutValueMuted : styles.readoutValue}
          {...(title === undefined ? {} : { title })}
        >
          {value}
        </b>
        <span className={styles.readoutSub}>{sub}</span>
      </dd>
    </div>
  );
}

function ActivityPanel({ hours }: { hours: readonly ConsoleHour[] }) {
  const max = Math.max(0, ...hours.map((hour) => hour.tokens));
  const peak = hours.reduce<ConsoleHour | null>(
    (winner, hour) => (winner === null || hour.tokens > winner.tokens ? hour : winner),
    null
  );
  const current = hours.find((hour) => hour.phase === "current") ?? null;
  const allZero = hours.every((hour) => hour.tokens === 0);
  const summary = allZero
    ? "今天还没有 token 记录。"
    : `今天 24 小时的 token 量；峰值 ${formatTokenCount(peak?.tokens ?? 0)} 在 ${peak ? new Date(peak.hourStart).getHours() : 0} 点；当前 ${current ? new Date(current.hourStart).getHours() : 0} 点进行中，已记录 ${formatTokenCount(current?.tokens ?? 0)}；未来小时未计入。`;
  const action = allZero
    ? "今天 0 token"
    : `峰值 ${new Date(peak!.hourStart).getHours()} 点 · ${formatTokenCount(peak!.tokens)}`;

  return (
    <Panel title="24 小时活动" ariaLabel="24 小时活动" actions={<span className={styles.panelAction}>{action}</span>}>
      <div
        className={styles.hours}
        data-probe="monitor-console-hours"
        data-bucket-count={hours.length}
        role="img"
        aria-label={summary}
      >
        {hours.map((hour) => (
          <HourSlot key={hour.hourStart} hour={hour} max={max} />
        ))}
      </div>
      <div className={styles.hourAxis} aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <p className={styles.caption}>
        每根柱是一小时四类 token 之和；斜纹且虚线的这一小时还在进行中，高度是已记录值，不外推。
      </p>
    </Panel>
  );
}

function HourSlot({ hour, max }: { hour: ConsoleHour; max: number }) {
  const time = new Date(hour.hourStart).getHours();
  const isEmptyPast = hour.phase === "past" && hour.tokens === 0;
  const title =
    hour.phase === "future"
      ? `${String(time).padStart(2, "0")} 点 · 尚未到达`
      : `${String(time).padStart(2, "0")} 点 · ${formatTokenCount(hour.tokens)} token${hour.phase === "current" ? "（进行中）" : ""}`;
  const height =
    hour.tokens === 0 || max <= 0 ? "2px" : `${Math.max(2, (hour.tokens / max) * 100)}%`;

  return (
    <div
      className={styles.hourSlot}
      data-probe="monitor-console-hour-slot"
      data-state={hour.phase}
      data-partial={hour.partial ? "true" : "false"}
      data-zero={hour.phase !== "future" && hour.tokens === 0 ? "true" : "false"}
      title={title}
    >
      <span
        className={styles.hourBar}
        data-probe="monitor-console-hour"
        data-phase={hour.phase}
        aria-hidden="true"
      >
        {hour.phase === "future" ? null : (
          <span
            className={styles.hourFill}
            data-probe="monitor-console-hour-fill"
            data-partial={hour.partial ? "true" : "false"}
            data-empty={isEmptyPast ? "true" : "false"}
            style={{ height }}
          />
        )}
      </span>
    </div>
  );
}

function ProjectPanel({
  projects,
  selected,
  onSelect
}: {
  projects: readonly ConsoleProject[];
  selected: string | null;
  onSelect: (projectLabel: string) => void;
}) {
  const maxRate = Math.max(0, ...projects.map((project) => project.ratePerHour));

  return (
    <div className={styles.projectPanel} data-probe="monitor-console-projects">
      <Panel title="项目热度" ariaLabel="项目热度">
        {projects.length === 0 ? (
          <EmptyState size="inline" title="今天还没有项目活动" />
        ) : (
          <ul className={styles.projectList}>
            {projects.map((project) => {
              const label = formatProjectPath(project.projectLabel, project.projectPath);
              const isSelected = project.projectLabel === selected;
              const ratio = maxRate > 0 ? Math.max(0, Math.min(1, project.ratePerHour / maxRate)) : 0;
              return (
                <li key={project.projectLabel}>
                  <button
                    type="button"
                    className={styles.projectRow}
                    data-probe="monitor-console-project-row"
                    data-project={project.projectLabel}
                    data-selected={isSelected ? "true" : "false"}
                    aria-pressed={isSelected}
                    aria-label={`${label}，近 15 分钟 ${formatTokenCount(project.ratePerHour)}/时，今日 ${formatTokenCount(project.todayTokens)} token，${project.activeSessions} 个活跃会话`}
                    title={isSelected ? `取消筛选 ${label}` : `筛选 ${label} 的事件`}
                    onClick={() => onSelect(project.projectLabel)}
                  >
                    <span className={styles.projectTop}>
                      <span className={styles.projectName}>{label}</span>
                      <span className={styles.projectMetric}>{`${formatTokenCount(project.ratePerHour)}/时`}</span>
                      <span className={styles.projectMetric}>
                        {`今日 ${formatTokenCount(project.todayTokens)}`}
                      </span>
                      <span className={styles.projectMetric}>{`${project.activeSessions} 会话`}</span>
                    </span>
                    <span className={styles.projectBarShell} aria-hidden="true">
                      {project.ratePerHour > 0 && maxRate > 0 ? (
                        <span
                          className={styles.projectFill}
                          data-probe="monitor-console-project-fill"
                          style={{ width: `${ratio * 100}%` }}
                        />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function EventPanel({
  events,
  selectedProject,
  filter,
  titleByPath,
  onFilterChange,
  onClearProject,
  onOpenSession
}: {
  events: readonly ConsoleEvent[];
  selectedProject: ConsoleProject | null;
  filter: EventFilter;
  titleByPath: ReadonlyMap<string, string>;
  onFilterChange: (filter: EventFilter) => void;
  onClearProject: () => void;
  onOpenSession?: (path: string) => void;
}) {
  const selectedLabel = selectedProject
    ? formatProjectPath(selectedProject.projectLabel, selectedProject.projectPath)
    : null;
  const actions = (
    <div className={styles.eventActions}>
      <span data-probe="monitor-console-event-filter">
        <SegmentedControl
          items={EVENT_FILTERS}
          value={filter}
          onChange={onFilterChange}
          ariaLabel="事件类型"
          role="radiogroup"
        />
      </span>
      {selectedLabel ? (
        <>
          <span className={styles.projectFilter} title={selectedLabel}>
            {`项目：${selectedLabel}`}
          </span>
          <Button type="button" variant="ghost" onClick={onClearProject}>
            清除
          </Button>
        </>
      ) : null}
    </div>
  );

  return (
    <div className={styles.eventPanel}>
      <Panel title="事件流" ariaLabel="事件流" actions={actions}>
        {events.length === 0 ? (
          <EmptyState size="inline" title="这个筛选条件下没有今天的事件" />
        ) : (
          <div className={styles.eventList}>
            {events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                sessionTitle={titleByPath.get(event.sessionPath) ?? event.sessionTitle}
                onOpenSession={onOpenSession}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function EventRow({
  event,
  sessionTitle,
  onOpenSession
}: {
  event: ConsoleEvent;
  sessionTitle: string;
  onOpenSession?: (path: string) => void;
}) {
  const presentation = eventPresentation(event);
  const project = formatProjectPath(event.projectLabel, event.projectPath);
  const accessibleKind = EVENT_KIND_LABEL[event.kind];
  const label = `${formatClock(event.at)} · ${project} · ${sessionTitle} · ${accessibleKind} · ${presentation.detail}`;

  return (
    <button
      type="button"
      className={styles.eventRow}
      data-probe="monitor-console-event-row"
      data-kind={event.kind}
      title={presentation.detail}
      aria-label={label}
      onClick={() => onOpenSession?.(event.sessionPath)}
    >
      <span className={styles.eventTime} data-slot="time">
        {formatClock(event.at)}
      </span>
      <span
        className={`${styles.eventGlyph} ${event.kind === "error" ? styles.eventGlyphDanger : ""}`}
        data-slot="glyph"
        aria-hidden="true"
      >
        {presentation.glyph}
      </span>
      <span className={styles.eventProject} data-slot="project" title={project}>
        {project}
      </span>
      <span className={styles.eventTitle} data-slot="title" title={sessionTitle}>
        {sessionTitle}
      </span>
      <span
        className={styles.eventDetail}
        data-slot="detail"
        data-probe="monitor-console-event-detail"
        title={presentation.detail}
      >
        {presentation.detail}
      </span>
    </button>
  );
}

function eventPresentation(event: ConsoleEvent): {
  glyph: string;
  detail: string;
} {
  if (event.kind === "compaction") {
    const trigger =
      event.detail === "auto" ? "自动" : event.detail === "manual" ? "手动" : event.detail || "触发未知";
    const before =
      event.preTokens === null ? "压缩前未知" : `压缩前 ${formatTokenCount(event.preTokens)}`;
    return { glyph: "⇣", detail: `${trigger} · ${before}` };
  }
  if (event.kind === "error") {
    return {
      glyph: "!",
      detail: `${event.detail || "未知工具"} · ${event.preview || "无错误文本"}`
    };
  }
  return { glyph: "＋", detail: "首条记录" };
}
