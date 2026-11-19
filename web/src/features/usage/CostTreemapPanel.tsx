import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { SegmentedControl } from "../../components/SegmentedControl";
import { formatModelId, formatTokenCount, formatUsd } from "../../lib/format";
import { useContrast } from "../settings/contrast";
import { useFontScale } from "../settings/fontScale";
import type { SessionMeta } from "../sessions/metadataCache";
import { labWindow } from "./constellation";
import { ProvenanceBadge } from "./ProvenanceBadge";
import {
  buildCostTreemap,
  layoutTreemap,
  mergeTinySessions,
  TREEMAP_OTHER_ID,
  type TreemapMode,
  type TreemapSession
} from "./treemap";
import type { UsageSessionInput } from "./usageAggregations";
import styles from "./CostTreemapPanel.module.css";

/**
 * 「成本树图」（Issue #359）：项目 → 会话的两级面积图。
 *
 * 面积口径完全交给 `treemap.ts`（纯逻辑，已单测）；这一层只做三件事：
 * 把矩形排成 SVG、把交互做对、把读屏需要的等价表格补上。
 *
 * 几条不显眼但会坏事的决定：
 * - **会话块用 `--chart-N-soft`，不叠 `fill-opacity` / `opacity` / `color-mix`**：
 *   项目最低系统版本 10.13 对应的 WebKit 不支持 `color-mix`，整条 fill 会作废。
 *   项目色相只借 `--chart-*`，不碰记录类别语义占满的 `--cat-*`。
 * - **不建颜色图例**：第 7 个项目起色相循环，映射不再唯一，图例会撒谎。
 * - **交互层是叠在 SVG 上的透明按钮**，不是给 `<rect>` 挂 tabindex：SVG 子元素
 *   的 Tab 可聚焦性在 WebKit 上不可靠（Tauri 用的就是 WKWebView），按钮让
 *   roving tabindex 与读屏名字在两种引擎上都成立。
 * - **悬停/焦点只叠一个独立描边矩形**，绝不改块的 fill 或重排 DOM——重排会
 *   在指针下换掉节点，触发 mouseleave/enter 抖动。
 * - 浮层 `position: fixed` 并 portal 到 `document.body`：`Panel` 有
 *   `overflow: hidden`，绝对定位会被裁掉。
 */

const CHART_HEIGHT = 340;
/** jsdom 里 `clientWidth` 恒为 0；给一个与桌面列宽相称的兜底。 */
const FALLBACK_WIDTH = 960;
/** 项目之间 6px：两侧各内缩 3。 */
const PROJECT_GAP = 6;
/** 会话之间 2px：每块四周各内缩 1。 */
const SESSION_GAP = 2;
/** 面积低于图幅 0.25% 的会话折成「其余 N 个」。 */
const MERGE_MIN_SHARE = 0.0025;
/** 标签显示阈值（100% 字号）；130% 时线性放大，避免文字互相叠。 */
const LABEL_MIN_WIDTH = 72;
const LABEL_MIN_HEIGHT = 32;
/** `--fs-xs` 的基准值；乘 `--font-scale` 得到实际字号。 */
const BASE_FONT_XS = 11;
const LABEL_PAD_X = 8;
/** 浮层与锚点、视口边缘的距离。 */
const TIP_OFFSET = 8;
const TIP_GAP = 8;

type Rect = { x: number; y: number; w: number; h: number };

type LayoutBlock = {
  key: string;
  session: TreemapSession;
  project: string;
  tone: number;
  rect: Rect;
  merged: boolean;
};

type LayoutProject = {
  key: string;
  project: string;
  tone: number;
  frame: Rect;
  label: string | null;
  labelX: number;
  labelY: number;
};

type Layout = {
  projects: LayoutProject[];
  /** 会话块，含每个项目折出来的「其余 N 个」。 */
  blocks: LayoutBlock[];
  /** 可聚焦的会话块（合并块不参与）。 */
  focusable: LayoutBlock[];
};

type TipState = { block: LayoutBlock; x: number; y: number };

const MODE_ITEMS = [
  { value: "cost" as const, label: "成本" },
  { value: "token" as const, label: "token" }
];

/** CJK / 全角标点按 1.0em，其余按 0.62em——与标签截断的宽度估算保持一致。 */
function charWidth(char: string, fontSize: number): number {
  return /[^\x00-\xff]/.test(char) ? fontSize : fontSize * 0.62;
}

