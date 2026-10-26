import { beforeEach, describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  KIOSK_FONT_SCALE,
  KIOSK_KEY,
  KioskRoot,
  initKiosk,
  loadKiosk,
  parseKiosk,
  resetKioskForTest,
  setKiosk,
  toggleKiosk,
  useKiosk
} from "./KioskMode";
import { getFontScale, resetFontScaleForTest, setFontScale } from "../features/settings/fontScale";

function Probe() {
  const kiosk = useKiosk();
  return <span data-testid="flag">{kiosk ? "on" : "off"}</span>;
}

beforeEach(() => {
  window.localStorage.clear();
  resetKioskForTest(false);
  resetFontScaleForTest(1);
  delete document.documentElement.dataset.kiosk;
});

describe("大屏模式的状态", () => {
  test("白名单只认 \"on\"，其余值一律当关闭", () => {
    expect(parseKiosk("on")).toBe(true);
    expect(parseKiosk("off")).toBe(false);
    expect(parseKiosk("1")).toBe(false);
    expect(parseKiosk(null)).toBe(false);
    expect(loadKiosk(null)).toBe(false);

    window.localStorage.setItem(KIOSK_KEY, "on");
    expect(loadKiosk()).toBe(true);
  });

  test("开启写上 data-kiosk 与持久化，并把字号提到最高档；关闭原样还回去", () => {
    setFontScale(1.1);

    setKiosk(true);
    expect(document.documentElement.dataset.kiosk).toBe("on");
    expect(window.localStorage.getItem(KIOSK_KEY)).toBe("on");
    expect(getFontScale()).toBe(KIOSK_FONT_SCALE);
    expect(KIOSK_FONT_SCALE).toBe(1.3);

    setKiosk(false);
    // 普通档移除属性，而不是写 "off"（与主题 / 对比度同款）。
    expect(document.documentElement.dataset.kiosk).toBeUndefined();
    expect(window.localStorage.getItem(KIOSK_KEY)).toBe("off");
    expect(getFontScale()).toBe(1.1);
  });

  test("大屏里用户自己改过字号，退出时不覆盖他的选择", () => {
    setFontScale(1);
    setKiosk(true);
    setFontScale(1.2);
    setKiosk(false);
    expect(getFontScale()).toBe(1.2);
  });

  test("toggleKiosk 往返，initKiosk 从持久化恢复", () => {
    toggleKiosk();
    expect(document.documentElement.dataset.kiosk).toBe("on");
    toggleKiosk();
    expect(document.documentElement.dataset.kiosk).toBeUndefined();

    window.localStorage.setItem(KIOSK_KEY, "on");
    resetKioskForTest(false);
    expect(initKiosk()).toBe(true);
    expect(document.documentElement.dataset.kiosk).toBe("on");
  });
});

describe("KioskRoot", () => {
  test("关闭时容器仍在（探针锚点），只是不带 data-kiosk，也没有退出提示", () => {
    render(
      <KioskRoot>
        <Probe />
      </KioskRoot>
    );
    const root = document.querySelector('[data-probe="kiosk-root"]');
    expect(root).not.toBeNull();
    expect(root).not.toHaveAttribute("data-kiosk");
    expect(screen.getByTestId("flag")).toHaveTextContent("off");
    expect(screen.queryByText("Esc 退出大屏")).toBeNull();
  });

  test("开启时带 data-kiosk=\"on\" 并显示退出提示", () => {
    setKiosk(true);
    render(
      <KioskRoot>
        <Probe />
      </KioskRoot>
    );
    expect(document.querySelector('[data-probe="kiosk-root"]')).toHaveAttribute("data-kiosk", "on");
    expect(screen.getByTestId("flag")).toHaveTextContent("on");
    expect(screen.getByText("Esc 退出大屏")).toBeInTheDocument();
  });
});
