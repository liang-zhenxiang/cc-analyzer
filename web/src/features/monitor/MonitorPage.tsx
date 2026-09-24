import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../../app/ThemeProvider";
import { useBridges } from "../../api/bridges";
import { Button } from "../../components/Button";
import { isLocalMonitorOrigin } from "./monitorMessages";
import styles from "./MonitorPage.module.css";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;

type MonitorState =
  | { status: "probing"; attempt: number }
  | { status: "ready"; port: number }
  | { status: "unavailable"; port: number | null; attempts: number };

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function MonitorPage({ onEnterFloat }: { onEnterFloat?: () => void } = {}) {
  const { monitor, custom } = useBridges();
  const { theme } = useTheme();
  const [state, setState] = useState<MonitorState>({ status: "probing", attempt: 1 });
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

  useEffect(() => {
    void probe();
  }, [probe]);

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

  if (state.status === "probing") {
    return (
      <div className={styles.center}>
        <p>
          正在连接监控代理（第 {state.attempt}/{MAX_ATTEMPTS} 次尝试）…
        </p>
      </div>
    );
  }

  if (state.status === "unavailable") {
    return (
      <div className={styles.center}>
        <h2>监控代理未启动</h2>
        <p>
          端口 {state.port ?? "?"} 无响应（已尝试 {state.attempts} 次，可能被旧 cc-monitor 占用）。
        </p>
        <Button type="button" variant="primary" onClick={() => void probe()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <iframe
      ref={frameRef}
      title="实时监控 dashboard"
      src={`http://localhost:${state.port}/?theme=${theme}`}
      onLoad={postTheme}
      className={styles.frame}
    />
  );
}
