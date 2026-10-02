import { describe, expect, it } from "vitest";
import {
  channelEndpointOf,
  loadAutoCheck,
  loadChannel,
  parseChannel,
  CHANNEL_LABELS
} from "./updateChannel";

function storageWith(entries: Record<string, string>): Pick<Storage, "getItem"> {
  return {
    getItem: (key: string) => entries[key] ?? null
  };
}

describe("updateChannel（不可信持久化输入）", () => {
  it("未设置与未知值都回退 stable，绝不静默进 beta", () => {
    expect(parseChannel(null)).toBe("stable");
    expect(parseChannel("junk")).toBe("stable");
    expect(parseChannel("beta")).toBe("beta");
    expect(loadChannel(storageWith({}))).toBe("stable");
  });

  it("读取抛异常时回退默认", () => {
    expect(loadChannel({ getItem: () => { throw new Error("denied"); } })).toBe("stable");
  });

  it("自动检查默认开、显式 off 才关", () => {
    expect(loadAutoCheck(storageWith({}))).toBe(true);
    expect(loadAutoCheck(storageWith({ "cca-update-autocheck": "off" }))).toBe(false);
    expect(loadAutoCheck(storageWith({ "cca-update-autocheck": "junk" }))).toBe(true);
  });

  it("渠道端点与 Rust 侧 channel_endpoint 一一对应（rolling release 固定 URL）", () => {
    expect(channelEndpointOf("stable")).toBe(
      "https://github.com/liang-zhenxiang/cc-analyzer/releases/download/stable/latest-stable.json"
    );
    expect(channelEndpointOf("beta")).toBe(
      "https://github.com/liang-zhenxiang/cc-analyzer/releases/download/beta/latest-beta.json"
    );
  });

  it("两个渠道都有面向用户的文案", () => {
    expect(Object.keys(CHANNEL_LABELS).sort()).toEqual(["beta", "stable"]);
  });
});
