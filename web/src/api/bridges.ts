import { createContext, createElement, useContext, type ReactNode } from "react";
import type { Bridges } from "./types";

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
