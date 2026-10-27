import { useState } from "react";
import { useBridges } from "../api/bridges";
import { useNotifications } from "../app/NotificationProvider";
import { CSV_BOM, toCsv } from "../features/usage/csvExport";
import styles from "./CsvExportButton.module.css";

/**
 * 「导出 CSV」按钮（E5）：把一张表格的**已算好的**行原样写成文件。
 *
 * 三条既有约定，一条都没新造：
 * ① 落盘走 `bridges.dialog.saveText`——它一次完成「弹保存框 + 写文件 + 取消返回 null」，
 *    这是用量快照导出（`UsageOverviewPage` 的「导出用量快照」）已经在走的路。
 *    不用 `fs.writeText`：那个要的是**绝对路径**，先把路径拼好等于自己发明一套选目录流程。
 * ② `null` = 用户取消，不是失败：不弹 toast、不留红字，和点「取消」应有的反应一致。
 * ③ 失败必须看得见：就地 `role="alert"` + 一条 error toast。静默失败比不导出更糟，
 *    用户会以为文件在磁盘上。
 *
 * 内容一律带 `CSV_BOM`：Excel 靠它才认 UTF-8，否则中文列头全是乱码。
 */
export function CsvExportButton({
  filename,
  headers,
  rows,
  label = "导出 CSV",
  probe
}: {
  /** 默认文件名（含扩展名）。不含路径、不含时分秒——同一个文件名再次导出时靠对话框让用户改名。 */
  filename: string;
  headers: readonly string[];
  rows: readonly (readonly (string | number | null)[])[];
  label?: string;
  /** 该按钮的 `data-probe` 锚点，三处挂载各自一个（e2e 靠它区分三枚按钮）。 */
  probe: string;
}) {
  const bridges = useBridges();
  const { notify } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = rows.length === 0;

  async function handleClick() {
    if (busy || empty) return;
    setBusy(true);
    setError(null);
    try {
      const path = await bridges.dialog.saveText(filename, CSV_BOM + toCsv(headers, rows), {
        title: "导出 CSV",
        filterName: "CSV",
        extensions: ["csv"]
      });
      // 取消：什么都不做，也不清掉上一次的错误——用户没要求重试。
      if (path === null) return;
      notify(`已导出 ${rows.length} 行 CSV`);
    } catch (cause) {
      const message = `导出失败：${cause instanceof Error ? cause.message : String(cause)}`;
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={styles.root} data-probe={probe}>
      <button
        type="button"
        className={styles.button}
        onClick={() => void handleClick()}
        disabled={empty || busy}
        title={empty ? "没有可导出的行" : label}
      >
        {busy ? "导出中…" : empty ? "无可导出" : label}
      </button>
      {error === null ? null : (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
