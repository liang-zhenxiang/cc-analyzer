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

  it("lets the log pane absorb the leftover height without pinning rows", () => {
    // 方向 A §4.3⑥：工作区是纵向 flex，日志/树视图用 `flex: 1` 吸收剩余高度，
    // 每个 pane 自带最小高度。
    //
    // 刻意**不写死** `grid-template-rows` 的行序。页面渲染的块数会变——
    // 未选会话时工作区里只有空状态一个块——写死行序会把它按在第一行，
    // 下面留一大片空白。这条用例就是防这个回归的。
    expect(pageStyles).toMatch(/\.workspace\s*\{[^}]*display:\s*flex/s);
    expect(pageStyles).toMatch(/\.workspace\s*\{[^}]*flex-direction:\s*column/s);
    expect(pageStyles).not.toMatch(/grid-template-rows:\s*auto auto auto/);
    expect(pageStyles).toMatch(/\.pane\s*\{[^}]*flex:\s*1/s);
    expect(pageStyles).toMatch(/\.pane\s*\{[^}]*min-height:\s*180px/s);
    expect(pageStyles).toMatch(/\.reportPane\s*\{[^}]*min-height:\s*160px/s);
  });

  it("drops the fixed-height dashed empty box", () => {
    // 方向 A §4.3④：空状态统一走 EmptyState 的 `page` 尺寸——
    // 无边框、无底色、在主区垂直居中。虚线框 + 320px 固定高是最坏的组合：
    // 既没撑满，框里也什么都没有。
    expect(pageStyles).not.toContain("dashed");
    expect(pageStyles).not.toContain("320px");
    expect(pageStyles).not.toMatch(/\.empty\s*\{/);
  });
});
