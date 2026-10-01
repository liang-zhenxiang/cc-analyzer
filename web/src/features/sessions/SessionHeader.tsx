import { useMemo } from "react";
import { parentDirectory } from "../../lib/path";
import { formatDuration, formatRelativeTime, formatTokenCount } from "../../lib/format";
import { sessionTitle, type SessionMeta } from "./metadataCache";
import type { ParsedSession } from "./types";
import { tokenTotalsOf } from "./tokenTotals";
import { sessionHealth, sessionHealthText } from "./sessionHealth";
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
  onOpenFolder
}: {
  session: SessionMeta;
  parsed: ParsedSession | null;
  tokenPanelOpen: boolean;
  onToggleTokenPanel: () => void;
  onOpenFolder: (path: string) => void;
}) {
  const directory = parentDirectory(session.path);
  const total = parsed ? Math.max(0, parsed.endedAt - parsed.startedAt) : null;
  const totals = useMemo(() => (parsed ? tokenTotalsOf(parsed.records) : null), [parsed]);
  const health = useMemo(() => (parsed ? sessionHealth(parsed.records) : "idle"), [parsed]);

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
        {directory ? (
          <Button
            type="button"
            title="在文件管理器中打开该会话所在的文件夹"
            onClick={() => onOpenFolder(directory)}
          >
            打开位置
          </Button>
        ) : null}
      </div>
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
