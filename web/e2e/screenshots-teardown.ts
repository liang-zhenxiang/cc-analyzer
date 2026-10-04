import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "docs", "screenshots");

/**
 * 截图归档的收尾：把本次出图写进 `docs/screenshots/manifest.json`。
 *
 * 用 Playwright 的 globalTeardown 而不是某个测试的 afterAll——出图是并行的
 * （`fullyParallel`，两个引擎两个主题各在 worker 里跑），afterAll 会在别的
 * worker 还没写完时就落盘，清单会缺图。globalTeardown 在所有测试结束后**只跑一次**，
 * 此刻目录里就是本次完整产物。
 *
 * 只在 `SCREENSHOTS=1` 时工作：CI 的常规 e2e 不设置它，便不会改写仓库里的清单。
 * 清单记录生成时的 git 短 SHA——它让「这批图是哪一代」可查，正是上一轮
 * 目录里混着两代图却无人察觉的那类问题的解药。
 *
 * **工作区脏不脏也要如实记**：在带未提交改动的树里出图（PR 里重出图就是这个场景），
 * 这批图**不**对应 HEAD——只记 SHA 会让人以为它对应，而查代际恰恰是最需要它的地方。
 */
export default function globalTeardown() {
  if (!process.env.SCREENSHOTS) return;

  const files = readdirSync(OUT_DIR)
    .filter((name) => name.endsWith(".png"))
    .sort();

  // 脏的判据只看截图目录里的**图**：`git status --porcelain -- docs/screenshots`
  // 剔掉清单自身后非空，即说明这批 PNG（或其中有几张）与 HEAD 里的不一致——
  // 这正是「这批图是哪一代」要回答的问题。
  //
  // 为什么把 `manifest.json` 从判据里剔掉：它是**派生物**，`generatedAt` 每次生成都变，
  // 本身不是图；而这里要回答的是「这批 PNG 是否等于 HEAD 的 PNG」，不是「清单是否等于 HEAD」。
  // 把它算进去会在一种场景下假报 dirty：磁盘上这份（上一次生成遗留的）清单与 HEAD 不一致
  // ——例如上次出图后只提交了图、没提交清单——此时即便每张 PNG 都逐字节等于 HEAD，
  // 判据也会翻成 dirty。剔掉它，判据就只对着图说话。
  // （判决是在**写新清单之前**读的，所以本次要写出的清单不会污染本次判决；会污染的是上一次遗留的。）
  //
  // 不看整棵树：别的目录脏不脏，与「这批 PNG 是否等于 HEAD 的 PNG」无关。
  let commit = "unknown";
  let dirty = false;
  try {
    // -C 指到仓库根：globalTeardown 的 cwd 在 web/，裸跑会把相对路径解析到 web/ 下。
    // 用 execFileSync 逐参数传，路径含空格也不必自己拼引号。
    commit = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const status = execFileSync(
      "git",
      // `:(exclude)` 路径魔法把清单自身排除在外（理由见上）。
      ["-C", REPO_ROOT, "status", "--porcelain", "--", "docs/screenshots", ":(exclude)docs/screenshots/manifest.json"],
      { encoding: "utf8" }
    ).trim();
    dirty = status.length > 0;
    if (dirty) commit = `${commit}+dirty`;
  } catch {
    // 非 git 目录（例如 GitHub 的 source tarball）：无法判定代际，保留 unknown。
    commit = "unknown";
    dirty = false;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    commit,
    dirty,
    files
  };
  writeFileSync(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
