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

  it("labels logged figures without inventing detail", () => {
    render(<ProvenanceBadge provenance="logged" />);

    const badge = screen.getByTitle("数据来源：读自日志");
    expect(badge).toHaveTextContent("读自日志");
    expect(badge.textContent).not.toContain("快照日期");
  });

  it("labels the snapshot tier itself", () => {
    render(<ProvenanceBadge provenance="snapshot" detail="快照日期 2026-10-01" />);

    expect(screen.getByTitle("数据来源：定价快照，快照日期 2026-10-01")).toBeInTheDocument();
  });

  it("不把档位文字铺在正文里：可见部分是空的，句子只在 title 与可访问名上", () => {
    // 「读自日志」一屏出现五六次，实底胶囊会把最响的颜色花在信息量最低的地方。
    const { container } = render(<ProvenanceBadge provenance="logged" />);

    const badge = container.querySelector("span");
    expect(badge).not.toBeNull();
    const visibleText = Array.from(badge!.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join("");
    expect(visibleText).toBe("");
    expect(badge).toHaveAttribute("title", "数据来源：读自日志");
    // 文字仍在可访问树里（藏在 sr-only 里），不是被删掉。
    expect(badge!.textContent).toBe("读自日志");
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
