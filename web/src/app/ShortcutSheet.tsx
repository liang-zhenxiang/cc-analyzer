import { useCallback, useEffect, useRef } from "react";
import { IconButton } from "../components/Button";
import { Icon } from "../components/Icon";
import styles from "./ShortcutSheet.module.css";

/**
 * 一张键位表。`source` 是这条键**在代码里的出处**（`文件:行号`）——
 * 它不是装饰：速查卡最容易犯的错就是把没实现的键写进去，而写错一个键
 * 比没有速查卡更糟。出处放在 `title` 里，评审时可以当场跳过去核。
 */
export type ShortcutRow = {
  keys: string[];
  description: string;
  source: string;
};

export type ShortcutGroup = {
  title: string;
  rows: ShortcutRow[];
};

/**
 * 全部键位**逐条从代码核实**过（2026-10-27，分支 `feat/v033-batch-ten-3`）。
 *
 * 这张表是唯一来源：界面、单测快照、设计规格 §7.2 都读它。仓库里**没有**
 * `j`/`k` 导航，也没有数字键切标签——所以这张卡上不会出现它们（走访查卡的人
 * 最信任的就是「这里没写 = 没有」，写一条不存在的键等于骗人）。
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "全局",
    rows: [
      { keys: ["⌘K"], description: "打开命令面板（Windows / Linux 用 Ctrl+K）", source: "AppShell.tsx:300" },
      { keys: ["?"], description: "打开这张速查卡", source: "AppShell.tsx:333" },
      { keys: ["Esc"], description: "关闭当前浮层；没有浮层时退出大屏模式", source: "AppShell.tsx:332" }
    ]
  },
  {
    title: "命令面板",
    rows: [
      { keys: ["↑", "↓"], description: "移动高亮（跳过不可用项）", source: "CommandPalette.tsx:86" },
      { keys: ["Enter"], description: "执行选中的命令", source: "CommandPalette.tsx:91" },
      { keys: ["Esc"], description: "关闭命令面板", source: "CommandPalette.tsx:65" }
    ]
  },
  {
    title: "列表与表格",
    rows: [
      { keys: ["↑", "↓"], description: "上一行 / 下一行", source: "useRowNavigation.ts:28" },
      { keys: ["Home", "End"], description: "跳到首行 / 末行", source: "useRowNavigation.ts:30" },
      { keys: ["Enter"], description: "打开当前行", source: "useRowNavigation.ts:32" },
      { keys: ["Space"], description: "展开 / 收起当前行", source: "useRowNavigation.ts:32" },
      { keys: ["Esc"], description: "收起已展开的行", source: "ChangedFilesView.tsx:121" }
    ]
  },
  {
    title: "会话分析 · 重放",
    rows: [
      { keys: ["Space"], description: "播放 / 暂停", source: "ReplayView.tsx:717" },
      { keys: ["←", "→"], description: "上一个 / 下一个事件", source: "ReplayView.tsx:726" },
      { keys: ["Home", "End"], description: "跳到片头 / 片尾", source: "ReplayView.tsx:735" }
    ]
  },
  {
    title: "会话分析 · 上下文",
    rows: [
      { keys: ["←", "→"], description: "在事件之间移动焦点", source: "ContextView.tsx:222" },
      { keys: ["Enter", "Space"], description: "查看当前事件的详情", source: "ContextView.tsx:223" },
      { keys: ["Esc"], description: "取消选中", source: "ContextView.tsx:218" }
    ]
  },
  {
    title: "用量 · 消耗日历",
    rows: [
      { keys: ["←", "→"], description: "上一周 / 下一周的同一天", source: "UsageCalendarPanel.tsx:418" },
      { keys: ["↑", "↓"], description: "前一天 / 后一天", source: "UsageCalendarPanel.tsx:424" },
      { keys: ["Home", "End"], description: "本周第一天 / 最后一天", source: "UsageCalendarPanel.tsx:430" },
      { keys: ["Esc"], description: "收起当天的展开区", source: "UsageCalendarPanel.tsx:489" }
    ]
  },
  {
    title: "用量 · 错误趋势",
    rows: [
      { keys: ["←", "→"], description: "选择日期", source: "ErrorTrendChart.tsx:134" },
      { keys: ["Enter", "Space"], description: "只看这一天 / 取消筛选", source: "ErrorTrendChart.tsx:135" },
      { keys: ["Esc"], description: "取消日期筛选", source: "ErrorTrendChart.tsx:130" }
    ]
  },
  {
    title: "监控 · 一日回望",
    rows: [
      { keys: ["←", "→"], description: "按跨度的 2% 微调选区边界", source: "TimelineTrack.tsx:KEYBOARD_NUDGE" },
      { keys: ["Esc"], description: "取消选区", source: "TimelineTrack.tsx" }
    ]
  }
];

/** Tab 能落到哪些元素上，按 DOM 顺序。与 `ExportDialog` 里那份同款。 */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
  );
}

/**
 * 键盘速查卡（E8）：全局 `?` 呼出的一张居中卡片。
 *
 * 它是**只读**的：没有任何设置项，所以关掉它的方式只有三种——Esc、点遮罩、
 * 点右上角。焦点陷阱照 `ExportDialog` 的写法（文档级捕获 + `focusables` 集合判断），
 * 理由也一样：焦点所在的按钮一旦 `disabled`，浏览器会把它丢给 `<body>`，
 * 挂在面板上的处理器就再也看不到下一次 Tab。
 *
 * 待合并：`ExportDialog` / `SearchPalette` / 本文件各自有一份 `focusables` +
 * Tab 循环，三份写法一致；哪天抽成 `useFocusTrap` 时以三处测试为回归基线。
 */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => onClose(), [onClose]);

  // 打开即把焦点放进卡内：不这么做的话 Tab 会从未动的页面上继续走，
  // 键盘用户会以为自己没打开任何东西。
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const items = focusables(root);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active !== null && items.includes(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      data-probe="shortcut-sheet-backdrop"
      onMouseDown={(event) => {
        // 只在遮罩本身上按下才关：从卡内拖选文字松手到遮罩上不算「点了外面」。
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-sheet-title"
        tabIndex={-1}
        ref={panelRef}
        data-probe="shortcut-sheet"
      >
        <header className={styles.header}>
          <h2 id="shortcut-sheet-title">键盘速查卡</h2>
          <IconButton label="关闭" onClick={close}>
            <Icon name="close" size={16} />
          </IconButton>
        </header>
        <div className={styles.scroller} tabIndex={0} aria-label="快捷键分组">
          {SHORTCUT_GROUPS.map((group) => (
            <section className={styles.group} key={group.title}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              <dl className={styles.rows}>
                {group.rows.map((row) => (
                  <div className={styles.row} key={`${group.title}-${row.description}`}>
                    <dt className={styles.keys}>
                      {row.keys.map((key) => (
                        <kbd className={styles.kbd} key={key}>
                          {key}
                        </kbd>
                      ))}
                    </dt>
                    <dd className={styles.desc} title={`出处：${row.source}`}>
                      {row.description}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className={styles.footnote}>
          只列实现过的键——这张卡上没有的快捷键，应用里也没有。
        </p>
      </div>
    </div>
  );
}
