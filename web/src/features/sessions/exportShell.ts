/**
 * 导出文档的共用外壳。
 *
 * 会话报告（`sessions/exportHtml.ts`）与用量快照（`usage/usageSnapshot.ts`）是
 * 同一张纸的两个版次：同一套 token、同一个页面骨架（reset / `body` / `.sheet`
 * / `.head` / 品牌字形 / `h1` / `.meta` / `.foot`）、同一套深色与打印媒体查询，
 * 连读数带条目、章节标题与表格语言都逐字相同。这些「外壳」只允许有一个权威
 * 位置，于是整体搬到这里；两份文档各自特有的规则（报告的概览看板与记录表行
 * 类型、快照的 KPI 与图表/热力图/归因）仍旧留在各自模块里。
 *
 * 组装方式是「外壳固定 + 模块填空」：`exportShellStyle` 按文档顺序把外壳段落
 * 拼起来，模块把自己的调色板与专属规则填进对应插槽。插槽的位置由外壳决定，
 * 模块只提供内容、不参与排序——排序也是外壳的一部分，散到模块里就会重新漂移。
 */

/** 品牌字形，内联重绘——打包后的 PNG 不在导出文档的目录里。 */
export const WORDMARK_SVG =
  '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">' +
  '<rect x="0" y="0" width="18" height="18" rx="4" fill="#16181b"/>' +
  '<rect x="4" y="4" width="4" height="10" fill="#ffffff"/>' +
  '<rect x="10" y="7" width="4" height="7" fill="#ffffff"/>' +
  "</svg>";

/** 模块要补进外壳的段落，字段按文档顺序排列；缺省即「这一段没有内容」。 */
export type ExportShellParts = {
  /** 浅色 `:root`：基础 token 之后、字体栈之前的追加变量。 */
  tokens?: string;
  /** `.meta` 系列之后：模块的前置块（读数带容器等）。 */
  beforeReadouts?: string;
  /** 读数带条目之后、`h2` 之前：模块的概览规则。 */
  beforeHeading?: string;
  /** `h2` 之后、表格语言之前：模块的主体规则。 */
  afterHeading?: string;
  /** 表格语言之后、页脚之前：模块的表格专属规则。 */
  afterTable?: string;
  /** 页脚之后、深色媒体查询之前：模块的收尾规则（响应式等）。 */
  afterFoot?: string;
  /** 深色媒体查询 `:root` 里的追加变量。 */
  darkTokens?: string;
  /** 打印媒体查询里的 `:root` 规则整段；重声明多少由模块自己决定。 */
  printRoot?: string;
  /** 打印块内 `.sheet` 之后、表头规则之前：模块自己的分页规则。 */
  printRules?: string;
};

// 下面每一段都是外壳的原文，按文档顺序拼接后必须与重构前的报告逐字节一致。
const ROOT = `:root {
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
`;

const CHASSIS = `  --font-sans: system-ui, -apple-system, "Segoe UI", "PingFang SC",
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
`;

/** 读数带的条目语言：两份文档共用，容器列数各写各的。 */
const READOUT = `.readout { display: flex; flex-direction: column; gap: 2px; padding: 0 12px; }
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
`;

const HEADING = `h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; line-height: 20px; }
`;

/** 表格语言：两份文档都按这套排版自己的表。 */
const TABLE = `.table-wrap { overflow-x: auto; }
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
`;

const FOOT = `.foot {
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
`;

const DARK_OPEN = `@media (prefers-color-scheme: dark) {
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
`;

const DARK_CLOSE = `  }
}
@media print {
`;

const PRINT_BODY = `  body { padding: 0; }
  .sheet { max-width: none; padding: 0; border: 0; border-radius: 0; }
`;

const PRINT_TAIL = `  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .foot a { color: inherit; }
}
`;

/**
 * 拼出一份导出文档的整套内联样式：外壳段落固定，模块只补自己的调色板与专属
 * 规则。返回值已是可直接塞进 `<style>` 的文本（首尾无空行）。
 */
export function exportShellStyle(parts: ExportShellParts = {}): string {
  return (
    ROOT +
    (parts.tokens ?? "") +
    CHASSIS +
    (parts.beforeReadouts ?? "") +
    READOUT +
    (parts.beforeHeading ?? "") +
    HEADING +
    (parts.afterHeading ?? "") +
    TABLE +
    (parts.afterTable ?? "") +
    FOOT +
    (parts.afterFoot ?? "") +
    DARK_OPEN +
    (parts.darkTokens ?? "") +
    DARK_CLOSE +
    (parts.printRoot ?? "") +
    PRINT_BODY +
    (parts.printRules ?? "") +
    PRINT_TAIL
  ).trim();
}
