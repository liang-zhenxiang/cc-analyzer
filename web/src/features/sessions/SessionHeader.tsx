import { parentDirectory } from "../../lib/path";
import { formatDuration, formatRelativeTime } from "../../lib/format";
import { sessionTitle, type SessionMeta } from "./metadataCache";
import type { ParsedSession } from "./types";
import { Button } from "../../components/Button";
import styles from "./SessionHeader.module.css";

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

  return (
    <header className={styles.header} aria-label="会话信息">
      <span className={styles.dot} aria-hidden="true" />
      <strong className={styles.title} title={session.path}>
        {sessionTitle(session)}
      </strong>
      <span className={styles.chip}>总耗时 {total === null ? "…" : formatDuration(total)}</span>
      {/* 与「总耗时」同排紧邻、同视觉规格：两者都是会话级汇总，但不可互相换算，
          所以除间距外不加任何连接装饰。 */}
      <button
        type="button"
        className={styles.chipButton}
        aria-expanded={tokenPanelOpen}
        disabled={!parsed}
        onClick={onToggleTokenPanel}
      >
        Token 计数
        <b className={styles.cost}>成本未知</b>
      </button>
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
    </header>
  );
}
