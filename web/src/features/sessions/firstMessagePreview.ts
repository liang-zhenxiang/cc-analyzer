/**
 * 首条消息预览（I8，隐私重点）：把用户首条消息原文打码成可展示的预览。
 *
 * 脱敏发生在**生成侧**（§5 原则）：本模块是唯一把原文变成预览的地方，
 * 渲染侧拿到的永远已是脱敏文本——任何拿到原文的地方都已经晚了。
 *
 * 打码规则表（§5.1，**按顺序执行，先到先打**——前面规则吃掉的内容
 * 后面规则不再看，避免对同一段文本双重打码）：
 *
 * | # | 目标 | 替换为 |
 * | - | --- | ------ |
 * | 1 | 用户主目录 `/Users/<name>`、`/home/<name>` | `~` |
 * | 2 | 常见仓库根 `/(repo\|repos\|work\|projects?)/…` 整段长于 24 | `~/…/<末段 ≤16 字符>` |
 * | 3 | 任意绝对路径（POSIX 多级或 Windows 盘符） | `<路径>` |
 * | 4 | OpenAI/Anthropic 风格密钥 `sk-…` | `sk-…`（保留前缀，不保留长度） |
 * | 5 | GitHub token `gh[pousr]_…` | `ghp_…` |
 * | 6 | AWS key `AKIA…` | `AKIA…` |
 * | 7 | 通用长随机串（≥32 位 base64/标识符形状） | `<已隐去>` |
 * | 8 | 邮箱 | `<邮箱>` |
 * | 9 | 内网/本机 IP（10.x / 192.168.x / 172.16–31.x） | `<内网地址>` |
 * | 10 | URL 查询串（? 后 ≥12 字符） | `?…` |
 *
 * 打码之后（§5.1 11–13）：
 * 11. 折叠连续空白为一个空格；
 * 12. trim 首尾空白；
 * 13. 截断到 ≤ 80 个**码位**（Array.from 计数，emoji 不劈半），超出加 `…`。
 *
 * `redacted` = 任一规则命中过（1–10 或 11 的空白折叠）——界面可用它给
 * 预览加「已脱敏」记号。空串 / 纯空白（trim 后为空）→ null（「这条会话
 * 没有用户消息」由界面表达，模块不产占位文本）。
 */

export type MessagePreview = {
  preview: string;
  /** 任一脱敏规则命中过（含空白折叠）。 */
  redacted: boolean;
};

export const PREVIEW_MAX_CODEPOINTS = 80;

/** 规则 2 的整段长度阈值与末段保留长度（§5.1 逐字）。 */
const REPO_ROOT_MIN_LENGTH = 24;
const REPO_TAIL_MAX = 16;

/** 规则 7 的随机串最短长度。 */
const RANDOM_RUN_MIN = 32;

/** 逐条规则，按序执行。每条返回是否命中（供 redacted 聚合）。 */
const RULES: Array<(text: string) => string> = [
  // 1 用户主目录：/Users/<name> 或 /home/<name> → ~
  (text) =>
    text.replace(/\/(?:Users|home)\/[^/\s,，。)）】]+/g, "~"),
  // 2 常见仓库根：/(repo|repos|work|projects?)/ 开头的整段，长于 24 才缩
  (text) =>
    text.replace(
      new RegExp(`/(?:repo|repos|work|projects?)/[^\\s,，。)）】]+`, "g"),
      (match) => {
        if (match.length <= REPO_ROOT_MIN_LENGTH) return match;
        const tail = match.slice(match.lastIndexOf("/") + 1).slice(0, REPO_TAIL_MAX);
        return `~/…/${tail}`;
      }
    ),
  // 3 任意绝对路径：Windows 盘符或多级 POSIX 路径 → <路径>
  (text) =>
    text.replace(
      /(?:[A-Za-z]:\\|\/)(?:[^\s/]+[/\\]){2,}[^\s]+/g,
      "<路径>"
    ),
  // 4 OpenAI/Anthropic 风格密钥：保留前缀、不保留长度（长度也是信息）
  (text) => text.replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-…"),
  // 5 GitHub token（gh[pousr]_ 前缀统一显示为 ghp_…——读者只需要知道「是个 gh token」）
  (text) => text.replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "ghp_…"),
  // 6 AWS access key
  (text) => text.replace(/AKIA[0-9A-Z]{16}/g, "AKIA…"),
  // 7 通用长随机串：base64/标识符形状（含 = 结尾的 base64 padding）
  (text) =>
    text.replace(
      new RegExp(`[A-Za-z0-9+/_-]{${RANDOM_RUN_MIN},}={0,2}`, "g"),
      "<已隐去>"
    ),
  // 8 邮箱
  (text) => text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<邮箱>"),
  // 9 内网/本机 IP
  (text) =>
    text.replace(
      /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+\b/g,
      "<内网地址>"
    ),
  // 10 URL 查询串：? 后 ≥12 字符
  (text) => text.replace(/\?[^\s]{12,}/g, "?…")
];

export function firstMessagePreview(
  text: string | null,
  maxLen = PREVIEW_MAX_CODEPOINTS
): MessagePreview | null {
  if (text === null) return null;

  let working = text;
  let redacted = false;

  for (const rule of RULES) {
    const next = rule(working);
    if (next !== working) redacted = true;
    working = next;
  }

  // 11 折叠连续空白：换行、缩进都会把 80 字符的预览撑成几行碎片。
  const folded = working.replace(/\s+/g, " ");
  if (folded !== working) redacted = true;

  // 12 trim：首尾空白在折叠后只剩一个空格，去掉。
  const trimmed = folded.trim();
  // trim 后为空（原文只有路径被整段替换成纯空白、或本来就纯空白）→ null。
  if (trimmed.length === 0) return null;
  if (trimmed.length < folded.length) redacted = true;

  // 13 截断到码位边界：Array.from 按 Unicode 码点切，emoji 不劈半。
  const chars = Array.from(trimmed);
  if (chars.length <= maxLen) {
    return { preview: trimmed, redacted };
  }
  return { preview: `${chars.slice(0, maxLen).join("")}…`, redacted };
}
