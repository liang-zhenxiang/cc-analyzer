import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, test, vi } from "vitest";
import { SnapshotCompareDialog } from "./SnapshotCompareDialog";
import { buildSnapshotJson, snapshotJsonText } from "./usageSnapshotJson";

const BASE = Date.UTC(2026, 0, 2, 3, 4, 5);

function snapshotText(overrides: { input?: number; messages?: number; sessions?: number } = {}) {
  const json = buildSnapshotJson({
    totals: {
      input: overrides.input ?? 1_000,
      output: 2_000,
      cacheCreation: 500,
      cacheRead: 4_000
    },
    messages: overrides.messages ?? 42,
    sessions: overrides.sessions ?? 3,
    startMs: BASE,
    endMs: BASE + 6 * 86_400_000,
    generatedAt: BASE
  });
  return snapshotJsonText(json);
}

function fileOf(contents: string, name: string): File {
  return new File([contents], name, { type: "application/json" });
}

function renderDialog(overrides: { onClose?: () => void; onExportCurrent?: () => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onExportCurrent = overrides.onExportCurrent;
  const view = render(
    <SnapshotCompareDialog onClose={onClose} onExportCurrent={onExportCurrent} />
  );
  return { ...view, onClose };
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, file: File) {
  await user.upload(screen.getByLabelText(label), file);
}

test("打开时先说清「要比什么」，并给出两个选择器", () => {
  renderDialog();
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(within(dialog).getByText(/比它俩的六项合计/)).toBeInTheDocument();
  expect(screen.getByLabelText("快照 A")).toBeInTheDocument();
  expect(screen.getByLabelText("快照 B")).toBeInTheDocument();
  // 还没有文件时不出表：空表会被读成「差异全是 0」。
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText(/选两份快照文件开始对比/)).toBeInTheDocument();
});

test("拒收不是本应用导出的快照（schema 不对），并指名是哪个文件", async () => {
  const user = userEvent.setup();
  renderDialog();

  await pick(user, "快照 A", fileOf(JSON.stringify({ schema: "other.snapshot", version: 1 }), "x.json"));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("x.json");
  expect(alert).toHaveTextContent("不是本应用导出的快照数据");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("拒收版本 2（字段名可能没变，口径可能变了）", async () => {
  const user = userEvent.setup();
  renderDialog();

  const v2 = JSON.parse(snapshotText()) as Record<string, unknown>;
  v2.version = 2;
  await pick(user, "快照 A", fileOf(JSON.stringify(v2), "v2.json"));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("不是本应用导出的快照数据");
});

test("两份都过关后出六行差值表，行序固定且成本不在表里", async () => {
  const user = userEvent.setup();
  renderDialog();

  await pick(user, "快照 A", fileOf(snapshotText({ input: 1_000 }), "a.json"));
  await pick(user, "快照 B", fileOf(snapshotText({ input: 1_500 }), "b.json"));

  const table = await screen.findByRole("table");
  const rows = within(table).getAllByRole("row");
  // 表头 + 六行
  expect(rows).toHaveLength(7);
  const metrics = within(table)
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent);
  expect(metrics).toEqual([
    "输入 tokens",
    "输出 tokens",
    "缓存写入 tokens",
    "缓存读取 tokens",
    "消息数",
    "会话数"
  ]);
  expect(metrics).not.toContain("估算成本");
  // 输入 1000 → 1500：+50.0%（以 A 为分母）
  expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "1,000",
    "1,500",
    "+50.0%"
  ]);
});

test("差值用真减号，前值为 0 时只给绝对差，不编百分比", async () => {
  const user = userEvent.setup();
  renderDialog();

  await pick(user, "快照 A", fileOf(snapshotText({ messages: 0 }), "a.json"));
  await pick(user, "快照 B", fileOf(snapshotText({ messages: 5 }), "b.json"));

  const table = await screen.findByRole("table");
  const row = within(table).getAllByRole("row")[5]; // 消息数
  const cells = within(row).getAllByRole("cell");
  expect(cells[0].textContent).toBe("0");
  expect(cells[1].textContent).toBe("5");
  expect(cells[2].textContent).toBe("+5");
  expect(cells[2].textContent).not.toContain("%");
});

test("两份一模一样时读「持平」，不印 +0.0%", async () => {
  const user = userEvent.setup();
  renderDialog();

  await pick(user, "快照 A", fileOf(snapshotText(), "a.json"));
  await pick(user, "快照 B", fileOf(snapshotText(), "b.json"));

  const table = await screen.findByRole("table");
  const row = within(table).getAllByRole("row")[1];
  expect(within(row).getAllByRole("cell")[2].textContent).toBe("持平");
});

test("Esc 关闭浮层（捕获阶段，不冒泡到全局）", async () => {
  const user = userEvent.setup();
  const { onClose } = renderDialog();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

test("没有快照可读时就地给出口：导出当前区间为 JSON", async () => {
  const user = userEvent.setup();
  const onExportCurrent = vi.fn();
  renderDialog({ onExportCurrent });

  await user.click(screen.getByRole("button", { name: "导出当前区间为 JSON" }));
  expect(onExportCurrent).toHaveBeenCalledTimes(1);
});

afterEach(() => {
  cleanup();
});
