import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimelineTrack } from "./TimelineTrack";
import { parseJsonlText } from "./parseJsonl";
import fixture from "../../../tests/fixtures/session-basic.jsonl?raw";

test("clears selection with Escape", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const session = parseJsonlText(fixture, "/tmp/session.jsonl");
  render(
    <TimelineTrack
      session={session}
      selection={{ start: 1, end: 2 }}
      onSelect={onSelect}
      onReveal={() => undefined}
    />
  );

  screen.getByRole("application", { name: "时间轨道" }).focus();
  await user.keyboard("{Escape}");
  expect(onSelect).toHaveBeenCalledWith(null);
});

test("selects a block by double click and reveals it by click", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const onReveal = vi.fn();
  const session = parseJsonlText(fixture, "/tmp/session.jsonl");
  render(
    <TimelineTrack
      session={session}
      selection={null}
      onSelect={onSelect}
      onReveal={onReveal}
    />
  );

  const block = screen.getByTitle(/^turn-1-user/);
  await user.click(block);
  await user.dblClick(block);
  expect(onReveal).toHaveBeenCalledWith("turn-1-user");
  expect(onSelect).toHaveBeenLastCalledWith({ start: session.records[0].timestamp, end: session.records[0].timestamp + 1 });
});
