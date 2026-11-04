/**
 * 演示模式的内存桥。
 *
 * 原则只有一条：**演示期间绝不碰真实磁盘**。所以这里完全不 import
 * `api/tauri.ts`，所有 fs 调用都落在一张内存表上；导出对话框一律取消、
 * 系统「打开文件夹」是空操作——演示可以看起来像真的，但不能造成真后果。
 *
 * 目录/文件语义尽量对齐 Rust 侧（`src-tauri/src/lib.rs`）：`read_dir` 只返回
 * 直接子项并按名称排序，`read_head` 按**字节**截断且不切断 UTF-8 字符，
 * 写入时自动创建父目录，不存在的路径按 `No such file` 报错。
 */
import type {
  Bridges,
  DirEntry,
  FsBridge,
  RunLinesResult,
  StatInfo,
  Unlisten
} from "../api/types";
import { DEMO_HOME, demoFileEntries } from "./demoData";

const APP_DATA_DIR = `${DEMO_HOME}/.cc-analyzer`;
const MONITOR_PORT = 8090;

/** 演示宿主报告的版本：带 `-demo` 后缀，顶栏徽章会明确标成先行/演示。 */
const DEMO_VERSION = "0.0.0-demo";

/**
 * 统一成 POSIX 绝对路径：演示数据只有这一种形态。真实桥里 `joinPath` 会按
 * 基路径挑分隔符，而这里的 `DEMO_HOME` 永远是 `/demo-home`，所以不需要处理
 * Windows 盘符——真处理反而会在演示里造出一条真实盘符路径。
 */
function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split(/[\\/]+/)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/** 与 Rust 的 `string_from_head` 同口径：按字节截断，再从尾部回退到 UTF-8 边界。 */
function decodeHead(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = Math.max(0, Math.floor(maxBytes));
  while (end > 0) {
    try {
      return decoder.decode(bytes.slice(0, end));
    } catch {
      // 截断点落在一个多字节字符中间：回退一字节再试，最多 3 次。
      end -= 1;
    }
  }
  return "";
}

function notFound(path: string): Error {
  // 与 Rust `io::Error` 的文案保持同一个特征串：上层（归档索引、会话扫描）
  // 用 `/no such file/i` 区分「首次运行」和「文件坏了」，演示必须能被同样识别。
  return new Error(`No such file or directory (os error 2): ${path}`);
}

type MemoryFs = {
  files: Map<string, string>;
  dirs: Set<string>;
  mtimes: Map<string, number>;
};

function createMemoryFs(): MemoryFs {
  const files = new Map<string, string>();
  const mtimes = new Map<string, number>();
  const dirs = new Set<string>();

  const addDir = (path: string) => {
    let current = normalizePath(path);
    while (current !== "/" && !dirs.has(current)) {
      dirs.add(current);
      const parent = current.slice(0, current.lastIndexOf("/"));
      if (!parent) break;
      current = parent;
    }
  };

  addDir(DEMO_HOME);
  addDir(APP_DATA_DIR);

  for (const entry of demoFileEntries()) {
    const path = normalizePath(entry.path);
    files.set(path, entry.contents);
    mtimes.set(path, entry.mtimeMs);
    addDir(path.slice(0, path.lastIndexOf("/")));
  }

  return { files, dirs, mtimes };
}

