import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardService, DialogBridge } from "../../api/types";
import { Button, IconButton } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { buildExport } from "./exportPayload";
import {
  formatHint,
  type ExportBase,
  type ExportFormat,
  type ExportScope
} from "./exportTypes";
import styles from "./ExportDialog.module.css";

const FORMAT_ITEMS: SegmentedItem<ExportFormat>[] = [
  { value: "html", label: "HTML 报告" },
  { value: "csv", label: "CSV" }
];

const SCOPE_ITEMS: SegmentedItem<ExportScope>[] = [
  { value: "filtered", label: "当前筛选结果" },
  { value: "all", label: "全部记录" }
];

const COPIED_BUTTON_MS = 2_000;

/** The focusable elements a Tab press can land on, in DOM order. */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
  );
}

/**
 * The export dialog: pick a format and a scope, then save or copy.
 *
 * It is deliberately the same object as `SearchPalette` — detached from the
 * document flow, `--r-lg`, `--shadow-md`, a dimmed backdrop — so "this floats
 * above the app" is something the user has already learned once.
 *
 * Two rules shape the feedback: everything happens **in place** while the
 * dialog is open (a toast would sit under the backdrop and be invisible), and
 * only the successful save — after which the dialog is gone — raises a toast.
 */
export function ExportDialog({
  input,
  clipboard,
  dialog,
  opener = null,
  onClose,
  onSaved
}: {
  input: ExportBase;
  clipboard: ClipboardService;
  dialog: DialogBridge;
  /**
   * The element that opened the dialog. Passed in rather than read from
   * `document.activeElement`, because **WebKit does not focus a button on
   * click** (Safari's default): a mouse user would land on `<body>` and the
   * focus would have nowhere to return to.
   */
  opener?: HTMLElement | null;
  onClose: () => void;
  onSaved: (format: ExportFormat) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [format, setFormat] = useState<ExportFormat>("html");
  const [scope, setScope] = useState<ExportScope>("filtered");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // 时间戳在这里落：会话打开一小时后才导出，报告上的「生成于」也该是这一刻。
  const payload = useMemo(
    () => buildExport({ ...input, format, scope, generatedAt: Date.now() }),
    [input, format, scope]
  );

  // The element that opened the dialog gets focus back when it closes — without
  // this a keyboard user is dropped at the top of the document.
  useEffect(() => {
    const returnTo = opener ?? (document.activeElement as HTMLElement | null);
    panelRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => returnTo?.focus?.();
  }, [opener]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_BUTTON_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /**
   * Keyboard handling is bound to the **document**, not to the panel: when the
   * focused element is disabled (both write buttons are, while a save is in
   * flight) the browser blurs it to `<body>`, and a handler on the panel would
   * never see the next Tab — focus would walk into the page behind the modal.
   * Capture phase also means Escape is consumed before the global ⌘K listener.
   */
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onClose();
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
      // 用「在可聚焦集合里」而不是「在 DOM 子树里」判断：按钮变成 disabled 后
      // 有些引擎仍把焦点留在它身上，那时它不在 items 里，必须按「外面」处理，
      // 否则正向 Tab 会从它开始走回背后的页面。
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
  }, [onClose]);

  async function copy() {
    setError(null);
    try {
      await clipboard.writeText(payload.clipboardText);
      setCopied(true);
      setStatus(format === "csv" ? `已复制 ${payload.recordCount} 条记录的 CSV` : "已复制 HTML 源码");
    } catch (cause) {
      setStatus(null);
      setError(`导出失败: ${String(cause)}`);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const path = await dialog.saveText(payload.fileName, payload.contents, {
        title: format === "csv" ? "导出会话记录（CSV）" : "导出会话报告（HTML）",
        filterName: format === "csv" ? "CSV" : "HTML",
        extensions: [format]
      });
      // Cancelling the system dialog is not a failure: say nothing, stay open.
      if (path === null) return;
      onSaved(format);
    } catch (cause) {
      setError(`导出失败: ${String(cause)}`);
    } finally {
      setSaving(false);
    }
  }

  const filtered = scope === "filtered";
  const sessionCount = input.allRecords.length;
  const sourceLine = filtered
    ? payload.recordCount === sessionCount
      ? "当前没有生效的筛选，两个范围内容相同"
      : `当前筛选：共 ${sessionCount.toLocaleString("en-US")} 条中的 ${payload.recordCount.toLocaleString("en-US")} 条`
    : `本会话全部 ${sessionCount.toLocaleString("en-US")} 条记录`;

  return (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        aria-describedby="export-dialog-count"
        className={styles.panel}
      >
        <header className={styles.header}>
          <h2 id="export-dialog-title">导出会话报告</h2>
          <IconButton label="关闭导出窗口" onClick={onClose}>
            <Icon name="close" size={16} />
          </IconButton>
        </header>
        <div className={styles.body}>
          <div className={styles.field}>
            <span className={styles.label}>格式</span>
            <SegmentedControl
              items={FORMAT_ITEMS}
              value={format}
              onChange={setFormat}
              ariaLabel="导出格式"
              variant="equal"
            />
            <span className={styles.hint}>{formatHint(format)}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>范围</span>
            <SegmentedControl
              items={SCOPE_ITEMS}
              value={scope}
              onChange={setScope}
              ariaLabel="导出范围"
              variant="equal"
            />
          </div>
          <div className={styles.count} role="status" id="export-dialog-count">
            <b className={styles.countValue}>
              将导出 {payload.recordCount.toLocaleString("en-US")} 条记录
            </b>
            <span className={styles.countSource}>{sourceLine}</span>
            {payload.truncated ? (
              <span className={styles.countSource}>
                记录较多，本次仅导出前 {payload.recordCount.toLocaleString("en-US")} 条（共{" "}
                {payload.totalRecords.toLocaleString("en-US")} 条）
              </span>
            ) : null}
          </div>
          <p className={styles.fileName} title={payload.fileName}>
            文件名 <code>{payload.fileName}</code>
          </p>
          {format === "csv" ? (
            <>
              <span className={styles.hint}>
                粘贴到脚本或编辑器；要让 Excel 正确分列请用「保存…」。
              </span>
              <span className={styles.hint}>
                以 = + - @ 开头的摘要会加一个前导单引号，避免被表格软件当成公式执行。
              </span>
            </>
          ) : (
            <span className={styles.hint}>
              复制的是源码；要让对方看到排版，请「保存…」后发 .html 文件。
            </span>
          )}
          {error ? (
            <div role="alert" className={styles.error}>
              {error}
            </div>
          ) : status ? (
            <div role="status" className={styles.status}>
              {status}
            </div>
          ) : null}
        </div>
        <footer className={styles.footer}>
          <Button type="button" disabled={saving} onClick={() => void copy()}>
            {copied ? "已复制" : "复制到剪贴板"}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving}
            aria-busy={saving}
            onClick={() => void save()}
          >
            {saving ? "正在保存…" : "保存…"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
