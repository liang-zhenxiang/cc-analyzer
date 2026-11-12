import { formatFullDate, formatTokenCount } from "../../lib/format";
import type { TimeCapsule } from "./timeCapsule";
import styles from "./TimeCapsuleCard.module.css";

/**
 * 时间胶囊：一句话读完的一条记录，不是一张报表。
 *
 * 模型层（`timeCapsule.ts`）已经算好了日期、标签、句子和两个读数，这里只
 * 负责「把一句话摆正」：
 *
 * 1. **不画卡片框**：左侧 3px `--accent` 竖线是它唯一的边界。上下发丝线在
 *    用量页会和相邻面板自身的 `--border` 相隔 sp-3 形成三道平行线，反而更吵，
 *    所以这里选透明底、不画横线——胶囊靠留白与竖线从面板流里分出来。
 * 2. **一句话是主语**：sentence 用 `--fs-md` / `--text-secondary`，视觉上
 *    高于 kicker、低于任何标题。line-clamp 只截「看得见的行数」，文本节点本身
 *    永远是完整句子（屏幕阅读器与单测读到的都是全文）。
 * 3. **读数靠右、等宽**：tokens 是卡片上唯一的大数字，用 `--fs-lg` + tabular-nums；
 *    会话数退成小字。窄窗（≤720px）时整簇换到下一行，不挤压正文。
 *
 * 组件假定 `capsule` 非空：空不空由调用方决定渲不渲染，组件内部再判一次
 * 会让「空」有两种表达。
 */
export function TimeCapsuleCard({ capsule }: { capsule: TimeCapsule }) {
  return (
    <section className={styles.capsule} aria-label="时间胶囊" data-probe="time-capsule">
      <div className={styles.body}>
        <p className={styles.kicker}>
          <span className={styles.date} data-probe="time-capsule-date">
            {formatFullDate(capsule.dayStart)}
          </span>
          {/* 分隔点只是排版标点，不属于可读内容。 */}
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
          <span className={styles.label} data-probe="time-capsule-label">
            {capsule.label}
          </span>
        </p>
        <p className={styles.sentence} data-probe="time-capsule-sentence">
          {capsule.sentence}
        </p>
      </div>
      <div className={styles.readouts}>
        <span className={styles.tokens}>
          <span className={styles.tokenValue} data-probe="time-capsule-tokens">
            {formatTokenCount(capsule.tokens)}
          </span>
          <span className={styles.tokenUnit}>tokens</span>
        </span>
        <span className={styles.sessions} data-probe="time-capsule-sessions">
          {capsule.sessions} 个会话
        </span>
      </div>
    </section>
  );
}
