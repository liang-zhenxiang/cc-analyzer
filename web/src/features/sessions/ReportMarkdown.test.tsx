import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ReportMarkdown } from "./ReportMarkdown";

describe("ReportMarkdown", () => {
  it("renders GFM tables instead of raw text", () => {
    render(
      <ReportMarkdown
        text={[
          "## 总览",
          "",
          "| 分类 | 耗时 |",
          "|---|---|",
          "| 子 agent | 5.00s |"
        ].join("\n")}
      />
    );

    expect(screen.getByRole("heading", { name: "总览", level: 2 })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "分类" })).toBeInTheDocument();
  });

  it("keeps raw HTML inert", () => {
    const { container } = render(
      <ReportMarkdown
        text={'<img src="x" onerror="alert(1)"> <script>alert(2)</script>'}
      />
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("opens links in a new tab without leaking the referrer", () => {
    render(<ReportMarkdown text="[会话](https://example.com/session)" />);

    const link = screen.getByRole("link", { name: "会话" });
    expect(link).toHaveAttribute("href", "https://example.com/session");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders fenced code and lists", () => {
    const { container } = render(
      <ReportMarkdown text={["1. 第一轮", "2. 第二轮", "", "```ts", "const a = 1;", "```"].join("\n")} />
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    const code = container.querySelector("pre code");
    expect(code?.textContent).toContain("const a = 1;");
  });

  it("highlights fenced code into token spans", () => {
    const { container } = render(
      <ReportMarkdown
        text={["```json", '{"tool": "Bash", "ms": 1200}', "```"].join("\n")}
      />
    );

    const code = container.querySelector("pre code");
    expect(code).toHaveClass("hljs");
    expect(code?.querySelector(".hljs-attr")).not.toBeNull();
    expect(code?.querySelector(".hljs-string")?.textContent).toContain("Bash");
  });

  it("keeps unknown languages as plain code", () => {
    const { container } = render(
      <ReportMarkdown text={["```not-a-language", "plain text", "```"].join("\n")} />
    );

    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("plain text");
    expect(code?.querySelector(".hljs-attr")).toBeNull();
  });

  it("still ignores raw HTML when highlighting is enabled", () => {
    const { container } = render(
      <ReportMarkdown
        text={'<script>alert(1)</script> <div onclick="x()">hi</div>\n\n```html\n<b>bold</b>\n```'}
      />
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.textContent).toContain("<div onclick=\"x()\">hi</div>");
    expect(container.querySelector("pre code")?.textContent).toContain("<b>bold</b>");
  });

  it("keeps every hljs selector global so CSS modules cannot rename it", () => {
    // Vitest runs with the package root as cwd.
    const css = readFileSync("src/features/sessions/ReportMarkdown.module.css", "utf8");
    const tokens = css
      .split(/[{}]/)
      .flatMap((block) => block.split(","))
      .map((token) => token.trim())
      .filter((token) => token.includes(".hljs-"));

    expect(tokens.length).toBeGreaterThan(5);
    for (const token of tokens) {
      expect(token).toContain(":global(.hljs-");
    }
  });
});
