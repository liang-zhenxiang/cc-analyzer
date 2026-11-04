import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEMO_CHANGE_EVENT,
  DEMO_ENTER_EVENT,
  DEMO_EXIT_EVENT,
  DEMO_STORAGE_KEY,
  installDemoModeListeners,
  isDemoMode,
  setDemoMode
} from "./demoMode";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("demoMode", () => {
  test("默认不是演示模式", () => {
    expect(isDemoMode()).toBe(false);
  });

  test("setDemoMode 写入 / 删除持久化键，并广播 change", () => {
    const onChange = vi.fn();
    window.addEventListener(DEMO_CHANGE_EVENT, onChange);

    setDemoMode(true);
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBe("on");
    expect(isDemoMode()).toBe(true);

    setDemoMode(false);
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    expect(isDemoMode()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);

    window.removeEventListener(DEMO_CHANGE_EVENT, onChange);
  });

  test("存储不可用时不抛错，读不到就按非演示处理", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(isDemoMode()).toBe(false);
    expect(() => setDemoMode(true)).not.toThrow();
  });

  test("enter / exit 事件驱动开关，取消订阅后不再响应", () => {
    const uninstall = installDemoModeListeners();

    window.dispatchEvent(new Event(DEMO_ENTER_EVENT));
    expect(isDemoMode()).toBe(true);

    window.dispatchEvent(new Event(DEMO_EXIT_EVENT));
    expect(isDemoMode()).toBe(false);

    uninstall();
    window.dispatchEvent(new Event(DEMO_ENTER_EVENT));
    expect(isDemoMode()).toBe(false);
  });
});
