import { createContext, createElement, useContext, type ReactNode } from "react";
import type { ArchiveBundleBridge, Bridges, TrayBridge } from "./types";

const BridgesContext = createContext<Bridges | null>(null);

type BridgesProviderProps = {
  bridges: Bridges;
  children: ReactNode;
};

export function BridgesProvider({ bridges, children }: BridgesProviderProps) {
  return createElement(BridgesContext.Provider, { value: bridges }, children);
}

export function useBridges(): Bridges {
  const bridges = useContext(BridgesContext);
  if (!bridges) {
    throw new Error("useBridges 必须在 BridgesProvider 内使用");
  }
  return bridges;
}

/**
 * 托盘桥是可选能力（见 `Bridges.tray`）：老测试 / 老宿主构造的 bridges 没有它。
 * 取用统一走这里，拿到 `undefined` 就用可选链跳过——托盘是旁路，缺了不能崩界面。
 */
export function useTrayBridge(): TrayBridge | undefined {
  return useBridges().tray;
}

/**
 * 归档包桥同样可能缺失（老宿主 / 老测试）。保持同样的口径：拿到 `undefined`
 * 就把两个按钮禁用并说明原因，而不是让整个设置面板跟着崩。
 */
export function useArchiveBundleBridge(): ArchiveBundleBridge | undefined {
  return useBridges().archiveBundle;
}