/**
 * 标签截断：可用宽度 = 矩形宽 - 8（左侧内边距）。
 *
 * 返回 `null` 表示「整条不画」——截断后少于 3 个字符时，剩下的信息量还不如
 * 留白；半个省略号只会让人以为标签坏了。
 */
export function fitLabel(text: string, maxWidth: number, fontSize: number): string | null {
  if (!(maxWidth > 0) || !(fontSize > 0)) return null;
  const chars = [...text];
  const fullWidth = chars.reduce((sum, char) => sum + charWidth(char, fontSize), 0);
  if (fullWidth <= maxWidth) return text;

  const ellipsisWidth = charWidth("…", fontSize);
  let used = 0;
  let kept = "";
  for (const char of chars) {
    const width = charWidth(char, fontSize);
    if (used + width + ellipsisWidth > maxWidth) break;
    kept += char;
    used += width;
  }
  if ([...kept].length < 3) return null;
  return `${kept}…`;
}

function insetRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    w: Math.max(0, rect.w - amount * 2),
    h: Math.max(0, rect.h - amount * 2)
  };
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    w: rect.w + amount * 2,
    h: rect.h + amount * 2
  };
}

function blockShare(value: number, total: number): string {
  if (!(total > 0) || !Number.isFinite(value)) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function amountText(session: TreemapSession, mode: TreemapMode): string {
  return mode === "cost"
    ? formatUsd(session.usd ?? session.value)
    : `${formatTokenCount(session.value)} token`;
}

/** `11/03 18:45`——浮层里的绝对时刻，不跟「今天」做相对换算。 */
function formatTipStamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "不足 1 分钟";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "不足 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

type SessionFact = { start: number; end: number; meta?: SessionMeta };

/**
 * 会话的时刻与元数据。`buildCostTreemap` 只给面积口径，浮层里的
 * 「11/03 18:45 · 42 分钟」和点击跳转要的 `SessionMeta` 得从这里补。
 */
function buildSessionFacts(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): Map<string, SessionFact> {
  const { startTs, endTs } = labWindow(days, now);
  const facts = new Map<string, SessionFact>();
  inputs.forEach((source, index) => {
    const id = source.session ? `path:${source.session.path}` : `anonymous:${index}`;
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const record of source.records) {
      if (record.timestamp < startTs || record.timestamp >= endTs) continue;
      if (record.timestamp < start) start = record.timestamp;
      if (record.timestamp > end) end = record.timestamp;
    }
    facts.set(id, {
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : 0,
      meta: source.session
    });
  });
  return facts;
}

function buildLayout(
  projects: readonly { project: string; value: number; sessions: TreemapSession[] }[],
  total: number,
  width: number,
  fontScale: number
): Layout {
  if (!(width > 0) || projects.length === 0) {
    return { projects: [], blocks: [], focusable: [] };
  }

  // 面积排名决定色相；同面积按项目名升序（`buildCostTreemap` 已按这个顺序
  // 返回，这里再显式排一次，避免将来聚合层改排序时颜色静默漂移）。
  const ranked = projects
    .map((project, index) => ({ project, index }))
    .sort(
      (a, b) =>
        b.project.value - a.project.value ||
        (a.project.project < b.project.project
          ? -1
          : a.project.project > b.project.project
            ? 1
            : 0)
    );
  const toneByIndex = new Map<number, number>();
  ranked.forEach((entry, rank) => toneByIndex.set(entry.index, (rank % 6) + 1));

  const rawRects = layoutTreemap(
    projects.map((project, index) => ({ key: String(index), value: project.value })),
    width,
    CHART_HEIGHT
  );
  const rawByKey = new Map(rawRects.map((rect) => [rect.key, rect]));

  const fontSize = BASE_FONT_XS * fontScale;
  const minWidth = LABEL_MIN_WIDTH * fontScale;
  const minHeight = LABEL_MIN_HEIGHT * fontScale;

  const layoutProjects: LayoutProject[] = [];
  const blocks: LayoutBlock[] = [];

  projects.forEach((project, index) => {
    const raw = rawByKey.get(String(index));
    if (!raw) return;
    const tone = toneByIndex.get(index) ?? 1;
    const inner = insetRect(
      { x: raw.x, y: raw.y, w: raw.w, h: raw.h },
      PROJECT_GAP / 2
    );
    if (!(inner.w > 0) || !(inner.h > 0)) return;

    const merged = mergeTinySessions(project.sessions, MERGE_MIN_SHARE, total);
    const sessionRects = layoutTreemap(
      merged.sessions.map((session) => ({ key: session.id, value: session.value })),
      inner.w,
      inner.h
    );
    const sessionByKey = new Map(merged.sessions.map((session) => [session.id, session]));

    for (const rect of sessionRects) {
      const session = sessionByKey.get(rect.key);
      if (!session) continue;
      const blockRect = insetRect(
        { x: inner.x + rect.x, y: inner.y + rect.y, w: rect.w, h: rect.h },
        SESSION_GAP / 2
      );
      if (!(blockRect.w > 0) || !(blockRect.h > 0)) continue;
      blocks.push({
        key: rect.key,
        session,
        project: project.project,
        tone,
        rect: blockRect,
        merged: session.id === TREEMAP_OTHER_ID
      });
    }

    const showLabel = inner.w >= minWidth && inner.h >= minHeight;
    layoutProjects.push({
      key: String(index),
      project: project.project,
      tone,
      // 外扩 1px：边框落在项目缝里，不与会话发丝边并排成双线。
      frame: expandRect(inner, 1),
      label: showLabel ? fitLabel(project.project, inner.w - LABEL_PAD_X, fontSize) : null,
      labelX: inner.x + LABEL_PAD_X,
      labelY: inner.y + fontSize + 4
    });
  });

  return {
    projects: layoutProjects,
    blocks,
    focusable: blocks.filter((block) => !block.merged)
  };
}

