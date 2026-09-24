import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { ErrorBoundary } from "./ErrorBoundary";
import { Panel } from "./Panel";
import { TextInput } from "./TextInput";

test("renders shared controls and panels", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(
    <>
      <Button variant="primary" onClick={onClick}>保存</Button>
      <TextInput aria-label="搜索" />
      <Panel title="面板">内容</Panel>
      <EmptyState title="暂无数据" description="稍后再试。" />
    </>
  );

  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(onClick).toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "搜索" })).toBeInTheDocument();
  expect(screen.getByText("面板")).toBeInTheDocument();
  expect(screen.getByText("暂无数据")).toBeInTheDocument();
});

test("recovers from rendering errors", async () => {
  const user = userEvent.setup();
  // React (and jsdom) log the thrown error while the boundary catches it; the
  // assertions below check that we log it ourselves, so the noise is expected.
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  function Broken(): null {
    throw new Error("测试异常");
  }

  try {
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("界面出现异常");
    expect(screen.getByText("测试异常")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      "界面渲染失败",
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) })
    );

    // Retrying re-renders the same broken child, which the boundary catches again.
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByRole("alert")).toHaveTextContent("界面出现异常");
  } finally {
    consoleError.mockRestore();
  }
});
