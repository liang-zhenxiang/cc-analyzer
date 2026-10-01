import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../../app/ThemeProvider";
import { useBridges } from "../../api/bridges";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { isLocalMonitorOrigin } from "./monitorMessages";
import styles from "./MonitorPage.module.css";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;

/**
 * `closed` 是初始状态：切到「实时监控」标签**不探测、不挂 iframe**，
 * 只有用户点了「打开监控」才进入 `probing → ready / unavailable`。
 *
 * 挂载即探测的代价是实打实的：三次重试要等近两秒，而那个仪表盘服务
 * 不在本仓库内、多数人根本没在跑它——每次切标签都白等一轮失败。
 */
type MonitorState =
  | { status: "closed" }
  | { status: "probing"; attempt: number }
  | { status: "ready"; port: number }
  | { status: "unavailable"; port: number | null; attempts: number };

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function MonitorPage({ onEnterFloat }: { onEnterFloat?: () => void } = {}) {
  const { monitor, custom } = useBridges();
  const { theme } = useTheme();
  const [state, setState] = useState<MonitorState>({ status: "closed" });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const probeIdRef = useRef(0);
  const port = state.status === "ready" ? state.port : null;

  const probe = useCallback(async () => {
    const probeId = ++probeIdRef.current;
    let lastPort: number | null = null;

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
      } catch {
        lastPort = null;
      }
      if (attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS);
    }

    if (probeIdRef.current !== probeId) return;
    setState({ status: "unavailable", port: lastPort, attempts: MAX_ATTEMPTS });
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
        void custom?.enterFloatMode();
        onEnterFloat?.();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [custom, onEnterFloat, port]);

  const postTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "theme", theme }, "*");
  }, [theme]);

  useEffect(() => {
    if (state.status === "ready") postTheme();
  }, [postTheme, state.status]);

  if (state.status === "closed") {
    return (
      <EmptyState
        size="page"
        title="实时监控未打开"
        description="打开后会内嵌本机 localhost 上运行的监控仪表盘。该服务不在本仓库内，需要另行启动。"
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
    // 只说发生了什么：探测了哪个地址、失败了几次、这个服务在哪。
    // 「可能被某个进程占用」这类猜测会把用户引向一个我们并不知道的原因。
    const failure =
      state.port === null
        ? "未在本机 localhost 上检测到监控仪表盘"
        : `未在 localhost:${state.port} 上检测到监控仪表盘`;
    return (
      <EmptyState
        size="page"
        title="监控仪表盘未连接"
        description={`${failure}（已尝试 ${state.attempts} 次）。该服务不在本仓库内，需要另行启动。`}
        action={
          <Button type="button" variant="primary" onClick={() => void probe()}>
            <Icon name="refresh" size={14} />
            重试
          </Button>
        }
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
