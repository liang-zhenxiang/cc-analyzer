import { useId } from "react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Sparkline } from "./Sparkline";
import type { Chronicle } from "./chronicle";
import styles from "./ChroniclePanel.module.css";

/** 章节与图表的局部类型：只依赖 `Chronicle`，不额外耦合模型层的具名导出。 */
type ChronicleChapter = Chronicle["chapters"][number];
type ChronicleChart = NonNullable<ChronicleChapter["chart"]>;

/** 柱数超过这个量时按步长稀释横轴标签，避免 30 根柱把字压成一团。 */
const MAX_BAR_LABELS = 8;

/**
 * 数据故事（Chronicle）：杂志式纵向叙事。
 *
 * 这里只排版，不补算任何一个数字——章节的 kicker / 标题 / 大数字 / 正文 /
 * 脚注全部由 `chronicle` 模型给出。视觉上有三条硬约束：
 *
 * 1. **不画卡片**：章节之间靠 64px 留白（`--sp-6` 上下各一档）与一条发丝线
 *    分隔。卡片语言已经被年报、项目卡片占用，故事再套一层框会读成「又一张报表」。
 * 2. **大数字是主角**：48–56px、等宽数字。界面字号令牌最高只有 `--fs-lg`
 *    （20px），这一处是刻意的显示级例外；`clamp()` 让它跟随 `--font-scale`
 *    长到 56px 封顶，130% 下不会把标题挤出容器。
 * 3. **图只画形**：sparkline / 柱图都 `aria-hidden`，读数写在正文与脚注里，
 *    屏幕阅读器不会听到一串没有标签的坐标。
 *
 * 章节按 `index` 升序渲染：模型层给的是章节序号，而不是数组下标——
 * 即使数据源顺序抖动，故事的时间线也不该跟着抖。
 */
export function ChroniclePanel({
  chronicle,
  onExport,
  exporting = false
}: {
  chronicle: Chronicle;
  onExport?: () => void;
  exporting?: boolean;
}) {
  const empty = chronicle.empty || chronicle.chapters.length === 0;

  if (empty) {
    return (
      <section className={styles.chronicle} aria-label="数据故事" data-probe="chronicle">
        <EmptyState
          size="page"
          title="这个窗口还没有足够的故事"
          description="换一个更长的时间范围，或者先到「会话」档扫描一次日志目录。"
        />
      </section>
    );
  }

  const chapters = [...chronicle.chapters].sort((a, b) => a.index - b.index);
  const hasSummary = chronicle.summary.trim().length > 0;

  return (
    <section className={styles.chronicle} aria-label="数据故事" data-probe="chronicle">
      <div className={styles.chapters}>
        {chapters.map((chapter) => (
          <Chapter key={chapter.id} chapter={chapter} />
        ))}
      </div>
      <footer className={styles.ending}>
        {hasSummary ? <p className={styles.summary}>{chronicle.summary}</p> : null}
        {/* 导出的是整篇故事，所以按钮放在 summary 之后而不是每章一个。
            它是结尾版式的固定一块：onExport 还没接上时留在原位但禁用，
            而不是让结尾随接线状态忽有忽无。 */}
        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            data-probe="chronicle-export"
            onClick={onExport}
            disabled={exporting || !onExport}
            aria-busy={exporting || undefined}
            title={onExport ? undefined : "导出功能尚未接入"}
          >
            {exporting ? "正在导出…" : "导出这篇故事（Markdown）"}
          </Button>
        </div>
      </footer>
    </section>
  );
}

function Chapter({ chapter }: { chapter: ChronicleChapter }) {
  // useId 而不是 `${index}`：同一页渲染两份故事时 id 也不会撞。
  const uid = useId();
  const titleId = `${uid}-chapter`;
  return (
    <article
      className={styles.chapter}
      aria-labelledby={titleId}
      data-chapter-index={chapter.index}
      data-chapter-id={chapter.id}
    >
      <p className={styles.kicker}>{chapter.kicker}</p>
      <h3 id={titleId} className={styles.title}>
        {chapter.title}
      </h3>
      <p className={styles.stat}>
        <span className={styles.statValue}>{chapter.stat}</span>{" "}
        <span className={styles.statUnit}>{chapter.statUnit}</span>
      </p>
      <p className={styles.body}>{chapter.body}</p>
      {chapter.chart ? <ChapterChart chart={chapter.chart} /> : null}
      {chapter.footnote ? <p className={styles.footnote}>{chapter.footnote}</p> : null}
    </article>
  );
}

/** 图只在有形状可画时出现：一个点画不出趋势，一根柱也读不出分布。 */
function ChapterChart({ chart }: { chart: ChronicleChart }) {
  if (chart.kind === "sparkline") {
    // 共享 Sparkline 自带「少于两点不画」的规则：单点不是趋势。
    if (chart.values.length < 2) return null;
    return (
      <div className={styles.chart} data-probe="chronicle-chart">
        {/* 坐标盒按 100×48 画，尺寸由 CSS 铺满故事版心；probe 必须换名字，
            否则 e2e 会把 KPI 卡的走势图一起数进来。 */}
        <Sparkline values={chart.values} width={100} height={48} probe="chronicle-sparkline" />
      </div>
    );
  }
  return <BarsChart values={chart.values} labels={chart.labels} />;
}

/**
 * 柱图：等高轨道里按比例长高，最高 40px；柱身用 `--chart-1-soft` 面积 +
 * `--chart-1` 顶部 1px 线（与全站「大面积只许 soft、实色只给轮廓」一致）。
 * 0 值仍留一条 1px 顶线——那根线就是「这一天在，但读数为零」。
 */
function BarsChart({ values, labels }: { values: number[]; labels: string[] }) {
  if (values.length === 0) return null;

  const max = Math.max(...values, 0);
  const labelStride = Math.ceil(values.length / MAX_BAR_LABELS);

  return (
    <div className={styles.chart} data-probe="chronicle-chart">
      <div className={styles.bars} aria-hidden="true" data-probe="chronicle-bars">
        {values.map((value, index) => {
          const ratio = max > 0 ? value / max : 0;
          return (
            <span className={styles.barColumn} key={index}>
              <span className={styles.barTrack}>
                <span
                  className={styles.bar}
                  style={{ height: `${Math.max(ratio * 100, value > 0 ? 3 : 0)}%` }}
                  data-probe="chronicle-bar"
                />
              </span>
              <span className={styles.barLabel} data-probe="chronicle-bar-label">
                {index % labelStride === 0 ? (labels[index] ?? "") : ""}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
