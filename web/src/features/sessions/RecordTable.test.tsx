import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordTable } from "./RecordTable";
import type { SessionRecord } from "./types";
import styles from "./RecordTable.module.css";

const records: SessionRecord[] = [
  {
    id: "a", fullId: "record-a", kind: "user", timestamp: 2, durationMs: 0,
    text: "second", isError: false, raw: { order: 2 }
  },
  {
    id: "b", fullId: "record-b", kind: "tool", timestamp: 1, durationMs: 100,
    text: "first", isError: true, toolName: "Read", toolCategory: "direct", raw: { order: 1 }
  }
];

test("sorts by duration descending", async () => {
  const user = userEvent.setup();
  render(<RecordTable records={records} selectedId={null} onSelect={() => undefined} />);

  await user.click(screen.getByRole("button", { name: "耗时" }));
  await user.click(screen.getByRole("button", { name: "耗时" }));

  const rows = screen.getAllByRole("row");
  expect(rows[1]).toHaveTextContent("100ms");
  expect(rows[2]).toHaveTextContent("0ms");
});

test("sorts status in the selected direction", async () => {
  const user = userEvent.setup();
  render(<RecordTable records={records} selectedId={null} onSelect={() => undefined} />);

  await user.click(screen.getByRole("button", { name: "状态" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("正常");
  expect(screen.getAllByRole("row")[2]).toHaveTextContent("失败");

  await user.click(screen.getByRole("button", { name: "状态" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("失败");
  expect(screen.getAllByRole("row")[2]).toHaveTextContent("正常");
});

test("expands raw details and selects a record", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<RecordTable records={records} selectedId={null} onSelect={onSelect} />);

  await user.click(screen.getAllByRole("button", { name: "展开" })[0]);
  expect(screen.getByText(/"order": 1/)).toBeInTheDocument();
  await user.click(screen.getByText("second"));
  expect(onSelect).toHaveBeenCalledWith(records[0]);
});

function manyRecords(count: number): SessionRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    fullId: `record-${index}`,
    kind: "tool" as const,
    timestamp: index,
    durationMs: index,
    text: `row ${index}`,
    isError: false,
    toolName: "Read",
    toolCategory: "direct" as const,
    raw: { index }
  }));
}

test("windows a long record list", () => {
  const records = manyRecords(400);
  const { container } = render(
    <RecordTable records={records} selectedId={null} onSelect={() => undefined} />
  );

  const rendered = container.querySelectorAll("tbody tr:not([aria-hidden])");
  expect(rendered.length).toBeGreaterThan(0);
  expect(rendered.length).toBeLessThan(100);
  expect(screen.getByText(/row 0\b/)).toBeInTheDocument();

  const spacer = container.querySelector("tbody tr[aria-hidden]") as HTMLTableRowElement | null;
  expect(spacer?.style.height).not.toBe("");
});

test("renders the tail of a long record list after scrolling", () => {
  const records = manyRecords(400);
  const { container } = render(
    <RecordTable records={records} selectedId={null} onSelect={() => undefined} />
  );
  const scroller = container.querySelector(`.${styles.container}`) as HTMLDivElement;

  scroller.scrollTop = 20_000;
  fireEvent.scroll(scroller);

  expect(screen.getByText(/row 399\b/)).toBeInTheDocument();
  expect(screen.queryByText(/row 0\b/)).toBeNull();
});

test("renders every row while the record list is short", () => {
  const records = manyRecords(30);
  const { container } = render(
    <RecordTable records={records} selectedId={null} onSelect={() => undefined} />
  );

  expect(container.querySelectorAll("tbody tr:not([aria-hidden])")).toHaveLength(30);
});
