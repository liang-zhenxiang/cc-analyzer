import { formatClock, formatDateTime, formatDuration, formatTokenCount, formatUsd } from "../../lib/format";
import { estimateCost, PRICING_AS_OF } from "../usage/pricingSnapshot";
import { aggregateSession, totalsSum } from "../usage/usageAggregations";
import { ROW_KIND_LABELS, rowKind, tokensOf, type LogRowKind } from "./logRows";
import { recordSummary } from "./recordSummary";
import { tokenTotalsOf } from "./tokenTotals";
import type { SessionRecord } from "./types";
import {
  REPO_URL,
  exportId,
  recordsForExport,
  scopeLabel,
  type ExportInput
} from "./exportTypes";

/**
 * The report's stylesheet, inlined. It is a stand-alone asset: no app CSS, no
 * CDN, no font files. Values mirror `web/src/styles/tokens.css` (light segment
 * identical, dark segment taking the same tokens the app uses) so the report
 * reads as a slice of the app — but the report must not depend on the app
 * loading, so every value is a constant here.
 */
const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f4f5f7;
  --surface: #ffffff;
  --inset: #f1f3f5;
  --text: #16181b;
  --text-secondary: #4a5260;
  --text-tertiary: #6b7381;
  --border: rgba(16, 24, 40, 0.1);
  --border-strong: rgba(16, 24, 40, 0.18);
  --accent: #2952cc;
  --danger: #b3261e;
  --cat-user: #cc79a7;
  --cat-llm: #009e73;
  --cat-tool: #0072b2;
  --cat-agent: #d55e00;
  --cat-workflow: #6d3bd4;
  --cat-wait: #6b7280;
  --font-sans: system-ui, -apple-system, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px 16px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 20px;
  -webkit-font-smoothing: antialiased;
}
.sheet {
  max-width: 960px;
  margin: 0 auto;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.head { display: flex; flex-direction: column; gap: 12px; }
.wordmark {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  letter-spacing: -0.01em;
}
.wordmark svg { display: block; }
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.meta { margin: 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.meta code { color: var(--text-secondary); font-family: var(--font-mono); font-size: 11px; }
.readouts {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin-top: 4px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--inset);
}
.readout { display: flex; flex-direction: column; gap: 2px; padding: 0 12px; }
.readout + .readout { border-left: 1px solid var(--border); }
.readout dt { color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.readout dd {
  margin: 0;
  color: var(--text);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
}
.summary { margin-top: 32px; }
h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; line-height: 20px; }
.facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr);
  column-gap: 16px;
  margin: 0;
  padding: 0;
}
.facts dt, .facts dd {
  margin: 0;
  padding: 6px 0;
  border-top: 1px solid var(--border);
  font-size: 13px;
  line-height: 20px;
}
.facts dt { color: var(--text-tertiary); padding-right: 8px; }
.facts dd { color: var(--text); font-variant-numeric: tabular-nums; }
.facts dd.unknown { color: var(--text-tertiary); font-variant-numeric: normal; }
.estimate-note { margin: 8px 0 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.records { margin-top: 32px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
thead th {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-strong);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0.04em;
  text-align: left;
  white-space: nowrap;
}
tbody td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  line-height: 20px;
  vertical-align: top;
}
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.summary-cell { overflow-wrap: anywhere; }
.failed { color: var(--danger); }
.muted { color: var(--text-tertiary); }
.swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 2px;
  vertical-align: baseline;
}
.truncated-row td {
  padding: 12px 10px;
  border-bottom: 0;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}