/** 等价表格的一行：合并块也列，读屏没有「面积太小跳过」这回事。 */
type TableRow = { key: string; project: string; session: string; amount: string; share: string };

function tableRowsFor(
  blocks: readonly LayoutBlock[],
  mode: TreemapMode,
  total: number
): TableRow[] {
  return blocks.map((block): TableRow => ({
    key: block.key,
    project: block.project,
    session: block.merged ? `${block.session.title}会话` : block.session.title,
    amount: block.merged
      ? `合计 ${amountText(block.session, mode)}`
      : amountText(block.session, mode),
    share: blockShare(block.session.value, total)
  }));
}

type TooltipRows = {
  project: string | null;
  title: string;
  /** 金额（或 token 数）本身走 `--font-mono`；前缀「合计」留在等宽字体之外。 */
  amountPrefix: string;
  amountValue: string;
  share: string;
  meta: string;
  note: string | null;
};

function tooltipFor(
  block: LayoutBlock,
  mode: TreemapMode,
  total: number,
  facts: ReadonlyMap<string, SessionFact>
): TooltipRows {
  const share = blockShare(block.session.value, total);

  if (block.merged) {
    return {
      project: null,
      title: `${block.session.title}会话`,
      amountPrefix: "合计",
      amountValue: amountText(block.session, mode),
      share,
      meta: "",
      note: "面积过小，未单独列出"
    };
  }

  const fact = facts.get(block.session.id);
  const modelLabel = block.session.model ? formatModelId(block.session.model) : "未知模型";
  const stamp = fact && fact.start > 0 ? formatTipStamp(fact.start) : null;
  const span = fact && fact.end > fact.start ? formatSpan(fact.end - fact.start) : null;
  const meta = [modelLabel, stamp, span].filter((part): part is string => Boolean(part)).join(" · ");

  return {
    project: block.project,
    title: block.session.title,
    amountPrefix: "",
    amountValue: amountText(block.session, mode),
    share,
    meta,
    note: null
  };
}

/** 读屏与等价表格用的整句读数（「合计 $1.20 · 占本窗口 1.8%」）。 */
function amountSentence(rows: TooltipRows): string {
  const prefix = rows.amountPrefix ? `${rows.amountPrefix} ` : "";
  return `${prefix}${rows.amountValue} · 占本窗口 ${rows.share}`;
}

function blockAriaLabel(
  block: LayoutBlock,
  mode: TreemapMode,
  total: number,
  facts: ReadonlyMap<string, SessionFact>
): string {
  const rows = tooltipFor(block, mode, total, facts);
  return [block.project, rows.title, amountSentence(rows), rows.meta].filter(Boolean).join("，");
}

