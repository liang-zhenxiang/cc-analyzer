import { useCallback, useEffect, useState } from "react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { NotificationProvider } from "./NotificationProvider";
import { SessionAnalyzerPage } from "../features/sessions/SessionAnalyzerPage";
import { MonitorPage } from "../features/monitor/MonitorPage";
import { UsageOverviewPage } from "../features/usage/UsageOverviewPage";
import { ThresholdsPanel } from "../features/settings/ThresholdsPanel";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { Button, IconButton } from "../components/Button";
import { BrandMark } from "../components/BrandMark";
import { Icon } from "../components/Icon";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SearchPalette } from "../features/search/SearchPalette";
import { BridgesProvider } from "../api/bridges";
import type { Bridges } from "../api/types";
import styles from "./AppShell.module.css";

export type WorkspaceTab = "analyzer" | "usage" | "monitor";

const TAB_KEY = "cca-workspace-tab";

/** Stored values are untrusted: anything unknown falls back to the analyzer. */
function readStoredTab(): WorkspaceTab {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    if (stored === "usage" || stored === "monitor") return stored;
  } catch {
    // localStorage may be unavailable; the default tab still works.
  }
  return "analyzer";
}

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
  const [tab, setTab] = useState<WorkspaceTab>(readStoredTab);
  const [floating, setFloating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [revealRequest, setRevealRequest] = useState<{
    path: string;
    recordId: string;
    nonce: number;
  } | null>(null);

  // ⌘K / Ctrl+K 唤起全局搜索。监听挂在 window：快捷键在顶栏按钮之外
  // 也要随处可用，且面板关闭时不拦截输入。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // See readStoredTab: persistence is optional.
    }
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
                  label="全局搜索"
                  aria-expanded={searchOpen}
                  onClick={() => setSearchOpen((open) => !open)}
                >
                  <Icon name="search" size={16} />
                </IconButton>
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
                <SessionAnalyzerPage
                  revealRequest={revealRequest}
                  onRevealHandled={() => setRevealRequest(null)}
                />
              ) : tab === "usage" ? (
                <UsageOverviewPage />
              ) : (
                <MonitorPage onEnterFloat={enterFloatMode} />
              )}
            </ErrorBoundary>
          </main>
          {/* 浮层在 shell 之外顶层渲染；跳转先切回会话分析页再发请求。 */}
          <SearchPalette
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onReveal={(path, recordId) => {
              setTab("analyzer");
              setRevealRequest({ path, recordId, nonce: Date.now() });
            }}
          />
          </div>
        </NotificationProvider>
      </BridgesProvider>
    </ThemeProvider>
  );
}
