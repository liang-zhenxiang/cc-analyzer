import { useEffect, useMemo, useRef, useState } from "react";
import { snippetOf, sharedSearchIndex, type SearchHit } from "./searchIndex";
import { useSearchIndex } from "./useSearchIndex";
import { formatProjectPath, formatRelativeTime } from "../../lib/format";
import styles from "./SearchPalette.module.css";

/** One flat, keyboard-navigable list item: a hit. */
type FlatItem = { hit: SearchHit; sessionPath: string };

/**
 * ⌘K palette: full-text search across every project, grouped 项目 → 会话.
 * The reveal contract is the whole point — CCHV's most-complained defect was
 * results that did not navigate anywhere, so Enter lands the user on the
 * record with its detail panel open.
 */
export function SearchPalette({
  open,
  onClose,
  onReveal
}: {
  open: boolean;
  onClose: () => void;
  onReveal: (sessionPath: string, recordId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { indexed, total } = useSearchIndex();

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // 浮层打开后焦点进输入框——键盘流从第一击就可用。
      inputRef.current?.focus();
    }
  }, [open]);

  const groups = useMemo(
    () => (open ? sharedSearchIndex.search(query) : []),
    [open, query]
  );
  const flat: FlatItem[] = useMemo(
    () =>
      groups.flatMap((group) =>
        group.sessions.flatMap((session) =>
          session.hits.map((hit) => ({ hit, sessionPath: session.sessionPath }))
        )
      ),
    [groups]
  );

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  // 滚动跟随键盘焦点行。
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-item-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const reveal = (item: FlatItem) => {
    onClose();
    onReveal(item.sessionPath, item.hit.recordId);
  };

  const status =
    query.trim() === ""
      ? "输入关键词搜索全部会话的消息"
      : flat.length === 0
        ? indexed < total
          ? `索引构建中 ${indexed} / ${total}，稍后再试或先用已索引部分`
          : "没有匹配的消息"
        : `${flat.length} 条命中`;

  let itemIndex = -1;

  return (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((current) => Math.min(current + 1, flat.length - 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((current) => Math.max(current - 1, 0));
        } else if (event.key === "Enter") {
          const item = flat[activeIndex];
          if (item) reveal(item);
        }
      }}
    >
      <section className={styles.palette} role="dialog" aria-label="全局搜索" aria-modal="true">
        <input
          ref={inputRef}
          /* type 用 text 而不是 search：search 类型的原生清除按钮与
             Enter 默认行为在无表单场景下有引擎差异，v1 不吃这份复杂。 */
          type="text"
          className={styles.input}
          aria-label="搜索消息"
          placeholder="搜索全部项目的会话消息…（Esc 关闭）"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
        <p className={styles.status}>{status}</p>
        <div className={styles.results} ref={listRef}>
          {groups.map((group) => (
            <div key={group.projectLabel} className={styles.group}>
              {/* 搜索索引里没有 cwd，分组标题走 formatProjectPath 的降级档：
                  去掉编码前导 `-`；编码名完整进 title，需要溯源时看得到。 */}
              <h3 className={styles.groupTitle} title={group.projectLabel}>
                {formatProjectPath(group.projectLabel)}
              </h3>
              {group.sessions.map((session) => (
                <div key={session.sessionPath} className={styles.session}>
                  {session.hits.map((hit) => {
                    itemIndex += 1;
                    const isActive = itemIndex === activeIndex;
                    return (
                      <button
                        key={`${hit.sessionPath}:${hit.recordId}`}
                        type="button"
                        data-item-index={itemIndex}
                        className={isActive ? `${styles.item} ${styles.itemActive}` : styles.item}
                        onClick={() => reveal({ hit, sessionPath: session.sessionPath })}
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                      >
                        <span className={styles.snippet}>{snippetOf(hit)}</span>
                        <span className={styles.time}>{formatRelativeTime(hit.timestamp)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
