import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { ScrollArea } from "../../components/ScrollArea";
import { formatDuration, formatShortStamp } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import {
  ECHO_WARNING_TEXT,
  HANDOFF_VISIBLE_SESSIONS,
  formatEchoAria,
  formatEchoLine,
  formatLastAction,
  type EchoReading,
  type HandoffSession,
  type LastAction,
  type ProjectHandoff
} from "./projectHandoff";
import styles from "./ProjectHandoffPanel.module.css";

/**
 * 项目接续（Issue #397）：一个项目、一条时间序列、一串会话节点。
 *
 * 卡片回答「上次做到哪了」——每次会话结束时停在哪一步、两次之间隔了多久、
 * 这次开头有没有把上次结尾重新交代一遍。纯函数层在 `projectHandoff.ts`，
 * 组件不拼句、不重算间距：`gapPx` / `gapLabel` / `formatEchoLine` 都由模型层
 * 给出，这里只负责排版与键盘。
 *
 * 几条会坏事的决定：
 * - **间距用模型层的对数映射**，不在组件里重算。线性轴会让密集的一周挤成
 *   一个点、稀疏的三个月吃掉全幅；等距会直接抹掉「隔了多久」。
 * - **整条轨道一个 Tab 止点**（`role="listbox"` + `tabIndex=0`）。节点是
 *   `role="option"`、不各自进 Tab 序——WKWebView 里大量可聚焦子元素不可靠。
 * - **重复交代是事实不是警报**：命中只画 6px 空心圆，分数用正文墨色；
 *   全卡唯一的语义色 `--warning` 只染「样本不足」四个字。
 * - **节点不写死高度**：`min-height: 72`，130% 字号或「进行中」折行时节点
 *   自己长高，轨道取最高节点；标题与动作只做单行省略，全文留在
 *   `title` / `aria-label` 与详情头。
 */

const NODE_W = 176;
const TRACK_PAD_X = 12;

const EMPTY_SESSIONS: HandoffSession[] = [];

const FOOTNOTE_BASE =
  "节点之间是相邻两次会话的开始时刻之差；间距按相隔时长取对数（每翻一倍多 8px），不是等比例，文字里的本地自然日间隔才是准确值。节点左缘中点的空心圆表示本次开头与上次结尾重合达到 55% 阈值。「进行中」= 最后一条记录距现在不超过 2 分钟，只说明日志刚被写入，不代表进程仍在运行。文件名只取 basename，命令只取前 3 个 token，消息已脱敏并截断 60 字。";

const FOOTNOTE_PRIVACY =
  "只读本机日志；文件名只取 basename，命令只取前 3 个 token，消息已脱敏并截断 60 字。";

function percentText(percent: number | "lt1"): string {
  return percent === "lt1" ? "<1%" : `${percent}%`;
}

/** 选中节点的 live region 播报（§6.5）。 */
function selectionSentence(session: HandoffSession): string {
  const head = `已选 ${formatShortStamp(session.startTs)} 的会话：${session.title}；最后动作 ${formatLastAction(
    session.lastAction
  )}；`;
  switch (session.echo.status) {
    case "scored":
      return `${head}本次开头与上次结尾重合 ${percentText(session.echo.percent)}。`;
    case "insufficient":
      return `${head}重合度样本不足。`;
    case "no-previous":
      return `${head}这是窗口内这个项目最早的一次会话。`;
  }
}

/** 节点的 `aria-label` / `title`（§6.1 / §6.5）：时刻、标题、动作、重合度、进行中。 */
function nodeLabel(session: HandoffSession): string {
  const echo = formatEchoAria(session.echo);
  return [
    formatShortStamp(session.startTs),
    session.title,
    `最后动作 ${formatLastAction(session.lastAction)}`,
    ...(echo === null ? [] : [echo]),
    ...(session.inProgress ? ["进行中"] : [])
  ].join("，");
}

function nodeTitle(session: HandoffSession): string {
  const echo = formatEchoAria(session.echo);
  return [
    formatShortStamp(session.startTs),
    session.title,
    `最后动作 ${formatLastAction(session.lastAction)}`,
    ...(echo === null ? [] : [echo])
  ].join(" · ");
}

/**
 * 动作的三行式渲染：动词 / 工具名弱一档，文件与命令用等宽字。
 * `无工具调用` 是正文事实，不用等宽、不用「暂无」。
 */
