import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { DataHealthDialog } from "./DataHealthDialog";

const HEALTHY = {
  sessions: 3,
  totalRecords: 1000,
  unmatchedRecords: 0,
  truncatedLines: 0,
  parseWarnings: 0,
  missingUsage: 0
};

const TRUBL = {
  sessions: 3,
  totalRecords: 1000,
  unmatchedRecords: 25, // 2.5% ≥ 1% 挂
  truncatedLines: 2,
  parseWarnings: 4,
  missingUsage: 200 // 20% ≥ 5% 挂
};

describe("DataHealthDialog（H9 数据体检浮层）", () => {
  afterEach(() => cleanup());

  it("五项全过：评级优 + 「五项全过」徽标 + 通过项照样说数", () => {
    render(<DataHealthDialog input={HEALTHY} onClose={() => {}} />);
    const grade = document.querySelector('[data-probe="health-grade"]');
    expect(grade?.getAttribute("data-grade")).toBe("优");
    expect(grade?.textContent).toBe("优");
    expect(screen.getByText("五项全过")).toBeInTheDocument();
    expect(screen.getByText("100 分")).toBeInTheDocument();
    // 通过项也展示 actual（「无截断行」比一个 ✓ 更可信）。
    const rows = Array.from(document.querySelectorAll('[data-probe="health-check-row"]'));
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.getAttribute("data-pass") === "true")).toBe(true);
    // 「无截断行」同时是 label 与 actual——断言至少一处即可。
    expect(screen.getAllByText("无截断行").length).toBeGreaterThan(0);
  });

  it("多项未过：每行 ! + advice 在场，评级关注", () => {
    render(<DataHealthDialog input={TRUBL} onClose={() => {}} />);
    const rows = Array.from(document.querySelectorAll('[data-probe="health-check-row"]'));
    const failed = rows.filter((row) => row.getAttribute("data-pass") === "false");
    expect(failed).toHaveLength(4);
    // 未过行的 advice 都是中文一句话。
    for (const row of failed) {
      expect(row.textContent).toMatch(/[。；]/);
    }
    expect(document.querySelector('[data-probe="health-grade"]')?.getAttribute("data-grade")).toBe("关注");
    expect(screen.getByText("20 分")).toBeInTheDocument();
  });

  it("零会话（没扫过）：不出报告，只说「体检无从谈起」", () => {
    render(
      <DataHealthDialog
        input={{
          sessions: 0,
          totalRecords: 0,
          unmatchedRecords: 0,
          truncatedLines: 0,
          parseWarnings: 0,
          missingUsage: 0
        }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/还没有扫描过任何会话，体检无从谈起/)).toBeInTheDocument();
    // 不出 grade、不出检查表。
    expect(document.querySelector('[data-probe="health-grade"]')).toBeNull();
    expect(document.querySelector('[data-probe="health-checks"]')).toBeNull();
  });

  it("Esc 在捕获阶段关闭并消化（不穿透到背后页面）", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DataHealthDialog input={HEALTHY} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点「知道了」关闭浮层", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DataHealthDialog input={HEALTHY} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "知道了" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("role=dialog + aria-modal，读屏按浮层语义进入", () => {
    render(<DataHealthDialog input={HEALTHY} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "数据体检" })).toHaveAttribute("aria-modal", "true");
  });
});
