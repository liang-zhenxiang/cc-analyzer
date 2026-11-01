import { useMemo, useState } from "react";
import { parentDirectory } from "../../lib/path";
import { formatDuration, formatRelativeTime, formatTokenCount } from "../../lib/format";
import { sessionTitle, type SessionMeta } from "./metadataCache";
import type { ParsedSession } from "./types";
import type { ClipboardService } from "../../api/types";
import { tokenTotalsOf } from "./tokenTotals";
import { ShareCardButton } from "./ShareCardButton";
import { contextSeriesOf } from "./contextSeries";
import { buildBleedReport } from "./bleedModel";
import { buildContextHealth, type ContextHealth } from "../usage/contextHealth";
import { sessionHealth, sessionHealthText } from "./sessionHealth";
import { resumeCommand } from "./resumeCommand";
import { useNotifications } from "../../app/NotificationProvider";
import { Button } from "../../components/Button";
import { SkeletonBar } from "../../components/Skeleton";
import { FreshnessBadge } from "../usage/FreshnessBadge";
import styles from "./SessionHeader.module.css";

/** 四档色带（规格 §2.7）：分数越低越靠近警示，缺失态不发颜色。 */
function healthTone(score: number | null): "none" | "healthy" | "tight" | "risky" | "bad" {
  if (score === null || !Number.isFinite(score)) return "none";
  if (score >= 75) return "healthy";
  if (score >= 50) return "tight";
  if (score >= 25) return "risky";
  return "bad";
}

/**
 * The session's instrument readouts. The numbers a user opens this app to
 * answer — how long, how many tokens, how big — used to live in 11px tertiary
 * chips behind a click; the strip promotes them to the page's largest figures
 * and doubles as the TokenPanel toggle, so the panel is one tap away from
 * wherever the eye already is.
 */