function ActionText({ action }: { action: LastAction }) {
  if (action.kind === "none") {
    return <span className={styles.actionNone}>无工具调用</span>;
  }
  if (action.kind === "file") {
    return (
      <>
        <span className={styles.actionVerb}>{action.verb}</span>{" "}
        <span className={styles.actionTarget}>{action.name}</span>
      </>
    );
  }
  if (action.kind === "command") {
    return (
      <>
        <span className={styles.actionVerb}>Bash ·</span>{" "}
        <span className={styles.actionTarget}>{action.command}</span>
      </>
    );
  }

  const [tool, ...rest] = action.tool.split(" · ");
  if (rest.length === 0) {
    return <span className={styles.actionVerb}>{action.tool}</span>;
  }
  return (
    <>
      <span className={styles.actionVerb}>{tool} ·</span>{" "}
      <span className={styles.actionTarget}>{rest.join(" · ")}</span>
    </>
  );
}

/**
 * 接续行：整句由 `formatEchoLine` 拼好，这里只给第一个百分比上墨色、
 * 第二个（阈值）退到第三级；`样本不足` 四个字是全卡唯一的语义色。
 */
function EchoLine({ reading }: { reading: EchoReading }) {
  const text = formatEchoLine(reading);
  if (text.startsWith(ECHO_WARNING_TEXT)) {
    return (
      <>
        <span className={styles.sampleWarning}>{ECHO_WARNING_TEXT}</span>
        {text.slice(ECHO_WARNING_TEXT.length)}
      </>
    );
  }

  const parts = text.split(/(<1%|\d+%)/g);
  let seen = 0;
  return (
    <>
      {parts.map((part, index) => {
        if (!/^(<1%|\d+%)$/.test(part)) return <span key={index}>{part}</span>;
        seen += 1;
        return (
          <span
            key={index}
            className={seen === 1 ? styles.echoPercent : styles.echoThreshold}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}

type Props = {
  handoff: ProjectHandoff;
  onOpenSession?: (session: SessionMeta) => void;
};

export function ProjectHandoffPanel({ handoff, onOpenSession }: Props) {
  const baseId = useId();
  const footnoteId = `${baseId}-footnote`;
  const keyHelpId = `${baseId}-keys`;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  /**
   * 展开 / 收起时的屏幕位置锚点：记下选中节点在滚动内容里的 offsetLeft 与当时
   * 的 scrollLeft，布局更新后把差值补回 scrollLeft——选中节点留在原地，新增
   * 内容出现在它的左边，而不是把视图甩到轨道尽头。
   */
  const anchorRef = useRef<{ id: string; offsetLeft: number; scrollLeft: number } | null>(
    null
  );
  /** 锚点已经调整过滚动位置时，跳过同一轮「滚到最右」的默认行为。 */
  const anchoredRef = useRef(false);

  const track = handoff.track;
  const sessions = track?.sessions ?? EMPTY_SESSIONS;
  const total = sessions.length;
  const projectKey = track?.project?.key ?? null;
  const projectName = track?.project?.name ?? "";

  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toggleAnnouncement, setToggleAnnouncement] = useState<string | null>(null);

  // 默认画最近 12 次；模型返回全部，展开只是一次渲染变化，不重算分数。
  const visible = useMemo(
    () => (expanded ? sessions : sessions.slice(-HANDOFF_VISIBLE_SESSIONS)),
    [expanded, sessions]
  );
  const hidden = total - visible.length;

  // 选中与键盘游标是**同一个状态**：不存在「焦点在 A、读数在 B」。
  // 选中的 id 被折叠或换项目裁掉时，回落到最右（最新）节点。
  const selected =
    visible.find((session) => session.id === selectedId) ??
    visible[visible.length - 1] ??
    null;
  const selectedIndex = selected === null ? -1 : visible.findIndex((s) => s.id === selected.id);

  useEffect(() => {
    if (selectedId === null) return;
    if (visible.some((session) => session.id === selectedId)) return;
    setSelectedId(visible[visible.length - 1]?.id ?? null);
  }, [visible, selectedId]);

  // 展开 / 收起后把选中节点的屏幕位置补回来：新增内容出现在它左边，视图不跳。
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (anchor === null) return;
    const node = nodeRefs.current.get(anchor.id);
    const element = scrollerRef.current;
    if (!node || !element) return;
    element.scrollLeft = anchor.scrollLeft + (node.offsetLeft - anchor.offsetLeft);
    anchoredRef.current = true;
  }, [expanded, visible]);

  // 打开卡片 / 切换项目 / 窗口或显示条数变化后滚到右端（最新）。窗口宽度
  // 变化不在依赖里：用户正看中间时拉回右端会很突兀；展开/收起的锚点调整
  // 已在布局阶段完成，这一轮不再覆盖它。
  useEffect(() => {
    if (anchoredRef.current) {
      anchoredRef.current = false;
      return;
    }
    const element = scrollerRef.current;
    if (!element) return;
    element.scrollLeft = element.scrollWidth;
  }, [projectKey, expanded, visible.length]);

  if (handoff.projects.length === 0 || track === null) return null;

  const openable = selected !== null && onOpenSession !== undefined && selected.meta !== undefined;
  const liveMessage = toggleAnnouncement ?? (selected === null ? "" : selectionSentence(selected));

  function select(id: string) {
    setSelectedId(id);
    setToggleAnnouncement(null);
  }

  function moveTo(id: string) {
    select(id);
    nodeRefs.current.get(id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function captureAnchor() {
    if (selected === null) return;
    const node = nodeRefs.current.get(selected.id);
    const element = scrollerRef.current;
    if (!node || !element) return;
    anchorRef.current = {
      id: selected.id,
      offsetLeft: node.offsetLeft,
      scrollLeft: element.scrollLeft
    };
  }

  function handleToggle() {
    const next = !expanded;
    const nextVisible = next ? sessions : sessions.slice(-HANDOFF_VISIBLE_SESSIONS);
    const selectedWillHide =
      selectedId !== null && !nextVisible.some((session) => session.id === selectedId);
    if (selectedWillHide) {
      // 选中项将被折叠进隐藏段：回落到最右（最新），并滚到右端。
      setSelectedId(nextVisible[nextVisible.length - 1]?.id ?? null);
    } else {
      // 选中项仍可见：记住它现在的位置，布局更新后补回滚动差。
      captureAnchor();
    }
    setExpanded(next);
    setToggleAnnouncement(
      next
        ? `已显示全部 ${total} 次会话。`
        : `只看最近 ${HANDOFF_VISIBLE_SESSIONS} 次会话。`
    );
  }

  function handleTrackKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (selected === null) return;
    const last = visible.length - 1;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        moveTo(visible[Math.max(0, selectedIndex - 1)].id);
        return;
      case "ArrowRight":
        event.preventDefault();
        moveTo(visible[Math.min(last, selectedIndex + 1)].id);
        return;
      case "Home":
        event.preventDefault();
        moveTo(visible[0].id);
        return;
      case "End":
        event.preventDefault();
        moveTo(visible[last].id);
        return;
      case "Enter":
        if (!openable || onOpenSession === undefined || selected.meta === undefined) return;
        event.preventDefault();
        onOpenSession(selected.meta);
        return;
      default:
        return;
    }
  }

  // 节点中心 x（相对轨道 padding box）：首节点 12 + 88；之后每次加
  // 176 + gapPx。只用于间隔标签与基线的绝对定位。
  const centers = useMemo(() => {
    const result: number[] = [];
    let x = TRACK_PAD_X + NODE_W / 2;
    visible.forEach((session, index) => {
      if (index > 0) x += NODE_W + (session.gapPx ?? 0);
      result.push(x);
    });
    return result;
  }, [visible]);

  const headerMeta = (
    <div className={styles.headerMeta}>
      <span className={styles.headerProject} title={projectName}>
        {projectName}
      </span>
      <span aria-hidden="true">·</span>
      <span className={styles.headerCount} data-probe="handoff-count">
        <span className={styles.headerCountValue}>{total}</span> 次会话
      </span>
      {total > HANDOFF_VISIBLE_SESSIONS ? (
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={expanded}
          data-probe="handoff-toggle"
          onClick={handleToggle}
        >
          {expanded ? `只看最近 ${HANDOFF_VISIBLE_SESSIONS} 次` : "显示全部"}
        </button>
      ) : null}
    </div>
  );

  const emptyReason = track.emptyReason;

  return (
    <div data-probe="project-handoff" data-handoff-hidden={hidden}>
      <Panel title="项目接续" ariaLabel="项目接续" titleAs="h2" actions={headerMeta}>
        {emptyReason === "single-session" && sessions[0] !== undefined ? (
          <SingleSession
            session={sessions[0]}
            unknownSessions={track.unknownSessions}
            onOpenSession={onOpenSession}
          />
        ) : emptyReason === "all-unknown" || emptyReason === "no-sessions" ? (
          <div data-probe="handoff-empty" data-handoff-empty={emptyReason}>
            <EmptyState
              size="inline"
              title="这个项目在窗口内没有可定位时间的会话"
            />
            {emptyReason === "all-unknown" ? (
              <p className={styles.emptyDescription}>
                {`${track.unknownSessions} 个会话缺少有效时间戳，画不出先后顺序。`}
              </p>
            ) : null}
            <p className={styles.footnote} id={footnoteId}>
              {FOOTNOTE_PRIVACY}
            </p>
          </div>
        ) : (
          <>
            <ScrollArea scrollerRef={scrollerRef} className={styles.scroller}>
              <div
                className={styles.track}
                role="listbox"
                tabIndex={0}
                aria-label="项目接续轨道（可交互）"
                aria-orientation="horizontal"
                aria-activedescendant={selected === null ? undefined : `${baseId}-node-${selectedIndex}`}
                aria-describedby={`${keyHelpId} ${footnoteId}`}
                data-probe="handoff-track"
                onKeyDown={handleTrackKeyDown}
              >
                {/* 间隔标签带：住在基线上方的独立一层，允许比间隔宽；
                    背景 --bg-subtle 在基线上「打洞」。 */}
                <div className={styles.labels} aria-hidden="true">
                  {visible.map((session, index) =>
                    index === 0 || session.gapLabel === null ? null : (
                      <span
                        key={`${session.id}-gap`}
                        className={styles.gapLabel}
                        style={{ left: centers[index] - NODE_W / 2 - (session.gapPx ?? 0) / 2 }}
                        title={
                          session.gapMs === null
                            ? undefined
                            : `相隔 ${formatDuration(session.gapMs)}`
                        }
                        data-handoff-gap={session.gapMs ?? undefined}
                      >
                        {session.gapLabel}
                      </span>
                    )
                  )}
                </div>

                {/* 基线：从首节点中心画到末节点中心，只有这一根横线。 */}
                {visible.length > 1 ? (
                  <div
                    className={styles.baseline}
                    aria-hidden="true"
                    style={{
                      left: centers[0],
                      width: Math.max(0, centers[centers.length - 1] - centers[0])
                    }}
                  />
                ) : null}

                <div className={styles.row}>
                  {visible.map((session, index) => {
                    const isSelected = selected !== null && session.id === selected.id;
                    const echoPercent =
                      session.echo.status === "scored" ? session.echo.percent : null;
                    const hit = session.echo.status === "scored" && session.echo.hit;
                    return (
                      <div key={session.id} className={styles.nodeSlot}>
                        {index > 0 && session.gapPx !== null ? (
                          <span
                            className={styles.gapSpacer}
                            style={{ width: session.gapPx }}
                            aria-hidden="true"
                          />
                        ) : null}
                        <div
                          ref={(element) => {
                            if (element) nodeRefs.current.set(session.id, element);
                            else nodeRefs.current.delete(session.id);
                          }}
                          id={`${baseId}-node-${index}`}
                          role="option"
                          aria-selected={isSelected}
                          aria-label={nodeLabel(session)}
                          title={nodeTitle(session)}
                          className={isSelected ? `${styles.node} ${styles.nodeSelected}` : styles.node}
                          data-handoff-node={session.id}
                          {...(isSelected ? { "data-handoff-selected": "" } : {})}
                          // 点击不移动 DOM 焦点：键盘焦点仍由 Tab 进入（与河流图同款）。
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => select(session.id)}
                        >
                          {hit ? (
                            <span
                              className={styles.echoRing}
                              aria-hidden="true"
                              data-handoff-echo={echoPercent ?? undefined}
                            />
                          ) : null}
                          <div className={styles.nodeTime}>
                            <span className={styles.stamp}>
                              {formatShortStamp(session.startTs)}
                            </span>
                            {session.inProgress ? (
                              <span className={styles.liveBadge} data-handoff-live="">
                                <span className={styles.liveDot} aria-hidden="true" />
                                进行中
                              </span>
                            ) : null}
                          </div>
                          <span className={styles.nodeTitle} title={session.title}>
                            {session.title}
                          </span>
                          <span
                            className={styles.nodeAction}
                            title={formatLastAction(session.lastAction)}
                          >
                            <ActionText action={session.lastAction} />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ScrollArea>

            <Detail
              session={selected}
              onOpenSession={onOpenSession}
              openingProbe="handoff-opening"
              closingProbe="handoff-closing"
            />

            <p className={styles.footnote} id={footnoteId}>
              {FOOTNOTE_BASE}
              {hidden > 0
                ? `另有 ${hidden} 个更早的会话未画出，点「显示全部」展开。`
                : ""}
              {track.unknownSessions > 0
                ? `另有 ${track.unknownSessions} 个会话没有可用时间戳，未画在轨道上。`
                : ""}
            </p>

            <p className={styles.srOnly} id={keyHelpId}>
              左右方向键在会话之间移动，Home / End 跳到最早 / 最新，Enter
              打开当前会话。
            </p>
            <p
              className={styles.srOnly}
              role="status"
              aria-live="polite"
              data-probe="handoff-live-region"
            >
              {liveMessage}
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}

/**
 * 单会话：不画一条没有间隔的轨道。卡内说明 + 一行事实 + 打开入口。
 */
function SingleSession({
  session,
  unknownSessions,
  onOpenSession
}: {
  session: HandoffSession;
  unknownSessions: number;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  return (
    <div data-probe="handoff-empty" data-handoff-empty="single-session">
      <p className={styles.singleTitle}>这个项目在窗口内只有一次会话，没有接续可看。</p>
      <div className={styles.singleFact}>
        <span className={styles.singleMeta}>
          {formatShortStamp(session.startTs)} ·{" "}
          <span className={styles.singleSessionTitle}>{session.title}</span> · 最后动作{" "}
          {formatLastAction(session.lastAction)}
        </span>
        {onOpenSession !== undefined && session.meta !== undefined ? (
          <button
            type="button"
            className={styles.openSession}
            data-probe="handoff-open-session"
            onClick={() => onOpenSession?.(session.meta!)}
          >
            打开会话 →
          </button>
        ) : null}
      </div>
      <p className={styles.footnote}>
        {FOOTNOTE_PRIVACY}
        {unknownSessions > 0 ? `另有 ${unknownSessions} 个会话没有可用时间戳。` : ""}
      </p>
    </div>
  );
}

/**
 * 接续读数（选中区）：常驻、不折叠。头行是标题 / 时间范围 / 打开会话，
 * 两段引文与接续行回答「上次停在哪、这次有没有重新交代」。
 */
function Detail({
  session,
  onOpenSession,
  openingProbe,
  closingProbe
}: {
  session: HandoffSession | null;
  onOpenSession?: (session: SessionMeta) => void;
  openingProbe: string;
  closingProbe: string;
}) {
  if (session === null) return null;

  const start = formatShortStamp(session.startTs);
  const end = formatShortStamp(session.endTs);
  const range =
    session.startTs < session.endTs
      ? `${start} → ${end} · ${formatDuration(session.endTs - session.startTs)}`
      : start;
  const rangeText = session.inProgress ? `${range} · 进行中` : range;
  const openable = onOpenSession !== undefined && session.meta !== undefined;

  return (
    <div className={styles.detail} role="group" aria-label="接续读数" data-probe="handoff-detail">
      <div className={styles.detailHead}>
        <span className={styles.detailTitle} title={session.title}>
          {session.title}
        </span>
        <span className={styles.range}>{rangeText}</span>
        {openable ? (
          <button
            type="button"
            className={styles.openSession}
            data-probe="handoff-open-session"
            onClick={() => onOpenSession?.(session.meta!)}
          >
            打开会话 →
          </button>
        ) : null}
      </div>

      <dl className={styles.quotes}>
        <div className={styles.quoteRow}>
          <dt className={styles.quoteLabel}>开头</dt>
          <dd className={styles.quoteValue} data-probe={openingProbe}>
            {session.opening === null ? (
              <span className={styles.quoteMissing}>没有用户消息</span>
            ) : (
              session.opening.preview
            )}
          </dd>
        </div>
        <div className={styles.quoteRow}>
          <dt className={styles.quoteLabel}>结尾</dt>
          <dd className={styles.quoteValue} data-probe={closingProbe}>
            {session.closing === null ? (
              <span className={styles.quoteMissing}>没有用户消息</span>
            ) : (
              session.closing.preview
            )}
          </dd>
        </div>
        {/* 打分比的是「本次开头 vs **上一次**结尾」。上一次结尾缺席时整行
            不渲染——那时接续行说的是「这是最早的一次会话」或样本不足。 */}
        {session.previousClosing === null ? null : (
          <div className={styles.quoteRow}>
            <dt className={styles.quoteLabel}>上次结尾</dt>
            <dd className={styles.quoteValue} data-probe="handoff-previous-closing">
              {session.previousClosing.preview}
            </dd>
          </div>
        )}
      </dl>

      <p className={styles.echoLine} data-probe="handoff-echo-line">
        <span className={styles.echoLead}>接续</span>
        <EchoLine reading={session.echo} />
      </p>
    </div>
  );
}
