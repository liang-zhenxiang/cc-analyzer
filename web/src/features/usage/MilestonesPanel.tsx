import type { ReactNode } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatDuration, formatFullDate, formatTokenCount } from "../../lib/format";
import type {
  MilestoneFirst,
  MilestoneFirstKind,
  MilestoneMetric,
  MilestoneRecord,
  MilestoneRecordKind,
  MilestoneReport,
  MilestoneTier
} from "./milestones";
import styles from "./MilestonesPanel.module.css";

/**
 * 「里程碑」（Issue #214，规格 design-round-y §4–§7）。
 *
 * 组件**只吃 `MilestoneReport`**：达成与否、到下一档的距离、哪几枚缺席，全部由
 * 纯逻辑层（`milestones.ts`）判好。这里只做三件事——排版、把 `role="progressbar"`
 * 的真值语义挂上去、把入口交回页面。
 *
 * 三组（首次 / 累计阶梯 / 单会话记录）住在三张 `Panel` 里，**单元自身无框**：
 * `Panel` 体里不出现第二层卡片或内嵌块，层级语言只有网格 gap（Round W §1.3）。
 */

/** 缺席说明里的短名（「本机日志里没有 skill、MCP 工具的调用记录」）。 */
const FIRST_SUBJECT: Record<MilestoneFirstKind, string> = {
  session: "会话",
  compaction: "压缩",
  subagent: "子 agent",
  skill: "skill",
  mcp: "MCP 工具"
};

/** 口径行（每枚一条）：这一枚的事实是从哪条记录折出来的。 */
const FIRST_NOTE: Record<MilestoneFirstKind, string> = {
  session: "会话日志的首条记录",
  compaction: "首个压缩边界记录",
  subagent: "首个 Agent / Task 调用",
  skill: "首个 Skill 工具调用",
  mcp: "首个 mcp__ 前缀调用"
};

const TIER_NOTE: Record<MilestoneMetric, string> = {
  tokens: "四类 token 之和",
  sessions: "本地日志去重会话",
  messages: "用户与助手消息",
  projects: "去重项目目录",
  models: "去重模型 id",
  compactions: "压缩边界记录",
  tools: "去重工具名"
};

const RECORD_SUBJECT: Record<MilestoneRecordKind, string> = {
  tokens: "最多 Token",
  duration: "最长时长",
  compactions: "最多压缩次数"
};

const RECORD_NOTE: Record<MilestoneRecordKind, string> = {
  tokens: "单会话四类之和最大",
  duration: "首末记录时间差最大",
  compactions: "单会话边界记录最多"
};

/** 三张面板的脚注（§5.4 逐字）。 */
const GROUP_FOOTNOTE = {
  firsts: "只列出本机日志里真实发生过的第一次；没有记录的第一次不占位。",
  tiers:
    "档位是写死的常量；距离 = 下一档门槛 − 当前值。数字与用量总览的 KPI 出自同一份已扫描会话与同一个求和函数。",
  records: "只算单会话；单日口径已在「消耗日历 / 一年洞察」承载。并列时取更早达成的那一个。"
} as const;

/** 「这 N 枚不列」的中文数目（首次类最多五枚，记录类三枚）。 */
const COUNT_WORD: readonly string[] = ["", "一", "两", "三", "四", "五"];

const FIRST_KINDS: readonly MilestoneFirstKind[] = [
  "session",
  "compaction",
  "subagent",
  "skill",
  "mcp"
];
const RECORD_KINDS: readonly MilestoneRecordKind[] = ["tokens", "duration", "compactions"];

