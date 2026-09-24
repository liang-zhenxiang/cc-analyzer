import { render, screen } from "@testing-library/react";
import App from "./App";

vi.mock("./api/tauri", () => ({
  installTauriBridges: vi.fn(() => ({
    events: { onSessionImport: vi.fn(async () => () => undefined) },
    fs: {
      homeDir: vi.fn(async () => "/home/tester"),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir: vi.fn(async () => []),
      readText: vi.fn(async () => "{}"),
      readHead: vi.fn(async () => "{}"),
      writeText: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ is_file: true, size: 1, mtime_ms: 1 }))
    }
  }))
}));

test("renders the application title", () => {
  render(<App />);
  expect(screen.getByText("CC Analyzer")).toBeInTheDocument();
});
