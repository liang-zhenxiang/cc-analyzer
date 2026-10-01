import { useSyncExternalStore } from "react";

/**
 * Subscription plan presets for the billing-window gauge.
 *
 * The numbers are **community estimates compiled from public sources**
 * (primarily Claude-Code-Usage-Monitor's plan model) — Anthropic does not
 * publish per-window token limits, so these are `estimated`, never presented
 * as official figures, and a custom value is always one click away. No plan
 * selected means no denominator, and without a denominator the UI shows
 * consumption only — never a made-up percentage.
 */
export const PLAN_LIMITS_AS_OF = "2026-10";

export type PlanId = "none" | "pro" | "max5" | "max20" | "team" | "custom";

export type PlanSelection = {
  id: PlanId;
  /** Tokens per 5h billing window; `null` when unknown or "none". */
  limitTokens: number | null;
};

export const PLAN_PRESETS: ReadonlyArray<{
  id: PlanId;
  label: string;
  limitTokens: number | null;
}> = [
  { id: "none", label: "不选（只看消耗）", limitTokens: null },
  { id: "pro", label: "Pro（约 1.9 万 / 窗口）", limitTokens: 19_000 },
  { id: "max5", label: "Max 5×（约 8.8 万 / 窗口）", limitTokens: 88_000 },
  { id: "max20", label: "Max 20×（约 22 万 / 窗口）", limitTokens: 220_000 },
  { id: "team", label: "Team（自定上限）", limitTokens: null },
  { id: "custom", label: "自定义", limitTokens: null }
];

const STORAGE_KEY = "cca-billing-plan";

const VALID_IDS: ReadonlySet<string> = new Set([
  ...PLAN_PRESETS.map((preset) => preset.id),
  "custom"
]);

/** Parses persisted state; anything malformed falls back to "none". */
export function parsePlanSelection(raw: unknown): PlanSelection {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const id = source.id;
  // has() 不做类型收窄：字符串过了白名单后显式当作 PlanId（集合就是全集）。
  if (typeof id !== "string" || !VALID_IDS.has(id)) return { id: "none", limitTokens: null };
  const planId = id as PlanId;
  const custom = Number(source.customLimitTokens);
  if (id === "custom") {
    return {
      id: planId,
      limitTokens: Number.isFinite(custom) && custom > 0 ? Math.round(custom) : null
    };
  }
  if (id === "team") {
    return {
      id: planId,
      limitTokens: Number.isFinite(custom) && custom > 0 ? Math.round(custom) : null
    };
  }
  const preset = PLAN_PRESETS.find((item) => item.id === planId);
  return { id: planId, limitTokens: preset ? preset.limitTokens : null };
}

function loadPlan(): PlanSelection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { id: "none", limitTokens: null };
    return parsePlanSelection(JSON.parse(raw));
  } catch {
    return { id: "none", limitTokens: null };
  }
}

let current: PlanSelection | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getPlan(): PlanSelection {
  current ??= loadPlan();
  return current;
}

export function setPlan(next: PlanSelection): void {
  current = next;
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Persistence is optional; the in-memory selection still works.
  }
  notify();
}

export function subscribePlan(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlan(): PlanSelection {
  return useSyncExternalStore(subscribePlan, getPlan);
}
