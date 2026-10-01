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
});