function CostTreemapTooltip({
  tip,
  mode,
  total,
  facts
}: {
  tip: TipState;
  mode: TreemapMode;
  total: number;
  facts: ReadonlyMap<string, SessionFact>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });

  // 先量尺寸再定位：不知道浮层多宽就翻不了边，先显示再移动会从左上角闪一下。
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    // jsdom 没有布局，`innerWidth` 仍在；没有视口时按常见桌面宽度兜底。
    const viewportWidth = window.innerWidth > 0 ? window.innerWidth : 1024;
    const viewportHeight = window.innerHeight > 0 ? window.innerHeight : 768;

    let left = tip.x + TIP_OFFSET;
    let top = tip.y + TIP_OFFSET;
    if (left + width > viewportWidth - TIP_GAP) left = tip.x - TIP_OFFSET - width;
    if (top + height > viewportHeight - TIP_GAP) top = tip.y - TIP_OFFSET - height;
    left = Math.min(
      Math.max(TIP_GAP, left),
      Math.max(TIP_GAP, viewportWidth - width - TIP_GAP)
    );
    top = Math.min(
      Math.max(TIP_GAP, top),
      Math.max(TIP_GAP, viewportHeight - height - TIP_GAP)
    );
    setPosition({ left, top, ready: true });
  }, [tip.block.key, tip.x, tip.y]);

  const rows = tooltipFor(tip.block, mode, total, facts);
  return (
    <div
      ref={ref}
      className={styles.tooltip}
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? "visible" : "hidden"
      }}
      // 读屏走块自身的 aria-label；浮层只是视觉增强，重复朗读反而更吵。
      aria-hidden="true"
      data-treemap-tooltip=""
    >
      {rows.project ? <span className={styles.tipProject}>{rows.project}</span> : null}
      <span className={styles.tipTitle}>{rows.title}</span>
      <span className={styles.tipAmount}>
        {rows.amountPrefix ? `${rows.amountPrefix} ` : null}
        <span className={styles.tipValue}>{rows.amountValue}</span>
        {` · 占本窗口 ${rows.share}`}
      </span>
      {rows.meta ? <span className={styles.tipMeta}>{rows.meta}</span> : null}
      {rows.note ? <span className={styles.tipNote}>{rows.note}</span> : null}
    </div>
  );
}

type Props = {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  onOpenSession?: (session: SessionMeta) => void;
};

