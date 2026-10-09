import { useEffect, useId, useRef, useState } from "react";
import type { ClipboardService } from "../../api/types";
import { useNotifications } from "../../app/NotificationProvider";
import type { ParseCoverage } from "./types";
import styles from "./ParseCoverageChip.module.css";

/** 类型分布表里最多铺开的行数；其余合并为「其它」。 */
const MAX_TYPE_ROWS = 5;
const OTHER_LABEL = "其它";

/** The M in 「M 行未识别」: unknown-typed lines plus unparsable lines. */
export function unrecognizedLineCount(coverage: ParseCoverage): number {
  const unknown = Object.values(coverage.unknownTypeCounts).reduce((sum, count) => sum + count, 0);
  return unknown + coverage.unparsableLines;
}

/** Unknown types sorted by count, descending — ties by name for a stable table. */
function sortedTypeCounts(coverage: ParseCoverage): Array<[string, number]> {
  return Object.entries(coverage.unknownTypeCounts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
}

/**
 * The clipboard report (design §5). Types and counts only — the session shows
 * up under its short label; a full path is treated the same as any other
 * sensitive datum and never enters the report (项目红线：报告不上传、不落盘、
 * 不带绝对路径). Exported pure so the redaction can be asserted directly.
 */
export function buildCoverageReport(coverage: ParseCoverage, sessionLabel: string): string {
  const lines = [
    "解析覆盖率报告",
    `会话: ${sessionLabel}`,
    `总行数: ${coverage.totalLines}`,
    `未识别行数: ${unrecognizedLineCount(coverage)}`
  ];
  const types = sortedTypeCounts(coverage);
  if (types.length > 0) {
    lines.push("未识别类型分布:");
    for (const [type, count] of types) lines.push(`  ${type}: ${count}`);
  }
  if (coverage.unparsableLines > 0) {
    lines.push(`无法解析的行数: ${coverage.unparsableLines}`);
  }
  return lines.join("\n");
}

/**
 * 解析覆盖率提示（design §5）：viewBar 右侧的一枚琥珀点文字 chip。M = 0 时
 * **什么都不渲染**——「全部解析」是默认期望，常驻报喜是 provenance 噪音。
 * 点击���非模态 popover（无遮罩，Esc / 点击外部关闭，焦点还触发元素）。
 */
export function ParseCoverageChip({
  coverage,
  sessionLabel,
  clipboard
}: {
  coverage: ParseCoverage;
  /** 报告里的会话短式标识（formatProjectPath 的产物，不含绝对路径）。 */
  sessionLabel: string;
  clipboard: ClipboardService;
}) {
  const unrecognized = unrecognizedLineCount(coverage);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const { notify } = useNotifications();

  useEffect(() => {
    if (!open) return;
    // `close` 只动 state 和 ref，从哪一帧捕获都等价，不必进 deps。
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        popoverRef.current &&
        target instanceof Node &&
        !popoverRef.current.contains(target) &&
        triggerRef.current !== target
      ) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  /** 关浮层并把焦点还给触发元素（WebKit 点按钮不给焦点，见 exportTriggerRef）。 */
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  if (unrecognized === 0) return null;

  const types = sortedTypeCounts(coverage);
  const shown = types.slice(0, MAX_TYPE_ROWS);
  const rest = types.slice(MAX_TYPE_ROWS);

  return (
    <span className={styles.host}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.chip}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.dot} aria-hidden="true" />
        {`${unrecognized} 行未识别`}
      </button>
      {open ? (
        <div ref={popoverRef} role="dialog" aria-labelledby={titleId} className={styles.popover}>
          <h3 id={titleId}>解析覆盖率</h3>
          <p className={styles.intro}>
            {`本会话 ${coverage.totalLines.toLocaleString("en-US")} 行中 ${unrecognized.toLocaleString(
              "en-US"
            )} 行属于当前版本不认识的记录类型，未纳入表格与统计。`}
          </p>
          {types.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>未识别类型</th>
                  <th>行数</th>
                  <th>占未识别</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(([type, count]) => (
                  <TypeRow key={type} type={type} count={count} total={unrecognized} />
                ))}
                {rest.length > 0 ? (
                  <TypeRow
                    type={OTHER_LABEL}
                    count={rest.reduce((sum, [, count]) => sum + count, 0)}
                    total={unrecognized}
                  />
                ) : null}
                {coverage.unparsableLines > 0 ? (
                  <TypeRow
                    type="（无法解析的行）"
                    count={coverage.unparsableLines}
                    total={unrecognized}
                  />
                ) : null}
              </tbody>
            </table>
          ) : (
            <p className={styles.intro}>{`其中 ${coverage.unparsableLines} 行不是合法 JSON，无法解析。`}</p>
          )}
          <div className={styles.reportRow}>
            <button
              type="button"
              className={styles.copy}
              onClick={() => {
                const text = buildCoverageReport(coverage, sessionLabel);
                clipboard
                  .writeText(text)
                  .then(() => notify("覆盖率报告已复制（只进剪贴板，不上传）", "success"))
                  .catch((cause) => notify(`复制报告失败: ${String(cause)}`, "error"));
              }}
            >
              复制报告
            </button>
            <span className={styles.reportNote}>报告只进剪贴板，不上传</span>
          </div>
        </div>
      ) : null}
    </span>
  );
}

/** One distribution row: mono type name, count, and the share track's language. */
function TypeRow({ type, count, total }: { type: string; count: number; total: number }) {
  const share = total > 0 ? count / total : 0;
  return (
    <tr>
      <td className={styles.typeName}>{type}</td>
      <td className={styles.count}>{count.toLocaleString("en-US")}</td>
      <td className={styles.share}>
        <span className={styles.shareTrack}>
          <span className={styles.shareFill} style={{ width: `${share * 100}%` }} />
        </span>
        <span className={styles.shareText}>{`${(share * 100).toFixed(1)}%`}</span>
      </td>
    </tr>
  );
}
