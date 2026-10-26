import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../components/Icon";
import {
  filterCommands,
  firstEnabledIndex,
  isRunnable,
  stepHighlight,
  type CommandAction
} from "./commandRegistry";
import styles from "./CommandPalette.module.css";

const LIST_ID = "command-palette-list";
const optionId = (action: CommandAction) => `command-palette-option-${action.id}`;

/**
 * 命令面板：一个输入框 + 一张按分数排序的命令表。
 *
 * 哑组件——动作从 `actions` 进来，执行完只管 `onClose()`。真正的接线（当前标签、
 * 主题、对比度、大屏）全在 `AppShell`：面板不该知道主视图有几个。
 *
 * 键盘一律落在输入框上（`aria-activedescendant` 模式）：列表项不进 Tab 序，
 * 否则 30 条命令会变成 30 个 Tab 停靠点，比不开面板还难用。
 */
export function CommandPalette({
  open,
  actions,
  onClose
}: {
  open: boolean;
  actions: readonly CommandAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => filterCommands(actions, query), [actions, query]);

  // 每次打开都回到「空查询 + 第一条可用命令」：面板是随时要用的过路工具，
  // 记住上一次的查询只会让下一次多按几下退格。
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlighted(-1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // 查询变化后高亮落到第一条**可用**命令：不可用项看得见、但不会被选中执行。
  useEffect(() => {
    setHighlighted((current) => {
      const next = firstEnabledIndex(results);
      // 当前高亮仍然有效（还是同一条可执行命令）就不要跳回去。
      if (current >= 0 && current < results.length && !results[current].disabled) return current;
      return next;
    });
  }, [results]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    // capture：面板盖在任何页面之上，Esc 先归面板。
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const active = highlighted >= 0 && highlighted < results.length ? results[highlighted] : null;

  const run = (action: CommandAction) => {
    if (!isRunnable(action)) return;
    onClose();
    // 先关面板再执行：动作可能切标签、开另一层浮层，晚一步关会盖住它的标题。
    action.run?.();
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) => stepHighlight(results, current, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (active) run(active);
    }
  };

  return (
    <div className={styles.backdrop}>
      <div
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        data-probe="palette-root"
      >
        <div className={styles.field}>
          <span className={styles.fieldIcon} aria-hidden="true">
            <Icon name="search" size={14} />
          </span>
          <input
            ref={inputRef}
            className={styles.input}
            // autoFocus 让真机第一帧就进输入框；effect 负责 jsdom 与再次打开。
            autoFocus
            value={query}
            placeholder="输入命令…"
            aria-label="搜索命令"
            role="combobox"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-autocomplete="list"
            aria-activedescendant={active ? optionId(active) : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
          <kbd className={styles.key}>Esc</kbd>
        </div>

        {results.length === 0 ? (
          <p className={styles.empty}>没有匹配的命令</p>
        ) : (
          <ul className={styles.list} id={LIST_ID} role="listbox" aria-label="命令">
            {results.map((action, index) => (
              <li
                key={action.id}
                id={optionId(action)}
                role="option"
                aria-selected={index === highlighted}
                aria-disabled={action.disabled ? true : undefined}
                className={styles.item}
                data-probe="palette-item"
                data-command={action.id}
                // 只移动鼠标不改选择：真正的意图是点击，悬停抢走高亮会让键盘用户失焦。
                onMouseMove={() => {
                  if (action.disabled) return;
                  setHighlighted(index);
                }}
                onClick={() => run(action)}
              >
                <span className={styles.title}>{action.title}</span>
                {action.shortcut ? <kbd className={styles.key}>{action.shortcut}</kbd> : null}
                <span className={styles.detail}>
                  {action.disabled ? "不可用" : null}
                  {action.disabled && action.detail ? " · " : null}
                  {action.detail}
                </span>
                <span className={styles.group}>{action.group}</span>
              </li>
            ))}
          </ul>
        )}

        <p className={styles.footer}>
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
          {results.length > 0 ? <span className={styles.count}>{results.length} 条命令</span> : null}
        </p>
      </div>
    </div>
  );
}
