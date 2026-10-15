import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Panel } from "../../components/Panel";
import { Skeleton, SkeletonBar } from "../../components/Skeleton";
import { formatClock, formatDuration, formatProjectPath, formatTokenCount } from "../../lib/format";
import { billingReadoutsOf, type BillingWindowReadouts } from "../usage/billingReadouts";
import { burnRateOf, predictLimitReach } from "../usage/billingWindow";
import { usePlan } from "../usage/planLimits";
import { totalsSum } from "../usage/usageAggregations";
import { ContextCurve, RateCurve } from "./pulseCharts";
import {
  compactionBand,
  contextPanel,
  fallbackSessionTitle,
  rateBuckets,
  recentRate,
  type CompactionBand
} from "./pulseModel";
import styles from "./PulsePage.module.css";
import { usePulseFeed, type PulseSnapshot } from "./usePulseFeed";

/**
 * 原生「实时脉搏」视图（Issue #203，视觉契约见
 * `.trellis/workspace/liangyuxiang/design-round-w-live-pulse.md`）。
 *
 * 数据的唯一来源是 `usePulseFeed` 的快照 + `pulseModel` 的纯函数 +
 * `billingReadoutsOf` 的窗口数学——组件里**不做**分桶、求和或区间计算，只把
 * 算好的结果摆成四块面板（§12.1 的第一条硬约束）。
 */
