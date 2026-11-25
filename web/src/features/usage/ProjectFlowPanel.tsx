import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatShareText, formatTokenCount } from "../../lib/format";
import { useContrast } from "../settings/contrast";
import { useFontScale } from "../settings/fontScale";
import { formatAxisValue } from "./charts/chartPrimitives";
import { fitLabel } from "./charts/labels";
import { formatDayLabel, type UsageSessionInput } from "./usageAggregations";
import {
  buildFlowXTicks,
  buildLanePaths,
  buildProjectFlow,
  flowChartHeight,
  flowDayAtX,
  flowLaneBaseline,
  flowLaneTop,
  flowNameBaseline,
  flowPeakLane,
  flowPlotWidth,
  flowSelectBarY,
  flowSlot,
  flowSwatchY,
  flowX,
  flowXLabelBaselineY,
  flowY,
  flowYMaxLabelY,
  flowYZeroLabelY,
  FLOW_LANE_GAP,
  FLOW_LANE_HEIGHT,
  FLOW_LANE_PITCH,
  FLOW_FALLBACK_WIDTH,
  FLOW_NAME_RIGHT,
  FLOW_NAME_X,
  FLOW_PLOT_LEFT,
  FLOW_PLOT_TOP,
  FLOW_SELECT_BAR_X,
  FLOW_SWATCH_X,
  FLOW_Y_AXIS_WIDTH,
  type FlowLane,
  type ProjectFlow
} from "./projectFlow";
import styles from "./ProjectFlowPanel.module.css";

/**
 * 「项目流量河流图」（Issue #388）：最多七条互不堆叠的河道共用一条时间轴与
 * 同一个 y 刻度，回答「用量在项目之间怎么流动」。
 *
 * 纯函数层在 `projectFlow.ts`（分桶、排名、尾部、统一刻度、单调三次曲线、
 * 刻度抽稀，已单测）；这一层只做呈现与交互。
 *
 * 几条不显眼但会坏事的决定：
 * - **大面积填充只用 `-soft`**，顶边用实色描边承担边界。组件里不存在
 *   `opacity` / `fill-opacity` / `color-mix`：最低系统 10.13 的 WKWebView 不认
 *   `color-mix`，叠 alpha 又会让高对比度主题的不透明 `-soft` 退回半透明。
 * - **颜色身份只由窗口总量排名决定**，一次算好，河道 / 色块 / tooltip / 读数 /
 *   等价表共用同一个 `tone`；选中与悬停绝不重排。
 * - **整个图只有一个 Tab 停点**（外层 `role="group"`）。SVG 子元素在 WKWebView
 *   里的可聚焦性不可靠，河道与点都不进 Tab 序。
 * - **几何 1 单位 = 1 CSS px**：宽度实测、高度固定，河道高度不随窗口或字号
 *   缩放；只有文字跟 `--font-scale` 走。
 * - 浮层 portal 到 `document.body` 且 `position: fixed`：`Panel` 的
 *   `overflow: hidden` 会把绝对定位裁掉。
 */

/** `--fs-xs` 的基准值（tokens.css 的 11px）；乘 `--font-scale` 得实际字号。 */
const BASE_FONT_XS = 11;

/**
 * 顶边与悬停点的几何常量。规格 §1.3 把它们列为「形」，但纯函数层没有导出
 * （它只负责数据与坐标），所以在这一层按规格落地，不散落魔数。
 */
const FLOW_STROKE = 1.5;
const FLOW_STROKE_HIGH = 2;
const FLOW_DOT_R = 2.5;
const FLOW_DOT_R_HIGH = 3;
/** 选中竖条高度（规格 §1.3 的 20px）。 */
const SELECT_BAR_HEIGHT = 20;
/** 选中竖条宽度（规格 §1.3）。 */
const SELECT_BAR_WIDTH = 2;

/** tooltip 与锚点、视口边缘的距离（规格 §4.6）。 */
const TIP_OFFSET = 12;
const TIP_GAP = 8;

type Anchor = { x: number; y: number };

type EmptyCopy = { title: string; description?: string };

function shareOf(value: number, total: number): string {
  return formatShareText({
    tokens: value,
    share: total > 0 ? value / total : 0
  });
}

