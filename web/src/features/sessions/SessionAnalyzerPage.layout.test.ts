import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageStyles = readFileSync(resolve(process.cwd(), "src/features/sessions/SessionAnalyzerPage.module.css"), "utf8");
const shellStyles = readFileSync(resolve(process.cwd(), "src/app/AppShell.module.css"), "utf8");

describe("minimum window layout", () => {
  it("allows analyzer content to scroll at 960x640", () => {
    expect(pageStyles).not.toContain("min-height: 640px");
    expect(pageStyles).not.toContain("minmax(220px");
    expect(shellStyles).toMatch(/\.content\s*\{[^}]*overflow:\s*auto/s);
  });

  it("sizes workspace rows from the blocks that are rendered", () => {
    // A hard-coded row template silently mis-assigns rows when a block is added
    // or removed; each pane carries its own minimum instead.
    expect(pageStyles).toMatch(/\.workspace\s*\{[^}]*grid-auto-rows/s);
    expect(pageStyles).not.toMatch(/grid-template-rows:\s*auto auto auto/);
    expect(pageStyles).toMatch(/\.pane\s*\{[^}]*min-height:\s*180px/s);
    expect(pageStyles).toMatch(/\.reportPane\s*\{[^}]*min-height:\s*160px/s);
  });
});
