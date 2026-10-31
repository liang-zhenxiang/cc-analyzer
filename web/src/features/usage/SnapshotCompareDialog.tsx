import { useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "../../components/Button";
import { Icon } from "../../components/Icon";
import {
  SNAPSHOT_METRICS,
  compareUsageSnapshots,
  type SnapshotCompareRow,
  type UsageSnapshot
} from "./snapshotCompare";
import { parseSnapshotJson } from "./usageSnapshotJson";
import styles from "./SnapshotCompareDialog.module.css";

/**
 * 「对比两份用量快照」浮层（Round GG G10）。
 *
 * 它沿用 `SearchPalette` / `ShortcutSheet` 的浮层语言：遮罩、`--r-lg`、
 * `--shadow-md`、z-index 与速查卡同层（浮层的层级登记表里是第三层，
 * 因此 AppShell 的 Esc 守卫不需要认识它——Esc 由本组件在捕获阶段消化）。
 *
 * ## 三条诚实性规则
 *
 * 1. **先认版本再读字段**：不是 `cca.usage.snapshot` v1 的文件直接拒收，
 *    不做「尽力解析」——那会把口径变化伪装成「这一项是 0」。
 * 2. **缺值与 0 不同**：任一侧缺字段时差值印「—」，不印 `0` / `-100%`。
 * 3. **不显示成本行**：v1 的快照不含成本（跨快照价目对不上），表格因此只有
 *    六个指标。将来 v2 加了成本，这里再加一行，而不是现在留一行空白。
 */

const COMPARE_DENOMINATOR_EPSILON = 0.0005;

type Loaded =
  | { state: "ok"; fileName: string; snapshot: UsageSnapshot }
  | { state: "error"; fileName: string; message: string };

/** 读文件：优先 `Blob.text()`，老 WebKit 回落到 FileReader。 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取失败"));
    reader.readAsText(file);
  });
}

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

function formatDelta(row: SnapshotCompareRow): string {
  if (row.delta === null) return "—";
  if (row.a !== null && row.a !== 0 && row.deltaPct !== null) {
    if (Math.abs(row.deltaPct) < COMPARE_DENOMINATOR_EPSILON) return "持平";
    const pct = Math.abs(row.deltaPct) * 100;
    // 真减号（U+2212）：`-` 在等宽表里和连字符撞脸，读数会看错方向。
    const sign = row.delta > 0 ? "+" : "\u2212";
    return `${sign}${pct.toFixed(1)}%`;
  }
  // 前值是 0 或缺失：百分比没有意义，只给绝对差。
  if (row.delta === 0) return "持平";
  const sign = row.delta > 0 ? "+" : "\u2212";
  return `${sign}${formatNumber(Math.abs(row.delta))}`;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function SnapshotCompareDialog({
  onClose,
  onExportCurrent
}: {
  onClose: () => void;
  /** 没有 JSON 快照可读时的就地出口：把当前区间导成一份。 */
  onExportCurrent?: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [a, setA] = useState<Loaded | null>(null);
  const [b, setB] = useState<Loaded | null>(null);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("input")?.focus();
    return () => returnTo?.focus?.();
  }, []);

  // 与导出浮层同一套键盘契约：Esc 在捕获阶段消化，Tab 在卡内回绕。
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
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

  const comparison = useMemo(() => {
    if (a?.state !== "ok" || b?.state !== "ok") return null;
    // 行清单由读方那份 `SNAPSHOT_METRICS` 决定（v1 六项，成本不入表）。
    const result = compareUsageSnapshots(a.snapshot, b.snapshot);
    return result.rows;
  }, [a, b]);

  async function load(side: "a" | "b", file: File | undefined) {
    if (!file) return;
    const setter = side === "a" ? setA : setB;
    try {
      const text = await readFileText(file);
      const parsed = parseSnapshotJson(text, file.size);
      setter(
        parsed.ok
          ? { state: "ok", fileName: file.name, snapshot: parsed.snapshot }
          : { state: "error", fileName: file.name, message: parsed.message }
      );
    } catch (cause) {
      setter({
        state: "error",
        fileName: file.name,
        message: `读取失败：${String(cause instanceof Error ? cause.message : cause)}`
      });
    }
  }

  function renderPick(side: "a" | "b", label: string, loaded: Loaded | null) {
    const inputId = `snapshot-file-${side}`;
    return (
      <div className={styles.pick}>
        <label className={styles.pickLabel} htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          type="file"
          accept="application/json,.json"
          className={styles.file}
          data-probe={`snapshot-file-${side}`}
          onChange={(event) => void load(side, event.target.files?.[0])}
        />
        {loaded === null ? (
          <span className={styles.pickHint}>还没有选文件</span>
        ) : loaded.state === "ok" ? (
          <span className={styles.pickName} title={loaded.fileName}>
            {loaded.fileName}
          </span>
        ) : (
          <span className={styles.pickError} role="alert">
            {loaded.fileName}：{loaded.message}
          </span>
        )}
      </div>
    );
  }

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
        aria-labelledby="snapshot-compare-title"
        className={styles.panel}
        data-probe="snapshot-compare"
      >
        <header className={styles.header}>
          <h2 id="snapshot-compare-title">对比两份用量快照</h2>
          <IconButton label="关闭对比窗口" onClick={onClose}>
            <Icon name="close" size={16} />
          </IconButton>
        </header>

        <div className={styles.body}>
          <p className={styles.lead}>
            选两份「用量快照（JSON）」，比它俩的六项合计。区间可以不同——表里比的是各自区间的总量。
          </p>
          <div className={styles.pickers}>
            {renderPick("a", "快照 A", a)}
            {renderPick("b", "快照 B", b)}
          </div>

          {comparison === null ? (
            <p className={styles.empty}>
              选两份快照文件开始对比。还没有 JSON 快照？先在「导出快照」旁导出一次。
            </p>
          ) : (
            <table
              className={styles.table}
              aria-label="两份用量快照的差值"
              data-probe="snapshot-diff-table"
            >
              <thead>
                <tr>
                  <th scope="col">指标</th>
                  <th scope="col">A</th>
                  <th scope="col">B</th>
                  <th scope="col">差值</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, index) => (
                  <tr
                    key={row.metric}
                    data-probe="snapshot-diff-row"
                    data-metric={SNAPSHOT_METRICS[index]?.key}
                  >
                    <th scope="row">{row.metric}</th>
                    <td className={styles.num}>{formatNumber(row.a)}</td>
                    <td className={styles.num}>{formatNumber(row.b)}</td>
                    <td className={styles.num}>{formatDelta(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className={styles.note}>
            「—」表示那一侧的快照里没有这一项，不是 0；百分比以 A 为分母，A 为 0 时只给绝对差。
          </p>
        </div>

        <footer className={styles.footer}>
          {onExportCurrent ? (
            <Button
              type="button"
              data-probe="snapshot-export-json"
              onClick={onExportCurrent}
            >
              导出当前区间为 JSON
            </Button>
          ) : null}
          <Button type="button" variant="primary" onClick={onClose}>
            关闭
          </Button>
        </footer>
      </section>
    </div>
  );
}
