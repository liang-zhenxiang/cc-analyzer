import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../api/bridges";
import type { Bridges } from "../api/types";
import { DEMO_STORAGE_KEY } from "../demo/demoMode";
import { NotificationProvider } from "./NotificationProvider";
import { VersionBadge } from "./VersionBadge";

/** 版本徽章的三种状态：正式版 / 预发布 / 演示（Issue #339）。 */
function renderBadge(version: string) {
  const bridges = {
    clipboard: { writeText: vi.fn(async () => undefined) },
    updater: {
      appVersion: vi.fn(async () => version),
      checkUpdates: vi.fn(async () => ({ available: false, currentVersion: version })),
      relaunch: vi.fn(async () => undefined)
    }
  } as unknown as Bridges;

  render(
    <BridgesProvider bridges={bridges}>
      <NotificationProvider>
        <VersionBadge />
      </NotificationProvider>
    </BridgesProvider>
  );
  return bridges;
}

afterEach(() => {
  window.localStorage.clear();
});

describe("VersionBadge", () => {
  it("正式版：显示 vX.Y.Z，没有 Beta 胶囊", async () => {
    renderBadge("0.41.0");

    const badge = await screen.findByRole("button", { name: /当前版本 v0\.41\.0/ });
    expect(badge.textContent).toBe("v0.41.0");
    expect(screen.queryByText("Beta")).toBeNull();
  });

  it("预发布：版本号去掉预发布后缀，Beta 只写一次（在胶囊里）", async () => {
    const bridges = renderBadge("0.42.0-beta.1");

    // 可访问名保留完整版本——屏幕阅读器与复制内容不该失去 `-beta.1`。
    const badge = await screen.findByRole("button", { name: /当前版本 v0\.42\.0-beta\.1（先行版）/ });
    expect(badge.textContent).toBe("v0.42.0Beta");
    expect(within(badge).getByText("Beta")).toBeInTheDocument();
    // 视觉上只有一个 beta：不再把 `-beta.1` 原样印在版本号里。
    expect(badge.textContent).not.toContain("beta");

    badge.click();
    expect(bridges.clipboard.writeText).toHaveBeenCalledWith("CC Analyzer v0.42.0-beta.1");
  });

  it("演示模式：显示「演示数据」，不显示 0.0.0-demo", () => {
    window.localStorage.setItem(DEMO_STORAGE_KEY, "on");
    renderBadge("0.0.0-demo");

    expect(screen.getByText("演示数据")).toBeInTheDocument();
    expect(screen.queryByText(/0\.0\.0-demo/)).toBeNull();
    // 演示徽章不是动作入口，不该装成按钮。
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Beta 胶囊字号走设计令牌，不再写 10px 字面量", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/app/VersionBadge.module.css"),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const tagRule = /\.tag\s*\{([^}]*)\}/.exec(css);
    expect(tagRule).not.toBeNull();
    expect(tagRule![1]).toMatch(/font-size:\s*var\(--fs-xs\)/);
    expect(tagRule![1]).not.toMatch(/font-size:\s*10px/);
  });
});
