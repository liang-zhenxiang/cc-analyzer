import { useState } from "react";
import type { Bridges } from "../../api/types";
import type { ReportMode } from "./report";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { ReportMarkdown } from "./ReportMarkdown";
import styles from "./ReportPanel.module.css";

export function ReportPanel({
  text,
  loading,
  error,
  stale,
  mode,
  onModeChange,
  onGenerate,
  onCancel,
  onClear,
  bridges,
  defaultName,
  nodeLabel,
  meta,
  truncated,
  onOpenTerminal
}: {
  text: string;
  loading: boolean;
  error: string | null;
  stale: boolean;
  mode: ReportMode;
  onModeChange: (mode: ReportMode) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onClear: () => void;
  bridges: Bridges;
  defaultName: string;
  nodeLabel?: string | null;
  meta?: { claudeId?: string; costUsd?: number; durationMs?: number } | null;
  truncated?: { shown: number; total: number; limit: number } | null;
  onOpenTerminal?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setExportError(null);
    try {
      await bridges.dialog.saveMarkdown(defaultName, text);
    } catch (cause) {
      setExportError(`导出失败: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSaving(false);
    }
  }

  const modes: Array<[ReportMode, string]> = [
    ["whole", "整会话分析"],
    ["filtered", "筛选后分析"],
    ["timeblock", "时间块分析"],
    ["node", "节点分析"]
  ];

  const modeItems: SegmentedItem<ReportMode>[] = modes.map(([value, label]) => ({
    value,
    label: value === "node" && nodeLabel ? `${label}：${nodeLabel}` : label,
    disabled: value === "node" && !nodeLabel,
    title: value === "node" && !nodeLabel ? "先在树视图选择一个节点" : undefined
  }));

  return (
    <section className={styles.panel} aria-label="会话分析报告">
      <header>
        <h2>会话分析报告</h2>
        <SegmentedControl
          items={modeItems}
          value={mode}
          onChange={onModeChange}
          ariaLabel="报告范围"
        />
        <Button type="button" variant="primary" onClick={onGenerate} disabled={loading}>
          {loading
            ? "正在分析中…"
            : mode === "whole"
              ? "生成整会话分析"
              : mode === "filtered"
                ? "分析筛选出的记录"
                : mode === "node"
                  ? "分析选中节点"
                  : "生成时间块分析"}
        </Button>
        {loading ? (
          <Button type="button" onClick={onCancel}>
            停止分析
          </Button>
        ) : null}
        {onOpenTerminal ? (
          <Button type="button" title="打开 claude 终端继续追问" onClick={onOpenTerminal}>
            打开 claude 终端继续追问
          </Button>
        ) : null}
        <Button type="button" onClick={() => void save()} disabled={!text || saving}>
          导出 .md
        </Button>
        {text ? <Button type="button" onClick={onClear}>清除报告</Button> : null}
      </header>
      {truncated && truncated.total > truncated.limit ? (
        <div role="status" className={styles.warning}>
          只分析最慢的 {truncated.limit} 条（共 {truncated.total} 条）
        </div>
      ) : null}
      {stale ? <div role="status" className={styles.warning}>筛选或窗口已变化，建议重新生成</div> : null}
      {error ? <div role="alert">{error}</div> : null}
      {exportError ? <div role="alert">{exportError}</div> : null}
      {meta && (meta.claudeId || meta.costUsd != null || meta.durationMs != null) ? (
        <div className={styles.meta} role="status">
          {[
            meta.claudeId ? `Claude 会话 ${meta.claudeId}` : "",
            meta.durationMs == null ? "" : `耗时 ${(meta.durationMs / 1000).toFixed(1)}s`,
            meta.costUsd == null ? "" : `成本 $${meta.costUsd.toFixed(4)}`
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
      {text ? (
        <ReportMarkdown text={text} />
      ) : (
        <EmptyState size="panel" title="选择报告范围后点击生成。" />
      )}
    </section>
  );
}
