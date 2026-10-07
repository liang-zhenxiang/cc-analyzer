import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./ErrorState";

/**
 * 真实错误串长这样：绝对用户路径 + 写给维护者的话。
 * 两条都在项目红线里（用户路径视同敏感数据 / 界面文案不得含夹具说明），
 * 所以它就是这些用例的夹具——红线要靠它才验得出来。
 */
const RAW_ERROR = [
  "扫描会话列表失败: Error: E2E 虚拟文件系统: readDir 遇到未声明的路径",
  "/Users/e2e/.claude/projects。请在夹具里声明它——",
  "静默返回空数组会把夹具错误伪装成成功缺陷。"
].join(" ");

function alertBox(): HTMLElement {
  return screen.getByRole("alert");
}

describe("ErrorState 的文案边界", () => {
  it("正文不含绝对路径，也不含写给维护者的话", () => {
    render(
      <ErrorState title="会话列表读取失败" hint="确认 ~/.claude/projects 可读后重试。" detail={RAW_ERROR} />
    );

    // 「正文」= 用户不主动展开详情时能读到的全部内容（含折叠区的标题）。
    const text = alertBox().textContent ?? "";
    expect(text).toContain("会话列表读取失败");
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain("/home/");
    expect(text).not.toContain("夹具");
    expect(text).not.toContain("E2E 虚拟文件系统");
    // 属性里也不行——沿 DOM 序列化一遍再查，堵住「藏进 title / aria-label」。
    expect(alertBox().innerHTML).not.toContain("/Users/");
  });

  it("原始错误串默认不挂进 DOM，展开「详情」之后才出现", async () => {
    const user = userEvent.setup();
    render(<ErrorState title="会话列表读取失败" hint="重试看看。" detail={RAW_ERROR} />);

    // 前半：折叠着就是「页面里没有」。不是「很难看见」——是根本没渲染。
    expect(alertBox().textContent).not.toContain("静默返回空数组");

    // 后半：展开后必须真的能看到原文，否则「详情」是个空壳，
    // 而上面那条断言会以「什么都没渲染」的方式永远为真。
    await user.click(screen.getByText("详情"));
    expect(alertBox().textContent).toContain("静默返回空数组");
    expect(alertBox().textContent).toContain("/Users/e2e/");
  });

  it("没有 detail 时不画一个点不开的「详情」", () => {
    render(<ErrorState title="读取失败" hint="稍后再试。" />);
    expect(screen.queryByText("详情")).toBeNull();
  });
});

describe("ErrorState 的动作", () => {
  it("重试接上回调，点一次只触发一次", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState title="读取失败" hint="重试看看。" onRetry={onRetry} />);

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("没有 onRetry 就不画按钮——点不动的按钮比没有按钮更糟", () => {
    render(<ErrorState title="读取失败" hint="稍后再试。" />);
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });
});

describe("ErrorState 的三档尺寸", () => {
  it("三档是同一套结构：标题、说明、动作、详情", () => {
    for (const size of ["page", "panel", "inline"] as const) {
      const view = render(
        <ErrorState
          size={size}
          title={`${size} 失败`}
          hint="重试看看。"
          detail={RAW_ERROR}
          onRetry={() => undefined}
        />
      );

      const box = alertBox();
      expect(box.querySelector("strong")).toHaveTextContent(`${size} 失败`);
      expect(box.querySelector("p")).toHaveTextContent("重试看看。");
      expect(box.querySelector("summary")).toHaveTextContent("详情");
      expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();

      view.unmount();
    }
  });
});

/**
 * 版面约束读的是样式表本身：jsdom 不做布局，`getComputedStyle` 拿不到
 * `max-width` 的实际效果，这里能钉住的只有「规则写了没有」。
 * 真机上的实际宽度由端到端用例量。
 */
const css = readFileSync(
  resolve(process.cwd(), "src/components/ErrorState.module.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

function rulesOf(source: string): Array<{ selectors: string[]; body: string }> {
  const out: Array<{ selectors: string[]; body: string }> = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    out.push({
      selectors: match[1].split(",").map((item) => item.trim()),
      body: match[2]
    });
  }
  return out;
}

function maxWidthOf(selector: string): number[] {
  return rulesOf(css)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => Number(rule.body.match(/max-width:\s*(\d+)px/)?.[1] ?? Number.NaN));
}

describe("ErrorState 的版面纪律", () => {
  it("page 与 panel 的正文块都有最大宽度约束", () => {
    for (const selector of [".page", ".panel"]) {
      // 只取真的声明了 max-width 的规则：同一个选择器还有别的规则
      // （内边距、最小高度），混进来会读到 NaN。
      const limits = maxWidthOf(selector).filter(Number.isFinite);
      expect(limits.length, `${selector} 的正文没有任何 max-width`).toBeGreaterThan(0);
      for (const limit of limits) expect(limit).toBeLessThanOrEqual(640);
    }
  });

  it("样式表里没有字面量颜色——颜色一律来自 token", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});