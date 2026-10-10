import type { ArchiveBundleBridge, Bridges, BundleEntry } from "../../api/types";
import { joinPath } from "../../lib/path";
import { SessionRepository } from "../sessions/sessionRepository";
import { withArchivedEntry, type ArchiveEntry } from "./archiveIndex";
import { readArchiveIndex, writeArchiveIndex } from "./archiveStore";
import {
  archivePathForImport,
  bundleEntriesFromIndex,
  describeImportResult,
  planImport,
  type ImportFailure,
  type ImportPlan,
  type ImportReadout
} from "./bundle";

/**
 * 归档包的 I/O 编排：选路径、调 Rust 建包 / 解包、把临时目录里的明文搬进归档、
 * 更新索引。索引语义一行都不在这里——那是 `bundle.ts` 的活儿，这里只负责把它
 * 的判定落到文件系统上，并且**保证临时目录一定被清掉**。
 */

export type ExportOutcome = { entries: number; bytes: number };

export type ImportOutcome = {
  plan: ImportPlan;
  /** 写盘或写索引失败的条目（一条失败不阻断其余条目）。 */
  failures: ImportFailure[];
  /** 真正写进归档并入了索引的条目数（`add` + `keepBoth` 里成功的部分）。 */
  written: number;
  readout: ImportReadout;
};

const BUNDLE_FILTER = { filterName: "CC 归档包", extensions: ["ccabundle"] };

/** 缺桥就给一句能读懂的错，而不是 `undefined.exportBundle` 这种崩。 */
function requireBundle(bridges: Bridges): ArchiveBundleBridge {
  if (!bridges.archiveBundle) throw new Error("当前宿主不支持加密归档包");
  return bridges.archiveBundle;
}

/** 默认文件名带日期，用户一眼能对上「哪一天导的」；扩展名固定，双端都认它。 */
export function bundleFileName(now: Date = new Date()): string {
  return `cc-analyzer-archive-${now.toISOString().slice(0, 10)}.ccabundle`;
}

/** 临时目录名：时间戳落在名字里，失败时也还能在盘上认出是哪一次导入留下的。 */
export function importStagingDir(appDataDir: string, now: number = Date.now()): string {
  return joinPath(appDataDir, `import-staging-${now}`);
}

/** 打包用的条目 = 本机归档索引的全部条目，按 `sourcePath` 定序（见 `bundle.ts`）。 */
export async function exportEntries(bridges: Bridges): Promise<BundleEntry[]> {
  const { index } = await readArchiveIndex(bridges);
  return bundleEntriesFromIndex(index);
}

/**
 * 导出：让用户挑落点，再把索引里的条目交给 Rust 打包。
 *
 * 取消系统对话框返回 `null`——那不是失败，界面不该报错。空归档则明确拒绝：
 * 导出一个空包只会让人以为「搬过来了」，实际什么都没搬。
 */
export async function exportArchiveBundle(
  bridges: Bridges,
  password: string
): Promise<ExportOutcome | null> {
  const bundle = requireBundle(bridges);
  const entries = await exportEntries(bridges);
  if (entries.length === 0) throw new Error("本地归档为空，先归档再导出");

  const outPath = await bridges.dialog.savePath(bundleFileName(), {
    title: "导出归档包",
    ...BUNDLE_FILTER
  });
  if (outPath === null) return null;
  return bundle.exportBundle(outPath, password, entries);
}

/**
 * 导入：解包到临时目录 → 按本机事实归类 → 把要留的搬进归档 → 写回索引。
 *
 * 顺序上有两处刻意的选择：
 * - 归类用的是**解包之后**读到的本机索引与活会话清单，不是包里的自述。
 * - 临时目录在 `finally` 里无条件删除。里面是解密后的明文会话，「口令丢了也
 *   打不开」这句话在临时目录残留面前是不作数的。
 */
export async function importArchiveBundle(
  bridges: Bridges,
  password: string
): Promise<ImportOutcome | null> {
  const bundle = requireBundle(bridges);
  const inPath = await bridges.dialog.openFile({ title: "导入归档包", ...BUNDLE_FILTER });
  if (inPath === null) return null;

  const appDataDir = await bridges.fs.appDataDir();
  const stagingDir = importStagingDir(appDataDir);
  const failures: ImportFailure[] = [];
  let written = 0;

  try {
    const { manifest, files } = await bundle.importBundle(inPath, password, stagingDir);
    const stagedBySource = new Map(files.map((file) => [file.entry.sourcePath, file.stagedPath]));

    const { index } = await readArchiveIndex(bridges);
    const localSessions = await new SessionRepository(bridges).listSessions();
    const plan = planImport(manifest, index, localSessions);

    // 已占用的归档落点：既有索引里的副本路径，加上本轮已经写下的，避免同名覆盖。
    const taken = new Set(Object.values(index.entries).map((entry) => entry.archivePath));
    let next = index;

    for (const entry of [...plan.add, ...plan.keepBoth]) {
      const stagedPath = stagedBySource.get(entry.sourcePath);
      if (!stagedPath) {
        failures.push({ sourcePath: entry.sourcePath, reason: "包内缺少对应的解密文件" });
        continue;
      }
      try {
        const contents = await bridges.fs.readText(stagedPath);
        const archivePath = archivePathForImport(appDataDir, entry, taken);
        const archivedAt = Date.now();
        await bridges.fs.writeText(archivePath, contents);
        const archived: ArchiveEntry = {
          sourcePath: entry.sourcePath,
          archivePath,
          projectLabel: entry.projectLabel,
          sessionId: entry.sessionId,
          sizeBytes: entry.sizeBytes,
          mtimeMs: entry.mtimeMs,
          archivedAt
        };
        next = withArchivedEntry(next, archived);
        taken.add(archivePath);
        written += 1;
      } catch (cause) {
        failures.push({ sourcePath: entry.sourcePath, reason: String(cause) });
      }
    }

    if (written > 0) await writeArchiveIndex(bridges, next);

    return { plan, failures, written, readout: describeImportResult(plan, failures) };
  } finally {
    // 明文临时目录：无论上面走到哪一步都要删。删除失败也要吞掉——它不能盖住
    // 真正的失败原因（口令错 / 校验失败），更不该让一次成功的导入变成报错。
    try {
      await bundle.removeStaging(stagingDir);
    } catch {
      // 见上：清理失败只影响磁盘卫生，不影响本次导入的结论。
    }
  }
}
