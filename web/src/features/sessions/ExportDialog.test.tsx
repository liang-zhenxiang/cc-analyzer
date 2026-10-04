import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportDialog } from "./ExportDialog";
import type { ClipboardService, DialogBridge } from "../../api/types";
import type { ExportBase, ExportFormat } from "./exportTypes";
import type { SessionRecord } from "./types";

const ID = "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11";
const BASE = Date.UTC(2026, 0, 2, 3, 4, 5);

function record(index: number, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `r${index}`,
    fullId: `r${index}`,
    kind: "tool",
    timestamp: BASE + index * 1000,
    durationMs: 500,
    text: `记录 ${index}`,
    isError: false,
    raw: {},
    ...overrides
  };
}

function baseInput(overrides: Partial<ExportBase> = {}): ExportBase {
  const records = [record(1), record(2), record(3)];
  return {
    title: "导出用例",
    sessionId: ID,
    projectName: "demo",
    startedAt: BASE,
    endedAt: BASE + 10_000,
    records,
    allRecords: records,
    appVersion: "0.10.0",
    ...overrides
  };
}

function stubs(overrides: { savePath?: string | null; saveError?: Error; copyError?: Error } = {}) {
  const saveText = vi.fn(
    async (
      _defaultName: string,
      _contents: string,
      _options: { title: string; filterName: string; extensions: string[] }
    ) => {
      if (overrides.saveError) throw overrides.saveError;
      return overrides.savePath === undefined ? "/tmp/out.html" : overrides.savePath;
    }
  );
  const clipboard: ClipboardService = {
    writeText: vi.fn(async () => {
      if (overrides.copyError) throw overrides.copyError;
    })
  };
  const dialog = { saveText, saveMarkdown: vi.fn() } as unknown as DialogBridge;
  return { saveText, clipboard, dialog };
}

