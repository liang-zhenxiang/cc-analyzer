/**
 * CSV 序列化（E5）：纯函数，不碰 DOM、不碰 I/O、不读时钟。
 *
 * 口径按 RFC 4180，只有四条：
 * ① 字段含 `,`、`"`、`\r`、`\n` 时用双引号包起来，内部的 `"` 双写；
 * ② 数字原样输出——不补千分位、不四舍五入，导出的是数据不是排版；
 * ③ `null` → 空串（空字段与空字符串字段在 CSV 里本来就是同一个东西，两者都不加引号）；
 * ④ 行尾一律 `\r\n`，**最后一行也带**：Excel / Numbers / pandas 都能读，
 *    而缺最后一个换行时，追加写入会把两批数据粘成一行。
 *
 * 非有限数（`NaN` / `Infinity`）→ 空串：它们不是数值，原样写出去会让整列
 * 被表格软件当成文本，比留空更难收拾。
 */

/** UTF-8 BOM：Excel 打开中文 CSV 不乱码的唯一开关。由调用方拼在内容最前面。 */
export const CSV_BOM = "\uFEFF";

/** RFC 4180 的换行。 */
export const CSV_EOL = "\r\n";

const NEEDS_QUOTE = /[",\r\n]/u;

function escapeField(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return NEEDS_QUOTE.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

/**
 * 表头 + 数据行 → CSV 文本（不含 BOM）。
 *
 * 表头同样过转义：列名里出现逗号（例如「输入、输出」被写成「输入,输出」）时，
 * 不转义会让整张表的列数错位——这比数据错更难发现。
 */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null)[])[]
): string {
  if (headers.length === 0 && rows.length === 0) return "";
  const lines: string[] = [];
  if (headers.length > 0) lines.push(headers.map(escapeField).join(","));
  for (const row of rows) lines.push(row.map(escapeField).join(","));
  return lines.join(CSV_EOL) + CSV_EOL;
}

/**
 * 导出文件名：`cc-analyzer-<slug>-<YYYY-MM-DD>.csv`。
 *
 * 日期取**本地时区**（用户眼里的「今天」），显式传入 `at` 而不是在函数里读时钟——
 * 这样单测能给固定时刻。文件名里不放项目名、用户名或路径：导出文件经常被转发，
 * 图省事带上路径等于把本机目录结构一起发出去。
 */
export function csvFileName(slug: string, at: number): string {
  const date = new Date(at);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `cc-analyzer-${slug}-${year}-${month}-${day}.csv`;
}
