import type { BundleEntry, BundleManifest } from "../../api/types";
import { basename, joinPath } from "../../lib/path";
import type { SessionMeta } from "../sessions/metadataCache";
import { archivePathFor, archiveRootOf, type ArchiveIndex } from "./archiveIndex";

/**
 * 加密归档包的**纯语义**：打哪些条目、导入后怎么归类、给界面读什么。
 *
 * 文件 I/O 在 `bundleStore.ts`，Rust 侧的建包 / 解包在 Issue #152 的契约里。
 * 这里一条铁律：**判定只用本机已有的索引与会话清单**，不拿包里的自我声明当
 * 事实——包可能来自另一台机器，也可能是同一份包导了第二遍。
 */

/** 导入后的三类归属。`add` 与 `keepBoth` 都要落盘，`alreadyHave` 一律跳过。 */
export type ImportPlan = {
  /** 本机没有这个 `sourcePath`：新增。 */
  add: BundleEntry[];
  /** 索引里已有同一个 `sourcePath`：幂等跳过（同一份包导入两次走这里）。 */
  alreadyHave: BundleEntry[];
  /** 同一 `sessionId` 在本机已有一版、但大小/时间不同：两份并列保留，绝不覆盖。 */
  keepBoth: BundleEntry[];
};

/** 打包失败的条目：点名 `sourcePath` 与原因，界面照原样读出来。 */
export type ImportFailure = { sourcePath: string; reason: string };

/** 给界面用的读数：四个计数 + 拼好的那一行文案。 */
export type ImportReadout = {
  added: number;
  alreadyHave: number;
  keepBoth: number;
  failed: number;
  /** 例：`新增 2 · 已存在 1 · 并列 1 · 失败 0`。 */
  text: string;
};

/**
 * 从本机归档索引里取要打包的条目。
 *
 * 按 `sourcePath` 排序输出，不只是为了好看：同一个归档在两次导出里给出**同序**
 * 的条目，包的可复现性与测试断言的稳定性都靠它。
 */
export function bundleEntriesFromIndex(index: ArchiveIndex): BundleEntry[] {
  return Object.values(index.entries)
    .map((entry) => ({
      sourcePath: entry.sourcePath,
      archivePath: entry.archivePath,
      projectLabel: entry.projectLabel,
      sessionId: entry.sessionId,
      sizeBytes: entry.sizeBytes,
      mtimeMs: entry.mtimeMs
    }))
    .sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0));
}

function identity(entry: { sessionId: string; sizeBytes: number; mtimeMs: number }) {
  return { sessionId: entry.sessionId, sizeBytes: entry.sizeBytes, mtimeMs: entry.mtimeMs };
}

type LocalVersion = { sessionId: string; sizeBytes: number; mtimeMs: number };

/**
 * 本机已知的会话版本，按 `sessionId` 归组。
 *
 * 索引是 `sessionId` 的权威来源（导入过的副本文件名可能为了避让并列而带后缀）；
 * 会话清单只补**仍在 `~/.claude` 里的活会话**——`archived: true` 的那些就是索引
 * 的投影，再算一遍只会让同一条记录出现两次。
 */
function localVersionsBySessionId(
  localIndex: ArchiveIndex,
  localSessions: readonly SessionMeta[]
): Map<string, LocalVersion[]> {
  const versions = new Map<string, LocalVersion[]>();
  const push = (key: string, value: LocalVersion) => {
    const list = versions.get(key);
    if (list) list.push(value);
    else versions.set(key, [value]);
  };

  for (const entry of Object.values(localIndex.entries)) push(entry.sessionId, identity(entry));
  for (const session of localSessions) {
    if (session.archived === true) continue;
    const sessionId = basename(session.path).replace(/\.jsonl$/i, "");
    push(sessionId, { sessionId, sizeBytes: session.sizeBytes, mtimeMs: session.mtimeMs });
  }
  return versions;
}

