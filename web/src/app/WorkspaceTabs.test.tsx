import { render, screen } from "@testing-library/react";
import { WorkspaceTabs } from "./WorkspaceTabs";
import styles from "./AppShell.module.css";

test("applies the workspace tabs CSS module class", () => {
  render(<WorkspaceTabs value="analyzer" onChange={() => undefined} />);

  expect(screen.getByRole("tablist", { name: "页面切换" })).toHaveClass(styles.workspaceTabs);
});
