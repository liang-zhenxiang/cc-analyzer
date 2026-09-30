import { useCallback, useEffect, useState } from "react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { NotificationProvider } from "./NotificationProvider";
import { SessionAnalyzerPage } from "../features/sessions/SessionAnalyzerPage";
import { MonitorPage } from "../features/monitor/MonitorPage";
import { ThresholdsPanel } from "../features/settings/ThresholdsPanel";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { Button, IconButton } from "../components/Button";
import { BrandMark } from "../components/BrandMark";
import { Icon } from "../components/Icon";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { BridgesProvider } from "../api/bridges";
import type { Bridges } from "../api/types";
import styles from "./AppShell.module.css";

export type WorkspaceTab = "analyzer" | "monitor";

const TAB_KEY = "cca-workspace-tab";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  // 图标画的是「点下去会切到哪」。
  return (
    <IconButton label="切换主题" onClick={toggleTheme}>
      <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
    </IconButton>
  );
}

export function AppShell({ bridges }: { bridges: Bridges }) {
  const [tab, setTab] = useState<WorkspaceTab>(() => {
    return localStorage.getItem(TAB_KEY) === "monitor" ? "monitor" : "analyzer";
  });
  const [floating, setFloating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  const exitFloatMode = useCallback(async () => {
    try {
      await bridges.custom?.exitFloatMode?.();
    } finally {
      setFloating(false);
    }
  }, [bridges]);

  const enterFloatMode = useCallback(() => setFloating(true), []);
  const canExitFloatMode = floating && typeof bridges.custom?.exitFloatMode === "function";

  return (
    <ThemeProvider>
      <BridgesProvider bridges={bridges}>
        <NotificationProvider>
          <div className={styles.shell}>
            <header className={styles.topbar}>
              <span className={styles.brand}>
                <BrandMark size={18} />
                <strong>CC Analyzer</strong>
              </span>
              <WorkspaceTabs value={tab} onChange={setTab} />
              <div className={styles.topbarActions}>
                {canExitFloatMode ? (
                  <Button type="button" variant="primary" onClick={() => void exitFloatMode()}>
                    退出浮窗
                  </Button>
                ) : null}
                <IconButton
                  label="设置"
                  aria-expanded={settingsOpen}
                  onClick={() => setSettingsOpen((open) => !open)}
                >
                  <Icon name="settings" size={16} />
                </IconButton>
                <ThemeToggle />
              </div>
            </header>
            {settingsOpen ? <ThresholdsPanel onClose={() => setSettingsOpen(false)} /> : null}
          <main className={styles.content}>
            <ErrorBoundary>
              {tab === "analyzer" ? (
                <SessionAnalyzerPage />
              ) : (
                <MonitorPage onEnterFloat={enterFloatMode} />
              )}
            </ErrorBoundary>
          </main>
          </div>
        </NotificationProvider>
      </BridgesProvider>
    </ThemeProvider>
  );
}
