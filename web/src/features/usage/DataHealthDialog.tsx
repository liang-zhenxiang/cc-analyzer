import { useEffect, useMemo, useRef } from "react";
import { Button, IconButton } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { dataHealthReport, type HealthInput } from "../sessions/dataHealth";
import styles from "./DataHealthDialog.module.css";

/**
 * H9 数据体检浮层（Round HH §4.9）：把 HealthReport 端出来。
 *
 * 分工：评级/评分/检查项全由 dataHealth 模型层算，界面只有三件事——
 * 按顺序渲染、未通过项给建议、通过项也照样说数（「1 条 · 占 0.01%」
 * 比一个 ✓ 更能让人相信）。
 *
 * 浮层语言与「对比快照」同一套：居中卡 + Esc 捕获阶段消化 + Tab 回绕
 * + 关闭后焦点还给入口。三种「没问题」分开说：没扫过（不出报告）、
 * 五项全过（一行「五项全过」）、有小瑕疵但占比极小（advice 由模型层给）。
 */

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function DataHealthDialog({
  input,
  onClose
}: {
  /** 扫描层既有统计拼出的六数字（拼装口径见调用方）。 */
  input: HealthInput;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  const report = useMemo(() => dataHealthReport(input), [input]);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => returnTo?.focus?.();
  }, []);

  // 与对比快照同一套键盘契约：Esc 捕获阶段消化，Tab 在卡内回绕。
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

  const allPass = report.checks.every((check) => check.pass);

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
        aria-labelledby="data-health-title"
        className={styles.panel}
        data-probe="health-dialog"
      >
        <header className={styles.header}>
          <h2 id="data-health-title">数据体检</h2>
          <IconButton label="关闭数据体检" onClick={onClose}>
            <Icon name="close" size={16} />
          </IconButton>
        </header>

        <div className={styles.body}>
          {/* 三种「没问题」里最实的一种：没扫过就不出报告——空数据
              没有体检可言，亮一个「优」是说谎。 */}
          {input.sessions === 0 ? (
            <p className={styles.noScan} data-probe="health-empty">
              还没有扫描过任何会话，体检无从谈起。
            </p>
          ) : (
            <>
              <div className={styles.verdict}>
                <span
                  className={styles.grade}
                  data-probe="health-grade"
                  data-grade={report.grade}
                >
                  {report.grade}
                </span>
                <span className={styles.score}>{report.score} 分</span>
                {allPass ? <span className={styles.allPass}>五项全过</span> : null}
              </div>
              <ul className={styles.checks} data-probe="health-checks">
                {report.checks.map((check) => (
                  <li
                    key={check.id}
                    data-probe="health-check-row"
                    data-check={check.id}
                    data-pass={check.pass}
                  >
                    <span className={styles.mark} aria-hidden="true">
                      {check.pass ? "✓" : "!"}
                    </span>
                    <span className={styles.checkText}>
                      <span className={styles.checkLabel}>{check.label}</span>
                      <span className={styles.checkActual}>{check.actual}</span>
                      {check.pass ? null : (
                        <span className={styles.checkAdvice}>{check.advice}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className={styles.note}>
            五项检查按「截断 → 未配对 → 警告 → 缺 usage → 会话数」顺序；未通过项给出建议，不自动修数据。
          </p>
        </div>

        <footer className={styles.footer}>
          <Button type="button" variant="primary" onClick={onClose} data-probe="health-close">
            知道了
          </Button>
        </footer>
      </section>
    </div>
  );
}
