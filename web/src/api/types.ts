export type DirEntry = {
  name: string;
  is_dir: boolean;
  is_file: boolean;
};

export type StatInfo = {
  is_file: boolean;
  size: number;
  mtime_ms: number;
};

export type RunLinesResult = {
  ok: boolean;
  error?: string;
  stderr: string;
};

export type ExecTextResult = {
  ok: boolean;
  out: string;
  error?: string;
};

export type RunLinesOptions = {
  streamId: string;
  cmd: string;
  args: string[];
  stdinText?: string | null;
  timeoutMs?: number | null;
  label?: string | null;
};

export interface FsBridge {
  readDir(path: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string>;
  readHead(path: string, maxBytes: number): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  stat(path: string): Promise<StatInfo>;
  homeDir(): Promise<string>;
  appDataDir(): Promise<string>;
}

export type Unlisten = () => void;

export interface ProcBridge {
  runLines(
    cmd: string,
    args: string[],
    stdinText: string | null,
    timeoutMs: number | null,
    label: string | null,
    onLine: (line: string) => void,
    onStreamId?: (streamId: string) => void
  ): Promise<RunLinesResult>;
  cancelLines?(streamId: string): Promise<boolean>;
  execText(cmd: string, args: string[]): Promise<ExecTextResult>;
  spawnDetached(exe: string, args: string[], cwd?: string): Promise<void>;
}

export interface SystemService {
  openFolder(path: string): Promise<void>;
  openClaudeTerminal(sessionId: string): Promise<void>;
}

export interface ClipboardService {
  writeText(text: string): Promise<void>;
}

export interface DialogBridge {
  /**
   * Generic "save text to a file the user picks". Markdown reports and session
   * exports are the same operation with a different title and extension, so
   * they share one path instead of each growing a copy of the dialog call.
   */
  saveText(
    defaultName: string,
    contents: string,
    options: { title: string; filterName: string; extensions: string[] }
  ): Promise<string | null>;
  saveMarkdown(defaultName: string, contents: string): Promise<string | null>;
}

export interface EventsBridge {
  onSessionImport(handler: (path: string) => void): Promise<Unlisten>;
  /**
   * 托盘菜单点了「用量总览」时 Rust 发来的 `tray:navigate`。web 侧只负责切标签。
   * 可选：老宿主 / 老测试构造的 Bridges 可能没有它，调用点一律走可选链。
   */
  onTrayNavigate?(handler: (target: string) => void): Promise<Unlisten>;
}

export interface MonitorBridge {
  monitorPort(): Promise<number>;
  pingMonitor(): Promise<boolean>;
}

/** One update check's outcome; `install` only exists when an update is pending. */
export type UpdateCheck =
  | { available: false; currentVersion: string }
  | {
      available: true;
      currentVersion: string;
      version: string;
      notes: string | null;
      /** 下载并安装（含签名校验）；完成后再由 relaunch 重启。 */
      install: () => Promise<void>;
    };

export interface UpdaterBridge {
  appVersion(): Promise<string>;
  checkUpdates(channel: string): Promise<UpdateCheck>;
  relaunch(): Promise<void>;
}

export interface CustomBridge {
  enterFloatMode(): Promise<void>;
  exitFloatMode?(): Promise<void>;
}

/**
 * 托盘读数：数字全部在 web 侧算好再推给 Rust，Rust 只负责排版。
 * 见 Issue #150 的契约——Rust 不做任何窗口/百分比计算，否则就是第二套口径。
 */
export type TrayReadout = {
  /** 5 小时计费窗口；没有任何活动时为 null。 */
  block: {
    usedTokens: number;
    /** 没设预算就是 null——没有分母就没有比率，绝不填 0。 */
    percent: number | null;
    startsAt: number;
    endsAt: number;
  } | null;
  /** 滚动 7 天窗口。 */
  weekly: {
    usedTokens: number;
    percent: number | null;
    /** 实际口径的窗口天数（7）。 */
    days: number;
  };
  /** 读数生成时刻：托盘要如实标注「数据时间」。 */
  computedAt: number;
  /** 本次读数里是否含估算/推算（provenance 语言，与页面上一致）。 */
  hasEstimate: boolean;
};

export interface TrayBridge {
  /** `null` 表示还没有读数（托盘显示「尚未计算」）。 */
  updateReadout(readout: TrayReadout | null): Promise<void>;
  /** 设置里「常驻读数 → 显示用量读数」的开关。 */
  setVisible(visible: boolean): Promise<void>;
}

export type Bridges = {
  fs: FsBridge;
  proc: ProcBridge;
  system: SystemService;
  clipboard: ClipboardService;
  dialog: DialogBridge;
  events: EventsBridge;
  monitor: MonitorBridge;
  updater: UpdaterBridge;
  custom?: CustomBridge;
  /**
   * 可选：仅桌面宿主提供。老测试构造的假 bridge 没有它，调用点必须走可选链，
   * 否则一个旁路能力就能把界面带崩。
   */
  tray?: TrayBridge;
};