/** 空态四态与优先级（规格 §5）。 */
function emptyCopyOf(flow: ProjectFlow, days: number): EmptyCopy {
  switch (flow.emptyReason) {
    case "no-sessions":
      return { title: "所选范围内没有会话" };
    case "no-tokens":
      return {
        title: "所选范围内有会话，但没有 token 用量",
        description:
          "要么日志缺少 usage 计数，要么计数全为 0；两种情况下都画不出河道。"
      };
    case "single-day":
      return {
        title: `近 ${days} 天里只有 1 天有 token 读数，画不出走向`,
        description: "河流图需要至少 2 个有读数的日子；单独一天没有走向可读。"
      };
    case "single-project": {
      const lane = flow.lanes[0];
      const name = lane?.name ?? "这个项目";
      const total = formatTokenCount(lane?.total ?? 0);
      const peakDay = lane ? formatDayLabel(flow.days[lane.peakDay]) : "—";
      const peakValue = formatTokenCount(lane?.peakValue ?? 0);
      return {
        title: `近 ${days} 天只有 1 个项目有记录`,
        description: `${name} · 合计 ${total} token · 峰值 ${peakDay}（${peakValue} token）。没有第二个项目，画不出「之间」的流动。`
      };
    }
    default:
      return { title: "所选范围内没有可画的数据" };
  }
}

function FlowTooltip({
  anchor,
  dayIndex,
  days,
  dayTotal,
  lanes,
  selectedKey
}: {
  anchor: Anchor;
  dayIndex: number;
  days: readonly number[];
  dayTotal: number;
  lanes: readonly FlowLane[];
  selectedKey: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });

  // 先量尺寸再定位：不知道浮层多宽就翻不了边，先显示再移动会从左上角闪一下。
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const viewportWidth = window.innerWidth > 0 ? window.innerWidth : 1024;
    const viewportHeight = window.innerHeight > 0 ? window.innerHeight : 768;

    let left = anchor.x + TIP_OFFSET;
    let top = anchor.y + TIP_OFFSET;
    if (left + width > viewportWidth - TIP_GAP) left = anchor.x - TIP_OFFSET - width;
    if (top + height > viewportHeight - TIP_GAP) top = anchor.y - TIP_OFFSET - height;
    left = Math.min(
      Math.max(TIP_GAP, left),
      Math.max(TIP_GAP, viewportWidth - width - TIP_GAP)
    );
    top = Math.min(
      Math.max(TIP_GAP, top),
      Math.max(TIP_GAP, viewportHeight - height - TIP_GAP)
    );
    setPosition({ left, top, ready: true });
  }, [anchor.x, anchor.y, dayIndex, lanes, selectedKey]);

  const isToday = dayIndex === days.length - 1;
  const dayLabel = days[dayIndex] !== undefined ? formatDayLabel(days[dayIndex]) : "";
  const title = isToday ? `${dayLabel}（今天，尚未过完）` : dayLabel;

  return (
    <div
      ref={ref}
      className={styles.tooltip}
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? "visible" : "hidden"
      }}
      // 读屏走 live region 与等价表；浮层只是视觉增强，重复朗读反而更吵。
      aria-hidden="true"
      data-ribbon-tooltip=""
    >
      {dayTotal > 0 ? (
        <>
          <span className={styles.tipHeader}>
            {title} · 当天{" "}
            <span className={styles.tipValue}>{formatTokenCount(dayTotal)}</span> token
          </span>
          {lanes.map((lane) => {
            const value = lane.values[dayIndex] ?? 0;
            return (
              <span
                key={lane.key}
                className={`${styles.tipRow}${
                  lane.key === selectedKey ? ` ${styles.tipRowSelected}` : ""
                }`}
                data-ribbon-tooltip-row={lane.key}
              >
                <span
                  className={`${styles.tipSwatch}${
                    lane.tone === null ? ` ${styles.tipSwatchNeutral}` : ""
                  }`}
                  style={
                    lane.tone !== null
                      ? { background: `var(--chart-${lane.tone})` }
                      : undefined
                  }
                  aria-hidden="true"
                />
                <span className={styles.tipName}>{lane.name}</span>
                <span className={styles.tipAmount}>
                  <span className={styles.tipValue}>{formatTokenCount(value)}</span> token
                </span>
                <span className={styles.tipShare}>{shareOf(value, dayTotal)}</span>
              </span>
            );
          })}
        </>
      ) : (
        <span className={styles.tipEmpty}>这一天没有用量记录</span>
      )}
    </div>
  );
}

type Props = {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
};

