import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThresholdsPanel } from "./ThresholdsPanel";
import { BridgesProvider } from "../../api/bridges";
import { NotificationProvider } from "../../app/NotificationProvider";
import type { Bridges, BundleEntry, BundleManifest } from "../../api/types";
import { getArchiveTask, resetArchiveTask } from "../archive/archiveTask";
import { getPlan, setPlan } from "../usage/planLimits";
import { getThresholds, resetThresholds, setThreshold } from "./thresholds";
import { resetFontScaleForTest } from "./fontScale";

type BridgeOptions = {
  /** Source transcripts keyed by file name, as the fake ~/.claude scan sees them. */
  sourceFiles?: Record<string, string>;
  /** Optional gate so a test can observe the run while it is in flight. */
  holdSourceRead?: () => Promise<void>;
  writeFails?: Error;
  /** 预置在「盘上」的文件（按绝对路径）——归档索引、临时目录里的明文副本等。 */
  preWritten?: Record<string, string>;
  /** `import_archive_bundle` 的返回。 */
  importResult?: {
    manifest: BundleManifest;
    files: Array<{ entry: BundleEntry; stagedPath: string }>;
  };
  /** 让导入解包抛错（口令错）。 */
  importError?: Error;
  /** `export_archive_bundle` 的返回。 */
  exportResult?: { entries: number; bytes: number };
  savePath?: string | null;
  openPath?: string | null;
};

/** 归档要用的 fs 面：会话扫描 + 备份副本 + 索引读写，全部走假桥。 */
function createBridges(options: BridgeOptions = {}) {
  const sourceFiles = options.sourceFiles ?? {};
  const written: Record<string, string> = { ...options.preWritten };
  const fs = {
    appDataDir: vi.fn(async () => "/app-data"),
    homeDir: vi.fn(async () => "/home/tester"),
    readDir: vi.fn(async (path: string) =>
      path.endsWith("projects")
        ? [{ name: "-repo-demo", is_dir: true, is_file: false }]
        : Object.keys(sourceFiles).map((name) => ({ name, is_dir: false, is_file: true }))
    ),
    readHead: vi.fn(async () => ""),
    stat: vi.fn(async () => ({ is_file: true, size: 5, mtime_ms: 1000 })),
    readText: vi.fn(async (path: string) => {
      const name = path.split("/").pop() ?? "";
      if (name in sourceFiles) {
        if (options.holdSourceRead) await options.holdSourceRead();
        return sourceFiles[name];
      }
      if (path in written) return written[path];
      throw new Error(`no such file or directory: ${path}`);
    }),
    writeText: vi.fn(async (path: string, contents: string) => {
      if (options.writeFails) throw options.writeFails;
      written[path] = contents;
    })
  };
  const archiveBundle = {
    exportBundle: vi.fn(async () => options.exportResult ?? { entries: 0, bytes: 0 }),
    importBundle: vi.fn(async () => {
      if (options.importError) throw options.importError;
      if (!options.importResult) throw new Error("测试没有配置 importResult");
      return options.importResult;
    }),
    removeStaging: vi.fn(async () => undefined)
  };
  const bridges = {
    fs,
    dialog: {
      savePath: vi.fn(async () => options.savePath ?? null),
      openFile: vi.fn(async () => options.openPath ?? null),
      saveText: vi.fn(async () => null),
      saveMarkdown: vi.fn(async () => null)
    },
    archiveBundle,
    updater: {
      appVersion: async () => "0.0.0-test",
      checkUpdates: async () => ({ available: false, currentVersion: "0.0.0-test" }),
      relaunch: async () => undefined
    }
  } as unknown as Bridges;
  return { bridges, written, archiveBundle };
}

function renderPanel(bridges: Bridges) {
  return render(
    <NotificationProvider>
      <BridgesProvider bridges={bridges}>
        <ThresholdsPanel onClose={() => undefined} />
      </BridgesProvider>
    </NotificationProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  resetThresholds();
  resetArchiveTask();
  localStorage.clear();
});

