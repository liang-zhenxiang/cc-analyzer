import type { BriefingItem, BriefingKind, BriefingTarget } from "./dailyBriefing";
import styles from "./BriefingStrip.module.css";

/**
 * H1「晨报」：页头与第一张卡之间的一条 42px 带子，最多三件事。
 *
 * 界面只做四件事：按 `rank` 排、把 `kind` 映射成标签与语气、渲染、跳转。
 * 候选池、阈值、文案都在 `dailyBriefing.ts` 里——这里不重算任何聚合，也不
 * 复核「预算是否真的到 85%」：两处各判一次，迟早会一处说超、一处说没超。
 *
 * 空数组整条不渲染：没有值得说的事时，晨报不该占着页头说「一切正常」。
 */

type Tone = "neutral" | "warning" | "alert";

const KIND_META: Record<BriefingKind, { tag: string; tone: Tone }> = {
  spike: { tag: "昨日", tone: "neutral" },
  drop: { tag: "昨日", tone: "neutral" },
  anomaly: { tag: "异常日", tone: "warning" },
  budget: { tag: "预算", tone: "alert" },
  errors: { tag: "错误", tone: "alert" },
  quiet: { tag: "安静", tone: "warning" }
};

/** 语气的前缀词：颜色之外的第二条通道，去掉颜色仍读得懂轻重。 */
const TONE_PREFIX: Record<Tone, string> = {
  neutral: "",
  warning: "注意",
  alert: "警报"
};

export function BriefingStrip({
  items,
  onNavigate
}: {
  items: readonly BriefingItem[];
  onNavigate: (target: BriefingTarget) => void;
}) {
  if (items.length === 0) return null;

  // 模型已按优先级排序；再排一次只是防御（快照/缓存里可能带旧顺序），
  // 不改变「谁的 rank 小谁在前」这一条。
  const ordered = [...items].sort((a, b) => a.rank - b.rank).slice(0, 3);

  return (
    <section
      className={styles.briefing}
      data-probe="briefing"
      data-count={ordered.length}
      aria-label="今天值得注意的三件事"
    >
      {ordered.map((item) => {
        const meta = KIND_META[item.kind];
        const prefix = TONE_PREFIX[meta.tone];
        return (
          <button
            key={item.id}
            type="button"
            className={styles.briefingItem}
            data-tone={meta.tone}
            data-probe="briefing-item"
            onClick={() => onNavigate(item.target)}
            title={item.detail ? `${item.headline}（${item.detail}）` : item.headline}
          >
            <span className={styles.briefingTag}>
              {prefix ? <span className={styles.briefingPrefix}>{prefix}</span> : null}
              {prefix ? " " : null}
              {meta.tag}
            </span>
            <span className={styles.briefingText}>{item.headline}</span>
          </button>
        );
      })}
    </section>
  );
}
