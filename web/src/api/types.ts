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
  saveMarkdown(defaultName: string, contents: string): Promise<string | null>;
}

export interface EventsBridge {
  onSessionImport(handler: (path: string) => void): Promise<Unlisten>;
}

export interface MonitorBridge {
  monitorPort(): Promise<number>;
  pingMonitor(): Promise<boolean>;
}

export interface CustomBridge {
  enterFloatMode(): Promise<void>;
  exitFloatMode?(): Promise<void>;
}

export type Bridges = {
  fs: FsBridge;
  proc: ProcBridge;
  system: SystemService;
  clipboard: ClipboardService;
  dialog: DialogBridge;
  events: EventsBridge;
  monitor: MonitorBridge;
  custom?: CustomBridge;
};
