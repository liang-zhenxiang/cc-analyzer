/**
 * 构造会话详情「复制 resume 命令」按钮写进剪贴板的命令串。
 *
 * 单独成模块（而不是写进组件里）是因为有两处最容易出错、也最需要独立断言：
 *
 * 1. Claude Code 按项目目录组织会话，从别的目录执行 `claude --resume <id>`
 *    未必能找到该会话。所以命令带上 `cd "<cwd>"` 前缀；`cwd` 缺失时降级为
 *    裸命令，并把 `degraded` 标出来让界面**明说**「需在该会话的项目目录下执行」，
 *    而不是静默给一条会失败的命令。
 * 2. `cwd` 与 `sessionId` 来自磁盘上的 JSONL，是我们不控制的数据。粘进 shell
 *    后，未加引号的路径可以执行任意命令。所以路径要引用、ID 要校验，保证复制
 *    出去的内容与它看起来一致。
 */

export type ResumeCommand = {
  /** 要放进剪贴板的完整字符串。 */
  text: string;
  /** 会话没有 `cwd` 时为 true：`cd` 前缀已被去掉。 */
  degraded: boolean;
};

/**
 * `sessionId` 只接受 UUID。
 *
 * 与 `api/tauri.ts` 里 `openClaudeTerminal` 在拉起终端前的校验同一形态，理由
 * 也一样：这个值是 JSONL 里的不可信字段，一旦拼进命令串，形如
 * `abc; rm -rf ~` 的 ID 就会在用户粘贴时变成一条真命令。非 UUID 一律当作
 * 「没有可用的会话 ID」处理，把按钮禁用。
 */
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 探测路径里的控制字符（换行、回车、制表、DEL 等）。
 *
 * 这些字符**引用救不了**：粘贴进终端后，双引号内的换行会被 shell 当成未闭合引号
 * 的续行，整段仍是一条命令，但 `cd` 到一个含换行的目录必然失败；若用户的终端按行
 * 送命令，换行后半段就成了第二条命令。与其赌终端行为，不如降级成不带 `cd` 的裸命令，
 * 并把「请在该会话的项目目录下执行」明示出来。
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 把一个项目目录渲染成可以安全粘进终端的引用串。
 *
 * 先把反斜杠**归一化为正斜杠**，再套双引号并转义引号内的活性字符。
 *
 * 为什么归一化：反斜杠是 Windows 路径分隔符，同时又是双引号里的转义前导。保留它时，
 * **以反斜杠结尾的路径**（如驱动器根 `C:\`）会把随后补上的收尾引号转义掉——
 * `cd "C:\"` 的引号不闭合，命令直接断掉。逐字符转义反斜杠也不行：那会把每条 Windows
 * 路径改写成 `cmd.exe` 读不懂的双反斜杠。正斜杠在 `cmd.exe`、PowerShell 与 POSIX shell
 * 里都成立，一次绕开整个难题。
 *
 * 取舍（如实记下）：macOS/Linux 上**文件名里真的含反斜杠**的目录会被改写成正斜杠，
 * 极罕见；Windows 的 UNC 根（`\\server\share`）本就不能用 `cd` 直接进入，不在覆盖范围内。
 *
 * 归一化之后路径里不再有反斜杠，双引号内需要转义的只剩三个活性字符：
 * `"`（会提前闭合引号）、`$` 与反引号（命令替换）。
 */
function quotePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return `"${normalized.replace(/["$`]/g, (char) => `\\${char}`)}"`;
}

/**
 * 返回该会话可复制的 resume 命令，无法生成时返回 `null`（界面据此禁用按钮）。
 */
export function resumeCommand(session: {
  sessionId?: string;
  cwd?: string;
}): ResumeCommand | null {
  const sessionId = session.sessionId?.trim();
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return null;

  const resume = `claude --resume ${sessionId}`;
  const cwd = session.cwd?.trim();
  if (!cwd) return { text: resume, degraded: true };

  // 控制字符无法安全引用 → 降级成裸命令（可见提示会告诉用户去项目目录执行）。
  if (CONTROL_CHARS.test(cwd)) return { text: resume, degraded: true };

  return { text: `cd ${quotePath(cwd)} && ${resume}`, degraded: false };
}
