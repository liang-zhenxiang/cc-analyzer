import { useCallback, useEffect, useState } from "react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { NotificationProvider, useNotifications } from "./NotificationProvider";
import { SessionAnalyzerPage } from "../features/sessions/SessionAnalyzerPage";
import { MonitorPage, type MonitorView } from "../features/monitor/MonitorPage";
import { PulseFloatHeader } from "../features/monitor/PulseFloatHeader";
import { UsageOverviewPage } from "../features/usage/UsageOverviewPage";
import { ThresholdsPanel } from "../features/settings/ThresholdsPanel";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { Button, IconButton } from "../components/Button";
import { BrandMark } from "../components/BrandMark";
import { Icon } from "../components/Icon";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SearchPalette } from "../features/search/SearchPalette";
import { VersionBadge } from "./VersionBadge";
import { loadAutoCheck, loadChannel } from "../features/settings/updateChannel";
import { BridgesProvider, useBridges } from "../api/bridges";
import { useTrayReadout } from "../features/usage/useTrayReadout";
import type { Bridges } from "../api/types";
import styles from "./AppShell.module.css";

export type WorkspaceTab = "analyzer" | "usage" | "monitor";

const TAB_KEY = "cca-workspace-tab";
const MONITOR_VIEW_KEY = "cca-monitor-view";

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

/**
 * 「实时监控」标签下的子视图（Issue #203）。状态必须住在 AppShell：浮窗时要靠
 * 它判断该不该把整条顶栏换成脉搏细头。存值不可信，未知值一律回落脉搏。
 */
function readStoredMonitorView(): MonitorView {
  try {
    const stored = localStorage.getItem(MONITOR_VIEW_KEY);
    if (stored === "dashboard") return "dashboard";
  } catch {
    // See readStoredTab: persistence is optional.
  }
  return "pulse";
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

/**
 * 启动时静默检查一次更新。挂在 NotificationProvider 内部（AppShell 本体
 * 在自己的 return 里才渲染 Provider，体内拿不到 notify）。
 */
function StartupUpdateCheck({ bridges }: { bridges: Bridges }) {
  const { notify } = useNotifications();
  useEffect(() => {
    if (!loadAutoCheck() || !bridges.updater) return;
    let cancelled = false;
    bridges.updater
      .checkUpdates(loadChannel())
      .then((result) => {
        if (!cancelled && result.available) {
          notify(`发现新版本 ${result.version}，可在「设置 → 软件更新」安装。`);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridges, notify]);
  return null;
}

/**
 * 托盘宿主：驱动常驻读数，并消费 Rust 的 `tray:navigate`（菜单点「用量总览」）。
 * 放在 BridgesProvider 内部——两个 hook 都要拿 bridges。
 */
function TrayHost({ onNavigate }: { onNavigate: (tab: WorkspaceTab) => void }) {
  const bridges = useBridges();
  useTrayReadout();

  useEffect(() => {
    // 老宿主 / 老测试的 bridges 可能没有这条订阅；缺了只是少了跳转能力。
    const subscribe = bridges.events.onTrayNavigate;
    if (!subscribe) return undefined;
    let dispose: (() => void) | undefined;
    let active = true;
    void subscribe((target) => {
      if (target === "usage") onNavigate("usage");
    }).then((unlisten) => {
      if (active) dispose = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, [bridges.events, onNavigate]);

  return null;
}

export function AppShell({ bridges }: { bridges: Bridges }) {
  const [tab, setTab] = useState<WorkspaceTab>(readStoredTab);
  const [monitorView, setMonitorView] = useState<MonitorView>(readStoredMonitorView);
  const [floating, setFloating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [revealRequest, setRevealRequest] = useState<{
    path: string;
    recordId: string | null;
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

  useEffect(() => {
    try {
      localStorage.setItem(MONITOR_VIEW_KEY, monitorView);
    } catch {
      // See readStoredMonitorView: persistence is optional.
    }
  }, [monitorView]);

  const exitFloatMode = useCallback(async () => {
    try {
      await bridges.custom?.exitFloatMode?.();
    } finally {
      setFloating(false);
    }
  }, [bridges]);

  /**
   * 进浮窗是**窗口级**状态：Rust 的 `float` 插件负责把窗口改成 420×620、
   * 置顶、无边框（`set_decorations(false)`），`floating` 只决定这一层画什么。
   * 两者必须成对出现——只切布局不调窗口命令，会得到一个「版式是浮窗、窗口
   * 还是 1400×872」的四不像（2026-10-15 的真机门禁抓到过这一条）。这条与
   * 下面的 `exitFloatMode` 是对称的：进出浮窗都归这一层管。
   */
  const enterFloatMode = useCallback(async () => {
    setFloating(true);
    try {
      await bridges.custom?.enterFloatMode?.();
    } catch {
      // 窗口没改成浮窗尺寸不该把界面回滚：细头仍在，用户还能点「退出浮窗」。
    }
  }, [bridges]);
  const canExitFloatMode = floating && typeof bridges.custom?.exitFloatMode === "function";
  // 浮窗 + 监控标签 + 脉搏档：整条顶栏换成脉搏细头（R7）。其余标签、以及
  // iframe 触发浮窗时（仪表盘档）保持现状。
  const floatPulse = floating && tab === "monitor" && monitorView === "pulse";

  return (
    <ThemeProvider>
      <BridgesProvider bridges={bridges}>
        <NotificationProvider>
          <StartupUpdateCheck bridges={bridges} />
          <TrayHost onNavigate={setTab} />
          <div className={styles.shell}>
            {floatPulse ? (
              <PulseFloatHeader onExit={() => void exitFloatMode()} />
            ) : (
              <header className={styles.topbar}>
                <span className={styles.brand}>
                  <BrandMark size={18} />
                  <strong>CC Analyzer</strong>
                  {/* 版本徽章紧挨字标：升级是否生效，第一眼就能读到。 */}
                  <VersionBadge />
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
            )}
            {settingsOpen ? <ThresholdsPanel onClose={() => setSettingsOpen(false)} /> : null}
          <main className={styles.content}>
            <ErrorBoundary>
              {tab === "analyzer" ? (
                <SessionAnalyzerPage
                  revealRequest={revealRequest}
                  onRevealHandled={() => setRevealRequest(null)}
                />
              ) : tab === "usage" ? (
                <UsageOverviewPage
                  // 压缩统计 top3 行的握手：切回会话分析并打开该会话
                  // （recordId 为 null = 只落到会话，不定位记录）。
                  onOpenSession={(session) => {
                    setTab("analyzer");
                    setRevealRequest({ path: session.path, recordId: null, nonce: Date.now() });
                  }}
                  // 错误事件行的握手（N1）：与全局搜索的 onReveal 同款——sidechain
                  // 事件 recordId=null，reveal 的既有语义就是「只落到会话」。
                  onRevealRecord={(path, recordId) => {
                    setTab("analyzer");
                    setRevealRequest({ path, recordId, nonce: Date.now() });
                  }}
                />
              ) : (
                <MonitorPage
                  view={monitorView}
                  onViewChange={setMonitorView}
                  compact={floating}
                  onEnterFloat={enterFloatMode}
                  // 脉搏会话行的「打开会话」握手：与压缩统计 top3 行逐字同款。
                  onOpenSession={(path) => {
                    setTab("analyzer");
                    setRevealRequest({ path, recordId: null, nonce: Date.now() });
                  }}
                />
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
