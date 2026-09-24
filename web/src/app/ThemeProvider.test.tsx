import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JSDOM } from "jsdom";
import indexSource from "../../index.html?raw";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function ThemeText() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

test("applies the saved theme before the module script starts", () => {
  const dom = new JSDOM(indexSource, {
    runScripts: "dangerously",
    url: "http://localhost/",
    beforeParse(window) {
      window.localStorage.setItem("cca-theme", "dark");
    }
  });

  expect(dom.window.document.documentElement.dataset.theme).toBe("dark");
});

test("uses the saved dark theme", () => {
  localStorage.setItem("cca-theme", "dark");
  render(
    <ThemeProvider>
      <ThemeText />
    </ThemeProvider>
  );
  expect(screen.getByRole("button")).toHaveTextContent("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("toggles light and dark", async () => {
  localStorage.clear();
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <ThemeText />
    </ThemeProvider>
  );
  await user.click(screen.getByRole("button"));
  expect(screen.getByRole("button")).toHaveTextContent("dark");
});