export function CostTreemapPanel({ inputs, days, now, onOpenSession }: Props) {
  const fontScale = useFontScale();
  const contrast = useContrast();
  const [mode, setMode] = useState<TreemapMode>("cost");
  const [chartWidth, setChartWidth] = useState(FALLBACK_WIDTH);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoverTip, setHoverTip] = useState<TipState | null>(null);
  const [focusTip, setFocusTip] = useState<TipState | null>(null);
  // 用回调 ref 而不是 useRef：空态时 `chartWrap` 根本不存在，等数据到了才挂载，
  // 固定 ref 的 `useEffect([])` 只会看到 null 并永远不再观察。
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const hitRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const cost = useMemo(() => buildCostTreemap(inputs, "cost", days, now), [inputs, days, now]);
  const tokens = useMemo(() => buildCostTreemap(inputs, "token", days, now), [inputs, days, now]);
  const treemap = mode === "cost" ? cost : tokens;
  const facts = useMemo(() => buildSessionFacts(inputs, days, now), [inputs, days, now]);

  const windowStats = useMemo(() => {
    const { startTs, endTs } = labWindow(days, now);
    let sessions = 0;
    let zeroTokens = 0;
    for (const source of inputs) {
      let inWindow = false;
      let tokenCount = 0;
      for (const record of source.records) {
        if (record.timestamp < startTs || record.timestamp >= endTs) continue;
        inWindow = true;
        const usage = record.usage;
        if (!usage) continue;
        tokenCount +=
          (usage.inputTokens ?? 0) +
          (usage.outputTokens ?? 0) +
          (usage.cacheCreationTokens ?? 0) +
          (usage.cacheReadTokens ?? 0);
      }
      if (inWindow) {
        sessions += 1;
        if (tokenCount <= 0) zeroTokens += 1;
      }
    }
    return { sessions, zeroTokens };
  }, [inputs, days, now]);

  const layout = useMemo(
    () => buildLayout(treemap.projects, treemap.total, chartWidth, fontScale),
    [treemap, chartWidth, fontScale]
  );

  // 容器实测宽度：1 用户单位 = 1 CSS px，标签阈值才是像素事实而不是比例。
  // 参考 `ReplayView.tsx` 的既有写法；首帧与 jsdom 用兜底宽度。
  useEffect(() => {
    if (!wrapEl) return;
    const measure = () => {
      const width = wrapEl.clientWidth;
      if (width > 0) setChartWidth(width);
    };
    measure();
    // 最低系统版本 10.13 的 WKWebView 还没有 ResizeObserver；没有它时退回
    // 「挂载时量一次」——图仍然能画，只是不再跟随窗口宽度实时重排。
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrapEl);
    return () => observer.disconnect();
  }, [wrapEl]);

  // 浮层在滚动或 Escape 时关闭；pointerleave 由交互层负责。
  const anyTip = hoverTip ?? focusTip;
  useEffect(() => {
    if (!anyTip) return;
    const close = () => {
      setHoverTip(null);
      setFocusTip(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anyTip]);

  const total = treemap.total;
  const focusable = layout.focusable;
  const active = focusable.length > 0 ? Math.min(activeIndex, focusable.length - 1) : 0;

  let emptyMessage: string | null = null;
  if (windowStats.sessions === 0) {
    emptyMessage = "所选范围内没有会话";
  } else if (mode === "cost" && !(cost.total > 0)) {
    emptyMessage = "所选范围的会话都没有收录定价，无法按成本排布";
  } else if (mode === "token" && !(tokens.total > 0)) {
    emptyMessage = "所选范围的会话没有 token 读数，无法按 token 排布";
  }

  const footnote =
    mode === "cost"
      ? `面积是已定价会话的估算成本；${
          cost.excludedUnpriced > 0
            ? `${cost.excludedUnpriced} 个会话使用未收录定价的模型，未计入。`
            : "本窗口没有未定价模型。"
        }色相区分项目，同一项目内的会话同色。点击方块打开会话。`
      : `面积是输入、输出、缓存写入与缓存读取四类 token 之和；定价未知的会话照常计入。色相区分项目，同一项目内的会话同色。点击方块打开会话。${
          windowStats.zeroTokens > 0
            ? ` ${windowStats.zeroTokens} 个会话没有 token 读数，未计入。`
            : ""
        }`;

  const summary =
    mode === "cost"
      ? `成本树图：${layout.blocks.length} 个会话，面积表示已定价会话的估算成本，共 ${formatUsd(total)}`
      : `成本树图：${layout.blocks.length} 个会话，面积表示输入、输出、缓存写入与缓存读取四类 token 之和，共 ${formatTokenCount(total)} token`;

  const hoveredKey = hoverTip?.block.key ?? null;
  const ringBlock = hoverTip?.block ?? focusTip?.block ?? null;

  function closeTips() {
    setHoverTip(null);
    setFocusTip(null);
  }

  function changeMode(next: TreemapMode) {
    if (next === mode) return;
    setMode(next);
    closeTips();
    setActiveIndex(0);
  }

  function onLayerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (focusable.length === 0) return;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = Math.min(focusable.length - 1, active + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = Math.max(0, active - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = focusable.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next === active) return;
    setActiveIndex(next);
    hitRefs.current[next]?.focus();
  }

  const rows = tableRowsFor(layout.blocks, mode, total);

  return (
    <div data-probe="lab-treemap">
      <Panel
        title="成本树图"
        ariaLabel="成本树图"
        titleAs="h3"
        actions={
          <span className={styles.actions}>
            {mode === "cost" ? <ProvenanceBadge provenance="estimated" /> : null}
            <SegmentedControl
              items={MODE_ITEMS}
              value={mode}
              onChange={changeMode}
              ariaLabel="树图面积口径"
              role="radiogroup"
            />
          </span>
        }
      >
        {emptyMessage ? (
          <EmptyState size="inline" title={emptyMessage} />
        ) : (
          <>
            <div className={styles.chartWrap} ref={setWrapEl}>
              <svg
                className={styles.chart}
                viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
                role="group"
                aria-label={summary}
                data-probe="cost-treemap-chart"
              >
                {layout.blocks.map((block) => (
                  <rect
                    key={`fill-${block.key}`}
                    x={block.rect.x}
                    y={block.rect.y}
                    width={block.rect.w}
                    height={block.rect.h}
                    fill={`var(--chart-${block.tone}-soft)`}
                    data-treemap-block={block.key}
                    data-treemap-merged={block.merged ? "" : undefined}
                  />
                ))}
                {layout.blocks.map((block) => (
                  <rect
                    key={`edge-${block.key}`}
                    x={block.rect.x + 0.5}
                    y={block.rect.y + 0.5}
                    width={Math.max(0, block.rect.w - 1)}
                    height={Math.max(0, block.rect.h - 1)}
                    fill="none"
                    stroke={contrast === "high" ? "var(--border)" : "var(--treemap-edge)"}
                    strokeWidth={1}
                    className={styles.cellEdge}
                  />
                ))}
                {layout.projects.map((project) => (
                  <rect
                    key={`frame-${project.key}`}
                    x={project.frame.x}
                    y={project.frame.y}
                    width={project.frame.w}
                    height={project.frame.h}
                    fill="none"
                    stroke={`var(--chart-${project.tone})`}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    className={styles.projectFrame}
                  />
                ))}
                {layout.projects.map((project) =>
                  project.label ? (
                    <text
                      key={`label-${project.key}`}
                      x={project.labelX}
                      y={project.labelY}
                      className={styles.projectLabel}
                      data-treemap-project-label={project.project}
                    >
                      {project.label}
                    </text>
                  ) : null
                )}
                {layout.blocks
                  .filter((block) => block.merged)
                  .map((block) => {
                    const fontSize = BASE_FONT_XS * fontScale;
                    const label =
                      block.rect.w >= LABEL_MIN_WIDTH * fontScale &&
                      block.rect.h >= LABEL_MIN_HEIGHT * fontScale
                        ? fitLabel(
                            `${block.session.title}会话`,
                            block.rect.w - LABEL_PAD_X,
                            fontSize
                          )
                        : null;
                    return label ? (
                      <text
                        key={`other-${block.key}`}
                        x={block.rect.x + LABEL_PAD_X}
                        y={block.rect.y + fontSize + 4}
                        className={styles.otherLabel}
                        data-treemap-other-label={block.session.title}
                      >
                        {label}
                      </text>
                    ) : null;
                  })}
                {ringBlock ? (
                  <rect
                    x={ringBlock.rect.x}
                    y={ringBlock.rect.y}
                    width={ringBlock.rect.w}
                    height={ringBlock.rect.h}
                    fill="none"
                    className={
                      hoveredKey === ringBlock.key ? styles.hoverRing : styles.focusRing
                    }
                    data-treemap-ring={hoveredKey === ringBlock.key ? "hover" : "focus"}
                  />
                ) : null}
              </svg>

              <div
                className={styles.hits}
                onKeyDown={onLayerKeyDown}
                // 指针停到缝里或「其余 N 个」块上（它们没有按钮）时关闭浮层；
                // 块与块之间移动时 target 是按钮，不经过这里，也就不会闪。
                onPointerMove={(event) => {
                  if (event.target === event.currentTarget) setHoverTip(null);
                }}
                onPointerLeave={() => setHoverTip(null)}
              >
                {focusable.map((block, index) => {
                  const meta = facts.get(block.session.id)?.meta;
                  return (
                    <button
                      key={block.key}
                      ref={(node) => {
                        hitRefs.current[index] = node;
                      }}
                      type="button"
                      className={styles.hit}
                      style={{
                        left: `${(block.rect.x / chartWidth) * 100}%`,
                        top: `${(block.rect.y / CHART_HEIGHT) * 100}%`,
                        width: `${(block.rect.w / chartWidth) * 100}%`,
                        height: `${(block.rect.h / CHART_HEIGHT) * 100}%`
                      }}
                      tabIndex={index === active ? 0 : -1}
                      aria-label={blockAriaLabel(block, mode, total, facts)}
                      data-treemap-hit={block.key}
                      onClick={() => {
                        if (meta && onOpenSession) onOpenSession(meta);
                      }}
                      onPointerEnter={(event) =>
                        setHoverTip({ block, x: event.clientX, y: event.clientY })
                      }
                      onFocus={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setActiveIndex(index);
                        setFocusTip({
                          block,
                          x: rect.right,
                          y: rect.top + rect.height / 2
                        });
                      }}
                      onBlur={() => setFocusTip(null)}
                    />
                  );
                })}
              </div>
            </div>

            <p className={styles.footnote}>{footnote}</p>

            {/* 树图对读屏不可用：视觉隐藏的等价表格才是它的可读层。 */}
            <div className={styles.srOnly}>
              <table data-treemap-table="">
                <caption>
                  {`成本树图等价表格（${mode === "cost" ? "估算成本" : "token"}口径）`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">项目</th>
                    <th scope="col">会话</th>
                    <th scope="col">{mode === "cost" ? "估算成本" : "token"}</th>
                    <th scope="col">占本窗口</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.project}</td>
                      <td>{row.session}</td>
                      <td>{row.amount}</td>
                      <td>{row.share}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      {anyTip && typeof document !== "undefined"
        ? createPortal(
            <CostTreemapTooltip tip={anyTip} mode={mode} total={total} facts={facts} />,
            document.body
          )
        : null}
    </div>
  );
}
