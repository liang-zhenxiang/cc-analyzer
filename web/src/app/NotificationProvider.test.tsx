import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationProvider, useNotifications } from "./NotificationProvider";
import styles from "../components/StatusToast.module.css";

function Notifier() {
  const { notify } = useNotifications();
  return (
    <button type="button" onClick={() => notify("操作完成", "error")}>
      通知
    </button>
  );
}

test("renders a toast notification", async () => {
  const user = userEvent.setup();
  render(
    <NotificationProvider>
      <Notifier />
    </NotificationProvider>
  );

  await user.click(screen.getByRole("button", { name: "通知" }));
  expect(screen.getByText("操作完成")).toHaveClass(styles.toast, styles.error);
});

test("clears notification timers on unmount", () => {
  const timeoutSpy = vi
    .spyOn(window, "setTimeout")
    .mockReturnValue(123 as unknown as ReturnType<typeof setTimeout>);
  const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
  const { unmount } = render(
    <NotificationProvider>
      <Notifier />
    </NotificationProvider>
  );

  fireEvent.click(screen.getByRole("button", { name: "通知" }));
  unmount();

  expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
  timeoutSpy.mockRestore();
  clearTimeoutSpy.mockRestore();
});