/**
 * 按 Issue #152 的契约做三类判定，规则**有序**且只认本机事实：
 *
 * 1. `sourcePath` 命中本机索引则归 `alreadyHave`。这一条是幂等的全部来源：同一份
 *    包导入两次，第二次的每一条都会命中第一次写下的索引键。
 * 2. 否则，本机存在同一 `sessionId` 且**大小与时间都相同**的版本则归 `alreadyHave`。
 *    内容是同一份就是同一份：再存一份只会让会话列表里出现两行时间、大小、标题
 *    全一样的记录，用户只会以为出了 bug。（「本机那份还只在 `~/.claude`、没进
 *    归档」不是留下第二份的理由——那是「立即归档」一次点击就能补上的事。）
 * 3. 同一 `sessionId` 但大小或时间**不同**则归 `keepBoth`：那是同一段会话在两台
 *    机器上各自继续跑过的两份，宁可多留不可丢。**内容不同才并列，内容相同就是
 *    同一份**——第 2 条与第 3 条的分界就在大小/时间这一对上。
 * 4. 其余（本机完全没有这个会话）归 `add`。
 */
export function planImport(
  manifest: Pick<BundleManifest, "entries">,
  localIndex: ArchiveIndex,
  localSessions: readonly SessionMeta[]
): ImportPlan {
  const plan: ImportPlan = { add: [], alreadyHave: [], keepBoth: [] };
  const locals = localVersionsBySessionId(localIndex, localSessions);

  for (const entry of manifest.entries) {
    if (localIndex.entries[entry.sourcePath]) {
      plan.alreadyHave.push(entry);
      continue;
    }
    const versions = locals.get(entry.sessionId) ?? [];
    // 大小与时间都相同 → 本机已经有同一份内容，跳过（不新增落点，也不写索引）。
    const sameContent = versions.some(
      (version) => version.sizeBytes === entry.sizeBytes && version.mtimeMs === entry.mtimeMs
    );
    if (sameContent) plan.alreadyHave.push(entry);
    else if (versions.length > 0) plan.keepBoth.push(entry);
    else plan.add.push(entry);
  }
  return plan;
}

/**
 * 计数器 → 一行读数文案。四类**永远都印**，为 0 也一样，读数才可比。
 *
 * 计数口径是**结果**而不是意图：失败的条目会从它原本那一类里扣掉，于是
 * 「新增 + 已存在 + 并列 + 失败 = 包里的总条目数」这条恒等式总成立。否则
 * 「新增 2 · 失败 1」会让读的人以为一共动了三条。
 */
export function describeImportResult(
  plan: ImportPlan,
  failures: readonly ImportFailure[]
): ImportReadout {
  const failedPaths = new Set(failures.map((failure) => failure.sourcePath));
  const added = plan.add.filter((entry) => !failedPaths.has(entry.sourcePath)).length;
  const alreadyHave = plan.alreadyHave.length;
  const keepBoth = plan.keepBoth.filter((entry) => !failedPaths.has(entry.sourcePath)).length;
  const failed = failures.length;
  return {
    added,
    alreadyHave,
    keepBoth,
    failed,
    text: `新增 ${added} · 已存在 ${alreadyHave} · 并列 ${keepBoth} · 失败 ${failed}`
  };
}

/** sourcePath 的短哈希（FNV-1a，32 位）：只用来给并列的两份起不撞的名字。 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 导入条目在本机归档目录里的落点。
 *
 * 常规沿用既有约定 `<archive>/<项目>/<会话>.jsonl`，让归档目录里的两份来源不同
 * 的会话长得和平时一样。只有当这个位置已经被**别的** `sourcePath` 占了（正是
 * 「同一会话两个版本并列保留」那一类），才补一段 sourcePath 的短哈希：并列保留
 * 的第一条要求就是两份谁也别覆盖谁。
 */
export function archivePathForImport(
  appDataDir: string,
  entry: BundleEntry,
  taken: ReadonlySet<string>
): string {
  const plain = archivePathFor(appDataDir, {
    path: entry.sourcePath,
    projectLabel: entry.projectLabel
  });
  if (!taken.has(plain)) return plain;
  return joinPath(
    archiveRootOf(appDataDir),
    entry.projectLabel,
    `${entry.sessionId}-${shortHash(entry.sourcePath)}.jsonl`
  );
}