describe("ThresholdsPanel", () => {
  test("shows every budget with its current value and unit", () => {
    renderPanel(createBridges().bridges);

    expect(screen.getByRole("heading", { name: "阈值设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("Prompt 上限")).toHaveValue(96);
    expect(screen.getByLabelText("记录明细行数")).toHaveValue(300);
    expect(screen.getByLabelText("最慢工具条数")).toHaveValue(10);
    expect(screen.getByLabelText("子 agent 条数")).toHaveValue(30);
    expect(screen.getByLabelText("解析分块行数")).toHaveValue(2000);
    expect(screen.getByLabelText("列表窗口行数")).toHaveValue(120);
  });

  test("writes edits through to the store and to storage", async () => {
    const user = userEvent.setup();
    renderPanel(createBridges().bridges);

    const rows = screen.getByLabelText("记录明细行数");
    await user.clear(rows);
    await user.type(rows, "600");

    expect(getThresholds().detailRows).toBe(600);
    expect(JSON.parse(localStorage.getItem("cca-thresholds") ?? "{}")).toMatchObject({
      detailRows: 600
    });
  });

  test("converts the prompt budget between KB and bytes", async () => {
    const user = userEvent.setup();
    renderPanel(createBridges().bridges);

    const prompt = screen.getByLabelText("Prompt 上限");
    await user.clear(prompt);
    await user.type(prompt, "128");

    expect(getThresholds().promptBytes).toBe(128 * 1024);
  });

  test("restores the defaults and disables the reset button afterwards", async () => {
    const user = userEvent.setup();
    setThreshold("slowTools", 25);
    renderPanel(createBridges().bridges);

    const reset = screen.getByRole("button", { name: "恢复默认" });
    await user.click(reset);

    expect(getThresholds().slowTools).toBe(10);
    expect(screen.getByLabelText("最慢工具条数")).toHaveValue(10);
    expect(reset).toBeDisabled();
  });

  test("keeps the value when the input is cleared", async () => {
    const user = userEvent.setup();
    renderPanel(createBridges().bridges);

    await user.clear(screen.getByLabelText("子 agent 条数"));

    expect(getThresholds().subagents).toBe(30);
  });

  test("closes through the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <NotificationProvider>
        <BridgesProvider bridges={createBridges().bridges}>
          <ThresholdsPanel onClose={onClose} />
        </BridgesProvider>
      </NotificationProvider>
    );

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("本地归档 section", () => {
  test("defaults to off: disabled button, empty readout, and the trust copy", () => {
    renderPanel(createBridges().bridges);

    const toggle = screen.getByRole("checkbox", { name: "启用本地归档" });
    expect(toggle).not.toBeChecked();

    const button = screen.getByRole("button", { name: "立即归档" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "先开启本地归档");

    expect(screen.getByText("尚未归档任何会话")).toBeInTheDocument();

    const label = screen.getByText("启用本地归档").closest("label");
    expect(label?.textContent).toContain("在本机复制，不联网，不改动 ~/.claude 的原始文件。");
    expect(label?.textContent).toContain("关闭只停止后续归档，已归档的副本会保留。");
    // 开关是 checkbox，不是自定义 switch 控件。
    expect(screen.queryByRole("switch")).toBeNull();
  });

  test("enabling runs a full archive and reports the completion summary", async () => {
    const user = userEvent.setup();
    const { bridges, written } = createBridges({ sourceFiles: { "session.jsonl": "hello" } });
    renderPanel(bridges);

    await user.click(screen.getByRole("checkbox", { name: "启用本地归档" }));

    expect(localStorage.getItem("cca-archive-enabled")).toBe("on");
    expect(written["/app-data/archive/-repo-demo/session.jsonl"]).toBe("hello");
    expect(await screen.findByText("本次归档 1 个会话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即归档" })).toBeEnabled();
  });

  test("shows done/total progress while the run is in flight", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { bridges } = createBridges({
      sourceFiles: { "session.jsonl": "hello" },
      holdSourceRead: () => gate
    });
    renderPanel(bridges);

    await user.click(screen.getByRole("checkbox", { name: "启用本地归档" }));

    const readout = await screen.findByText(
      (_, el) => el?.tagName === "P" && /正在归档 \d+\/\d+ …/.test(el.textContent ?? "")
    );
    expect(readout.textContent).toBe("正在归档 0/1 …");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "1");
    const inFlight = screen.getByRole("button", { name: "正在归档…" });
    expect(inFlight).toBeDisabled();
    expect(inFlight).toHaveAttribute("aria-busy", "true");

    release();
    expect(await screen.findByText("本次归档 1 个会话")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  });

  test("flashes 已是最新 when a run has nothing left to copy", async () => {
    const user = userEvent.setup();
    renderPanel(createBridges().bridges);

    await user.click(screen.getByRole("checkbox", { name: "启用本地归档" }));

    expect(await screen.findByText("已是最新，无需归档")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "已是最新" })).toBeInTheDocument();
  });

  test("surfaces a disk-full failure in place and as an error toast", async () => {
    const user = userEvent.setup();
    const { bridges } = createBridges({
      sourceFiles: { "session.jsonl": "hello" },
      writeFails: new Error("no space left on device")
    });
    renderPanel(bridges);

    await user.click(screen.getByRole("checkbox", { name: "启用本地归档" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/^归档失败：/);
    expect(alert.textContent).toContain("请清理磁盘空间后重试。");
    // 开关保持 ON（环境问题，不是用户改了偏好），按钮可重试。
    expect(screen.getByRole("checkbox", { name: "启用本地归档" })).toBeChecked();
    expect(screen.getByRole("button", { name: "立即归档" })).toBeEnabled();
    expect(getArchiveTask().status).toBe("error");
  });
});

/**
 * 「本地归档」里的归档包入口（Issue #152）：口令只在内存里、读数如实、失败就地报。
 * Rust 侧的建包 / 解包由假 `archiveBundle` 承担，这里验的是**前端语义与编排**。
 */
describe("归档包（Issue #152）", () => {
  const INDEX_PATH = "/app-data/archive/archive-index.json";

  function bundleEntry(sourcePath: string, overrides: Partial<BundleEntry> = {}): BundleEntry {
    const name = sourcePath.split("/").pop() ?? "";
    return {
      sourcePath,
      archivePath: `/other-machine/archive/-repo-demo/${name}`,
      projectLabel: "-repo-demo",
      sessionId: name.replace(/\.jsonl$/, ""),
      sizeBytes: 12,
      mtimeMs: 1_700_000_000_000,
      ...overrides
    };
  }

  function indexOf(entries: BundleEntry[]) {
    const out: Record<string, unknown> = {};
    for (const item of entries) out[item.sourcePath] = { ...item, archivedAt: 1 };
    return { version: 1, entries: out };
  }

  function entryManifest(entries: BundleEntry[]): BundleManifest {
    return {
      formatVersion: 1,
      exportedAt: 0,
      appVersion: "0.0.0-test",
      entries: entries.map((item) => ({ ...item, sha256: "a".repeat(64) }))
    };
  }

  test("宿主没有归档包桥时：两个按钮禁用并说明原因", () => {
    const { bridges } = createBridges();
    delete (bridges as { archiveBundle?: unknown }).archiveBundle;
    renderPanel(bridges);

    expect(screen.getByRole("button", { name: "导出归档包…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导入归档包…" })).toBeDisabled();
    expect(screen.getByText("当前宿主不支持加密归档包")).toBeInTheDocument();
  });

  test("导出：口令要输两次且一致，读数报条目数与大小", async () => {
    const user = userEvent.setup();
    const seeded = [
      bundleEntry("/other/.claude/projects/-repo-demo/a.jsonl"),
      bundleEntry("/other/.claude/projects/-repo-demo/b.jsonl")
    ];
    const { bridges, archiveBundle } = createBridges({
      preWritten: { [INDEX_PATH]: JSON.stringify(indexOf(seeded)) },
      savePath: "/Users/tester/out.ccabundle",
      exportResult: { entries: 2, bytes: 2048 }
    });
    renderPanel(bridges);

    await user.click(screen.getByRole("button", { name: "导出归档包…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/口令无法找回/)).toBeInTheDocument();

    const confirmButton = within(dialog).getByRole("button", { name: "确认" });
    expect(confirmButton).toBeDisabled();

    await user.type(within(dialog).getByLabelText("口令"), "hunter2");
    await user.type(within(dialog).getByLabelText(/再输一次/), "hunter3");
    expect(within(dialog).getByText("两次输入不一致")).toBeInTheDocument();
    expect(confirmButton).toBeDisabled();

    await user.clear(within(dialog).getByLabelText(/再输一次/));
    await user.type(within(dialog).getByLabelText(/再输一次/), "hunter2");
    await user.click(confirmButton);

    expect(archiveBundle.exportBundle).toHaveBeenCalledWith(
      "/Users/tester/out.ccabundle",
      "hunter2",
      seeded
    );
    expect(await within(dialog).findByText(/已导出 2 条会话/)).toBeInTheDocument();
  });

  test("口令只在内存里：跑完不落 localStorage，输入框也清空", async () => {
    const user = userEvent.setup();
    const secret = "s3cret-passphrase-9f2";
    const { bridges } = createBridges({
      preWritten: {
        [INDEX_PATH]: JSON.stringify(
          indexOf([bundleEntry("/other/.claude/projects/-repo-demo/a.jsonl")])
        )
      },
      savePath: "/Users/tester/out.ccabundle",
      exportResult: { entries: 1, bytes: 512 }
    });
    renderPanel(bridges);

    await user.click(screen.getByRole("button", { name: "导出归档包…" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("口令"), secret);
    await user.type(within(dialog).getByLabelText(/再输一次/), secret);
    await user.click(within(dialog).getByRole("button", { name: "确认" }));
    await within(dialog).findByText(/已导出 1 条会话/);

    // 输入框已被清空；整份 localStorage 里也找不到口令的痕迹。
    expect(within(dialog).getByLabelText("口令")).toHaveValue("");
    expect(within(dialog).getByLabelText(/再输一次/)).toHaveValue("");
    const stored = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`);
    expect(stored.join("\n")).not.toContain(secret);
  });

  test("导入：只输一次口令，读数四类齐全，归档读数跟着变", async () => {
    const user = userEvent.setup();
    const staged = bundleEntry("/other/.claude/projects/-repo-demo/imported.jsonl");
    const { bridges, written } = createBridges({
      preWritten: { "/app-data/import-staging-1/-repo-demo/imported.jsonl": "hello" },
      openPath: "/Users/tester/in.ccabundle",
      importResult: {
        manifest: entryManifest([staged]),
        files: [
          { entry: staged, stagedPath: "/app-data/import-staging-1/-repo-demo/imported.jsonl" }
        ]
      }
    });
    renderPanel(bridges);

    await user.click(screen.getByRole("button", { name: "导入归档包…" }));
    const dialog = screen.getByRole("dialog");
    // 导入只需要知道口令，不问第二遍。
    expect(within(dialog).queryByLabelText("再输一次")).toBeNull();

    await user.type(within(dialog).getByLabelText("口令"), "hunter2");
    await user.click(within(dialog).getByRole("button", { name: "确认" }));

    expect(
      await within(dialog).findByText("新增 1 · 已存在 0 · 并列 0 · 失败 0")
    ).toBeInTheDocument();
    expect(written["/app-data/archive/-repo-demo/imported.jsonl"]).toBe("hello");
    await waitFor(() => expect(getArchiveTask().footprint.count).toBe(1));
  });

  test("口令错：就地报错、索引未被写、临时目录仍被清掉", async () => {
    const user = userEvent.setup();
    const { bridges, written, archiveBundle } = createBridges({
      openPath: "/Users/tester/in.ccabundle",
      importError: new Error("口令错误：无法解密归档包")
    });
    renderPanel(bridges);

    await user.click(screen.getByRole("button", { name: "导入归档包…" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("口令"), "wrong");
    await user.click(within(dialog).getByRole("button", { name: "确认" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("口令错误");
    expect(written[INDEX_PATH]).toBeUndefined();
    expect(archiveBundle.removeStaging).toHaveBeenCalledTimes(1);
  });
});

describe("计费窗口 section · 周预算", () => {
  test("周预算输入常驻（不随计划档位显隐），填写即入同一份持久化 JSON", async () => {
    const user = userEvent.setup();
    renderPanel(createBridges().bridges);

    const weekly = screen.getByLabelText("周预算（可选）");
    // 默认档（none）下也能填：周预算与计划正交，预设一律没有周数字。
    await user.type(weekly, "300000");

    expect(getPlan().weeklyLimitTokens).toBe(300000);
    expect(getPlan().limitTokens).toBeNull();
    const persisted = JSON.parse(localStorage.getItem("cca-billing-plan") ?? "{}");
    expect(persisted.customWeeklyLimitTokens).toBe(300000);
  });

  test("清空输入即撤销预算，退回只显示消耗", async () => {
    const user = userEvent.setup();
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: 300000 });
    renderPanel(createBridges().bridges);

    await user.clear(screen.getByLabelText("周预算（可选）"));

    expect(getPlan().weeklyLimitTokens).toBeNull();
  });

  test("切换计划保留周预算——两层限额互不覆盖", async () => {
    const user = userEvent.setup();
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: 300000 });
    renderPanel(createBridges().bridges);

    await user.selectOptions(screen.getByLabelText("订阅计划"), "pro");

    expect(getPlan()).toEqual({ id: "pro", limitTokens: 19_000, weeklyLimitTokens: 300000 });
  });

  afterEach(() => {
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
    localStorage.clear();
  });
});

describe("界面字号 section", () => {
  /** 每个用例前把内存 store 拉回默认，避免用例之间互相污染。 */
  function fontScaleGroup() {
    return screen.getByRole("radiogroup", { name: "界面字号" });
  }

  test("是一个五档 radiogroup，默认只有 100% 选中", () => {
    resetFontScaleForTest();
    renderPanel(createBridges().bridges);

    const radios = within(fontScaleGroup()).getAllByRole("radio");
    expect(radios).toHaveLength(5);
    // 100% 项额外带一段视觉隐藏的「（默认）」，所以用子串匹配可见百分比。
    ["90%", "100%", "110%", "120%", "130%"].forEach((text, index) => {
      expect(radios[index]).toHaveTextContent(text);
    });

    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(1);
    // radiogroup 语义下不输出 tablist 的 aria-selected。
    expect(screen.queryAllByRole("tab", { name: /%$/ })).toHaveLength(0);
  });

  test("100% 项的可访问名含「（默认）」，可见文字仍是 100%", () => {
    resetFontScaleForTest();
    renderPanel(createBridges().bridges);

    const defaultItem = within(fontScaleGroup()).getAllByRole("radio")[1];
    expect(defaultItem).toHaveAccessibleName(/（默认）/);
    expect(defaultItem.textContent).toBe("100%（默认）");
    // 可见文字仍是 100%：多出来的只有那个隐藏 span。
    expect(defaultItem.querySelector("span")).toHaveTextContent("（默认）");
  });

  test("点 130% 后选中态、持久化与根变量一起更新", async () => {
    const user = userEvent.setup();
    resetFontScaleForTest();
    localStorage.removeItem("cca-font-scale");
    renderPanel(createBridges().bridges);

    const radios = within(fontScaleGroup()).getAllByRole("radio");
    await user.click(radios[4]);

    expect(radios[4]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem("cca-font-scale")).toBe("1.3");
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.3");
  });

  test("切档前后控件是同一个 DOM 节点（焦点不丢）", async () => {
    const user = userEvent.setup();
    resetFontScaleForTest();
    renderPanel(createBridges().bridges);

    const before = fontScaleGroup();
    await user.click(within(before).getAllByRole("radio")[4]);

    const after = fontScaleGroup();
    expect(after.isSameNode(before)).toBe(true);
  });

  test("是面板内的第一个分区标题，位于「Prompt 上限」之前", () => {
    resetFontScaleForTest();
    renderPanel(createBridges().bridges);

    const panel = screen.getByLabelText("阈值设置");
    const firstTitle = panel.querySelectorAll("h3")[0];
    expect(firstTitle).toHaveTextContent("界面字号");

    const promptField = screen.getByLabelText("Prompt 上限");
    // DOCUMENT_POSITION_FOLLOWING：标题在字段之前。
    expect(
      firstTitle.compareDocumentPosition(promptField) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

/**
 * 「常驻读数」小节（Round P §5）：标题、可见 label 即可访问名、关闭态补充说明，
 * 以及 `cca-tray-visible` 的持久化。托盘推送本身由 useTrayReadout.test.tsx 覆盖。
 */
describe("常驻读数", () => {
  test("默认开：可访问名就是可见标题，关闭态补充说明不出现", () => {
    renderPanel(createBridges().bridges);

    expect(screen.getByRole("heading", { name: "常驻读数" })).toBeInTheDocument();
    // getByLabelText 走的是 aria-labelledby 指向的可见标题，而不是另写的 aria-label。
    const toggle = screen.getByLabelText("显示用量读数");
    expect(toggle).toBeChecked();
    expect(screen.getByText(/在 macOS 菜单栏与 Windows 托盘常驻显示/)).toBeInTheDocument();
    expect(screen.queryByText(/关掉只是不显示读数/)).not.toBeInTheDocument();
  });

  test("关掉：补充说明出现并写进 cca-tray-visible；再打开又收回", async () => {
    const user = userEvent.setup();
    renderPanel(createBridges().bridges);

    await user.click(screen.getByLabelText("显示用量读数"));

    expect(screen.getByLabelText("显示用量读数")).not.toBeChecked();
    expect(screen.getByText(/关掉只是不显示读数/)).toBeInTheDocument();
    expect(localStorage.getItem("cca-tray-visible")).toBe("false");

    await user.click(screen.getByLabelText("显示用量读数"));

    expect(screen.getByLabelText("显示用量读数")).toBeChecked();
    expect(screen.queryByText(/关掉只是不显示读数/)).not.toBeInTheDocument();
    expect(localStorage.getItem("cca-tray-visible")).toBe("true");
  });
});
