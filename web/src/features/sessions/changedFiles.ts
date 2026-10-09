import type { ParsedSession, SessionRecord } from "./types";

/**
 * 一个文件在本会话内的活动汇总（成功调用才计数，失败调用不冒充改动）。
 * 契约见任务 design §1.1；口径（哪些工具算「改动」）写在 ChangedFilesView 的
 * 常显脚注里——两层必须说同一套话。
 */
export type FileActivity = {
  /** 完整路径（悬停 title 用）；列表显示用 relPath。 */
  path: string;
  /** 会话 cwd 内 → 相对路径；否则原路径。显示层直接吃它。 */
  relPath: string;
  /** 成功 Read。 */
  reads: number;
  /** 成功 Edit / NotebookEdit。 */
  edits: number;
  /** 成功 Write。 */
  writes: number;
  /** 任一成功 Write 的 created 标记为 true（toolUseResult.type === "create"）。 */
  createdNew: boolean;
  /** 首次任一活动（含 Read、含失败调用）的时间戳。 */
  firstAt: number;
  /** 末次任一活动（含失败调用）的时间戳。 */
  lastAt: number;
  /**
   * 涉及记录的 fullId（含失败调用的——下钻列表要能看到失败现场），按时间正序
   * 排列（展开区的叙事序，视图不再重排）。
   */
  recordIds: string[];
  /** 子 agent 发起的成功调用数（徽标用，N1 同款）。 */
  sidechainCount: number;
};

/** 参与聚合的工具与其路径来源（Bash 不参与：间接写文件两类数据源都看不见）。 */
const EDIT_TOOLS = new Set(["Edit", "NotebookEdit"]);
const READ_TOOL = "Read";
const WRITE_TOOL = "Write";

/** `toolInput` 在磁盘边界那边是 unknown：每个字段单独收窄，不整块断言。 */
function toolInputPath(record: SessionRecord): string | null {
  const input = record.toolInput;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const candidate = value.file_path ?? value.notebook_path;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

/**
 * 双源取径（design §1.1）：优先 `structuredResult.filePath`（toolUseResult 提取），
 * 缺失时兜底 `toolInput`——被中断的调用没有结果结构，但路径在输入里。
 * structuredResult 里读出来的是空串时同样兜底（提取器对缺字段给 ""）。
 */
function pathOf(record: SessionRecord): string | null {
  const structured = record.structuredResult;
  if (
    structured !== undefined &&
    "filePath" in structured &&
    typeof structured.filePath === "string" &&
    structured.filePath.length > 0
  ) {
    return structured.filePath;
  }
  return toolInputPath(record);
}

/** 会话 cwd 内 → 剥掉前缀（含分隔符）；否则原样（隐私约定：全路径只进 title）。 */
export function toRelativePath(path: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd.length === 0) return path;
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * 按文件聚合本会话的 Read / Edit / Write / NotebookEdit 调用（A 方案：tool_use
 * 聚合，语义「通过文件工具动过」，覆盖 100% 历史会话）。
 *
 * 规则（design §1.1 的三项裁决）：
 * - 失败调用（isError）不计入 counts，但 recordId 保留——「试了没改成」也是事实；
 * - firstAt / lastAt 含失败调用（失败也是接触该文件的事实）；
 * - 含 sidechain（子 agent 的 Edit/Write 是真实改动），成功者计入 sidechainCount。
 */
export function extractFileActivities(parsed: ParsedSession): FileActivity[] {
  const byPath = new Map<
    string,
    {
      path: string;
      reads: number;
      edits: number;
      writes: number;
      createdNew: boolean;
      firstAt: number;
      lastAt: number;
      records: SessionRecord[];
      sidechainCount: number;
    }
  >();

  // records 与 sidechainMessages 各自按时间有序；这里逐条落账，recordIds 在
  // 最后统一按时间正序排，两个来源的记录才会交错回真实时间线。
  for (const record of [...parsed.records, ...parsed.sidechainMessages]) {
    if (record.kind !== "tool" || record.toolName === undefined) continue;
    const tool = record.toolName;
    const isEdit = EDIT_TOOLS.has(tool);
    const isRead = tool === READ_TOOL;
    const isWrite = tool === WRITE_TOOL;
    if (!isEdit && !isRead && !isWrite) continue;

    const path = pathOf(record);
    if (path === null) continue;

    let entry = byPath.get(path);
    if (entry === undefined) {
      entry = {
        path,
        reads: 0,
        edits: 0,
        writes: 0,
        createdNew: false,
        firstAt: record.timestamp,
        lastAt: record.timestamp,
        records: [],
        sidechainCount: 0
      };
      byPath.set(path, entry);
    }

    entry.firstAt = Math.min(entry.firstAt, record.timestamp);
    entry.lastAt = Math.max(entry.lastAt, record.timestamp);
    entry.records.push(record);

    if (record.isError) continue;
    if (isRead) entry.reads += 1;
    else if (isEdit) entry.edits += 1;
    else {
      entry.writes += 1;
      if (
        record.structuredResult !== undefined &&
        record.structuredResult.toolName === "Write" &&
        record.structuredResult.created === true
      ) {
        entry.createdNew = true;
      }
    }
    if (record.isSidechain === true) entry.sidechainCount += 1;
  }

  const activities: FileActivity[] = [];
  for (const entry of byPath.values()) {
    const sortedRecords = [...entry.records].sort(
      (a, b) => a.timestamp - b.timestamp || (a.fullId < b.fullId ? -1 : 1)
    );
    activities.push({
      path: entry.path,
      relPath: toRelativePath(entry.path, parsed.cwd),
      reads: entry.reads,
      edits: entry.edits,
      writes: entry.writes,
      createdNew: entry.createdNew,
      firstAt: entry.firstAt,
      lastAt: entry.lastAt,
      recordIds: sortedRecords.map((record) => record.fullId),
      sidechainCount: entry.sidechainCount
    });
  }

  // 最近动过的在最上（入口按最近）；同刻按路径稳定排序。
  activities.sort((a, b) => b.lastAt - a.lastAt || (a.path < b.path ? -1 : 1));
  return activities;
}