export function SessionHeader({
  session,
  parsed,
  tokenPanelOpen,
  onToggleTokenPanel,
  onOpenFolder,
  onExport,
  clipboard,
  restartCount
}: {
  session: SessionMeta;
  parsed: ParsedSession | null;
  tokenPanelOpen: boolean;
  onToggleTokenPanel: () => void;
  onOpenFolder: (path: string) => void;
  /** Opens the export dialog. Absent while the session is still parsing. */
  onExport: (trigger: HTMLElement) => void;
  clipboard: ClipboardService;
  /**
   * H5 重启计数（§4.5）：同目录 24 小时窗口内该会话所在的连续重启链长。
   * `undefined` = 列表未就绪或该会话不在链上（链首 N=0）——两种都不渲染，
   * 不占位：徽章是补充读数，不是布局的承重墙。
   */
  restartCount?: number;
}) {
  const { notify } = useNotifications();
  const [actionError, setActionError] = useState<string | null>(null);
  const directory = parentDirectory(session.path);
  const total = parsed ? Math.max(0, parsed.endedAt - parsed.startedAt) : null;
  const totals = useMemo(() => (parsed ? tokenTotalsOf(parsed.records) : null), [parsed]);
  const health = useMemo(() => (parsed ? sessionHealth(parsed.records) : "idle"), [parsed]);
  /**
   * 上下文健康分（E7，规格 §2.7 / §6）。
   *
   * 三个分项各有出处，一个都不猜：
   * - 平均水位与峰值来自 `contextSeriesOf`（每条带 usage 的 assistant 记录的
   *   输入 + 缓存读 + 缓存写，不含输出——上下文里没有「输出」这一格）。
   * - 压缩次数取 `parsed.compactEvents`，与出血点页的 `compactionCount` 同源。
   * - 出血点取 `buildBleedReport` 里**非压缩**的那些：压缩已经单独计过一次罚，
   *   再把压缩条目算进出血，等于同一份证据罚两次。
   */
  const contextHealth = useMemo<ContextHealth | null>(() => {
    if (!parsed) return null;
    const samples = contextSeriesOf(parsed.records);
    const report = buildBleedReport(parsed);
    const bleedCount = report.items.filter((item) => item.kind !== "compaction").length;
    return buildContextHealth(samples, parsed.compactEvents?.length ?? 0, bleedCount);
  }, [parsed]);
  const command = useMemo(() => resumeCommand(session), [session]);
  // E9（Round EE）：最后一条记录的本地时刻。会话页没有「扫描」这一步，所以
  // lastScanAt 传 null——徽章据「记录本身有多旧」说话，不编一个扫描时刻。
  const lastRecordAt = useMemo(() => {
    if (!parsed) return null;
    let latest = Number.NEGATIVE_INFINITY;
    for (const record of parsed.records) {
      if (record.timestamp > latest) latest = record.timestamp;
    }
    return Number.isFinite(latest) ? latest : null;
  }, [parsed]);

  /**
   * 反馈沿用 `runAction(...)` 的语言：成功只弹一条 toast；失败既弹 error toast，
   * 也写就地可见的 `actionError`（toast 3.2 秒后会消失，错误不该跟着走）。
   *
   * **命令内容不进任何日志**——它含用户路径与会话 ID，属敏感数据（AGENTS.md 红线）。
   */
  async function copyResumeCommand() {
    if (!command) return;
    setActionError(null);
    try {
      await clipboard.writeText(command.text);
      notify("已复制 resume 命令", "success");
    } catch (cause) {
      const message = `复制 resume 命令失败: ${cause instanceof Error ? cause.message : String(cause)}`;
      setActionError(message);
      notify(message, "error");
    }
  }

  // 降级必须可见：缺 cwd 时明说要在项目目录下执行，缺 ID 时说明按钮为何禁用。
  const resumeHint = command
    ? command.degraded
      ? "需在该会话的项目目录下执行"
      : null
    : "该会话缺少可用的会话 ID，无法生成 resume 命令";

  return (
    <header className={styles.header} aria-label="会话信息">
      <div className={styles.titleRow}>
        {/* 状态灯的三态与可读文案见 sessionHealth.ts；颜色之外还有
            srOnly 文案，不把状态只交给颜色。 */}
        <span className={`${styles.dot} ${styles[health]}`} aria-hidden="true" />
        <span className={styles.srOnly}>{sessionHealthText(health)}</span>
        <strong className={styles.title} title={session.path}>
          {sessionTitle(session)}
        </strong>
        {session.cwd ? (
          <span className={styles.chip} title={session.cwd}>
            项目 <b className={styles.path}>{session.cwd}</b>
          </span>
        ) : null}
        <span className={styles.chip}>{formatRelativeTime(session.mtimeMs)}</span>
        {lastRecordAt !== null ? (
          <FreshnessBadge lastRecordAt={lastRecordAt} lastScanAt={null} />
        ) : null}
        <div className={styles.actions}>
          <Button
            type="button"
            disabled={!command}
            title={
              command
                ? "复制 claude --resume 命令"
                : "该会话缺少可用的会话 ID，无法生成 resume 命令"
            }
            onClick={() => void copyResumeCommand()}
          >
            复制 resume 命令
          </Button>
          {directory ? (
            <Button
              type="button"
              title="在文件管理器中打开该会话所在的文件夹"
              onClick={() => onOpenFolder(directory)}
            >
              打开位置
            </Button>
          ) : null}
          {/* 会话级动作之一，与上面两个同级。解析中不渲染：没有数据可导，
              摆一个禁用按钮只是噪音。 */}
          {parsed ? (
            <Button
              type="button"
              title="导出该会话的报告或记录数据"
              onClick={(event) => onExport(event.currentTarget)}
            >
              导出
            </Button>
          ) : null}
          {/* H8 分享卡：与「导出」同一档动作、同一解析守卫——解析中不渲染
              （没有数据可晒）；桥接缺失时按钮自身会 disabled 并说明原因。 */}
          {parsed ? <ShareCardButton session={session} parsed={parsed} /> : null}
          {resumeHint ? <span className={styles.hint}>{resumeHint}</span> : null}
        </div>
        {contextHealth ? (
          // 数字优先、色带辅助（§2.7）：颜色只上左侧 3px 竖条，数字本身用
          // --text，保证在任何档位下都是最高对比。分数算不出时印「—」，
          // 不印 0——0 分是一个断言，缺失不是。
          <div
            className={styles.health}
            data-probe="health-score"
            data-tone={healthTone(contextHealth.score)}
            role="group"
            aria-label={
              contextHealth.score === null
                ? "健康分不可用"
                : `健康分 ${contextHealth.score}`
            }
          >
            <span className={styles.healthBar} aria-hidden="true" />
            <span className={styles.healthValue} aria-hidden="true">
              {contextHealth.score === null ? "—" : contextHealth.score}
            </span>
            <span className={styles.healthNote}>
              {contextHealth.score === null
                ? `不可用 · ${contextHealth.summary}`
                : contextHealth.summary}
            </span>
          </div>
        ) : null}
      </div>
      {actionError ? <div role="alert">{actionError}</div> : null}
      <button
        type="button"
        className={styles.readouts}
        aria-label="会话读数"
        aria-expanded={tokenPanelOpen}
        aria-busy={!parsed}
        disabled={!parsed}
        onClick={onToggleTokenPanel}
      >
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>总耗时</span>
          <b className={styles.readoutValue}>
            {total === null ? <SkeletonBar width="value" /> : formatDuration(total)}
          </b>
        </span>
        {/* H5 重启徽章（§4.5）：紧挨总耗时之后。链长 ≥2 才显示「重新发起
            N 次」（N=链长−1，即链首不算「重新发起」）；0/undefined 不渲染。
            徽章是 span 不是 button——它在 button.readouts 内部，嵌 button
            是非法结构（与出血点徽章降级行本体的理由同源，但这里连独立
            动作都没有，span 足够）。 */}
        {typeof restartCount === "number" && restartCount >= 2 ? (
          <span
            className={styles.restartChip}
            data-probe="session-restart"
            title={`同目录 24 小时内的第 ${restartCount} 次新会话`}
          >
            {`重新发起 ${restartCount - 1} 次`}
          </span>
        ) : null}
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>输入</span>
          <b className={styles.readoutValue}>
            {totals ? formatTokenCount(totals.input) : <SkeletonBar width="value" />}
          </b>
        </span>
        {/* 缓存读取往往比输入高一个数量级（tokenTotals.ts 的立场），
            单独一档读数正是为了让这个差异第一眼可见。 */}
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>缓存读取</span>
          <b className={styles.readoutValue}>
            {totals ? formatTokenCount(totals.cacheRead) : <SkeletonBar width="value" />}
          </b>
        </span>
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>输出</span>
          <b className={styles.readoutValue}>
            {totals ? formatTokenCount(totals.output) : <SkeletonBar width="value" />}
          </b>
        </span>
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>记录数</span>
          <b className={styles.readoutValue}>
            {parsed ? parsed.records.length.toLocaleString("en-US") : <SkeletonBar width="value" />}
          </b>
        </span>
      </button>
    </header>
  );
}
