import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterBar } from "./FilterBar";
import { emptyFilter, type RecordFilter } from "./filters";

test("changes search and toggles a row kind", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<FilterBar filter={emptyFilter} onChange={onChange} />);

  await user.type(screen.getByPlaceholderText("搜索命令 / 路径 / 摘要…"), "Read");
  await user.click(screen.getByLabelText("用户"));

  expect(onChange).toHaveBeenCalled();
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ kinds: new Set(["user"]) })
  );
});

test("clears time range", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const filter: RecordFilter = { ...emptyFilter, timeRange: { start: 1, end: 2 } };
  render(<FilterBar filter={filter} onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "清除时间选区" }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ timeRange: null }));
});

test("changes only duration display without changing stored milliseconds", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<FilterBar filter={{ ...emptyFilter, minDurationMs: 1000 }} onChange={onChange} />);

  // Default unit is seconds, so 1000ms shows as 1.
  expect(screen.getByLabelText("阈值")).toHaveValue(1);
  await user.selectOptions(screen.getByLabelText("耗时单位"), "ms");
  expect(screen.getByLabelText("阈值")).toHaveValue(1000);
  expect(onChange).not.toHaveBeenCalled();
});

test("offers 高于 / 低于 / 区间 comparison modes", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<FilterBar filter={emptyFilter} onChange={onChange} />);

  expect(screen.getByLabelText("耗时比较方式")).toHaveValue("gt");
  expect(screen.getByLabelText("阈值")).toBeInTheDocument();
  expect(screen.queryByLabelText("上限")).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("耗时比较方式"), "between");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ durationMode: "between" }));
});

test("toggles the 成功 / 失败 status filters", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<FilterBar filter={emptyFilter} onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "失败" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ statuses: new Set(["error"]) })
  );
});
