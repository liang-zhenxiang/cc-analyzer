import { useMemo } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { ScrollArea } from "../../components/ScrollArea";
import { ProvenanceBadge } from "../usage/ProvenanceBadge";
import { formatTokenCount, formatUsd } from "../../lib/format";
import type { ParsedSession } from "./types";
import {
  buildBleedReport,
  bleedHeadline,
  COUNT_ONLY_NOTE,
  type BleedItem,
  type BleedReport
} from "./bleedModel";
import styles from "./BleedView.module.css";

/** 四类计数器在本页的显示名。顺序固定，且四行**永远分开**（tokenTotals.ts:3-13）。 */
const COUNTER_ROWS = [
  { key: "input", name: "输入" },
  { key: "cacheCreation", name: "缓存写入" },
  { key: "cacheRead", name: "缓存读取" },
  { key: "output", name: "输出" }
] as const;

/**
 * 金额栏。`usd === null` 是「不知道」，**不是** `$0.00`——这是本页最重要的
 * 诚实性红线（design §2.3）。`formatUsd` 对 null 会印出 `$0.00`，所以这里
 * 必须在调用它之前就把 null 分出去。
 */
function CostReading({ item }: { item: BleedItem }) {
  if (item.usd === null) {
    return (
      <span className={styles.cost}>
        定价未知
        {item.unpricedCalls > 0 ? (
          <span className={styles.costNote}>{`（${item.unpricedCalls} 次调用未计入）`}</span>
        ) : null}
      </span>
    );
  }
  return (
    <span className={styles.cost}>
      {formatUsd(item.usd)}
      {item.unpricedCalls > 0 ? (
        <span className={styles.costNote}>{`（另有 ${item.unpricedCalls} 次调用定价未知，未计入）`}</span>
      ) : null}
    </span>
  );
}

/**
 * 一笔出血的读数。
 *
 * `evidence === "countOnly"` 时不画 token 四栏：这类条目（工具调用）的 token
 * 量在日志里根本不存在（`parseJsonl.ts:566-581` 不写 usage），`totals` 恒为 0。
 * 把 0 渲染成读数会被读成「这些工具不占空间」——那是个假事实，所以改为说明原因。
 */
function ItemCounters({ item }: { item: BleedItem }) {
  if (item.evidence === "countOnly") {
    return <p className={styles.scope}>{COUNT_ONLY_NOTE}</p>;
  }
  return (
    <dl className={styles.counters}>
      {COUNTER_ROWS.map((row) => (
        <div key={row.key} className={styles.counter}>
          <dt className={styles.counterName}>{row.name}</dt>
          <dd className={styles.counterValue} title={item.totals[row.key].toLocaleString("en-US")}>
            {formatTokenCount(item.totals[row.key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 出血清单里的一条。`kind` 进 `aria-label`，让读屏用户不必只看标题就猜类别。
 */
function BleedRow({ item }: { item: BleedItem }) {
  return (
    <li className={styles.item} aria-label={itemKindLabel(item.kind)}>
      <div className={styles.itemHead}>
        <span className={styles.itemLabel}>{item.label}</span>
        <CostReading item={item} />
      </div>
      <ItemCounters item={item} />
    </li>
  );
}

const KIND_LABELS = {
  compaction: "压缩",
  toolOutput: "工具",
  cacheRewrite: "缓存重写"
} as const;

function itemKindLabel(kind: BleedItem["kind"]): string {
  return KIND_LABELS[kind];
}

/**
 * 排序说明。三类条目的排序键互不相同（时间 / 次数 / 无），**不存在一个有意义的
 * 全局序**，所以清单按 `report.items` 的原序渲染、不重排——重排就是第二套口径。
 * 这里如实把这个事实说给用户，尤其别把 toolOutput 说成「按占用降序」：它没有
 * 可信的 token 量可排（`bleedModel.ts` 的 `toolOutputItems` 注释）。
 */
function sortNote(report: BleedReport): string {
  const kinds = new Set(report.items.map((item) => item.kind));
  const parts: string[] = [];
  if (kinds.has("compaction")) parts.push("压缩按时间");
  if (kinds.has("toolOutput")) parts.push("工具按调用次数");
  if (parts.length === 0) return "";
  return `排序：${parts.join("；")}。`;
}

export function BleedView({ parsed }: { parsed: ParsedSession }) {
  const report = useMemo(() => buildBleedReport(parsed), [parsed]);
  const headline = bleedHeadline(report);

  // 两种空态是**不同的事实**，不能合并成一句（design §2.5）：
  // - 没有压缩事件：这一页没有东西可讲。
  // - 有压缩、但没有可归因的出血点：压缩确实发生了，只是没丢东西。
  if (report.compactionCount === 0) {
    return (
      <EmptyState
        size="panel"
        title="本会话没有发生压缩"
        description="没有压缩边界就没有上下文出血点可归因。这个会话的上下文一直是连续的。"
      />
    );
  }

  if (report.items.length === 0) {
    return (
      <EmptyState
        size="panel"
        title="压缩了但没丢东西"
        description={`本会话发生了 ${report.compactionCount} 次压缩，但没有可归因的出血点：没有消息被丢出上下文，也没有显著的工具或缓存重写。`}
      />
    );
  }

  // 有压缩、有清单，但一条消息都没丢（`bleedModel` 会产出一条 0 条记录的
  // compaction 条目）。这时清单本身没什么可看的，说清楚事实即可——**不能**
  // 因为 items 非空就假装有东西可看，也不能退回「没有发生压缩」。
  const nothingDropped = report.items.every(
    (item) => item.kind !== "compaction" || item.recordIds.length === 0
  );
  if (nothingDropped) {
    return (
      <EmptyState
        size="panel"
        title="压缩了但没丢东西"
        description={`本会话发生了 ${report.compactionCount} 次压缩，但没有一条消息被丢出上下文。${headline}`}
      />
    );
  }

  const note = sortNote(report);

  return (
    <div className={styles.stack}>
      <Panel
        title="上下文出血点"
        ariaLabel="上下文出血点"
        actions={
          <ProvenanceBadge
            provenance={report.hasEstimate ? "estimated" : "logged"}
            detail={report.hasEstimate ? `快照日期 ${report.pricingAsOf}` : undefined}
          />
        }
      >
        <p className={styles.headline}>
          <span className={styles.headlineText}>{headline}</span>
        </p>
        <ScrollArea className={styles.listHost}>
          <ul className={styles.list} aria-label="出血清单">
            {report.items.map((item, index) => (
              <BleedRow key={`${item.kind}-${item.label}-${index}`} item={item} />
            ))}
          </ul>
        </ScrollArea>
        <p className={styles.scope}>
          {"口径：四类计数器分开读数，未求和；token 读自日志，金额按定价快照估算。"}
          {note}
        </p>
      </Panel>
    </div>
  );
}