.foot {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
}
.foot p { margin: 0; }
.foot p + p { margin-top: 4px; }
.foot a { color: var(--accent); }
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0f12;
    --surface: #1a1d21;
    --inset: #0a0b0d;
    --text: #f0f2f5;
    --text-secondary: #b4bcc6;
    --text-tertiary: #8b939e;
    --border: rgba(255, 255, 255, 0.07);
    --border-strong: rgba(255, 255, 255, 0.14);
    --accent: #7fa8ff;
    --danger: #f0776c;
    --cat-tool: #4da6e0;
    --cat-workflow: #9b7bf0;
    --cat-wait: #8a93a0;
  }
}
@media print {
  :root { --bg: #ffffff; --surface: #ffffff; }
  body { padding: 0; }
  .sheet { max-width: none; padding: 0; border: 0; border-radius: 0; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .foot a { color: inherit; }
}
`.trim();

/** The brand mark, redrawn inline — the packaged PNG is not available here. */
const WORDMARK_SVG =
  '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">' +
  '<rect x="0" y="0" width="18" height="18" rx="4" fill="#16181b"/>' +
  '<rect x="4" y="4" width="4" height="10" fill="#ffffff"/>' +
  '<rect x="10" y="7" width="4" height="7" fill="#ffffff"/>' +
  "</svg>";

const KIND_COLORS: Record<LogRowKind, string> = {
  user: "var(--cat-user)",
  llm: "var(--cat-llm)",
  tool: "var(--cat-tool)",
  subagent: "var(--cat-agent)",
  workflow: "var(--cat-workflow)",
  wait: "var(--cat-wait)"
};

/**
 * Every dynamic value goes through here. Session text is user input — it can
 * hold `<script>`, `<img onerror=...>`, anything the user once pasted into a
 * terminal — so escaping is the report's whole injection surface.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type CostFact = { text: string; unknown: boolean; note: string };

/**
 * Cost is an estimate, so it is either priced or it says it is not. A partial
 * sum next to an unpriced model would read as the total — the same reason the
 * app shows a provenance badge instead of a bare number.
 */
function costFact(records: readonly SessionRecord[]): CostFact {
  const aggregate = aggregateSession(records);
  if (totalsSum(aggregate.totals) === 0) {
    return { text: "未知", unknown: true, note: "本次会话没有 token 记录。" };
  }
  let usd = 0;
  let unpricedRecords = 0;
  for (const [model, totals] of aggregate.models) {
    const estimate = estimateCost(totals, model);
    if ("unknownModel" in estimate) unpricedRecords += totals.messages;
    else usd += estimate.usd;
  }
  const basis = `成本按 ${PRICING_AS_OF} 的离线定价快照估算，非账单`;
  if (unpricedRecords > 0) {
    return {
      text: "未知",
      unknown: true,
      note: `${basis}；另有 ${unpricedRecords.toLocaleString("en-US")} 条记录的模型未收录定价。`
    };
  }
  return { text: formatUsd(usd), unknown: false, note: `${basis}。` };
}

function readout(label: string, value: string): string {
  return `<div class="readout"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function fact(label: string, value: string, unknown = false): string {
  const cls = unknown ? ' class="unknown"' : "";
  return `<dt>${escapeHtml(label)}</dt><dd${cls}>${escapeHtml(value)}</dd>`;
}

function dayOf(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** `HH:mm:ss` within one day; a cross-day report keeps the date so rows stay orderable. */
function reportTime(ms: number, sessionDay: string): string {
  const clock = formatClock(ms, true);
  if (dayOf(ms) === sessionDay) return clock;
  return `${formatClock(ms, false)}:${String(new Date(ms).getSeconds()).padStart(2, "0")}`;
}

function recordRow(
  sessionDay: string,
  timestamp: number,
  summary: string,
  error: boolean,
  kind: LogRowKind,
  durationMs: number,
  tokens: { prompt: number; output: number } | null,
  totalDuration: number
): string {
  const time = reportTime(timestamp, sessionDay);
  const numeric = (value: number | null) =>
    value === null ? '<td class="num muted">—</td>' : `<td class="num">${value.toLocaleString("en-US")}</td>`;
  // A non-finite duration is unknown, not `NaN%`: the share column would print
  // `NaN%` and read as a number that means nothing.
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const share =
    totalDuration > 0 ? `${((safeDuration / totalDuration) * 100).toFixed(1)}%` : "—";
  return (
    "<tr>" +
    `<td class="mono">${escapeHtml(time)}</td>` +
    `<td><span class="swatch" style="background:${KIND_COLORS[kind]}" aria-hidden="true"></span>${escapeHtml(ROW_KIND_LABELS[kind])}</td>` +
    (summary.length > 0
      ? `<td class="summary-cell">${escapeHtml(summary)}</td>`
      : '<td class="summary-cell muted">—</td>') +
    numeric(tokens ? tokens.prompt : null) +
    numeric(tokens ? tokens.output : null) +
    `<td class="num">${escapeHtml(formatDuration(safeDuration))}</td>` +
    `<td class="num">${escapeHtml(share)}</td>` +
    (error ? '<td class="failed">失败</td>' : "<td>正常</td>") +
    "</tr>"
  );
}

/**
 * A single self-contained HTML file: one `<style>`, one inline SVG, one link.
 *
 * Three constraints decide almost every line below. It must open offline (no
 * CDN, no font file, no image), it must survive being pasted into a chat window
 * (semantic skeleton, no JS), and it must not carry anything the session itself
 * did not contain — the project shows up as a directory name, never a path.
 */
export function htmlReportOf(input: ExportInput): string {
  const { records, truncated, total } = recordsForExport(input);
  // Totals are summed from the records actually in the report, so the readouts
  // can never disagree with the table underneath them.
  const totals = tokenTotalsOf(records);
  const totalDuration = Math.max(0, input.endedAt - input.startedAt);
  const failed = records.filter((record) => record.isError).length;
  const toolCalls = records.filter(
    (record) => record.kind === "tool" && record.toolCategory !== "delegated"
  ).length;
  const cost = costFact(records);
  const sessionDay = dayOf(input.startedAt);
  const scopeValue =
    input.scope === "all"
      ? `全部记录（${total.toLocaleString("en-US")} 条）`
      : `当前筛选结果（共 ${input.allRecords.length.toLocaleString("en-US")} 条中的 ${total.toLocaleString("en-US")} 条）`;

  const body = records
    .map((record) =>
      recordRow(
        sessionDay,
        record.timestamp,
        recordSummary(record),
        record.isError,
        rowKind(record),
        record.durationMs,
        tokensOf(record),
        totalDuration
      )
    )
    .join("\n        ");

  const truncatedRow = truncated
    ? `\n        <tfoot><tr class="truncated-row"><td colspan="8">另有 ${(total - records.length).toLocaleString("en-US")} 条记录未列出（本报告最多列出 ${records.length.toLocaleString("en-US")} 条）。</td></tr></tfoot>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>CC Analyzer 会话报告 · ${escapeHtml(input.title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <main class="sheet">
    <header class="head">
      <span class="wordmark">${WORDMARK_SVG} CC Analyzer</span>
      <h1>${escapeHtml(input.title)}</h1>
      <p class="meta">项目 <code>${escapeHtml(input.projectName)}</code> · 会话 <code>${escapeHtml(exportId(input.sessionId))}</code> · 生成于 ${escapeHtml(formatDateTime(input.generatedAt))}</p>
      <dl class="readouts">
        ${readout("总耗时", formatDuration(totalDuration))}
        ${readout("输入", formatTokenCount(totals.input))}
        ${readout("缓存读取", formatTokenCount(totals.cacheRead))}
        ${readout("输出", formatTokenCount(totals.output))}
        ${readout("记录数", records.length.toLocaleString("en-US"))}
      </dl>
    </header>
    <section class="summary">
      <h2>会话概览</h2>
      <dl class="facts">
        ${fact("开始时间", formatDateTime(input.startedAt))}
        ${fact("结束时间", formatDateTime(input.endedAt))}
        ${fact("总耗时", formatDuration(totalDuration))}
        ${fact("输入", formatTokenCount(totals.input))}
        ${fact("缓存写入", formatTokenCount(totals.cacheCreation))}
        ${fact("缓存读取", formatTokenCount(totals.cacheRead))}
        ${fact("输出", formatTokenCount(totals.output))}
        ${fact("记录数", records.length.toLocaleString("en-US"))}
        ${fact("失败记录", failed.toLocaleString("en-US"))}
        ${fact("工具调用", `${toolCalls.toLocaleString("en-US")} 次`)}
        ${fact("成本估算", cost.text, cost.unknown)}
        ${fact("导出范围", scopeValue)}
      </dl>
      <p class="estimate-note">${escapeHtml(cost.note)}</p>
    </section>
    <section class="records">
      <h2>记录（${records.length.toLocaleString("en-US")} 条 · ${escapeHtml(scopeLabel(input.scope))}）</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th><th>类型</th><th>操作 / 摘要</th><th class="num">提示词</th>
              <th class="num">输出</th><th class="num">耗时</th><th class="num">占比</th><th>状态</th>
            </tr>
          </thead>
          <tbody>
        ${body}
          </tbody>${truncatedRow}
        </table>
      </div>
    </section>
    <footer class="foot">
      <p>本报告由 CC Analyzer 生成，数据未上传至任何服务器。</p>
      <p>CC Analyzer v${escapeHtml(input.appVersion)} · <a href="${REPO_URL}" rel="noreferrer">github.com/liang-zhenxiang/cc-analyzer</a></p>
      <p>报告生成于 ${escapeHtml(formatDateTime(input.generatedAt))}</p>
    </footer>
  </main>
</body>
</html>
`;
}
