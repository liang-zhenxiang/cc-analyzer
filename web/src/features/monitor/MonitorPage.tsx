import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../../app/ThemeProvider";
import { useBridges } from "../../api/bridges";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { isLocalMonitorOrigin } from "./monitorMessages";
import { MonitorConsolePage } from "./MonitorConsolePage";
import { PulsePage } from "./PulsePage";
import styles from "./MonitorPage.module.css";

/** 「实时监控」标签下的三个子视图：原生脉搏是默认档。 */
export type MonitorView = "pulse" | "console" | "dashboard";

const VIEW_ITEMS: SegmentedItem<MonitorView>[] = [
  { value: "pulse", label: "脉搏" },
  { value: "console", label: "监控台" },
  { value: "dashboard", label: "外部仪表盘" }
];

/**
 * 「实时监控」标签的受控分段容器（design.md §6）。
 *
 * 子视图状态由 `AppShell` 持有（浮窗时要靠它判断该不该收顶栏），这里只
 * 负责把三档渲染出来。分段控件常驻，`dashboard` 档才挂载外部仪表盘的状态机
 * ——**未挂载就不调用 `monitor_port` / `monitor_ping`**（R1 的「原生视图挂载时
 * 不做任何探测」）。
 */
export function MonitorPage({
  view,
  onViewChange,
  onEnterFloat,
  onOpenSession,
  compact = false
}: {
  view: MonitorView;
  onViewChange: (view: MonitorView) => void;
  onEnterFloat?: () => void;
  /** 脉搏会话行的「打开会话」握手；dashboard 档不使用。 */
  onOpenSession?: (path: string) => void;
  /** 浮窗态：分段控件收起（浮窗里没有第二个子视图可切）。 */
  compact?: boolean;
}) {
  return (
    <div className={styles.root}>
      {!compact ? (
        <div className={styles.switchBar}>
          <SegmentedControl
            items={VIEW_ITEMS}
            value={view}
            onChange={onViewChange}
            ariaLabel="监控视图"
          />
        </div>
      ) : null}
      {view === "pulse" ? (
        <PulsePage compact={compact} onEnterFloat={onEnterFloat} onOpenSession={onOpenSession} />
      ) : view === "console" ? (
        <MonitorConsolePage onOpenSession={onOpenSession} />
      ) : (
        <ExternalDashboard onEnterFloat={onEnterFloat} />
      )}
    </div>
  );
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;

/**
 * `closed` 是初始状态：切到「外部仪表盘」**不探测、不挂 iframe**，
 * 只有用户点了「打开监控」才进入 `probing → ready / unavailable`。
 *
 * 挂载即探测的代价是实打实的：三次重试要等近两秒，而那个仪表盘服务
 * 不在本仓库内、多数人根本没在跑它——每次切标签都白等一轮失败。
 *
 * Issue #203 起整段状态机**原样搬进这个组件**：只有它被挂载时才跑这些
 * 探测，脉搏档一个字节都不碰 `monitor_port` / `monitor_ping`。
 */
type MonitorState =
  | { status: "closed" }
  | { status: "probing"; attempt: number }
  | { status: "ready"; port: number }
  | {
      status: "unavailable";
      port: number | null;
      attempts: number;
      /** 最后一次探测的原始失败串；只进「详情」，不进正文。 */
      detail: string | null;
    };

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function ExternalDashboard({ onEnterFloat }: { onEnterFloat?: () => void } = {}) {
  const { monitor } = useBridges();
  const { theme } = useTheme();
  const [state, setState] = useState<MonitorState>({ status: "closed" });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const probeIdRef = useRef(0);
  const port = state.status === "ready" ? state.port : null;

  // 端口号是「下一步该做什么」里唯一可执行的那半句，所以要写在**打开之前**
  // 就能看见的地方。它是后端的一个常量，只能问后端要——在前端再写一个 8090
  // 就是第二份事实，两边早晚会不一致。
  const [knownPort, setKnownPort] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    monitor.monitorPort().then(
      (value) => {
        if (!cancelled) setKnownPort(value);
      },
      // 读不到就不说端口——不许编一个。
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, [monitor]);

  const probe = useCallback(async () => {
    const probeId = ++probeIdRef.current;
    let lastPort: number | null = null;
    let lastDetail: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (probeIdRef.current !== probeId) return;
      setState({ status: "probing", attempt });
      try {
        const port = await monitor.monitorPort();
        lastPort = port;
        if (await monitor.pingMonitor()) {
          if (probeIdRef.current !== probeId) return;
          setState({ status: "ready", port });
          return;
        }
      } catch (cause) {
        lastPort = null;
        lastDetail = String(cause);
      }
      if (attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS);
    }

    if (probeIdRef.current !== probeId) return;
    setState({ status: "unavailable", port: lastPort, attempts: MAX_ATTEMPTS, detail: lastDetail });
  }, [monitor]);

  const close = useCallback(() => {
    // 作废在飞的探测：否则它的结果会在面板关掉之后把面板又打开。
    probeIdRef.current += 1;
    setState({ status: "closed" });
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isLocalMonitorOrigin(event.origin, port)) return;
      const data = event.data as { type?: unknown } | null;
      if (data?.type === "enter-float") {
        onEnterFloat?.();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // 窗口命令不在这里发：`onEnterFloat` 由 `AppShell` 提供，它负责调
    // `custom.enterFloatMode()` 并切浮窗版式（两件事必须一起发生，见 AppShell
    // 里的注释）。这里只负责把「仪表盘请求进浮窗」这条消息翻译成那个回调。
  }, [onEnterFloat, port]);

  const postTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "theme", theme }, "*");
  }, [theme]);

  useEffect(() => {
    if (state.status === "ready") postTheme();
  }, [postTheme, state.status]);

  if (state.status === "closed") {
    // 「该服务不在本仓库内」是写给维护者的话，用户读到「需要另行启动」就结束了。
    // 这里给的是两样可执行的东西：它监听哪个地址、以及要做什么。
    // 读不到端口（或读回一个非正数）就只说「本机 localhost」——不许编一个端口号出来。
    const target =
      knownPort !== null && knownPort > 0 ? `本机 localhost:${knownPort}` : "本机 localhost";
    return (
      <EmptyState
        size="page"
        title="实时监控未打开"
        description={`监控仪表盘是一个本机单独运行的服务，应用会连接 ${target}。先在你的终端里把它启动起来，再点「打开监控」。`}
        action={
          <Button type="button" variant="primary" onClick={() => void probe()}>
            打开监控
          </Button>
        }
      />
    );
  }

  if (state.status === "probing") {
    return (
      <EmptyState
        size="page"
        title="正在探测监控仪表盘"
        description={`第 ${state.attempt}/${MAX_ATTEMPTS} 次尝试…`}
      />
    );
  }

  if (state.status === "unavailable") {
    // 只说发生了什么：探测了哪个地址、失败了几次。
    // 「可能被某个进程占用」这类猜测会把用户引向一个我们并不知道的原因。
    const failure =
      state.port === null
        ? "未在本机 localhost 上检测到监控仪表盘"
        : `未在 localhost:${state.port} 上检测到监控仪表盘`;
    return (
      <ErrorState
        size="page"
        title="监控仪表盘未连接"
        hint={`${failure}（已尝试 ${state.attempts} 次）。确认该服务已在你自己的终端里启动，然后重试。`}
        // 原始失败串只进「详情」：它可能带绝对路径，而路径是敏感数据。
        detail={state.detail ?? undefined}
        onRetry={() => void probe()}
      />
    );
  }

  return (
    <div className={styles.monitor}>
      <div className={styles.bar}>
        <span className={styles.target}>{`localhost:${state.port}`}</span>
        <Button type="button" onClick={close}>
          <Icon name="close" size={14} />
          关闭监控
        </Button>
      </div>
      <iframe
        ref={frameRef}
        title="实时监控仪表盘"
        src={`http://localhost:${state.port}/?theme=${theme}`}
        onLoad={postTheme}
        className={styles.frame}
      />
    </div>
  );
}
