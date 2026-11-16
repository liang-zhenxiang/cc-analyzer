import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProvenanceBadge } from "./ProvenanceBadge";

describe("ProvenanceBadge", () => {
  it("exposes the full provenance sentence as its accessible name", () => {
    render(<ProvenanceBadge provenance="estimated" detail="快照日期 2026-10-01" />);

    const badge = screen.getByTitle("数据来源：按定价快照估算，快照日期 2026-10-01");
    expect(badge).toHaveAttribute("aria-label", "数据来源：按定价快照估算，快照日期 2026-10-01");
    expect(badge).toHaveTextContent("按定价快照估算");
    expect(badge).toHaveTextContent("快照日期 2026-10-01");
  });

  it("logged 档不再渲染圆点：读自日志是默认事实，不值得每处一个标记", () => {
    // Issue #339：首屏 8 枚圆点里 6 枚是同一个同义绿点。只保留
    // estimated / inferred / snapshot 三种「非确定信息」的提示。
    const { container } = render(<ProvenanceBadge provenance="logged" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTitle("数据来源：读自日志")).toBeNull();
  });

  it("labels the snapshot tier itself", () => {
    render(<ProvenanceBadge provenance="snapshot" detail="快照日期 2026-10-01" />);

    expect(screen.getByTitle("数据来源：定价快照，快照日期 2026-10-01")).toBeInTheDocument();
  });

  it("非 logged 档仍把档位文字藏在可访问树里，可见部分只是一枚圆点", () => {
    const { container } = render(<ProvenanceBadge provenance="estimated" />);

    const badge = container.querySelector("span");
    expect(badge).not.toBeNull();
    const visibleText = Array.from(badge!.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join("");
    expect(visibleText).toBe("");
    expect(badge).toHaveAttribute("title", "数据来源：按定价快照估算");
    // 文字仍在可访问树里（藏在 sr-only 里），不是被删掉。
    expect(badge!.textContent).toBe("按定价快照估算");
  });

  it("画成圆点，而不是实底描边的胶囊", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/usage/ProvenanceBadge.module.css"), "utf8");
    const badgeRule = /\.badge\s*\{([^}]*)\}/.exec(css);
    expect(badgeRule).not.toBeNull();
    expect(badgeRule![1]).toMatch(/border-radius:\s*50%/);
    expect(badgeRule![1]).not.toMatch(/padding:/);
    // 档位色只给圆点本身，不再铺 soft 底。
    expect(css).not.toMatch(/background:\s*var\(--(success|warning)-soft\)/);
  });
});
