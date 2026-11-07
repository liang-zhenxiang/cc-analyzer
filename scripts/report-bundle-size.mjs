#!/usr/bin/env node
/**
 * 构建产物体积报告：按 chunk 打印原始体积、gzip 体积与是否异步。
 *
 * 这是**报告**不是门禁：任何错误（没构建、读不了文件）都只打印提示，
 * 退出码始终 0，不阻断本地流程或 CI。
 *
 * 同步 / 异步的判定：先从 `dist/index.html` 取出入口脚本与 modulepreload，
 * 再沿 chunk 里的静态 import 做一次闭包遍历。入口闭包里的都是同步加载；
 * 剩下的只能经动态 `import()` 到达（Vite 的路由级拆分正是这种形态）。
 *
 * 用法：
 *   node scripts/report-bundle-size.mjs
 *   node scripts/report-bundle-size.mjs --json
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "web", "dist");
const ASSETS = path.join(DIST, "assets");

/** 静态 import / re-export 的模块说明符（`import("./x.js")` 是动态的，不匹配）。 */
const STATIC_IMPORTS = [
  /\bfrom\s*["'](\.\/[^"']+\.js)["']/g,
  /\bimport\s*["'](\.\/[^"']+\.js)["']/g
];

function normalizeAssetPath(specifier) {
  return path.basename(specifier);
}

/** 从 index.html 里找入口模块与 modulepreload——它们是同步加载的起点。 */
function readEntryAssets() {
  let html;
  try {
    html = readFileSync(path.join(DIST, "index.html"), "utf8");
  } catch {
    return null;
  }

  const entries = new Set();
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']*\.js)["']/g,
    /<link\b[^>]*\bhref\s*=\s*["']([^"']*\.js)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      entries.add(normalizeAssetPath(match[1]));
    }
  }
  return entries;
}

/** 从同步入口出发，沿静态 import 收集整条同步闭包。 */
function collectSyncAssets(entryAssets) {
  const files = new Set(readdirSync(ASSETS).filter((name) => name.endsWith(".js")));
  const sync = new Set();
  const queue = [...entryAssets].filter((name) => files.has(name));

  while (queue.length > 0) {
    const name = queue.pop();
    if (sync.has(name)) continue;
    sync.add(name);

    let source;
    try {
      source = readFileSync(path.join(ASSETS, name), "utf8");
    } catch {
      continue;
    }
    for (const pattern of STATIC_IMPORTS) {
      for (const match of source.matchAll(pattern)) {
        const dependency = normalizeAssetPath(match[1]);
        if (files.has(dependency) && !sync.has(dependency)) queue.push(dependency);
      }
    }
  }
  return sync;
}

function measure() {
  const names = readdirSync(ASSETS)
    .filter((name) => name.endsWith(".js"))
    .sort();

  const entryAssets = readEntryAssets();
  const syncAssets = entryAssets === null ? null : collectSyncAssets(entryAssets);

  return names.map((file) => {
    const buffer = readFileSync(path.join(ASSETS, file));
    return {
      file,
      rawBytes: buffer.length,
      gzipBytes: gzipSync(buffer).length,
      // index.html 缺失时无法判定类型：如实标 null，而不是猜一个答案。
      async: syncAssets === null ? null : !syncAssets.has(file)
    };
  });
}

/* 与 Vite 构建输出的口径一致（1 kB = 1000 B），两份数字才可以直接对比。 */
function kb(bytes) {
  return (bytes / 1000).toFixed(2);
}

function printTable(chunks) {
  const totalRaw = chunks.reduce((sum, chunk) => sum + chunk.rawBytes, 0);
  const totalGzip = chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
  const nameWidth = Math.max(5, ...chunks.map((chunk) => chunk.file.length));

  console.log(
    `${"chunk".padEnd(nameWidth)}  ${"raw kB".padStart(10)}  ${"gzip kB".padStart(10)}  load`
  );
  console.log(`${"-".repeat(nameWidth)}  ${"-".repeat(10)}  ${"-".repeat(10)}  ${"-".repeat(6)}`);
  for (const chunk of chunks) {
    console.log(
      `${chunk.file.padEnd(nameWidth)}  ${kb(chunk.rawBytes).padStart(10)}  ${kb(
        chunk.gzipBytes
      ).padStart(10)}  ${chunk.async === null ? "?" : chunk.async ? "async" : "sync"}`
    );
  }
  console.log(`${"-".repeat(nameWidth)}  ${"-".repeat(10)}  ${"-".repeat(10)}  ${"-".repeat(6)}`);
  console.log(
    `${`${chunks.length} chunks`.padEnd(nameWidth)}  ${kb(totalRaw).padStart(10)}  ${kb(
      totalGzip
    ).padStart(10)}`
  );
}

try {
  const chunks = measure().sort((a, b) => b.rawBytes - a.rawBytes);

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          dist: path.relative(ROOT, DIST),
          totalRawBytes: chunks.reduce((sum, chunk) => sum + chunk.rawBytes, 0),
          totalGzipBytes: chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
          chunks
        },
        null,
        2
      )
    );
  } else {
    printTable(chunks);
  }
} catch (cause) {
  // 报告不是门禁：缺构建产物时给一句可操作的提示即可。
  console.error(`[bundle-size] ${cause instanceof Error ? cause.message : String(cause)}`);
  console.error("[bundle-size] 先运行 `npm --prefix web run build` 生成 web/dist 再重试。");
}
