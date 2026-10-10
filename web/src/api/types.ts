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
  /**
   * 只弹「保存到哪」并把路径交回来，内容由调用方自己写。
   *
   * 加密归档包的内容由 Rust 侧流式写出（口令只在原生进程里用），前端拿不到
   * 明文，也就没法走 `saveText` 那条「先拿路径、再 write_text」的路子。
   */
  savePath(
    defaultName: string,
    options: { title: string; filterName: string; extensions: string[] }
  ): Promise<string | null>;
  /** 弹「打开文件」对话框并返回选中的路径；用户取消时为 null。 */
  openFile(options: { title: string; filterName: string; extensions: string[] }): Promise<string | null>;
}

/**
 * 归档包里的一条：字段与 Rust 侧 `archive_bundle` 的 JSON 线格式逐字对齐。
 *
 * `archivePath` 是**导出机器**上的副本路径，只在包里做排查线索；导入落到本机
 * 时一律按本机目录重算（两台机器路径不同，直接沿用会写歪）。
 */
export type BundleEntry = {
  sourcePath: string;
  archivePath: string;
  projectLabel: string;
  sessionId: string;
  sizeBytes: number;
  mtimeMs: number;
};

/** 包的清单：格式版本 / 导出时刻 / 应用版本 / 条目（每条带用于完整性校验的 sha256）。 */
export type BundleManifest = {
  formatVersion: number;
  exportedAt: number;
  appVersion: string;
  entries: Array<BundleEntry & { sha256: string }>;
};

/** Rust 解包后交回的一条：清单条目 + 临时目录里的明文路径。 */
export type ImportedBundleFile = {
  entry: BundleEntry;
  stagedPath: string;
};

/**
 * 加密归档包的桥（Issue #152）。三个方法都只做 I/O，**索引语义全在前端**：
 * 打哪些条目、导入后算「新增 / 已存在 / 并列」、临时文件怎么搬，都由
 * `features/archive/bundle.ts` 与 `bundleStore.ts` 决定。
 */
export interface ArchiveBundleBridge {
  /** 把选中的条目打成一个用口令加密的单文件包，写到 `outPath`。 */
  exportBundle(
    outPath: string,
    password: string,
    entries: BundleEntry[]
  ): Promise<{ entries: number; bytes: number }>;
  /** 解密并解包到 `stagingDir`，逐条校验 sha256；口令错 / 校验失败即抛错。 */
  importBundle(
    inPath: string,
    password: string,
    stagingDir: string
  ): Promise<{ manifest: BundleManifest; files: ImportedBundleFile[] }>;
  /** 清掉临时目录——里面是**明文**会话，用完必须删。 */
  removeStaging(stagingDir: string): Promise<void>;
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
  /**
   * 可选：加密归档包（Issue #152）。同样是老宿主 / 老测试可能没有的能力，
   * 取用一律走 `useArchiveBundleBridge()`，缺了就禁用按钮而不是崩界面。
   */
  archiveBundle?: ArchiveBundleBridge;
};
