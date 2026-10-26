import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { CommandPalette } from "./CommandPalette";
import type { CommandAction } from "./commandRegistry";
import { KioskRoot, getKiosk, setKiosk, useKiosk } from "./KioskMode";
import { parseContrast, setContrast, useContrast } from "../features/settings/contrast";
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
    if (stored === "console") return "console";
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
 * 命令面板的接线层：动作表在 App 层构造（这里才知道「有哪些能力」），
 * `CommandPalette` 保持哑组件。
 *
 * 它必须是**子组件**：主题、对比度、大屏三个 hook 都要求 Provider 在场，
 * 而 Provider 是在 `AppShell` 的 return 里才包上去的。
 *
 * 拿不到的动作（用量档内切档、导出快照、归档仓库）留在表里标 `disabled`：
 * 面板如实说「不可用」，比把不存在的能力藏起来或假造一个入口都诚实。
 */
function CommandPaletteHost({
  open,
  onClose,
  onNavigate,
  onOpenSearch,
  onOpenSettings
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const contrast = useContrast();
  const kiosk = useKiosk();

  const actions = useMemo<CommandAction[]>(() => {
    // 「跟随系统」在这里只能应用一次：ThemeProvider 的持久化只认 light / dark，
    // 造一个 "system" 档会与它自己的存储格式打架，所以文案就说清楚是应用一次。
    const followSystem = () =>
      setTheme(
        typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
      );

    return [
      {
        id: "nav-analyzer",
        title: "会话分析",
        group: "视图",
        keywords: "session analyzer 会话",
        run: () => onNavigate("analyzer")
      },
      {
        id: "nav-usage",
        title: "用量总览",
        group: "视图",
        keywords: "usage 用量 成本",
        run: () => onNavigate("usage")
      },
      {
        id: "nav-monitor",
        title: "实时监控",
        group: "视图",
        keywords: "monitor pulse 监控 脉搏",
        run: () => onNavigate("monitor")
      },
      {
        id: "open-search",
        title: "全局搜索",
        group: "视图",
        keywords: "search 搜索 查找",
        detail: "搜索会话记录",
        run: onOpenSearch
      },
      {
        id: "nav-archive",
        title: "归档仓库",
        group: "视图",
        keywords: "archive 归档",
        disabled: true,
        detail: "本轮未接入：归档入口在「设置 → 本地归档」"
      },
      {
        id: "open-settings",
        title: "设置",
        group: "视图",
        keywords: "settings preferences 偏好",
        run: onOpenSettings
      },
      {
        id: "usage-tab-usage",
        title: "用量：切到用量档",
        group: "用量",
        keywords: "usage",
        disabled: true,
        detail: "需在「用量总览」内切换"
      },
      {
        id: "usage-tab-milestones",
        title: "用量：切到里程碑",
        group: "用量",
        keywords: "milestones 里程碑",
        disabled: true,
        detail: "需在「用量总览」内切换"
      },
      {
        id: "usage-tab-errors",
        title: "用量：切到错误",
        group: "用量",
        keywords: "errors 错误",
        disabled: true,
        detail: "需在「用量总览」内切换"
      },
      {
        id: "theme-light",
        title: "主题：浅色",
        group: "外观",
        keywords: "theme light",
        detail: theme === "light" ? "当前" : undefined,
        run: () => setTheme("light")
      },
      {
        id: "theme-dark",
        title: "主题：深色",
        group: "外观",
        keywords: "theme dark",
        detail: theme === "dark" ? "当前" : undefined,
        run: () => setTheme("dark")
      },
      {
        id: "theme-system",
        title: "主题：跟随系统",
        group: "外观",
        keywords: "theme system auto 自动",
        detail: "按当前系统偏好应用一次",
        run: followSystem
      },
      {
        id: "toggle-contrast",
        title: contrast === "high" ? "关闭高对比度" : "开启高对比度",
        group: "外观",
        keywords: "contrast 对比度 accessibility",
        detail: `当前：${contrast === "high" ? "高对比度" : "普通"}`,
        run: () => setContrast(parseContrast(contrast === "high" ? "normal" : "high"))
      },
      {
        id: "toggle-kiosk",
        title: kiosk ? "退出大屏模式" : "进入大屏模式",
        group: "外观",
        keywords: "kiosk fullscreen 大屏 全屏",
        shortcut: kiosk ? "Esc" : undefined,
        detail: kiosk ? "收起外壳并把字号提到 130%" : "收起顶栏，字号提到 130%",
        run: () => setKiosk(!kiosk)
      },
      {
        id: "export-usage",
        title: "导出用量快照",
        group: "动作",
        keywords: "export snapshot html 导出",
        disabled: true,
        detail: "需在「用量总览」内导出"
      }
    ];
  }, [theme, contrast, kiosk, onNavigate, onOpenSearch, onOpenSettings, setTheme]);

  return <CommandPalette open={open} actions={actions} onClose={onClose} />;
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
  const floatTransitionPending = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [revealRequest, setRevealRequest] = useState<{
    path: string;
    recordId: string | null;
    nonce: number;
  } | null>(null);

  // ⌘K / Ctrl+K 唤起命令面板。监听挂在 window：这是**全局**快捷键，焦点在输入框、
  // 下拉框里也要能开（R2 的硬约束），所以不做 target 过滤，只 preventDefault。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        // 命令行里的「全局搜索」是搜索面板的入口；两层浮层叠着没有意义。
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * 进入大屏时收起两层浮层。
   *
   * 不是为了好看：外壳（顶栏里唯一那个「设置」按钮）马上要被收起来，浮层留着
   * 就出现「开着的面板挡在收起的界面上、却找不到按钮关」的死角；而且 Esc 的第一
   * 下会先关浮层，退出大屏要多按一次。
   */
  const kioskOn = useKiosk();
  useEffect(() => {
    if (!kioskOn) return;
    setSettingsOpen(false);
    setSearchOpen(false);
    setPaletteOpen(false);
  }, [kioskOn]);

  /**
   * Esc 的归属：面板开着时归面板（它们各自处理），全都关着时才退大屏。
   * 这个先后顺序就是「Esc 不被两个功能同时抢走」的全部实现。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (searchOpen || settingsOpen || paletteOpen) return;
      if (!getKiosk()) return;
      event.preventDefault();
      setKiosk(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, settingsOpen, paletteOpen]);

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
    if (floatTransitionPending.current) return;
    const exit = bridges.custom?.exitFloatMode;
    if (!exit) return;

    floatTransitionPending.current = true;
    try {
      await exit();
      setFloating(false);
    } catch {
      // 窗口仍是浮窗时保留细头，用户可以重试；先退版式会变成「细窗 + 常规顶栏」。
    } finally {
      floatTransitionPending.current = false;
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
    if (floatTransitionPending.current) return;
    const enter = bridges.custom?.enterFloatMode;
    if (!enter) return;

    // 尺寸必须在切版式之前、命令发出之前取：它代表进入前的主窗内容区。
    const size = { width: window.innerWidth, height: window.innerHeight };
    floatTransitionPending.current = true;
    try {
      await enter(size);
      setFloating(true);
    } catch {
      // 窗口命令失败时保持常规版式；只有窗口和界面都切成功才算进入浮窗。
    } finally {
      floatTransitionPending.current = false;
    }
  }, [bridges]);
  const canExitFloatMode = floating && typeof bridges.custom?.exitFloatMode === "function";
  // 浮窗 + 监控标签 + 脉搏档：整条顶栏换成脉搏细头（R7）。其余标签、以及
  // iframe 触发浮窗时（仪表盘档）保持现状。
  const floatPulse = floating && tab === "monitor" && monitorView === "pulse";

  // 命令面板要的回调必须是稳定引用：动作表按它们记忆，每次渲染换个函数会让
  // useMemo 每帧失效，键盘高亮跟着被重置。
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openSearchFromPalette = useCallback(() => {
    setPaletteOpen(false);
    setSearchOpen(true);
  }, []);
  const openSettingsFromPalette = useCallback(() => {
    setPaletteOpen(false);
    setSettingsOpen(true);
  }, []);

  return (
    <ThemeProvider>
      <BridgesProvider bridges={bridges}>
        <NotificationProvider>
          <StartupUpdateCheck bridges={bridges} />
          <TrayHost onNavigate={setTab} />
          {/* 大屏容器：`data-kiosk` 的落点，也是真机探针的锚点。外壳的收起规则在
              AppShell.module.css——只有那里选得到顶栏自己的类名。 */}
          <KioskRoot>
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
              {/* 命令面板压在搜索之上：它会开搜索，反过来不会。 */}
              <CommandPaletteHost
                open={paletteOpen}
                onClose={closePalette}
                onNavigate={setTab}
                onOpenSearch={openSearchFromPalette}
                onOpenSettings={openSettingsFromPalette}
              />
            </div>
          </KioskRoot>
        </NotificationProvider>
      </BridgesProvider>
    </ThemeProvider>
  );
}