export function ProjectFlowPanel({ inputs, days, now }: Props) {
  const fontScale = useFontScale();
  const contrast = useContrast();
  const baseId = useId();
  const keyHelpId = `${baseId}-keys`;
  const footnoteId = `${baseId}-footnote`;

  const flow = useMemo(() => buildProjectFlow(inputs, days, now), [inputs, days, now]);
  const lanes = flow.lanes;

  const [containerWidth, setContainerWidth] = useState(FLOW_FALLBACK_WIDTH);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [cursorDay, setCursorDay] = useState<number | null>(null);
  const [activeLane, setActiveLane] = useState(0);
  const [focused, setFocused] = useState(false);
  const [pointer, setPointer] = useState<Anchor | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [liveOverride, setLiveOverride] = useState<string | null>(null);
  /** Esc 关闭浮层但保留日期游标（规格 §4.6）；下一次移动 / 方向键重新打开。 */
  const [tipSuppressed, setTipSuppressed] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /**
   * 聚焦滚动守卫。浏览器在 Tab 聚焦时会把刚获焦的元素滚入视口，脚本无法把
   * 这次滚动与用户滚动区分开；若照常关闭，`handleFocus` 刚立起来的游标会被
   * 立刻清掉，键盘用户只看得到焦点环（规格 §4.3 要求游标默认落在今天）。
   *
   * 实测（Chromium / WebKit，并行负载下）两者时序并不一致：
   * - Chromium 在派发 focus 之前就应用了滚入视口（focus 时 scrollTop 已是滚动后的
   *   值），scroll 事件随后到达，与下一帧 rAF 几乎同时；
   * - WebKit 在 focus 之后才应用滚动，scroll 事件最晚可晚一帧（实测 >100ms），
   *   会晚于下一帧的 rAF 回调。
   *
   * 所以守卫不设时间兜底（一帧后自动解除会被 WebKit 的迟到事件绕过），只由事件
   * 解除：守卫生效期间收到第一条 scroll 就吞掉它并**立即解除**；滚轮 / 触摸 /
   * PageUp·PageDown 这些「用户要自己滚动」的输入会在各自的 scroll 事件之前解除
   * 守卫。这样聚焦滚入视口无论多晚到达都被吞掉，而有输入信号的用户滚动不会被吞。
   *
   * 剩余盲区：没有前置输入信号的滚动（拖动滚动条、程序化滚动）若恰好是聚焦后的
   * 第一条 scroll，会被吞一次；这是「不依赖帧时序」的代价，第二次起照常关闭。
   */
  const focusScrollGuardRef = useRef(false);

  // 容器实测宽度：1 用户单位 = 1 CSS px，河道高度与字号在宽窗口不会放大。
  // 首帧与 jsdom 用兜底宽度；没有 ResizeObserver 时退回「挂载量一次」。
  useEffect(() => {
    if (!wrapEl) return;
    const measure = () => {
      const width = wrapEl.clientWidth;
      if (width > 0) setContainerWidth(width);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrapEl);
    return () => observer.disconnect();
  }, [wrapEl]);

  // 窗口 / 数据变化后清掉不存在的选中，并把游标与当前河夹回新范围。
  useEffect(() => {
    setSelectedKey((prev) =>
      prev && lanes.some((lane) => lane.key === prev && !lane.isOther) ? prev : null
    );
    setActiveLane((prev) => Math.min(prev, Math.max(0, lanes.length - 1)));
    setCursorDay((prev) =>
      prev === null ? null : Math.min(prev, Math.max(0, flow.days.length - 1))
    );
  }, [lanes, flow.days.length]);

  // 选中时窗口级 Escape 也能取消（不需要图先获得焦点，规格 §4.2）。
  useEffect(() => {
    if (!selectedKey) return;
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedKey(null);
      setLiveOverride("已取消锁定。");
      setTipSuppressed(true);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [selectedKey]);

  // 滚动或窗口宽度变化时关闭游标与浮层（capture：Panel 外的滚动容器也能收到）。
  useEffect(() => {
    if (cursorDay === null) return;
    const close = () => {
      // 聚焦把元素滚入视口引来的一次滚动不是用户滚动：吞掉这一次并立即解除，
      // 不依赖 scroll 与其它事件的先后——见守卫注释。
      if (focusScrollGuardRef.current) {
        focusScrollGuardRef.current = false;
        return;
      }
      setCursorDay(null);
      setPointer(null);
      setHoveredRow(null);
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [cursorDay]);

  // 用户一旦做出「要自己滚动」的输入，就先解除聚焦守卫——这些事件都早于各自
  // 的 scroll 事件，随后到达的 scroll 按既有语义关闭游标与浮层。
  useEffect(() => {
    const release = () => {
      focusScrollGuardRef.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "PageDown" || event.key === "PageUp") release();
    };
    window.addEventListener("wheel", release, { capture: true, passive: true });
    window.addEventListener("touchmove", release, { capture: true, passive: true });
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("wheel", release, { capture: true });
      window.removeEventListener("touchmove", release, { capture: true });
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const geometry = useMemo(() => {
    if (flow.emptyReason || lanes.length === 0) return null;
    const plotWidth = flowPlotWidth(containerWidth);
    const slot = flowSlot(plotWidth, flow.days.length);
    const chartHeight = flowChartHeight(lanes.length);
    const laneGeometry = lanes.map((lane, index) => {
      const laneTop = flowLaneTop(index);
      const baseline = flowLaneBaseline(index);
      return {
        lane,
        index,
        laneTop,
        baseline,
        paths: buildLanePaths(lane.values, {
          laneTop,
          baseline,
          max: flow.max,
          slot
        })
      };
    });
    return {
      plotWidth,
      slot,
      chartHeight,
      lastBaseline: flowLaneBaseline(lanes.length - 1),
      lanes: laneGeometry,
      ticks: buildFlowXTicks(flow.days, plotWidth, fontScale)
    };
  }, [flow, lanes, containerWidth, fontScale]);

  const selectedLane = useMemo(
    () => (selectedKey ? lanes.find((lane) => lane.key === selectedKey) ?? null : null),
    [lanes, selectedKey]
  );
  const activeIndex = lanes.length > 0 ? Math.min(activeLane, lanes.length - 1) : 0;

  const chartHeight = geometry?.chartHeight ?? 0;
  const chartWidth = containerWidth;
  const lastBaseline = geometry?.lastBaseline ?? 0;

  const peak = useMemo(() => flowPeakLane(lanes), [lanes]);
  const peakLabel = peak ? (peak.isOther ? `「${peak.name}」合计` : peak.name) : "—";
  const peakDayLabel = peak ? formatDayLabel(flow.days[peak.peakDay]) : "—";
  const peakValueText = peak ? formatTokenCount(peak.peakValue) : "0";

  const summaryAria = `项目流量：近 ${days} 天里 ${flow.projectCount} 个项目有用量，共 ${formatTokenCount(
    flow.windowTokens
  )} token；峰值最高的是 ${peakLabel}，${peakDayLabel} 单日 ${peakValueText} token。所有河共用同一刻度，满格 ${formatTokenCount(
    flow.max
  )} token/日。`;

  const footnote =
    `每条河是一个项目的当日 token（输入、输出、缓存写入、缓存读取四类之和，与页面 KPI 同口径）。所有河共用同一刻度：满格 ${formatTokenCount(
      flow.max
    )} token/日，所以高度可直接比较。最后一天是今天，尚未过完。悬停看某天，点一条河锁定项目，Esc 取消。` +
    (flow.projectCount > 7
      ? `第 7 条「其他 ${flow.projectCount - 6} 个」是总量第 7 名及以后项目的当日合计。`
      : flow.projectCount === 7
        ? "色板只有六档，第 7 名用中性色；它仍是单个项目，不是合计。"
        : "");

  const emptyCopy = flow.emptyReason ? emptyCopyOf(flow, days) : null;

  function toggleLane(index: number) {
    const lane = lanes[index];
    if (!lane || lane.isOther) return;
    if (lane.key === selectedKey) {
      setSelectedKey(null);
      setLiveOverride("已取消锁定。");
      return;
    }
    setSelectedKey(lane.key);
    setLiveOverride(
      `已锁定 ${lane.name}。窗口合计 ${formatTokenCount(lane.total)} token，占本窗口 ${shareOf(
        lane.total,
        flow.windowTokens
      )}，峰值 ${formatDayLabel(flow.days[lane.peakDay])}。`
    );
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!geometry) return;
    setTipSuppressed(false);
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = rect.width > 0 ? chartWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? chartHeight / rect.height : 1;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    if (x < FLOW_PLOT_LEFT) {
      // 指针在左栏：只提亮该行项目名，不画竖线 / tooltip。
      if (y < FLOW_PLOT_TOP || y > lastBaseline) {
        setHoveredRow(null);
        setCursorDay(null);
        setPointer(null);
        return;
      }
      const row = Math.min(
        lanes.length - 1,
        Math.floor((y - FLOW_PLOT_TOP) / FLOW_LANE_PITCH)
      );
      setHoveredRow(row);
      setCursorDay(null);
      setPointer(null);
      setLiveOverride(null);
      return;
    }

    setHoveredRow(null);
    setCursorDay(flowDayAtX(x, geometry.slot, flow.days.length));
    setPointer({ x: event.clientX, y: event.clientY });
    setLiveOverride(null);
  }

  function handlePointerLeave() {
    // 指针离开：竖线、点、tooltip、行提亮全部清掉；键盘焦点环保留。
    setCursorDay(null);
    setPointer(null);
    setHoveredRow(null);
    setTipSuppressed(false);
  }

  /**
   * 在聚焦事件里同步布防（不能放进 effect：effect 可能晚于浏览器排入的滚动事件）。
   * 由第一条 scroll 或用户滚动输入解除，理由与实测时间线见 `focusScrollGuardRef`。
   */
  function armFocusScrollGuard() {
    focusScrollGuardRef.current = true;
  }

  function handleFocus() {
    setFocused(true);
    setTipSuppressed(false);
    // 焦点进入时游标落在今天（窗口最后一天）。
    setCursorDay((prev) => prev ?? flow.days.length - 1);
    // 浏览器紧随其后会把元素滚入视口并派发 scroll；不布防的话游标会被立刻清掉。
    armFocusScrollGuard();
    const selectedIndex = selectedLane
      ? lanes.findIndex((lane) => lane.key === selectedLane.key)
      : -1;
    setActiveLane(
      selectedIndex >= 0
        ? selectedIndex
        : Math.min(activeLane, Math.max(0, lanes.length - 1))
    );
  }

  function handleBlur() {
    setFocused(false);
    setPointer(null);
    setCursorDay(null);
    setHoveredRow(null);
    // 焦点离开后不再有「聚焦引起的滚动」需要吞。
    focusScrollGuardRef.current = false;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!geometry) return;
    const last = flow.days.length - 1;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        setLiveOverride(null);
        setPointer(null);
        setTipSuppressed(false);
        setCursorDay((prev) => Math.max(0, (prev ?? last) - 1));
        return;
      case "ArrowRight":
        event.preventDefault();
        setLiveOverride(null);
        setPointer(null);
        setTipSuppressed(false);
        setCursorDay((prev) => Math.min(last, (prev ?? last) + 1));
        return;
      case "Home":
        event.preventDefault();
        setLiveOverride(null);
        setPointer(null);
        setTipSuppressed(false);
        setCursorDay(0);
        return;
      case "End":
        event.preventDefault();
        setLiveOverride(null);
        setPointer(null);
        setTipSuppressed(false);
        setCursorDay(last);
        return;
      case "ArrowUp":
        event.preventDefault();
        setLiveOverride(null);
        setPointer(null);
        setTipSuppressed(false);
        setCursorDay((prev) => prev ?? last);
        setActiveLane((prev) => Math.max(0, prev - 1));
        return;
      case "ArrowDown":
        event.preventDefault();
        setLiveOverride(null);
        setPointer(null);
        setTipSuppressed(false);
        setCursorDay((prev) => prev ?? last);
        setActiveLane((prev) => Math.min(lanes.length - 1, prev + 1));
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        toggleLane(activeIndex);
        return;
      case "Escape":
        event.preventDefault();
        setTipSuppressed(true);
        if (selectedKey) {
          setSelectedKey(null);
          setLiveOverride("已取消锁定。");
        } else {
          setCursorDay(null);
          setLiveOverride(null);
        }
        return;
      default:
        return;
    }
  }

  if (emptyCopy) {
    return (
      <div data-probe="lab-ribbon">
        <Panel title="项目流量" ariaLabel="项目流量" titleAs="h3">
          <div data-ribbon-empty={flow.emptyReason ?? undefined}>
            <EmptyState size="inline" title={emptyCopy.title} />
            {emptyCopy.description ? (
              <p className={styles.emptyDescription}>{emptyCopy.description}</p>
            ) : null}
          </div>
        </Panel>
      </div>
    );
  }

  if (!geometry) return null;

  // 窗口刚切换时状态里的下标可能还停在旧范围；渲染前先夹住，避免一帧 NaN 日期。
  const cursorIndex = cursorDay === null ? null : Math.min(cursorDay, flow.days.length - 1);
  const cursorVisible = cursorIndex !== null && lanes.length > 0;
  const cursorX = cursorIndex !== null ? flowX(cursorIndex, geometry.slot) : 0;
  const todayX = flowX(flow.days.length - 1, geometry.slot);
  const dayTotal = cursorIndex !== null ? flow.dayTotals[cursorIndex] ?? 0 : 0;
  const yLabelX = FLOW_Y_AXIS_WIDTH - FLOW_LANE_GAP;
  const nameWidth = FLOW_NAME_RIGHT - FLOW_NAME_X;
  const labelFontSize = BASE_FONT_XS * fontScale;

  // 键盘游标没有鼠标坐标：锚点取游标线在当前河的中点，再换算回视口坐标。
  let tooltipAnchor: Anchor | null = null;
  if (cursorIndex !== null) {
    if (pointer) {
      tooltipAnchor = pointer;
    } else if (focused) {
      const svgX = cursorX;
      const svgY = flowLaneTop(activeIndex) + FLOW_LANE_HEIGHT / 2;
      const svg = svgRef.current;
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const scaleX = rect.width > 0 && chartWidth > 0 ? rect.width / chartWidth : 1;
        const scaleY = rect.height > 0 && chartHeight > 0 ? rect.height / chartHeight : 1;
        tooltipAnchor = { x: rect.left + svgX * scaleX, y: rect.top + svgY * scaleY };
      } else {
        tooltipAnchor = { x: svgX, y: svgY };
      }
    }
  }

  function liveText(): string {
    if (cursorIndex === null || lanes.length === 0) return "";
    const dayStart = flow.days[cursorIndex];
    const label =
      cursorIndex === flow.days.length - 1
        ? `${formatDayLabel(dayStart)}（今天，尚未过完）`
        : formatDayLabel(dayStart);
    if (!(dayTotal > 0)) return `${label}：这一天没有用量记录。`;
    const lane = lanes[activeIndex];
    const value = lane.values[cursorIndex] ?? 0;
    return `${label}：${lane.name} ${formatTokenCount(value)} token，占当天 ${shareOf(
      value,
      dayTotal
    )}；当天合计 ${formatTokenCount(dayTotal)} token。`;
  }

  const liveMessage = liveOverride ?? liveText();

  return (
    <div data-probe="lab-ribbon">
      <Panel title="项目流量" ariaLabel="项目流量" titleAs="h3">
        <div
          className={styles.interactive}
          role="group"
          tabIndex={0}
          aria-label="项目流量河流图（可交互）"
          aria-describedby={`${keyHelpId} ${footnoteId}`}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          data-ribbon-group=""
        >
          <p className={styles.summary}>
            近 {days} 天里 <strong>{flow.projectCount}</strong> 个项目有用量，共{" "}
            <strong>{formatTokenCount(flow.windowTokens)}</strong> token；峰值最高的是{" "}
            <strong>{peakLabel}</strong>，{peakDayLabel} 单日{" "}
            <strong>{peakValueText}</strong> token。
          </p>

          <div className={styles.chartWrap} ref={setWrapEl}>
            <svg
              ref={svgRef}
              className={styles.chart}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              role="img"
              aria-label={summaryAria}
              data-probe="ribbon-chart"
              data-ribbon-max={flow.max}
              data-ribbon-selected={selectedKey ?? undefined}
              data-ribbon-cursor-day={cursorIndex ?? undefined}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
              // 点击不移动 DOM 焦点（规格 §4.2）：键盘焦点仍由 Tab 进入。
              // 只拦 mousedown 的默认聚焦，click 仍会触发选河。
              onMouseDown={(event) => event.preventDefault()}
            >
              {/* 1. 面积：彩色河只用 `-soft`；尾部 / 第 7 名用中性面。 */}
              {geometry.lanes.map(({ lane, index, paths }) => (
                <g
                  key={lane.key}
                  data-ribbon-lane={lane.key}
                  data-ribbon-tone={lane.tone === null ? "neutral" : String(lane.tone)}
                  data-ribbon-rank={index}
                >
                  <path
                    d={paths.area}
                    fill={
                      lane.tone === null
                        ? "var(--bg-active)"
                        : `var(--chart-${lane.tone}-soft)`
                    }
                  />
                  <path
                    d={paths.line}
                    fill="none"
                    className={styles.laneEdge}
                    stroke={
                      lane.key === selectedKey
                        ? lane.tone === null
                          ? "var(--text)"
                          : `var(--chart-${lane.tone})`
                        : selectedKey
                          ? "var(--border-strong)"
                          : lane.tone === null
                            ? "var(--text-tertiary)"
                            : `var(--chart-${lane.tone})`
                    }
                    strokeWidth={
                      lane.key === selectedKey
                        ? FLOW_STROKE_HIGH
                        : selectedKey
                          ? 1
                          : lane.tone === null
                            ? contrast === "high"
                              ? FLOW_STROKE_HIGH
                              : 1
                            : contrast === "high"
                              ? FLOW_STROKE_HIGH
                              : FLOW_STROKE
                    }
                    strokeDasharray={
                      lane.tone === null && lane.key !== selectedKey ? "4 3" : undefined
                    }
                    data-ribbon-dim={
                      selectedKey && lane.key !== selectedKey ? "" : undefined
                    }
                  />
                </g>
              ))}

              {/* 2. 左栏：8px 色块 + 项目名就是图例；选中行再加 2px 竖条。 */}
              {geometry.lanes.map(({ lane, index }) => {
                const active =
                  lane.key === selectedKey ||
                  hoveredRow === index ||
                  (focused && activeIndex === index);
                const label = fitLabel(lane.shortName, nameWidth, labelFontSize);
                return (
                  <g key={`label-${lane.key}`} data-ribbon-label={lane.key}>
                    <rect
                      x={FLOW_SWATCH_X}
                      y={flowSwatchY(index)}
                      width={FLOW_LANE_GAP}
                      height={FLOW_LANE_GAP}
                      rx={1}
                      fill={
                        lane.tone === null
                          ? "var(--bg-active)"
                          : `var(--chart-${lane.tone})`
                      }
                      stroke={lane.tone === null ? "var(--text-tertiary)" : undefined}
                      strokeWidth={lane.tone === null ? 1 : undefined}
                    />
                    {label ? (
                      <text
                        x={FLOW_NAME_X}
                        y={flowNameBaseline(index)}
                        className={
                          active
                            ? `${styles.laneName} ${styles.laneNameActive}`
                            : styles.laneName
                        }
                        data-ribbon-name={lane.key}
                      >
                        {label}
                      </text>
                    ) : null}
                    {lane.key === selectedKey ? (
                      <rect
                        x={FLOW_SELECT_BAR_X}
                        y={flowSelectBarY(index)}
                        width={SELECT_BAR_WIDTH}
                        height={SELECT_BAR_HEIGHT}
                        fill={
                          lane.tone === null
                            ? "var(--text-tertiary)"
                            : `var(--chart-${lane.tone})`
                        }
                        data-ribbon-select-bar={lane.key}
                      />
                    ) : null}
                  </g>
                );
              })}

              {/* 3. 基准线画在填充之上：高对比度下 `-soft` 不透明，先画会被盖掉。 */}
              {geometry.lanes.map(({ index }) => (
                <line
                  key={`baseline-${index}`}
                  x1={FLOW_PLOT_LEFT}
                  x2={chartWidth}
                  y1={flowLaneBaseline(index)}
                  y2={flowLaneBaseline(index)}
                  className={styles.baseline}
                />
              ))}

              {/* 4. y 轴只在第一条河上画一次：0 与满格 + 两条短刻度。 */}
              <line
                x1={yLabelX}
                x2={FLOW_Y_AXIS_WIDTH}
                y1={flowLaneTop(0)}
                y2={flowLaneTop(0)}
                className={styles.baseline}
              />
              <line
                x1={yLabelX}
                x2={FLOW_Y_AXIS_WIDTH}
                y1={flowLaneBaseline(0)}
                y2={flowLaneBaseline(0)}
                className={styles.baseline}
              />
              <text
                x={yLabelX}
                y={flowYMaxLabelY()}
                textAnchor="end"
                className={styles.tickLabel}
                data-ribbon-y-label="max"
              >
                {formatAxisValue(flow.max)}
              </text>
              <text
                x={yLabelX}
                y={flowYZeroLabelY()}
                textAnchor="end"
                className={styles.tickLabel}
                data-ribbon-y-label="zero"
              >
                0
              </text>

              {/* 5. x 刻度：步长与 130% 的 fontScale 由纯函数层处理，不画纵向网格。 */}
              {geometry.ticks.map((tick) => (
                <text
                  key={`tick-${tick.index}`}
                  x={tick.x}
                  y={flowXLabelBaselineY(lanes.length)}
                  textAnchor="middle"
                  className={styles.tickLabel}
                  data-ribbon-x-tick={tick.index}
                >
                  {tick.label}
                </text>
              ))}

              {/* 6. 今天：最后一天 band 中心一条虚线，最后一点就落在这条线上。 */}
              <line
                x1={todayX}
                x2={todayX}
                y1={FLOW_PLOT_TOP}
                y2={lastBaseline}
                className={styles.todayLine}
                data-ribbon-today=""
              />

              {/* 7. 透明命中带：点击选河；尾部合计不可选中。 */}
              {geometry.lanes.map(({ lane, index, laneTop }) => (
                <rect
                  key={`hit-${lane.key}`}
                  x={0}
                  y={laneTop - FLOW_LANE_GAP / 2}
                  width={chartWidth}
                  height={FLOW_LANE_PITCH}
                  fill="transparent"
                  className={styles.hitRect}
                  pointerEvents={lane.isOther ? "none" : undefined}
                  onClick={lane.isOther ? undefined : () => toggleLane(index)}
                  data-ribbon-hit={lane.key}
                />
              ))}

              {/* 8. 悬停 / 键盘游标：一条竖线 + 每条河的当日点。 */}
              {cursorVisible ? (
                <>
                  <line
                    x1={cursorX}
                    x2={cursorX}
                    y1={FLOW_PLOT_TOP}
                    y2={lastBaseline}
                    className={styles.cursorLine}
                    data-ribbon-cursor=""
                    data-ribbon-cursor-day={cursorIndex ?? undefined}
                  />
                  {dayTotal > 0
                    ? geometry.lanes.map(({ lane, laneTop, baseline }) => (
                        <circle
                          key={`dot-${lane.key}`}
                          cx={cursorX}
                          cy={flowY(
                            lane.values[cursorIndex as number] ?? 0,
                            flow.max,
                            laneTop,
                            baseline
                          )}
                          r={contrast === "high" ? FLOW_DOT_R_HIGH : FLOW_DOT_R}
                          fill={
                            lane.tone === null
                              ? "var(--text-tertiary)"
                              : `var(--chart-${lane.tone})`
                          }
                          stroke="var(--bg-subtle)"
                          strokeWidth={1}
                          data-ribbon-dot={lane.key}
                        />
                      ))
                    : null}
                </>
              ) : null}

              {/* 9. 焦点环画在当前河整行 band 上，环跨越左栏与绘图区。 */}
              {focused ? (
                <rect
                  x={2}
                  y={flowLaneTop(activeIndex) - 3}
                  width={Math.max(0, chartWidth - 4)}
                  height={FLOW_LANE_HEIGHT + 6}
                  rx={2}
                  fill="none"
                  className={styles.focusRing}
                  data-ribbon-focus-ring=""
                />
              ) : null}
            </svg>
          </div>

          <p className={styles.readout}>
            {selectedLane ? (
              <>
                <span
                  className={`${styles.readoutSwatch}${
                    selectedLane.tone === null ? ` ${styles.readoutSwatchNeutral}` : ""
                  }`}
                  style={
                    selectedLane.tone !== null
                      ? { background: `var(--chart-${selectedLane.tone})` }
                      : undefined
                  }
                  aria-hidden="true"
                />
                <strong className={styles.readoutName}>{selectedLane.name}</strong>
                <span className={styles.readoutSep}> · </span>
                窗口合计{" "}
                <span className={styles.readoutValue}>
                  {formatTokenCount(selectedLane.total)}
                </span>{" "}
                token<span className={styles.readoutSep}> · </span>占本窗口{" "}
                <span className={styles.readoutValue}>
                  {shareOf(selectedLane.total, flow.windowTokens)}
                </span>
                <span className={styles.readoutSep}> · </span>峰值{" "}
                {formatDayLabel(flow.days[selectedLane.peakDay])}（
                <span className={styles.readoutValue}>
                  {formatTokenCount(selectedLane.peakValue)}
                </span>{" "}
                token）<span className={styles.readoutSep}> · </span>有记录{" "}
                <span className={styles.readoutValue}>{selectedLane.activeDays}</span>/
                {flow.days.length} 天
              </>
            ) : (
              <span className={styles.readoutIdle}>
                点一条河锁定项目，查看窗口合计与峰值日。
              </span>
            )}
          </p>

          <p className={styles.footnote} id={footnoteId}>
            {footnote}
          </p>

          <p className={styles.srOnly} id={keyHelpId}>
            方向键左右切换日期，上下切换项目，Enter 锁定项目，Esc
            取消；悬停也可查看某天读数。
          </p>

          <p className={styles.srOnly} role="status" aria-live="polite" data-ribbon-live="">
            {liveMessage}
          </p>

          {/* 等价表：静态承担「每条河的窗口事实」；逐日读数由游标 + live region 承担。 */}
          <div className={styles.srOnly}>
            <table data-ribbon-table="">
              <caption>项目流量等价表格</caption>
              <thead>
                <tr>
                  <th scope="col">项目</th>
                  <th scope="col">窗口合计</th>
                  <th scope="col">占本窗口</th>
                  <th scope="col">峰值日</th>
                  <th scope="col">峰值 token</th>
                  <th scope="col">有记录天数</th>
                </tr>
              </thead>
              <tbody>
                {lanes.map((lane) => (
                  <tr key={lane.key}>
                    <td>{lane.name}</td>
                    <td>{formatTokenCount(lane.total)} token</td>
                    <td>{shareOf(lane.total, flow.windowTokens)}</td>
                    <td>{formatDayLabel(flow.days[lane.peakDay])}</td>
                    <td>{formatTokenCount(lane.peakValue)} token</td>
                    <td>
                      {lane.activeDays}/{flow.days.length} 天
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      {tooltipAnchor && cursorIndex !== null && !tipSuppressed && typeof document !== "undefined"
        ? createPortal(
            <FlowTooltip
              anchor={tooltipAnchor}
              dayIndex={cursorIndex}
              days={flow.days}
              dayTotal={dayTotal}
              lanes={lanes}
              selectedKey={selectedKey}
            />,
            document.body
          )
        : null}
    </div>
  );
}
