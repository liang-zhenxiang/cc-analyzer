import { describe, expect, test } from "vitest";
import { installDemoBridges } from "./demoBridges";
import { DEMO_HOME } from "./demoData";

/**
 * 内存桥的职责是「像 fs，但只像到应用需要的那一层」。这些用例同时守住
 * 两条红线：目录语义与 Rust 侧一致；写入永远不落到磁盘。
 */

async function install() {
  const bridges = installDemoBridges();
  const home = await bridges.fs.homeDir();
  const projectsRoot = `${home}/.claude/projects`;
  return { bridges, home, projectsRoot };
}

describe("installDemoBridges", () => {
  test("homeDir 与 appDataDir 都指向伪造目录", async () => {
    const { bridges, home } = await install();
    expect(home).toBe(DEMO_HOME);
    expect(await bridges.fs.appDataDir()).toBe(`${DEMO_HOME}/.cc-analyzer`);
  });

  test("readDir 按前缀返回直接子项，并区分目录与文件", async () => {
    const { bridges, projectsRoot } = await install();

    const projects = await bridges.fs.readDir(projectsRoot);
    expect(projects.map((entry) => entry.name)).toEqual(["-demo-alpha", "-demo-beta"]);
    expect(projects.every((entry) => entry.is_dir && !entry.is_file)).toBe(true);

    const alpha = await bridges.fs.readDir(`${projectsRoot}/-demo-alpha`);
    const sessions = alpha.filter((entry) => entry.is_file);
    expect(sessions).toHaveLength(3);
    expect(sessions.every((entry) => entry.name.endsWith(".jsonl"))).toBe(true);
  });

  test("读取与 stat 对同一个文件给出一致的内容与字节数", async () => {
    const { bridges, projectsRoot } = await install();
    const name = (await bridges.fs.readDir(`${projectsRoot}/-demo-alpha`)).find(
      (entry) => entry.is_file
    )!.name;
    const path = `${projectsRoot}/-demo-alpha/${name}`;

    const text = await bridges.fs.readText(path);
    const stat = await bridges.fs.stat(path);
    expect(text.split("\n").length).toBeGreaterThan(3);
    expect(stat.is_file).toBe(true);
    expect(stat.size).toBe(new TextEncoder().encode(text).length);
    expect(stat.mtime_ms).toBeGreaterThan(0);
  });

  test("readHead 按字节截断且不切断多字节字符", async () => {
    const { bridges, projectsRoot } = await install();
    const name = (await bridges.fs.readDir(`${projectsRoot}/-demo-beta`)).find(
      (entry) => entry.is_file
    )!.name;
    const path = `${projectsRoot}/-demo-beta/${name}`;
    const text = await bridges.fs.readText(path);

    // 演示会话里有中文：选一个落在多字节字符中间的上限，结果不能出现替换符。
    const head = await bridges.fs.readHead(path, 37);
    expect(new TextEncoder().encode(head).length).toBeLessThanOrEqual(37);
    expect(head).not.toContain("\uFFFD");
    expect(text.startsWith(head)).toBe(true);
  });

  test("writeText 写进内存、读得回，并自动创建父目录", async () => {
    const { bridges } = await install();
    const path = `${DEMO_HOME}/.cc-analyzer/meta-cache-v3.json`;

    await bridges.fs.writeText(path, '{"entries":{}}');
    expect(await bridges.fs.readText(path)).toBe('{"entries":{}}');

    const appData = await bridges.fs.readDir(`${DEMO_HOME}/.cc-analyzer`);
    expect(appData.map((entry) => entry.name)).toContain("meta-cache-v3.json");
  });

  test("不存在的路径按真实 fs 的错误语义报错", async () => {
    const { bridges } = await install();

    await expect(bridges.fs.readText(`${DEMO_HOME}/missing.jsonl`)).rejects.toThrow(
      /No such file/
    );
    await expect(bridges.fs.readHead(`${DEMO_HOME}/missing.jsonl`, 10)).rejects.toThrow(
      /No such file/
    );
    await expect(bridges.fs.stat(`${DEMO_HOME}/missing.jsonl`)).rejects.toThrow(/No such file/);
    await expect(bridges.fs.readDir(`${DEMO_HOME}/missing`)).rejects.toThrow(/No such file/);
    // 对文件调用 readDir 在真实 fs 上也是 ENOTDIR，这里统一落到「找不到」。
    const file = `${DEMO_HOME}/.claude/projects/-demo-alpha`;
    const session = (await bridges.fs.readDir(file)).find((entry) => entry.is_file)!;
    await expect(bridges.fs.readDir(`${file}/${session.name}`)).rejects.toThrow(/No such file/);
  });

  test("外部副作用类桥在演示里全部失效", async () => {
    const { bridges } = await install();

    expect(await bridges.dialog.saveText("a.md", "x", {
      title: "t",
      filterName: "Markdown",
      extensions: ["md"]
    })).toBeNull();
    expect(await bridges.dialog.savePath("a.md", {
      title: "t",
      filterName: "Markdown",
      extensions: ["md"]
    })).toBeNull();
    expect(await bridges.dialog.openFile({
      title: "t",
      filterName: "JSONL",
      extensions: ["jsonl"]
    })).toBeNull();

    const run = await bridges.proc.runLines("rm", ["-rf", "/"], null, null, null, () => undefined);
    expect(run.ok).toBe(false);
    expect(await bridges.monitor.pingMonitor()).toBe(false);

    // 空订阅立即返回一个可调用的 unlisten。
    const unlisten = await bridges.events.onSessionImport(() => undefined);
    expect(() => unlisten()).not.toThrow();
  });
});
