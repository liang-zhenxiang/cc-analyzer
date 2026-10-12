import type { SessionRecord } from "../sessions/types";
import { stripAnsi } from "../../lib/ansi";

/**
 * 命中来自哪一类索引条目。`user` / `assistant` 是消息类（v1 就有的那一类），
 * 其余三类是工具类；浮层用它在结果里打标签，也用来源筛选器挑要搜哪几类。
 */
export type SearchSource = "user" | "assistant" | "tool-output" | "file-path" | "error";

/**
 * 单条工具类条目最多索引的字符数。
 *
 * 解析层给 `toolResult` 的上限是 5 KiB（`parseJsonl` 的 `TOOL_RESULT_LIMIT`），
 * 而一份 Bash 输出的前 2000 个字符已经覆盖命令回显、栈顶与第一段错误——真正
 * 要搜的那句话几乎总在开头，尾部多是重复行与进度噪声。超出部分既不进 haystack
 * 也不留在 text（条目对象本身才是索引的内存大头），只把 `truncated` 置真，让
 * 浮层能如实说明这条被截断过。
 *
 * 消息类不走这条：用户/助手的话本来就是短的，截断只会制造「明明在屏幕上看见
 * 却搜不到」这种最伤信任的缺陷。
 */
export const INDEX_TEXT_LIMIT = 2000;

/**
 * 一条记录的一个候选来源。
 *
 * `text` 保留原始大小写（摘要要按原样显示），`haystack` 是它的全小写副本
 * （匹配目标）。两者都已剥掉终端转义字节——ANSI 只该活在渲染层，写进索引
 * 会让「搜 `[31m`」命中一堆，也会让偏移量与正文错位。
 */
export type SourceText = {
  source: SearchSource;
  text: string;
  haystack: string;
  /** 工具类条目触到 `INDEX_TEXT_LIMIT` 被截断过。 */
  truncated?: boolean;
};

/** `toolInput` 里被当作文件路径的键（结构化取值，不扫正文）。 */
const FILE_PATH_KEYS = ["file_path", "filePath", "path"] as const;

/** 剥 ANSI 后按需截断；空白结果返回 null（没有内容就没有条目）。 */
function indexed(raw: string): { text: string } | { text: string; truncated: true } | null {
  const text = stripAnsi(raw).trim();
  if (text.length === 0) return null;
  if (text.length <= INDEX_TEXT_LIMIT) return { text };
  return { text: text.slice(0, INDEX_TEXT_LIMIT), truncated: true };
}

function sourceOf(source: SearchSource, raw: string): SourceText | null {
  const entry = indexed(raw);
  if (entry === null) return null;
  return {
    source,
    text: entry.text,
    haystack: entry.text.toLowerCase(),
    ...("truncated" in entry ? { truncated: true as const } : {})
  };
}

/**
 * 消息类条目：`user` / `assistant` 的正文。与 v1 同口径（非空才收），只多出
 * 来源标签与「先剥 ANSI 再进索引」这一步。
 *
 * 参数只要 `kind` / `text` 两个字段，所以 `searchIndex.entryOf` 那条老入口
 * （吃的是最小记录形状）也能直接复用这里，不必再抄一遍口径。
 */
export function messageSourceOf(record: { kind: string; text: string }): SourceText | null {
  if (record.kind !== "user" && record.kind !== "assistant") return null;
  const text = stripAnsi(record.text).trim();
  if (text.length === 0) return null;
  return { source: record.kind, text, haystack: text.toLowerCase() };
}

/**
 * 一条记录上能看到的文件路径：`structuredResult.filePath`（Edit / Write / Read
 * 的 toolUseResult 提取结果）在前，`toolInput` 里 `file_path` / `filePath` /
 * `path` 的字符串值在后，按首次出现去重。
 *
 * 路径**原样存储、不脱敏**：应用内搜索不出本机——索引只在内存里，不落盘、不
 * 进日志、无遥测——而把命中路径改写成 `…/src/app.ts` 只会让「为什么这条命中」
 * 无从核对。会导出/转发的那两份文档（会话报告、用量快照）另有「只出现项目目录
 * 名」的约定，那两处与本索引互不相干。
 */
export function filePathsOf(record: SessionRecord): string[] {
  const paths: string[] = [];
  const structured = record.structuredResult;
  if (
    structured !== undefined &&
    "filePath" in structured &&
    typeof structured.filePath === "string" &&
    structured.filePath.trim().length > 0
  ) {
    paths.push(structured.filePath);
  }
  const input = record.toolInput;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const fields = input as Record<string, unknown>;
    for (const key of FILE_PATH_KEYS) {
      const candidate = fields[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) paths.push(candidate);
    }
  }
  return [...new Set(paths)];
}

/** 工具输出正文，`structuredResult` 里的 stdout / stderr 只作兜底。 */
function toolOutputOf(record: SessionRecord): string {
  const result = record.toolResult ?? "";
  if (result.trim().length > 0) return result;
  const structured = record.structuredResult;
  if (structured !== undefined && structured.toolName === "Bash") {
    return [structured.stdout, structured.stderr]
      .filter((part) => part.trim().length > 0)
      .join("\n");
  }
  return "";
}

/**
 * 工具类条目三选一，出错优先：
 * - `isError === true` 且拿得到输出正文 → `error`（与 `tool-output` 互斥，
 *   同一段文本不会以两种身份各出现一次）；
 * - 否则有文件路径 → `file-path`（多路径合成一条，换行分隔的 haystack）；
 * - 否则有输出 → `tool-output`。
 *
 * 出错优先是刻意的取舍：错误正文在日志里只出现这一次（路径往往在本会话的
 * 其它记录里还有），把它让给路径等于让「搜错误信息」永远搜不到失败的调用。
 */
function toolSourceOf(record: SessionRecord): SourceText | null {
  if (record.kind !== "tool") return null;
  const output = toolOutputOf(record);
  if (record.isError) {
    const error = sourceOf("error", output);
    if (error !== null) return error;
  }
  const paths = filePathsOf(record);
  if (paths.length > 0) {
    const filePath = sourceOf("file-path", paths.join("\n"));
    if (filePath !== null) return filePath;
  }
  if (record.isError) return null;
  return sourceOf("tool-output", output);
}

/**
 * 一条记录 → 若干来源条目，**最多两个**：消息一条（user / assistant）加工具类
 * 一条（`file-path` / `error` / `tool-output` 三选一）。
 *
 * 返回顺序就是去重优先级：消息在前、工具类在后，`searchEntries` 对同一记录
 * 同一查询只留先命中的那条（「原文优先、路径次之、大段输出最后」）。
 */
export function sourcesOfRecord(record: SessionRecord): SourceText[] {
  const sources: SourceText[] = [];
  const message = messageSourceOf(record);
  if (message !== null) sources.push(message);
  const tool = toolSourceOf(record);
  if (tool !== null) sources.push(tool);
  return sources;
}