function createFsBridge(fs: MemoryFs): FsBridge {
  const writeText = async (rawPath: string, contents: string): Promise<void> => {
    const path = normalizePath(rawPath);
    fs.files.set(path, contents);
    fs.mtimes.set(path, Date.now());
    let parent = path.slice(0, path.lastIndexOf("/"));
    while (parent && !fs.dirs.has(parent)) {
      fs.dirs.add(parent);
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
  };

  return {
    readDir: async (rawPath: string): Promise<DirEntry[]> => {
      const path = normalizePath(rawPath);
      if (!fs.dirs.has(path)) throw notFound(path);

      const prefix = path === "/" ? "/" : `${path}/`;
      const children = new Map<string, DirEntry>();
      const collect = (candidate: string, isDir: boolean) => {
        if (!candidate.startsWith(prefix) || candidate === path) return;
        const rest = candidate.slice(prefix.length);
        if (!rest || rest.includes("/")) return;
        children.set(rest, { name: rest, is_dir: isDir, is_file: !isDir });
      };

      for (const dir of fs.dirs) collect(dir, true);
      for (const file of fs.files.keys()) collect(file, false);

      // 真实 `read_dir` 按名称排序（Rust 侧显式 sort），这里照做以免两套行为
      // 在测试里出现「目录顺序碰巧对上」的假阳性。
      return [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    readText: async (rawPath: string): Promise<string> => {
      const path = normalizePath(rawPath);
      const contents = fs.files.get(path);
      if (contents === undefined) throw notFound(path);
      return contents;
    },

    readHead: async (rawPath: string, maxBytes: number): Promise<string> => {
      const path = normalizePath(rawPath);
      const contents = fs.files.get(path);
      if (contents === undefined) throw notFound(path);
      return decodeHead(contents, maxBytes);
    },

    writeText,

    stat: async (rawPath: string): Promise<StatInfo> => {
      const path = normalizePath(rawPath);
      const contents = fs.files.get(path);
      if (contents !== undefined) {
        return {
          is_file: true,
          // 字节数而不是字符数：中文占 3 字节，真实 stat 报的也是字节。
          size: new TextEncoder().encode(contents).length,
          mtime_ms: fs.mtimes.get(path) ?? 0
        };
      }
      if (fs.dirs.has(path)) return { is_file: false, size: 0, mtime_ms: 0 };
      throw notFound(path);
    },

    homeDir: async () => DEMO_HOME,
    appDataDir: async () => APP_DATA_DIR
  };
}

/** 空订阅：演示模式没有真实的托盘 / 文件导入事件。 */
function noopUnlisten(): Promise<Unlisten> {
  return Promise.resolve(() => undefined);
}

/**
 * 安装一套完整的演示桥。每次调用都新建一份内存文件系统，因此切进演示、
 * 退出、再切回来不会串数据（`App` 还会用 key remount 外壳再加一层保险）。
 */
export function installDemoBridges(): Bridges {
  const fs = createMemoryFs();

  return {
    fs: createFsBridge(fs),

    // 演示不执行任何外部进程：产生 AI 报告、探测 CLI 这类动作在这里明确失败，
    // 而不是悄悄跑一条真实命令。
    proc: {
      runLines: async (): Promise<RunLinesResult> => ({
        ok: false,
        error: "演示模式不执行外部命令",
        stderr: ""
      }),
      cancelLines: async () => false,
      execText: async () => ({ ok: false, out: "", error: "演示模式不执行外部命令" }),
      spawnDetached: async () => undefined
    },

    // 「打开文件夹 / 打开终端」在演示里是空操作：路径不是真的，系统也不该被调用。
    system: {
      openFolder: async () => undefined,
      openClaudeTerminal: async () => undefined
    },

    clipboard: {
      writeText: async (text: string) => {
        // 复制版本号 / 分享卡文案是纯前端动作，不涉及会话数据，允许照常工作。
        try {
          await navigator.clipboard?.writeText(text);
        } catch {
          // 剪贴板不可用时静默失败：它不该打断演示。
        }
      }
    },

    // 所有导出 / 打开文件对话框都按「用户取消」处理：演示不写磁盘。
    dialog: {
      savePath: async () => null,
      saveText: async () => null,
      saveMarkdown: async () => null,
      openFile: async () => null
    },

    events: {
      onSessionImport: noopUnlisten,
      onTrayNavigate: noopUnlisten
    },

    monitor: {
      // 端口与 Rust 常量一致，但 ping 恒为 false：演示不假装本机跑着监控服务。
      monitorPort: async () => MONITOR_PORT,
      pingMonitor: async () => false
    },

    updater: {
      appVersion: async () => DEMO_VERSION,
      checkUpdates: async () => ({ available: false, currentVersion: DEMO_VERSION }),
      relaunch: async () => undefined
    }

    // tray / custom / archiveBundle 有意留空：
    // - tray 是原生菜单栏能力，演示没有窗口级副作用可做；
    // - custom 会改真实窗口尺寸；
    // - archiveBundle 需要原生加密与磁盘写入。
    // 三者都走既有可选链，缺了只会禁用入口，不会崩界面。
  };
}
