import { useMemo, useState } from "react";
import { formatClock, formatShortStamp } from "../../lib/format";
import { buildErrorArchive, type ErrorArchiveGroup } from "./errorArchive";
import type { ErrorEvent } from "./errorStats";
import { dayStartOf } from "./usageAggregations";
import styles from "./ErrorArchivePanel.module.css";

/**
 * 「错误档案」（G5）：错误档的第二档——把窗口内的失败按 (工具, 模板签名)
 * 聚成一行一类，行可展开看代表消息与涉及会话。
 *
 * 与时间线档的「错误聚类」分工：聚类是现场视图，不出这个档位；档案是销账
 * 视图，回答「这周我到底在跟几个问题打架」，同一模板的 `ENOENT: /a` 与
 * `ENOENT: /b` 合成一类。两档吃同一份 `stats.events`。
 */

function timeRangeText(group: ErrorArchiveGroup): string {
  if (group.firstAt === group.lastAt) return formatShortStamp(group.firstAt);
  if (dayStartOf(group.firstAt) === dayStartOf(group.lastAt)) {
    return `${formatClock(group.firstAt)}–${formatClock(group.lastAt)}`;
  }
  return `${formatShortStamp(group.firstAt)} – ${formatShortStamp(group.lastAt)}`;
}

export function ErrorArchivePanel({
  events,
  onRevealRecord
}: {
  events: readonly ErrorEvent[];
  onRevealRecord?: (path: string, recordId: string | null) => void;
}) {
  const groups = useMemo(() => buildErrorArchive(events), [events]);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  function keyOf(group: ErrorArchiveGroup): string {
    return `${group.tool}\u0000${group.signature}`;
  }

  function toggle(group: ErrorArchiveGroup) {
    const key = keyOf(group);
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (groups.length === 0) {
    return (
      <div className={styles.root} data-probe="error-archive">
        <p className={styles.emptyFact}>窗口内没有错误</p>
      </div>
    );
  }

  return (
    <div className={styles.root} data-probe="error-archive">
      <table className={styles.table}>
        <caption className={styles.srOnly}>错误档案：按工具与错误签名聚类</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.colTool}>
              工具
            </th>
            <th scope="col">签名</th>
            <th scope="col" className={styles.colNum}>
              次数
            </th>
            <th scope="col" className={styles.colNum}>
              会话
            </th>
            <th scope="col" className={styles.colTime}>
              首末
            </th>
            <th scope="col" className={styles.colToggle}>
              展开
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const key = keyOf(group);
            const open = openKeys.has(key);
            return [
              <tr key={key} className={styles.row} data-probe="archive-row" aria-expanded={open}>
                <td className={styles.tool}>{group.tool}</td>
                <td className={styles.signature} title={group.signature}>
                  {group.signature}
                </td>
                <td className={styles.num}>{group.count.toLocaleString("en-US")}</td>
                <td className={styles.num}>{group.sessionIds.length.toLocaleString("en-US")}</td>
                <td className={styles.time}>{timeRangeText(group)}</td>
                <td className={styles.toggleCell}>
                  <button
                    type="button"
                    className={styles.toggle}
                    aria-expanded={open}
                    aria-label={`${open ? "收起" : "展开"} ${group.tool} ${group.signature} 的档案`}
                    onClick={() => toggle(group)}
                  >
                    <span className={styles.chev} aria-hidden="true" />
                  </button>
                </td>
              </tr>,
              open ? (
                <tr key={`${key}-detail`} className={styles.detailRow} data-probe="archive-detail">
                  <td colSpan={6}>
                    <p className={styles.sample}>
                      代表消息：<code>{group.sample}</code>
                    </p>
                    <ul className={styles.sessions}>
                      {group.sessionIds.slice(0, 5).map((path) => {
                        const name = path.split(/[\\/]+/).filter(Boolean).at(-1) ?? path;
                        return (
                          <li key={path}>
                            <button
                              type="button"
                              className={styles.sessionLink}
                              disabled={onRevealRecord === undefined}
                              onClick={() => onRevealRecord?.(path, null)}
                            >
                              {name}
                            </button>
                          </li>
                        );
                      })}
                      {group.sessionIds.length > 5 ? (
                        <li className={styles.more}>{`另有 ${group.sessionIds.length - 5} 个会话`}</li>
                      ) : null}
                    </ul>
                  </td>
                </tr>
              ) : null
            ];
          })}
        </tbody>
      </table>
      <p className={styles.caption}>
        同工具、同一模板的错误合并为一行；按次数降序，并列按签名升序。
      </p>
    </div>
  );
}
