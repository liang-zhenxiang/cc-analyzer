/**
 * 在**真实边界**上打桩：注入 `window.__TAURI_INTERNALS__`。
 *
 * `@tauri-apps/api` 的 `invoke()` 最终就是 `window.__TAURI_INTERNALS__.invoke(...)`，
 * `listen()` 则走 `plugin:event|listen`。所以只要提供这一层，
 * **应用代码一行都不用改**，测的就是真实的生产构建产物——
 * 不需要为测试单独出一份 bundle，也不会把测试代码带进发布包。
 *
 * 相比「换掉 bridges 实现」，这样打桩还顺带覆盖了 `web/src/api/tauri.ts`
 * 本身：命令名拼错、参数名写错，测试同样会发现。
 */

export type MockScenario = {
  /** 家目录；会话从 `<home>/.claude/projects/` 下发现 */
  home: string;
  /** 应用数据目录（元数据缓存写在这里） */
  appData: string;
  /** 虚拟文件：绝对路径 → 内容 */
  files: Record<string, string>;
  /** 显式声明的空目录（只靠 files 推导不出来） */
  emptyDirs?: string[];
  /** 实时监控：端口与是否可达 */
  monitor?: { port: number; alive: boolean };
  /** `run_lines` 调用 `claude` 时逐行吐出的内容 */
  claudeStdout?: string[];
  /** `run_lines` 的返回；默认成功 */
  claudeResult?: { ok: boolean; error?: string; stderr?: string };
  /** `plugin:dialog|save` 返回的路径；null 表示用户取消 */
  savePath?: string | null;
};

/** 这个函数体在浏览器里运行，因此必须自包含（不能引用外部作用域） */
export function installTauriMock(scenario: MockScenario): void {
  const norm = (p: string) => (p.replace(/\/+$/, "") === "" ? "/" : p.replace(/\/+$/, ""));
  const parentOf = (p: string) => {
    const n = norm(p);
    const i = n.lastIndexOf("/");
    return i <= 0 ? "/" : n.slice(0, i);
  };
  const baseOf = (p: string) => {
    const n = norm(p);
    return n.slice(n.lastIndexOf("/") + 1);
  };

  const files: Record<string, string> = Object.assign({}, scenario.files);
  const emptyDirs = new Set((scenario.emptyDirs ?? []).map(norm));
  const log: Array<{ op: string; args: unknown[] }> = [];
  const listeners = new Map<string, number[]>();

  (window as unknown as Record<string, unknown>).__CCA_E2E_LOG__ = log;
  const record = (op: string, ...args: unknown[]) => {
    log.push({ op, args });
  };

  let callbackSeq = 0;
  const internals = {
    transformCallback(cb: (payload: unknown) => void, once?: boolean) {
      const id = ++callbackSeq;
      (window as unknown as Record<string, unknown>)[`_${id}`] = (payload: unknown) => {
        cb(payload);
        if (once) delete (window as unknown as Record<string, unknown>)[`_${id}`];
      };
      return id;
    },
    unregisterCallback(id: number) {
      delete (window as unknown as Record<string, unknown>)[`_${id}`];
    },
    async invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
      record(cmd, args);
      const a = args as Record<string, never> & Record<string, unknown>;

      const readFile = (path: string): string => {
        const key = norm(String(path));
        const content = files[key];
        if (content === undefined) {
          throw new Error(`E2E 虚拟文件系统：文件不存在 ${key}`);
        }
        return content;
      };

      switch (cmd) {
        case "home_dir":
          return scenario.home;
        case "app_data_dir":
          return scenario.appData;
        case "read_text":
          return readFile(a.path as unknown as string);
        case "read_head": {
          const max = Number(a.maxBytes ?? 0);
          return readFile(a.path as unknown as string).slice(0, max);
        }
        case "write_text":
          files[norm(String(a.path))] = String(a.contents);
          return null;
        case "stat": {
          const content = readFile(a.path as unknown as string);
          return { is_file: true, size: content.length, mtime_ms: 1_700_000_000_000 };
        }
        case "read_dir": {
          const dir = norm(String(a.path));
          const prefix = dir === "/" ? "/" : `${dir}/`;
          const out: Array<{ name: string; is_dir: boolean; is_file: boolean }> = [];
          const seen = new Set<string>();
          for (const file of Object.keys(files)) {
            if (!file.startsWith(prefix)) continue;
            const rest = file.slice(prefix.length);
            if (rest === "") continue;
            const slash = rest.indexOf("/");
            const name = slash === -1 ? rest : rest.slice(0, slash);
            if (seen.has(name)) continue;
            seen.add(name);
            out.push({ name, is_dir: slash !== -1, is_file: slash === -1 });
          }
          for (const declared of emptyDirs) {
            if (parentOf(declared) !== dir) continue;
            const name = baseOf(declared);
            if (seen.has(name)) continue;
            seen.add(name);
            out.push({ name, is_dir: true, is_file: false });
          }
          if (out.length === 0 && !emptyDirs.has(dir)) {
            const known =
              Object.keys(files).some((f) => f.startsWith(prefix)) ||
              Array.from(emptyDirs).some((d) => d.startsWith(prefix));
            if (!known) {
              throw new Error(
                `E2E 虚拟文件系统：readDir 遇到未声明的路径 ${dir}。` +
                  `请在夹具里声明它——静默返回空数组会把夹具错误伪装成功能缺陷。`
              );
            }
          }
          return out.sort((x, y) => x.name.localeCompare(y.name));
        }
        case "run_lines": {
          // `listen()` 是通过 plugin:event|listen 注册的：回调存在 window['_<id>'] 上。
          // 这里直接投递给 `proc:line:<streamId>` 的订阅者，不绕 DOM 事件。
          const streamId = String(a.streamId);
          const eventName = `proc:line:${streamId}`;
          const emit = (line: string) => {
            for (const id of listeners.get(eventName) ?? []) {
              const fn = (window as unknown as Record<string, unknown>)[`_${id}`];
              if (typeof fn === "function") {
                (fn as (e: unknown) => void)({ event: eventName, id, payload: line });
              }
            }
          };
          for (const line of scenario.claudeStdout ?? []) emit(line);
          const result = scenario.claudeResult ?? { ok: true, stderr: "" };
          return { ok: result.ok, error: result.error, stderr: result.stderr ?? "" };
        }
        case "cancel_lines":
          return true;
        case "exec_text":
          return { ok: true, out: "" };
        case "spawn_detached":
          return null;
        case "monitor_port":
          return scenario.monitor?.port ?? 0;
        case "monitor_ping":
          return scenario.monitor?.alive ?? false;
        case "plugin:dialog|save":
          return scenario.savePath ?? null;
        case "plugin:float|enter":
        case "plugin:float|exit":
          return null;
        case "plugin:event|listen": {
          const event = String(a.event);
          const handlerId = Number(a.handler);
          const list = listeners.get(event) ?? [];
          list.push(handlerId);
          listeners.set(event, list);
          return handlerId;
        }
        case "plugin:event|unlisten": {
          const event = String(a.event);
          const id = Number(a.eventId);
          const list = listeners.get(event) ?? [];
          listeners.set(
            event,
            list.filter((x) => x !== id)
          );
          return null;
        }
        default:
          throw new Error(`E2E mock 未实现的命令：${cmd}`);
      }
    }
  };

  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals;
}