function renderDialog({
  input = baseInput(),
  opener = null,
  onClose = vi.fn(),
  onSaved = vi.fn(),
  services = stubs()
}: {
  input?: ExportBase;
  opener?: HTMLElement | null;
  onClose?: () => void;
  onSaved?: (format: ExportFormat) => void;
  services?: ReturnType<typeof stubs>;
} = {}) {
  const view = render(
    <ExportDialog
      input={input}
      clipboard={services.clipboard}
      dialog={services.dialog}
      opener={opener}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
  return { ...view, services, onClose, onSaved };
}

test("opens as a modal dialog named by its heading", () => {
  renderDialog();
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  const labelId = dialog.getAttribute("aria-labelledby");
  expect(labelId).toBeTruthy();
  expect(document.getElementById(labelId as string)?.textContent).toBe("导出会话报告");
  expect(dialog).toHaveAttribute("aria-describedby", "export-dialog-count");
});

test("starts on the format decision and hands focus back when it closes", () => {
  const opener = document.createElement("button");
  opener.textContent = "导出";
  document.body.append(opener);
  opener.focus();

  const { unmount } = renderDialog();
  // autoFocus 只会落到 DOM 首个可聚焦元素（关闭按钮），所以焦点是显式要的。
  expect(document.activeElement?.textContent).toBe("HTML 报告");

  unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

test("returns focus to the trigger even when WebKit never focused it", () => {
  // Safari/WebKit 点按钮不给焦点：进浮层时 activeElement 还是 <body>，
  // 所以归还的目标必须由调用方显式传进来，不能靠读 activeElement。
  const trigger = document.createElement("button");
  trigger.textContent = "导出";
  document.body.append(trigger);
  document.body.focus();
  expect(document.activeElement).not.toBe(trigger);

  const { unmount } = renderDialog({ opener: trigger });
  expect(document.activeElement?.textContent).toBe("HTML 报告");

  unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

test("defaults to HTML over the current filter, whatever the data says", async () => {
  const user = userEvent.setup();
  // 没有生效筛选（两个范围相等）时默认值也不跳，肌肉记忆才立得住。
  renderDialog({ input: baseInput({ records: [record(1)], allRecords: [record(1)] }) });

  expect(screen.getByRole("tab", { name: "HTML 报告" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "当前筛选结果" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.getByText("当前没有生效的筛选，两个范围内容相同")).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "全部记录" }));
  expect(screen.getByRole("tab", { name: "全部记录" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText(/本会话全部 1 条记录/)).toBeInTheDocument();
});

test("counts the filtered rows and says where they came from", () => {
  renderDialog({
    input: baseInput({ records: [record(1)], allRecords: Array.from({ length: 9 }, (_, i) => record(i)) })
  });
  expect(screen.getByText(/将导出 1 条记录/)).toBeInTheDocument();
  expect(screen.getByText(/共 9 条中的 1 条/)).toBeInTheDocument();
});

test("keeps the chosen scope while the format changes", async () => {
  const user = userEvent.setup();
  renderDialog({
    input: baseInput({ records: [record(1)], allRecords: Array.from({ length: 5 }, (_, i) => record(i)) })
  });

  await user.click(screen.getByRole("tab", { name: "全部记录" }));
  await user.click(screen.getByRole("tab", { name: "CSV" }));

  expect(screen.getByRole("tab", { name: "全部记录" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("逐条记录，供 Excel 或脚本进一步分析。")).toBeInTheDocument();
  expect(screen.getByText(`${ID.slice(0, 8)}-all.csv`)).toBeInTheDocument();
});

test("switching to 全部记录 changes what would be written, not just the name", async () => {
  const user = userEvent.setup();
  const services = stubs();
  const all = Array.from({ length: 5 }, (_, index) => record(index));
  renderDialog({ services, input: baseInput({ records: [record(1)], allRecords: all }) });

  await user.click(screen.getByRole("tab", { name: "全部记录" }));
  expect(screen.getByText(/将导出 5 条记录/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "保存…" }));

  const [name, contents] = services.saveText.mock.calls[0];
  expect(name).toMatch(/-all\.html$/);
  // 报告正文必须真的是 5 行——「自称完整、实则子集」是这轮最贵的缺陷。
  const parsed = new DOMParser().parseFromString(contents, "text/html");
  expect(parsed.querySelectorAll("tbody tr")).toHaveLength(5);
  expect(parsed.querySelector(".facts")?.textContent).toContain("全部记录（5 条）");
});

test("copies the CSV without its BOM and confirms in place", async () => {
  const user = userEvent.setup();
  const services = stubs();
  renderDialog({ services });

  await user.click(screen.getByRole("tab", { name: "CSV" }));
  await user.click(screen.getByRole("button", { name: "复制到剪贴板" }));

  const copied = vi.mocked(services.clipboard.writeText).mock.calls[0][0];
  expect(copied.charCodeAt(0)).not.toBe(0xfeff);
  expect(copied.startsWith("record_id,timestamp,")).toBe(true);
  expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  // 浮层还开着——复制完常常还想再存一份。
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByText(/已复制 3 条记录的 CSV/)).toBeInTheDocument();
});

test("copies the HTML source, not a rendered string", async () => {
  const user = userEvent.setup();
  const services = stubs();
  renderDialog({ services });

  await user.click(screen.getByRole("button", { name: "复制到剪贴板" }));

  const copied = vi.mocked(services.clipboard.writeText).mock.calls[0][0];
  expect(copied.startsWith("<!doctype html>")).toBe(true);
  expect(screen.getByText("已复制 HTML 源码")).toBeInTheDocument();
});

test("restores the copy label after the confirmation window", async () => {
  const user = userEvent.setup();
  renderDialog();
  await user.click(screen.getByRole("button", { name: "复制到剪贴板" }));
  expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();

  // 真实计时器：fake timers 与 user-event 的等待会互相卡死（实测整条用例超时，
  // 还会把 fake timers 留在后续用例里）。
  await waitFor(
    () => expect(screen.getByRole("button", { name: "复制到剪贴板" })).toBeInTheDocument(),
    { timeout: 4_000 }
  );
}, 10_000);

test("surfaces a clipboard failure in place", async () => {
  const user = userEvent.setup();
  renderDialog({ services: stubs({ copyError: new Error("denied") }) });

  await user.click(screen.getByRole("button", { name: "复制到剪贴板" }));

  expect(screen.getByRole("alert")).toHaveTextContent(/^导出失败/);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("saves through the dialog bridge with the file's own name and bytes", async () => {
  const user = userEvent.setup();
  const services = stubs({ savePath: "/tmp/chosen.html" });
  const onSaved = vi.fn();
  renderDialog({ services, onSaved });

  await user.click(screen.getByRole("button", { name: "保存…" }));

  expect(services.saveText).toHaveBeenCalledTimes(1);
  const [name, contents, options] = services.saveText.mock.calls[0];
  expect(name).toMatch(/^cc-analyzer-3d2a5442-filtered\.html$/);
  expect(contents.startsWith("<!doctype html>")).toBe(true);
  expect(options).toMatchObject({ filterName: "HTML", extensions: ["html"] });
  expect(onSaved).toHaveBeenCalledWith("html");
  // 保存成功后由页面负责关掉浮层并弹 toast；浮层自己不弹。
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("treats a cancelled save as silence, not as failure", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  renderDialog({ services: stubs({ savePath: null }), onSaved });

  await user.click(screen.getByRole("button", { name: "保存…" }));

  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("keeps the dialog open and explains a failed write", async () => {
  const user = userEvent.setup();
  renderDialog({ services: stubs({ saveError: new Error("磁盘已满") }) });

  await user.click(screen.getByRole("button", { name: "保存…" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("导出失败: Error: 磁盘已满");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("blocks both write actions while a save is in flight", async () => {
  const user = userEvent.setup();
  let release: (value: string | null) => void = () => undefined;
  const services = stubs();
  services.saveText.mockImplementation(
    () => new Promise<string | null>((resolve) => (release = resolve))
  );
  renderDialog({ services });

  await user.click(screen.getByRole("button", { name: "保存…" }));

  const saving = screen.getByRole("button", { name: "正在保存…" });
  expect(saving).toHaveAttribute("aria-busy", "true");
  expect(saving).toBeDisabled();
  expect(screen.getByRole("button", { name: "复制到剪贴板" })).toBeDisabled();

  release("/tmp/out.html");
});

test("keeps Tab inside the dialog while a save has blurred the buttons", async () => {
  const user = userEvent.setup();
  const services = stubs();
  services.saveText.mockImplementation(() => new Promise<string | null>(() => undefined));
  const behind = document.createElement("button");
  behind.textContent = "behind";
  document.body.append(behind);
  try {
    renderDialog({ services });

    await user.click(screen.getByRole("button", { name: "保存…" }));
    // 两个写按钮都 disabled 之后，浏览器把焦点丢回 body——此刻若不在
    // document 上兜住 Tab，焦点会走进浮层背后的页面。
    expect(screen.getByRole("button", { name: "正在保存…" })).toBeDisabled();

    await user.tab();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(behind);

    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  } finally {
    behind.remove();
  }
});

test("closes on Escape and stops the event from reaching the app behind it", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const behind = vi.fn();
  window.addEventListener("keydown", behind);
  try {
    renderDialog({ onClose });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    // AppShell 的全局键盘监听在 window 上；Esc 不该冒泡到它。
    expect(behind).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", behind);
  }
});

test("closes on the backdrop but not on the panel", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  renderDialog({ onClose });

  await user.click(screen.getByRole("dialog"));
  expect(onClose).not.toHaveBeenCalled();

  await user.click(document.querySelector('[class*="backdrop"]') as HTMLElement);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("wraps Tab between the last and the first focusable element", async () => {
  const user = userEvent.setup();
  renderDialog();

  const save = screen.getByRole("button", { name: "保存…" });
  save.focus();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭导出窗口" }));

  await user.tab({ shift: true });
  expect(document.activeElement).toBe(save);
});

test("keeps one Tab stop per segmented group and moves within it", async () => {
  const user = userEvent.setup();
  renderDialog();

  // roving tabindex：整组只占一次 Tab，组内用方向键并且自动激活。
  expect(screen.getByRole("tab", { name: "HTML 报告" })).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("tab", { name: "CSV" })).toHaveAttribute("tabindex", "-1");

  screen.getByRole("tab", { name: "HTML 报告" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement?.textContent).toBe("CSV");
  expect(screen.getByRole("tab", { name: "CSV" })).toHaveAttribute("aria-selected", "true");
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});
