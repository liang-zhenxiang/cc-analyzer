import { useEffect, useMemo, useRef, useState } from "react";
import { snippetOf, sharedSearchIndex, type SearchHit } from "./searchIndex";
import type { SearchSource } from "./searchSources";
import { useSearchIndex } from "./useSearchIndex";
import { formatProjectPath, formatRelativeTime } from "../../lib/format";
import styles from "./SearchPalette.module.css";

/** One flat, keyboard-navigable list item: a hit. */
type FlatItem = { hit: SearchHit; sessionPath: string };

/**
 * 五类来源的可见文案。这张表与 `data-source` 一一对应，e2e 与真机门禁按它逐项
 * 对账——文案与数据脱节时先红的是它们，因此这里不允许出现表外的第五种写法。
 */
const SOURCE_LABELS: Record<SearchSource, string> = {
  user: "我",
  assistant: "助手",
  "tool-output": "工具输出",
  "file-path": "文件路径",
  error: "错误"
};

/** 过滤条的档位顺序；`全部` 是快捷开关，不是第六个来源。 */
const SOURCE_ORDER: readonly SearchSource[] = [
  "user",
  "assistant",
  "tool-output",
  "file-path",
  "error"
];

/**
 * 输入糖：查询串开头的前缀等价于点选对应 chip（只清到这一类），前缀本身不参与
 * 子串匹配。表就是规格定死的那五行，长前缀在前，避免短前缀先命中。
 */
const QUERY_PREFIXES: ReadonlyArray<readonly [string, SearchSource]> = [
  ["文件路径:", "file-path"],
  ["路径:", "file-path"],
  ["source:file-path", "file-path"],
  ["file:", "file-path"],
  ["错误:", "error"],
  ["error:", "error"],
  ["助手:", "assistant"],
  ["assistant:", "assistant"],
  ["输出:", "tool-output"],
  ["tool:", "tool-output"],
  ["我:", "user"],
  ["me:", "user"]
];

function parseQueryPrefix(raw: string): { source: SearchSource; rest: string } | null {
  const lowered = raw.toLowerCase();
  for (const [prefix, source] of QUERY_PREFIXES) {
    if (lowered.startsWith(prefix)) return { source, rest: raw.slice(prefix.length) };
  }
  return null;
}

/** 未输入查询时的状态行原文——状态行的唯一权威在规格 §4.1。 */
const STATUS_IDLE = "搜索会话消息、工具输出与文件路径（⌘K 关闭）";

const chipClass = (selected: boolean) =>
  selected ? `${styles.chip} ${styles.chipActive}` : styles.chip;

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
  // 默认五个来源全选：⌘K 立刻能搜到一切的既有承诺不变。
  const [sources, setSources] = useState<ReadonlySet<SearchSource>>(() => new Set(SOURCE_ORDER));
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { indexed, total, entries } = useSearchIndex();

  useEffect(() => {
    if (open) {
      setQuery("");
      // 过滤器不记忆：关闭再打开重置为全部选中，「为什么这次搜不到」比省一次点击贵。
      setSources(new Set(SOURCE_ORDER));
      setActiveIndex(0);
      // 浮层打开后焦点进输入框——键盘流从第一击就可用。
      inputRef.current?.focus();
    }
  }, [open]);

  const filter = useMemo(() => ({ sources }), [sources]);
  const groups = useMemo(
    () => (open ? sharedSearchIndex.search(query, undefined, filter) : []),
    [open, query, filter]
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

  const allSelected = SOURCE_ORDER.every((source) => sources.has(source));
  const toggleAll = () => {
    setSources(allSelected ? new Set() : new Set(SOURCE_ORDER));
    setActiveIndex(0);
  };
  const toggleSource = (source: SearchSource) => {
    setSources((current) => {
      const next = new Set(current);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
    setActiveIndex(0);
  };

  const entryCount = entries.toLocaleString("en-US");
  const status =
    query.trim() === ""
      ? STATUS_IDLE
      : flat.length === 0
        ? indexed < total
          ? `索引构建中 ${indexed} / ${total} 会话 · 已索引 ${entryCount} 条 · 稍后再试或先用已索引部分`
          : `没有匹配的记录 · 已索引 ${entryCount} 条`
        : `${flat.length} 条命中 · 已索引 ${entryCount} 条`;

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
          return;
        }
        // 焦点在 chip（或结果行）上时 Enter 由原生 button 的 click 负责：
        // 浮层再跳一次就会变成「想切档，结果跳去了另一条会话」。
        if (event.target instanceof HTMLButtonElement) return;
        if (event.key === "ArrowDown") {
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
          aria-label="搜索会话记录"
          placeholder="搜索消息、工具输出、文件路径…（Esc 关闭）"
          title="可按来源快速过滤：路径: / 错误: / 我: / 助手: / 输出:"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            const prefixed = parseQueryPrefix(value);
            if (prefixed) {
              // 前缀只清到这一类：过滤条随后就显示「只剩这一档」。
              setSources(new Set([prefixed.source]));
              setQuery(prefixed.rest);
            } else {
              setQuery(value);
            }
            setActiveIndex(0);
          }}
        />
        <div
          className={styles.filters}
          role="group"
          aria-label="按来源过滤搜索结果"
          data-probe="search-filters"
        >
          <button
            type="button"
            className={chipClass(allSelected)}
            data-probe="search-filter-chip"
            data-source="all"
            aria-pressed={allSelected}
            onClick={toggleAll}
          >
            全部
          </button>
          {SOURCE_ORDER.map((source) => (
            <button
              key={source}
              type="button"
              className={chipClass(sources.has(source))}
              data-probe="search-filter-chip"
              data-source={source}
              aria-pressed={sources.has(source)}
              onClick={() => toggleSource(source)}
            >
              {SOURCE_LABELS[source]}
            </button>
          ))}
        </div>
        <p className={styles.status} role="status" data-probe="search-status">
          {status}
        </p>
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
                    const snippet = snippetOf(hit);
                    const isPath = hit.source === "file-path";
                    return (
                      <button
                        key={`${hit.sessionPath}:${hit.recordId}`}
                        type="button"
                        data-item-index={itemIndex}
                        data-probe="search-result"
                        // 相对时间不进可访问名：朗读要短且稳定，来源文案是这条命中
                        // 「为什么在这里」的唯一线索。
                        aria-label={`${SOURCE_LABELS[hit.source]}：${snippet}`}
                        title={snippet}
                        className={isActive ? `${styles.item} ${styles.itemActive}` : styles.item}
                        onClick={() => reveal({ hit, sessionPath: session.sessionPath })}
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                      >
                        <span
                          className={isPath ? `${styles.source} ${styles.sourceFilePath}` : styles.source}
                          data-probe="search-source"
                          data-source={hit.source}
                        >
                          {SOURCE_LABELS[hit.source]}
                        </span>
                        <span
                          className={isPath ? styles.snippetPath : styles.snippet}
                          data-probe="search-snippet"
                        >
                          {snippet}
                        </span>
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