/** 完整日期句：`title` / 可访问名用（年号必须有可靠落点，同日历的立场）。 */
function dateSentence(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 阶梯读数：token 走 `formatTokenCount`，其余计数走 en-US 分组（§5.2）。 */
function tierText(metric: MilestoneMetric, value: number): string {
  return metric === "tokens" ? formatTokenCount(value) : value.toLocaleString("en-US");
}

/** 记录类读数：值本身是什么量，就走那把尺（§5.2）。 */
function recordText(item: MilestoneRecord): string {
  if (item.kind === "tokens") return formatTokenCount(item.value);
  if (item.kind === "duration") return formatDuration(item.value);
  return item.value.toLocaleString("en-US");
}

/**
 * 证据行：一枚 `◆` 记号 + 目标名，整行是一个控件。
 *
 * 目标优先级（§5.2）：有会话元数据（`path`）→ 打开那个会话；没有则退到「那一天」
 * 的一日回望；两者都交不出去时渲染成 `<span>` 而不是 disabled 按钮——点了没有任何
 * 反馈的控件是坏交互（`InsightDate` 的既有立场）。
 */
function Evidence({
  name,
  path,
  dayStart,
  dayLabel,
  onOpenSession,
  onOpenDay
}: {
  name: string;
  path: string;
  dayStart: number;
  dayLabel: string;
  onOpenSession?: (path: string) => void;
  onOpenDay?: (dayStart: number) => void;
}): ReactNode {
  const body = (
    <>
      <span className={styles.diamond} aria-hidden="true">
        ◆
      </span>
      <span className={styles.evidenceName}>{name}</span>
    </>
  );

  if (path !== "" && onOpenSession) {
    return (
      <button
        type="button"
        className={styles.evidence}
        data-probe="milestone-entry"
        aria-label={`打开会话：${name}`}
        title={`打开会话 · ${name} · ${dayLabel}`}
        onClick={() => onOpenSession(path)}
      >
        {body}
      </button>
    );
  }

  if (onOpenDay) {
    return (
      <button
        type="button"
        className={styles.evidence}
        data-probe="milestone-entry"
        aria-label={`打开 ${dayLabel} 的一日回望`}
        title={`打开 ${dayLabel} 的一日回望`}
        onClick={() => onOpenDay(dayStart)}
      >
        {body}
      </button>
    );
  }

  return <span className={styles.evidenceStatic}>{body}</span>;
}

/** 锚点类（首次 / 记录）：名称 → 值（+ 副读数）→ 证据行 → 口径行。 */
function AnchorTile({
  milestoneKey,
  name,
  valueText,
  valueTitle,
  subread,
  evidence,
  note
}: {
  milestoneKey: string;
  name: string;
  valueText: string;
  valueTitle: string;
  subread?: ReactNode;
  evidence: ReactNode;
  note: string;
}) {
  return (
    <li
      className={styles.tile}
      data-probe="milestone-card"
      data-milestone={milestoneKey}
      data-state="reached"
    >
      <span className={styles.name} data-probe="milestone-name">
        {name}
      </span>
      <span className={styles.valueRow}>
        {/* 值槽：达成项与未达成项同字号、同字重、同一个 --text——把事实降一档
            就是灰度剪影的第一步（R4 / §15.2）。 */}
        <span className={styles.value} data-probe="milestone-value" title={valueTitle}>
          {valueText}
        </span>
        {subread}
      </span>
      <span className={styles.evidenceRow} data-probe="milestone-evidence">
        {evidence}
      </span>
      <span className={styles.note} data-probe="milestone-note" title={note}>
        {note}
      </span>
    </li>
  );
}

function FirstTile({
  item,
  onOpenSession,
  onOpenDay
}: {
  item: MilestoneFirst;
  onOpenSession?: (path: string) => void;
  onOpenDay?: (dayStart: number) => void;
}) {
  return (
    <AnchorTile
      milestoneKey={`first-${item.kind}`}
      name={item.label}
      valueText={formatFullDate(item.at)}
      valueTitle={dateSentence(item.at)}
      evidence={
        <Evidence
          // §5.2：证据行写**那一刻的目标名**——skill 名 / `server/tool` / 子 agent
          // 类型；会话与压缩没有目标名，才退回会话标题。五行写同一句会话标题是
          // Issue #214 抓到的缺陷（名字本来就跟着那次调用一起被折出来了）。
          name={item.detail ?? item.session.title}
          path={item.session.path}
          dayStart={item.dayStart}
          dayLabel={dateSentence(item.dayStart)}
          onOpenSession={onOpenSession}
          onOpenDay={onOpenDay}
        />
      }
      note={FIRST_NOTE[item.kind]}
    />
  );
}

function RecordTile({
  item,
  onOpenSession,
  onOpenDay
}: {
  item: MilestoneRecord;
  onOpenSession?: (path: string) => void;
  onOpenDay?: (dayStart: number) => void;
}) {
  /**
   * 记录类的日期是它的坐标，也是「那一天」在卡片上唯一自然的落点（首次类的值
   * 本身就是日期，把值槽变成控件比这更坏）。
   *
   * 证据行优先打开会话，所以**只要会话元数据在场，退到「那一天」的分支就不可达**
   * ——这个下钻会退化成死代码。日期因此自成一个可点入口（沿用日历洞察句「日期即
   * 链接」的既有立场）；没有 `onOpenDay`（单测直挂组件）时仍是纯读数。
   */
  const dayLabel = dateSentence(item.dayStart);
  const subread =
    onOpenDay === undefined ? (
      <span
        className={styles.subread}
        data-probe="milestone-subread"
        data-kind="date"
        title={dayLabel}
        aria-label={dayLabel}
      >
        {formatFullDate(item.dayStart)}
      </span>
    ) : (
      <button
        type="button"
        // 焦点环复用证据行那条 `:focus-visible` 规则（focusRing.test.ts 按规则数
        // 收口，这里不新增消费者）；`.dateLink` 只管形与手感。
        className={`${styles.evidence} ${styles.dateLink}`}
        data-probe="milestone-subread"
        data-kind="date"
        title={`${dayLabel} · 打开一日回望`}
        aria-label={`打开 ${dayLabel} 的一日回望`}
        onClick={() => onOpenDay(item.dayStart)}
      >
        {formatFullDate(item.dayStart)}
      </button>
    );

  return (
    <AnchorTile
      milestoneKey={`record-session-${item.kind}`}
      name={item.label}
      valueText={recordText(item)}
      valueTitle={String(item.value)}
      subread={subread}
      evidence={
        <Evidence
          name={item.session.title}
          path={item.session.path}
          dayStart={item.dayStart}
          dayLabel={dayLabel}
          onOpenSession={onOpenSession}
          onOpenDay={onOpenDay}
        />
      }
      note={RECORD_NOTE[item.kind]}
    />
  );
}

/**
 * 阶梯类：名称 → 值（+ 档位读数）→ 距离条 → 距离行 → 口径行。
 *
 * 两态的差别只有两处（§1.2）：**填充元素在不在**（0px 对 ≥2px 是一个布尔几何
 * 事实）与**档位读数**（`0/4 档` 对 `3/4 档`）。未达成项的当前值一个字都不降权。
 */
function TierTile({ item }: { item: MilestoneTier }) {
  const total = item.tiers.length;
  const reachedCount = item.reachedIndex + 1;
  const reached = reachedCount > 0;
  const next = item.next;
  // 本档 → 下一档的 band 进度（§2.2）：不画「当前值 ÷ 最终档」的全程进度——
  // 刚起步时那会变成一根毫毛，把「我在这一档里走了多远」埋掉。
  const bandStart = reached ? item.tiers[item.reachedIndex] : 0;
  const ratio = next === null ? 1 : (item.current - bandStart) / (next - bandStart);
  const fillPercent = Math.max(0, Math.min(1, ratio)) * 100;

  const track =
    next === null ? (
      // 已达最高档：`min === max` 的进度条是一个假控件，语义交给距离行。
      <span className={styles.track} data-probe="milestone-track" aria-hidden="true">
        {reached ? (
          <span
            className={styles.fill}
            data-probe="milestone-fill"
            style={{ width: `${fillPercent}%` }}
          />
        ) : null}
      </span>
    ) : (
      <span
        className={styles.track}
        data-probe="milestone-track"
        role="progressbar"
        aria-valuemin={bandStart}
        aria-valuemax={next}
        aria-valuenow={item.current}
        aria-valuetext={`${tierText(item.metric, item.current)}，距 ${tierText(item.metric, next)} 还差 ${tierText(item.metric, next - item.current)}`}
      >
        {reached ? (
          <span
            className={styles.fill}
            data-probe="milestone-fill"
            style={{ width: `max(2px, ${fillPercent}%)` }}
          />
        ) : null}
      </span>
    );

  return (
    <li
      className={styles.tile}
      data-probe="milestone-card"
      data-milestone={`tier-${item.metric}`}
      data-state={reached ? "reached" : "unreached"}
    >
      <span className={styles.name} data-probe="milestone-name">
        {item.label}
      </span>
      <span className={styles.valueRow}>
        <span
          className={styles.value}
          data-probe="milestone-value"
          title={String(item.current)}
        >
          {tierText(item.metric, item.current)}
        </span>
        {/* 档位读数恒在场：没有颜色的时候，状态也读得出来（§15.2②）。 */}
        <span
          className={styles.subread}
          data-probe="milestone-subread"
          data-kind="tier"
          title={`已达 ${reachedCount} / ${total} 档`}
        >
          {`${reachedCount}/${total} 档`}
        </span>
      </span>
      <span className={styles.trackShell}>{track}</span>
      <span className={styles.distance} data-probe="milestone-distance">
        {next === null
          ? "已到最高档"
          : `还差 ${tierText(item.metric, next - item.current)} 到 ${tierText(item.metric, next)}`}
      </span>
      <span className={styles.note} data-probe="milestone-note" title={TIER_NOTE[item.metric]}>
        {TIER_NOTE[item.metric]}
      </span>
    </li>
  );
}

export function MilestonesPanel({
  report,
  onOpenSession,
  onOpenDay
}: {
  /** 纯逻辑层折好的全历史报告；组件不做任何判定。 */
  report: MilestoneReport;
  /** 首次 / 记录类入口：把会话 path 交回页面，由页面换成 `SessionMeta` 后走既有握手。 */
  onOpenSession?: (path: string) => void;
  /** 那一日的「一日回望」下钻；没有会话元数据但有日期时的退路。 */
  onOpenDay?: (dayStart: number) => void;
}) {
  if (report.empty) {
    // 0 个会话：整块一条事实行，三张 Panel 一张都不渲染。页面**故意**不在里程碑档
    // 拦这一条（design §4.1 第 3 条）——用量档那句「还没有可统计的会话」不是这一档的
    // 语言，所以这个分支在里程碑档是正常可达的。
    return (
      <div className={styles.milestones} data-probe="milestones-view">
        <div className={styles.emptyStage} data-probe="milestones-empty">
          <EmptyState
            size="page"
            title="还没有可以回顾的里程碑"
            description="本机 ~/.claude/projects 下没有会话记录。产生一次会话后，这一页会从日志里折出第一次、累计阶梯与单会话记录。"
          />
        </div>
      </div>
    );
  }

  const presentFirsts = new Set(report.firsts.map((item) => item.kind));
  const missingFirsts = FIRST_KINDS.filter((kind) => !presentFirsts.has(kind));
  const presentRecords = new Set(report.records.map((item) => item.kind));
  const missingRecords = RECORD_KINDS.filter((kind) => !presentRecords.has(kind));

  // 组内缺席：能算的照算，算不出的整枚不渲染 + 组脚注一行原因（§6 第 3 条）。
  const firstGap =
    missingFirsts.length > 0
      ? `本机日志里没有 ${missingFirsts
          .map((kind) => FIRST_SUBJECT[kind])
          .join("、")}的调用记录，这${COUNT_WORD[missingFirsts.length]}枚不列。`
      : null;
  const recordGap =
    report.records.length > 0 && missingRecords.length > 0
      ? `本机日志里没有 ${missingRecords
          .map((kind) => RECORD_SUBJECT[kind])
          .join("、")}的记录，这${COUNT_WORD[missingRecords.length]}枚不列。`
      : null;

  // 整组缺席：不渲染空货架，改由页尾一条事实行承担（§6 第 4 条）。
  const tailNotes: string[] = [];
  if (report.firsts.length === 0) {
    tailNotes.push(
      `本机日志里没有${missingFirsts
        .map((kind) => FIRST_SUBJECT[kind])
        .join(" / ")}记录，首次里程碑暂无可列的事实。`
    );
  }
  if (report.records.length === 0) {
    tailNotes.push(
      `本机日志里没有${missingRecords
        .map((kind) => RECORD_SUBJECT[kind])
        .join(" / ")}记录，单会话记录暂无可列的事实。`
    );
  }

  return (
    <div className={styles.milestones} data-probe="milestones-view">
      {/* 窗口声明（R2）：全历史、含归档、只对读到的日志负责。住页底 --bg 上，
          所以走 --text-secondary（--text-tertiary 在页底只有 4.38）。 */}
      <p className={styles.scope} data-probe="milestones-scope">
        {`全部已扫描的会话纳入统计：共 ${report.facts.sessionCount.toLocaleString("en-US")} 个，含本地归档；不含 Claude Code 已清理且未归档的会话。`}
      </p>

      {report.firsts.length > 0 ? (
        <div className={styles.group} data-probe="milestones-group" data-group="firsts">
          <Panel title="首次" ariaLabel="首次">
            <ul className={`${styles.tiles} ${styles.anchorTiles}`}>
              {report.firsts.map((item) => (
                <FirstTile
                  key={item.kind}
                  item={item}
                  onOpenSession={onOpenSession}
                  onOpenDay={onOpenDay}
                />
              ))}
            </ul>
            {firstGap ? (
              <p className={styles.gapNote} data-probe="milestones-gap-note">
                {firstGap}
              </p>
            ) : null}
            <p className={styles.footnote} data-probe="milestones-fallback">
              {GROUP_FOOTNOTE.firsts}
            </p>
          </Panel>
        </div>
      ) : null}

      {report.tiers.length > 0 ? (
        <div className={styles.group} data-probe="milestones-group" data-group="tiers">
          <Panel title="累计阶梯" ariaLabel="累计阶梯">
            <ul className={`${styles.tiles} ${styles.tierTiles}`}>
              {report.tiers.map((item) => (
                <TierTile key={item.metric} item={item} />
              ))}
            </ul>
            <p className={styles.footnote} data-probe="milestones-fallback">
              {GROUP_FOOTNOTE.tiers}
            </p>
          </Panel>
        </div>
      ) : null}

      {report.records.length > 0 ? (
        <div className={styles.group} data-probe="milestones-group" data-group="records">
          <Panel title="单会话记录" ariaLabel="单会话记录">
            <ul className={`${styles.tiles} ${styles.anchorTiles}`}>
              {report.records.map((item) => (
                <RecordTile
                  key={item.kind}
                  item={item}
                  onOpenSession={onOpenSession}
                  onOpenDay={onOpenDay}
                />
              ))}
            </ul>
            {recordGap ? (
              <p className={styles.gapNote} data-probe="milestones-gap-note">
                {recordGap}
              </p>
            ) : null}
            <p className={styles.footnote} data-probe="milestones-fallback">
              {GROUP_FOOTNOTE.records}
            </p>
          </Panel>
        </div>
      ) : null}

      {tailNotes.length > 0 ? (
        <div className={styles.group}>
          {tailNotes.map((text) => (
            <p key={text} className={styles.tailNote} data-probe="milestones-gap-note">
              {text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
