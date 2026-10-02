import { useMemo, useState } from "react";
import { parentDirectory } from "../../lib/path";
import { formatDuration, formatRelativeTime, formatTokenCount } from "../../lib/format";
import { sessionTitle, type SessionMeta } from "./metadataCache";
import type { ParsedSession } from "./types";
import type { ClipboardService } from "../../api/types";
import { tokenTotalsOf } from "./tokenTotals";
import { sessionHealth, sessionHealthText } from "./sessionHealth";
import { resumeCommand } from "./resumeCommand";
import { useNotifications } from "../../app/NotificationProvider";
import { Button } from "../../components/Button";
import styles from "./SessionHeader.module.css";

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
  clipboard
}: {
  session: SessionMeta;
  parsed: ParsedSession | null;
  tokenPanelOpen: boolean;
  onToggleTokenPanel: () => void;
  onOpenFolder: (path: string) => void;
  clipboard: ClipboardService;
}) {
  const { notify } = useNotifications();
  const [actionError, setActionError] = useState<string | null>(null);
  const directory = parentDirectory(session.path);
  const total = parsed ? Math.max(0, parsed.endedAt - parsed.startedAt) : null;
  const totals = useMemo(() => (parsed ? tokenTotalsOf(parsed.records) : null), [parsed]);
  const health = useMemo(() => (parsed ? sessionHealth(parsed.records) : "idle"), [parsed]);
  const command = useMemo(() => resumeCommand(session), [session]);

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
          {resumeHint ? <span className={styles.hint}>{resumeHint}</span> : null}
        </div>
      </div>
      {actionError ? <div role="alert">{actionError}</div> : null}
      <button
        type="button"
        className={styles.readouts}
        aria-label="会话读数"
        aria-expanded={tokenPanelOpen}
        disabled={!parsed}
        onClick={onToggleTokenPanel}
      >
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>总耗时</span>
          <b className={styles.readoutValue}>{total === null ? "…" : formatDuration(total)}</b>
        </span>
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>输入</span>
          <b className={styles.readoutValue}>
            {totals ? formatTokenCount(totals.input) : "…"}
          </b>
        </span>
        {/* 缓存读取往往比输入高一个数量级（tokenTotals.ts 的立场），
            单独一档读数正是为了让这个差异第一眼可见。 */}
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>缓存读取</span>
          <b className={styles.readoutValue}>
            {totals ? formatTokenCount(totals.cacheRead) : "…"}
          </b>
        </span>
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>输出</span>
          <b className={styles.readoutValue}>
            {totals ? formatTokenCount(totals.output) : "…"}
          </b>
        </span>
        <span className={styles.readout}>
          <span className={styles.readoutLabel}>记录数</span>
          <b className={styles.readoutValue}>
            {parsed ? parsed.records.length.toLocaleString("en-US") : "…"}
          </b>
        </span>
      </button>
    </header>
  );
}