export function PulsePage({
  compact = false,
  onEnterFloat,
  onOpenSession
}: {
  /** 浮窗态：页头降级为一行状态、图表 viewBox 换高。布局另走容器查询。 */
  compact?: boolean;
  onEnterFloat?: () => void;
  /** 会话行的「打开会话」握手：与用量页同款（切到会话分析并落到该会话）。 */
  onOpenSession?: (path: string) => void;
} = {}) {
  // 「重试」靠重挂载重启一拍：feed 的返回契约没有 retry，换一个 key 就换一个
  // 事件循环里的调度链，比在 hook 旁边再写一个“手动补一拍”的旁路干净。
  const [attempt, setAttempt] = useState(0);
  return (
    <PulseFeedView
      key={attempt}
      compact={compact}
      onEnterFloat={onEnterFloat}
      onOpenSession={onOpenSession}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

type PulseState = "loading" | "empty" | "error" | "fresh" | "stale";

/** 页面可见性：不可见时不给 live 行挂心跳（§9.3 条件二）。 */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/** 「N 秒 / N 分钟前有新记录」——行里唯一一句完整事实，也是字形的文字等价物。 */
function recencyText(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds} 秒前有新记录`;
  return `${Math.floor(seconds / 60)} 分钟前有新记录`;
}

function PulseFeedView({
  compact,
  onEnterFloat,
  onOpenSession,
  onRetry
}: {
  compact: boolean;
  onEnterFloat?: () => void;
  onOpenSession?: (path: string) => void;
  onRetry: () => void;
}) {
  const { snapshot, error, stale } = usePulseFeed();
  const plan = usePlan();
  const visible = usePageVisible();

  const state: PulseState = !snapshot
    ? error
      ? "error"
      : "loading"
    : snapshot.inputs.length === 0
      ? "empty"
      : stale
        ? "stale"
        : "fresh";

  // 同一份日志、同一份窗口数学：与用量总览的表盘逐位相等的前提（R4）。
  const readouts = useMemo(
    () =>
      snapshot && snapshot.inputs.length > 0
        ? billingReadoutsOf(snapshot.inputs, snapshot.now, plan.weeklyLimitTokens)
        : null,
    [snapshot, plan]
  );

  const refreshText = !snapshot
    ? error
      ? "读取本地日志失败"
      : "正在读取本地日志…"
    : `上次更新 ${formatClock(snapshot.now, true)}${state === "stale" ? " · 本次读取失败" : ""}`;

  return (
    <div className={styles.pulsePage} data-probe="pulse-page" data-state={state}>
      <div className={styles.pulseInner}>
        {/* 页头四态常在场。浮窗态去掉分段控件（在 MonitorPage 上）与「悬浮」，
            只留这一行状态；`pulse-head` 锚点按 §10 只在非浮窗态出现。 */}
        <div className={styles.pulseHead} {...(compact ? {} : { "data-probe": "pulse-head" })}>
          <span
            className={styles.refreshState}
            data-probe="pulse-refresh-state"
            {...(state === "stale" ? { "data-stale": "true" } : {})}
          >
            {refreshText}
          </span>
          {/* 过期态：绝不清空旧读数，只加这一行红字与一个重试。 */}
          {state === "stale" ? (
            <Button type="button" onClick={onRetry}>
              重试
            </Button>
          ) : null}
          {!compact && onEnterFloat ? (
            <Button
              type="button"
              className={styles.floatButton}
              onClick={onEnterFloat}
            >
              悬浮
            </Button>
          ) : null}
        </div>

        {state === "loading" ? <LoadingSkeleton /> : null}

        {state === "error" ? (
          <div className={styles.stage} data-probe="pulse-error">
            <ErrorState
              size="page"
              title="读取本地日志失败"
              hint="没能读到会话目录（文件可能正在被写入或被移动）。确认目录可读后重试。"
              // 原始异常串只进 detail：它可能带绝对路径，而路径是敏感数据。
              detail={error ?? undefined}
              onRetry={onRetry}
            />
          </div>
        ) : null}

        {state === "empty" ? (
          <div className={styles.stage} data-probe="pulse-empty">
            <EmptyState
              size="page"
              title="本机还没有会话日志"
              description="Claude Code 每次运行都会在本机留下日志；有记录后这里会显示实时的消耗脉搏。"
            />
          </div>
        ) : null}

        {snapshot && readouts ? (
          <PulsePanels
            snapshot={snapshot}
            readouts={readouts}
            limitTokens={plan.limitTokens}
            compact={compact}
            visible={visible}
            onOpenSession={onOpenSession}
          />
        ) : null}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className={styles.skeletonStack} data-probe="pulse-skeleton" data-probe-pending>
      {/* 只保留一个 live region：`Skeleton` 自带 role="status"，另外两块标记
          aria-hidden，免得屏幕阅读器把同一件事播三遍。 */}
      <div className={styles.skeletonReadouts} aria-hidden="true" data-probe-pending>
        {[0, 1, 2, 3, 4].map((index) => (
          <SkeletonBar key={index} width="value" />
        ))}
      </div>
      <div className={styles.chartSkeleton} aria-hidden="true" data-probe-pending />
      <Skeleton variant="list" rows={3} label="正在读取活跃会话" />
    </div>
  );
}

function PulsePanels({
  snapshot,
  readouts,
  limitTokens,
  compact,
  visible,
  onOpenSession
}: {
  snapshot: PulseSnapshot;
  readouts: BillingWindowReadouts;
  limitTokens: number | null;
  compact: boolean;
  visible: boolean;
  onOpenSession?: (path: string) => void;
}) {
  const now = snapshot.now;
  const buckets = useMemo(() => rateBuckets(readouts.records, now), [readouts, now]);
  const recent = recentRate(readouts.records, now, 15 * 60_000);
  const latest = snapshot.latest;
  const panel = latest
    ? contextPanel(latest.records, latest.compactEvents)
    : { samples: [], anchors: [] };
  const band: CompactionBand = latest
    ? compactionBand(latest.compactEvents)
    : { insufficient: true, n: 0 };
  const latestTitle = latest
    ? (snapshot.rows.find((row) => row.path === latest.session.path)?.title ??
      fallbackSessionTitle(latest.session))
    : null;

  return (
    <>
      <div className={styles.panelSlot} data-probe="pulse-window-card">
        <Panel title="5 小时窗口" ariaLabel="5 小时窗口">
          {readouts.active ? (
            <>
              <WindowReadouts
                block={readouts.active}
                recentPerHour={recent}
                limitTokens={limitTokens}
                now={now}
              />
              <p className={styles.panelFootnote}>
                速率单位 tokens/小时。窗口平均 = 已用 ÷ 已过时长；近 15 分钟为窗口内实测，两者都不外推。
              </p>
            </>
          ) : (
            <EmptyState size="inline" title="最近 5 小时没有计费窗口" />
          )}
        </Panel>
      </div>

      <Panel title="最近 60 分钟" ariaLabel="最近 60 分钟">
        <RateCurve buckets={buckets} compact={compact} />
      </Panel>

      <div className={styles.panelSlot} data-probe="pulse-sessions">
        <Panel title="活跃会话" ariaLabel="活跃会话">
          {snapshot.rows.length === 0 ? (
            <EmptyState size="inline" title="最近 5 小时没有活跃会话" />
          ) : (
            <ul className={styles.sessionList} aria-label="活跃会话">
              {snapshot.rows.map((row) => (
                <li
                  key={row.path}
                  className={styles.sessionItem}
                  data-probe="pulse-session-row"
                  data-recency={row.recency}
                >
                  <button
                    type="button"
                    className={styles.sessionOpen}
                    data-probe="pulse-session-open"
                    title={`打开会话 · 最后写入 ${formatClock(row.lastActivityMs, true)}`}
                    onClick={() => onOpenSession?.(row.path)}
                  >
                    <span
                      className={styles.sessionTick}
                      data-probe="pulse-session-tick"
                      aria-hidden="true"
                      {...(row.recency === "live" && visible ? { "data-beat": "true" } : {})}
                    />
                    <span className={styles.sessionTitle}>{row.title}</span>
                    <span className={styles.sessionProject}>
                      {formatProjectPath(row.projectLabel)}
                    </span>
                    <span className={styles.sessionAge}>{recencyText(row.ageMs)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.panelFootnote}>
            只陈述「多久前有新记录」，不代表会话正在运行。
          </p>
        </Panel>
      </div>

      <Panel
        title="上下文填充"
        ariaLabel="上下文填充"
        actions={latestTitle ? <span className={styles.sessionName}>{latestTitle}</span> : null}
      >
        <ContextCurve samples={panel.samples} anchors={panel.anchors} band={band} compact={compact} />
        <p className={styles.panelFootnote}>
          样本为每次调用喂给模型的上下文（输入 + 缓存读 + 缓存写）。虚线标出压缩发生的位置。
        </p>
      </Panel>
    </>
  );
}

function WindowReadouts({
  block,
  recentPerHour,
  limitTokens,
  now
}: {
  block: NonNullable<BillingWindowReadouts["active"]>;
  recentPerHour: number;
  limitTokens: number | null;
  now: number;
}) {
  const consumed = totalsSum(block.totals);
  const rate = burnRateOf(block, now);
  const prediction = predictLimitReach(block, limitTokens, now);
  const predictionOver = "reachAt" in prediction && prediction.reachAt < block.end;

  return (
    <div className={styles.readouts}>
      <div className={styles.readout} data-probe="pulse-window-readout" data-readout="used">
        <span className={styles.readoutLabel}>已用</span>
        <b className={styles.readoutValue} title={String(consumed)}>
          {formatTokenCount(consumed)}
        </b>
      </div>

      <div className={styles.readout} data-probe="pulse-window-readout" data-readout="closes">
        <span className={styles.readoutLabel}>窗口关闭</span>
        <b className={styles.readoutValue}>{formatClock(block.end)}</b>
        <span className={styles.readoutSub}>
          {block.end > now ? `还剩 ${formatDuration(block.end - now)}` : "已关闭"}
        </span>
      </div>

      <div className={styles.readout} data-probe="pulse-window-readout" data-readout="avg-rate">
        <span className={styles.readoutLabel}>窗口平均</span>
        {"insufficientSample" in rate ? (
          <b className={styles.readoutValueMuted}>样本不足</b>
        ) : (
          <b className={styles.readoutValue} title={String(rate.tokensPerHour)}>
            {`${formatTokenCount(rate.tokensPerHour)}/时`}
          </b>
        )}
        <span className={styles.readoutSub}>
          {"insufficientSample" in rate ? "窗口开启不足 30 分钟" : `${formatDuration(rate.elapsedMs)} 均值`}
        </span>
      </div>

      {/* 近 15 分钟是窗口内实测，永远不进退化态：窗口里没记录就是 0/时。 */}
      <div className={styles.readout} data-probe="pulse-window-readout" data-readout="recent-rate">
        <span className={styles.readoutLabel}>近 15 分钟</span>
        <b className={styles.readoutValue} title={String(recentPerHour)}>
          {`${formatTokenCount(recentPerHour)}/时`}
        </b>
      </div>

      <PredictionReadout prediction={prediction} over={predictionOver} now={now} />
    </div>
  );
}

function PredictionReadout({
  prediction,
  over,
  now
}: {
  prediction: ReturnType<typeof predictLimitReach>;
  over: boolean;
  now: number;
}) {
  // 两个退化（没有分母 / 样本不够）共用同一套 muted 版式，只有文案不同——
  // 用户要做的下一步不同（去设置 vs 等 30 分钟）。
  let value: ReactNode;
  let sub: string;
  if ("noLimit" in prediction) {
    value = <b className={styles.readoutValueMuted}>未设预算</b>;
    sub = "在「设置 → 阈值设置」填入 5 小时预算后可预测";
  } else if ("insufficientSample" in prediction) {
    value = <b className={styles.readoutValueMuted}>样本不足</b>;
    sub = "窗口开启不足 30 分钟";
  } else {
    value = (
      <b className={styles.readoutValue} title={String(prediction.reachAt)}>
        {formatClock(prediction.reachAt)}
      </b>
    );
    sub = `距现在 ${formatDuration(prediction.reachAt - now)}`;
  }

  return (
    <div
      className={styles.readout}
      data-probe="pulse-window-readout"
      data-readout="prediction"
      data-warning={over ? "true" : "false"}
    >
      <span className={styles.readoutLabel}>预测触顶</span>
      {value}
      <span className={styles.readoutSub}>{sub}</span>
    </div>
  );
}
